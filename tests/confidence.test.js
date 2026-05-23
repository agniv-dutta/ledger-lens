import { describe, expect, test } from '@jest/globals';
import { computeConfidence } from '../src/matching/confidence.js';

describe('computeConfidence', () => {
  test('returns 100 for a perfect match', () => {
    expect(
      computeConfidence({
        timestampDiffSeconds: 0,
        quantityDiffPct: 0,
        typeSwapped: false,
        assetAliased: false,
      })
    ).toBe(100);
  });

  test('returns 30 at maximum timestamp and quantity drift', () => {
    expect(
      computeConfidence({
        timestampDiffSeconds: 300,
        quantityDiffPct: 1,
        typeSwapped: false,
        assetAliased: false,
      })
    ).toBe(30);
  });

  test('applies combined deductions for swap and alias resolution', () => {
    expect(
      computeConfidence({
        timestampDiffSeconds: 150,
        quantityDiffPct: 0.5,
        typeSwapped: true,
        assetAliased: true,
      })
    ).toBe(50);
  });
});
