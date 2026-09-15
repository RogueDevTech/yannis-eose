/**
 * Smart search scoring — the matching engine behind the nav/command search.
 *
 * Plain `String.includes` was the old rule, and it fails the way users
 * actually type: "remitance" (typo) found nothing, "co g s" found nothing,
 * "fo" would not reach "Funding Orders", and a domain word the page does not
 * literally contain ("salary" for Payroll, "staff" for Users) found nothing
 * either.
 *
 * This module is pure and dependency-free so the rules can be unit-tested
 * without mounting a component. It is shared by the sidebar menu filter and
 * the Cmd+K command palette, so both rank identically.
 *
 * Scoring is tiered, not additive-fuzzy: a strong signal (exact, prefix) must
 * always outrank a weak one (subsequence, typo), no matter how many weak
 * signals pile up. Otherwise a page matching four letters loosely would beat
 * the page the user literally typed the name of.
 */

/** Score floor. Anything at or below this is not a match at all. */
export const NO_MATCH = 0;

/* Tier bands. Kept far apart so signals can be blended inside a tier
 * without a lower tier ever crossing into a higher one. */
const TIER_EXACT = 1_000;
const TIER_PREFIX = 800;
const TIER_WORD_PREFIX = 650;
const TIER_ACRONYM = 600;
/**
 * Note for weighted callers: an exact match scaled by a field weight can land
 * inside a lower tier's band on purpose. `route-search` weights the URL slug at
 * 0.45, so an exact slug hit scores 450 — level with a label substring. That is
 * the intended trade (a page found only by its URL should not outrank one found
 * by its visible name), so tier bands are guaranteed to be ordered only WITHIN
 * a single field, not across differently-weighted ones.
 */
const TIER_SUBSTRING = 450;
const TIER_SUBSEQUENCE = 250;
const TIER_FUZZY = 120;

/** Characters that separate words in a label or slug. */
const WORD_SPLIT = /[\s/\-_.,&›»:()[\]]+/;

export function normalize(value: string): string {
  return (
    value
      .toLowerCase()
      // Strip diacritics so "Olasúkanmi" matches "olasukanmi".
      .normalize('NFD')
      // Escaped range (U+0300-U+036F combining marks): the literal characters
    // are invisible in most editors and a non-UTF8 pipe would silently drop them.
    .replace(/[\u0300-\u036f]/g, '')
      .trim()
  );
}

export function tokenize(value: string): string[] {
  return normalize(value).split(WORD_SPLIT).filter(Boolean);
}

/** First letter of each word — "Cash Remittance" → "cr", so "cr" finds it. */
function acronym(words: string[]): string {
  return words.map((w) => w[0] ?? '').join('');
}

/**
 * Levenshtein distance, capped: stops as soon as the best possible remaining
 * distance exceeds `max`. Typo tolerance only ever needs "is it within 1-2
 * edits", so computing the true distance for wildly different strings is
 * wasted work on every keystroke.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowBest = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowBest) rowBest = curr[j]!;
    }
    // Every remaining path goes through this row, so if the whole row is
    // already worse than `max` the answer cannot come back under it.
    if (rowBest > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length]!;
}

/** How many edits a word of this length may be off by. */
function typoBudget(length: number): number {
  if (length <= 3) return 0; // too short — "car"/"cat" are different words
  if (length <= 5) return 1;
  return 2;
}

/**
 * Are all of `needle`'s characters present in `haystack`, in order?
 * Returns a density bonus (0..1) for how tightly packed the match was, so
 * "cogs" scores higher against "COGS" than against "Costs Of Goods Shipped".
 */
function subsequenceDensity(needle: string, haystack: string): number | null {
  if (!needle) return null;
  let h = 0;
  let firstAt = -1;
  let lastAt = -1;
  for (const ch of needle) {
    let found = -1;
    while (h < haystack.length) {
      if (haystack[h] === ch) {
        found = h;
        h++;
        break;
      }
      h++;
    }
    if (found === -1) return null;
    if (firstAt === -1) firstAt = found;
    lastAt = found;
  }
  const span = lastAt - firstAt + 1;
  return needle.length / span;
}

