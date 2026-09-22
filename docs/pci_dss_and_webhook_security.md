# PCI-DSS Tokenization & Payment Webhook Security Specification

**Document Version:** 1.0.0  
**Project:** B-Wallet (FinTech Digital E-Wallet)  
**Module:** Sprint 6 — Cards, Top-Up & Payment Gateway Webhooks  
**Compliance Standards:** PCI-DSS Level 4 (SAQ-A), OWASP API Security Top 10, RFC 2104 (HMAC)  
**Classification:** Security Architecture & Cryptographic Specification  

---

## 1. Executive Summary

To safeguard sensitive cardholder information and strictly adhere to **PCI-DSS Level 4** compliance, B-Wallet operates under a **Zero Raw Card Data Architecture**.

Under this paradigm:
1. **Zero Raw Card Data Transmission to Backend:** The B-Wallet application backend **NEVER** accepts, processes, or stores 16-digit Primary Account Numbers (PAN), expiration dates without tokenization, or Card Verification Codes (CVC / CVV).
2. **Client-Side Direct Tokenization:** The mobile client communicates directly with the PCI-DSS certified Payment Gateway (e.g. Stripe) to tokenize card credentials into ephemeral, scoped tokens (`gateway_payment_method_id`).
3. **Storage of Non-Sensitive Display Data Only:** The B-Wallet database stores only non-sensitive card metadata: gateway reference token, card brand (`Visa`, `MasterCard`, etc.), the last 4 digits of the card (`^\d{4}$`), and expiration month/year.
4. **Cryptographic Webhook Verification:** Asynchronous gateway settlement webhooks are authenticated via HMAC-SHA256 signatures evaluated over unparsed raw request payloads, with timestamp freshness enforcement to prevent replay attacks.
5. **Symmetrical Double-Entry Ledger Invariants:** Wallet top-ups atomically credit the user's wallet while debiting the platform's external gateway settlement account (`SYSTEM_SETTLEMENT`), ensuring that total debits equal total credits across the ledger.

---

## 2. Card Tokenization & Data Boundary (PCI-DSS SAQ-A)

### 2.1 Information Flow

```
┌──────────────────┐           ┌────────────────────────┐           ┌──────────────────┐
│  Mobile Client   │           │     Stripe Gateway     │           │ B-Wallet Backend │
│  (Flutter App)   │           │    (PCI-DSS Level 1)   │           │   (Node.js API)  │
└────────┬─────────┘           └───────────┬────────────┘           └────────┬─────────┘
         │                                 │                                 │
         │  1. Collects Card PAN & CVC     │                                 │
         │────────────────────────────────>│ (Direct TLS 1.3 SDK connection) │
         │                                 │                                 │
         │  2. Tokenizes Card Credentials  │                                 │
         │<────────────────────────────────│                                 │
         │     Token: pm_1Mxxxxxxx         │                                 │
         │                                 │                                 │
         │  3. POST /api/v1/cards (Tokenized Reference Only)                 │
         │     { gateway_payment_method_id, brand, last4, expiry }           │
         │──────────────────────────────────────────────────────────────────>│
         │                                                                   │
         │                                 │  4. Validates Token Reference   │
         │                                 │  and stores in saved_cards      │
         │                                 │                                 │
         │  5. HTTP 201 Created            │                                 │
         │<──────────────────────────────────────────────────────────────────│
```

### 2.2 Data Classification Matrix

| Data Element | Storage Location | Retention Policy | Permitted in API Payloads |
|---|---|---|---|
| **Primary Account Number (PAN)** | **Never stored in B-Wallet** | None (Transmitted directly to gateway) | **Strictly Prohibited** (HTTP 400 rejection) |
| **Card Verification Code (CVC/CVV)** | **Never stored in B-Wallet** | None (Immediate client memory purge) | **Strictly Prohibited** (HTTP 400 rejection) |
| **PIN / Security Codes** | **Never stored in B-Wallet** | None | **Strictly Prohibited** |
| `gateway_payment_method_id` | `public.saved_cards` | Persistent until deleted by user | Allowed |
| `gateway_customer_id` | `public.saved_cards` | Persistent until deleted by user | Allowed |
| Card Brand | `public.saved_cards` | Persistent until deleted by user | Allowed |
| Last 4 Digits (`last4`) | `public.saved_cards` | Persistent until deleted by user | Allowed |
| Expiration Month / Year | `public.saved_cards` | Persistent until deleted by user | Allowed |

### 2.3 Strict Rejection Interceptor (`PCI_DSS_VIOLATION`)

The B-Wallet backend implements defensive middleware and schema guards. Any incoming request containing raw card fields is immediately aborted with HTTP 400:

```json
{
  "success": false,
  "error": {
    "code": "PCI_DSS_VIOLATION",
    "message": "Raw card data (card_number) is strictly prohibited under PCI-DSS compliance. Submit only gateway tokenized references."
  }
}
```

---

## 3. Payment Gateway Webhook Security

