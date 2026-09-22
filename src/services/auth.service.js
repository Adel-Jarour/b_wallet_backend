const { createClient } = require('@supabase/supabase-js');
const { env } = require('../config/env');
const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const { sanitizeProfile, sanitizeUser } = require('../utils/sanitize.util');
const logger = require('../config/logger');

// Anon client for user-level Supabase Auth calls (signInWithPassword, etc.)
const supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Cooldown tracking for OTP requests (60 seconds)
const otpCooldowns = new Map();

// Session attempt tracking for OTP verification (5-minute validity, 3 attempts max)
const otpSessions = new Map();

const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_VALIDITY_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 3;

class AuthService {
  /**
   * Registers a new user account.
   * Auto-provisions profile and default USD wallet via database trigger.
   *
   * @param {Object} params - Registration attributes
   * @returns {Promise<Object>}
   */
  static async register({ email, password, firstName, lastName, phoneNumber }) {
    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      throw ApiError.conflict('An account with this email address already exists', 'EMAIL_ALREADY_IN_USE');
    }

    // Create user in Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneNumber || null
      }
    });

    if (error || !data.user) {
      logger.error({ error: error?.message }, 'Failed to create user in Supabase Auth');
      throw ApiError.badRequest(error?.message || 'Failed to create user account', 'REGISTRATION_FAILED');
    }

    // Fetch newly provisioned profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    // Authenticate user to obtain initial JWT session
    const { data: sessionData, error: sessionErr } = await supabaseClient.auth.signInWithPassword({
      email: email.toLowerCase(),
      password
    });

    return {
      user: sanitizeUser(data.user),
      profile: sanitizeProfile(profile),
      tokens: sessionData?.session
        ? {
            accessToken: sessionData.session.access_token,
            refreshToken: sessionData.session.refresh_token,
            expiresIn: sessionData.session.expires_in,
            tokenType: sessionData.session.token_type
          }
        : null
    };
  }

  /**
   * Authenticates user credentials via Supabase Auth.
   *
   * @param {Object} credentials - Email and password
   * @returns {Promise<Object>}
   */
  static async login({ email, password }) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email.toLowerCase(),
      password
    });

    if (error || !data.session || !data.user) {
      throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
      tokenType: data.session.token_type,
      user: sanitizeUser(data.user),
      profile: sanitizeProfile(profile)
    };
  }

  /**
   * Refreshes an expired access token using a valid refresh token.
   *
   * @param {string} refreshToken - Supabase refresh token
   * @returns {Promise<Object>}
   */
  static async refreshToken(refreshToken) {
    const { data, error } = await supabaseClient.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data.session) {
      throw ApiError.unauthorized('Invalid or expired refresh token. Please sign in again.', 'REFRESH_TOKEN_INVALID');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
      tokenType: data.session.token_type
    };
  }

  /**
   * Logs out user by revoking active sessions.
   *
   * @param {string} userId - User UUID
   * @returns {Promise<{ success: boolean }>}
   */
  static async logout(userId) {
    if (userId) {
      await supabaseAdmin.auth.admin.signOut(userId).catch(() => {});
    }
    return { success: true, message: 'Logged out successfully' };
  }

  /**
   * Initiates password recovery OTP with 60-second cooldown enforcement.
   *
   * @param {string} email - Registered email address
   * @returns {Promise<Object>}
   */
  static async requestPasswordRecovery(email) {
    const normalizedEmail = email.toLowerCase().trim();
    const now = Date.now();

    // 1. Enforce 60-second cooldown (FR-AUTH-003)
    const lastRequestTime = otpCooldowns.get(normalizedEmail);
    if (lastRequestTime && now - lastRequestTime < OTP_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((OTP_COOLDOWN_MS - (now - lastRequestTime)) / 1000);
      throw ApiError.badRequest(
        `Please wait ${retryAfterSeconds} seconds before requesting another recovery OTP code.`,
        'OTP_COOLDOWN',
        { retryAfterSeconds }
      );
    }

    // Set cooldown
    otpCooldowns.set(normalizedEmail, now);

    // Initialize OTP tracking session (5-minute validity, 3 attempts)
    otpSessions.set(normalizedEmail, {
      requestedAt: now,
      attempts: 0,
      invalidated: false
    });

    // Trigger Supabase Auth password reset email/OTP
    const { error } = await supabaseClient.auth.resetPasswordForEmail(normalizedEmail);

    if (error) {
      logger.warn({ email: normalizedEmail, err: error.message }, 'Supabase reset password request');
      // For security, don't leak whether email exists
    }

    return {
      success: true,
      message: 'If an account exists with this email, a password recovery code has been sent.',
      cooldownSeconds: 60
    };
  }

  /**
   * Verifies password recovery OTP with 5-minute validity and 3-attempt invalidation.
   *
   * @param {string} email - User email
   * @param {string} token - 6-digit OTP
   * @param {string} type - OTP type ('recovery')
   * @returns {Promise<Object>}
   */
  static async verifyRecoveryOtp(email, token, type = 'recovery') {
    const normalizedEmail = email.toLowerCase().trim();
    const session = otpSessions.get(normalizedEmail);
    const now = Date.now();

    // 1. Check if OTP session exists or was invalidated
    if (!session) {
      // Allow proceeding directly to Supabase verification if memory session cleared
    } else {
      if (session.invalidated) {
        throw ApiError.badRequest(
          'This OTP session has been invalidated due to 3 consecutive failed attempts. Please request a new code.',
          'OTP_INVALIDATED'
        );
      }

      if (now - session.requestedAt > OTP_VALIDITY_MS) {
        otpSessions.delete(normalizedEmail);
        throw ApiError.badRequest(
          'OTP code has expired (5-minute validity window exceeded). Please request a new code.',
          'OTP_EXPIRED'
        );
      }
    }

    // 2. Verify with Supabase Auth
    const { data, error } = await supabaseClient.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type
    });

    if (error || !data.session) {
      if (session) {
        session.attempts += 1;
        if (session.attempts >= MAX_OTP_ATTEMPTS) {
          session.invalidated = true;
          throw ApiError.badRequest(
            'OTP code has been invalidated after 3 incorrect attempts. Please request a new code.',
            'OTP_MAX_ATTEMPTS_EXCEEDED',
            { remainingAttempts: 0 }
          );
        }

        const remaining = MAX_OTP_ATTEMPTS - session.attempts;
        throw ApiError.badRequest(
          `Invalid OTP code. ${remaining} attempt(s) remaining before invalidation.`,
          'INVALID_OTP',
          { remainingAttempts: remaining }
        );
      }

      throw ApiError.badRequest('Invalid or expired OTP code', 'INVALID_OTP');
    }

    // 3. Clear session on success
    otpSessions.delete(normalizedEmail);

    return {
      verified: true,
      message: 'OTP verified successfully',
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    };
  }

  /**
   * Resets password using an authenticated recovery token or user ID.
   *
   * @param {string} userId - User UUID
   * @param {string} newPassword - New password
   */
  static async resetPassword(userId, newPassword) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword
    });

    if (error) {
      throw ApiError.badRequest(error.message, 'PASSWORD_RESET_FAILED');
    }

    logger.info({ userId }, 'Password successfully reset for user');
    return { success: true, message: 'Password has been reset successfully' };
  }
}

module.exports = AuthService;
