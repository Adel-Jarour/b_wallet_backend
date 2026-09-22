# Payment Requests State Machine

**Module:** Sprint 5 — Payment Requests & Invoicing Engine  
**SRS References:** FR-REQ-001, FR-REQ-002, FR-REQ-003, FR-REQ-004

---

## State Transition Diagram

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    Payment Request                      │
                    │                                                         │
                    │    POST /api/v1/requests                                │
                    │    requester_id = auth.uid()                            │
                    │    payer_id = resolved payer                            │
                    └────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
                                   ┌───────────┐
                                   │  PENDING  │   (initial state)
                                   └─────┬─────┘
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               │                         │                         │
               ▼                         ▼                         ▼
    POST /:id/pay              POST /:id/decline         POST /:id/cancel
    (payer only)               (payer only)              (requester only)
    Requires PIN or ticket      No PIN needed             No PIN needed
    Requires X-Idempotency-Key
               │                         │                         │
               ▼                         ▼                         ▼
       ┌─────────────┐           ┌─────────────┐         ┌──────────────┐
       │  COMPLETED  │           │  DECLINED   │         │  CANCELLED   │
       └─────────────┘           └─────────────┘         └──────────────┘
        (terminal)                 (terminal)               (terminal)
```

---

## States

| State | Description | Who Sets It |
|---|---|---|
| `PENDING` | Request is awaiting action from the payer | System (on creation) |
| `COMPLETED` | Request was paid; linked `transaction_id` is set | `settle_payment_request_atomic` RPC |
| `DECLINED` | Payer explicitly rejected the request | Payer via `POST /:id/decline` |
| `CANCELLED` | Requester withdrew the request | Requester via `POST /:id/cancel` |

All terminal states (`COMPLETED`, `DECLINED`, `CANCELLED`) are **immutable** — no further transitions are possible.

---

## Transitions

### PENDING → COMPLETED

**Endpoint:** `POST /api/v1/requests/:id/pay`

**Actor:** Payer (`payer_id`)

**Authorization:** Valid 6-digit PIN or consumed transaction ticket

**Required Header:** `X-Idempotency-Key: <UUIDv4>`

**Database Effects (atomic):**
1. `payment_requests.status` → `COMPLETED`
2. `payment_requests.transaction_id` → linked transaction UUID
3. `wallets.balance` (payer) decremented by `amount`
4. `wallets.balance` (requester) incremented by `amount`
5. `transactions` record inserted with `type = 'REQUEST'`, `status = 'COMPLETED'`
6. `ledger_entries` — DEBIT (payer wallet) + CREDIT (requester wallet) — balanced

**Error Conditions:**
- `REQUEST_NOT_FOUND` (404) — request ID does not exist
- `REQUEST_PAY_FORBIDDEN` (403) — caller is not the payer
- `REQUEST_NOT_PENDING` (400) — request is not in PENDING state
- `INCORRECT_PIN` (400) — wrong PIN supplied
- `PIN_LOCKED` (423) — payer PIN is locked due to failed attempts
- `INSUFFICIENT_FUNDS` (400) — payer wallet balance < requested amount
- `WALLET_INACTIVE` (400) — payer or requester wallet is not ACTIVE
- `IDEMPOTENCY_KEY_MISSING` (400) — X-Idempotency-Key header absent

---

### PENDING → DECLINED

**Endpoint:** `POST /api/v1/requests/:id/decline`

**Actor:** Payer (`payer_id`)

**Authorization:** JWT only (no PIN required)

**Database Effects:**
1. `payment_requests.status` → `DECLINED`
2. `payment_requests.updated_at` → NOW()

**Error Conditions:**
- `REQUEST_NOT_FOUND` (404)
- `REQUEST_DECLINE_FORBIDDEN` (403) — caller is not the payer
- `REQUEST_NOT_PENDING` (400) — request is not in PENDING state

---

### PENDING → CANCELLED

**Endpoint:** `POST /api/v1/requests/:id/cancel`

**Actor:** Requester (`requester_id`)

**Authorization:** JWT only (no PIN required)

**Database Effects:**
1. `payment_requests.status` → `CANCELLED`
2. `payment_requests.updated_at` → NOW()

**Error Conditions:**
- `REQUEST_NOT_FOUND` (404)
- `REQUEST_CANCEL_FORBIDDEN` (403) — caller is not the requester
- `REQUEST_NOT_PENDING` (400) — request is not in PENDING state

---

## Access Control Matrix

| Action | Requester | Payer | Third Party |
|---|---|---|---|
| View request | ✅ | ✅ | ❌ (403) |
| Pay request | ❌ (403) | ✅ + PIN | ❌ (403) |
| Decline request | ❌ (403) | ✅ | ❌ (403) |
| Cancel request | ✅ | ❌ (403) | ❌ (403) |

---

## Idempotency on /pay

The `/pay` endpoint is idempotency-key protected to prevent double-debiting:

1. First call with key `K` → executes settlement → stores response in `idempotency_keys` table
2. Subsequent call with same key `K` → returns cached response without re-executing settlement
3. Call with same key `K` but different payload → returns `422 IDEMPOTENCY_KEY_CONFLICT`

This ensures exactly-once settlement semantics even in the presence of network retries.

---

## Double-Entry Ledger Guarantee

When `status = COMPLETED`, the ledger always satisfies:

```
Sum(DEBIT entries for transaction) === Sum(CREDIT entries for transaction)
```

For a payment request of amount `$X`:
- Payer wallet: **DEBIT $X**
- Requester wallet: **CREDIT $X**
- Net: $0 (money conserved)

All operations are performed inside `settle_payment_request_atomic` (PL/pgSQL, `SECURITY DEFINER`), which either succeeds atomically or rolls back completely — no partial states possible.

---

## RLS Policy Summary

| Operation | Policy |
|---|---|
| SELECT | `auth.uid() = requester_id OR auth.uid() = payer_id` |
| INSERT | `auth.uid() = requester_id` |
| UPDATE | ❌ Blocked (all updates via `service_role` or SECURITY DEFINER RPC) |
| DELETE | ❌ Blocked (financial audit trail is immutable) |
