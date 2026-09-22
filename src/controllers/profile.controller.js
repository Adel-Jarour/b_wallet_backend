const ProfileService = require('../services/profile.service');

class ProfileController {
  static async getMe(req, res, next) {
    try {
      const profile = await ProfileService.getProfile(req.user.id);
      res.status(200).json({
        success: true,
        data: profile
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateMe(req, res, next) {
    try {
      const updatedProfile = await ProfileService.updateProfile(req.user.id, req.body);
      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: updatedProfile
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = ProfileController;
