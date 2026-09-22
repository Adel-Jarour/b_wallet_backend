# B-Wallet Backend Sprint Plan: Master Execution Roadmap

**Document Version:** 1.0.0  
**Project:** B-Wallet (FinTech Digital E-Wallet)  
**Target Backend Stack:** Node.js, Express.js, Supabase / PostgreSQL 15+, Supabase Auth, Supabase Realtime, Supabase Storage  
**Client Interface:** Flutter (Targeted for integration only after full backend completion)  
**Execution Model:** Sequential Sprint Execution ("Implement Sprint X")

---

## Architectural & Database Decisions (Pre-Implementation Alignment)

Before implementing the sprints, the following 5 architectural and database decisions must be locked in. Each item outlines the context, available options, and the recommended architecture based on the SRS.

### Decision 1: In-App Notifications Storage
* **Context:** SRS Module 10 requires an in-app Notification Center (`/notify`) categorized into "Transactions", "Promos", and "System Alerts", with "mark as read" capability (`FR-NOT-002`, `FR-NOT-003`). The SRS Section 6.2 DDL omitted this table.
* **Options:**
  * *Option A (Recommended):* Create a dedicated `public.notifications` table in PostgreSQL with columns for `id`, `user_id`, `category`, `title`, `body`, `is_read`, `metadata`, and `created_at`.
  * *Option B:* Rely only on ephemeral push notifications (FCM) without persistent in-app storage.
* **Status:** **`RESOLVED - ADOPTING OPTION A`**. A persistent table is necessary to fulfill the in-app notification center requirements.

### Decision 2: Payment Requests Data Modeling
* **Context:** SRS Module 6 describes creating, sending, settling, and declining payment requests. The SRS Section 6.2 DDL placed `REQUEST` as an enum option inside `transaction_type`.
* **Options:**
  * *Option A (Recommended):* Create a dedicated `public.payment_requests` table (`id`, `requester_id`, `payer_id`, `amount`, `currency`, `category`, `note`, `status`, `transaction_id`, `created_at`). When a request is paid, a completed record is created in `transactions`, and `payment_requests.status` transitions to `COMPLETED`.
  * *Option B:* Store pending requests directly in `transactions` with status `PENDING`, and update them to `COMPLETED` when paid.
* **Status:** **`RESOLVED - ADOPTING OPTION A`**. This adheres to SRS `NFR-INT-004` (immutable ledger headers), ensuring that records in the `transactions` table represent executed financial transactions rather than pending requests.

### Decision 3: Idempotency Key Storage
* **Context:** SRS `NFR-INT-002` mandates that all monetary operations accept an `X-Idempotency-Key` header with a client-generated UUIDv4 to prevent duplicate debits.
* **Options:**
  * *Option A (Recommended):* Dedicated `public.idempotency_keys` table in PostgreSQL (`key`, `user_id`, `endpoint`, `request_hash`, `response_status`, `response_body`, `created_at`, `expires_at`).
  * *Option B:* Rely solely on the `transactions.idempotency_key` column's unique constraint.
* **Status:** **`RESOLVED - ADOPTING OPTION A`**. A dedicated table caches both in-flight requests and finalized responses, allowing retried requests to return the exact cached JSON payload without touching the ledger again.

### Decision 4: Cash Flow Analytics Processing Strategy
* **Context:** SRS Module 7 requires weekly, monthly, and yearly income vs. expense analytics, net savings ratio, and category percentage breakdowns.
* **Options:**
  * *Option A (Recommended):* Provide a dedicated Node.js endpoint (`GET /api/v1/analytics/cash-flow`) backed by a PostgreSQL aggregation query/view.
  * *Option B:* Mobile client downloads raw transaction records and aggregates them locally in Dart.
* **Status:** **`RESOLVED - ADOPTING OPTION A`**. Server-side aggregation reduces mobile network bandwidth, lowers battery consumption, and ensures consistent calculations across client platforms.

### Decision 5: Payment Gateway Sandbox Adapter
* **Context:** SRS Module 4 requires card tokenization and top-up settlements conforming to PCI-DSS Level 4.
* **Options:**
  * *Option A (Recommended):* Implement a modular Payment Gateway Interface with a Stripe Sandbox adapter as the default reference implementation, accompanied by a Mock Gateway mode for automated offline testing.
  * *Option B:* Hardcode a proprietary local switch protocol without an adapter pattern.
* **Status:** **`RESOLVED - ADOPTING OPTION A`**. The adapter pattern decouples payment logic from external vendor specifics.

---

## Master Sprint Dependency Graph

```
Sprint 0: Backend Project Foundation
   │
   ▼
Sprint 1: Supabase Database Schema & Core Migrations
   │
   ▼
Sprint 2: Authentication, Authorization & PIN Engine
   │
   ▼
Sprint 3: Digital Wallet & Double-Entry Ledger Subsystem
   │
   ▼
Sprint 4: Peer-to-Peer (P2P) Atomic Fund Transfers
   │
   ▼
Sprint 5: Payment Requests & Invoicing Engine
   │
   ▼
Sprint 6: Cards, Top-Up & Payment Gateway Webhooks
   │
   ▼
Sprint 7: Cash Flow Analytics & Financial Intelligence
   │
   ▼
Sprint 8: Real-Time Messaging & Notification Engine
   │
   ▼
Sprint 9: Security Hardening & Compliance Enforcement
   │
   ▼
Sprint 10: End-to-End Verification, Documentation & Flutter Handoff
```

---

## Detailed Sprint Specifications (Sprints 0 – 10)

---

### Sprint 0: Backend Project Foundation

#### 1. Sprint Number and Name
* **Sprint 0: Backend Project Foundation**

#### 2. Sprint Objective
* Establish a robust, production-ready Node.js + Express project skeleton with environment validation, structured logging, centralized error handling, correlation ID tracking, and Supabase client initialization.

#### 3. Why This Sprint Exists
* A FinTech backend requires enterprise-grade architectural plumbing (typed configurations, unified error response formats, security headers, and request tracing) before implementing any business logic.

#### 4. Dependencies on Previous Sprints
* None (Initial sprint).

#### 5. Exact Features to Implement
* Node.js application scaffolding with Express.
* Environment variable loader and validator (validates required keys on startup).
* Structured JSON logger using `pino` and `pino-http`.
* Global error handling middleware with standardized API error responses (`ApiError`).
* Request correlation ID middleware (`X-Correlation-ID`) for distributed tracing.
* Base security middlewares: `helmet` (HTTP header security) and `cors`.
* System health check endpoint (`GET /health`) reporting uptime, memory usage, and database reachability.

#### 6. Database Changes
* None in this sprint.

#### 7. Node.js/Express Changes
* Initialize `package.json` with dependencies: `express`, `dotenv`, `pino`, `pino-http`, `helmet`, `cors`, `zod`, `@supabase/supabase-js`.
* Dev dependencies: `nodemon`, `jest`, `supertest`.
* Build standard directory structure: `src/config`, `src/middlewares`, `src/utils`, `src/routes`, `src/controllers`, `src/services`.
* Configure `src/app.js` and `src/server.js`.

#### 8. Supabase Changes
* Create `src/config/supabase.js` to initialize the Supabase Admin client using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
* Verify client connectivity to the empty Supabase project in the health check route.

#### 9. API Endpoints
* `GET /health` — Returns system health, version, timestamp, and Supabase connection status.

