import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { reconcile } from '../../reconciliation/index.js';

const bodySchema = z.object({
  timestampToleranceSeconds: z.coerce.number().positive().optional(),
  quantityTolerancePct: z.coerce.number().positive().optional(),
  userFilePath: z.string().min(1).optional(),
  exchangeFilePath: z.string().min(1).optional(),
});

function defaultDataPath(fileName) {
  return path.resolve(process.cwd(), 'data', fileName);
}

/**
 * Build the reconciliation router.
 * @returns {import('express').Router} The configured router.
 */
export function createReconcileRouter() {
  const router = Router();

  router.post('/reconcile', (request, response, next) => {
    try {
      const parsedBody = bodySchema.parse(request.body ?? {});
      const runId = randomUUID();
      const resolvedConfig = {
        timestampToleranceSeconds: parsedBody.timestampToleranceSeconds ?? config.timestampToleranceSeconds,
        quantityTolerancePct: parsedBody.quantityTolerancePct ?? config.quantityTolerancePct,
      };
      const userPath = parsedBody.userFilePath ?? defaultDataPath('user.csv');
      const exchangePath = parsedBody.exchangeFilePath ?? defaultDataPath('exchange.csv');

      void reconcile({
        runId,
        userPath,
        exchangePath,
        config: resolvedConfig,
      }).catch((error) => {
        request.app?.get('logger')?.error?.('Background reconciliation failed', { runId, error });
      });

      response.status(202).json({
        runId,
        status: 'pending',
        message: 'Reconciliation started',
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
