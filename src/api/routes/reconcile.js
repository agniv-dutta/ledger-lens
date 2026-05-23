import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { ReconciliationRun } from '../../db/models/index.js';
import { reconcile } from '../../reconciliation/index.js';

const bodySchema = z.object({
  timestampToleranceSeconds: z.coerce.number().positive().optional(),
  quantityTolerancePct: z.coerce.number().positive().optional(),
  userFilePath: z.string().min(1).optional(),
  exchangeFilePath: z.string().min(1).optional(),
  webhookUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), 'webhookUrl must be a valid https URL')
    .optional(),
});

function defaultDataPath(fileName) {
  return path.resolve(process.cwd(), 'data', fileName);
}

async function postWebhook(webhookUrl, runId, logger) {
  if (!webhookUrl) {
    return;
  }

  try {
    const run = await ReconciliationRun.findOne({ runId }).lean();
    const payload = {
      runId,
      status: run?.status ?? 'failed',
      summary: run?.summary ?? null,
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed with status ${response.status}`);
    }
  } catch (error) {
    logger?.error?.('Webhook delivery failed', { runId, webhookUrl, error });
  }
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
      const webhookUrl = parsedBody.webhookUrl;
      const logger = request.app?.get('logger');

      void reconcile({
        runId,
        userPath,
        exchangePath,
        config: resolvedConfig,
      })
        .catch((error) => {
          logger?.error?.('Background reconciliation failed', { runId, error });
        })
        .finally(() => void postWebhook(webhookUrl, runId, logger));

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
