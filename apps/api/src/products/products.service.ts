import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, asc, ilike, count, sql, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { withActor } from '../common/db/with-actor';
import { db as schema } from '@yannis/shared';
import type {
  CreateProductInput,
  UpdateProductInput,
  ListProductsInput,
  ProductOffer,
  RequestProductArchiveInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { permissionRequestTypeTextEq } from '../common/db/permission-request-type-sql';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GalleryImageIngestService } from './gallery-image-ingest.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isSuperAdminOnly } from '../common/authz';

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase();
}

function parseJsonStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function legacyEmbeddedOffers(raw: unknown): ProductOffer[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ProductOffer[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label : '';
    const qty = typeof o.qty === 'number' && o.qty >= 1 ? o.qty : 1;
    const price = typeof o.price === 'number' ? o.price : Number(o.price);
    if (!label || Number.isNaN(price)) continue;
    out.push({
      label,
      qty,
      price,
      imageUrls: parseJsonStringArray(o.imageUrls),
    });
  }
  return out.length > 0 ? out : null;
}

function templateRowsToOffers(
  rows: Array<{
    name: string;
    price: string;
    quantity: number | null;
    imageUrls: unknown;
  }>,
): ProductOffer[] {
  return rows.map((t) => ({
    label: t.name,
    qty: t.quantity != null && t.quantity >= 1 ? t.quantity : 1,
    price: Number(t.price),
    imageUrls: parseJsonStringArray(t.imageUrls),
  }));
}

