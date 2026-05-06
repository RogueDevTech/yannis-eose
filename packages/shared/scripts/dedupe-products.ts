/**
 * Find products that are exact duplicates (same name, description, gallery, offer-templates
 * fingerprint, prices, category, category_id, status among current rows) and merge them into one row.
 *
 * Canonical row: lexicographically smallest `id` (UUIDv7 ≈ oldest insert).
 * - Inventory at the same location is merged (stock + reserved) into the canonical row.
 * - All `product_id` FKs (discovered from information_schema) are repointed except
 *   `inventory_levels` (merged above), `offer_templates`, and `user_product_assignments`
 *   (handled separately).
 * - Campaign `product_ids` JSON arrays are rewritten.
 *
 * Usage (from packages/shared):
 *   pnpm exec tsx scripts/dedupe-products.ts              # dry-run strict (default)
 *   pnpm exec tsx scripts/dedupe-products.ts --apply       # strict merge, one transaction
 *   pnpm exec tsx scripts/dedupe-products.ts --loose       # dry-run: same normalized name + prices + status
 *   pnpm exec tsx scripts/dedupe-products.ts --loose --apply
 *
 * Before `--apply`: take a Postgres snapshot / logical backup of the database.
 * Requires DATABASE_URL. Loads .env from repo root (next to script), then cwd fallbacks.
 *
 * After `--apply`: spot-check /admin/products, sample orders (order_items), campaigns
 * (product_ids), and inventory_levels for merged SKUs.
 *
 * DB prerequisite: migration `0074_yannis_capture_history_delete_return_old` must be
 * applied so `DELETE FROM products` actually removes rows (older `yannis_capture_history`
 * returned NULL on DELETE and skipped the delete while still copying history).
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(scriptDir, '../../../.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const p of envCandidates) {
  config({ path: p });
}

const APPLY = process.argv.includes('--apply');
const LOOSE = process.argv.includes('--loose');

type DupGroup = { keep_id: string; all_ids: string[]; cnt: number };

function assertUuid(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Invalid UUID: ${id}`);
  }
}

function assertSqlIdent(table: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) {
    throw new Error(`Refusing non-identifier table name: ${table}`);
  }
}

async function findDuplicateGroups(sql: postgres.Sql): Promise<DupGroup[]> {
  const rows = await sql<DupGroup[]>`
    SELECT
      (array_agg(p.id::text ORDER BY p.id::text))[1] AS keep_id,
      array_agg(p.id::text ORDER BY p.id::text) AS all_ids,
      count(*)::int AS cnt
    FROM products p
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', ot.name,
              'price', ot.price::text,
              'quantity', ot.quantity,
              'image_urls', ot.image_urls,
              'status', ot.status
            )
            ORDER BY ot.name ASC, ot.id ASC
          )
          FROM offer_templates ot
          WHERE ot.product_id = p.id AND ot.valid_to IS NULL
        ),
        '[]'::jsonb
      ) AS tiers
    ) ot_agg ON TRUE
    WHERE p.valid_to IS NULL
    GROUP BY
      p.name,
      coalesce(p.description, ''),
      coalesce(p.gallery_image_urls, '[]'::jsonb),
      ot_agg.tiers,
      p.base_sale_price,
      p.cost_price,
      coalesce(p.category, ''),
      coalesce(p.category_id::text, ''),
      p.status
    HAVING count(*) > 1
  `;
  return rows;
}

/**
 * Duplicates that differ only in description, gallery/templates fingerprint, category label, or category_id
 * (typical clone/import). Canonical row = lexicographically smallest id (UUIDv7 ≈ oldest).
 */
async function findLooseDuplicateGroups(sql: postgres.Sql): Promise<DupGroup[]> {
  const rows = await sql<DupGroup[]>`
    SELECT
      (array_agg(p.id::text ORDER BY p.id::text))[1] AS keep_id,
      array_agg(p.id::text ORDER BY p.id::text) AS all_ids,
      count(*)::int AS cnt
    FROM products p
    WHERE p.valid_to IS NULL
    GROUP BY
      lower(trim(regexp_replace(coalesce(p.name, ''), E'\\s+', ' ', 'g'))),
      p.base_sale_price,
      p.cost_price,
      p.status
    HAVING count(*) > 1
  `;
  return rows;
}

