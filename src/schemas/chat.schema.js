const { z } = require('zod');

/**
 * Schema for POST /api/v1/conversations
 * Initiates or retrieves an existing conversation thread with a counterparty.
 */
const createConversationSchema = z.object({
  participantId: z.string().uuid('participantId must be a valid UUID').optional(),
  participant_id: z.string().uuid('participant_id must be a valid UUID').optional(),
  recipientId: z.string().uuid('recipientId must be a valid UUID').optional(),
  recipient_id: z.string().uuid('recipient_id must be a valid UUID').optional()
}).refine(
  data => Boolean(data.participantId || data.participant_id || data.recipientId || data.recipient_id),
  {
    message: 'participantId (or participant_id) is required',
    path: ['participantId']
  }
);

/**
 * Schema for POST /api/v1/conversations/:id/messages
 * Sends a chat message with optional embedded transaction card.
 */
const sendMessageSchema = z.object({
  content: z
    .string({ required_error: 'content is required' })
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(2000, 'Message content must not exceed 2000 characters'),
  transactionId: z.string().uuid('transactionId must be a valid UUID').optional().nullable(),
  transaction_id: z.string().uuid('transaction_id must be a valid UUID').optional().nullable()
});

/**
 * Schema for GET /api/v1/conversations/:id/messages query
 */
const conversationMessagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20).optional(),
  before: z.string().datetime().optional()
});

/**
 * Schema for GET /api/v1/conversations query
 */
const conversationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20).optional()
});

/**
 * Schema for conversation UUID route parameter
 */
const conversationIdParamSchema = z.object({
  id: z.string().uuid('Invalid conversation ID format')
});

module.exports = {
  createConversationSchema,
  sendMessageSchema,
  conversationMessagesQuerySchema,
  conversationListQuerySchema,
  conversationIdParamSchema
};
