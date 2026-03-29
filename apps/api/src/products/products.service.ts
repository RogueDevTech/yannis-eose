import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, asc, ilike, count, sql, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type {
  CreateProductInput,
  UpdateProductInput,
  ListProductsInput,
  ProductOffer,
} from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { InventoryService } from '../inventory/inventory.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

function lowestOfferPrice(offers: ProductOffer[]): number {
  if (offers.length === 0) return 0;
  return Math.min(...offers.map((o) => o.price));
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Catalog visibility for MEDIA_BUYER only: assigned products when restrict_product_access
   * is set, or when they have any user_product_assignments row. Other roles unchanged.
   * SuperAdmin bypasses.
   */
  private async getCatalogScopeForViewer(
    viewerId: string,
    role: string,
  ): Promise<{ allowedProductIds: string[] | null }> {
    if (role === 'SUPER_ADMIN') {
      return { allowedProductIds: null };
    }

    if (role !== 'MEDIA_BUYER') {
      return { allowedProductIds: null };
    }

    const [userRow] = await this.db
      .select({ restrictProductAccess: schema.users.restrictProductAccess })
      .from(schema.users)
      .where(eq(schema.users.id, viewerId))
      .limit(1);

    const assignmentRows = await this.db
      .selectDistinct({ productId: schema.userProductAssignments.productId })
      .from(schema.userProductAssignments)
      .where(eq(schema.userProductAssignments.userId, viewerId));

    const assignmentIds = [...new Set(assignmentRows.map((r) => r.productId))];
    const restrict = userRow?.restrictProductAccess ?? false;
    const shouldScope = restrict || assignmentIds.length > 0;

    if (!shouldScope) {
      return { allowedProductIds: null };
    }

    return { allowedProductIds: assignmentIds };
  }

  /**
   * Create a new product.
   * Optionally adds initial stock at a location when initialStockQty > 0.
   * Uses transaction so set_config and insert run on same connection (audit trigger).
   */
  async create(input: CreateProductInput, actor: SessionUser) {
    const baseSalePrice = lowestOfferPrice(input.offers);
    this.logger.log('create input', {
      costPrice: input.costPrice,
      costPriceType: typeof input.costPrice,
      baseSalePrice,
      baseSalePriceType: typeof baseSalePrice,
    });

    try {
      return await this.db
        .transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);

          const rows = await tx
            .insert(schema.products)
            .values({
              name: input.name,
              description: input.description ?? null,
              offers: input.offers as unknown,
              baseSalePrice: sql`${baseSalePrice}::numeric`,
              costPrice: sql`${input.costPrice}::numeric`,
              category: input.category ?? null,
              categoryId: input.categoryId ?? null,
              status: 'ACTIVE' as const,
            } as unknown as typeof schema.products.$inferInsert)
            .returning();

          const product = rows[0];
          if (!product) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Failed to create product',
            });
          }
          return product;
        })
        .then(async (product) => {
        const qty = input.initialStockQty ?? 0;
        const locationId = input.initialStockLocationId;
        if (qty > 0 && locationId) {
          await this.inventory.intake(
            {
              productId: product.id,
              locationId,
              quantity: qty,
              factoryCost: input.costPrice,
              landingCost: 0,
            },
            actor,
          );
        }
        return product;
      });
    } catch (err) {
      this.logger.error('ProductsService.create DB error', {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
        cause: err instanceof Error && err.cause ? err.cause : undefined,
        fullError: JSON.stringify(err, Object.getOwnPropertyNames(err as object)),
      });
      throw err;
    }
  }

  /**
   * Get a single product by ID.
   * Financial field stripping is handled by the tRPC CLS middleware.
   */
  async getById(productId: string, viewerId: string, viewerRole: string) {
    const { allowedProductIds } = await this.getCatalogScopeForViewer(viewerId, viewerRole);
    if (allowedProductIds !== null) {
      if (allowedProductIds.length === 0 || !allowedProductIds.includes(productId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }
    }

    const rows = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);

    const product = rows[0];
    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return product;
  }

  /**
   * List products with filtering, search, and pagination.
   * Financial field stripping is handled by the tRPC CLS middleware.
   */
  async list(input: ListProductsInput, viewerId: string, viewerRole: string) {
    const { allowedProductIds } = await this.getCatalogScopeForViewer(viewerId, viewerRole);
    if (allowedProductIds !== null && allowedProductIds.length === 0) {
      return {
        products: [],
        pagination: {
          page: input.page,
          limit: input.limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const conditions = [];

    if (allowedProductIds !== null) {
      conditions.push(inArray(schema.products.id, allowedProductIds));
    }
    if (input.status) {
      conditions.push(eq(schema.products.status, input.status));
    }
    if (input.category) {
      conditions.push(eq(schema.products.category, input.category));
    }
    if (input.search) {
      conditions.push(ilike(schema.products.name, `%${input.search}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderByColumn = {
      name: schema.products.name,
      baseSalePrice: schema.products.baseSalePrice,
      createdAt: schema.products.createdAt,
    }[input.sortBy];

    const orderDirection = input.sortOrder === 'asc' ? asc : desc;
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          description: schema.products.description,
          offers: schema.products.offers,
          baseSalePrice: schema.products.baseSalePrice,
          costPrice: schema.products.costPrice,
          category: schema.products.category,
          categoryId: schema.products.categoryId,
          status: schema.products.status,
          createdAt: schema.products.createdAt,
          updatedAt: schema.products.updatedAt,
          categoryName: schema.productCategories.name,
          brandName: schema.productCategories.brandName,
        })
        .from(schema.products)
        .leftJoin(
          schema.productCategories,
          eq(schema.products.categoryId, schema.productCategories.id),
        )
        .where(whereClause)
        .orderBy(orderDirection(orderByColumn))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.products).where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    const products = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      offers: r.offers,
      baseSalePrice: r.baseSalePrice,
      costPrice: r.costPrice,
      category: r.category,
      categoryId: r.categoryId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      categoryName: r.categoryName ?? null,
      brandName: r.brandName ?? null,
    }));

    return {
      products,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Update product details.
   */
  async update(input: UpdateProductInput, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const existingRows = await this.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, input.productId))
      .limit(1);

    if (!existingRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateFields['name'] = input.name;
    if (input.description !== undefined) updateFields['description'] = input.description;
    if (input.offers !== undefined) {
      updateFields['offers'] = input.offers;
      updateFields['baseSalePrice'] = sql`${lowestOfferPrice(input.offers)}::numeric`;
    }
    if (input.costPrice !== undefined) updateFields['costPrice'] = sql`${input.costPrice}::numeric`;
    if (input.category !== undefined) updateFields['category'] = input.category;
    if (input.categoryId !== undefined) updateFields['categoryId'] = input.categoryId;
    if (input.status !== undefined) updateFields['status'] = input.status;

    this.logger.log('update fields', {
      updateFields,
      costPriceType: updateFields.costPrice !== undefined ? typeof updateFields.costPrice : 'n/a',
      baseSalePriceType: updateFields.baseSalePrice !== undefined ? typeof updateFields.baseSalePrice : 'n/a',
    });

    try {
      const updatedRows = await this.db
        .update(schema.products)
        .set(updateFields)
        .where(eq(schema.products.id, input.productId))
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update product' });
      }

      return updated;
    } catch (err) {
      this.logger.error('ProductsService.update DB error', {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
        cause: err instanceof Error && err.cause ? err.cause : undefined,
        fullError: JSON.stringify(err, Object.getOwnPropertyNames(err as object)),
      });
      throw err;
    }
  }

  /**
   * Get distinct categories for filter dropdowns.
   */
  async getCategories(viewerId: string, viewerRole: string) {
    const { allowedProductIds } = await this.getCatalogScopeForViewer(viewerId, viewerRole);
    if (allowedProductIds !== null && allowedProductIds.length === 0) {
      return [];
    }

    const scopeClause =
      allowedProductIds !== null
        ? and(eq(schema.products.status, 'ACTIVE'), inArray(schema.products.id, allowedProductIds))
        : eq(schema.products.status, 'ACTIVE');

    const rows = await this.db
      .selectDistinct({ category: schema.products.category })
      .from(schema.products)
      .where(scopeClause);

    return rows
      .map((r) => r.category)
      .filter((c): c is string => c !== null)
      .sort();
  }
}
