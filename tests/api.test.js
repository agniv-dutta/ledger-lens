import request from 'supertest';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, test, jest } from '@jest/globals';

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const reconcileMock = jest.fn();
const findOneMock = jest.fn();
const countDocumentsMock = jest.fn();
const runsFindMock = jest.fn();
const reportFindMock = jest.fn();

function createLeanQuery(result) {
  return {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    sort() {
      return this;
    },
  };
}

function createCursorQuery(result) {
  return {
    lean() {
      return this;
    },
    sort() {
      return this;
    },
    cursor() {
      return Readable.from(result, { objectMode: true });
    },
  };
}

function createRunsQuery(result) {
  return {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    skip() {
      return this;
    },
    limit() {
      return this;
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
    countDocuments: countDocumentsMock,
    find: runsFindMock,
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
    countDocumentsMock.mockReset();
    runsFindMock.mockReset();
    reportFindMock.mockReset();
    global.fetch = jest.fn();
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

  test('GET /health reports service status and uptime', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.uptime).toEqual(expect.any(Number));
  });

  test('POST /reconcile validates the request body', async () => {
    const response = await request(app).post('/reconcile').send({ timestampToleranceSeconds: -1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors.timestampToleranceSeconds).toContain('Number must be greater than 0');
  });

  test('POST /reconcile validates webhook URLs as https only', async () => {
    const response = await request(app).post('/reconcile').send({ webhookUrl: 'http://example.com/webhook' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors.webhookUrl[0]).toContain('webhookUrl must be a valid https URL');
  });

  test('POST /reconcile sends a webhook after completion', async () => {
    reconcileMock.mockResolvedValue('run-api-1');
    findOneMock.mockReturnValueOnce(
      createLeanQuery({
        runId: 'run-api-1',
        status: 'completed',
        summary: { matched: 1, conflicting: 0, unmatched_user: 0, unmatched_exchange: 0, total: 1 },
      })
    );
    global.fetch.mockResolvedValue({ ok: true, status: 200 });

    const response = await request(app).post('/reconcile').send({ webhookUrl: 'https://example.com/webhook' });

    await new Promise((resolve) => setImmediate(resolve));

    expect(response.status).toBe(202);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: response.body.runId,
          status: 'completed',
          summary: { matched: 1, conflicting: 0, unmatched_user: 0, unmatched_exchange: 0, total: 1 },
        }),
      })
    );
  });

  test('POST /reconcile logs webhook failures without failing the run', async () => {
    reconcileMock.mockResolvedValue('run-api-1');
    findOneMock.mockReturnValueOnce(
      createLeanQuery({
        runId: 'run-api-1',
        status: 'completed',
        summary: { matched: 1, conflicting: 0, unmatched_user: 0, unmatched_exchange: 0, total: 1 },
      })
    );
    global.fetch.mockRejectedValueOnce(new Error('webhook down'));

    const response = await request(app).post('/reconcile').send({ webhookUrl: 'https://example.com/webhook' });

    await new Promise((resolve) => setImmediate(resolve));

    expect(response.status).toBe(202);
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Webhook delivery failed',
      expect.objectContaining({
        runId: response.body.runId,
        webhookUrl: 'https://example.com/webhook',
      })
    );
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
          confidenceScore: 94,
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
    expect(response.body.reports[0].confidenceScore).toBe(94);
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

  test('GET /report/:runId/export streams the csv report', async () => {
    findOneMock.mockReturnValueOnce(
      createLeanQuery({
        runId: 'run-api-1',
        status: 'completed',
      })
    );
    reportFindMock.mockReturnValueOnce(
      createCursorQuery([
        {
          category: 'matched',
          reason: null,
          confidenceScore: 88,
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
      ])
    );

    const response = await request(app).get('/report/run-api-1/export');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv');
    expect(response.headers['content-disposition']).toBe('attachment; filename="reconciliation-run-api-1.csv"');
    expect(response.text).toBe(
      [
        'category,reason,user_transaction_id,user_timestamp,user_type,user_asset,user_quantity,exchange_transaction_id,exchange_timestamp,exchange_type,exchange_asset,exchange_quantity,diff_quantity,diff_seconds,confidence_score',
        'matched,,u1,2024-01-01T10:00:00.000Z,BUY,BTC,1,e1,2024-01-01T10:00:10.000Z,BUY,BTC,1,0,10,88',
      ].join('\n') + '\n'
    );
  });

  test('GET /runs returns a paginated list of runs', async () => {
    countDocumentsMock.mockResolvedValueOnce(3);
    runsFindMock.mockReturnValueOnce(
      createRunsQuery([
        {
          runId: 'run-api-1',
          status: 'completed',
          summary: { matched: 1 },
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:01:00Z'),
        },
      ])
    );

    const response = await request(app).get('/runs?page=2&limit=5&status=completed');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 3,
      page: 2,
      limit: 5,
      runs: [
        expect.objectContaining({
          runId: 'run-api-1',
          status: 'completed',
          summary: { matched: 1 },
        }),
      ],
    });
  });
});
