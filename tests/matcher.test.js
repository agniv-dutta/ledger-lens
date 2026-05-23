import { jest, describe, expect, test, beforeEach } from '@jest/globals';

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const userFind = jest.fn();
const exchangeFind = jest.fn();

function createQuery(results) {
  return {
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(results);
    },
  };
}

await jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

await jest.unstable_mockModule('../src/db/models/index.js', () => ({
  UserTransaction: {
    find: userFind,
  },
  ExchangeTransaction: {
    find: exchangeFind,
  },
  ReconciliationRun: {},
  ReconciliationReport: {},
}));

const { runMatching } = await import('../src/matching/matcher.js');

describe('runMatching', () => {
  beforeEach(() => {
    userFind.mockReset();
    exchangeFind.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
  });

  test('greedily matches, flags, and reports unmatched rows', async () => {
    const userRows = [
      {
        _id: 'u4',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'u4',
        timestamp: new Date('2024-01-01T12:00:00Z'),
        type: 'BUY',
        asset: 'ADA',
        quantity: 1,
      },
      {
        _id: 'u1',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'u1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        type: 'BUY',
        asset: 'BTC',
        quantity: 1,
      },
      {
        _id: 'u2',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'u2',
        timestamp: new Date('2024-01-01T10:05:00Z'),
        type: 'SELL',
        asset: 'ETH',
        quantity: 2,
      },
      {
        _id: 'u3',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'u3',
        timestamp: new Date('2024-01-01T11:00:00Z'),
        type: 'TRANSFER_IN',
        asset: 'SOL',
        quantity: 5,
      },
    ];

    const exchangeRows = [
      {
        _id: 'e1',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'e1',
        timestamp: new Date('2024-01-01T10:00:10Z'),
        type: 'BUY',
        asset: 'bitcoin',
        quantity: 1.1,
      },
      {
        _id: 'e2',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'e2',
        timestamp: new Date('2024-01-01T10:00:20Z'),
        type: 'BUY',
        asset: 'BTC',
        quantity: 1.01,
      },
      {
        _id: 'e3',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'e3',
        timestamp: new Date('2024-01-01T10:05:15Z'),
        type: 'SELL',
        asset: 'ETH',
        quantity: 3,
      },
      {
        _id: 'e4',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'e4',
        timestamp: new Date('2024-01-01T11:00:05Z'),
        type: 'TRANSFER_OUT',
        asset: 'SOL',
        quantity: 5,
      },
      {
        _id: 'e5',
        runId: 'run-1',
        qualityFlag: false,
        transactionId: 'e5',
        timestamp: new Date('2024-01-01T13:00:00Z'),
        type: 'BUY',
        asset: 'LTC',
        quantity: 1,
      },
    ];

    const flaggedUsers = [
      {
        _id: 'uf1',
        runId: 'run-1',
        qualityFlag: true,
        transactionId: 'uf1',
        timestamp: null,
        type: 'BUY',
        asset: 'XRP',
        quantity: 1,
        qualityReason: 'bad timestamp',
      },
    ];

    const flaggedExchanges = [
      {
        _id: 'ef1',
        runId: 'run-1',
        qualityFlag: true,
        transactionId: 'ef1',
        timestamp: new Date('2024-01-01T14:00:00Z'),
        type: 'SELL',
        asset: 'MATIC',
        quantity: 2,
        qualityReason: 'duplicate id',
      },
    ];

    userFind.mockImplementation((filter) => createQuery(filter.qualityFlag === true ? flaggedUsers : userRows));
    exchangeFind.mockImplementation((filter) => createQuery(filter.qualityFlag === true ? flaggedExchanges : exchangeRows));

    const results = await runMatching({
      runId: 'run-1',
      config: {
        timestampToleranceSeconds: 60,
        quantityTolerancePct: 0.01,
      },
    });

    const matched = results.find((entry) => entry.category === 'matched');
    const conflicting = results.find((entry) => entry.category === 'conflicting');
    const unmatchedUser = results.find((entry) => entry.category === 'unmatched_user' && entry.userTx?.transactionId === 'u4');
    const unmatchedExchange = results.find((entry) => entry.category === 'unmatched_exchange' && entry.exchangeTx?.transactionId === 'e5');
    const flaggedUser = results.find((entry) => entry.category === 'unmatched_user' && entry.userTx?.transactionId === 'uf1');
    const flaggedExchange = results.find((entry) => entry.category === 'unmatched_exchange' && entry.exchangeTx?.transactionId === 'ef1');

    expect(results).toHaveLength(8);
    expect(matched.exchangeTx.transactionId).toBe('e2');
    expect(matched.userTx.transactionId).toBe('u1');
    expect(matched.exchangeTx.asset).toBe('BTC');
    expect(conflicting.userTx.transactionId).toBe('u2');
    expect(conflicting.exchangeTx.transactionId).toBe('e3');
    expect(conflicting.reason).toContain('quantity diff exceeds tolerance');
    expect(matched.confidenceScore).toBe(50);
    expect(conflicting.confidenceScore).toBe(53);
    expect(unmatchedUser.reason).toBe('no eligible match found');
    expect(unmatchedExchange.reason).toBe('no eligible match found');
    expect(flaggedUser.reason).toBe('flagged during ingestion: bad timestamp');
    expect(flaggedExchange.reason).toBe('flagged during ingestion: duplicate id');
    expect(results.find((entry) => entry.userTx?.transactionId === 'u3').exchangeTx.transactionId).toBe('e4');
  });
});
