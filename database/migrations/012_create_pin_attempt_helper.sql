-- ============================================================================
-- Migration 012: Create PIN Attempt Tracking Helper Function
-- B-Wallet FinTech Database Schema (Sprint 2)
-- ============================================================================
-- Atomically updates failed PIN attempts and lockout timestamps on profiles.
-- Prevents race conditions during concurrent PIN verification requests.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_pin_attempt(
  p_user_id UUID,
  p_success BOOLEAN
)
RETURNS TABLE (
  pin_failed_attempts INTEGER,
  pin_locked_until TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public, extensions
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_success THEN
    RETURN QUERY
    UPDATE public.profiles
    SET
      pin_failed_attempts = 0,
      pin_locked_until = NULL,
      updated_at = NOW()
    WHERE id = p_user_id
    RETURNING profiles.pin_failed_attempts, profiles.pin_locked_until;
  ELSE
    RETURN QUERY
    UPDATE public.profiles
    SET
      pin_failed_attempts = profiles.pin_failed_attempts + 1,
      pin_locked_until = CASE
        WHEN profiles.pin_failed_attempts + 1 >= 3 THEN NOW() + INTERVAL '15 minutes'
        ELSE NULL
      END,
      updated_at = NOW()
    WHERE id = p_user_id
    RETURNING profiles.pin_failed_attempts, profiles.pin_locked_until;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.record_pin_attempt IS
  'Atomically records PIN verification success or failure, locking for 15 minutes upon 3 failures.';