/**
 * Same name + prices + category + status, multiple current rows.
 * If `distinct_fingerprints` > 1, rows differ in description/templates/gallery and will NOT merge
 * until those columns match (or you merge manually).
 */
type LooserDupRow = {
  name: string;
  row_count: number;
  distinct_fingerprints: number;
};

async function findLooserDuplicateSummary(sql: postgres.Sql): Promise<LooserDupRow[]> {
  return sql<LooserDupRow[]>`
    SELECT
      p.name::text AS name,
      count(*)::int AS row_count,
      count(
        DISTINCT md5(json_build_object(
          'd', coalesce(p.description, ''),
          'g', coalesce(p.gallery_image_urls, '[]'::jsonb),
          't', ot_agg.tiers
        )::text)
      )::int AS distinct_fingerprints
    FROM products p
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', ot.name,
              'price', ot.price::text,
              'quantity', ot.quantity,
              'image_urls', ot.image_urls,
              'status', ot.status
            )
            ORDER BY ot.name ASC, ot.id ASC
          )
          FROM offer_templates ot
          WHERE ot.product_id = p.id AND ot.valid_to IS NULL
        ),
        '[]'::jsonb
      ) AS tiers
    ) ot_agg ON TRUE
    WHERE p.valid_to IS NULL
    GROUP BY
      p.name,
      p.base_sale_price,
      p.cost_price,
      coalesce(p.category_id::text, ''),
      p.status
    HAVING count(*) > 1
    ORDER BY row_count DESC, name
  `;
}

