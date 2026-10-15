/**
 * History table drift guard.
 *
 * Every live table with a `<table>_history` twin is captured by triggers. When a
 * migration adds a column to one side and forgets the other, nothing fails
 * loudly until an edit or an audit hits it:
 *   - positional copies (`SELECT ($1).*`) make the live UPDATE/DELETE fail
 *     ("INSERT has more expressions than target columns": budgets, 0263, 0328)
 *   - hand-written triggers with a column list silently drop the new column
 *   - a history table with no trigger is an audit trail that never fills
 *
 * These checks ask the catalog of a database built from every migration, so a
 * table added later is covered the day it lands. Today's accepted drift is in
 * the KNOWN_* lists below; the test fails on any NEW drift and also when a known
 * item is fixed, so the lists can only shrink.
 *
 * Fixing a failure: add the column to `<table>_history` in the same migration,
 * same position and type, and to any named `yannis_capture_history_insert_*`
 * function for that table (see 0355_history_table_drift.sql).
 *
 * Runs only against TEST_DATABASE_URL (never DATABASE_URL), read-only.
 */
import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const url = process.env['TEST_DATABASE_URL'];

/** History tables that no UPDATE/DELETE trigger writes to. Decide per table, then delete the entry. */
const KNOWN_UNCAPTURED: string[] = [
  'branches',
  'call_logs',
  'cart_abandonments', // written by the public cart.save intake path: do not add a trigger without sign-off
  'cart_order_routing_rules', // history twin is also 3 columns short
  'inventory_levels',
  'message_templates',
  'stock_batches',
  'stock_movements',
];

/** `table.position: live_col -> history_col` rows that do not line up for positional copies. */
const KNOWN_MISALIGNED: string[] = [];

/** `function.column` pairs a named insert trigger leaves out. */
const KNOWN_TRIGGER_GAPS: string[] = [];

/** `history_table.column` still NOT NULL while the live column is nullable. */
const KNOWN_NOT_NULL: string[] = [];

function expectExactly(actual: string[], known: string[], label: string) {
  const added = actual.filter((x) => !known.includes(x)).sort();
  const fixed = known.filter((x) => !actual.includes(x)).sort();
  expect(added, `New ${label}. Fix the migration (see file header).`).toEqual([]);
  expect(fixed, `Fixed ${label}: delete these from the KNOWN list in this test.`).toEqual([]);
}

describe.skipIf(!url)('history table drift', () => {
  const sql = postgres(url ?? '', { max: 1, onnotice: () => {}, ssl: url?.includes('sslmode=require') ? 'require' : false });

  afterAll(async () => {
    await sql.end();
  });

  it('positional history copies line up with their live table', async () => {
    const rows = await sql<{ table_name: string; pos: string; live_col: string | null; history_col: string | null }[]>`
      WITH whole_row AS (
        SELECT DISTINCT c.oid AS live, c.relname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal
          AND p.prosrc LIKE '%\\_history%'
          AND (p.prosrc LIKE '%($1).*%' OR p.prosrc LIKE '%NEW.*%' OR p.prosrc LIKE '%OLD.*%')
      ),
      cols AS (
        SELECT a.attrelid, a.attname, a.atttypid, format_type(a.atttypid, a.atttypmod) AS typ,
               row_number() OVER (PARTITION BY a.attrelid ORDER BY a.attnum) AS pos
        FROM pg_attribute a
        WHERE a.attnum > 0 AND NOT a.attisdropped
      )
      SELECT w.relname AS table_name, lc.pos::text AS pos, lc.attname AS live_col, hc.attname AS history_col
      FROM whole_row w
      LEFT JOIN pg_class h ON h.relname = w.relname || '_history' AND h.relnamespace = 'public'::regnamespace
      LEFT JOIN cols lc ON lc.attrelid = w.live
      LEFT JOIN cols hc ON hc.attrelid = h.oid AND hc.pos = lc.pos
      WHERE h.oid IS NULL OR hc.attname IS NULL OR hc.attname <> lc.attname
         OR (hc.typ <> lc.typ AND NOT (hc.typ = 'text'
             AND EXISTS (SELECT 1 FROM pg_type ty WHERE ty.oid = lc.atttypid AND ty.typtype = 'e')))
    `;
    const actual = rows.map((r) => `${r.table_name}.${r.pos}: ${r.live_col ?? '-'} -> ${r.history_col ?? '-'}`);
    expectExactly(actual, KNOWN_MISALIGNED, 'misaligned history columns');
  });

  it('named insert triggers copy every live column', async () => {
    const rows = await sql<{ function_name: string; missing_column: string }[]>`
      SELECT DISTINCT p.proname AS function_name, a.attname AS missing_column
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE NOT t.tgisinternal
        AND p.prosrc ~ ('INSERT INTO\\s+' || c.relname || '_history\\M')
        AND p.prosrc NOT LIKE '%($1).*%' AND p.prosrc NOT LIKE '%NEW.*%' AND p.prosrc NOT LIKE '%OLD.*%'
        AND p.prosrc !~ ('\\m' || a.attname || '\\M')
    `;
    const actual = rows.map((r) => `${r.function_name}.${r.missing_column}`);
    expectExactly(actual, KNOWN_TRIGGER_GAPS, 'columns missing from a named history trigger');
  });

  it('every history table is written by an UPDATE/DELETE trigger', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class h
      JOIN pg_class c ON h.relname = c.relname || '_history' AND c.relnamespace = h.relnamespace
      WHERE h.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
            AND p.prosrc LIKE '%INSERT INTO%\\_history%'
            AND (t.tgtype::int & 24) <> 0
        )
    `;
    expectExactly(rows.map((r) => r.table_name), KNOWN_UNCAPTURED, 'history tables with no capture trigger');
  });

  it('history twins carry no NOT NULL the live table dropped', async () => {
    const rows = await sql<{ table_name: string; column_name: string }[]>`
      SELECT h.table_name, h.column_name
      FROM information_schema.columns h
      JOIN information_schema.columns l
        ON l.table_schema = 'public' AND l.table_name || '_history' = h.table_name
       AND l.column_name = h.column_name
      WHERE h.table_schema = 'public'
        AND h.table_name LIKE '%\\_history'
        AND h.is_nullable = 'NO'
        AND l.is_nullable = 'YES'
    `;
    expectExactly(rows.map((r) => `${r.table_name}.${r.column_name}`), KNOWN_NOT_NULL, 'NOT NULL history columns');
  });
});
