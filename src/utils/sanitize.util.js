/**
 * Data Sanitization Utility
 * Ensures sensitive authentication and cryptographic fields are NEVER
 * returned in API responses or leaked to clients.
 */

/**
 * Strips sensitive fields (especially pin_hash) from a user profile object.
 * @param {Object} profile - Raw profile record from database
 * @returns {Object|null} Sanitized profile object
 */
function sanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }

  // Clone object to prevent mutating original reference
  const sanitized = { ...profile };

  // STRICT RULE: pin_hash must NEVER leave the server boundary
  delete sanitized.pin_hash;

  // Mask or format any additional sensitive properties if present
  return sanitized;
}

/**
 * Strips sensitive fields from a user record (Supabase Auth user).
 * @param {Object} user - Supabase Auth user record
 * @returns {Object|null} Sanitized user object
 */
function sanitizeUser(user) {
  if (!user || typeof user !== 'object') {
    return user;
  }

  const sanitized = { ...user };
  delete sanitized.encrypted_password;
  delete sanitized.confirmation_token;
  delete sanitized.recovery_token;
  delete sanitized.email_change_token_current;
  delete sanitized.email_change_token_new;

  return sanitized;
}

module.exports = {
  sanitizeProfile,
  sanitizeUser
};