#### 10. Authentication/Authorization Requirements
* Public route; no authentication required for `/health`.

#### 11. Security Requirements
* `SUPABASE_SERVICE_ROLE_KEY` must only be loaded via environment variables; never hardcoded.
* Reject server startup if required environment variables are missing.
* Mask sensitive tokens in logging output.
* Strict HTTP security headers configured via `helmet`.

#### 12. Validation Requirements
* Zod environment schema verifying `PORT`, `NODE_ENV`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

#### 13. Tests That Must Be Written
* `tests/unit/config.test.js`: Validates that missing env variables prevent startup.
* `tests/integration/health.test.js`: Asserts `GET /health` returns HTTP 200 with valid JSON schema.

#### 14. Postman/API Testing Requirements
* Postman collection initialized: `B-Wallet Backend API.postman_collection.json`.
* Request: `Health / System Health Check`.

#### 15. Documentation That Must Be Created
* `docs/environment_setup.md`: Step-by-step guide for local development and `.env` configuration.

#### 16. Definition of Done
* Server boots up with `npm run dev`.
* `GET /health` returns `{ status: "UP", supabase: "CONNECTED" }`.
* Unit and integration tests pass with 100% success.

#### 17. Acceptance Criteria
* `GET /health` responds in < 50ms with HTTP 200.
* Logs are structured JSON with correlation IDs present.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── .env.example
├── package.json
├── docs/
│   └── environment_setup.md
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   ├── env.js
│   │   ├── logger.js
│   │   └── supabase.js
│   ├── middlewares/
│   │   ├── correlationId.js
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── index.js
│   │   └── health.routes.js
│   └── utils/
│       └── ApiError.js
└── tests/
    ├── integration/
    │   └── health.test.js
    └── unit/
        └── config.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not write business logic or financial calculations.
* Do not execute database DDL scripts or migrations.

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 1 requires the operational Supabase client and testing harness configured in Sprint 0.

---

### Sprint 1: Supabase Database Schema & Core Migrations

#### 1. Sprint Number and Name
* **Sprint 1: Supabase Database Schema & Core Migrations**

#### 2. Sprint Objective
* Implement and apply the complete PostgreSQL relational database schema, extensions, constraints, enumerations, table relationships, and the automated user signup provisioning trigger.

#### 3. Why This Sprint Exists
* The entire FinTech backend relies on strict relational integrity, UUID primary keys, and fixed-point currency math (`NUMERIC(15,2)`).

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 0 (Supabase connection parameters and environment setup).

#### 5. Exact Features to Implement
* Database extensions setup (`uuid-ossp`, `pgcrypto`).
* Custom enum types (`transaction_type`, `transaction_status`, `entry_direction`, `notification_category`).
* Migration scripts for all core tables:
  * `public.profiles`
  * `public.wallets`
  * `public.transactions`
  * `public.ledger_entries`
  * `public.saved_cards`
  * `public.conversations`
  * `public.messages`
  * `public.notifications` (per Decision 1)
  * `public.payment_requests` (per Decision 2)
  * `public.idempotency_keys` (per Decision 3)
* PostgreSQL Trigger Function `public.handle_new_user()`: Automatically provisions a linked row in `public.profiles` and a default USD wallet in `public.wallets` upon user creation in `auth.users`.

#### 6. Database Changes
* SQL Migration files creating all 10 tables, foreign key constraints, indexes on phone/email/user_id, and check constraints (`balance >= 0.00`, `amount > 0`).

#### 7. Node.js/Express Changes
* Create a database migration runner script (`scripts/migrate.js`) to apply SQL migrations sequentially using the Supabase client or direct Postgres connection.

#### 8. Supabase Changes
* Apply DDL scripts directly to the Supabase PostgreSQL database.
* Verify tables in the Supabase Dashboard.

#### 9. API Endpoints
* None in this sprint (Database layer focus).

#### 10. Authentication/Authorization Requirements
* Trigger executes with `SECURITY DEFINER` privileges to populate `profiles` and `wallets` from `auth.users`.

#### 11. Security Requirements
* Enforce `ON DELETE RESTRICT` on wallets to prevent deleting profiles that hold active balances.
* Restrict balance updates with check constraint `CHECK (balance >= 0.00)`.
* Enforce `NUMERIC(15,2)` on all monetary fields.

#### 12. Validation Requirements
* Database-level checks: currency length 3 characters, expiry month between 1 and 12, expiry year $\ge$ 2026.

#### 13. Tests That Must Be Written
* `tests/integration/schema.test.js`:
  * Validates all tables exist.
  * Validates foreign key constraints prevent orphaned records.
  * Validates negative balances trigger database constraint violations.
  * Tests the `handle_new_user` trigger by simulating user signup.

#### 14. Postman/API Testing Requirements
* None (Database verification suite).

#### 15. Documentation That Must Be Created
* `docs/database_schema.md`: Complete Entity-Relationship documentation, table dictionaries, index rationale, and constraint definitions.

#### 16. Definition of Done
* All SQL migration scripts run idempotently without errors.
* Simulating an insertion into `auth.users` creates a corresponding profile and wallet with $0.00 balance.
* Schema integration tests pass completely.

#### 17. Acceptance Criteria
* `TC-AUTH-01 (DB Portion)`: User creation triggers automatic profile and wallet provisioning.
* Check constraints strictly reject balances $< 0.00$.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   ├── migrations/
│   │   ├── 001_extensions_and_types.sql
│   │   ├── 002_create_profiles.sql
│   │   ├── 003_create_wallets.sql
│   │   ├── 004_create_transactions_and_ledger.sql
│   │   ├── 005_create_saved_cards.sql
│   │   ├── 006_create_social_tables.sql
│   │   ├── 007_create_notifications.sql
│   │   ├── 008_create_payment_requests.sql
│   │   ├── 009_create_idempotency_keys.sql
│   │   └── 010_create_signup_trigger.sql
│   └── scripts/
│       └── migrate.js
└── docs/
    └── database_schema.md
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not write Row Level Security (RLS) policies yet (handled in Sprint 2).
* Do not implement application transfer logic.

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 2 relies on the `profiles` table schema (specifically `pin_hash`, `pin_failed_attempts`, `pin_locked_until`) and the `auth.users` trigger.

---

### Sprint 2: Authentication, Authorization & PIN Engine

#### 1. Sprint Number and Name
* **Sprint 2: Authentication, Authorization & PIN Engine**

#### 2. Sprint Objective
* Implement the Supabase JWT authentication validation middleware and build the 6-digit transaction PIN security engine with Argon2id hashing, attempt tracking, and 15-minute lockouts.

#### 3. Why This Sprint Exists
* Money cannot move without cryptographic proof of identity and a verified 6-digit transaction PIN.

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 1 (`profiles` table with PIN security fields).

#### 5. Exact Features to Implement
* Express JWT authentication middleware (`authenticateJwt`): Extracts Supabase Bearer token, validates signature and claims, and attaches verified user object to `req.user`.
* PIN Service (`PinService`):
  * Hashes 6-digit numeric PIN with **Argon2id** (memory cost 65536 KB, time cost 3, parallelism 4, cryptographically secure random salt).
  * Validates PIN during transactions against stored hash.
  * Tracks failed attempts (`pin_failed_attempts`).
  * Enforces 15-minute lockout upon 3 consecutive failures (`pin_locked_until`).
  * Resets failed attempts to 0 upon successful PIN verification.
