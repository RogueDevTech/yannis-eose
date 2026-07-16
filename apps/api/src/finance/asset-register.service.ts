import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, sql, ilike, isNull, type SQL, type AnyColumn } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  ACCT,
  type CreateAssetInput,
  type ListAssetsInput,
  type GetAssetInput,
  type DisposeAssetInput,
  type RunDepreciationInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { GeneralLedgerService, type PostVoucherLine } from './general-ledger.service';

type Drizzle = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0];
type Actor = { id: string };

/** Work in integer minor units (kobo) to avoid float drift. */
const toMinor = (n: number) => Math.round(n * 100);

/**
 * AssetRegisterService — fixed asset CRUD + monthly depreciation engine.
 *
 * Each depreciation run calculates the monthly charge per asset, records a
 * depreciation_entry row, updates the asset's accumulated_depreciation cache,
 * and posts the GL journal (Dr Depreciation / Cr Accumulated Depreciation)
 * via the reusable {@link GeneralLedgerService.postVoucher}.
 */
@Injectable()
export class AssetRegisterService {
  private readonly logger = new Logger(AssetRegisterService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly generalLedger: GeneralLedgerService,
  ) {}

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  async createAsset(input: CreateAssetInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .insert(schema.fixedAssets)
        .values({
          groupId: input.groupId ?? null,
          assetName: input.assetName,
          assetCategory: input.assetCategory,
          acquisitionDate: input.acquisitionDate,
          cost: sql`${input.cost}::numeric`,
          residualValue: sql`${input.residualValue ?? 0}::numeric`,
          usefulLifeMonths: input.usefulLifeMonths ?? null,
          depreciationRate: input.depreciationRate
            ? sql`${input.depreciationRate}::numeric`
            : null,
          depreciationMethod: input.depreciationMethod,
          location: input.location ?? null,
          serialNumber: input.serialNumber ?? null,
          invoiceUrl: input.invoiceUrl ?? null,
          notes: input.notes ?? null,
          createdBy: actor.id,
        })
        .returning();
      return row!;
    });
  }

  async listAssets(input: ListAssetsInput) {
    const conds: SQL[] = [this.groupEqOn(schema.fixedAssets.groupId, input.groupId ?? null)];
    if (input.status) conds.push(eq(schema.fixedAssets.status, input.status));
    if (input.category) conds.push(eq(schema.fixedAssets.assetCategory, input.category));
    if (input.search) {
      conds.push(ilike(schema.fixedAssets.assetName, `%${input.search}%`));
    }

    const where = and(...conds);
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(schema.fixedAssets)
        .where(where)
        .orderBy(desc(schema.fixedAssets.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.fixedAssets)
        .where(where),
    ]);

    const total = totalRow[0]?.total ?? 0;
    return {
      assets: rows,
      pagination: {
        total,
        page: input.page,
        pageSize: input.limit,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  async getAsset(input: GetAssetInput) {
    const [asset] = await this.db
      .select()
      .from(schema.fixedAssets)
      .where(eq(schema.fixedAssets.id, input.assetId))
      .limit(1);
    if (!asset) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Fixed asset not found.' });
    }

    const depreciationSchedule = await this.db
      .select()
      .from(schema.depreciationEntries)
      .where(eq(schema.depreciationEntries.fixedAssetId, input.assetId))
      .orderBy(desc(schema.depreciationEntries.postingDate));

    return { ...asset, depreciationSchedule };
  }

  // ─── Disposal ───────────────────────────────────────────────────────────────

  /**
   * Dispose of a fixed asset. Calculates gain/loss, updates the asset row,
   * and posts the GL entry:
   *
   *   Dr Bank                      proceeds
   *   Dr Accumulated Depreciation  accumulatedDepreciation
   *   Dr/Cr Gain/Loss on Disposal  |gain/loss|
   *     Cr Fixed Asset Cost         cost
   *
   * The entry always balances: proceeds + accDep ± gainLoss = cost.
   */
  async disposeAsset(input: DisposeAssetInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [asset] = await tx
        .select()
        .from(schema.fixedAssets)
        .where(eq(schema.fixedAssets.id, input.assetId))
        .limit(1);
      if (!asset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fixed asset not found.' });
      }
      if (asset.status === 'DISPOSED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Asset is already disposed.' });
      }

      const cost = Number(asset.cost);
      const accDep = Number(asset.accumulatedDepreciation);
      const nbv = cost - accDep;
      const proceeds = input.proceeds;
      const gainLoss = proceeds - nbv; // positive = gain, negative = loss

      // Update the asset row.
      await tx
        .update(schema.fixedAssets)
        .set({
          status: 'DISPOSED',
          disposalDate: input.disposalDate,
          disposalProceeds: sql`${proceeds}::numeric`,
          disposalGainLoss: sql`${gainLoss}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(schema.fixedAssets.id, input.assetId));

      // Post the GL entry for disposal.
      const groupId = asset.groupId ?? null;
      const bankAcct = await this.resolveAccountByCode(tx, groupId, ACCT.BANK_PRIMARY);
      const accDepAcct = await this.resolveAccountByCode(tx, groupId, ACCT.ACC_DEP_VEHICLES);
      // The cost side: debit the fixed asset cost account. Pick the first
      // FIXED_ASSET leaf for the company (the specific sub-account doesn't
      // matter for the total — all roll up to Fixed Assets on the balance sheet).
      const assetCostAcct = await this.resolveAccountByType(tx, groupId, 'FIXED_ASSET');

      if (!bankAcct || !accDepAcct || !assetCostAcct) {
        this.logger.warn(
          `Disposal GL skipped for asset ${input.assetId}: missing account(s).`,
        );
        return;
      }

      const lines: PostVoucherLine[] = [];

      // Dr Bank = proceeds (if any)
      if (proceeds > 0) {
        lines.push({ accountId: bankAcct.id, debit: proceeds, credit: 0, remarks: `Disposal: ${asset.assetName}` });
      }

      // Dr Accumulated Depreciation = accDep (remove the contra balance)
      if (accDep > 0) {
        lines.push({ accountId: accDepAcct.id, debit: accDep, credit: 0, remarks: `Disposal: ${asset.assetName}` });
      }

      // Gain/Loss line
      if (gainLoss !== 0) {
        // Use the Depreciation expense account for disposal loss, or Indirect Income for gain.
        // Simple approach: use the Depreciation account for both (loss on disposal).
        const gainLossAcct = await this.resolveAccountByCode(tx, groupId, ACCT.DISPOSAL_GAIN_LOSS);
        if (gainLossAcct) {
          if (gainLoss < 0) {
            // Loss: Dr Depreciation (expense)
            lines.push({ accountId: gainLossAcct.id, debit: Math.abs(gainLoss), credit: 0, remarks: `Disposal loss: ${asset.assetName}` });
          } else {
            // Gain: Cr Depreciation (reduce expense)
            lines.push({ accountId: gainLossAcct.id, debit: 0, credit: gainLoss, remarks: `Disposal gain: ${asset.assetName}` });
          }
        }
      }

      // Cr Fixed Asset Cost = original cost (remove the asset)
      lines.push({ accountId: assetCostAcct.id, debit: 0, credit: cost, remarks: `Disposal: ${asset.assetName}` });

      if (lines.length >= 2) {
        // Create a journal entry header for the disposal.
        const [jeHeader] = await tx
          .insert(schema.journalEntries)
          .values({
            groupId,
            postingDate: input.disposalDate,
            description: `Asset disposal: ${asset.assetName}`,
            totalDebit: sql`${lines.reduce((s, l) => s + l.debit, 0)}::numeric`,
            totalCredit: sql`${lines.reduce((s, l) => s + l.credit, 0)}::numeric`,
            status: 'POSTED',
          })
          .returning();

        const { fiscalYearId } = await this.generalLedger.postVoucher(tx, {
          groupId,
          postingDate: input.disposalDate,
          voucherType: 'JOURNAL_ENTRY',
          voucherId: jeHeader!.id,
          lines,
        });

        await tx
          .update(schema.journalEntries)
          .set({ fiscalYearId, updatedAt: new Date() })
          .where(eq(schema.journalEntries.id, jeHeader!.id));
      }
    });
  }

  // ─── Monthly Depreciation Run ───────────────────────────────────────────────

  /**
   * Run monthly depreciation for all ACTIVE assets in the company. For each
   * asset, calculates the monthly charge, inserts a depreciation_entry, updates
   * accumulated_depreciation, and posts the GL journal:
   *
   *   Dr Depreciation (6510)           monthlyCharge
   *     Cr Accumulated Depreciation (1220)   monthlyCharge
   *
   * Idempotent per (asset, periodDate): if a depreciation_entry already exists
   * for this asset+month, the asset is skipped.
   */
  async runMonthlyDepreciation(input: RunDepreciationInput, actor: Actor) {
    const groupId = input.groupId ?? null;

    // Get all ACTIVE assets for the group.
    const assets = await this.db
      .select()
      .from(schema.fixedAssets)
      .where(
        and(
          this.groupEqOn(schema.fixedAssets.groupId, groupId),
          eq(schema.fixedAssets.status, 'ACTIVE'),
        ),
      );

    let processed = 0;
    let totalCharge = 0;

    for (const asset of assets) {
      // Idempotency: skip if already depreciated for this period.
      const [existing] = await this.db
        .select({ id: schema.depreciationEntries.id })
        .from(schema.depreciationEntries)
        .where(
          and(
            eq(schema.depreciationEntries.fixedAssetId, asset.id),
            eq(schema.depreciationEntries.postingDate, input.periodDate),
          ),
        )
        .limit(1);
      if (existing) continue;

      const cost = Number(asset.cost);
      const residual = Number(asset.residualValue);
      const accDep = Number(asset.accumulatedDepreciation);
      const nbv = cost - accDep;

      // Already fully depreciated? Skip and mark if needed.
      if (toMinor(nbv) <= toMinor(residual)) {
        if (asset.status === 'ACTIVE') {
          await this.db
            .update(schema.fixedAssets)
            .set({ status: 'FULLY_DEPRECIATED', updatedAt: new Date() })
            .where(eq(schema.fixedAssets.id, asset.id));
        }
        continue;
      }

      let monthlyCharge = this.calculateMonthlyDepreciation(asset);
      if (monthlyCharge <= 0) continue;

      // Cap so NBV never drops below residual.
      const maxCharge = nbv - residual;
      if (monthlyCharge > maxCharge) monthlyCharge = maxCharge;

      // Round to 2dp.
      monthlyCharge = Math.round(monthlyCharge * 100) / 100;
      if (monthlyCharge <= 0) continue;

      const closingNbv = nbv - monthlyCharge;
      const newAccDep = accDep + monthlyCharge;

      // Post inside a withActor transaction (one per asset — keeps each atomic).
      await withActor(this.db, actor, async (tx) => {
        // Insert depreciation entry.
        let glVoucherId: string | null = null;

        // Resolve GL accounts.
        const depExpenseAcct = await this.resolveAccountByCode(tx, groupId, ACCT.DEPRECIATION_FIXED);
        const accDepAcct = await this.resolveAccountByCode(tx, groupId, ACCT.ACC_DEP_VEHICLES);

        if (depExpenseAcct && accDepAcct) {
          // Create a journal entry header.
          const [jeHeader] = await tx
            .insert(schema.journalEntries)
            .values({
              groupId,
              postingDate: input.periodDate,
              description: `Monthly depreciation: ${asset.assetName}`,
              totalDebit: sql`${monthlyCharge}::numeric`,
              totalCredit: sql`${monthlyCharge}::numeric`,
              status: 'POSTED',
            })
            .returning();

          const { fiscalYearId } = await this.generalLedger.postVoucher(tx, {
            groupId,
            postingDate: input.periodDate,
            voucherType: 'JOURNAL_ENTRY',
            voucherId: jeHeader!.id,
            lines: [
              {
                accountId: depExpenseAcct.id,
                debit: monthlyCharge,
                credit: 0,
                remarks: `Depreciation: ${asset.assetName}`,
              },
              {
                accountId: accDepAcct.id,
                debit: 0,
                credit: monthlyCharge,
                remarks: `Depreciation: ${asset.assetName}`,
              },
            ],
          });

          await tx
            .update(schema.journalEntries)
            .set({ fiscalYearId, updatedAt: new Date() })
            .where(eq(schema.journalEntries.id, jeHeader!.id));

          glVoucherId = jeHeader!.id;
        } else {
          this.logger.warn(
            `Depreciation GL skipped for asset ${asset.id}: missing Depreciation or Accumulated Depreciation account.`,
          );
        }

        // Insert the depreciation_entry row.
        await tx.insert(schema.depreciationEntries).values({
          fixedAssetId: asset.id,
          postingDate: input.periodDate,
          openingNbv: sql`${nbv}::numeric`,
          depreciationAmount: sql`${monthlyCharge}::numeric`,
          closingNbv: sql`${closingNbv}::numeric`,
          glVoucherId,
        });

        // Update the asset's running accumulated_depreciation + status.
        const isFullyDepreciated = toMinor(closingNbv) <= toMinor(residual);
        await tx
          .update(schema.fixedAssets)
          .set({
            accumulatedDepreciation: sql`${newAccDep}::numeric`,
            status: isFullyDepreciated ? 'FULLY_DEPRECIATED' : 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(eq(schema.fixedAssets.id, asset.id));
      });

      processed += 1;
      totalCharge += monthlyCharge;
    }

    return { processed, totalCharge: Math.round(totalCharge * 100) / 100 };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Calculate the monthly depreciation amount for a single asset.
   *
   * - Straight-Line: (cost - residualValue) / usefulLifeMonths
   * - Reducing Balance: (cost - accumulatedDepreciation) * (rate / 100) / 12
   * - Units of Production: not yet implemented (returns 0).
   */
  private calculateMonthlyDepreciation(asset: typeof schema.fixedAssets.$inferSelect): number {
    const cost = Number(asset.cost);
    const residual = Number(asset.residualValue);
    const accDep = Number(asset.accumulatedDepreciation);

    switch (asset.depreciationMethod) {
      case 'STRAIGHT_LINE': {
        const months = asset.usefulLifeMonths;
        if (!months || months <= 0) return 0;
        return (cost - residual) / months;
      }
      case 'REDUCING_BALANCE': {
        const rate = Number(asset.depreciationRate ?? 0);
        if (rate <= 0) return 0;
        const nbv = cost - accDep;
        return nbv * (rate / 100) / 12;
      }
      case 'UNITS_OF_PRODUCTION':
        // Deferred: requires usage tracking (total units, units this period).
        return 0;
      default:
        return 0;
    }
  }

  /** Resolve a postable leaf account by exact code. */
  private async resolveAccountByCode(
    tx: Tx,
    groupId: string | null,
    code: string,
  ): Promise<{ id: string } | null> {
    const [row] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          this.groupEqOn(schema.accounts.groupId, groupId),
          eq(schema.accounts.code, code),
          eq(schema.accounts.isGroup, false),
        ),
      )
      .limit(1);
    return row ? { id: row.id } : null;
  }

  /** Resolve a postable leaf account by its semantic type tag. */
  private async resolveAccountByType(
    tx: Tx,
    groupId: string | null,
    accountType: string,
  ): Promise<{ id: string } | null> {
    const [row] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          this.groupEqOn(schema.accounts.groupId, groupId),
          eq(schema.accounts.accountType, accountType as never),
          eq(schema.accounts.isGroup, false),
          eq(schema.accounts.isActive, true),
        ),
      )
      .limit(1);
    return row ? { id: row.id } : null;
  }

  /** Handle null group_id (single-company installs). */
  private groupEqOn(col: AnyColumn, groupId: string | null | undefined): SQL {
    return groupId ? (eq(col, groupId) as SQL) : (isNull(col) as SQL);
  }
}
