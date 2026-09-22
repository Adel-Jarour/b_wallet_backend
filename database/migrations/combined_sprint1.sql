-- ============================================================================
-- B-WALLET SPRINT 1 COMPLETE DATABASE INITIALIZATION
-- ============================================================================
-- Contains:
-- 1. Helper RPC functions (exec_sql, query_sql)
-- 2. 001_extensions_and_types.sql
-- 3. 002_create_profiles.sql
-- 4. 003_create_wallets.sql
-- 5. 004_create_transactions_and_ledger.sql
-- 6. 005_create_saved_cards.sql
-- 7. 006_create_social_tables.sql
-- 8. 007_create_notifications.sql
-- 9. 008_create_payment_requests.sql
-- 10. 009_create_idempotency_keys.sql
-- 11. 010_create_signup_trigger.sql
-- 12. 011_enable_rls_policies.sql
-- ============================================================================

-- ============================================================================
-- PART 0: HELPER RPC FUNCTIONS (FOR TEST RUNNER & FUTURE MIGRATIONS)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.exec_sql(sql_query TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $fn$
BEGIN
  EXECUTE sql_query;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.query_sql(sql_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $fn$
DECLARE
  result JSONB;
BEGIN
  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || sql_query || ') t'
    INTO result;
  RETURN result;
END;
$fn$;

-- ============================================================================
-- PART 1: EXTENSIONS & ENUM TYPES (001_extensions_and_types.sql)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM (
    'TOP_UP',
    'TRANSFER',
    'REQUEST',
    'BILL_PAYMENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_status AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED',
    'REVERSED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE entry_direction AS ENUM (
    'DEBIT',
    'CREDIT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_category AS ENUM (
    'TRANSACTIONS',
    'PROMOS',
    'SYSTEM'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Shared timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 2: PROFILES TABLE (002_create_profiles.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone_number VARCHAR(20),
  email VARCHAR(255),
  date_of_birth DATE,
  avatar_url TEXT,
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_phone_number
  ON public.profiles(phone_number)
  WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles(email)
  WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;
CREATE TRIGGER trigger_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- PART 3: WALLETS TABLE (003_create_wallets.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  balance NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0.00),
  CONSTRAINT uq_wallets_user_currency UNIQUE (user_id, currency),
  CONSTRAINT chk_wallets_currency_length CHECK (char_length(currency) = 3)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id
  ON public.wallets(user_id);

DROP TRIGGER IF EXISTS trigger_wallets_updated_at ON public.wallets;
CREATE TRIGGER trigger_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- PART 4: TRANSACTIONS & LEDGER (004_create_transactions_and_ledger.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_reference VARCHAR(50) NOT NULL UNIQUE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL,
  fee NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  type transaction_type NOT NULL,
  status transaction_status NOT NULL DEFAULT 'PENDING',
  category VARCHAR(50),
  note TEXT,
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  CONSTRAINT chk_transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_transactions_fee_non_negative CHECK (fee >= 0),
  CONSTRAINT chk_transactions_currency_length CHECK (char_length(currency) = 3),
  CONSTRAINT uq_transactions_idempotency_key UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  direction entry_direction NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ledger_entries_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_transactions_reference ON public.transactions(transaction_reference);
CREATE INDEX IF NOT EXISTS idx_transactions_sender_id ON public.transactions(sender_id) WHERE sender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_receiver_id ON public.transactions(receiver_id) WHERE receiver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_idempotency_key ON public.transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction_id ON public.ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_id ON public.ledger_entries(wallet_id);

-- ============================================================================
-- PART 5: SAVED CARDS (005_create_saved_cards.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.saved_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gateway_customer_id VARCHAR(255),
  gateway_payment_method_id VARCHAR(255) NOT NULL,
  brand VARCHAR(20) NOT NULL
    CHECK (brand IN ('Visa', 'MasterCard', 'Amex', 'Discover', 'UnionPay', 'JCB', 'Other')),
  last4 CHAR(4) NOT NULL
    CHECK (last4 ~ '^\d{4}$'),
  expiry_month INTEGER NOT NULL,
  expiry_year INTEGER NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_saved_cards_expiry_month CHECK (expiry_month BETWEEN 1 AND 12),
  CONSTRAINT chk_saved_cards_expiry_year CHECK (expiry_year >= 2026)
);

CREATE INDEX IF NOT EXISTS idx_saved_cards_user_id ON public.saved_cards(user_id);

-- ============================================================================
-- PART 6: CONVERSATIONS & MESSAGES (006_create_social_tables.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_one UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_two UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_message_text TEXT,
  last_message_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_conversations_different_participants CHECK (participant_one <> participant_two),
  CONSTRAINT uq_conversations_participants UNIQUE (participant_one, participant_two)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_participant_one ON public.conversations(participant_one);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_two ON public.conversations(participant_two);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);

DROP TRIGGER IF EXISTS trigger_conversations_updated_at ON public.conversations;
CREATE TRIGGER trigger_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- PART 7: NOTIFICATIONS (007_create_notifications.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  category notification_category NOT NULL DEFAULT 'SYSTEM',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_category ON public.notifications(user_id, category, created_at DESC);

-- ============================================================================
-- PART 8: PAYMENT REQUESTS (008_create_payment_requests.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  category VARCHAR(50),
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED')),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payment_requests_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_payment_requests_currency_length CHECK (char_length(currency) = 3),
  CONSTRAINT chk_payment_requests_different_users CHECK (requester_id <> payer_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_requester_id ON public.payment_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_payer_id ON public.payment_requests(payer_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status);

DROP TRIGGER IF EXISTS trigger_payment_requests_updated_at ON public.payment_requests;
CREATE TRIGGER trigger_payment_requests_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- PART 9: IDEMPOTENCY KEYS (009_create_idempotency_keys.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64),
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT uq_idempotency_keys_key_user UNIQUE (key, user_id)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup ON public.idempotency_keys(key, user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON public.idempotency_keys(expires_at);

-- ============================================================================
-- PART 10: SIGNUP TRIGGER (010_create_signup_trigger.sql)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, extensions, auth
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Profile provisioning
  INSERT INTO public.profiles (
    id, email, phone_number, first_name, last_name, created_at, updated_at
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.raw_user_meta_data->>'email'),
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone_number'),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NOW(),
    NOW()
  );

  -- 2. Default USD wallet provisioning with $0.00 balance
  INSERT INTO public.wallets (
    id, user_id, currency, balance, status, created_at, updated_at
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- PART 11: ROW LEVEL SECURITY POLICIES (011_enable_rls_policies.sql)
-- ============================================================================

-- PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- WALLETS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallets_select_own" ON public.wallets;
CREATE POLICY "wallets_select_own" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- TRANSACTIONS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions_select_own" ON public.transactions;
CREATE POLICY "transactions_select_own" ON public.transactions FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- LEDGER ENTRIES
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger_entries_select_own" ON public.ledger_entries;
CREATE POLICY "ledger_entries_select_own" ON public.ledger_entries FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.wallets WHERE wallets.id = ledger_entries.wallet_id AND wallets.user_id = auth.uid()
  )
);

-- SAVED CARDS
ALTER TABLE public.saved_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_cards_select_own" ON public.saved_cards;
CREATE POLICY "saved_cards_select_own" ON public.saved_cards FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "saved_cards_delete_own" ON public.saved_cards;
CREATE POLICY "saved_cards_delete_own" ON public.saved_cards FOR DELETE USING (auth.uid() = user_id);

-- CONVERSATIONS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversations_select_own" ON public.conversations;
CREATE POLICY "conversations_select_own" ON public.conversations FOR SELECT USING (auth.uid() = participant_one OR auth.uid() = participant_two);

-- MESSAGES
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_own" ON public.messages;
CREATE POLICY "messages_select_own" ON public.messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversations WHERE conversations.id = messages.conversation_id
      AND (conversations.participant_one = auth.uid() OR conversations.participant_two = auth.uid())
  )
);
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
CREATE POLICY "messages_insert_own" ON public.messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND EXISTS (
    SELECT 1 FROM public.conversations WHERE conversations.id = conversation_id
      AND (conversations.participant_one = auth.uid() OR conversations.participant_two = auth.uid())
  )
);

-- NOTIFICATIONS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PAYMENT REQUESTS
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_requests_select_own" ON public.payment_requests;
CREATE POLICY "payment_requests_select_own" ON public.payment_requests FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = payer_id);

-- IDEMPOTENCY KEYS
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "idempotency_keys_select_own" ON public.idempotency_keys;
CREATE POLICY "idempotency_keys_select_own" ON public.idempotency_keys FOR SELECT USING (auth.uid() = user_id);