* Row Level Security (RLS) Policies applied to `profiles` table (`SELECT`, `UPDATE` allowed only when `auth.uid() = id`).

#### 6. Database Changes
* Apply RLS policy migration for `profiles`.
* Database stored helper function or atomic update query for incrementing failed PIN attempts and setting `pin_locked_until`.

#### 7. Node.js/Express Changes
* Middleware: `src/middlewares/auth.js`.
* Controllers: `src/controllers/pin.controller.js`, `src/controllers/profile.controller.js`.
* Services: `src/services/pin.service.js`.
* Routes: `src/routes/pin.routes.js`, `src/routes/profile.routes.js`.

#### 8. Supabase Changes
* Enable RLS on `public.profiles`.
* Apply policy: `CREATE POLICY "Users can manage their own profile" ON public.profiles FOR ALL USING (auth.uid() = id);`.

#### 9. API Endpoints
* `POST /api/v1/auth/pin/setup` — Initial PIN creation (requires confirmation match).
* `POST /api/v1/auth/pin/verify` — Validates PIN and issues a short-lived, signed transaction authorization ticket (valid for 5 minutes).
* `POST /api/v1/auth/pin/change` — Changes PIN (requires verification of existing PIN).
* `GET /api/v1/profile/me` — Fetches current user profile and verification status.
* `PATCH /api/v1/profile/me` — Updates editable personal details (names, birthday, avatar).

#### 10. Authentication/Authorization Requirements
* All endpoints in this sprint require a valid Supabase Auth JWT in the `Authorization: Bearer <token>` header.

#### 11. Security Requirements
* PIN must be exactly 6 numeric digits (`/^\d{6}$/`).
* Argon2id hashing parameters must meet OWASP security guidelines.
* Plaintext PIN must never appear in log files, database tables, or error messages.
* When locked, API returns HTTP 423 (Locked) with exact seconds remaining.

#### 12. Validation Requirements
* Input validation via Zod schemas: `setupPinSchema`, `verifyPinSchema`, `updateProfileSchema`.

#### 13. Tests That Must Be Written
* `tests/unit/pin.service.test.js`: Tests Argon2id hashing and verification logic.
* `tests/integration/pin.routes.test.js`:
  * Sets up PIN successfully.
  * Submits 1 incorrect PIN $\rightarrow$ failed attempts count increments to 1.
  * Submits 3 consecutive incorrect PINs $\rightarrow$ `pin_locked_until` is set to ~15 minutes in the future; subsequent requests return HTTP 423.
  * Validates that submitting the correct PIN resets failed attempts to 0.

#### 14. Postman/API Testing Requirements
* Postman folder: `Authentication & PIN Engine`.
* Requests:
  * Setup PIN
  * Verify PIN (Success & Failure)
  * Verify PIN (Locked 3x)
  * Change PIN
  * Get Current Profile

#### 15. Documentation That Must Be Created
* `docs/pin_security_specification.md`: Mathematical and architectural details of the PIN security architecture.

#### 16. Definition of Done
* PIN setup, verification, and change routes function with authenticated JWTs.
* Lockout policy triggers on the 3rd failed attempt and blocks operations for 15 minutes.
* `TC-PIN-01` passes completely.

#### 17. Acceptance Criteria
* `TC-PIN-01`: Entering invalid PIN 3 times locks wallet capability for 15 minutes.
* Incorrect PIN attempts return remaining attempts before lockout.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       └── 011_profiles_rls.sql
├── docs/
│   └── pin_security_specification.md
├── src/
│   ├── middlewares/
│   │   └── auth.js
│   ├── controllers/
│   │   ├── pin.controller.js
│   │   └── profile.controller.js
│   ├── routes/
│   │   ├── pin.routes.js
│   │   └── profile.routes.js
│   ├── services/
│   │   └── pin.service.js
│   └── schemas/
│       ├── pin.schema.js
│       └── profile.schema.js
└── tests/
    ├── integration/
    │   └── pin.routes.test.js
    └── unit/
        └── pin.service.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not implement balance transfers or ledger entries yet.

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 3 requires verified user authentication and the ability to link wallets to verified profiles.

---

### Sprint 3: Digital Wallet & Double-Entry Ledger Subsystem

#### 1. Sprint Number and Name
* **Sprint 3: Digital Wallet & Double-Entry Ledger Subsystem**

#### 2. Sprint Objective
* Build the balance inquiry and ledger auditing subsystem, apply RLS policies to `wallets` and `ledger_entries`, and implement internal double-entry integrity verification routines.

#### 3. Why This Sprint Exists
* To satisfy regulatory standards and SRS requirements (`NFR-INT-003`, `FR-WAL-001`), the wallet balance must reflect the exact mathematical sum of its immutable ledger entries.

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 1 (tables `wallets`, `ledger_entries`, `transactions`) and Sprint 2 (JWT authentication middleware).

#### 5. Exact Features to Implement
* Wallet Service (`WalletService`):
  * Fetch current wallet balance and status (`ACTIVE`, `FROZEN`, `CLOSED`).
  * Ledger audit verification: Verifies that $\text{Wallet Balance} = \sum(\text{Credits}) - \sum(\text{Debits})$.
* Row Level Security (RLS) configuration:
  * `wallets`: Users can execute `SELECT` on their own wallet (`auth.uid() = user_id`). Direct client `INSERT`, `UPDATE`, and `DELETE` are prohibited.
  * `ledger_entries`: Users can execute `SELECT` on ledger entries linked to their wallet. Direct mutations are blocked.
  * `transactions`: Users can view transactions where they are sender or receiver. Direct mutations are blocked.

#### 6. Database Changes
* Apply RLS policies for `wallets`, `ledger_entries`, and `transactions`.
* Create a database audit view or function: `verify_wallet_integrity(wallet_id UUID)`.

#### 7. Node.js/Express Changes
* Controllers: `src/controllers/wallet.controller.js`.
* Services: `src/services/wallet.service.js`.
* Routes: `src/routes/wallet.routes.js`.

#### 8. Supabase Changes
* Apply RLS policies in Supabase SQL editor:
  * Block all non-service-role mutations on financial tables.

#### 9. API Endpoints
* `GET /api/v1/wallets/me` — Fetches active user's wallet details (balance, currency, status, updated_at).
* `GET /api/v1/wallets/me/ledger` — Fetches paginated double-entry ledger records for audit purposes.
* `GET /api/v1/wallets/me/audit` — Runs real-time balance integrity check against ledger entries.

#### 10. Authentication/Authorization Requirements
* Requires valid JWT. Only the wallet owner can view their balance and ledger.

#### 11. Security Requirements
* RLS guarantees that a direct Supabase query from a client cannot alter `balance`.
* Wallets with status `FROZEN` or `CLOSED` reject transaction preparation.

#### 12. Validation Requirements
* Query pagination validation: `page` (default 1), `limit` (default 20, max 100).

#### 13. Tests That Must Be Written
* `tests/integration/wallet.routes.test.js`:
  * Validates that an authenticated user can retrieve their wallet.
  * Validates that User A cannot read User B's wallet.
  * Validates that a non-admin client cannot directly update the `wallets` table via Supabase client.
* `tests/unit/wallet.service.test.js`:
  * Tests integrity verification function with balanced and simulated unbalanced ledgers.

