const AuthService = require('../services/auth.service');

class AuthController {
  static async register(req, res, next) {
    try {
      const result = await AuthService.register(req.body);
      res.status(201).json({
        success: true,
        message: 'Account registered successfully',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async login(req, res, next) {
    try {
      const result = await AuthService.login(req.body);
      res.status(200).json({
        success: true,
        message: 'Authentication successful',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async refresh(req, res, next) {
    try {
      const result = await AuthService.refreshToken(req.body.refreshToken);
      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async logout(req, res, next) {
    try {
      const result = await AuthService.logout(req.user?.id);
      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  static async requestPasswordRecovery(req, res, next) {
    try {
      const result = await AuthService.requestPasswordRecovery(req.body.email);
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          cooldownSeconds: result.cooldownSeconds
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async verifyRecoveryOtp(req, res, next) {
    try {
      const { email, token, type } = req.body;
      const result = await AuthService.verifyRecoveryOtp(email, token, type);
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async resetPassword(req, res, next) {
    try {
      // Either authenticated via header (JWT/recovery session) or user ID
      const userId = req.user?.id;
      const { newPassword } = req.body;
      const result = await AuthService.resetPassword(userId, newPassword);
      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = AuthController;
