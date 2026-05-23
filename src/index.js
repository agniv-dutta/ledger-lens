import app from './api/app.js';
import { connectToDatabase } from './db/connection.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

async function start() {
  try {
    await connectToDatabase(config.mongodbUri);
    app.listen(config.port, () => {
      logger.info(`ledger-lens listening on port ${config.port}`);
    });
  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

start();

export default app;