#### 14. Postman/API Testing Requirements
* Postman folder: `Wallet & Ledger Subsystem`.
* Requests:
  * Get My Wallet
  * Get My Ledger Entries
  * Run Wallet Balance Audit

#### 15. Documentation That Must Be Created
* `docs/double_entry_bookkeeping.md`: Explains the double-entry accounting principles implemented in B-Wallet.

#### 16. Definition of Done
* Wallet balance endpoint responds correctly.
* RLS policies actively block direct client updates.
* Integrity audit logic verifies that ledger sum matches wallet balance.

#### 17. Acceptance Criteria
* `FR-WAL-001`: Balance formatted as a decimal number with two decimal places.
* RLS prevents any unauthorized balance visibility across users.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       ├── 012_wallets_rls.sql
│       ├── 013_transactions_ledger_rls.sql
│       └── 014_verify_wallet_integrity_rpc.sql
├── docs/
│   └── double_entry_bookkeeping.md
├── src/
│   ├── controllers/
│   │   └── wallet.controller.js
│   ├── routes/
│   │   └── wallet.routes.js
│   └── services/
│       └── wallet.service.js
└── tests/
    ├── integration/
    │   └── wallet.routes.test.js
    └── unit/
        └── wallet.service.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not execute money transfers between accounts.

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 4 directly relies on the wallet status checks, ledger insertion structures, and balance precision established in Sprint 3.

---

### Sprint 4: Peer-to-Peer (P2P) Atomic Fund Transfers

#### 1. Sprint Number and Name
* **Sprint 4: Peer-to-Peer (P2P) Atomic Fund Transfers**

#### 2. Sprint Objective
* Implement the core financial engine of B-Wallet: atomic P2P transfers between users using PostgreSQL stored procedures with row-level locking (`SELECT ... FOR UPDATE`), idempotency key enforcement, AML velocity checks, and automatic rollback on failure.

#### 3. Why This Sprint Exists
* P2P transfers are the primary function of the app (`FR-TX-001` through `FR-TX-005`). They must be completely immune to race conditions, partial debits, or duplicate charging.

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 2 (PIN verification) and Sprint 3 (Wallet and double-entry ledger).

#### 5. Exact Features to Implement
* PostgreSQL Stored Procedure `transfer_funds_atomic`:
  * Acquires row-level locks on sender and receiver wallets in a consistent order (preventing deadlocks).
  * Validates sender wallet status is `ACTIVE` and receiver wallet is `ACTIVE`.
  * Checks sender available balance: $\text{Balance} \ge \text{Amount} + \text{Fee}$.
  * Debits sender wallet; credits receiver wallet.
  * Inserts record into `public.transactions` with status `COMPLETED`.
  * Inserts corresponding `DEBIT` and `CREDIT` records into `public.ledger_entries`.
  * Records idempotency key in `public.idempotency_keys`.
* Node.js Idempotency Middleware (`checkIdempotency`):
  * Intercepts `X-Idempotency-Key` header (UUIDv4).
  * Returns cached response if key was previously processed.
  * Rejects request if key is currently in-flight.
* Transfer Controller & Service:
  * Validates recipient existence via phone number, email, or user ID.
  * Validates transaction PIN via `PinService`.
  * Enforces AML velocity limits ($2,500 single transfer limit, $10,000 daily cumulative limit for unverified tier).
  * Calls `transfer_funds_atomic` via Supabase RPC.
  * Returns formatted transaction receipt.

#### 6. Database Changes
* SQL Migration creating `transfer_funds_atomic` PL/pgSQL function.
* Indexes on `transactions(transaction_reference)` and `transactions(created_at)`.

#### 7. Node.js/Express Changes
* Middlewares: `src/middlewares/idempotency.js`.
* Controllers: `src/controllers/transfer.controller.js`.
* Services: `src/services/transfer.service.js`, `src/services/aml.service.js`.
* Routes: `src/routes/transfer.routes.js`.

#### 8. Supabase Changes
* Deploy `transfer_funds_atomic` function to Supabase PostgreSQL database.

#### 9. API Endpoints
* `POST /api/v1/transfers` — Executes atomic P2P transfer.
  * Headers: `Authorization: Bearer <token>`, `X-Idempotency-Key: <uuidv4>`.
  * Body: `{ "receiver_phone": "+1234567890", "amount": 50.00, "category": "Food", "note": "Dinner", "pin": "123456" }`.
* `GET /api/v1/transfers/:reference` — Look up transfer receipt by unique transaction reference.

#### 10. Authentication/Authorization Requirements
* Requires authenticated user JWT.
* Sender is strictly extracted from `req.user.id`; cannot be overridden in the request body.

#### 11. Security Requirements
* Idempotency key is mandatory for `POST /api/v1/transfers`.
* `SELECT ... FOR UPDATE` prevents race condition double-spending.
* Transaction PIN is verified before calling the database RPC.
* Single transaction limit: $2,500.00 (`NFR-COMP-002`).

#### 12. Validation Requirements
* Zod schema: `amount` must be positive with max 2 decimal places, `category` must match allowed list (`Food`, `Expense`, `Property`, `Hobby`, `Entertainment`), `receiver_phone` must be E.164 format.

#### 13. Tests That Must Be Written
* `tests/integration/transfer.test.js`:
  * `TC-TX-01`: Attempt transfer exceeding sender balance $\rightarrow$ rejects with HTTP 400 "Insufficient balance", 0 balance changes.
  * `TC-TX-02`: Valid transfer with correct PIN $\rightarrow$ sender debited, receiver credited, transaction `COMPLETED`, ledger entries balanced.
  * `TC-IDEM-01`: Submit identical request with identical `X-Idempotency-Key` twice $\rightarrow$ returns original receipt; second debit is blocked.
  * Concurrent transfers test: Run 5 simultaneous $50 transfer requests with $100 starting balance $\rightarrow$ exactly 2 succeed, 3 fail with insufficient balance; final balance is $0.00.

#### 14. Postman/API Testing Requirements
* Postman folder: `P2P Fund Transfers`.
* Requests:
  * Send Money (Success)
  * Send Money (Insufficient Funds)
  * Send Money (Wrong PIN)
  * Send Money (Duplicate Idempotency Key)
  * Get Transfer Receipt

#### 15. Documentation That Must Be Created
* `docs/atomic_transfers_and_concurrency.md`: Detailed explanation of row locking, race condition mitigation, and idempotency guarantees.

#### 16. Definition of Done
* `transfer_funds_atomic` runs without deadlocks.
* Idempotency middleware blocks duplicate charges.
* All acceptance tests (`TC-TX-01`, `TC-TX-02`, `TC-IDEM-01`) pass.

#### 17. Acceptance Criteria
* `NFR-PERF-003`: Atomic transfer completes in $< 800\text{ms}$.
* Double-entry ledger entries strictly match transfer amounts.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       └── 015_transfer_funds_atomic_rpc.sql
├── docs/
│   └── atomic_transfers_and_concurrency.md
├── src/
│   ├── middlewares/
│   │   └── idempotency.js
│   ├── controllers/
│   │   └── transfer.controller.js
│   ├── routes/
│   │   └── transfer.routes.js
│   ├── schemas/
│   │   └── transfer.schema.js
│   └── services/
│       ├── aml.service.js
│       └── transfer.service.js
└── tests/
    └── integration/
        └── transfer.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not implement external payment card top-ups (handled in Sprint 6).

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 5 relies on the atomic transfer procedure to settle payment requests.

