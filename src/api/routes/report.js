import { Router } from 'express';
import { z } from 'zod';
import { ReconciliationReport, ReconciliationRun } from '../../db/models/index.js';

const UNMATCHED_CATEGORIES = new Set(['unmatched_user', 'unmatched_exchange']);
const sourceQuerySchema = z.object({
  source: z.enum(['user', 'exchange']).optional(),
});

/**
 * Build the report router.
 * @returns {import('express').Router} The configured router.
 */
export function createReportRouter() {
  const router = Router();

  router.get('/report/:runId', async (request, response, next) => {
    try {
      const { runId } = request.params;
      const run = await ReconciliationRun.findOne({ runId }).lean();

      if (!run) {
        response.status(404).json({ message: 'Run not found' });
        return;
      }

      if (['pending', 'running'].includes(run.status)) {
        response.status(409).json({ message: 'Run is still in progress' });
        return;
      }

      const reports = await ReconciliationReport.find({ runId })
        .sort({ category: 1, createdAt: 1, _id: 1 })
        .lean();

      response.json({
        run: {
          runId: run.runId,
          status: run.status,
          summary: run.summary,
          config: run.config,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        },
        reports,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/report/:runId/summary', async (request, response, next) => {
    try {
      const { runId } = request.params;
      const run = await ReconciliationRun.findOne({ runId }).lean();

      if (!run) {
        response.status(404).json({ message: 'Run not found' });
        return;
      }

      if (['pending', 'running'].includes(run.status)) {
        response.status(409).json({ message: 'Run is still in progress' });
        return;
      }

      response.json({
        runId: run.runId,
        status: run.status,
        summary: run.summary ?? {
          matched: 0,
          conflicting: 0,
          unmatched_user: 0,
          unmatched_exchange: 0,
          total: 0,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/report/:runId/unmatched', async (request, response, next) => {
    try {
      const { runId } = request.params;
      const { source } = sourceQuerySchema.parse(request.query ?? {});
      const run = await ReconciliationRun.findOne({ runId }).lean();

      if (!run) {
        response.status(404).json({ message: 'Run not found' });
        return;
      }

      if (['pending', 'running'].includes(run.status)) {
        response.status(409).json({ message: 'Run is still in progress' });
        return;
      }

      const query = {
        runId,
        category: { $in: Array.from(UNMATCHED_CATEGORIES) },
      };

      if (source != null) {
        if (source !== 'user' && source !== 'exchange') {
          response.status(400).json({ message: 'source must be user or exchange' });
          return;
        }

        query.category = source === 'user' ? 'unmatched_user' : 'unmatched_exchange';
      }

      const reports = await ReconciliationReport.find(query)
        .sort({ category: 1, createdAt: 1, _id: 1 })
        .lean();

      response.json({
        runId,
        reports,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
