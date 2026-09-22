const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const { env } = require('./config/env');
const logger = require('./config/logger');
const correlationIdMiddleware = require('./middlewares/correlationId');
const errorHandler = require('./middlewares/errorHandler');
const routes = require('./routes');

const app = express();

// 1. Security Headers via Helmet
app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  noSniff: true
}));

const { requestSanitizer } = require('./middlewares/sanitizer');
const { globalLimiter } = require('./middlewares/rateLimiter');

// 2. Global Sensitivity-Aware Rate Limiting
app.use(globalLimiter);

// 3. CORS Configuration
app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Idempotency-Key']
}));

// 4. Body Parsers
// Dedicated raw body capture for webhooks (guarantees raw bytes for cryptographic signature verification)
app.use('/api/v1/webhooks', express.raw({ type: '*/*', limit: '100kb' }), (req, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
  }
  next();
});

app.use(express.json({
  limit: '100kb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// 5. Input Sanitization & Prototype Pollution Protection (inspects parsed body, rawBody, query, and params)
app.use(requestSanitizer);

// 4. Request Correlation ID
app.use(correlationIdMiddleware);

// 5. HTTP Access Logging with Pino
if (env.NODE_ENV !== 'test') {
  app.use(pinoHttp({
    logger,
    customProps: (req) => ({
      correlationId: req.correlationId
    }),
    autoLogging: {
      ignore: (req) => req.url === '/health' && env.NODE_ENV === 'production'
    }
  }));
}

// 6. Documentation Routes (Public OpenAPI 3.0 & Swagger UI)
const swaggerRoutes = require('./docs/swagger');
app.use(swaggerRoutes);

// 7. Application Routes
app.use(routes);

// 7. Centralized Error Handler
app.use(errorHandler);

module.exports = app;
