import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createReconcileRouter } from './routes/reconcile.js';
import { createReportRouter } from './routes/report.js';
import { createRunsRouter } from './routes/runs.js';

const app = express();

app.set('logger', logger);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.use(createReconcileRouter());
app.use(createReportRouter());
app.use(createRunsRouter());

app.use(errorHandler);

export default app;
