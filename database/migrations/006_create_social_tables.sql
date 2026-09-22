-- ============================================================================
-- Migration 006: Create Social Tables (Conversations & Messages)
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Conversations: Chat session headers between two counterparties.
-- Messages: Individual chat messages within conversations, with optional
-- embedded transaction references for financial action cards.
-- ============================================================================

-- ============================================================================
-- Conversations Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Participants (both required, referencing profiles)
  participant_one UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_two UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Denormalized last message preview (for conversation list UI)
  last_message_text TEXT,
  last_message_time TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ========================================================================
  -- Constraints
  -- ========================================================================

  -- Prevent self-conversations
  CONSTRAINT chk_conversations_different_participants
    CHECK (participant_one <> participant_two),

  -- Ensure only one conversation exists between any two users
  -- Store the smaller UUID in participant_one for consistent uniqueness
  CONSTRAINT uq_conversations_participants
    UNIQUE (participant_one, participant_two)
);

-- ============================================================================
-- Messages Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Parent conversation
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,

  -- Message sender (must be a participant of the conversation)
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Message content
  content TEXT NOT NULL,

  -- Read status
  is_read BOOLEAN NOT NULL DEFAULT FALSE,

  -- Optional embedded transaction reference (for financial action cards)
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast conversation lookup by participant
CREATE INDEX IF NOT EXISTS idx_conversations_participant_one
  ON public.conversations(participant_one);

CREATE INDEX IF NOT EXISTS idx_conversations_participant_two
  ON public.conversations(participant_two);

-- Fast message listing within a conversation (chronological order)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON public.messages(conversation_id, created_at DESC);

-- Fast unread message lookup
CREATE INDEX IF NOT EXISTS idx_messages_sender_id
  ON public.messages(sender_id);

-- ============================================================================
-- Auto-update updated_at timestamp trigger for conversations
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_conversations_updated_at ON public.conversations;
CREATE TRIGGER trigger_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.conversations IS 'Chat session headers between two counterparties. Each pair of users has at most one conversation.';
COMMENT ON TABLE public.messages IS 'Individual chat messages with optional embedded transaction references for financial action cards.';
COMMENT ON COLUMN public.messages.transaction_id IS 'Optional FK to transactions table for embedded financial action cards in chat.';
