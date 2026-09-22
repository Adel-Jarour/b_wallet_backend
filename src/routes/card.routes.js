const express = require('express');
const { authenticateJwt } = require('../middlewares/auth');
const cardController = require('../controllers/card.controller');

const router = express.Router();

// All card routes require authenticated JWT
router.use(authenticateJwt);

// POST /api/v1/cards - Save tokenized card
router.post('/', cardController.saveCard);

// GET /api/v1/cards - List saved cards
router.get('/', cardController.listCards);

// PATCH /api/v1/cards/:id/default - Set card as default
router.patch('/:id/default', cardController.setDefaultCard);

// DELETE /api/v1/cards/:id - Delete saved card
router.delete('/:id', cardController.deleteCard);

module.exports = router;
