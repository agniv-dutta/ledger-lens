import { ExchangeTransaction, UserTransaction } from '../db/models/index.js';
import { logger } from '../utils/logger.js';
import { normaliseAsset, normaliseType } from './normalise.js';

const CATEGORY = {
  matched: 'matched',
  conflicting: 'conflicting',
  unmatchedUser: 'unmatched_user',
  unmatchedExchange: 'unmatched_exchange',
};

/**
 * Convert a value to a finite number.
 * @param {unknown} value - The value to convert.
 * @returns {number|null} The finite number, or null when conversion fails.
 */
function toFiniteNumber(value) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

/**
 * Determine whether a value is a valid Date instance.
 * @param {unknown} value - The value to inspect.
 * @returns {boolean} True when the value is a valid Date.
 */
function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Convert a transaction document into a prepared in-memory shape.
 * @param {object} transaction - The transaction document loaded from MongoDB.
 * @param {string} source - The transaction source, either "user" or "exchange".
 * @returns {object} The prepared transaction with derived comparison fields.
 */
function prepareTransaction(transaction, source) {
  const timestampMs = isValidDate(transaction.timestamp) ? transaction.timestamp.getTime() : null;

  return {
    ...transaction,
    source,
    id: String(transaction._id ?? ''),
    normalizedAsset: normaliseAsset(transaction.asset),
    normalizedType: String(transaction.type ?? '').trim().toUpperCase(),
    timestampMs,
    quantityValue: toFiniteNumber(transaction.quantity),
  };
}

/**
 * Sort transactions by timestamp ascending, placing null timestamps last.
 * @param {object} left - The left transaction to compare.
 * @param {object} right - The right transaction to compare.
 * @returns {number} The sort order for the two transactions.
 */
function compareByTimestampAscending(left, right) {
  if (left.timestampMs == null && right.timestampMs == null) {
    return left.id.localeCompare(right.id);
  }

  if (left.timestampMs == null) {
    return 1;
  }

  if (right.timestampMs == null) {
    return -1;
  }

  if (left.timestampMs !== right.timestampMs) {
    return left.timestampMs - right.timestampMs;
  }

  return left.id.localeCompare(right.id);
}

/**
 * Load transactions for a run and source, optionally filtering by quality flag.
 * @param {object} Model - The Mongoose model to query.
 * @param {string} runId - The ingestion or reconciliation run identifier.
 * @param {boolean} qualityFlag - Whether to load flagged rows.
 * @returns {Promise<object[]>} The loaded transaction documents.
 */
async function loadTransactions(Model, runId, qualityFlag) {
  return Model.find(qualityFlag ? { runId, qualityFlag: true } : { runId, qualityFlag: { $ne: true } })
    .sort({ timestamp: 1, createdAt: 1, _id: 1 })
    .lean();
}

/**
 * Format a reason for an unmatched transaction.
 * @param {object} transaction - The transaction that was not matched.
 * @returns {string} The unmatched reason string.
 */
function buildUnmatchedReason(transaction) {
  if (!isValidDate(transaction.timestamp)) {
    return 'missing or invalid timestamp';
  }

  if (transaction.quantityValue == null || transaction.quantityValue <= 0) {
    return 'missing or invalid quantity';
  }

  return 'no eligible match found';
}

/**
 * Format the reason for a flagged transaction.
 * @param {object} transaction - The flagged transaction document.
 * @returns {string} The flagged reason string.
 */
function buildFlaggedReason(transaction) {
  const qualityReason = String(transaction.qualityReason ?? '').trim();
  return qualityReason ? `flagged during ingestion: ${qualityReason}` : 'flagged during ingestion';
}

/**
 * Build a reconciliation result entry.
 * @param {string} category - The reconciliation category.
 * @param {object|null} userTx - The matched or unmatched user transaction.
 * @param {object|null} exchangeTx - The matched or unmatched exchange transaction.
 * @param {string|null} reason - The result reason.
 * @param {object|null} diffDetails - Derived difference details for the pair.
 * @returns {object} The reconciliation report payload.
 */
