const PinService = require('../services/pin.service');

class PinController {
  static async getStatus(req, res, next) {
    try {
      const status = await PinService.getPinStatus(req.user.id);
      res.status(200).json({
        success: true,
        data: status
      });
    } catch (err) {
      next(err);
    }
  }

  static async setup(req, res, next) {
    try {
      const result = await PinService.setupPin(req.user.id, req.body.pin);
      res.status(201).json({
        success: true,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  static async verify(req, res, next) {
    try {
      const result = await PinService.validateAndAuthorizePin(req.user.id, req.body.pin);
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          authorized: result.authorized,
          ticket: result.ticket,
          expiresInSeconds: result.expiresInSeconds
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async change(req, res, next) {
    try {
      const { currentPin, newPin } = req.body;
      const result = await PinService.changePin(req.user.id, currentPin, newPin);
      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = PinController;
