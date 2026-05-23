import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReconciliationReport, ReconciliationRun } from '../db/models/index.js';
import { ingestFiles } from '../ingestion/index.js';
import { runMatching } from '../matching/matcher.js';
import { logger } from '../utils/logger.js';
import { writeReport } from './reportWriter.js';

export const CSV_COLUMNS = [
  'category',
  'reason',
  'user_transaction_id',
  'user_timestamp',
  'user_type',
  'user_asset',
  'user_quantity',
  'exchange_transaction_id',
  'exchange_timestamp',
  'exchange_type',
  'exchange_asset',
  'exchange_quantity',
  'diff_quantity',
  'diff_seconds',
  'confidence_score',
];

/**
 * Measure and log a reconciliation stage.
 * @param {string} runId - The reconciliation run identifier.
 * @param {string} stageName - The stage name being executed.
 * @param {Function} stageFn - The async function to execute.
 * @returns {Promise<*>} The stage result.
 */
async function runStage(runId, stageName, stageFn) {
  const startedAt = Date.now();
  logger.info(`Stage started: ${stageName}`, { runId, stage: stageName });

  try {
    const result = await stageFn();
    const durationMs = Date.now() - startedAt;
    logger.info(`Stage completed: ${stageName}`, { runId, stage: stageName, durationMs });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.error(`Stage failed: ${stageName}`, { runId, stage: stageName, durationMs, error });
    throw error;
  }
}

/**
 * Create a new reconciliation run record.
 * @param {string} runId - The reconciliation run identifier.
 * @param {object} config - The matching configuration snapshot.
 * @returns {Promise<void>}
 */
async function createRun(runId, config) {
  await ReconciliationRun.create({
    runId,
    status: 'pending',
    config,
    startedAt: new Date(),
  });
}

/**
 * Update a run as failed and store the error message.
 * @param {string} runId - The reconciliation run identifier.
 * @param {unknown} error - The error that caused failure.
 * @returns {Promise<void>}
 */
async function markRunFailed(runId, error) {
  await ReconciliationRun.updateOne(
    { runId },
    {
      $set: {
        status: 'failed',
        error: String(error instanceof Error ? error.message : error),
      },
    }
  );
}

/**
 * Orchestrate ingestion, matching, and report generation for a reconciliation run.
 * @param {object} params - The reconciliation parameters.
 * @param {string} params.userPath - Path to the user CSV.
 * @param {string} params.exchangePath - Path to the exchange CSV.
 * @param {object} params.config - Matching tolerances.
 * @param {string} [params.runId] - Optional pre-generated reconciliation run identifier.
 * @returns {Promise<string>} The generated run identifier.
 */
export async function reconcile({ userPath, exchangePath, config, runId: providedRunId }) {
  const runId = providedRunId ?? randomUUID();

  await createRun(runId, config);
  await ReconciliationRun.updateOne(
    { runId },
    {
      $set: {
        status: 'running',
      },
    }
  );

  try {
    await runStage(runId, 'ingestFiles', () => ingestFiles({ userPath, exchangePath, runId }));

    const results = await runStage(runId, 'runMatching', () => runMatching({ runId, config }));

    await runStage(runId, 'writeReport', () => writeReport({ runId, results }));

    return runId;
  } catch (error) {
    await markRunFailed(runId, error);
    throw error;
  }
}

/**
 * Escape a CSV cell value.
 * @param {unknown} value - The value to escape.
 * @returns {string} The escaped CSV cell content.
 */
function escapeCsvCell(value) {
  if (value == null) {
    return '';
  }

  const stringValue = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Flatten a reconciliation report document into CSV row fields.
 * @param {object} report - The reconciliation report document.
 * @returns {object} The flattened row.
 */
function toCsvRow(report) {
  return {
    category: report.category,
    reason: report.reason ?? '',
    user_transaction_id: report.userTx?.transactionId ?? '',
    user_timestamp: report.userTx?.timestamp ? new Date(report.userTx.timestamp).toISOString() : '',
    user_type: report.userTx?.type ?? '',
    user_asset: report.userTx?.asset ?? '',
    user_quantity: report.userTx?.quantity ?? '',
    exchange_transaction_id: report.exchangeTx?.transactionId ?? '',
    exchange_timestamp: report.exchangeTx?.timestamp ? new Date(report.exchangeTx.timestamp).toISOString() : '',
    exchange_type: report.exchangeTx?.type ?? '',
    exchange_asset: report.exchangeTx?.asset ?? '',
    exchange_quantity: report.exchangeTx?.quantity ?? '',
    diff_quantity: report.diffDetails?.quantityDiff ?? '',
    diff_seconds: report.diffDetails?.timestampDiffSeconds ?? '',
    confidence_score: report.confidenceScore ?? '',
  };
}

/**
 * Format a reconciliation report row as CSV.
 * @param {object} report - The reconciliation report document.
 * @returns {string} The escaped CSV row.
 */
function formatCsvRow(report) {
  const row = toCsvRow(report);
  return CSV_COLUMNS.map((column) => escapeCsvCell(row[column])).join(',');
}

/**
 * Create a streaming CSV transform for reconciliation reports.
 * @returns {Transform} The CSV transform stream.
 */
export function createCsvReportTransform() {
  let headerWritten = false;

  return new Transform({
    writableObjectMode: true,
    transform(report, _encoding, callback) {
      if (!headerWritten) {
        this.push(`${CSV_COLUMNS.join(',')}\n`);
        headerWritten = true;
      }

      this.push(`${formatCsvRow(report)}\n`);
      callback();
    },
    flush(callback) {
      if (!headerWritten) {
        this.push(`${CSV_COLUMNS.join(',')}\n`);
      }

      callback();
    },
  });
}

/**
 * Stream a CSV report directly to a writable stream.
 * @param {string} runId - The reconciliation run identifier.
 * @param {import('stream').Writable} writable - The destination writable stream.
 * @returns {Promise<void>} Resolves when streaming completes.
 */
export async function streamCsvReport(runId, writable) {
  const cursor = ReconciliationReport.find({ runId })
    .sort({ category: 1, createdAt: 1, _id: 1 })
    .lean()
    .cursor();

  await pipeline(cursor, createCsvReportTransform(), writable);
}

/**
 * Generate a CSV report for a reconciliation run.
 * @param {string} runId - The reconciliation run identifier.
 * @returns {Promise<string>} The CSV document content.
 */
export async function generateCsvReport(runId) {
  const reports = await ReconciliationReport.find({ runId })
    .sort({ category: 1, createdAt: 1, _id: 1 })
    .lean();

  const header = CSV_COLUMNS.join(',');
  const lines = reports.map(formatCsvRow);

  return [header, ...lines].join('\n');
}
