import { describe, expect, test } from '@jest/globals';
import { assetAliases } from '../src/matching/assetAliases.js';
import { normaliseAsset, normaliseType } from '../src/matching/normalise.js';

describe('normaliseAsset', () => {
  test('normalises the full alias map to uppercase ticker symbols', () => {
    const cases = Object.entries(assetAliases);

    for (const [input, output] of cases) {
      expect(normaliseAsset(input)).toBe(output.toUpperCase());
      expect(normaliseAsset(`  ${input}  `)).toBe(output.toUpperCase());
    }
  });

  test('uppercases non-aliased assets after trimming', () => {
    expect(normaliseAsset('  btc  ')).toBe('BTC');
    expect(normaliseAsset('eth')).toBe('ETH');
  });
});

describe('normaliseType', () => {
  test('accepts exact type matches', () => {
    expect(normaliseType('BUY', 'BUY')).toEqual({ compatible: true });
    expect(normaliseType('SELL', 'SELL')).toEqual({ compatible: true });
  });

  test('accepts the TRANSFER_IN and TRANSFER_OUT swap in both directions', () => {
    expect(normaliseType('TRANSFER_OUT', 'TRANSFER_IN')).toEqual({ compatible: true });
    expect(normaliseType('TRANSFER_IN', 'TRANSFER_OUT')).toEqual({ compatible: true });
  });

  test('rejects mismatched types with a useful reason', () => {
    expect(normaliseType('BUY', 'SELL')).toEqual({
      compatible: false,
      reason: 'type mismatch: BUY vs SELL',
    });
    expect(normaliseType('TRANSFER_IN', 'BUY')).toEqual({
      compatible: false,
      reason: 'type mismatch: TRANSFER_IN vs BUY',
    });
  });
});
