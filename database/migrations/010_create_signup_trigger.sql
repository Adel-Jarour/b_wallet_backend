-- ============================================================================
-- Migration 010: Create Signup Trigger (handle_new_user)
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Automatically provisions a linked profile row and a default USD wallet
-- when a new user is created in auth.users.
--
-- SECURITY DEFINER: Executes with the privileges of the function creator
-- (superuser/service_role), allowing it to INSERT into public.profiles
-- and public.wallets even when RLS is enabled.
-- ============================================================================

-- ============================================================================
-- Trigger Function: handle_new_user()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, extensions, auth
LANGUAGE plpgsql
AS $$
BEGIN
  -- Step 1: Create a profile row linked to the new auth.users row
  INSERT INTO public.profiles (
    id,
    email,
    phone_number,
    first_name,
    last_name,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.raw_user_meta_data->>'email'),
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone_number'),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NOW(),
    NOW()
  );

  -- Step 2: Create a default USD wallet with $0.00 balance
  INSERT INTO public.wallets (
    id,
    user_id,
    currency,
    balance,
    status,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.id,
    'USD',
    0.00,
    'ACTIVE',
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$;

-- ============================================================================
-- Trigger: Fires after each INSERT on auth.users
-- ============================================================================

-- Drop existing trigger if present (idempotent re-run)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION public.handle_new_user() IS
  'Auto-provisions a profile and default USD wallet ($0.00) when a new user signs up. '
  'Runs with SECURITY DEFINER to bypass RLS.';