/** Tables with `product_id` referencing `products(id)` (excludes history tables). */
async function listProductIdTables(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    SELECT DISTINCT ccu.table_name::text AS table_name
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage AS ccu
      ON rc.constraint_catalog = ccu.constraint_catalog
      AND rc.constraint_schema = ccu.constraint_schema
      AND rc.constraint_name = ccu.constraint_name
    JOIN information_schema.constraint_column_usage AS ref
      ON rc.unique_constraint_catalog = ref.constraint_catalog
      AND rc.unique_constraint_schema = ref.constraint_schema
      AND rc.unique_constraint_name = ref.constraint_name
    WHERE ref.table_schema = 'public'
      AND ref.table_name = 'products'
      AND ref.column_name = 'id'
      AND ccu.table_schema = 'public'
      AND ccu.column_name = 'product_id'
      AND ccu.table_name !~ '_history$'
  `;
  return rows.map((r) => r.table_name);
}

async function mergeInventoryLevels(sql: postgres.Sql, keepId: string, dropId: string) {
  assertUuid(keepId);
  assertUuid(dropId);
  await sql`
    UPDATE inventory_levels AS c
    SET
      stock_count = c.stock_count + d.stock_count,
      reserved_count = c.reserved_count + d.reserved_count,
      updated_at = now()
    FROM inventory_levels AS d
    WHERE c.product_id = ${keepId}
      AND d.product_id = ${dropId}
      AND c.location_id = d.location_id
  `;
  await sql`
    DELETE FROM inventory_levels AS d
    USING inventory_levels AS c
    WHERE d.product_id = ${dropId}
      AND c.product_id = ${keepId}
      AND c.location_id = d.location_id
  `;
  await sql`
    UPDATE inventory_levels
    SET product_id = ${keepId}, updated_at = now()
    WHERE product_id = ${dropId}
  `;
}

async function repointTableProductId(sql: postgres.Sql, table: string, keepId: string, dropId: string) {
  assertSqlIdent(table);
  assertUuid(keepId);
  assertUuid(dropId);
  await sql.unsafe(
    `UPDATE "${table}" SET product_id = $1 WHERE product_id = $2`,
    [keepId, dropId],
  );
}

async function mergeOfferTemplates(sql: postgres.Sql, keepId: string, dropId: string) {
  assertUuid(keepId);
  assertUuid(dropId);
  /** Campaigns FK offer_template_id — must move off dup rows before DELETE. */
  await sql`
    UPDATE campaigns AS c
    SET offer_template_id = s.new_template_id,
        updated_at = now()
    FROM (
      SELECT DISTINCT ON (ot_dup.id)
        ot_dup.id AS old_template_id,
        ot_keep.id AS new_template_id
      FROM offer_templates AS ot_dup
      INNER JOIN offer_templates AS ot_keep
        ON ot_keep.product_id = ${keepId}
        AND ot_keep.name = ot_dup.name
        AND ot_keep.valid_to IS NULL
      WHERE ot_dup.product_id = ${dropId}
        AND ot_dup.valid_to IS NULL
      ORDER BY ot_dup.id, ot_keep.id
    ) AS s
    WHERE c.offer_template_id = s.old_template_id
      AND c.valid_to IS NULL
  `;
  await sql`
    DELETE FROM offer_templates AS ot_dup
    USING offer_templates AS ot_keep
    WHERE ot_dup.product_id = ${dropId}
      AND ot_dup.valid_to IS NULL
      AND ot_keep.product_id = ${keepId}
      AND ot_keep.valid_to IS NULL
      AND ot_keep.name = ot_dup.name
  `;
  await sql`
    UPDATE offer_templates
    SET product_id = ${keepId}, updated_at = now()
    WHERE product_id = ${dropId}
      AND valid_to IS NULL
  `;
}

async function mergeUserProductAssignments(sql: postgres.Sql, keepId: string, dropId: string) {
  assertUuid(keepId);
  assertUuid(dropId);
  await sql`
    DELETE FROM user_product_assignments AS u
    WHERE u.product_id = ${dropId}
      AND EXISTS (
        SELECT 1
        FROM user_product_assignments u2
        WHERE u2.user_id = u.user_id
          AND u2.product_id = ${keepId}
      )
  `;
  await sql`
    UPDATE user_product_assignments
    SET product_id = ${keepId}, updated_at = now()
    WHERE product_id = ${dropId}
  `;
}

async function mergeCampaignProductIds(sql: postgres.Sql, keepId: string, dropId: string) {
  assertUuid(keepId);
  assertUuid(dropId);
  const campaigns = await sql<{ id: string; product_ids: unknown }[]>`
    SELECT id, product_ids
    FROM campaigns
    WHERE valid_to IS NULL
      AND product_ids IS NOT NULL
      AND product_ids::text LIKE ${'%' + dropId + '%'}
  `;
  for (const row of campaigns) {
    const raw = row.product_ids;
    let arr: string[] = [];
    if (Array.isArray(raw)) {
      arr = raw as string[];
    } else if (typeof raw === 'string') {
      try {
        arr = JSON.parse(raw) as string[];
      } catch {
        continue;
      }
    } else if (raw && typeof raw === 'object') {
      arr = Object.values(raw as Record<string, string>);
    }
    const next = [...new Set(arr.map((id) => (id === dropId ? keepId : id)))];
    await sql`
      UPDATE campaigns
      SET product_ids = ${JSON.stringify(next)}::jsonb, updated_at = now()
      WHERE id = ${row.id}
    `;
  }
}

const SKIP_GENERIC_REPOINT = new Set([
  'products',
  'inventory_levels',
  'offer_templates',
  'user_product_assignments',
]);

async function mergeOneDuplicate(
  sql: postgres.Sql,
  keepId: string,
  dropId: string,
  productIdTables: string[],
) {
  assertUuid(keepId);
  assertUuid(dropId);

  await mergeInventoryLevels(sql, keepId, dropId);

  for (const table of productIdTables) {
    if (SKIP_GENERIC_REPOINT.has(table)) continue;
    await repointTableProductId(sql, table, keepId, dropId);
  }

  await mergeOfferTemplates(sql, keepId, dropId);
  await mergeUserProductAssignments(sql, keepId, dropId);
  await mergeCampaignProductIds(sql, keepId, dropId);

  await sql`DELETE FROM products WHERE id = ${dropId} AND valid_to IS NULL`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add it to .env at the repo root.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    const productIdTables = await listProductIdTables(sql);
    const groups = LOOSE ? await findLooseDuplicateGroups(sql) : await findDuplicateGroups(sql);
    const looser = LOOSE ? [] : await findLooserDuplicateSummary(sql);
    const merges: Array<{ keep: string; drop: string }> = [];
    for (const g of groups) {
      const keep = g.keep_id;
      for (const id of g.all_ids) {
        if (id !== keep) merges.push({ keep, drop: id });
      }
    }

    if (!LOOSE && looser.length > 0) {
      const split = looser.filter((r) => r.distinct_fingerprints > 1);
      console.log(
        `\nSame name + prices + category + status (${looser.length} group(s)); ` +
          `${split.length} group(s) have differing description/gallery/templates — those rows will NOT merge until fingerprints match.\n`,
      );
      for (const r of looser.slice(0, 50)) {
        const tag = r.distinct_fingerprints > 1 ? ' [needs description/templates alignment]' : '';
        console.log(`  ${r.name}  rows=${r.row_count}  distinct_fingerprint_groups=${r.distinct_fingerprints}${tag}`);
      }
      if (looser.length > 50) {
        console.log(`  … and ${looser.length - 50} more name+price groups`);
      }
      console.log('');
    }

    if (merges.length === 0) {
      console.log(
        LOOSE
          ? 'No loose duplicate groups (normalized name + base_sale_price + cost_price + status).'
          : 'No exact duplicate product groups found (current rows only, valid_to IS NULL).',
      );
      if (!LOOSE && looser.length > 0) {
        console.log(
          'Looser duplicate groups exist (see above). Re-run with --loose to merge same-name+price+status clones, ' +
            'or align description + offer templates / gallery and re-run without --loose.',
        );
      }
      return;
    }

    console.log(
      `Found ${groups.length} ${LOOSE ? 'loose ' : ''}duplicate group(s), ${merges.length} product row(s) to remove.`,
    );
    console.log(`Discovered ${productIdTables.length} tables with column product_id.\n`);
    for (const g of groups) {
      const drops = g.all_ids.filter((id) => id !== g.keep_id);
      console.log(`  keep ${g.keep_id}  ← merge ${drops.join(', ')}  (${g.cnt} rows)`);
    }

    if (!APPLY) {
      console.log(
        '\nDry-run only. Re-run with --apply' +
          (LOOSE ? '' : ' (add --loose before --apply for normalized-name merge)') +
          ' to execute in a single database transaction.',
      );
      return;
    }

    console.error(
      '\n*** BACKUP CHECKPOINT ***\n' +
        'You are about to merge duplicate products and DELETE duplicate rows.\n' +
        'Confirm you have a current database snapshot / backup before proceeding.\n' +
        '*** END BACKUP CHECKPOINT ***\n',
    );

    await sql.begin(async (tx) => {
      const tables = await listProductIdTables(tx as postgres.Sql);
      for (const { keep, drop } of merges) {
        console.log(`Merging ${drop} → ${keep}…`);
        await mergeOneDuplicate(tx as postgres.Sql, keep, drop, tables);
      }
    });

    console.log('\nDone. Merged and removed duplicate product rows.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => {
  const err = e as { code?: string; message?: string };
  if (err?.code === 'ENOTFOUND' || /getaddrinfo ENOTFOUND/i.test(String(err?.message))) {
    console.error(e);
    console.error(
      '\nCould not resolve the database host. Run this script from a machine/VPN that can reach DATABASE_URL, ' +
        'or fix the hostname in .env.',
    );
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});