function buildResult(category, userTx, exchangeTx, reason, diffDetails) {
  return {
    category,
    userTx,
    exchangeTx,
    reason,
    diffDetails,
  };
}

/**
 * Calculate difference details for a transaction pair.
 * @param {object} userTx - The user transaction.
 * @param {object} exchangeTx - The exchange transaction.
 * @returns {object} The quantity and timestamp difference details.
 */
function buildDiffDetails(userTx, exchangeTx) {
  const quantityDiff = Math.abs(userTx.quantityValue - exchangeTx.quantityValue);
  const quantityDiffPct = userTx.quantityValue === 0 ? null : quantityDiff / Math.abs(userTx.quantityValue);
  const timestampDiffSeconds = Math.abs(userTx.timestampMs - exchangeTx.timestampMs) / 1000;

  return {
    quantityDiff,
    quantityDiffPct,
    timestampDiffSeconds,
  };
}

/**
 * Determine whether a relative quantity difference is within tolerance.
 * @param {number|null} quantityDiffPct - The relative quantity difference.
 * @param {number} quantityTolerancePct - The allowed quantity tolerance.
 * @returns {boolean} True when the difference is within tolerance.
 */
function isWithinQuantityTolerance(quantityDiffPct, quantityTolerancePct) {
  if (quantityDiffPct == null) {
    return false;
  }

  return quantityDiffPct <= quantityTolerancePct || Math.abs(quantityDiffPct - quantityTolerancePct) <= Number.EPSILON;
}

/**
 * Find the best unmatched exchange transaction for a user transaction.
 * @param {object} userTx - The user transaction being matched.
 * @param {object[]} exchangeTransactions - The available exchange transactions.
 * @param {Set<string>} matchedExchangeIds - The ids of already matched exchange transactions.
 * @param {object} config - Matching tolerances.
 * @returns {object|null} The best exchange candidate, or null when none qualify.
 */
function findBestExchangeCandidate(userTx, exchangeTransactions, matchedExchangeIds, config) {
  let bestCandidate = null;

  for (const exchangeTx of exchangeTransactions) {
    if (matchedExchangeIds.has(exchangeTx.id)) {
      continue;
    }

    if (userTx.timestampMs == null || exchangeTx.timestampMs == null) {
      continue;
    }

    if (userTx.normalizedAsset !== exchangeTx.normalizedAsset) {
      continue;
    }

    const typeCompatibility = normaliseType(userTx.type, exchangeTx.type);
    if (!typeCompatibility.compatible) {
      continue;
    }

    const timestampDiffSeconds = Math.abs(userTx.timestampMs - exchangeTx.timestampMs) / 1000;
    if (timestampDiffSeconds > config.timestampToleranceSeconds) {
      continue;
    }

    if (
      userTx.quantityValue == null ||
      exchangeTx.quantityValue == null ||
      userTx.quantityValue <= 0 ||
      exchangeTx.quantityValue <= 0
    ) {
      continue;
    }

    const quantityDiff = Math.abs(userTx.quantityValue - exchangeTx.quantityValue);

    if (
      bestCandidate == null ||
      quantityDiff < bestCandidate.quantityDiff ||
      (quantityDiff === bestCandidate.quantityDiff && timestampDiffSeconds < bestCandidate.timestampDiffSeconds) ||
      (
        quantityDiff === bestCandidate.quantityDiff &&
        timestampDiffSeconds === bestCandidate.timestampDiffSeconds &&
        exchangeTx.id.localeCompare(bestCandidate.exchangeTx.id) < 0
      )
    ) {
      bestCandidate = {
        exchangeTx,
        quantityDiff,
        timestampDiffSeconds,
      };
    }
  }

  return bestCandidate;
}

/**
 * Match the supplied user and exchange rows for a single run.
 * @param {object} params - The matching parameters.
 * @param {string} params.runId - The ingestion run identifier.
 * @param {object} params.config - The matching configuration.
 * @param {number} params.config.timestampToleranceSeconds - Allowed timestamp drift in seconds.
 * @param {number} params.config.quantityTolerancePct - Allowed relative quantity drift.
 * @returns {Promise<object[]>} The reconciliation results.
 */
