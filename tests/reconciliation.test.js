import { jest, describe, expect, test, beforeEach } from '@jest/globals';

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const ingestFilesMock = jest.fn();
const runMatchingMock = jest.fn();
const writeReportMock = jest.fn();

const reconciliationRunCreate = jest.fn();
const reconciliationRunUpdateOne = jest.fn();
const reconciliationReportInsertMany = jest.fn();
const reconciliationReportFind = jest.fn();

await jest.unstable_mockModule('node:crypto', () => ({
  randomUUID: jest.fn(() => 'run-uuid-1'),
}));

await jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

await jest.unstable_mockModule('../src/ingestion/index.js', () => ({
  ingestFiles: ingestFilesMock,
}));

await jest.unstable_mockModule('../src/matching/matcher.js', () => ({
  runMatching: runMatchingMock,
}));

await jest.unstable_mockModule('../src/db/models/index.js', () => ({
  ReconciliationRun: {
    create: reconciliationRunCreate,
    updateOne: reconciliationRunUpdateOne,
  },
  ReconciliationReport: {
    insertMany: reconciliationReportInsertMany,
    find: reconciliationReportFind,
  },
  UserTransaction: {},
  ExchangeTransaction: {},
}));

const { writeReport } = await import('../src/reconciliation/reportWriter.js');
const { generateCsvReport, reconcile } = await import('../src/reconciliation/runner.js');

describe('writeReport', () => {
  beforeEach(() => {
    reconciliationReportInsertMany.mockReset();
    reconciliationRunUpdateOne.mockReset();
  });

  test('inserts report rows and completes the run summary', async () => {
    const results = [
      { category: 'matched', userTx: { transactionId: 'u1' }, exchangeTx: { transactionId: 'e1' }, reason: null, diffDetails: { quantityDiff: 0, timestampDiffSeconds: 2 } },
      { category: 'conflicting', userTx: { transactionId: 'u2' }, exchangeTx: { transactionId: 'e2' }, reason: 'quantity diff exceeds tolerance', diffDetails: { quantityDiff: 1, timestampDiffSeconds: 4 } },
      { category: 'unmatched_user', userTx: { transactionId: 'u3' }, exchangeTx: null, reason: 'no eligible match found', diffDetails: null },
      { category: 'unmatched_exchange', userTx: null, exchangeTx: { transactionId: 'e4' }, reason: 'no eligible match found', diffDetails: null },
    ];

    const summary = await writeReport({ runId: 'run-uuid-1', results });

    expect(reconciliationReportInsertMany).toHaveBeenCalledWith(
      [
        {
          runId: 'run-uuid-1',
          category: 'matched',
          userTx: results[0].userTx,
          exchangeTx: results[0].exchangeTx,
          reason: null,
          diffDetails: results[0].diffDetails,
        },
        {
          runId: 'run-uuid-1',
          category: 'conflicting',
          userTx: results[1].userTx,
          exchangeTx: results[1].exchangeTx,
          reason: 'quantity diff exceeds tolerance',
          diffDetails: results[1].diffDetails,
        },
        {
          runId: 'run-uuid-1',
          category: 'unmatched_user',
          userTx: results[2].userTx,
          exchangeTx: null,
          reason: 'no eligible match found',
          diffDetails: null,
        },
        {
          runId: 'run-uuid-1',
          category: 'unmatched_exchange',
          userTx: null,
          exchangeTx: results[3].exchangeTx,
          reason: 'no eligible match found',
          diffDetails: null,
        },
      ],
      { ordered: false }
    );

    expect(reconciliationRunUpdateOne).toHaveBeenCalledWith(
      { runId: 'run-uuid-1' },
      {
        $set: {
          status: 'completed',
          completedAt: expect.any(Date),
          summary: {
            matched: 1,
            conflicting: 1,
            unmatched_user: 1,
            unmatched_exchange: 1,
            total: 4,
          },
        },
      }
    );

    expect(summary).toEqual({
      matched: 1,
      conflicting: 1,
      unmatched_user: 1,
      unmatched_exchange: 1,
      total: 4,
    });
  });
});

