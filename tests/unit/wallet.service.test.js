const {
  toCents,
  fromCents,
  formatMoney,
  add,
  subtract,
  equals,
  isZero,
  isPositive,
  isNegative,
  greaterThan,
  greaterThanOrEqual,
  lessThan,
  lessThanOrEqual
} = require('../../src/utils/money.util');
const WalletService = require('../../src/services/wallet.service');

describe('Unit: Financial Money Utility & Precision (NUMERIC(15,2))', () => {
  describe('No JavaScript Floating-Point Drift', () => {
    test('proves JavaScript float inaccuracy vs exact money.util arithmetic', () => {
      // Classic JS float bug: 0.1 + 0.2 = 0.30000000000000004
      const jsFloatSum = 0.1 + 0.2;
      expect(jsFloatSum).not.toBe(0.3);

      // money.util exact addition
      const exactSum = add('0.10', '0.20');
      expect(exactSum).toBe('0.30');
    });

    test('correctly handles multi-digit currency additions without precision loss', () => {
      // 999,999,999.99 + 0.01 = 1,000,000,000.00
      const result = add('999999999.99', '0.01');
      expect(result).toBe('1000000000.00');
    });

    test('exact subtraction without negative float residues', () => {
      const result = subtract('100.00', '99.95');
      expect(result).toBe('0.05');
    });
  });

  describe('toCents & fromCents', () => {
    test('converts various valid formats to BigInt cents', () => {
      expect(toCents('100.50')).toBe(10050n);
      expect(toCents('100.5')).toBe(10050n);
      expect(toCents('100')).toBe(10000n);
      expect(toCents('0.05')).toBe(5n);
      expect(toCents('0')).toBe(0n);
      expect(toCents('-50.25')).toBe(-5025n);
    });

    test('converts BigInt cents back to 2-decimal string', () => {
      expect(fromCents(10050n)).toBe('100.50');
      expect(fromCents(10000n)).toBe('100.00');
      expect(fromCents(5n)).toBe('0.05');
      expect(fromCents(0n)).toBe('0.00');
      expect(fromCents(-5025n)).toBe('-50.25');
    });

    test('formatMoney normalizes any string to 2 decimals', () => {
      expect(formatMoney('0')).toBe('0.00');
      expect(formatMoney('45')).toBe('45.00');
      expect(formatMoney('12.3')).toBe('12.30');
      expect(formatMoney('12.34')).toBe('12.34');
    });

    test('rejects malformed monetary inputs', () => {
      expect(() => toCents('abc')).toThrow(RangeError);
      expect(() => toCents('10.999')).toThrow(RangeError); // More than 2 decimal places
      expect(() => toCents('')).toThrow(TypeError);
      expect(() => toCents(null)).toThrow(TypeError);
      expect(() => toCents(undefined)).toThrow(TypeError);
    });
  });

  describe('Comparison Functions', () => {
    test('equals', () => {
      expect(equals('100.00', '100')).toBe(true);
      expect(equals('100.50', '100.5')).toBe(true);
      expect(equals('100.00', '100.01')).toBe(false);
    });

    test('isZero', () => {
      expect(isZero('0.00')).toBe(true);
      expect(isZero('0')).toBe(true);
      expect(isZero('0.01')).toBe(false);
    });

    test('isPositive & isNegative', () => {
      expect(isPositive('0.01')).toBe(true);
      expect(isPositive('0.00')).toBe(false);
      expect(isNegative('-0.01')).toBe(true);
      expect(isNegative('0.00')).toBe(false);
    });

    test('greaterThan & lessThan', () => {
      expect(greaterThan('50.01', '50.00')).toBe(true);
      expect(greaterThan('50.00', '50.01')).toBe(false);
      expect(greaterThanOrEqual('50.00', '50.00')).toBe(true);
      expect(lessThan('49.99', '50.00')).toBe(true);
      expect(lessThanOrEqual('50.00', '50.00')).toBe(true);
    });
  });
});
