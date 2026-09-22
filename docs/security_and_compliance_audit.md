# B-Wallet Security Hardening & Compliance Enforcement Audit

## Document Version & Scope

- **Document Version**: 1.0.0
- **Sprint**: Sprint 9 (Security Hardening & Compliance Enforcement)
- **Status**: Formally Audited & Verified
- **Classification**: Internal Engineering Security & Architectural Compliance Report

> [!IMPORTANT]
> **Legal & Regulatory Disclaimer**:
> This document details the technical, architectural, and security-oriented controls implemented within the B-Wallet backend application. Unless accompanied by a formal external certification, these controls are classified as **security and compliance-oriented architectural safeguards** and do NOT constitute a legal certification of PCI-DSS, AML/BSA, or SOC-2 compliance.

---

## 1. Executive Summary

Sprint 9 hardens the complete B-Wallet backend surface across all API endpoints, services, database schemas, and background triggers. The implementation enforces defense-in-depth security principles (`NFR-SEC-001` through `NFR-SEC-005`, `NFR-COMP-001` through `NFR-COMP-003`), strictly protecting against:
- Brute-force attacks and automated abuse via sensitivity-aware rate limiting.
- Data tampering and audit log alterations via database-level PostgreSQL immutability triggers.
- AML velocity breaches and transactions on restricted accounts.
- Prototype pollution, null-byte injection, and oversized payload DOS attacks.
- Accidental leakage of service-role keys, Firebase service accounts, or cryptographic secrets.

---

## 2. Sensitivity-Aware Rate Limiting Architecture

Rather than applying a single naive global limit that could degrade high-frequency workflows or leave sensitive endpoints vulnerable, rate limiting is implemented across **six sensitivity tiers** using a sliding-window algorithm:

| Limiter Tier | Protected Routes | Window | Max Requests | Key Strategy | Purpose |
|---|---|:---:|:---:|---|---|
| **Global API** | All routes (`/*`) | 15 min | 100 | Client IP | Baseline DDoS and scraping defense |
| **Authentication** | `/api/v1/auth/*` | 15 min | 10 | Client IP | Credential stuffing and account enum defense |
| **PIN Operations** | `/api/v1/auth/pin/*` | 1 min | 5 | User ID / IP | Prevents PIN brute-forcing alongside Argon2id lockout |
| **Financial Ops** | `/transfers`, `/requests/:id/pay`, `/top-up/*` | 1 min | 10 | User ID / IP | High-frequency transaction flooding prevention |
| **Device Tokens** | `/api/v1/users/device-token` | 1 min | 10 | User ID / IP | Prevents push notification token spam |
| **Payment Webhooks**| `/api/v1/webhooks/*` | 1 min | 120 | Remote IP | Ingests high-burst gateway events without drops |

### HTTP 429 Response Format
When any rate limiter threshold is breached, the request is immediately terminated with `HTTP 429 Too Many Requests` and standard headers:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 48
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1789741544
Content-Type: application/json

{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many PIN verification attempts. Please wait 1 minute before trying again.",
    "retryAfter": 48
  }
}
```

---

## 3. Financial Ledger Immutability (NFR-INT-004)

### Database-Level Trigger Enforcement
In FinTech and double-entry accounting, financial audit logs and ledger entries must be strictly append-only. To prevent retroactive tampering (even by privileged database connections), Migration `025_security_hardening.sql` deployed the `prevent_financial_mutation` trigger function.

```sql
CREATE OR REPLACE FUNCTION public.prevent_financial_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Financial audit records are immutable: % operations are strictly prohibited on % (NFR-INT-004)',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trigger_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_financial_mutation();