---

### Sprint 5: Payment Requests & Invoicing Engine

#### 1. Sprint Number and Name
* **Sprint 5: Payment Requests & Invoicing Engine**

#### 2. Sprint Objective
* Implement payment request tickets (`FR-REQ-001` through `FR-REQ-004`) allowing users to request money from contacts, track ticket status, decline requests, and settle requests through the atomic transfer engine.

#### 3. Why This Sprint Exists
* Users need to request money from peers with structured debt tracking and "Pay Now" one-tap settlements.

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 4 (Atomic transfer engine and PIN verification).

#### 5. Exact Features to Implement
* Payment Request Lifecycle:
  * Create payment request (`status = 'PENDING'`).
  * Decline payment request (`status = 'DECLINED'`).
  * Cancel payment request by requester (`status = 'CANCELLED'`).
  * Settle request ("Pay Now"): Debits payer, credits requester, links `transaction_id`, and sets `status = 'COMPLETED'`.
* RLS policies for `public.payment_requests`:
  * Users can read requests where `auth.uid() IN (requester_id, payer_id)`.
  * Only payer can transition status to `COMPLETED` or `DECLINED`.
  * Only requester can transition status to `CANCELLED`.

#### 6. Database Changes
* SQL Migration: Apply RLS policies on `public.payment_requests`.
* Stored Procedure or atomic update for request settlement: `settle_payment_request_atomic`.

#### 7. Node.js/Express Changes
* Controllers: `src/controllers/payment_request.controller.js`.
* Services: `src/services/payment_request.service.js`.
* Routes: `src/routes/payment_request.routes.js`.
* Schemas: `src/schemas/payment_request.schema.js`.

#### 8. Supabase Changes
* Apply RLS policies on `payment_requests` table.

#### 9. API Endpoints
* `POST /api/v1/requests` — Create payment request to a contact.
* `GET /api/v1/requests` — List user's sent and received requests (with status filter: `PENDING`, `COMPLETED`, `DECLINED`).
* `GET /api/v1/requests/:id` — Get details of a specific payment request.
* `POST /api/v1/requests/:id/pay` — Settle request ("Pay Now", requires PIN & `X-Idempotency-Key`).
* `POST /api/v1/requests/:id/decline` — Decline an incoming payment request.
* `POST /api/v1/requests/:id/cancel` — Cancel an outgoing payment request.

#### 10. Authentication/Authorization Requirements
* User must be authenticated.
* Only target `payer_id` can pay or decline.
* Only `requester_id` can cancel.

#### 11. Security Requirements
* Settle endpoint requires 6-digit PIN verification.
* Prevent settling already `COMPLETED`, `DECLINED`, or `CANCELLED` requests.
* Enforce `X-Idempotency-Key` on `/pay` endpoint.

#### 12. Validation Requirements
* Amount must be positive decimal, requester cannot request money from themselves.

#### 13. Tests That Must Be Written
* `tests/integration/payment_request.test.js`:
  * Create request $\rightarrow$ status `PENDING`.
  * Unauthorized user attempts to pay request $\rightarrow$ returns HTTP 403 Forbidden.
  * Target payer pays request with valid PIN $\rightarrow$ payer debited, requester credited, request marked `COMPLETED`.
  * Payer attempts to pay already completed request $\rightarrow$ returns HTTP 400.
  * Payer declines request $\rightarrow$ status becomes `DECLINED`.

#### 14. Postman/API Testing Requirements
* Postman folder: `Payment Requests & Invoicing`.
* Requests:
  * Create Payment Request
  * List My Requests
  * Pay Request ("Pay Now")
  * Decline Request
  * Cancel Request

#### 15. Documentation That Must Be Created
* `docs/payment_requests_state_machine.md`: State transition diagram for payment requests.

#### 16. Definition of Done
* Full request lifecycle works end-to-end.
* Settling a request executes atomic transfer and updates request status.
* Integration tests pass.

#### 17. Acceptance Criteria
* Request cannot be paid more than once.
* Declined requests cannot be settled.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       ├── 016_payment_requests_rls.sql
│       └── 017_settle_payment_request_rpc.sql
├── docs/
│   └── payment_requests_state_machine.md
├── src/
│   ├── controllers/
│   │   └── payment_request.controller.js
│   ├── routes/
│   │   └── payment_request.routes.js
│   ├── schemas/
│   │   └── payment_request.schema.js
│   └── services/
│       └── payment_request.service.js
└── tests/
    └── integration/
        └── payment_request.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not implement push notifications for payment requests yet (handled in Sprint 8).

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 6 provides wallet funding so users have sufficient balance to pay requests.

---

### Sprint 6: Cards, Top-Up & Payment Gateway Webhooks

#### 1. Sprint Number and Name
* **Sprint 6: Cards, Top-Up & Payment Gateway Webhooks**

#### 2. Sprint Objective
* Implement PCI-DSS compliant card tokenization storage, top-up payment intent initiation, and an HMAC-SHA256 signature-verified webhook listener that credits wallet balances upon gateway settlement.

#### 3. Why This Sprint Exists
* Users must be able to link payment cards and deposit funds into their wallet balance (`FR-TOP-001` through `FR-TOP-005`, `FR-PRF-003`).

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 3 (Wallet crediting) and Sprint 4 (Idempotency and double-entry ledger).

#### 5. Exact Features to Implement
* Card Management Service (`CardService`):
  * Store tokenized card details (`gateway_customer_id`, `gateway_payment_method_id`, `brand`, `last4`, `expiry_month`, `expiry_year`, `is_default`).
  * Zero Raw Card Storage: Never accept, process, or store 16-digit PANs or CVC codes.
  * Delete saved card and set default payment card.
* Top-Up Service (`TopUpService`):
  * Create payment intent with the payment gateway adapter.
  * Predefined quick-select amounts ($100, $500, $1000, $1500, $2500) and custom amounts.
* Payment Gateway Webhook Listener (`POST /api/v1/webhooks/payments`):
  * Validates HMAC-SHA256 cryptographic signature against `PAYMENT_GATEWAY_WEBHOOK_SECRET`.
  * Verifies event type (e.g., `payment_intent.succeeded`).
  * Executes atomic wallet top-up: Credits `wallets.balance`, writes `transactions` record with type `TOP_UP`, and writes `CREDIT` to `ledger_entries`.
  * Idempotent webhook handling: Multiple deliveries of the same webhook do not result in multiple balance additions.

#### 6. Database Changes
* Stored procedure: `top_up_wallet_atomic(p_wallet_id, p_amount, p_reference, p_idempotency_key)`.
* Apply RLS policies to `public.saved_cards`: `SELECT`, `DELETE` permitted when `auth.uid() = user_id`.

#### 7. Node.js/Express Changes
* Payment Gateway Adapter: `src/services/gateways/payment_gateway.interface.js`, `src/services/gateways/stripe.adapter.js`, `src/services/gateways/mock.adapter.js`.
* Controllers: `src/controllers/card.controller.js`, `src/controllers/topup.controller.js`, `src/controllers/webhook.controller.js`.
* Express raw body parser configuration for webhook signature verification.

#### 8. Supabase Changes
* Apply RLS on `saved_cards` table.
* Deploy `top_up_wallet_atomic` stored procedure.

