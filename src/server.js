const app = require('./app');
const { env } = require('./config/env');
const logger = require('./config/logger');

const server = app.listen(env.PORT, () => {
  logger.info({
    port: env.PORT,
    environment: env.NODE_ENV,
    url: `http://localhost:${env.PORT}`
  }, `🚀 B-Wallet Backend server running on port ${env.PORT}`);
});

// Graceful shutdown handling
function handleShutdown(signal) {
  logger.info({ signal }, `Received ${signal}. Gracefully closing HTTP server...`);
  server.close((err) => {
    if (err) {
      logger.error({ error: err.message }, 'Error during HTTP server shutdown');
      process.exit(1);
    }
    logger.info('HTTP server closed cleanly. Exiting process.');
    process.exit(0);
  });

  // Force close if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = server;
