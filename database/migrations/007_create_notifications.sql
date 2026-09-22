-- ============================================================================
-- Migration 007: Create Notifications Table
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Backs the in-app notification center (/notify) with persistent storage.
-- Categorized into TRANSACTIONS, PROMOS, and SYSTEM ALERTS with
-- mark-as-read capability (FR-NOT-002, FR-NOT-003).
-- Per Architectural Decision 1: Dedicated notifications table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Notification recipient
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Notification content
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,

  -- Category for grouping in the notification center UI
  category notification_category NOT NULL DEFAULT 'SYSTEM',

  -- Read status (supports "mark as read" feature)
  is_read BOOLEAN NOT NULL DEFAULT FALSE,

  -- Flexible metadata for additional context (e.g., transaction_id, deep_link)
  metadata JSONB DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Primary query pattern: "Get my unread notifications" (sorted by time)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);

-- Query by user and category (for filtered notification views)
CREATE INDEX IF NOT EXISTS idx_notifications_user_category
  ON public.notifications(user_id, category, created_at DESC);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.notifications IS 'Persistent in-app notification center storage. Categorized into TRANSACTIONS, PROMOS, and SYSTEM alerts.';
COMMENT ON COLUMN public.notifications.metadata IS 'JSONB metadata for additional context (e.g., transaction_id, deep_link_url, sender_name).';
