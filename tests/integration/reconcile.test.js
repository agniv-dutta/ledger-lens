import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, expect, test } from '@jest/globals';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectToDatabase } from '../../src/db/connection.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const projectRootPath = path.resolve(currentDirPath, '..', '..');
const dataDirPath = path.join(projectRootPath, 'data');

dotenv.config({ path: path.join(projectRootPath, '.env.test') });

const userCsvPath = path.join(dataDirPath, 'user.csv');
const exchangeCsvPath = path.join(dataDirPath, 'exchange.csv');
let app;
let mongoServer;
let ReconciliationReport;
let ReconciliationRun;
let UserTransaction;
let ExchangeTransaction;
let testMongoUri;
let MongoMemoryServer;
let memoryServerAvailable = false;

try {
  ({ MongoMemoryServer } = await import('mongodb-memory-server'));
  memoryServerAvailable = true;
} catch {
  memoryServerAvailable = false;
}

const hasMongoUri = Boolean(process.env.MONGODB_URI || process.env.TEST_MONGODB_URI);
const runIntegrationSuite = hasMongoUri || memoryServerAvailable ? describe : describe.skip;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCompletedRun(runId, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await request(app).get(`/report/${runId}/summary`);

    if (response.status === 200 && response.body.status === 'completed') {
      return response.body;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for run ${runId} to complete`);
}

beforeAll(async () => {
  if (!hasMongoUri) {
    try {
      mongoServer = await MongoMemoryServer.create();
      testMongoUri = mongoServer.getUri('ledger-lens-test');
      process.env.MONGODB_URI = testMongoUri;
    } catch {
      throw new Error('Set MONGODB_URI in .env.test or install mongodb-memory-server for the integration test.');
    }
  } else {
    testMongoUri = process.env.MONGODB_URI || process.env.TEST_MONGODB_URI;
  }

  if (mongoose.connection.readyState !== 1) {
    await connectToDatabase(testMongoUri);
  }

  ({ default: app } = await import('../../src/api/app.js'));
  ({ ReconciliationReport, ReconciliationRun, UserTransaction, ExchangeTransaction } = await import('../../src/db/models/index.js'));
});

beforeEach(async () => {
  await Promise.all([
    UserTransaction.deleteMany({}),
    ExchangeTransaction.deleteMany({}),
    ReconciliationReport.deleteMany({}),
    ReconciliationRun.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();

  if (mongoServer) {
    await mongoServer.stop();
  }
});

runIntegrationSuite('POST /reconcile integration', () => {
  test('reconciles the sample CSVs and exposes the expected report data', async () => {
    const postResponse = await request(app)
      .post('/reconcile')
      .send({
        quantityTolerancePct: 0.0001,
        userFilePath: userCsvPath,
        exchangeFilePath: exchangeCsvPath,
      });

    expect(postResponse.status).toBe(202);
    expect(postResponse.body).toEqual({
      runId: expect.any(String),
      status: 'pending',
      message: 'Reconciliation started',
    });

    const runId = postResponse.body.runId;
    const summary = await waitForCompletedRun(runId, 15000);

    expect(summary.status).toBe('completed');
    expect(summary.summary.matched).toBeGreaterThanOrEqual(15);
    expect(summary.summary.conflicting).toBeGreaterThanOrEqual(1);
    expect(summary.summary.unmatched_exchange).toBe(2);

    const reportResponse = await request(app).get(`/report/${runId}`);
    expect(reportResponse.status).toBe(200);

    const reports = reportResponse.body.reports;
    const unmatchedUserReports = reports.filter((report) => report.category === 'unmatched_user');
    const unmatchedExchangeReports = reports.filter((report) => report.category === 'unmatched_exchange');

    const conflictingReport = reports.find(
      (report) => report.userTx?.transactionId === 'USR-012' && report.exchangeTx?.transactionId === 'EXC-1012'
    );
    const malformedTimestampReport = unmatchedUserReports.find((report) => report.userTx?.transactionId === 'USR-018');
    const negativeQuantityReport = unmatchedUserReports.find((report) => report.userTx?.transactionId === 'USR-019');
    const duplicateReports = reports.filter((report) => report.userTx?.transactionId === 'USR-001');

    expect(conflictingReport).toBeDefined();
    expect(conflictingReport.reason).toContain('quantity diff exceeds tolerance');

    expect(unmatchedExchangeReports).toHaveLength(2);
    expect(unmatchedExchangeReports.map((report) => report.exchangeTx?.transactionId).sort()).toEqual(['EXC-1024', 'EXC-1025']);

    expect(malformedTimestampReport).toBeDefined();
    expect(malformedTimestampReport.reason.toLowerCase()).toContain('timestamp');

    expect(negativeQuantityReport).toBeDefined();
    expect(negativeQuantityReport.reason.toLowerCase()).toContain('negative');

    expect(duplicateReports).toHaveLength(1);
    expect(duplicateReports[0].reason).toContain('Duplicate transactionId within source');
  }, 20000);
});
