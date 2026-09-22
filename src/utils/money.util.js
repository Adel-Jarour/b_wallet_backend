/**
 * High-Precision Monetary Utility for FinTech Calculations
 * =========================================================
 * Enforces PostgreSQL NUMERIC(15,2) fixed-point financial arithmetic.
 * NEVER uses JavaScript floating-point numbers (0.1 + 0.2 != 0.3) for money.
 * Uses BigInt cents internally for exact, loss-less integer arithmetic.
 */

/**
 * Validates and converts a monetary value into BigInt cents.
 * Supports string representations ("100.50", "100", "-50.25") or numbers/BigInts.
 * @param {string|number|bigint} value 
 * @returns {bigint} Cents as BigInt
 */
function toCents(value) {
  if (value === null || value === undefined) {
    throw new TypeError('Monetary value cannot be null or undefined');
  }

  if (typeof value === 'bigint') {
    return value;
  }

  const str = String(value).trim();
  if (!str) {
    throw new TypeError('Monetary value cannot be empty');
  }

  // Strict regex matching for decimal monetary values
  const match = str.match(/^(-)?(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new RangeError(`Invalid monetary format: "${str}". Expected format like "100.50" or "100"`);
  }

  const isNegative = Boolean(match[1]);
  const wholePart = match[2];
  const fractionalPart = (match[3] || '').padEnd(2, '0');

  const combinedStr = wholePart + fractionalPart;
  const cents = BigInt(combinedStr);

  return isNegative ? -cents : cents;
}

/**
 * Converts BigInt cents into a standard 2-decimal string (NUMERIC(15,2)).
 * @param {bigint|number|string} cents 
 * @returns {string} Formatted decimal string (e.g. "100.50", "0.00", "-0.25")
 */
function fromCents(cents) {
  const c = typeof cents === 'bigint' ? cents : BigInt(cents);
  const isNegative = c < 0n;
  const absCents = isNegative ? -c : c;

  const whole = absCents / 100n;
  const fraction = absCents % 100n;

  const paddedFraction = fraction.toString().padStart(2, '0');
  const sign = isNegative ? '-' : '';

  return `${sign}${whole.toString()}.${paddedFraction}`;
}

/**
 * Normalizes any monetary input to standard 2-decimal format string.
 * @param {string|number|bigint} value 
 * @returns {string} e.g. "150.00"
 */
function formatMoney(value) {
  return fromCents(toCents(value));
}

/**
 * Exact addition of two monetary values.
 * @param {string|number|bigint} a 
 * @param {string|number|bigint} b 
 * @returns {string} Sum as 2-decimal string
 */
function add(a, b) {
  return fromCents(toCents(a) + toCents(b));
}

/**
 * Exact subtraction of two monetary values (a - b).
 * @param {string|number|bigint} a 
 * @param {string|number|bigint} b 
 * @returns {string} Difference as 2-decimal string
 */
function subtract(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

/**
 * Returns true if a === b in monetary value.
 */
function equals(a, b) {
  return toCents(a) === toCents(b);
}

/**
 * Returns true if value === 0.00.
 */
function isZero(value) {
  return toCents(value) === 0n;
}

/**
 * Returns true if value > 0.00.
 */
function isPositive(value) {
  return toCents(value) > 0n;
}

/**
 * Returns true if value < 0.00.
 */
function isNegative(value) {
  return toCents(value) < 0n;
}

/**
 * Returns true if a > b.
 */
function greaterThan(a, b) {
  return toCents(a) > toCents(b);
}

/**
 * Returns true if a >= b.
 */
function greaterThanOrEqual(a, b) {
  return toCents(a) >= toCents(b);
}

/**
 * Returns true if a < b.
 */
function lessThan(a, b) {
  return toCents(a) < toCents(b);
}

/**
 * Returns true if a <= b.
 */
function lessThanOrEqual(a, b) {
  return toCents(a) <= toCents(b);
}

module.exports = {
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
};
