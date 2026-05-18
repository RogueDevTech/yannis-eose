/**
 * When a list search box receives a full UUID string, prefer `column = uuid` over
 * `ILIKE '%uuid%'` so PostgreSQL can use the primary-key / btree indexes.
 */
const UUID_V4_OR_V7_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function trimmedSearchLooksLikeUuid(raw: string | undefined): boolean {
  const t = raw?.trim();
  if (!t) return false;
  return UUID_V4_OR_V7_SHAPE.test(t);
}
