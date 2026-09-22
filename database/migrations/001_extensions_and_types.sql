-- ============================================================================
-- Migration 001: Extensions and Custom Enum Types
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- This migration enables required PostgreSQL extensions and creates custom
-- enumerated types used throughout the B-Wallet schema.
-- ============================================================================

-- Enable UUID generation support
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable cryptographic functions (used for hashing, random bytes, etc.)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- Custom Enum Types
-- ============================================================================

-- Transaction types representing all possible financial operations
DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM (
    'TOP_UP',          -- Fund inflow from external payment source
    'TRANSFER',        -- Peer-to-peer fund transfer between users
    'REQUEST',         -- Settlement of a payment request
    'BILL_PAYMENT'     -- Bill or utility payment
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Transaction lifecycle states
DO $$ BEGIN
  CREATE TYPE transaction_status AS ENUM (
    'PENDING',         -- Transaction initiated but not yet settled
    'COMPLETED',       -- Transaction successfully settled
    'FAILED',          -- Transaction failed during processing
    'REVERSED'         -- Transaction reversed after completion
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Double-entry ledger direction
DO $$ BEGIN
  CREATE TYPE entry_direction AS ENUM (
    'DEBIT',           -- Money leaving a wallet (outflow)
    'CREDIT'           -- Money entering a wallet (inflow)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Notification categories for in-app notification center
DO $$ BEGIN
  CREATE TYPE notification_category AS ENUM (
    'TRANSACTIONS',    -- Transaction-related alerts (credits, debits, requests)
    'PROMOS',          -- Promotional offers and marketing messages
    'SYSTEM'           -- System alerts and security notifications
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
