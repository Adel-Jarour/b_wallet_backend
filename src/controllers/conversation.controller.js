/**
 * Conversation & Chat Controller
 *
 * Exposes endpoints for managing social chat threads and sending messages
 * with optional embedded transaction action cards.
 */

const ChatService = require('../services/chat.service');

/**
 * GET /api/v1/conversations
 * List active conversation threads with last message preview and unread count.
 */
async function listConversations(req, res, next) {
  try {
    const userId = req.userId;
    const { page, limit } = req.query;

    const result = await ChatService.listConversations(userId, { page, limit });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/conversations
 * Start or retrieve a conversation thread with another user.
 */
async function getOrCreateConversation(req, res, next) {
  try {
    const userId = req.userId;
    const participantId =
      req.body.participantId ||
      req.body.participant_id ||
      req.body.recipientId ||
      req.body.recipient_id;

    const conversation = await ChatService.getOrCreateConversation(userId, participantId);

    return res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/conversations/:id/messages
 * Get paginated message history for a conversation thread.
 */
async function getConversationMessages(req, res, next) {
  try {
    const userId = req.userId;
    const conversationId = req.params.id;
    const { page, limit } = req.query;

    const result = await ChatService.getConversationMessages(conversationId, userId, { page, limit });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/conversations/:id/messages
 * Send a message within a conversation (with optional transaction_id).
 */
async function sendMessage(req, res, next) {
  try {
    const userId = req.userId;
    const conversationId = req.params.id;
    const { content, transactionId, transaction_id } = req.body;

    const message = await ChatService.sendMessage(conversationId, userId, {
      content,
      transactionId: transactionId || transaction_id || null
    });

    return res.status(201).json({
      success: true,
      data: message
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listConversations,
  getOrCreateConversation,
  getConversationMessages,
  sendMessage
};
