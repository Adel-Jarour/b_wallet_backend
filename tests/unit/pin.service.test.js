const PinService = require('../../src/services/pin.service');
const ApiError = require('../../src/utils/ApiError');

describe('Unit: PinService (Argon2id & Cryptographic Verification)', () => {
  const validPin = '123456';
  const alternativePin = '654321';

  describe('hashPin()', () => {
    test('should hash a valid 6-digit PIN into a valid Argon2id hash', async () => {
      const hash = await PinService.hashPin(validPin);

      expect(typeof hash).toBe('string');
      // Argon2id header format: $argon2id$v=19$m=65536,p=4,t=3$...
      expect(hash).toMatch(/^\$argon2id\$v=\d+\$m=\d+,.+\$.+/);
      expect(hash).toContain('m=65536');
      expect(hash).toContain('t=3');
      expect(hash).toContain('p=4');
    });

    test('should generate unique salts (two hashes of same PIN must differ)', async () => {
      const hash1 = await PinService.hashPin(validPin);
      const hash2 = await PinService.hashPin(validPin);

      expect(hash1).not.toBe(hash2);
    });

    test('should reject PINs that are not exactly 6 numeric digits', async () => {
      const invalidPins = ['', '12345', '1234567', 'abcdef', '12 345', '12.456'];

      for (const pin of invalidPins) {
        await expect(PinService.hashPin(pin)).rejects.toThrow(ApiError);
      }
    });
  });

  describe('verifyPinHash()', () => {
    test('should return true for matching PIN', async () => {
      const hash = await PinService.hashPin(validPin);
      const isMatch = await PinService.verifyPinHash(hash, validPin);

      expect(isMatch).toBe(true);
    });

    test('should return false for incorrect PIN', async () => {
      const hash = await PinService.hashPin(validPin);
      const isMatch = await PinService.verifyPinHash(hash, alternativePin);

      expect(isMatch).toBe(false);
    });

    test('should return false for null, empty, or malformed inputs safely', async () => {
      const hash = await PinService.hashPin(validPin);

      expect(await PinService.verifyPinHash(hash, '')).toBe(false);
      expect(await PinService.verifyPinHash(hash, null)).toBe(false);
      expect(await PinService.verifyPinHash('', validPin)).toBe(false);
      expect(await PinService.verifyPinHash('not-a-valid-argon-hash', validPin)).toBe(false);
    });
  });
});
