import { UserTransaction, ExchangeTransaction } from '../db/models/index.js';
import { logger } from '../utils/logger.js';
import { parseCsvFile } from './parser.js';
import { resetValidationState, validateRow } from './validator.js';

function buildFallbackTransactionId(source, runId, sequence) {
  return `__missing__:${source}:${runId}:${sequence}`;
}

async function persistRow(Model, row, source, runId, sequence) {
  const validationInput = {
    ...row,
    runId,
  };
  const validation = validateRow(validationInput, source);
  const transactionId = validation.cleanedRow.transactionId || buildFallbackTransactionId(source, runId, sequence);
  const payload = {
    ...validation.cleanedRow,
    transactionId,
    runId,
    rawRow: row,
    qualityFlag: !validation.valid,
    qualityReason: validation.reason,
  };

  if (!validation.valid) {
    logger.warn('Flagged ingestion row', {
      source,
      runId,
      transactionId,
      reason: validation.reason,
    });
  }

  await Model.updateOne(
    { transactionId, runId },
    {
      $set: payload,
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      upsert: true,
      runValidators: true,
    }
  );

  return {
    transactionId,
    reason: validation.reason,
    flagged: !validation.valid,
  };
}

async function processFile({ filePath, source, Model, runId }) {
  const flaggedRows = [];
  let count = 0;
  let sequence = 0;

  for await (const row of parseCsvFile(filePath)) {
    count += 1;
    sequence += 1;

    const result = await persistRow(Model, row, source, runId, sequence);

    if (result.flagged) {
      flaggedRows.push({
        transactionId: result.transactionId,
        source,
        reason: result.reason,
      });
    }
  }

  return {
    count,
    flaggedRows,
  };
}

export async function ingestFiles({ userPath, exchangePath, runId }) {
  resetValidationState(runId);
  logger.info('Starting ingestion run', { runId });

  try {
    const [userResult, exchangeResult] = await Promise.all([
      processFile({ filePath: userPath, source: 'user', Model: UserTransaction, runId }),
      processFile({ filePath: exchangePath, source: 'exchange', Model: ExchangeTransaction, runId }),
    ]);

    return {
      userCount: userResult.count,
      exchangeCount: exchangeResult.count,
      flaggedRows: [...userResult.flaggedRows, ...exchangeResult.flaggedRows],
    };
  } finally {
    resetValidationState(runId);
    logger.info('Finished ingestion run', { runId });
  }
}
