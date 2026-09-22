const express = require('express');
const ProfileController = require('../controllers/profile.controller');
const validate = require('../middlewares/validate');
const { authenticateJwt } = require('../middlewares/auth');
const { updateProfileSchema } = require('../schemas/profile.schema');

const router = express.Router();

// All profile routes require valid JWT authentication
router.use(authenticateJwt);

// GET /api/v1/profile/me - Returns current authenticated user profile (pin_hash strictly omitted)
router.get('/me', ProfileController.getMe);

// PATCH /api/v1/profile/me - Updates personal profile details
router.patch('/me', validate(updateProfileSchema), ProfileController.updateMe);

module.exports = router;
