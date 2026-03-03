import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, asc, ilike, count, sql } from 'drizzle-orm';
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
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Create a new product.
   * Optionally adds initial stock at a location when initialStockQty > 0.
   * Uses transaction so set_config and insert run on same connection (audit trigger).
   */
  async create(input: CreateProductInput, actor: SessionUser) {
    return await this.db
      .transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);

        const baseSalePrice = lowestOfferPrice(input.offers);
        const rows = await tx
          .insert(schema.products)
          .values({
            name: input.name,
            description: input.description ?? null,
            offers: input.offers as unknown,
            baseSalePrice: baseSalePrice.toFixed(2),
            costPrice: input.costPrice.toFixed(2),
            category: input.category ?? null,
            categoryId: input.categoryId ?? null,
            status: 'ACTIVE' as const,
          })
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
  }

  /**
   * Get a single product by ID.
   * Financial field stripping is handled by the tRPC CLS middleware.
   */
  async getById(productId: string) {
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
  async list(input: ListProductsInput) {
    const conditions = [];

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

    const [products, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.products)
        .where(whereClause)
        .orderBy(orderDirection(orderByColumn))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.products).where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

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
      updateFields['baseSalePrice'] = lowestOfferPrice(input.offers).toFixed(2);
    }
    if (input.costPrice !== undefined) updateFields['costPrice'] = input.costPrice.toFixed(2);
    if (input.category !== undefined) updateFields['category'] = input.category;
    if (input.categoryId !== undefined) updateFields['categoryId'] = input.categoryId;
    if (input.status !== undefined) updateFields['status'] = input.status;

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
  }

  /**
   * Get distinct categories for filter dropdowns.
   */
  async getCategories() {
    const rows = await this.db
      .selectDistinct({ category: schema.products.category })
      .from(schema.products)
      .where(eq(schema.products.status, 'ACTIVE'));

    return rows
      .map((r) => r.category)
      .filter((c): c is string => c !== null)
      .sort();
  }
}