/**
 * Score one query term against one candidate string.
 *
 * `0` means no match. Higher is better. The tier is decided by the strongest
 * signal found; small in-tier bonuses (shorter candidate, earlier position,
 * denser subsequence) only break ties inside that tier.
 */
export function scoreTerm(term: string, candidate: string): number {
  const t = normalize(term);
  const c = normalize(candidate);
  if (!t || !c) return NO_MATCH;

  if (c === t) return TIER_EXACT;
  if (c.startsWith(t)) {
    // A prefix of a short label is a better hit than a prefix of a long one:
    // "ord" should rank "Orders" above "Order Line Price Requests".
    return TIER_PREFIX + Math.round((t.length / c.length) * 100);
  }

  const words = c.split(WORD_SPLIT).filter(Boolean);

  // Any word starting with the term — "analysis" finds "Team Analysis".
  const wordPrefixIndex = words.findIndex((w) => w.startsWith(t));
  if (wordPrefixIndex !== -1) {
    return TIER_WORD_PREFIX + Math.max(0, 40 - wordPrefixIndex * 8);
  }

  // Acronym: "cr" → "Cash Remittance", "hocs" → "Head Of CS".
  if (words.length > 1 && t.length >= 2) {
    const acr = acronym(words);
    if (acr === t) return TIER_ACRONYM + 40;
    if (acr.startsWith(t)) return TIER_ACRONYM;
  }

  const at = c.indexOf(t);
  if (at !== -1) return TIER_SUBSTRING + Math.max(0, 30 - at);

  // Typo tolerance, per word first (cheap, and the common case: one misspelled
  // word inside a multi-word label) then against the whole string.
  const budget = typoBudget(t.length);
  if (budget > 0) {
    for (const w of words) {
      // Only compare words of a plausible length — "remitance" vs "cash" is noise.
      if (Math.abs(w.length - t.length) > budget) continue;
      const d = boundedEditDistance(t, w, budget);
      if (d <= budget) return TIER_FUZZY + (budget - d) * 40;
    }
    if (words.length === 1 && Math.abs(c.length - t.length) <= budget) {
      const d = boundedEditDistance(t, c, budget);
      if (d <= budget) return TIER_FUZZY + (budget - d) * 40;
    }
  }

  // Last resort: in-order character subsequence ("fnord" → "Funnel Orders").
  // Require 3+ chars so one or two letters don't match everything.
  if (t.length >= 3) {
    const density = subsequenceDensity(t, c);
    if (density !== null) return TIER_SUBSEQUENCE + Math.round(density * 80);
  }

  return NO_MATCH;
}

/** A weighted field on a candidate — label, group name, keyword, href slug… */
export interface SearchField {
  text: string;
  /** Multiplies this field's score. Label 1, group 0.75, keywords 0.7, path 0.5. */
  weight: number;
}

/**
 * Score a whole query (possibly several words) against a candidate's fields.
 *
 * EVERY query term must hit SOME field, so "team analysis" does not match a
 * page that only knows about "team". This is what makes multi-word queries
 * narrow the result set the way people expect, in any word order.
 */
export function scoreFields(query: string, fields: SearchField[]): number {
  const terms = tokenize(query);
  if (!terms.length) return NO_MATCH;

  let total = 0;
  for (const term of terms) {
    let best = NO_MATCH;
    for (const field of fields) {
      if (!field.text) continue;
      const s = scoreTerm(term, field.text) * field.weight;
      if (s > best) best = s;
    }
    if (best <= NO_MATCH) return NO_MATCH; // one unmatched term disqualifies
    total += best;
  }
  // Average, so a two-word query is not scored twice as high as a one-word one
  // and the two can be ranked in the same list.
  return total / terms.length;
}