#### 9. API Endpoints
* `POST /api/v1/cards` — Save tokenized card reference.
* `GET /api/v1/cards` — List user's saved cards.
* `DELETE /api/v1/cards/:id` — Remove saved card.
* `PATCH /api/v1/cards/:id/default` — Set card as default.
* `POST /api/v1/top-up/intent` — Create top-up payment intent with gateway.
* `POST /api/v1/webhooks/payments` — Secure gateway webhook receiver.

#### 10. Authentication/Authorization Requirements
* `/cards` and `/top-up/intent` require user JWT.
* `/webhooks/payments` is unauthenticated but protected by mandatory HMAC-SHA256 signature verification.

#### 11. Security Requirements
* PCI-DSS Compliance: Strict rejection of any payload containing `card_number`, `pan`, or `cvc`.
* Raw body preservation on webhook route for HMAC cryptographic verification.
* Webhook signature replay attack prevention (timestamp freshness check).

#### 12. Validation Requirements
* Card expiry must be future date; last4 must be 4 digits; brand must be valid (`Visa`, `MasterCard`, `Amex`).

#### 13. Tests That Must Be Written
* `tests/integration/card.test.js`: Save card, list cards, set default, delete card.
* `tests/integration/webhook.test.js`:
  * Submitting webhook with invalid HMAC signature $\rightarrow$ rejected with HTTP 401 Unauthorized.
  * Submitting valid webhook $\rightarrow$ wallet credited by exact amount, transaction record created, ledger balanced.
  * Submitting duplicate webhook $\rightarrow$ acknowledged without duplicate balance credit.

#### 14. Postman/API Testing Requirements
* Postman folder: `Cards & Top-Up`.
* Requests:
  * Save Card Token
  * List Saved Cards
  * Create Top-Up Intent
  * Simulate Webhook Payment Succeeded

#### 15. Documentation That Must Be Created
* `docs/pci_dss_and_webhook_security.md`: Tokenization architecture and webhook security specification.

#### 16. Definition of Done
* Cards can be saved, listed, and removed safely.
* Valid webhook successfully credits the wallet atomically.
* Webhook rejects forged or tampered signatures.

#### 17. Acceptance Criteria
* `FR-TOP-004`: Database stores only non-sensitive tokens, brand, expiry, and last4.
* `TC-CARD-01`: Client submits only tokenized references.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       ├── 018_saved_cards_rls.sql
│       └── 019_top_up_wallet_atomic_rpc.sql
├── docs/
│   └── pci_dss_and_webhook_security.md
├── src/
│   ├── controllers/
│   │   ├── card.controller.js
│   │   ├── topup.controller.js
│   │   └── webhook.controller.js
│   ├── routes/
│   │   ├── card.routes.js
│   │   ├── topup.routes.js
│   │   └── webhook.routes.js
│   └── services/
│       ├── card.service.js
│       ├── topup.service.js
│       └── gateways/
│           ├── payment_gateway.interface.js
│           ├── mock.adapter.js
│           └── stripe.adapter.js
└── tests/
    └── integration/
        ├── card.test.js
        └── webhook.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not implement credit card cash-out/withdrawals to external bank accounts.

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 7 requires diverse transaction types (`TOP_UP`, `TRANSFER`, `REQUEST`) to calculate cash flow analytics.

---

### Sprint 7: Cash Flow Analytics & Financial Intelligence

#### 1. Sprint Number and Name
* **Sprint 7: Cash Flow Analytics & Financial Intelligence**

#### 2. Sprint Objective
* Implement the server-side aggregation engine for Cash Flow Analytics (`FR-ANA-001` through `FR-ANA-003`), providing income vs. expense metrics, net savings ratios, and categorized spending distributions across Weekly, Monthly, and Yearly intervals.

#### 3. Why This Sprint Exists
* The mobile application needs formatted financial telemetry to render Syncfusion interactive charts without computing aggregations on the device.

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 1 (database transactions), Sprint 4 (transfers), and Sprint 6 (top-ups).

#### 5. Exact Features to Implement
* Analytics Aggregation Engine:
  * Total Income: Sum of all `CREDIT` transactions (`TOP_UP`, inbound `TRANSFER`) within period.
  * Total Expense: Sum of all `DEBIT` transactions (outbound `TRANSFER`, settled `REQUEST`) within period.
  * Net Savings Ratio: $\frac{\text{Income} - \text{Expense}}{\text{Income}} \times 100\%$.
  * Periodic Time Series: Grouped by day (for weekly view), week (for monthly view), and month (for yearly view).
  * Category Breakdown: Total spent per category (`Food`, `Expense`, `Property`, `Hobby`, `Entertainment`) with relative percentage.
* Optimized PostgreSQL Aggregation Query / View for sub-100ms analytical responses.

#### 6. Database Changes
* SQL Migration: Add compound index on `transactions(sender_id, created_at)` and `transactions(receiver_id, created_at)` for analytics query performance.
* Create PostgreSQL stored procedure or view: `get_cash_flow_analytics(user_id, interval_type, start_date, end_date)`.

#### 7. Node.js/Express Changes
* Controllers: `src/controllers/analytics.controller.js`.
* Services: `src/services/analytics.service.js`.
* Routes: `src/routes/analytics.routes.js`.
* Schemas: `src/schemas/analytics.schema.js`.

#### 8. Supabase Changes
* Deploy `get_cash_flow_analytics` function to Supabase.

#### 9. API Endpoints
* `GET /api/v1/analytics/cash-flow` — Query parameters: `period` (`weekly`, `monthly`, `yearly`), `currency` (default `'USD'`).
  * Returns: `{ "summary": { "total_income": 3500.00, "total_expense": 1200.00, "net_savings_ratio": 65.71 }, "categories": [...], "chart_data": [...] }`.

#### 10. Authentication/Authorization Requirements
* Requires authenticated user JWT.
* Analytics are strictly filtered to the authenticated user's records.

#### 11. Security Requirements
* Query parameters sanitized against SQL injection.
* Limits query window to maximum 5 years.

#### 12. Validation Requirements
* `period` must be one of: `weekly`, `monthly`, `yearly`.

#### 13. Tests That Must Be Written
* `tests/integration/analytics.test.js`:
  * Seeds 5 transactions across different dates and categories.
  * Asserts income and expense totals match mathematically.
  * Asserts category percentages sum to 100%.
  * Tests empty transaction history returns 0.00 metrics without division-by-zero errors.

#### 14. Postman/API Testing Requirements
* Postman folder: `Cash Flow Analytics`.
* Requests:
  * Get Weekly Cash Flow
  * Get Monthly Cash Flow
  * Get Yearly Cash Flow

#### 15. Documentation That Must Be Created
* `docs/analytics_api_specification.md`: Chart data format and contract for Syncfusion Flutter integration.

#### 16. Definition of Done
* Analytics endpoint returns correct aggregations for all three time intervals.
* Edge cases (zero income, zero expenses) handled without calculation errors.

#### 17. Acceptance Criteria
* `FR-ANA-001`, `FR-ANA-002`: Accurately returns total income, total expense, savings ratio, and categorized spending.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       ├── 020_analytics_indexes.sql
│       └── 021_get_cash_flow_analytics_rpc.sql
├── docs/
│   └── analytics_api_specification.md
├── src/
│   ├── controllers/
│   │   └── analytics.controller.js
│   ├── routes/
│   │   └── analytics.routes.js
│   ├── schemas/
│   │   └── analytics.schema.js
│   └── services/
│       └── analytics.service.js
└── tests/
    └── integration/
        └── analytics.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not implement automated export to PDF/CSV receipts (handled in Sprint 10).

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 8 integrates transactional chat and notification events linked to transaction activity.

