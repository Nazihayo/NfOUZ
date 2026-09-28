'use strict';

const env = require('./config/env');
const createApp = require('./app');
const { initializeFirebase } = require('./config/firebase');
const { checkConnection, shutdown: shutdownDatabase } = require('./config/database');
const logger = require('./utils/logger');

async function start() {
  initializeFirebase();

  const databaseReachable = await checkConnection();
  if (!databaseReachable) {
    logger.error('Database is unreachable at startup. Exiting.');
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`NFOUZ backend listening on port ${env.PORT}`, { env: env.NODE_ENV });
  });

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      await shutdownDatabase();
      logger.info('Shutdown complete.');
      process.exit(0);
    });

    // Force-exit if graceful shutdown hangs.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    logger.error('Fatal error during startup', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = { start };