function resolveOffersForProduct(
  templateRows: ProductOffer[],
  legacyOffersRaw: unknown,
  baseSalePrice: string,
): ProductOffer[] {
  if (templateRows.length > 0) return templateRows;
  const legacy = legacyEmbeddedOffers(legacyOffersRaw);
  if (legacy && legacy.length > 0) return legacy;
  const p = Number(baseSalePrice);
  return [{ label: 'Standard', qty: 1, price: Number.isFinite(p) ? p : 0, imageUrls: [] }];
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationsService,
    private readonly galleryIngest: GalleryImageIngestService,
  ) {}

  private async assertProductNameAvailable(
    tx: Pick<PostgresJsDatabase<typeof schema>, 'select'>,
    name: string,
    excludeProductId?: string,
  ) {
    const normalized = normalizeProductName(name);
    const whereParts = [
      sql`lower(trim(${schema.products.name})) = ${normalized}`,
      inArray(schema.products.status, ['ACTIVE', 'INACTIVE']),
    ];

    if (excludeProductId) {
      whereParts.push(sql`${schema.products.id} <> ${excludeProductId}`);
    }

    const [existing] = await tx
      .select({ id: schema.products.id, name: schema.products.name, status: schema.products.status })
      .from(schema.products)
      .where(and(...whereParts))
      .limit(1);

    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `A non-archived product named "${existing.name}" already exists.`,
      });
    }
  }

  /**
   * Catalog visibility for MEDIA_BUYER only: assigned products when restrict_product_access
   * is set, or when they have any user_product_assignments row. Other roles unchanged.
   * SuperAdmin bypasses.
   */
  /**
   * Active merchandising tiers (`offer_templates`) for many products — newest first per product.
   */
  private async loadActiveOfferTemplatesByProductIds(productIds: string[]) {
    const map = new Map<string, ProductOffer[]>();
    if (productIds.length === 0) return map;

    // Load from both offer_templates AND offer_group_items (newer system).
    // offer_group_items take precedence when present for a product.
    const [templateRows, groupItemRows] = await Promise.all([
      this.db
        .select({
          productId: schema.offerTemplates.productId,
          name: schema.offerTemplates.name,
          price: schema.offerTemplates.price,
          quantity: schema.offerTemplates.quantity,
          imageUrls: schema.offerTemplates.imageUrls,
          createdAt: schema.offerTemplates.createdAt,
        })
        .from(schema.offerTemplates)
        .where(
          and(
            inArray(schema.offerTemplates.productId, productIds),
            eq(schema.offerTemplates.status, 'ACTIVE'),
          ),
        )
        .orderBy(desc(schema.offerTemplates.createdAt)),
      this.db
        .select({
          productId: schema.offerGroupItems.productId,
          label: schema.offerGroupItems.label,
          price: schema.offerGroupItems.price,
          quantity: schema.offerGroupItems.quantity,
          imageUrl: schema.offerGroupItems.imageUrl,
          sortOrder: schema.offerGroupItems.sortOrder,
        })
        .from(schema.offerGroupItems)
        .innerJoin(schema.offerGroups, eq(schema.offerGroups.id, schema.offerGroupItems.offerGroupId))
        .where(
          and(
            inArray(schema.offerGroupItems.productId, productIds),
            eq(schema.offerGroupItems.status, 'ACTIVE'),
            eq(schema.offerGroups.status, 'ACTIVE'),
          ),
        )
        .orderBy(asc(schema.offerGroupItems.sortOrder)),
    ]);

    // Build from offer_group_items first (newer, takes precedence)
    const groupByProduct = new Map<string, ProductOffer[]>();
    for (const r of groupItemRows) {
      const arr = groupByProduct.get(r.productId) ?? [];
      arr.push({
        label: r.label,
        qty: r.quantity,
        price: Number(r.price),
        imageUrls: r.imageUrl ? [r.imageUrl] : [],
      });
      groupByProduct.set(r.productId, arr);
    }

    // Build from offer_templates (legacy)
    const templateByProduct = new Map<string, typeof templateRows>();
    for (const r of templateRows) {
      const arr = templateByProduct.get(r.productId) ?? [];
      arr.push(r);
      templateByProduct.set(r.productId, arr);
    }

    // Merge: offer_group_items win when present, else fall back to offer_templates
    const allProductIds = new Set([...groupByProduct.keys(), ...templateByProduct.keys()]);
    for (const pid of allProductIds) {
      const groupOffers = groupByProduct.get(pid);
      if (groupOffers && groupOffers.length > 0) {
        map.set(pid, groupOffers);
      } else {
        const templates = templateByProduct.get(pid);
        if (templates) map.set(pid, templateRowsToOffers(templates));
      }
    }
    return map;
  }

  private async getCatalogScopeForViewer(
    viewerId: string,
    role: string,
  ): Promise<{ allowedProductIds: string[] | null }> {
    if (role === 'SUPER_ADMIN') {
      return { allowedProductIds: null };
    }

    // Run user + assignment lookups concurrently — they're independent and
    // both round-trips dominate the latency for this method on a remote DB.
    const [userRows, assignmentRows] = await Promise.all([
      this.db
        .select({ restrictProductAccess: schema.users.restrictProductAccess })
        .from(schema.users)
        .where(eq(schema.users.id, viewerId))
        .limit(1),
      this.db
        .selectDistinct({ productId: schema.userProductAssignments.productId })
        .from(schema.userProductAssignments)
        .where(eq(schema.userProductAssignments.userId, viewerId)),
    ]);

    const assignmentIds = [...new Set(assignmentRows.map((r) => r.productId))];
    const restrict = userRows[0]?.restrictProductAccess ?? false;
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
  async create(input: CreateProductInput, actor: SessionUser, groupId?: string | null) {
    const baseSalePrice = input.baseSalePrice;
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
          await this.assertProductNameAvailable(tx, input.name);

          const rows = await tx
            .insert(schema.products)
            .values({
              name: input.name,
              description: input.description ?? null,
              galleryImageUrls: input.galleryImageUrls ?? [],
              offers: [] as unknown,
              baseSalePrice: sql`${baseSalePrice}::numeric`,
              costPrice: sql`${input.costPrice}::numeric`,
              category: input.category ?? null,
              categoryId: input.categoryId ?? null,
              groupId: groupId ?? null,
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
        // Fire-and-forget rehost of any external gallery URLs (CEO directive
        // 2026-05-11 — bulk import via Excel often paste supplier-CDN links
        // that vanish without notice). Service no-ops gracefully when S3 env
        // is unset, and keeps the original URL on per-image failure.
        const galleryUrls = input.galleryImageUrls ?? [];
        const needsIngest = galleryUrls.filter((u) => this.galleryIngest.shouldIngestUrl(u));
        if (needsIngest.length > 0) {
          void this.galleryIngest.ingestForProduct(product.id, galleryUrls);
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

    const [templateMap, bundleComponents] = await Promise.all([
      this.loadActiveOfferTemplatesByProductIds([product.id]),
      this.getBundleComponents(product.id),
    ]);
    const templates = templateMap.get(product.id) ?? [];
    return {
      ...product,
      galleryImageUrls: parseJsonStringArray(product.galleryImageUrls),
      offers: resolveOffersForProduct(templates, product.offers, String(product.baseSalePrice)),
      bundleComponents,
    };
  }

  /**
   * List products with filtering, search, and pagination.
   * Financial field stripping is handled by the tRPC CLS middleware.
   */
  async list(input: ListProductsInput, viewerId: string, viewerRole: string, groupId?: string | null) {
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

    // Group isolation — only show products from the active branch group.
    if (groupId) {
      conditions.push(eq(schema.products.groupId, groupId));
    }
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
          galleryImageUrls: schema.products.galleryImageUrls,
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

    // Per-row enrichment: active offer templates and aggregate available stock. Both look
    // up by `productId IN (...)` on different tables (`offer_templates` and
    // `inventory_levels`) and have no dependency on each other, so we run them in parallel
    // rather than sequentially. On a remote DB this saves a full RTT (~120 ms) per call —
    // the products list endpoint runs on every dropdown / catalog page open.
    const productIds = rows.map((r) => r.id);
    const [templateMap, stockRows, bundleComponentRows] = await Promise.all([
      this.loadActiveOfferTemplatesByProductIds(productIds),
      productIds.length > 0
        ? this.db
            .select({
              productId: schema.inventoryLevels.productId,
              totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}), 0)::int`,
            })
            .from(schema.inventoryLevels)
            .where(inArray(schema.inventoryLevels.productId, productIds))
            .groupBy(schema.inventoryLevels.productId)
        : Promise.resolve([] as Array<{ productId: string; totalStock: number }>),
      // Load bundle components so we can compute bundle availability
      productIds.length > 0
        ? this.db
            .select({
              bundleProductId: schema.productBundleComponents.bundleProductId,
              componentProductId: schema.productBundleComponents.componentProductId,
              quantity: schema.productBundleComponents.quantity,
            })
            .from(schema.productBundleComponents)
            .where(inArray(schema.productBundleComponents.bundleProductId, productIds))
        : Promise.resolve([] as Array<{ bundleProductId: string; componentProductId: string; quantity: number }>),
    ]);

    // Build stock map from inventory_levels (standalone products)
    const stockMap = new Map<string, number>();
    for (const s of stockRows) stockMap.set(s.productId, Number(s.totalStock) || 0);

    // For bundle products, compute availability = min(component_stock / component_qty)
    if (bundleComponentRows.length > 0) {
      // Group components by bundle
      const bundleMap = new Map<string, Array<{ componentProductId: string; quantity: number }>>();
      const componentIds = new Set<string>();
      for (const row of bundleComponentRows) {
        let comps = bundleMap.get(row.bundleProductId);
        if (!comps) { comps = []; bundleMap.set(row.bundleProductId, comps); }
        comps.push({ componentProductId: row.componentProductId, quantity: row.quantity });
        componentIds.add(row.componentProductId);
      }
      // Fetch stock for component products not already in stockMap
      const missingComponentIds = [...componentIds].filter((id) => !stockMap.has(id));
      if (missingComponentIds.length > 0) {
        const compStockRows = await this.db
          .select({
            productId: schema.inventoryLevels.productId,
            totalStock: sql<number>`COALESCE(SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}), 0)::int`,
          })
          .from(schema.inventoryLevels)
          .where(inArray(schema.inventoryLevels.productId, missingComponentIds))
          .groupBy(schema.inventoryLevels.productId);
        for (const s of compStockRows) stockMap.set(s.productId, Number(s.totalStock) || 0);
      }
      // Compute bundle availability
      for (const [bundleId, components] of bundleMap) {
        let bundleAvailable = Infinity;
        for (const comp of components) {
          const compStock = stockMap.get(comp.componentProductId) ?? 0;
          bundleAvailable = Math.min(bundleAvailable, Math.floor(compStock / comp.quantity));
        }
        stockMap.set(bundleId, bundleAvailable === Infinity ? 0 : bundleAvailable);
      }
    }

    const products = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      galleryImageUrls: parseJsonStringArray(r.galleryImageUrls),
      offers: resolveOffersForProduct(
        templateMap.get(r.id) ?? [],
        r.offers,
        String(r.baseSalePrice),
      ),
      baseSalePrice: r.baseSalePrice,
      costPrice: r.costPrice,
      category: r.category,
      categoryId: r.categoryId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      categoryName: r.categoryName ?? null,
      brandName: r.brandName ?? null,
      totalStock: stockMap.get(r.id) ?? 0,
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
   * Lightweight product options for dropdowns / label resolution.
   * Mirrors catalog scoping rules (MEDIA_BUYER restrictions) but returns minimal fields.
   */
  async listOptions(
    input: { status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' },
    viewerId: string,
    viewerRole: string,
    groupId?: string | null,
  ): Promise<Array<{ id: string; name: string; status: string; offers?: ProductOffer[] }>> {
    const { allowedProductIds } = await this.getCatalogScopeForViewer(viewerId, viewerRole);
    if (allowedProductIds !== null && allowedProductIds.length === 0) return [];

    const conditions = [];
    if (groupId) {
      conditions.push(eq(schema.products.groupId, groupId));
    }
    if (allowedProductIds !== null) {
      conditions.push(inArray(schema.products.id, allowedProductIds));
    }
    if (input.status) {
      conditions.push(eq(schema.products.status, input.status));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        status: schema.products.status,
        baseSalePrice: schema.products.baseSalePrice,
        offers: schema.products.offers,
      })
      .from(schema.products)
      .where(whereClause)
      .orderBy(asc(schema.products.name));

    const productIds = rows.map((r) => r.id);
    const templateMap = await this.loadActiveOfferTemplatesByProductIds(productIds);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      offers: resolveOffersForProduct(templateMap.get(r.id) ?? [], r.offers, String(r.baseSalePrice)),
    }));
  }

  /**
   * Update product details.
   */
  async update(input: UpdateProductInput, actor: SessionUser) {
    return withActor(this.db, actor, async (tx) => {
      const existingRows = await tx
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.id, input.productId))
        .limit(1);

      if (!existingRows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }

      if (input.status === 'ARCHIVED' && !isSuperAdminOnly(actor)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Only Super Admin may archive from the product edit form. On the products list, use Request archive to submit an approval request.',
        });
      }

      if (input.name !== undefined) {
        await this.assertProductNameAvailable(tx, input.name, input.productId);
      }

      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateFields['name'] = input.name;
      if (input.description !== undefined) updateFields['description'] = input.description;
      if (input.baseSalePrice !== undefined) {
        updateFields['baseSalePrice'] = sql`${input.baseSalePrice}::numeric`;
      }
      if (input.galleryImageUrls !== undefined) {
        updateFields['galleryImageUrls'] = input.galleryImageUrls;
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
        const updatedRows = await tx
          .update(schema.products)
          .set(updateFields)
          .where(eq(schema.products.id, input.productId))
          .returning();

        const updated = updatedRows[0];
        if (!updated) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update product' });
        }

        // Fire-and-forget rehost of any newly-set external gallery URLs.
        // Matches the create path — runs only when the caller explicitly
        // touched `galleryImageUrls` and at least one entry isn't on our
        // bucket already.
        if (input.galleryImageUrls !== undefined) {
          const galleryUrls = input.galleryImageUrls;
          const needsIngest = galleryUrls.filter((u) => this.galleryIngest.shouldIngestUrl(u));
          if (needsIngest.length > 0) {
            void this.galleryIngest.ingestForProduct(input.productId, galleryUrls);
          }
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
    });
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

  /**
   * Archive (soft-remove) a product. Super Admin applies immediately; everyone else with
   * `products.update` creates a PENDING permission request for Super Admin approval.
   */
  async requestArchive(input: RequestProductArchiveInput, actor: SessionUser) {
    const [product] = await this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        status: schema.products.status,
      })
      .from(schema.products)
      .where(eq(schema.products.id, input.productId))
      .limit(1);

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }
    if (product.status === 'ARCHIVED') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Product is already archived' });
    }

    if (isSuperAdminOnly(actor)) {
      const updated = await this.update({ productId: input.productId, status: 'ARCHIVED' }, actor);
      return { requiresApproval: false as const, product: updated };
    }

    const [existingPending] = await this.db
      .select({ id: schema.permissionRequests.id })
      .from(schema.permissionRequests)
      .where(
        and(
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'PRODUCT_ARCHIVE'),
          eq(schema.permissionRequests.status, 'PENDING'),
          sql`${schema.permissionRequests.payload}->>'productId' = ${input.productId}`,
        ),
      )
      .limit(1);

    if (existingPending) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A pending archive request already exists for this product.',
      });
    }

    const [req] = await withActor(this.db, actor, async (tx) =>
      tx
        .insert(schema.permissionRequests)
        .values({
          type: 'PRODUCT_ARCHIVE',
          status: 'PENDING',
          requesterId: actor.id,
          reason: input.reason,
          payload: {
            productId: input.productId,
            productName: product.name,
          } as Record<string, unknown>,
        })
        .returning({ id: schema.permissionRequests.id }),
    );

    if (req?.id) {
      this.notifications.enqueueCreateForRole('SUPER_ADMIN', {
        type: 'approval:permission_request',
        title: 'Product archive pending',
        body: `${actor.name} requested to archive product "${product.name}".`,
        data: { requestId: req.id, type: 'PRODUCT_ARCHIVE' },
      });
    }

    return {
      requiresApproval: true as const,
      requestId: req?.id,
      message: 'Archive request submitted. A Super Admin will review it.',
    };
  }

  /**
   * Called when a Super Admin approves a PRODUCT_ARCHIVE permission request.
   */
  async archiveProductAsApprover(productId: string, approver: SessionUser) {
    return this.update({ productId, status: 'ARCHIVED' }, approver);
  }

  // ── Bundle Components ────────────────────────────────────────────────────────

  /**
   * Get bundle components for a product. Returns empty array if not a bundle.
   */
  async getBundleComponents(productId: string) {
    const rows = await this.db
      .select({
        id: schema.productBundleComponents.id,
        componentProductId: schema.productBundleComponents.componentProductId,
        componentName: schema.products.name,
        quantity: schema.productBundleComponents.quantity,
      })
      .from(schema.productBundleComponents)
      .innerJoin(
        schema.products,
        eq(schema.productBundleComponents.componentProductId, schema.products.id),
      )
      .where(eq(schema.productBundleComponents.bundleProductId, productId))
      .orderBy(asc(schema.products.name));
    return rows;
  }

  /**
   * Set bundle components for a product. Replaces all existing components.
   * Pass an empty array to remove all components (product is no longer a bundle).
   *
   * Validates:
   * - All component products exist and are ACTIVE
   * - No component is itself a bundle (one level deep only)
   * - The bundle product is not referencing itself
   */
  async setBundleComponents(
    productId: string,
    components: Array<{ componentProductId: string; quantity: number }>,
    actor: SessionUser,
  ) {
    // Validate the bundle product exists
    const [bundleProduct] = await this.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    if (!bundleProduct) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    // Self-reference check
    const selfRef = components.find((c) => c.componentProductId === productId);
    if (selfRef) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A bundle cannot contain itself as a component.',
      });
    }

    if (components.length > 0) {
      const componentIds = components.map((c) => c.componentProductId);

      // Validate all component products exist and are ACTIVE
      const existingProducts = await this.db
        .select({ id: schema.products.id, status: schema.products.status })
        .from(schema.products)
        .where(inArray(schema.products.id, componentIds));

      const existingMap = new Map(existingProducts.map((p) => [p.id, p]));
      for (const comp of components) {
        const product = existingMap.get(comp.componentProductId);
        if (!product) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Component product ${comp.componentProductId} does not exist.`,
          });
        }
        if (product.status !== 'ACTIVE') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Component product ${comp.componentProductId} is not ACTIVE.`,
          });
        }
      }

      // No circular bundles — components must not themselves be bundles
      const nestedBundles = await this.db
        .select({ bundleProductId: schema.productBundleComponents.bundleProductId })
        .from(schema.productBundleComponents)
        .where(inArray(schema.productBundleComponents.bundleProductId, componentIds))
        .limit(1);

      if (nestedBundles.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A component cannot itself be a bundle. Bundles are one level deep only.',
        });
      }
    }

    // Replace in a transaction
    await withActor(this.db, actor, async (tx) => {
      // Delete existing components
      await tx
        .delete(schema.productBundleComponents)
        .where(eq(schema.productBundleComponents.bundleProductId, productId));

      // Insert new components
      if (components.length > 0) {
        await tx.insert(schema.productBundleComponents).values(
          components.map((c) => ({
            bundleProductId: productId,
            componentProductId: c.componentProductId,
            quantity: c.quantity,
          })),
        );
      }
    });

    this.logger.log(
      { productId, componentCount: components.length },
      'Bundle components updated',
    );

    return { success: true, componentCount: components.length };
  }
}