---

### Sprint 8: Real-Time Messaging & Notification Engine

#### 1. Sprint Number and Name
* **Sprint 8: Real-Time Messaging & Notification Engine**

#### 2. Sprint Objective
* Establish the real-time social messaging subsystem (Supabase Realtime WebSockets), apply chat RLS policies, implement the in-app Notification Center API, and configure background push notifications via Firebase Cloud Messaging (FCM).

#### 3. Why This Sprint Exists
* Users must be notified of inbound transfers and payment requests, and be able to chat with transacting counterparties with embedded transaction cards (`FR-MSG-001` through `FR-MSG-005`, `FR-NOT-001` through `FR-NOT-003`).

#### 4. Dependencies on Previous Sprints
* Depends on Sprint 1 (tables `conversations`, `messages`, `notifications`), Sprint 4 (transfers), and Sprint 5 (payment requests).

#### 5. Exact Features to Implement
* Chat Subsystem:
  * RLS policies on `conversations` and `messages`.
  * Endpoint to get or create conversation between two users.
  * Message embedding: Support linking a `transaction_id` to a message.
  * Enable Supabase Realtime replication on `public.messages`.
* Notification Subsystem:
  * In-app Notification Center endpoints (list notifications grouped by category, mark single as read, mark all as read).
  * Node.js Notification Dispatcher Service (`NotificationService`):
    * Dispatches FCM push notifications for:
      * Inbound transfer received.
      * Payment request received.
      * Payment request paid or declined.
      * PIN lockout or security event.
    * Inserts corresponding row into `public.notifications`.

#### 6. Database Changes
* Apply RLS policies for `conversations`, `messages`, and `notifications`.
* Enable Realtime publication in PostgreSQL: `ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;`.

#### 7. Node.js/Express Changes
* Firebase Admin SDK configuration: `src/config/firebase.js`.
* Controllers: `src/controllers/notification.controller.js`, `src/controllers/conversation.controller.js`.
* Services: `src/services/notification.service.js`, `src/services/chat.service.js`.
* Event listeners linking transfer and payment request completion to notification dispatch.

#### 8. Supabase Changes
* Configure Supabase Realtime settings to allow client subscriptions to `messages`.
* Apply RLS policies for messaging and notification tables.

#### 9. API Endpoints
* `GET /api/v1/conversations` — List active conversations with last message preview.
* `POST /api/v1/conversations` — Start or get conversation with another user.
* `GET /api/v1/conversations/:id/messages` — Paginated message history for a conversation.
* `POST /api/v1/conversations/:id/messages` — Send message (with optional `transaction_id`).
* `GET /api/v1/notifications` — List user notifications (filterable by `category` and `is_read`).
* `PATCH /api/v1/notifications/:id/read` — Mark notification as read.
* `POST /api/v1/notifications/read-all` — Mark all notifications as read.
* `POST /api/v1/users/device-token` — Register device FCM token for push notifications.

#### 10. Authentication/Authorization Requirements
* Requires authenticated user JWT.
* Users can only access conversations they participate in.

#### 11. Security Requirements
* RLS prevents eavesdropping: Non-participants cannot select messages.
* FCM credentials securely loaded from environment/service-account file.

#### 12. Validation Requirements
* Message content must not be empty; max length 2000 characters.

#### 13. Tests That Must Be Written
* `tests/integration/chat.test.js`:
  * User A starts conversation with User B.
  * User A sends message $\rightarrow$ User B can read it.
  * User C attempts to read conversation between A and B $\rightarrow$ returns HTTP 403 / zero rows via RLS.
* `tests/integration/notification.test.js`:
  * Executing transfer automatically triggers notification creation for receiver.
  * Marking notification as read updates `is_read` flag.

#### 14. Postman/API Testing Requirements
* Postman folder: `Messaging & Notifications`.
* Requests:
  * List Conversations
  * Send Message in Conversation
  * Get Notifications
  * Mark Notification as Read
  * Register FCM Device Token

#### 15. Documentation That Must Be Created
* `docs/realtime_and_notifications.md`: WebSocket channel subscription guide and FCM push notification payload schema.

#### 16. Definition of Done
* Realtime chat verified via WebSocket channel test.
* Transfers automatically create notifications and trigger mock/live FCM push.
* RLS policies strictly enforced on chat and notifications.

#### 17. Acceptance Criteria
* `NFR-PERF-005`: Message delivery latency $< 300\text{ms}$ via Supabase Realtime.
* `FR-NOT-002`: Notification Center groups alerts by category.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       ├── 022_chat_rls_and_realtime.sql
│       └── 023_notifications_rls.sql
├── docs/
│   └── realtime_and_notifications.md
├── src/
│   ├── config/
│   │   └── firebase.js
│   ├── controllers/
│   │   ├── conversation.controller.js
│   │   └── notification.controller.js
│   ├── routes/
│   │   ├── conversation.routes.js
│   │   └── notification.routes.js
│   └── services/
│       ├── chat.service.js
│       └── notification.service.js
└── tests/
    └── integration/
        ├── chat.test.js
        └── notification.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not implement media/audio attachment streaming inside chat (text and embedded transaction cards only).

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 9 hardens the entire backend across all implemented endpoints.

---

### Sprint 9: Security Hardening & Compliance Enforcement

#### 1. Sprint Number and Name
* **Sprint 9: Security Hardening & Compliance Enforcement**

#### 2. Sprint Objective
* Audit, harden, and secure the complete backend surface: implement API rate limiting, strict request sanitization, anti-money laundering (AML) monitoring, secrets isolation validation, and security headers.

#### 3. Why This Sprint Exists
* FinTech systems require defense-in-depth protection (`NFR-SEC-001` through `NFR-SEC-005`, `NFR-COMP-001` through `NFR-COMP-003`) to prevent DDoS attacks, credential stuffing, brute force, and compliance violations.

#### 4. Dependencies on Previous Sprints
* Depends on all previous sprints (Sprints 0 through 8).

#### 5. Exact Features to Implement
* Rate Limiting:
  * Global rate limiter (100 requests / 15 minutes per IP).
  * Strict authentication limiter (5 requests / minute on PIN endpoints to prevent brute-forcing).
  * Transfer rate limiter (10 transfers / minute per user).
* Security Isolation Audit:
  * Automated test asserting that `SUPABASE_SERVICE_ROLE_KEY` is not present in any client-exposed response or bundle.
* AML Enforcement Middleware:
  * Enforces maximum daily transfer limit ($10,000) and maximum single transfer limit ($2,500) for unverified tiers.
  * Blocks accounts flagged with `status = 'FROZEN'`.
* HTTP Security Hardening:
  * CORS origin locking.
  * HSTS (HTTP Strict Transport Security) configuration.
  * Request payload size limits (reject payloads $> 100\text{KB}$ on JSON routes).
* Audit Trail Immutability Verification:
  * PostgreSQL trigger that blocks `UPDATE` or `DELETE` statements on `public.transactions` and `public.ledger_entries`.

#### 6. Database Changes
* SQL Migration: Create trigger `prevent_ledger_mutation` preventing any `UPDATE` or `DELETE` on `transactions` and `ledger_entries`.

