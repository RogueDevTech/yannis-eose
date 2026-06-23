import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, ilike, or, count, desc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  ListProductCategoriesInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import type { SessionUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ProductCategoriesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Create a new product category.
   * Uses a transaction so set_config and insert run on the same connection (required for audit trigger).
   */
  async create(input: CreateProductCategoryInput, actor: SessionUser, groupId?: string | null) {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);

      const existing = await tx
        .select({ id: schema.productCategories.id })
        .from(schema.productCategories)
        .where(eq(schema.productCategories.name, input.name))
        .limit(1);

      if (existing[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A category named "${input.name}" already exists`,
        });
      }

      const rows = await tx
        .insert(schema.productCategories)
        .values({
          name: input.name,
          brandName: input.brandName,
          brandPhone: input.brandPhone ?? null,
          brandEmail: input.brandEmail || null,
          brandWhatsapp: input.brandWhatsapp ?? null,
          smsSenderId: input.smsSenderId ?? null,
          groupId: groupId ?? null,
          status: 'ACTIVE',
        })
        .returning();

      const category = rows[0];
      if (!category) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create category' });
      }
      return category;
    });
  }

  /**
   * Get a single category by ID.
   */
  async getById(categoryId: string) {
    const rows = await this.db
      .select()
      .from(schema.productCategories)
      .where(eq(schema.productCategories.id, categoryId))
      .limit(1);

    const category = rows[0];
    if (!category) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
    }

    return category;
  }

  /**
   * List categories with optional filtering and pagination.
   */
  async list(input: ListProductCategoriesInput, groupId?: string | null) {
    const conditions = [];

    if (input.status) {
      conditions.push(eq(schema.productCategories.status, input.status));
    }
    if (groupId) {
      conditions.push(eq(schema.productCategories.groupId, groupId));
    }
    if (input.search) {
      conditions.push(
        or(
          ilike(schema.productCategories.name, `%${input.search}%`),
          ilike(schema.productCategories.brandName, `%${input.search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [categories, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.productCategories)
        .where(whereClause)
        .orderBy(desc(schema.productCategories.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.productCategories)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return {
      categories,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Update a category's details.
   * Uses a transaction so set_config and update run on the same connection (required for audit trigger).
   */
  async update(input: UpdateProductCategoryInput, actor: SessionUser) {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);

      const existing = await tx
        .select({ id: schema.productCategories.id })
        .from(schema.productCategories)
        .where(eq(schema.productCategories.id, input.categoryId))
        .limit(1);

      if (!existing[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
      }

      if (input.name) {
        const nameRows = await tx
          .select({ id: schema.productCategories.id })
          .from(schema.productCategories)
          .where(eq(schema.productCategories.name, input.name))
          .limit(1);

        if (nameRows[0] && nameRows[0].id !== input.categoryId) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A category named "${input.name}" already exists`,
          });
        }
      }

      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateFields['name'] = input.name;
      if (input.brandName !== undefined) updateFields['brandName'] = input.brandName;
      if (input.brandPhone !== undefined) updateFields['brandPhone'] = input.brandPhone;
      if (input.brandEmail !== undefined) updateFields['brandEmail'] = input.brandEmail || null;
      if (input.brandWhatsapp !== undefined) updateFields['brandWhatsapp'] = input.brandWhatsapp;
      if (input.smsSenderId !== undefined) updateFields['smsSenderId'] = input.smsSenderId;
      if (input.status !== undefined) updateFields['status'] = input.status;

      const updatedRows = await tx
        .update(schema.productCategories)
        .set(updateFields)
        .where(eq(schema.productCategories.id, input.categoryId))
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update category' });
      }
      return updated;
    });
  }

  /**
   * Get all active categories for dropdown selectors.
   */
  async listActive(groupId?: string) {
    const conditions = [eq(schema.productCategories.status, 'ACTIVE')];
    if (groupId) {
      conditions.push(eq(schema.productCategories.groupId, groupId));
    }
    return this.db
      .select({
        id: schema.productCategories.id,
        name: schema.productCategories.name,
        brandName: schema.productCategories.brandName,
      })
      .from(schema.productCategories)
      .where(and(...conditions))
      .orderBy(schema.productCategories.name);
  }
}
