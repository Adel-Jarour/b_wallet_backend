# Atomic Transfers, Concurrency, and Idempotency Architecture

## Overview

Peer-to-Peer (P2P) transfers in B-Wallet are mission-critical financial operations (`FR-TX-001` through `FR-TX-005`). They must be completely immune to race conditions, partial debits, duplicate debits, deadlocks, and ledger imbalances.

This document details the architectural mechanisms employed to guarantee strict consistency, ACID guarantees, idempotent execution, and mathematically balanced double-entry bookkeeping across concurrent environments.

---

## 1. Database-Level Atomicity (`transfer_funds_atomic`)

All mutations involved in a transfer occur inside a single PostgreSQL stored procedure (`transfer_funds_atomic`) executing within one implicit database transaction.

### Operations Performed in Single Unit of Work
1. **Boundary Authorization**: If an `auth.uid()` context is present, verifies that the caller matches `p_sender_id` (`ERRCODE = 42501`).
2. **Wallet Existence & Lock Acquisition**: Locks sender, receiver, and system fee wallet rows in a single deterministic query ordered by UUIDs.
3. **State & Ownership Verification**: Ensures all wallets are in `ACTIVE` status and belong to the verified sender and resolved receiver.
4. **Sufficient Balance Check**: Ensures $\text{Sender Available Balance} \ge \text{Amount} + \text{Fee}$ using PostgreSQL exact fixed-point `NUMERIC(15,2)`.
5. **Sender Wallet Debit**: Deducts $\text{Amount} + \text{Fee}$ from sender wallet.
6. **Receiver Wallet Credit**: Adds $\text{Amount}$ to receiver wallet.
7. **System Fee Wallet Credit**: If $\text{Fee} > 0$, credits $\text{Fee}$ to the designated platform fee wallet.
8. **Transaction Record Creation**: Inserts immutable row in `public.transactions` with status `COMPLETED`, unique `transaction_reference`, and `idempotency_key`.
9. **Double-Entry Ledger Insertion**: Inserts balancing records into `public.ledger_entries`:
   - `DEBIT` on sender wallet with $\text{Amount} + \text{Fee}$.
   - `CREDIT` on receiver wallet with $\text{Amount}$.
   - `CREDIT` on platform fee wallet with $\text{Fee}$ (when $\text{Fee} > 0$).
10. **Receipt Generation**: Returns consolidated JSON receipt with post-settlement balances.

If any check fails or any exception is raised, PostgreSQL triggers an **implicit rollback**, restoring all balances and tables to their exact pre-transaction state. No partial state can persist.

---

## 2. Double-Entry Ledger Fee Accounting (Mathematical Proof)

Double-entry bookkeeping mandates that for every transaction:
$$\sum \text{Debits} = \sum \text{Credits}$$

### Scenario A: Transfer Without Fee ($\text{Fee} = \$0.00$)
- **Amount**: $\$50.00$
- **Fee**: $\$0.00$
- **Ledger Entries Generated**:
  1. `DEBIT` Sender Wallet = $\$50.00$
  2. `CREDIT` Receiver Wallet = $\$50.00$
- **Balance Verification**:
  $$\sum \text{DEBIT} = \$50.00 \quad \longleftrightarrow \quad \sum \text{CREDIT} = \$50.00$$
  $$\text{Net Discrepancy} = \$0.00$$

### Scenario B: Transfer With Fee ($\text{Fee} = \$2.00$)
- **Amount**: $\$50.00$
- **Fee**: $\$2.00$
- **Ledger Entries Generated**:
  1. `DEBIT` Sender Wallet = $\$52.00$ (Principal $\$50.00$ + Fee $\$2.00$)
  2. `CREDIT` Receiver Wallet = $\$50.00$ (Principal transferred to recipient)
  3. `CREDIT` System Fee Wallet = $\$2.00$ (Fee collected by B-Wallet Platform)
- **Balance Verification**:
  $$\sum \text{DEBIT} = \$52.00 \quad \longleftrightarrow \quad \sum \text{CREDIT} = \$50.00 + \$2.00 = \$52.00$$
  $$\text{Net Discrepancy} = \$0.00$$

### Platform Fee Account Architecture
- The system fee account is represented in `public.wallets` with:
  - `wallet_type = 'SYSTEM_FEE'`
  - `user_id = NULL`
  - `currency = 'USD'`
  - Fixed deterministic UUID: `00000000-0000-0000-0000-000000000001`