#### 7. Node.js/Express Changes
* Middlewares: `src/middlewares/rateLimiter.js`, `src/middlewares/amlValidation.js`.
* Security configuration adjustments in `src/app.js`.

#### 8. Supabase Changes
* Deploy immutability triggers to Supabase PostgreSQL.

#### 9. API Endpoints
* Security configuration applies globally across all existing endpoints.

#### 10. Authentication/Authorization Requirements
* Applied to both public and authenticated routes.

#### 11. Security Requirements
* Rate limits return HTTP 429 (Too Many Requests) with `Retry-After` header.
* Immutable tables throw a PostgreSQL exception if any `DELETE` or `UPDATE` is attempted, even by database administrators.

#### 12. Validation Requirements
* Input sanitization strips any dangerous characters or SQL injection attempts.

#### 13. Tests That Must Be Written
* `tests/integration/security.test.js`:
  * Rapidly submits 6 PIN verification requests $\rightarrow$ 6th request rejected with HTTP 429.
  * Submits transfer of $2,500.01 $\rightarrow$ rejected by AML check (exceeds single transfer limit).
  * Direct SQL test: Attempt `DELETE FROM transactions` $\rightarrow$ throws trigger exception `Financial audit records are immutable`.
  * Service role key leak audit test: Asserts that no endpoint returns the service role key in body or headers.

#### 14. Postman/API Testing Requirements
* Postman folder: `Security & Rate Limiting Tests`.
* Requests:
  * Test Rate Limiting Trigger
  * Test AML Single Transfer Limit ($2,500.01)

#### 15. Documentation That Must Be Created
* `docs/security_and_compliance_audit.md`: Formal security audit report documenting OWASP and AML compliance.

#### 16. Definition of Done
* Rate limiters actively block abuse.
* Database-level immutability triggers are active on financial tables.
* Security test suite passes completely.

#### 17. Acceptance Criteria
* `NFR-INT-004`: Transactions and ledger entries cannot be modified or deleted under any circumstances.
* `NFR-COMP-002`: AML limits strictly enforced.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── database/
│   └── migrations/
│       └── 024_immutable_ledger_trigger.sql
├── docs/
│   └── security_and_compliance_audit.md
├── src/
│   └── middlewares/
│       ├── amlValidation.js
│       └── rateLimiter.js
└── tests/
    └── integration/
        └── security.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not implement third-party KYC identity document verification vendors (e.g., Onfido/Jumio).

#### 20. What the Next Sprint Depends on from This Sprint
* Sprint 10 requires the fully hardened backend for comprehensive verification and handoff.

---

### Sprint 10: End-to-End Verification, Documentation & Flutter Handoff

#### 1. Sprint Number and Name
* **Sprint 10: End-to-End Verification, Documentation & Flutter Handoff**

#### 2. Sprint Objective
* Execute the complete acceptance test matrix, generate OpenAPI / Swagger documentation, create an end-to-end Postman Collection with automated test scripts, and build the "Flutter Integration Guide" with GetX architecture code examples.

#### 3. Why This Sprint Exists
* To mark the backend as 100% complete, verified, and ready for seamless integration with the existing Flutter application without requiring backend changes during client integration.

#### 4. Dependencies on Previous Sprints
* Depends on all Sprints (0 through 9).

#### 5. Exact Features to Implement
* Comprehensive E2E Test Suite verifying the full user lifecycle:
  1. Signup $\rightarrow$ Profile & Wallet auto-created.
  2. PIN Setup $\rightarrow$ Argon2id hashed.
  3. Top-Up via Webhook $\rightarrow$ Balance credited.
  4. P2P Transfer $\rightarrow$ Sender debited, Receiver credited, balanced ledger entries.
  5. Payment Request $\rightarrow$ Created, settled via "Pay Now", status updated.
  6. In-App Notification $\rightarrow$ Received and marked as read.
  7. Cash Flow Analytics $\rightarrow$ Accurate income/expense totals.
* Swagger / OpenAPI 3.0 specification generation.
* Master Postman Collection with environment variables and pre-request scripts.
* Flutter Integration Guide documenting exact Dart service classes and GetX controller patterns.

#### 6. Database Changes
* None (Verification and documentation phase).

#### 7. Node.js/Express Changes
* Add Swagger UI route (`GET /api-docs`) serving the generated OpenAPI spec.

#### 8. Supabase Changes
* Final schema verification and production database backup test.

#### 9. API Endpoints
* `GET /api-docs` — Swagger UI API documentation.
* `GET /api-docs.json` — Raw OpenAPI 3.0 JSON specification.

#### 10. Authentication/Authorization Requirements
* Documentation endpoints are public.

#### 11. Security Requirements
* Ensure no secret keys, service role keys, or production credentials appear in the documentation or Postman collection.

#### 12. Validation Requirements
* 100% pass rate on all automated tests.

#### 13. Tests That Must Be Written
* `tests/e2e/full_lifecycle.test.js`: Full multi-user simulation test covering onboarding, top-up, transfer, payment request, chat, and analytics.
* Automated test coverage report generation (target: $\ge 90\%$ coverage across controllers and services).

#### 14. Postman/API Testing Requirements
* Finalized `B-Wallet Master API Collection.json` with pre-request token population and test assertion scripts.
* `B-Wallet Local Environment.json`.

#### 15. Documentation That Must Be Created
* `docs/flutter_integration_guide.md`: Complete guide for the Flutter team including:
  * Supabase Flutter client configuration.
  * Node.js API client repository implementation in Dart.
  * GetX controller integration examples (`AuthController`, `PinController`, `WalletController`, `SendController`, `TopUpController`).
  * Realtime message streaming listener implementation.
* `docs/api_reference.md`: Markdown version of the complete API reference.

#### 16. Definition of Done
* All acceptance criteria in SRS Section 8.1 pass completely.
* Swagger UI renders all routes at `/api-docs`.
* Master Postman collection runs through Newman CLI or Postman runner with 0 failures.
* Flutter Integration Guide is complete and verified against the existing Flutter project structure.

#### 17. Acceptance Criteria
* `TC-AUTH-01` through `TC-CARD-01` pass.
* Backend is completely ready for Flutter connection.

#### 18. Files/Folders Expected to Be Created
```
b-wallet/
├── docs/
│   ├── api_reference.md
│   ├── flutter_integration_guide.md
│   └── openapi.json
├── postman/
│   ├── B-Wallet Master API Collection.json
│   └── B-Wallet Local Environment.json
├── src/
│   └── docs/
│       └── swagger.js
└── tests/
    └── e2e/
        └── full_lifecycle.test.js
```

#### 19. What Must NOT Be Implemented in This Sprint
* Do not write Flutter code directly in this repository (the guide provides the exact integration blueprints for the Flutter application).

#### 20. What the Next Sprint Depends on from This Sprint
* Post-Sprint 10: The backend is 100% complete. The Flutter mobile app can now be connected to the backend.

---

## Execution Instructions for the Developer

When you are ready to begin implementation, invoke the sprints one at a time using this command:

```
Implement Sprint X
```

*(Where X is the sprint number from 0 to 10).*

### What happens when you say "Implement Sprint X":
1. I will implement the **entire sprint completely** without stopping midway.
2. All database migrations, Node.js code, controllers, services, middlewares, schemas, tests, and documentation defined for that sprint will be created.
3. Automated tests for that sprint will be run and validated.
4. When finished, I will provide the completed sprint summary and wait for your command to proceed to the next sprint.
