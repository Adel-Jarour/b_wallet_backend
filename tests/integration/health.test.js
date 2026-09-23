const request = require('supertest');

// Mock checkSupabaseHealth for deterministic, fast integration testing
jest.mock('../../src/config/supabase', () => {
  const original = jest.requireActual('../../src/config/supabase');
  return {
    ...original,
    checkSupabaseHealth: jest.fn().mockResolvedValue({
      healthy: true,
      latencyMs: 15,
      details: { usersAccessible: true, projectUrl: 'https://test-project.supabase.co' }
    })
  };
});

const { checkSupabaseHealth } = require('../../src/config/supabase');
const app = require('../../src/app');

describe('Integration: Health Check & Middleware Endpoints', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    test('should return HTTP 200 with status UP when Supabase is connected', async () => {
      checkSupabaseHealth.mockResolvedValueOnce({
        healthy: true,
        latencyMs: 25,
        details: { usersAccessible: true }
      });

      const res = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toHaveProperty('status', 'UP');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('services');
      expect(res.body.services).toHaveProperty('api', 'HEALTHY');
      expect(res.body.services).toHaveProperty('supabase', 'CONNECTED');
      expect(res.body).toHaveProperty('system');
      expect(res.body.system).toHaveProperty('nodeVersion');
      expect(res.body.system).toHaveProperty('memoryUsageMb');
    });

    test('should return status DEGRADED when Supabase is disconnected', async () => {
      checkSupabaseHealth.mockResolvedValueOnce({
        healthy: false,
        latencyMs: 3000,
        error: 'Network connection timeout'
      });

      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'DEGRADED');
      expect(res.body.services).toHaveProperty('supabase', 'DISCONNECTED');
      expect(res.body.diagnostics).toHaveProperty('supabaseError', 'Network connection timeout');
    });

    test('should include X-Correlation-ID header on response', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.headers['x-correlation-id']).toBeDefined();
      expect(res.body.correlationId).toBe(res.headers['x-correlation-id']);
    });

    test('should propagate client-provided X-Correlation-ID', async () => {
      const customId = 'client-test-trace-id-12345';
      const res = await request(app)
        .get('/health')
        .set('X-Correlation-ID', customId)
        .expect(200);

      expect(res.headers['x-correlation-id']).toBe(customId);
      expect(res.body.correlationId).toBe(customId);
    });

    test('should support /api/v1/health alias route', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(res.body.services.api).toBe('HEALTHY');
    });
  });

  describe('Error Handling Middleware', () => {
    test('should return 404 with standardized error response for non-existent routes', async () => {
      const res = await request(app)
        .get('/non-existent-endpoint')
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code', 'ROUTE_NOT_FOUND');
      expect(res.body.error).toHaveProperty('message');
      expect(res.body.error).toHaveProperty('correlationId');
    });
  });

  describe('OpenAPI & Documentation Viewer (/api-docs)', () => {
    test('should serve OpenAPI 3.0 specification at GET /api-docs.json', async () => {
      const res = await request(app)
        .get('/api-docs.json')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(res.body).toHaveProperty('openapi', '3.0.3');
      expect(res.body).toHaveProperty('info');
      expect(res.body.info).toHaveProperty('title');
      expect(res.body).toHaveProperty('paths');
    });

    test('should serve interactive HTML with targeted CSP allowing cdn.redoc.ly at GET /api-docs', async () => {
      const res = await request(app)
        .get('/api-docs')
        .expect('Content-Type', /html/)
        .expect(200);

      expect(res.text).toContain('https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js');
      expect(res.text).toContain('<redoc spec-url=\'/api-docs.json\'></redoc>');

      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain('https://cdn.redoc.ly');
      expect(csp).toContain("worker-src 'self' blob:");
    });
  });
});
