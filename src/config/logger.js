const pino = require('pino');
const { env } = require('./env');

const isDevelopment = env.NODE_ENV === 'development';

const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        ignore: 'pid,hostname'
      }
    }
  : undefined;

const logger = pino({
  level: env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  base: {
    service: 'b-wallet-backend',
    env: env.NODE_ENV
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-service-role-key"]',
      'pin',
      'confirmPin',
      'currentPin',
      'newPin',
      'confirmNewPin',
      'pin_hash',
      'password',
      'newPassword',
      'token',
      'otp',
      'refreshToken',
      'service_role_key',
      '*.pin',
      '*.confirmPin',
      '*.currentPin',
      '*.newPin',
      '*.confirmNewPin',
      '*.pin_hash',
      '*.password',
      '*.newPassword',
      '*.token',
      '*.otp',
      '*.refreshToken'
    ],
    censor: '[REDACTED]'
  },
  transport
});

module.exports = logger;