CREATE TRIGGER trigger_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_financial_mutation();
```

### Verification
- Direct `UPDATE public.transactions` $\rightarrow$ Throws PostgreSQL exception `42501`.
- Direct `DELETE FROM public.transactions` $\rightarrow$ Throws PostgreSQL exception `42501`.
- Direct `UPDATE public.ledger_entries` $\rightarrow$ Throws PostgreSQL exception `42501`.
- Direct `DELETE FROM public.ledger_entries` $\rightarrow$ Throws PostgreSQL exception `42501`.

---

## 4. AML-Oriented Velocity & Transaction Monitoring (NFR-COMP-002)

To prevent illicit funds movement and high-velocity structuring, pre-transaction enforcement is applied via `validateAmlLimits`:

1. **Account Freeze Enforcement**:
   - Inspects `public.wallets.status`.
   - If `status === 'FROZEN'`, execution aborts immediately with `HTTP 403 Forbidden` (`ACCOUNT_FROZEN`).
2. **Single-Transfer Limit ($2,500.00)**:
   - Evaluated both at schema validation level (Zod ceiling) and service validation layer.
   - Any transfer $> \$2,500.00$ is rejected with `HTTP 400 Bad Request` (`AML_SINGLE_LIMIT_EXCEEDED`).
3. **Daily Cumulative Velocity Limit ($10,000.00)**:
   - For unverified accounts (`is_verified = FALSE`), queries settled transactions since `00:00:00 UTC`.
   - If `today_total + proposed_amount > $10,000.00`, transaction is rejected with `AML_DAILY_LIMIT_EXCEEDED`.

---

## 5. Input Sanitization & Payload Protection

1. **Payload Size Restrictions**:
   - `express.json({ limit: '100kb' })` and `express.urlencoded({ limit: '100kb' })` actively reject payloads $> 100\text{KB}$ with `HTTP 413 Payload Too Large`.
2. **Prototype Pollution Protection**:
   - `requestSanitizer` scans parsed JSON bodies, raw body buffers, query strings, and URL parameters.
   - Any object attempting to inject `__proto__`, `constructor`, or `prototype` keys is rejected with `HTTP 400` (`SECURITY_PROTOTYPE_POLLUTION`).
3. **Null-Byte Injection Protection**:
   - Inspects strings for `\0` and `\u0000` sequences to prevent filesystem path poisoning or C-string termination attacks, returning `HTTP 400` (`SECURITY_NULL_BYTE`).

---

## 6. HTTP Security Headers & Transport Security

Configured via `helmet`:
- **HSTS (`Strict-Transport-Security`)**: `maxAge: 31536000`, `includeSubDomains: true`, `preload: true`.
- **Clickjacking Defense**: `X-Frame-Options: DENY`.
- **MIME Sniffing Defense**: `X-Content-Type-Options: nosniff`.
- **CORS Locking**: Strictly enforces origins declared in `CORS_ORIGIN`, allowing only whitelisted headers (`Content-Type`, `Authorization`, `X-Correlation-ID`, `X-Idempotency-Key`).

---

## 7. Secrets Isolation & Zero-Leakage Guarantee

All sensitive credentials and private keys are strictly isolated to server runtime:

| Secret | Permitted Scope | Client Exposure | Leakage Test Status |
|---|---|:---:|:---:|
| `SUPABASE_SERVICE_ROLE_KEY` | Backend Node.js process only | 🚫 NEVER | ✅ Verified absent in all headers/bodies |
| `FIREBASE_SERVICE_ACCOUNT` | Push notification service only | 🚫 NEVER | ✅ Verified absent in all headers/bodies |
| `JWT_SECRET` / Token signing | Backend authentication middleware | 🚫 NEVER | ✅ Verified absent |
| `STRIPE_WEBHOOK_SECRET` | Webhook HMAC verification only | 🚫 NEVER | ✅ Verified absent |
| `pin_hash` / `salt` | Argon2id verification helper | 🚫 NEVER | ✅ Sanitized in user profile endpoints |

---

## 8. Comprehensive Database SECURITY DEFINER Audit

All PostgreSQL functions across all migrations were audited for privilege escalation risks:

| Function | Migration | `SECURITY DEFINER` | `search_path` | Execute Permissions | Audit Status |
|---|:---:|:---:|:---:|---|:---:|
| `handle_new_user()` | 010 | YES | `public, extensions, auth` | Trigger-only | ✅ Secure |
| `record_pin_attempt()` | 012 / 025 | YES | `public, extensions` | Hardened to `service_role` | ✅ Secure |
| `verify_wallet_integrity()` | 013 / 025 | YES | `public` | Hardened to `service_role` | ✅ Secure |
| `transfer_funds_atomic()` | 015 | YES | `public, pg_temp` | Restricted to `service_role` | ✅ Secure |
| `settle_payment_request_atomic()` | 018 | YES | `public, pg_temp` | Restricted to `service_role` | ✅ Secure |
| `top_up_wallet_atomic()` | 020 | YES | `public, pg_temp` | Restricted to `service_role` | ✅ Secure |
| `get_cash_flow_analytics()` | 022 | YES | `public, pg_temp` | Restricted to `service_role` | ✅ Secure |
| `prevent_financial_mutation()` | 025 | YES | `public, pg_temp` | Trigger-only | ✅ Secure |

---

## 9. Verification & Regression Matrix

- **Dedicated Sprint 9 Tests (`tests/integration/security.test.js`)**: **14 / 14 PASSED (100%)**
- **Full Sprints 0–9 Regression Suite**: **19 Suites, 304 / 304 Tests Total (100%)**
