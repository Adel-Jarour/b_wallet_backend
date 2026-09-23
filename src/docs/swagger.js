/**
 * Swagger / OpenAPI Documentation Server
 * =======================================
 * Serves the OpenAPI 3.0 specification at:
 *   - GET /api-docs.json (Raw JSON spec)
 *   - GET /api-docs      (Interactive Redoc / Swagger UI documentation)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const helmet = require('helmet');

const router = express.Router();
const openApiSpecPath = path.join(__dirname, '..', '..', 'docs', 'openapi.json');

let openApiSpec = null;
try {
  const fileData = fs.readFileSync(openApiSpecPath, 'utf-8');
  openApiSpec = JSON.parse(fileData);
} catch (err) {
  openApiSpec = {
    openapi: '3.0.3',
    info: { title: 'B-Wallet API', version: '1.0.0' },
    paths: {}
  };
}

// Targeted Content Security Policy for Redoc documentation UI
// Allows Redoc CDN script and web worker blob without relaxing global API CSP
const docsCsp = helmet.contentSecurityPolicy({
  directives: {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'script-src': ["'self'", 'https://cdn.redoc.ly'],
    'img-src': ["'self'", 'data:', 'https:'],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:']
  }
});

// 1. Raw OpenAPI 3.0 JSON specification
router.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openApiSpec);
});

// 2. Interactive Documentation Viewer (Zero-Dependency Redoc HTML UI)
router.get('/api-docs', docsCsp, (req, res) => {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>B-Wallet API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url='/api-docs.json'></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"> </script>
  </body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
