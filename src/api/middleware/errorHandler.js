import { ZodError } from 'zod';
import { logger } from '../../utils/logger.js';

function isDuplicateKeyError(error) {
  return error?.name === 'MongoServerError' && error?.code === 11000;
}

/**
 * Global Express error handler.
 * @param {unknown} error - The thrown error.
 * @param {import('express').Request} _request - The incoming request.
 * @param {import('express').Response} response - The outgoing response.
 * @param {import('express').NextFunction} _next - The next middleware function.
 * @returns {void}
 */
export function errorHandler(error, _request, response, _next) {
  logger.error('Request failed', {
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
    code: error?.code,
  });

  if (error instanceof ZodError) {
    const fieldErrors = error.issues.reduce((accumulator, issue) => {
      const key = issue.path.join('.') || 'root';
      if (!accumulator[key]) {
        accumulator[key] = [];
      }

      accumulator[key].push(issue.message);
      return accumulator;
    }, {});

    response.status(400).json({
      message: 'Validation failed',
      errors: fieldErrors,
    });
    return;
  }

  if (isDuplicateKeyError(error)) {
    response.status(409).json({
      message: 'Duplicate key error',
    });
    return;
  }

  const safeMessage = process.env.NODE_ENV === 'production' ? 'Internal server error' : String(error?.message ?? 'Internal server error');

  response.status(500).json({
    message: safeMessage,
  });
}
