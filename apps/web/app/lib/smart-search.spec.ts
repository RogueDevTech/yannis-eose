import { describe, it, expect } from 'vitest';
import { NO_MATCH, scoreTerm, scoreFields, boundedEditDistance, tokenize, normalize } from './smart-search';

describe('normalize / tokenize', () => {
  it('strips diacritics so accented names match plain typing', () => {
    expect(normalize('Olasúkanmi')).toBe('olasukanmi');
  });

  it('splits on every word separator we use in labels and paths', () => {
    expect(tokenize('Cash Remittance / Payroll-Batch')).toEqual([
      'cash', 'remittance', 'payroll', 'batch',
    ]);
  });
});

describe('boundedEditDistance', () => {
  it('returns the real distance inside the bound', () => {
    expect(boundedEditDistance('remitance', 'remittance', 2)).toBe(1);
  });

  it('bails out above the bound instead of computing the true distance', () => {
    expect(boundedEditDistance('aaaa', 'zzzzzzzzzz', 2)).toBeGreaterThan(2);
  });
});

describe('scoreTerm tiers', () => {
  // The core invariant: a stronger signal always outranks a weaker one.
  it('ranks exact > prefix > word-prefix > acronym > substring > subsequence > typo', () => {
    const exact = scoreTerm('orders', 'Orders');
    const prefix = scoreTerm('ord', 'Orders');
    const wordPrefix = scoreTerm('analysis', 'Team Analysis');
    const acr = scoreTerm('cr', 'Cash Remittance');
    const substring = scoreTerm('mitt', 'Cash Remittance');
    const subseq = scoreTerm('fnord', 'Funnel Orders');
    const typo = scoreTerm('remitance', 'Remittance');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(acr);
    expect(acr).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(NO_MATCH);
  });

  it('prefers a prefix of a short label over a prefix of a long one', () => {
    expect(scoreTerm('ord', 'Orders')).toBeGreaterThan(
      scoreTerm('ord', 'Order Line Price Requests'),
    );
  });

  it('matches an acronym of a multi-word label', () => {
    expect(scoreTerm('hocs', 'Head Of CS')).toBeGreaterThan(NO_MATCH);
    // A single word has no acronym to match.
    expect(scoreTerm('od', 'Orders')).toBe(NO_MATCH);
  });

  it('tolerates a typo in one word of a multi-word label', () => {
    expect(scoreTerm('remitance', 'Cash Remittance')).toBeGreaterThan(NO_MATCH);
    expect(scoreTerm('payrol', 'Payroll Batches')).toBeGreaterThan(NO_MATCH);
  });

  it('does NOT typo-match words too short to be unambiguous', () => {
    // 3 chars or fewer get no typo budget: "car" must not find "Cart".
    expect(scoreTerm('car', 'Cat')).toBe(NO_MATCH);
  });

  it('requires 3+ characters before falling back to subsequence', () => {
    // "ul" is a subsequence of "Funnel" but too short to be meaningful — two
    // letters would otherwise match almost every page in the nav.
    expect(scoreTerm('ul', 'Funnel')).toBe(NO_MATCH);
    expect(scoreTerm('unl', 'Funnel')).toBeGreaterThan(NO_MATCH);
  });

  it('treats initials of a multi-word label as an acronym, not a subsequence', () => {
    // "fo" is the acronym of "Funnel Orders", so it is a strong hit even
    // though it is only two characters.
    expect(scoreTerm('fo', 'Funnel Orders')).toBeGreaterThan(
      scoreTerm('fnord', 'Funnel Orders'),
    );
  });

  it('scores a dense subsequence above a scattered one', () => {
    expect(scoreTerm('cogs', 'COGS')).toBeGreaterThan(
      scoreTerm('cogs', 'Costs Of Goods Shipped'),
    );
  });

  it('is not a match for unrelated text', () => {
    expect(scoreTerm('zzzz', 'Cash Remittance')).toBe(NO_MATCH);
  });
});

describe('scoreFields', () => {
  const fields = [
    { text: 'Payroll', weight: 1 },
    { text: 'HR', weight: 0.7 },
    { text: 'salary wages', weight: 0.78 },
  ];

  it('finds a page by a keyword it does not display', () => {
    expect(scoreFields('salary', fields)).toBeGreaterThan(NO_MATCH);
  });

  it('weights the label above a keyword for the same strength of match', () => {
    const byLabel = scoreFields('payroll', fields);
    const byKeyword = scoreFields('salary', fields);
    expect(byLabel).toBeGreaterThan(byKeyword);
  });

  // This is what makes multi-word queries narrow rather than widen.
  it('requires EVERY query term to match some field', () => {
    expect(scoreFields('payroll hr', fields)).toBeGreaterThan(NO_MATCH);
    expect(scoreFields('payroll zzzz', fields)).toBe(NO_MATCH);
  });

  it('matches terms in any order', () => {
    expect(scoreFields('hr payroll', fields)).toBe(scoreFields('payroll hr', fields));
  });

  it('averages rather than sums, so 1-word and 2-word queries rank comparably', () => {
    // Two perfect terms should not score double a single perfect term.
    const one = scoreFields('payroll', [{ text: 'Payroll', weight: 1 }]);
    const two = scoreFields('cash remittance', [
      { text: 'cash', weight: 1 },
      { text: 'remittance', weight: 1 },
    ]);
    expect(two).toBeCloseTo(one, 5);
  });

  it('returns no match for an empty query', () => {
    expect(scoreFields('   ', fields)).toBe(NO_MATCH);
  });
});
