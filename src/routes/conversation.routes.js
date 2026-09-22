const express = require('express');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const {
  createConversationSchema,
  sendMessageSchema,
  conversationMessagesQuerySchema,
  conversationListQuerySchema,
  conversationIdParamSchema
} = require('../schemas/chat.schema');
const {
  listConversations,
  getOrCreateConversation,
  getConversationMessages,
  sendMessage
} = require('../controllers/conversation.controller');

const router = express.Router();

// All conversation routes require an authenticated user
router.use(authenticate);

/**
 * GET /api/v1/conversations
 * List active conversations with last message preview and unread count
 */
router.get('/', validate(conversationListQuerySchema, 'query'), listConversations);

/**
 * POST /api/v1/conversations
 * Start or retrieve a conversation with a counterparty
 */
router.post('/', validate(createConversationSchema, 'body'), getOrCreateConversation);

/**
 * GET /api/v1/conversations/:id/messages
 * Get paginated message history for a conversation
 */
router.get(
  '/:id/messages',
  validate(conversationIdParamSchema, 'params'),
  validate(conversationMessagesQuerySchema, 'query'),
  getConversationMessages
);

/**
 * POST /api/v1/conversations/:id/messages
 * Send a message within a conversation (with optional transaction_id)
 */
router.post(
  '/:id/messages',
  validate(conversationIdParamSchema, 'params'),
  validate(sendMessageSchema, 'body'),
  sendMessage
);

module.exports = router;
