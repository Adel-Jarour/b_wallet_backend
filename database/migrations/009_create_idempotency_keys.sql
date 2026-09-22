-- ============================================================================
-- Migration 009: Create Idempotency Keys Table
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Dedicated table for idempotent request deduplication (per Decision 3).
-- Caches both in-flight requests and finalized responses, allowing retried
-- requests to return the exact cached JSON payload without touching the
-- ledger again (NFR-INT-002).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The idempotency key value (client-generated UUIDv4)
  key UUID NOT NULL,

  -- The user who submitted the request
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- The API endpoint this key was used for
  endpoint VARCHAR(255) NOT NULL,

  -- Hash of the original request body (for detecting conflicting payloads)
  request_hash VARCHAR(64),

  -- Cached response data
  response_status INTEGER,
  response_body JSONB,

  -- Timestamps and expiration
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  -- ========================================================================
  -- Constraints
  -- ========================================================================

  -- Each user can only use a given key once
  CONSTRAINT uq_idempotency_keys_key_user UNIQUE (key, user_id)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast lookup by key and user (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup
  ON public.idempotency_keys(key, user_id);

-- Cleanup expired keys
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON public.idempotency_keys(expires_at);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.idempotency_keys IS 'Idempotent request deduplication cache. Prevents duplicate financial operations (Decision 3, NFR-INT-002).';
COMMENT ON COLUMN public.idempotency_keys.key IS 'Client-generated UUIDv4 sent via X-Idempotency-Key header.';
COMMENT ON COLUMN public.idempotency_keys.request_hash IS 'SHA-256 hash of the original request body for conflict detection.';
COMMENT ON COLUMN public.idempotency_keys.expires_at IS 'Keys expire after 24 hours to allow reuse.';
