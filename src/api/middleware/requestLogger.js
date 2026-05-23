import { logger } from '../../utils/logger.js';

/**
 * Express middleware that logs request method, path, status, and duration.
 * @param {import('express').Request} request - The incoming request.
 * @param {import('express').Response} response - The outgoing response.
 * @param {import('express').NextFunction} next - The next middleware function.
 * @returns {void}
 */
export function requestLogger(request, response, next) {
  const startedAt = process.hrtime.bigint();

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('HTTP request', {
      method: request.method,
      path: request.originalUrl,
      status: response.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    });
  });

  next();
}