- A partial unique index (`uq_wallets_system_fee_currency`) guarantees exactly one fee wallet per currency.
- Financial audit via `verify_wallet_integrity` evaluates both user wallets and system fee wallets with zero discrepancies.

---

## 3. SECURITY DEFINER Hardening

To guarantee that the elevated privileges of `SECURITY DEFINER` cannot be exploited:

1. **Explicit Search Path**:
   ```sql
   SET search_path = public, pg_temp;
   ```
   Prevents search path hijacking where an attacker creates malicious functions or tables in temporary schemas.

2. **Privilege Revocation**:
   ```sql
   REVOKE ALL ON FUNCTION public.transfer_funds_atomic FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.transfer_funds_atomic FROM anon, authenticated;
   GRANT EXECUTE ON FUNCTION public.transfer_funds_atomic TO service_role;
   ```
   Direct client invocation via Supabase client libraries (anonymous or authenticated JWT) is blocked at the database engine level. Only the trusted Node.js backend using the `service_role` key can invoke the RPC.

3. **Database Boundary Authorization**:
   ```sql
   IF auth.uid() IS NOT NULL AND auth.uid() != p_sender_id THEN
     RAISE EXCEPTION 'Authorization violation: caller auth.uid (%) does not match sender (%)',
       auth.uid(), p_sender_id
       USING ERRCODE = '42501';
   END IF;
   ```
   Even if an authenticated context reaches the procedure, the function refuses execution if the caller's verified `auth.uid()` does not match `p_sender_id`.

---

## 4. Deadlock Prevention via Deterministic Row Locking

When multiple concurrent transactions attempt reciprocal transfers (e.g. User A transfers to User B while User B transfers to User A), acquiring locks in arbitrary order causes a deadlock cycle.

### Deterministic Order Across N Wallets
To eliminate deadlocks, `transfer_funds_atomic` locks all affected wallets (2 wallets if fee = 0, 3 wallets if fee > 0) in a single deterministic query ordered by UUID:

```sql
PERFORM 1 FROM public.wallets
WHERE id IN (
  v_sender_wallet.id,
  v_receiver_wallet.id,
  CASE WHEN p_fee > 0 THEN v_fee_wallet.id ELSE v_sender_wallet.id END
)
ORDER BY id
FOR UPDATE;
```

Because all concurrent transactions acquire row locks in identical lexicographical order ($W_1 \rightarrow W_2 \rightarrow W_3$), a circular wait graph is impossible, preventing deadlocks entirely.

---

## 5. Transaction Ticket Security & Replay Prevention

When a user authorizes a transfer using a transaction authorization ticket (`transactionTicket`), the system enforces:

1. **Unique Cryptographic JTI**:
   Every ticket issued by `PinService` embeds a cryptographically random UUID (`jti`) within its HMAC-SHA256 signed payload.
2. **Single-Use Enforcement (`consumeTransactionTicket`)**:
   Upon first transfer execution, the ticket's `jti` is recorded in `public.used_transaction_tickets`. Any subsequent attempt to reuse the same ticket is rejected immediately with HTTP 401 (`TICKET_ALREADY_USED`).
3. **User & Purpose Binding**:
   The ticket is cryptographically bound to `payload.userId === senderId` and `payload.purpose === 'TRANSACTION'`. User A cannot authorize User B's transfers.
4. **Parameter Binding (Optional)**:
   Tickets can optionally bind to a transfer hash (`sha256(amount + recipient)`), guaranteeing that the ticket cannot be used for any amount or recipient other than what was authorized during PIN verification.
5. **5-Minute Validity Window**:
   Tickets strictly expire 5 minutes after issuance (`TICKET_TTL_MS = 300,000ms`).

---

## 6. Idempotency Guarantees (`checkIdempotency`)

Every financial mutation endpoint requires the `X-Idempotency-Key` header with a client-generated UUIDv4 (`NFR-INT-002`).

- **In-flight Detection**: Returns HTTP 409 Conflict if an identical key is already being processed.
- **Conflict Detection**: Returns HTTP 422 Unprocessable Entity if an existing key is reused with altered parameters.
- **Cache Replay**: Replays exact cached response without re-executing ledger mutations.
- **Fault-Tolerant Cleanup**: Deletes unfinalized in-flight placeholders if a request fails with an error status (4xx/5xx), permitting user retries.
