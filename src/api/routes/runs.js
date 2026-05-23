import { Router } from 'express';
import { z } from 'zod';
import { ReconciliationRun } from '../../db/models/index.js';

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
});

/**
 * Build the runs router.
 * @returns {import('express').Router} The configured router.
 */
export function createRunsRouter() {
  const router = Router();

  router.get('/runs', async (request, response, next) => {
    try {
      const parsedQuery = querySchema.parse(request.query ?? {});
      const page = parsedQuery.page ?? 1;
      const limit = Math.min(parsedQuery.limit ?? 20, 100);
      const filter = parsedQuery.status ? { status: parsedQuery.status } : {};
      const total = await ReconciliationRun.countDocuments(filter);

      const runs = await ReconciliationRun.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('runId status summary startedAt completedAt')
        .lean();

      response.json({
        total,
        page,
        limit,
        runs,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