export async function runMatching({ runId, config }) {
  if (!runId) {
    throw new Error('runId is required');
  }

  if (!config || !Number.isFinite(config.timestampToleranceSeconds) || !Number.isFinite(config.quantityTolerancePct)) {
    throw new Error('config.timestampToleranceSeconds and config.quantityTolerancePct are required');
  }

  logger.info('Starting matching run', { runId });

  const [userTransactions, exchangeTransactions, flaggedUserTransactions, flaggedExchangeTransactions] = await Promise.all([
    loadTransactions(UserTransaction, runId, false),
    loadTransactions(ExchangeTransaction, runId, false),
    loadTransactions(UserTransaction, runId, true),
    loadTransactions(ExchangeTransaction, runId, true),
  ]);

  const preparedUserTransactions = userTransactions.map((transaction) => prepareTransaction(transaction, 'user')).sort(compareByTimestampAscending);
  const preparedExchangeTransactions = exchangeTransactions.map((transaction) => prepareTransaction(transaction, 'exchange')).sort(compareByTimestampAscending);
  const results = [];
  const matchedExchangeIds = new Set();

  for (const userTx of preparedUserTransactions) {
    if (userTx.timestampMs == null) {
      results.push(buildResult(CATEGORY.unmatchedUser, userTx, null, 'missing or invalid timestamp', null));
      continue;
    }

    const bestCandidate = findBestExchangeCandidate(userTx, preparedExchangeTransactions, matchedExchangeIds, config);

    if (bestCandidate == null) {
      results.push(buildResult(CATEGORY.unmatchedUser, userTx, null, buildUnmatchedReason(userTx), null));
      continue;
    }

    matchedExchangeIds.add(bestCandidate.exchangeTx.id);

    const diffDetails = buildDiffDetails(userTx, bestCandidate.exchangeTx);
    const quantityDiffPct = diffDetails.quantityDiffPct;
    const compatible = isWithinQuantityTolerance(quantityDiffPct, config.quantityTolerancePct);

    if (compatible) {
      results.push(buildResult(CATEGORY.matched, userTx, bestCandidate.exchangeTx, null, diffDetails));
      continue;
    }

    results.push(
      buildResult(
        CATEGORY.conflicting,
        userTx,
        bestCandidate.exchangeTx,
        `quantity diff exceeds tolerance: ${quantityDiffPct == null ? 'n/a' : quantityDiffPct}`,
        diffDetails
      )
    );
  }

  const matchedUserIds = new Set(results.filter((entry) => entry.userTx != null).map((entry) => entry.userTx.id));

  for (const exchangeTx of preparedExchangeTransactions) {
    if (matchedExchangeIds.has(exchangeTx.id)) {
      continue;
    }

    results.push(buildResult(CATEGORY.unmatchedExchange, null, exchangeTx, buildUnmatchedReason(exchangeTx), null));
  }

  for (const flaggedTransaction of flaggedUserTransactions.map((transaction) => prepareTransaction(transaction, 'user')).sort(compareByTimestampAscending)) {
    if (matchedUserIds.has(flaggedTransaction.id)) {
      continue;
    }

    results.push(buildResult(CATEGORY.unmatchedUser, flaggedTransaction, null, buildFlaggedReason(flaggedTransaction), null));
  }

  for (const flaggedTransaction of flaggedExchangeTransactions.map((transaction) => prepareTransaction(transaction, 'exchange')).sort(compareByTimestampAscending)) {
    if (matchedExchangeIds.has(flaggedTransaction.id)) {
      continue;
    }

    results.push(buildResult(CATEGORY.unmatchedExchange, null, flaggedTransaction, buildFlaggedReason(flaggedTransaction), null));
  }

  logger.info('Finished matching run', { runId, resultCount: results.length });

  return results;
}