The webhook listener (`POST /api/v1/webhooks/payments`) receives settlement notifications asynchronously from the payment processor. Because webhooks originate from outside the authenticated client session, cryptographic integrity is paramount.

### 3.1 Security Controls

```
                        ┌─────────────────────────────────────────┐
                        │ Inbound Webhook: POST /webhooks/payments│
                        └───────────────────┬─────────────────────┘
                                            │
                                            ▼
                           ┌───────────────────────────────────┐
                           │ 1. Signature Header Present?      │──No──► HTTP 401 Unauthorized
                           │    (X-Webhook-Signature / Stripe) │
                           └────────────────┬──────────────────┘
                                            │ Yes
                                            ▼
                           ┌───────────────────────────────────┐
                           │ 2. Timestamp Freshness Check      │──No──► HTTP 401 Unauthorized
                           │    |T_current - T_sig| <= 300s?   │        (Replay Attack Prevented)
                           └────────────────┬──────────────────┘
                                            │ Yes
                                            ▼
                           ┌───────────────────────────────────┐
                           │ 3. Raw Body Preservation          │
                           │    Preserve exact received bytes  │
                           └────────────────┬──────────────────┘
                                            │
                                            ▼
                           ┌───────────────────────────────────┐
                           │ 4. Constant-Time HMAC-SHA256      │──No──► HTTP 401 Unauthorized
                           │    crypto.timingSafeEqual(...)    │        (Forged / Tampered)
                           └────────────────┬──────────────────┘
                                            │ Match
                                            ▼
                           ┌───────────────────────────────────┐
                           │ 5. Event Type Verification        │
                           │    'payment_intent.succeeded'     │
                           └────────────────┬──────────────────┘
                                            │
                                            ▼
                           ┌───────────────────────────────────┐
                           │ 6. Atomic Stored Procedure        │
                           │    top_up_wallet_atomic(...)      │
                           └────────────────┬──────────────────┘
                                            │
                                            ▼
                           ┌───────────────────────────────────┐
                           │ 7. Idempotent Success Response    │
                           │    HTTP 200 OK                    │
                           └───────────────────────────────────┘
```

1. **Mandatory HMAC-SHA256 Signature:**
   Signatures are computed as `HMAC-SHA256(secret, t + "." + raw_body)` or direct HMAC over the raw body.
2. **Raw Body Preservation:**
   JSON parsing alters spacing and unicode formatting, which invalidates cryptographic signatures. B-Wallet configures Express to retain the unparsed raw buffer in `req.rawBody`.
3. **Constant-Time Comparison:**
   Signature comparison uses `crypto.timingSafeEqual` to eliminate side-channel timing attacks.
4. **Replay Attack Prevention:**
   The timestamp embedded in the signature or header is evaluated against server time. Requests with timestamps older than 300 seconds (5 minutes) are rejected.
5. **Idempotent Settlement:**
   If a webhook event is retried due to transient network latency, the database procedure checks `transactions.idempotency_key` and `transactions.transaction_reference`. Already-settled webhooks return HTTP 200 with `{ already_processed: true }` without crediting funds a second time.

---

## 4. Financial Invariants & Double-Entry Top-Up Ledger

Under GAAP and FinTech ledger standards, money cannot appear from thin air. Every deposit into a user's wallet must have an offsetting ledger leg:

| Leg | Account / Entity | Direction | Amount | Accounting Balance Impact |
|:---:|---|:---:|:---:|:---:|
| **Leg 1** | User Wallet | **CREDIT** | `+$100.00` | Increases user spendable balance |
| **Leg 2** | Platform Gateway Settlement Clearing Account (`00000000-0000-0000-0000-000000000002`) | **DEBIT** | `-$100.00` | Tracks unsettled receivables from payment switch |

$$\sum \text{Debits} = \$100.00 \equiv \sum \text{Credits} = \$100.00 \quad (\Delta = \$0.00)$$

### Real-Time Balance Auditability

Calling `public.verify_wallet_integrity(user_wallet_id)` evaluates:
$$\text{Calculated Balance} = \sum \text{CREDIT} - \sum \text{DEBIT}$$
$$\text{Discrepancy} = \text{Current Balance} - \text{Calculated Balance} \equiv 0.00$$

Because the user wallet receives a `CREDIT` entry of exact amount, the user's audit check passes with zero discrepancy.

---

## 5. Security Checklist & Acceptance Criteria

- [x] Zero raw card data (PAN, CVV, CVC) stored or accepted in API endpoints.
- [x] Tokenized references stored in `public.saved_cards` protected by RLS.
- [x] Only user owning card can view, set default, or delete their card.
- [x] Payment gateway adapter pattern decouples business logic from vendor APIs.
- [x] Webhook route protected by HMAC-SHA256 verification and replay-window validation.
- [x] Top-up settlements executed atomically with row-level locks and balanced double-entry ledger entries.
- [x] Duplicate webhook deliveries are completely idempotent.
