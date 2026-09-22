const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const { sanitizeProfile } = require('../utils/sanitize.util');
const logger = require('../config/logger');

class ProfileService {
  /**
   * Retrieves the current user's profile, strictly ensuring pin_hash is omitted.
   *
   * @param {string} userId - Authenticated user UUID
   * @returns {Promise<Object>}
   */
  static async getProfile(userId) {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw ApiError.notFound('User profile not found', 'PROFILE_NOT_FOUND');
    }

    return sanitizeProfile(profile);
  }

  /**
   * Updates personal profile attributes.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>}
   */
  static async updateProfile(userId, updates) {
    const dbPayload = {
      updated_at: new Date().toISOString()
    };

    if (updates.firstName !== undefined) dbPayload.first_name = updates.firstName;
    if (updates.lastName !== undefined) dbPayload.last_name = updates.lastName;
    if (updates.phoneNumber !== undefined) dbPayload.phone_number = updates.phoneNumber;
    if (updates.dateOfBirth !== undefined) dbPayload.date_of_birth = updates.dateOfBirth;
    if (updates.avatarUrl !== undefined) dbPayload.avatar_url = updates.avatarUrl;

    const { data: updatedProfile, error } = await supabaseAdmin
      .from('profiles')
      .update(dbPayload)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      logger.error({ userId, error: error.message }, 'Failed to update user profile');
      throw ApiError.badRequest(error.message, 'PROFILE_UPDATE_FAILED');
    }

    return sanitizeProfile(updatedProfile);
  }
}

module.exports = ProfileService;
