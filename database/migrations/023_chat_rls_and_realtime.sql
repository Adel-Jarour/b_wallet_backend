-- ============================================================================
-- Migration 023: Chat RLS Hardening and Supabase Realtime Publication
-- B-Wallet FinTech Database Schema - Sprint 8
-- ============================================================================
-- 1. Hardens RLS policies for conversations and messages.
-- 2. Adds conversations INSERT and UPDATE policies.
-- 3. Adds messages UPDATE policy (marking messages as read).
-- 4. Registers public.messages in supabase_realtime publication for WebSocket broadcast.
-- ============================================================================

-- 1. Conversations RLS Policies
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Allow participants to insert a conversation between themselves and another user
DROP POLICY IF EXISTS "conversations_insert_own" ON public.conversations;
CREATE POLICY "conversations_insert_own"
  ON public.conversations
  FOR INSERT
  WITH CHECK (
    auth.uid() = participant_one OR auth.uid() = participant_two
  );

-- Allow participants to update last message preview and timestamps
DROP POLICY IF EXISTS "conversations_update_own" ON public.conversations;
CREATE POLICY "conversations_update_own"
  ON public.conversations
  FOR UPDATE
  USING (
    auth.uid() = participant_one OR auth.uid() = participant_two
  )
  WITH CHECK (
    auth.uid() = participant_one OR auth.uid() = participant_two
  );

-- 2. Messages RLS Policies
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Allow participants to update messages (e.g., mark as read)
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
CREATE POLICY "messages_update_own"
  ON public.messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND (conversations.participant_one = auth.uid()
             OR conversations.participant_two = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND (conversations.participant_one = auth.uid()
             OR conversations.participant_two = auth.uid())
    )
  );

-- 3. Supabase Realtime Publication for Messages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
