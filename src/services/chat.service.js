/**
 * Chat & Messaging Service
 *
 * Manages conversation threads and message exchanges between users.
 * Supports embedding financial transaction cards into the chat stream.
 * Integrates with Supabase Realtime via PostgreSQL publication.
 */

const { supabaseAdmin } = require('../config/supabase');
const NotificationService = require('./notification.service');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

class ChatService {
  /**
   * Lists active conversation threads for a user, sorted by last activity.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {object} [pagination] - { page, limit }
   * @returns {Promise<object>} Paginated conversations list
   */
  static async listConversations(userId, { page = 1, limit = 20 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Fetch conversations where user is participant_one or participant_two
    const { data: convos, error, count } = await supabaseAdmin
      .from('conversations')
      .select(`
        id,
        participant_one,
        participant_two,
        last_message_text,
        last_message_time,
        created_at,
        updated_at
      `, { count: 'exact' })
      .or(`participant_one.eq.${userId},participant_two.eq.${userId}`)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) {
      logger.error({ err: error.message, userId }, 'Failed to list conversations');
      throw ApiError.internal('Failed to retrieve conversations', 'CONVERSATIONS_FETCH_ERROR');
    }

    if (!convos || !convos.length) {
      return {
        conversations: [],
        total: 0,
        page: pageNum,
        limit: limitNum,
        totalPages: 0
      };
    }

    // Collect all counterparty IDs
    const counterpartyIds = convos.map(c => (c.participant_one === userId ? c.participant_two : c.participant_one));

    // Fetch profiles for counterparties
    const { data: profiles, error: profError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, avatar_url, is_verified, phone_number')
      .in('id', counterpartyIds);

    if (profError) {
      logger.warn({ err: profError.message }, 'Failed to load counterparty profiles');
    }

    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    // Fetch unread message counts for each conversation
    const conversationIds = convos.map(c => c.id);
    const { data: unreadMessages } = await supabaseAdmin
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', conversationIds)
      .neq('sender_id', userId)
      .eq('is_read', false);

    const unreadCountMap = new Map();
    for (const msg of unreadMessages || []) {
      unreadCountMap.set(msg.conversation_id, (unreadCountMap.get(msg.conversation_id) || 0) + 1);
    }

    const formatted = convos.map(c => {
      const counterpartyId = c.participant_one === userId ? c.participant_two : c.participant_one;
      const counterparty = profileMap.get(counterpartyId) || { id: counterpartyId };

      return {
        id: c.id,
        counterparty: {
          id: counterparty.id,
          firstName: counterparty.first_name || null,
          lastName: counterparty.last_name || null,
          fullName: `${counterparty.first_name || ''} ${counterparty.last_name || ''}`.trim() || 'B-Wallet User',
          avatarUrl: counterparty.avatar_url || null,
          isVerified: counterparty.is_verified || false,
          phoneNumber: counterparty.phone_number || null
        },
        lastMessage: c.last_message_text
          ? {
              text: c.last_message_text,
              timestamp: c.last_message_time
            }
          : null,
        unreadCount: unreadCountMap.get(c.id) || 0,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      };
    });

    return {
      conversations: formatted,
      total: count || 0,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil((count || 0) / limitNum)
    };
  }

  /**
   * Retrieves an existing conversation or creates a new one between two users.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {string} counterpartyId - Counterparty UUID
   * @returns {Promise<object>} Conversation details with counterparty profile
   */
  static async getOrCreateConversation(userId, counterpartyId) {
    if (!counterpartyId || typeof counterpartyId !== 'string') {
      throw ApiError.badRequest('A valid counterparty ID is required', 'COUNTERPARTY_REQUIRED');
    }

    if (userId === counterpartyId) {
      throw ApiError.badRequest('You cannot create a conversation with yourself', 'SELF_CONVERSATION_NOT_ALLOWED');
    }

    // Verify counterparty profile exists
    const { data: counterparty, error: cpErr } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, avatar_url, is_verified, phone_number')
      .eq('id', counterpartyId)
      .single();

    if (cpErr || !counterparty) {
      throw ApiError.notFound('Counterparty profile not found', 'USER_NOT_FOUND');
    }

    // Canonical participant ordering (smaller UUID is participant_one)
    const [p1, p2] = userId < counterpartyId ? [userId, counterpartyId] : [counterpartyId, userId];

    // Check if conversation already exists
    const { data: existing, error: findError } = await supabaseAdmin
      .from('conversations')
      .select('id, participant_one, participant_two, last_message_text, last_message_time, created_at, updated_at')
      .eq('participant_one', p1)
      .eq('participant_two', p2)
      .maybeSingle();

    if (findError) {
      logger.error({ err: findError.message, p1, p2 }, 'Failed to check existing conversation');
      throw ApiError.internal('Failed to check conversation', 'CONVERSATION_LOOKUP_ERROR');
    }

    let conversation = existing;

    if (!conversation) {
      // Create new conversation
      const { data: created, error: insertError } = await supabaseAdmin
        .from('conversations')
        .insert({
          participant_one: p1,
          participant_two: p2
        })
        .select('id, participant_one, participant_two, last_message_text, last_message_time, created_at, updated_at')
        .single();

      if (insertError) {
        // Handle race condition where both counterparties initiate simultaneously
        if (insertError.code === '23505') {
          const { data: retryFind } = await supabaseAdmin
            .from('conversations')
            .select('id, participant_one, participant_two, last_message_text, last_message_time, created_at, updated_at')
            .eq('participant_one', p1)
            .eq('participant_two', p2)
            .single();
          conversation = retryFind;
        } else {
          logger.error({ err: insertError.message, p1, p2 }, 'Failed to create conversation');
          throw ApiError.internal('Failed to initiate conversation', 'CONVERSATION_CREATE_ERROR');
        }
      } else {
        conversation = created;
      }
    }

    return {
      id: conversation.id,
      counterparty: {
        id: counterparty.id,
        firstName: counterparty.first_name,
        lastName: counterparty.last_name,
        fullName: `${counterparty.first_name || ''} ${counterparty.last_name || ''}`.trim() || 'B-Wallet User',
        avatarUrl: counterparty.avatar_url,
        isVerified: counterparty.is_verified,
        phoneNumber: counterparty.phone_number
      },
      lastMessage: conversation.last_message_text
        ? {
            text: conversation.last_message_text,
            timestamp: conversation.last_message_time
          }
        : null,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at
    };
  }

  /**
   * Fetches paginated message history for a conversation.
   * Enforces that the requesting user is a verified participant.
   *
   * @param {string} conversationId - Conversation UUID
   * @param {string} userId - Authenticated user UUID
   * @param {object} [options] - { page, limit }
   * @returns {Promise<object>} Paginated messages
   */
  static async getConversationMessages(conversationId, userId, { page = 1, limit = 20 } = {}) {
    // 1. Verify conversation exists and user is participant
    const { data: convo, error: convoErr } = await supabaseAdmin
      .from('conversations')
      .select('id, participant_one, participant_two')
      .eq('id', conversationId)
      .single();

    if (convoErr || !convo) {
      throw ApiError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (convo.participant_one !== userId && convo.participant_two !== userId) {
      throw ApiError.forbidden('You are not a participant in this conversation', 'CHAT_FORBIDDEN');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // 2. Fetch messages ordered by created_at DESC for pagination
    const { data: messages, error: msgErr, count } = await supabaseAdmin
      .from('messages')
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        is_read,
        transaction_id,
        created_at
      `, { count: 'exact' })
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (msgErr) {
      logger.error({ err: msgErr.message, conversationId }, 'Failed to fetch conversation messages');
      throw ApiError.internal('Failed to retrieve messages', 'MESSAGES_FETCH_ERROR');
    }

    // 3. Populate embedded transaction cards if present
    const txIds = (messages || []).map(m => m.transaction_id).filter(Boolean);
    const txMap = new Map();

    if (txIds.length > 0) {
      const { data: transactions } = await supabaseAdmin
        .from('transactions')
        .select('id, transaction_reference, type, status, amount, currency, category, note')
        .in('id', txIds);

      for (const tx of transactions || []) {
        txMap.set(tx.id, {
          id: tx.id,
          reference: tx.transaction_reference,
          type: tx.type,
          status: tx.status,
          amount: parseFloat(tx.amount),
          currency: tx.currency,
          category: tx.category,
          note: tx.note
        });
      }
    }

    // 4. Format messages (return in chronological order for UI rendering)
    const formatted = (messages || [])
      .map(m => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        isOutgoing: m.sender_id === userId,
        content: m.content,
        isRead: m.is_read,
        transaction: m.transaction_id ? txMap.get(m.transaction_id) || { id: m.transaction_id } : null,
        createdAt: m.created_at
      }))
      .reverse(); // Reverse so oldest is first within page

    // 5. Asynchronously mark inbound unread messages as read
    (async () => {
      try {
        await supabaseAdmin
          .from('messages')
          .update({ is_read: true })
          .eq('conversation_id', conversationId)
          .neq('sender_id', userId)
          .eq('is_read', false);
      } catch (e) {
        logger.warn({ err: e.message }, 'Failed to mark messages as read');
      }
    })();

    return {
      conversationId,
      messages: formatted,
      total: count || 0,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil((count || 0) / limitNum)
    };
  }

  /**
   * Sends a message in a conversation.
   *
   * @param {string} conversationId - Conversation UUID
   * @param {string} userId - Authenticated user UUID (sender)
   * @param {object} params - { content, transactionId }
   * @returns {Promise<object>} Created message
   */
  static async sendMessage(conversationId, userId, { content, transactionId = null }) {
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw ApiError.badRequest('Message content cannot be empty', 'MESSAGE_CONTENT_REQUIRED');
    }

    const cleanContent = content.trim();
    if (cleanContent.length > 2000) {
      throw ApiError.badRequest('Message content must not exceed 2000 characters', 'MESSAGE_CONTENT_TOO_LONG');
    }

    // 1. Verify user is participant in conversation
    const { data: convo, error: convoErr } = await supabaseAdmin
      .from('conversations')
      .select('id, participant_one, participant_two')
      .eq('id', conversationId)
      .single();

    if (convoErr || !convo) {
      throw ApiError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
    }

    if (convo.participant_one !== userId && convo.participant_two !== userId) {
      throw ApiError.forbidden('You are not authorized to send messages in this conversation', 'CHAT_FORBIDDEN');
    }

    // 2. Validate transaction_id if provided
    let verifiedTx = null;
    if (transactionId) {
      const { data: tx, error: txErr } = await supabaseAdmin
        .from('transactions')
        .select('id, transaction_reference, type, status, amount, currency, category, note')
        .eq('id', transactionId)
        .single();

      if (txErr || !tx) {
        throw ApiError.badRequest('Invalid or non-existent transaction_id', 'INVALID_TRANSACTION_ID');
      }

      verifiedTx = {
        id: tx.id,
        reference: tx.transaction_reference,
        type: tx.type,
        status: tx.status,
        amount: parseFloat(tx.amount),
        currency: tx.currency,
        category: tx.category,
        note: tx.note
      };
    }

    // 3. Insert message
    const { data: message, error: insertError } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        content: cleanContent,
        transaction_id: transactionId || null,
        is_read: false
      })
      .select('id, conversation_id, sender_id, content, is_read, transaction_id, created_at')
      .single();

    if (insertError) {
      logger.error({ err: insertError.message, conversationId, userId }, 'Failed to insert message');
      throw ApiError.internal('Failed to send message', 'MESSAGE_SEND_ERROR');
    }

    // 4. Update conversation's last message and timestamps
    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from('conversations')
      .update({
        last_message_text: cleanContent.substring(0, 100),
        last_message_time: nowIso,
        updated_at: nowIso
      })
      .eq('id', conversationId);

    // 5. Notify recipient (non-blocking)
    const recipientId = convo.participant_one === userId ? convo.participant_two : convo.participant_one;
    this._notifyMessageRecipient(userId, recipientId, conversationId, cleanContent).catch(e => {
      logger.warn({ err: e.message }, 'Failed to notify message recipient (non-fatal)');
    });

    return {
      id: message.id,
      conversationId: message.conversation_id,
      senderId: message.sender_id,
      isOutgoing: true,
      content: message.content,
      isRead: message.is_read,
      transaction: verifiedTx,
      createdAt: message.created_at
    };
  }

  /**
   * Internal helper: Dispatches push notification for a new message.
   */
  static async _notifyMessageRecipient(senderId, recipientId, conversationId, textPreview) {
    try {
      const { data: sender } = await supabaseAdmin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', senderId)
        .single();

      const senderName = sender ? `${sender.first_name || ''} ${sender.last_name || ''}`.trim() : 'Someone';

      // Send push notification directly to recipient's devices without spamming the in-app notification center table
      await NotificationService._dispatchPushToUser(recipientId, {
        title: senderName || 'New Message',
        body: textPreview.length > 80 ? textPreview.substring(0, 77) + '...' : textPreview,
        metadata: {
          conversationId,
          senderId,
          type: 'NEW_CHAT_MESSAGE'
        }
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to dispatch chat push notification');
    }
  }
}

module.exports = ChatService;