describe('reconcile', () => {
  beforeEach(() => {
    ingestFilesMock.mockReset();
    runMatchingMock.mockReset();
    writeReportMock.mockReset();
    reconciliationRunCreate.mockReset();
    reconciliationRunUpdateOne.mockReset();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
  });

  test('runs the pipeline in sequence and returns the run id', async () => {
    ingestFilesMock.mockResolvedValue({ userCount: 1, exchangeCount: 1, flaggedRows: [] });
    runMatchingMock.mockResolvedValue([{ category: 'matched' }]);
    writeReportMock.mockResolvedValue({ matched: 1, conflicting: 0, unmatched_user: 0, unmatched_exchange: 0, total: 1 });

    const runId = await reconcile({
      userPath: 'user.csv',
      exchangePath: 'exchange.csv',
      config: { timestampToleranceSeconds: 300, quantityTolerancePct: 0.01 },
    });

    expect(runId).toBe('run-uuid-1');
    expect(reconciliationRunCreate).toHaveBeenCalledWith({
      runId: 'run-uuid-1',
      status: 'pending',
      config: { timestampToleranceSeconds: 300, quantityTolerancePct: 0.01 },
      startedAt: expect.any(Date),
    });
    expect(ingestFilesMock).toHaveBeenCalledWith({ userPath: 'user.csv', exchangePath: 'exchange.csv', runId: 'run-uuid-1' });
    expect(runMatchingMock).toHaveBeenCalledWith({ runId: 'run-uuid-1', config: { timestampToleranceSeconds: 300, quantityTolerancePct: 0.01 } });
    expect(writeReportMock).not.toHaveBeenCalled();
    expect(reconciliationRunUpdateOne).toHaveBeenCalledWith({ runId: 'run-uuid-1' }, { $set: { status: 'running' } });
  });

  test('marks the run as failed when matching throws', async () => {
    ingestFilesMock.mockResolvedValue({ userCount: 1, exchangeCount: 1, flaggedRows: [] });
    runMatchingMock.mockRejectedValue(new Error('matching exploded'));

    await expect(
      reconcile({
        userPath: 'user.csv',
        exchangePath: 'exchange.csv',
        config: { timestampToleranceSeconds: 300, quantityTolerancePct: 0.01 },
      })
    ).rejects.toThrow('matching exploded');

    expect(reconciliationRunUpdateOne).toHaveBeenCalledWith(
      { runId: 'run-uuid-1' },
      {
        $set: {
          status: 'failed',
          error: 'matching exploded',
        },
      }
    );
  });
});

describe('generateCsvReport', () => {
  beforeEach(() => {
    reconciliationReportFind.mockReset();
  });

  test('serialises reconciliation reports to csv', async () => {
    reconciliationReportFind.mockReturnValue({
      sort() {
        return this;
      },
      lean() {
        return Promise.resolve([
          {
            category: 'matched',
            reason: null,
            userTx: {
              transactionId: 'u1',
              timestamp: new Date('2024-01-01T10:00:00Z'),
              type: 'BUY',
              asset: 'BTC',
              quantity: 1,
            },
            exchangeTx: {
              transactionId: 'e1',
              timestamp: new Date('2024-01-01T10:00:10Z'),
              type: 'BUY',
              asset: 'BTC',
              quantity: 1,
            },
            diffDetails: { quantityDiff: 0, timestampDiffSeconds: 10 },
          },
        ]);
      },
    });

    const csv = await generateCsvReport('run-uuid-1');

    expect(csv).toBe(
      [
        'category,reason,user_transaction_id,user_timestamp,user_type,user_asset,user_quantity,exchange_transaction_id,exchange_timestamp,exchange_type,exchange_asset,exchange_quantity,diff_quantity,diff_seconds',
        'matched,,u1,2024-01-01T10:00:00.000Z,BUY,BTC,1,e1,2024-01-01T10:00:10.000Z,BUY,BTC,1,0,10',
      ].join('\n')
    );
  });
});
