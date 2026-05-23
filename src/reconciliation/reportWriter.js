import { ReconciliationReport, ReconciliationRun } from '../db/models/index.js';

/**
 * Count reconciliation results by category.
 * @param {object[]} results - The reconciliation results to summarise.
 * @returns {object} The category counts and total.
 */
function buildSummary(results) {
  return results.reduce(
    (summary, result) => {
      const isFlagged = Boolean(result.userTx?.qualityFlag || result.exchangeTx?.qualityFlag);

      if (isFlagged) {
        return summary;
      }

      summary[result.category] = (summary[result.category] ?? 0) + 1;
      summary.total += 1;
      return summary;
    },
    {
      matched: 0,
      conflicting: 0,
      unmatched_user: 0,
      unmatched_exchange: 0,
      total: 0,
    }
  );
}

/**
 * Persist reconciliation results and mark the run as completed.
 * @param {object} params - The write report parameters.
 * @param {string} params.runId - The reconciliation run identifier.
 * @param {object[]} params.results - The reconciliation results to persist.
 * @returns {Promise<object>} The run summary that was written.
 */
export async function writeReport({ runId, results }) {
  const reportDocuments = results.map((result) => ({
    runId,
    category: result.category,
    userTx: result.userTx,
    exchangeTx: result.exchangeTx,
    reason: result.reason,
    diffDetails: result.diffDetails,
  }));

  if (reportDocuments.length > 0) {
    await ReconciliationReport.insertMany(reportDocuments, { ordered: false });
  }

  const summary = buildSummary(results);
  await ReconciliationRun.updateOne(
    { runId },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        summary,
      },
    }
  );

  return summary;
}
