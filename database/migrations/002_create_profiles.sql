-- ============================================================================
-- Migration 002: Create Profiles Table
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- The profiles table extends auth.users with application-specific user data
-- and transaction PIN security fields. Each auth.users row maps to exactly
-- one profiles row (1:1 relationship enforced by PK = FK).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  -- Primary key is the same UUID as auth.users.id (1:1 relationship)
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Personal information
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone_number VARCHAR(20),
  email VARCHAR(255),
  date_of_birth DATE,
  avatar_url TEXT,

  -- Transaction PIN security fields (managed by Node.js PIN service)
  -- pin_hash stores the Argon2id hash; NEVER stores plaintext PIN
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,

  -- Account verification status
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast lookup by phone number (used for P2P transfers by phone)
CREATE INDEX IF NOT EXISTS idx_profiles_phone_number
  ON public.profiles(phone_number)
  WHERE phone_number IS NOT NULL;

-- Fast lookup by email (used for P2P transfers by email)
CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles(email)
  WHERE email IS NOT NULL;

-- ============================================================================
-- Auto-update updated_at timestamp trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.profiles IS 'User profile attributes and transaction PIN security fields. 1:1 with auth.users.';
COMMENT ON COLUMN public.profiles.pin_hash IS 'Argon2id hash of the 6-digit transaction PIN. NEVER stores plaintext.';
COMMENT ON COLUMN public.profiles.pin_failed_attempts IS 'Consecutive failed PIN verification attempts. Resets to 0 on success.';
COMMENT ON COLUMN public.profiles.pin_locked_until IS 'Timestamp until which PIN verification is locked (15-min lockout after 3 failures).';
