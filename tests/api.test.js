import request from 'supertest';
import { beforeEach, describe, expect, test, jest } from '@jest/globals';

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const reconcileMock = jest.fn();
const findOneMock = jest.fn();
const reportFindMock = jest.fn();

function createLeanQuery(result) {
  return {
    lean() {
      return Promise.resolve(result);
    },
    sort() {
      return this;
    },
  };
}

await jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

await jest.unstable_mockModule('../src/config/index.js', () => ({
  config: {
    mongodbUri: 'mongodb://127.0.0.1:27017/ledger-lens',
    port: 3000,
    timestampToleranceSeconds: 300,
    quantityTolerancePct: 0.01,
    logLevel: 'info',
  },
}));

await jest.unstable_mockModule('../src/reconciliation/index.js', () => ({
  reconcile: reconcileMock,
  writeReport: jest.fn(),
  generateCsvReport: jest.fn(),
}));

await jest.unstable_mockModule('../src/db/models/index.js', () => ({
  ReconciliationRun: {
    findOne: findOneMock,
  },
  ReconciliationReport: {
    find: reportFindMock,
  },
  UserTransaction: {},
  ExchangeTransaction: {},
  ReconciliationReport: {
    find: reportFindMock,
  },
}));

const { default: app } = await import('../src/api/app.js');

describe('API', () => {
  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    reconcileMock.mockReset();
    findOneMock.mockReset();
    reportFindMock.mockReset();
  });

  test('POST /reconcile accepts defaults and starts background reconciliation', async () => {
    reconcileMock.mockResolvedValue('run-api-1');

    const response = await request(app).post('/reconcile').send({});

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      runId: expect.any(String),
      status: 'pending',
      message: 'Reconciliation started',
    });
    expect(reconcileMock).toHaveBeenCalledWith({
      runId: response.body.runId,
      userPath: expect.stringContaining('data'),
      exchangePath: expect.stringContaining('data'),
      config: {
        timestampToleranceSeconds: 300,
        quantityTolerancePct: 0.01,
      },
    });
    expect(loggerMock.info).toHaveBeenCalledWith(
      'HTTP request',
      expect.objectContaining({ method: 'POST', path: '/reconcile', status: 202 })
    );
  });

  test('POST /reconcile validates the request body', async () => {
    const response = await request(app).post('/reconcile').send({ timestampToleranceSeconds: -1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors.timestampToleranceSeconds).toContain('Number must be greater than 0');
  });

  test('GET /report/:runId returns the run and reports when completed', async () => {
    findOneMock.mockReturnValueOnce(
      createLeanQuery({
        runId: 'run-api-1',
        status: 'completed',
        summary: { matched: 1, conflicting: 0, unmatched_user: 0, unmatched_exchange: 0, total: 1 },
        config: { timestampToleranceSeconds: 300, quantityTolerancePct: 0.01 },
        startedAt: new Date('2024-01-01T10:00:00Z'),
        completedAt: new Date('2024-01-01T10:01:00Z'),
      })
    );
    reportFindMock.mockReturnValueOnce(
      createLeanQuery([
        {
          runId: 'run-api-1',
          category: 'matched',
          reason: null,
          userTx: { transactionId: 'u1' },
          exchangeTx: { transactionId: 'e1' },
          diffDetails: { quantityDiff: 0, timestampDiffSeconds: 1 },
        },
      ])
    );

    const response = await request(app).get('/report/run-api-1');

    expect(response.status).toBe(200);
    expect(response.body.run).toEqual(
      expect.objectContaining({
        runId: 'run-api-1',
        status: 'completed',
      })
    );
    expect(response.body.reports).toHaveLength(1);
  });

  test('GET /report/:runId/summary blocks in-progress runs', async () => {
    findOneMock.mockReturnValueOnce(
      createLeanQuery({
        runId: 'run-api-1',
        status: 'running',
      })
    );

    const response = await request(app).get('/report/run-api-1/summary');

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Run is still in progress');
  });

  test('GET /report/:runId/unmatched filters by source', async () => {
    findOneMock.mockReturnValueOnce(
      createLeanQuery({
        runId: 'run-api-1',
        status: 'completed',
      })
    );
    reportFindMock.mockReturnValueOnce(
      createLeanQuery([
        { runId: 'run-api-1', category: 'unmatched_user', reason: 'missing or invalid timestamp' },
      ])
    );

    const response = await request(app).get('/report/run-api-1/unmatched?source=user');

    expect(response.status).toBe(200);
    expect(response.body.runId).toBe('run-api-1');
    expect(response.body.reports).toEqual([
      expect.objectContaining({ category: 'unmatched_user', reason: 'missing or invalid timestamp' }),
    ]);
  });
});
