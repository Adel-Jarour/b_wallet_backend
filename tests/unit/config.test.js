const { validateEnv } = require('../../src/config/env');

describe('Unit: Environment Configuration Validation (Zod)', () => {
  const validConfig = {
    PORT: '3000',
    NODE_ENV: 'test',
    SUPABASE_URL: 'https://test-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    CORS_ORIGIN: '*',
    LOG_LEVEL: 'silent'
  };

  test('should successfully validate a complete and valid configuration', () => {
    const parsed = validateEnv(validConfig);
    expect(parsed.PORT).toBe(3000);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.SUPABASE_URL).toBe('https://test-project.supabase.co');
    expect(parsed.SUPABASE_SERVICE_ROLE_KEY).toBe('test-service-role-key');
    expect(parsed.CORS_ORIGIN).toBe('*');
  });

  test('should throw validation error when SUPABASE_URL is missing or invalid URL', () => {
    const invalidConfig = {
      ...validConfig,
      SUPABASE_URL: 'not-a-valid-url'
    };

    expect(() => validateEnv(invalidConfig)).toThrow(/Invalid environment configuration/);
  });

  test('should throw validation error when SUPABASE_SERVICE_ROLE_KEY is empty', () => {
    const invalidConfig = {
      ...validConfig,
      SUPABASE_SERVICE_ROLE_KEY: ''
    };

    expect(() => validateEnv(invalidConfig)).toThrow(/Invalid environment configuration/);
  });

  test('should fallback to default PORT 3000 when PORT is omitted', () => {
    const { PORT, ...configWithoutPort } = validConfig;
    const parsed = validateEnv(configWithoutPort);
    expect(parsed.PORT).toBe(3000);
  });
});
