# B-Wallet Backend Analysis, Architecture & Implementation Plan

**Document Version:** 1.0.0  
**Project:** B-Wallet (FinTech Digital Wallet)  
**Target Backend Stack:** Node.js, Express.js, Supabase (PostgreSQL 15+, Supabase Auth, Supabase Realtime, Supabase Storage)  
**Client:** Flutter (GetX architecture)  

---

## 1. What the Application Does from a Backend Perspective

At its core, **B-Wallet is a digital ledger, banking engine, and communication hub**.

From a backend perspective, B-Wallet:
1. **Acts as a Trusted Digital Vault:** Securely maintains user identity, authentication state, and spendable balances in USD. The backend ensures that balances cannot be tampered with on the client device.
2. **Executes Money Movements:** Guarantees that when User A transfers $50 to User B:
   - User A has $\ge \$50$ plus any applicable fees.
   - User A is debited exactly $50.
   - User B is credited exactly $50.
   - Both debit and credit balance out to zero net difference (Double-Entry Bookkeeping).
   - The entire operation executes atomically (either 100% succeeds or 100% rolls back).
3. **Interfaces with Payment Providers:** Interfaces with external payment gateways (e.g., Stripe, Checkout.com, or a local payment switch) to allow users to link bank cards and top up their wallet balance, adhering strictly to **PCI-DSS Level 4** zero-raw-card-storage regulations.
4. **Maintains Real-Time Communication:** Bridges financial interactions with real-time peer messaging (Supabase Realtime WebSockets) and delivers push notifications (FCM / APNs) when funds are received or requested.

---

## 2. Backend Architecture: The Hybrid Client-Server Model

The SRS specifies a **Hybrid Architecture** that partitions responsibilities between Supabase (BaaS) and Node.js (Microservice) to optimize speed while strictly protecting financial boundaries.

```
+-------------------------------------------------------------------------+
|                              B-WALLET CLIENT                            |
|             Flutter 3.27+ / Dart 3.6+ / GetX State & Navigation         |
+--------------------+-------------------------------+--------------------+
                     |                               |
        (Direct SDK With JWT / RLS)         (HTTPS REST / Idempotent JSON)
                     |                               |
                     v                               v
+--------------------+--------------+   +------------+--------------------+
|            SUPABASE BaaS          |   |       NODE.JS SECURE API        |
|  - Supabase Auth (JWT Provider)   |   |  - Double-Entry Orchestrator    |
|  - PostgreSQL with RLS Policies   |<--+  - Payment Gateway Adapter      |
|  - Realtime WebSocket Engine      |   |  - PIN Argon2id Verification    |
|  - S3-Compatible Storage (Avatars)|   |  - Webhook Consumer (HMAC-SHA)  |
+-----------------------------------+   +---------------------------------+
```

### Why a Hybrid Architecture?
* **Why not route everything through Flutter $\rightarrow$ Supabase?**  
  Allowing the mobile client to update wallet balances or ledger tables directly is dangerous. Financial rules (PIN verification, anti-money laundering velocity checks, 3-attempt lockouts, idempotency checks, and gateway webhooks) require server-controlled elevated credentials (`SUPABASE_SERVICE_ROLE_KEY`) that must never exist inside a mobile application.
* **Why not route everything through Flutter $\rightarrow$ Node.js?**  
  Routing high-frequency read operations (fetching balance, loading paginated transactions, streaming real-time chat messages) through Node.js would create unnecessary server load and latency. Supabase handles database reads securely at the database level using **Row Level Security (RLS)**.

---

## 3. Backend Modules & Functional Scope

The SRS outlines **11 distinct modules**:

| Module ID | Module Name | Primary Responsibility |
| :--- | :--- | :--- |
| **Module 1** | Authentication, Authorization & Identity | User registration, login, JWT validation, password recovery with OTP/Magic Link. |
| **Module 2** | Transaction Security & PIN Verification | 6-digit transaction PIN setup, Argon2id hashing, verification, and lockout logic. |
| **Module 3** | Digital Wallet & Balance Operations | Wallet creation, balance tracking with fixed-point arithmetic (`NUMERIC(15,2)`). |
| **Module 4** | Fund Inflow (Top-Up & Card Linking) | PCI-compliant card tokenization, top-up payment intents, and webhook settlements. |
| **Module 5** | Peer-to-Peer (P2P) Fund Transfers | Instant transfers between registered users using atomic database transactions. |
| **Module 6** | Payment Requests & Invoicing | Generating payment request tickets and processing "Pay Now" settlements. |
| **Module 7** | Cash Flow Analytics & Financial Intelligence | Aggregating income vs. expense trends over Weekly, Monthly, and Yearly intervals. |
| **Module 8** | Transaction Ledger & Digital Receipts | Immutable, paginated historical audit log with filtering and receipt details. |
| **Module 9** | Real-Time Messaging & Conversation Threading | WebSocket-powered instant chat with embedded financial action cards. |
| **Module 10** | Notification Engine & Alert Dispatcher | FCM / APNs push notifications and in-app notification center inbox. |
| **Module 11** | User Profile & Security Preferences | Profile attributes, avatar storage, and saved card management. |

---

## 4. Detailed Module Explanations

### Module 1: Authentication, Authorization & Identity
* **What it does:** Manages onboarding, login, session refresh, and credential recovery.
* **Mechanism:** Handled directly via **Supabase Auth**. Upon successful login, Supabase returns a cryptographically signed **JWT** (access token valid for 1 hour, refresh token valid for 30 days).
* **Constraints:** Password requirements (min 8 chars, 1 uppercase, 1 digit, 1 special character), OTP cooldown timer (60 seconds), OTP expiration (5 minutes, invalidated after 3 incorrect attempts).

### Module 2: Transaction Security & PIN Verification
* **What it does:** Protects all monetary operations with a dedicated 6-digit numeric Security PIN distinct from the login password.
* **Mechanism:** Managed by **Node.js**. When a user creates or updates their PIN, Node.js hashes it using **Argon2id** with a unique per-user cryptographic salt. Plaintext PINs are never stored or logged.
* **Lockout Rule:** 3 consecutive incorrect entries lock the wallet's transaction capability for 15 minutes by setting `pin_locked_until = NOW() + INTERVAL '15 minutes'`.

### Module 3: Digital Wallet & Balance Operations
* **What it does:** Maintains user balances and broadcasts real-time balance changes.
* **Financial Precision Standard:** All monetary amounts use PostgreSQL `NUMERIC(15,2)` (fixed-point arithmetic), preventing floating-point precision errors.
* **Realtime Sync:** Balance changes are broadcast live to Flutter via Supabase Realtime Change Data Capture (CDC).

### Module 4: Fund Inflow (Top-Up & Card Linking)
* **What it does:** Allows users to add money via linked credit/debit cards.
* **PCI-DSS Compliance:** The Flutter client uses the payment processor's SDK (e.g., Stripe SDK) to tokenize card details directly with the gateway. The B-Wallet backend **only** receives and stores the non-sensitive token, card brand, expiration date, and last 4 digits.
* **Settlement:** The payment gateway notifies Node.js via an HTTPS webhook. Node.js validates the cryptographic signature (HMAC-SHA256), credits the wallet, and records ledger entries.

### Module 5: Peer-to-Peer (P2P) Fund Transfers
* **What it does:** Instant transfers between registered users.
* **Execution:** Handled exclusively via Node.js calling an atomic PostgreSQL stored procedure (`transfer_funds_atomic`).
* **Validation:** Verifies PIN $\rightarrow$ checks sender balance $\ge$ amount + fee $\rightarrow$ locks wallet rows $\rightarrow$ updates balances $\rightarrow$ writes transaction header $\rightarrow$ inserts balanced debit/credit ledger records $\rightarrow$ triggers push notification to receiver.

### Module 6: Payment Requests & Invoicing
* **What it does:** User A creates an interactive payment request ticket sent to User B. User B can tap "Pay Now" or "Decline".
* **Settlement:** Tapping "Pay Now" prompts for User B's PIN and triggers an atomic transfer to User A, marking the request ticket as `COMPLETED`.
* > [!NOTE]
  > **Needs Decision:** Whether payment requests should be stored in the `transactions` table (with `type = 'REQUEST'` and `status = 'PENDING'`) or in a dedicated `payment_requests` table. A dedicated table provides cleaner querying and separation of pending invoices from completed financial ledgers.

### Module 7: Cash Flow Analytics & Financial Intelligence
* **What it does:** Visualizes income vs. expense trends (Weekly, Monthly, Yearly) and category breakdowns.
* > [!NOTE]
  > **Needs Decision:** Whether analytics are computed client-side in Flutter (by querying `transactions`) or via a dedicated backend aggregation endpoint (`GET /api/v1/analytics/cash-flow`). A backend endpoint reduces mobile data usage and battery consumption.

### Module 8: Transaction Ledger & Digital Receipts
* **What it does:** Chronological, paginated (20 per page) list of all transactions with filtering.
* **Immutability Guarantee:** Transactions are **append-only**. `UPDATE` and `DELETE` queries on the `transactions` table are strictly forbidden. Corrections are modeled as new reversing or adjusting transactions.

### Module 9: Real-Time Social Messaging & Conversation Threading
* **What it does:** Chat conversations between transacting counterparties with embedded transaction cards.
* **Mechanism:** Handled by Supabase Realtime WebSockets over TLS (`realtime:public:messages:conversation_id=eq.{id}`) with sub-300ms latency.

### Module 10: Notification Engine & Alert Dispatcher
* **What it does:** Dispatches push notifications for credits, payment requests, and security alerts, while backing an in-app notification center (`/notify`).
* > [!IMPORTANT]
  > **Needs Decision:** The SRS requires an in-app notification center grouped by category ("Transactions", "Promos", "System Alerts"), but omits a `notifications` table in the database schema (Section 6.2). We must add a `public.notifications` table to the database.

### Module 11: User Profile & Security Preferences
* **What it does:** Manages profile attributes (first/last name, phone, birthday, avatar) and saved cards.
* **Mechanism:** Direct reads and updates via Supabase SDK governed by RLS. Avatar images are stored in a dedicated Supabase Storage bucket (`avatars`).

---

## 5. Database Architecture & Schema Analysis

```
              +--------------------+
              |   auth.users       |
              |  (Supabase Auth)   |
              +---------+----------+
                        | 1:1
                        v
              +---------+----------+         1:1          +--------------------+
              |     profiles       |--------------------->|      wallets       |
              +---------+----------+                      +---------+----------+
                        | 1:N                                       | 1:N
                        |                                           v
                        |                            +--------------+-----+
                        |                            |  ledger_entries    |
                        |                            +--------------------+
                        |                                           ^
                        +-------------------+ 1:N                   | 1:N
                        |                   |-----------------------+
                        v                   v                       |
              +---------+----+      +-------+------+     +----------+---+
              | saved_cards  |      | conversations|     | transactions |
              +--------------+      +-------+------+     +--------------+
                                            | 1:N
                                            v
                                    +-------+------+
                                    |   messages   |
                                    +--------------+
```

### Schema Tables & Purposes

1. **`auth.users` (Supabase Internal):**
   * Manages authentication credentials, hashed passwords, email/phone confirmation states, and JWT claims.
2. **`public.profiles`:**
   * **Purpose:** Stores user profile attributes and transaction security settings.
   * **Key Columns:** `id` (FK to `auth.users`), `first_name`, `last_name`, `phone_number`, `avatar_url`, `pin_hash`, `pin_failed_attempts`, `pin_locked_until`, `is_verified`.
3. **`public.wallets`:**
   * **Purpose:** Holds current spendable balance per user per currency.
   * **Key Columns:** `id`, `user_id` (FK to `profiles`), `currency` (default `'USD'`), `balance` (`NUMERIC(15,2)`), `status` (`ACTIVE`, `FROZEN`, `CLOSED`).
4. **`public.transactions`:**
   * **Purpose:** Immutable transaction headers representing business operations.
   * **Key Columns:** `id`, `transaction_reference`, `sender_id`, `receiver_id`, `amount`, `fee`, `currency`, `type` (`TOP_UP`, `TRANSFER`, `REQUEST`, `BILL_PAYMENT`), `status` (`PENDING`, `COMPLETED`, `FAILED`, `REVERSED`), `category`, `idempotency_key`, `created_at`, `settled_at`.
5. **`public.ledger_entries`:**
   * **Purpose:** Double-entry accounting ledger entries. Every financial transaction produces offsetting debit and credit records.
   * **Key Columns:** `id`, `transaction_id` (FK to `transactions`), `wallet_id` (FK to `wallets`), `direction` (`DEBIT`, `CREDIT`), `amount`.
6. **`public.saved_cards`:**
   * **Purpose:** Tokenized payment method storage.
   * **Key Columns:** `id`, `user_id` (FK to `profiles`), `gateway_customer_id`, `gateway_payment_method_id`, `brand`, `last4`, `expiry_month`, `expiry_year`, `is_default`.
7. **`public.conversations`:**
   * **Purpose:** Chat session headers between two counterparties.
   * **Key Columns:** `id`, `participant_one` (FK to `profiles`), `participant_two` (FK to `profiles`), `last_message_text`, `last_message_time`.
8. **`public.messages`:**
   * **Purpose:** Individual chat messages.
   * **Key Columns:** `id`, `conversation_id` (FK to `conversations`), `sender_id` (FK to `profiles`), `content`, `is_read`, `transaction_id` (optional FK to `transactions`).

### Required Additional Tables [Needs Decision]
9. **`public.notifications`:**
   * **Purpose:** Backs the in-app notification center (`/notify`).
   * **Proposed Columns:** `id UUID PK`, `user_id UUID FK`, `title TEXT`, `body TEXT`, `category VARCHAR(30)` (`TRANSACTIONS`, `PROMOS`, `SYSTEM`), `is_read BOOLEAN DEFAULT FALSE`, `metadata JSONB`, `created_at TIMESTAMPTZ`.
10. **`public.idempotency_keys` (or Redis cache):**
    * **Purpose:** Stores the in-flight status and cached response of processed idempotent requests to prevent race conditions during network retries.

---

## 6. Work Distribution: Supabase vs. Node.js

| Feature / Operation | Routed Via | Reason |
| :--- | :--- | :--- |
| User Registration, Login, Logout | **Direct to Supabase** | Handled natively by Supabase Auth (JWT issuance). |
| Password Recovery & OTP Verification | **Direct to Supabase** | Managed by Supabase Auth email/SMS handlers. |
| Fetch Profile & Update Profile Details | **Direct to Supabase** | Protected by RLS (`auth.uid() = id`). |
| Fetch Available Wallet Balance | **Direct to Supabase** | Read-only with RLS (`auth.uid() = user_id`). Fast and low-latency. |
| Fetch Transaction History & Receipts | **Direct to Supabase** | Read-only with RLS (`auth.uid() IN (sender_id, receiver_id)`). |
| Fetch Saved Payment Cards | **Direct to Supabase** | Read-only with RLS. Contains only safe tokens and last 4 digits. |
| Send & Receive Chat Messages | **Direct to Supabase** | Realtime WebSockets over Supabase CDC. |
| Upload Avatar Image | **Direct to Supabase** | Handled via Supabase Storage buckets. |
| **Set / Change 6-Digit PIN** | **Node.js API** | Requires Argon2id hashing with cryptographic salting. |
| **Verify PIN & Lockout Enforcement** | **Node.js API** | Enforces 3-attempt failure tracking and 15-minute lockouts. |
| **Execute P2P Transfer** | **Node.js API** | Highly sensitive; executes atomic DB procedures, checks balances, verifies idempotency. |
| **Initiate Card Top-Up** | **Node.js API** | Interacts with payment gateway server APIs using secret gateway keys. |
| **Payment Gateway Webhook Listener** | **Node.js API** | Validates HMAC-SHA256 signature and credits wallet balances. |
| **Settle Payment Request ("Pay Now")** | **Node.js API** | Executes atomic balance transfer between two users with PIN verification. |
| **Dispatch Push Notifications** | **Node.js API** | Uses private Firebase Admin SDK credentials to dispatch FCM alerts. |

---

## 7. Financially Sensitive Operations & Atomic Transactions

### What is an Atomic Transaction?
An **Atomic Transaction** guarantees that a series of database operations either **all execute successfully** or **all roll back completely**, leaving the database in its original state.

### Sensitive Operations in B-Wallet:
1. **Peer-to-Peer (P2P) Fund Transfer:**
   ```
   BEGIN TRANSACTION;
     1. Lock Sender Wallet Row (SELECT ... FOR UPDATE);
     2. Lock Receiver Wallet Row (SELECT ... FOR UPDATE);
     3. Verify Sender Balance >= (Amount + Fee);
     4. UPDATE Sender Wallet: balance = balance - (Amount + Fee);
     5. UPDATE Receiver Wallet: balance = balance + Amount;
     6. INSERT INTO transactions (status = 'COMPLETED', ...);
     7. INSERT INTO ledger_entries (DEBIT Sender);
     8. INSERT INTO ledger_entries (CREDIT Receiver);
   COMMIT;
   ```
   *If any step fails (e.g. sender has insufficient funds or a network timeout occurs), PostgreSQL executes `ROLLBACK` and zero balances are altered.*

2. **Top-Up Settlement via Webhook:**
   * Confirms payment gateway settlement, credits user's wallet, inserts transaction record, and creates a ledger credit entry.

3. **Payment Request Settlement ("Pay Now"):**
   * Debits payer, credits requester, balances ledger entries, and updates the request ticket status from `PENDING` to `COMPLETED`.

4. **PIN Failure Tracking and Lockout:**
   * Atomically increments `pin_failed_attempts` and sets `pin_locked_until = NOW() + INTERVAL '15 minutes'` on the 3rd failed attempt.

---

## 8. Role of PostgreSQL Functions / Stored Procedures (RPCs)

### What is an RPC?
An **RPC (Remote Procedure Call)** is a PL/pgSQL function stored and executed directly inside the PostgreSQL database engine.

### Why RPCs are Essential for B-Wallet:
1. **Eliminating Race Conditions:** Using `SELECT ... FOR UPDATE` locks the wallet rows at the database level, preventing "double-spending" if a user rapidly double-taps "Send" or submits concurrent requests from two devices.
2. **Performance & Latency:** Instead of Node.js executing 6 round-trip SQL queries over the network, Node.js calls a single RPC (`transfer_funds_atomic(...)`), reducing execution time from ~100ms to <10ms.
3. **Absolute Data Integrity:** The business logic governing debit/credit balancing is enforced directly within the database engine.

---

## 9. Row Level Security (RLS) Matrix

RLS acts as an un-bypassable database firewall for direct client queries from Flutter:

| Table | Permitted Operations | RLS Policy Rule | Explanation |
| :--- | :--- | :--- | :--- |
| `profiles` | `SELECT`, `UPDATE` | `auth.uid() = id` | Users can only view and update their own profile. |
| `wallets` | `SELECT` | `auth.uid() = user_id` | Users can view their own balance. Direct client `UPDATE`/`INSERT` is blocked. |
| `transactions` | `SELECT` | `auth.uid() IN (sender_id, receiver_id)` | Users can only view transactions they sent or received. Client writes blocked. |
| `saved_cards` | `SELECT`, `DELETE` | `auth.uid() = user_id` | Users can only view and delete their own tokenized cards. |
| `conversations` | `SELECT` | `auth.uid() IN (participant_one, participant_two)` | Users can only view conversations they belong to. |
| `messages` | `SELECT`, `INSERT` | `auth.uid() = sender_id AND EXISTS (SELECT 1 FROM conversations WHERE id = conversation_id AND auth.uid() IN (participant_one, participant_two))` | Users can only read/send messages in their own conversations. |
| `notifications` | `SELECT`, `UPDATE` | `auth.uid() = user_id` | Users can only view and mark their own notifications as read. |

---

## 10. Complete API Specification

### A. Node.js Express Endpoints (Port 3000 / Base `/api/v1`)

```
POST   /api/v1/auth/pin/setup       - Set initial 6-digit PIN
POST   /api/v1/auth/pin/verify      - Verify PIN (returns temporary verification token)
POST   /api/v1/auth/pin/change      - Change PIN (requires current PIN verification)
POST   /api/v1/transfers            - Execute atomic P2P transfer (requires X-Idempotency-Key)
POST   /api/v1/top-up/intent        - Create gateway payment intent for card top-up
POST   /api/v1/webhooks/payments    - Payment gateway webhook consumer (HMAC verification)
POST   /api/v1/requests             - Create a new payment request
POST   /api/v1/requests/:id/pay     - Settle a payment request ticket
POST   /api/v1/requests/:id/decline - Decline a payment request ticket
GET    /api/v1/analytics/cash-flow  - [Needs Decision] Aggregate income/expense metrics
```

### B. Supabase Native Client Operations (Flutter `supabase_flutter`)

```dart
// Auth
supabase.auth.signUp(email: email, password: password);
supabase.auth.signInWithPassword(email: email, password: password);
supabase.auth.verifyOTP(type: OtpType.sms, token: code);
supabase.auth.resetPasswordForEmail(email);

// Reads (Governed by RLS)
supabase.from('profiles').select().eq('id', currentUserId);
supabase.from('wallets').select().eq('user_id', currentUserId);
supabase.from('transactions').select().order('created_at', ascending: false).range(0, 19);
supabase.from('saved_cards').select().eq('user_id', currentUserId);
supabase.from('conversations').select();
supabase.from('messages').select().eq('conversation_id', conversationId);

// Realtime Subscriptions
supabase.channel('public:messages')
  .onPostgresChanges(
    event: PostgresChangeEvent.insert,
    schema: 'public',
    table: 'messages',
    filter: 'conversation_id=eq.$conversationId',
    callback: (payload) => handleNewMessage(payload)
  ).subscribe();
```

---

## 11. External Services & Integrations

1. **Supabase Cloud (PostgreSQL 15+):** Database, Auth, Realtime WebSockets, and Storage.
2. **Payment Gateway (e.g., Stripe / Checkout.com / Local Switch):**
   * Client-side SDK for PCI-compliant card tokenization.
   * Server-side API for payment intent creation.
   * Webhook dispatcher with HMAC-SHA256 signature verification.
3. **Push Notification Gateway (Firebase Cloud Messaging - FCM & APNs):**
   * Firebase Admin SDK running on Node.js to trigger push notifications on funds received, payment requests, and security alerts.
4. **SMS / Email Provider:**
   * Twilio (SMS OTP) or SendGrid / Resend / Supabase SMTP for authentication codes and magic links.

---

## 12. Security & Compliance Requirements

* **PCI-DSS Level 4 Compliance:** Primary Account Numbers (PAN) and CVC codes are never transmitted to or stored in B-Wallet servers.
* **Argon2id Cryptographic Hashing:** 6-digit transaction PINs are hashed using Argon2id with unique salt.
* **Idempotency Guarantee:** Sensitive POST requests require an `X-Idempotency-Key` (UUIDv4). Submitting the same key returns the existing transaction result without re-executing debits.
* **Credential Isolation:** The elevated `SUPABASE_SERVICE_ROLE_KEY` is strictly confined to the Node.js environment variables.
* **AML Velocity Limits:** Maximum transfer limit of $2,500 per single transaction; maximum daily transfer limit of $10,000 for unverified accounts.
* **Transport Security:** Mandatory TLS 1.3 encryption for all HTTP and WebSocket endpoints.

---

## 13. Testing Requirements

Based on the SRS Acceptance Test Matrix:

* `TC-AUTH-01`: User registration creates an `auth.users` row and a linked `profiles` row.
* `TC-PIN-01`: 3 consecutive incorrect PIN entries lock the wallet for 15 minutes.
* `TC-TX-01`: Transfer exceeding available balance is rejected with HTTP 400 and zero database mutations.
* `TC-TX-02`: Valid transfer with correct PIN debits sender, credits receiver, creates a transaction record, and writes balanced ledger entries.
* `TC-IDEM-01`: Duplicate request with the same `X-Idempotency-Key` returns original receipt without duplicate debiting.
* `TC-CHAT-01`: Realtime chat message displays on recipient device in < 300ms.
* `TC-CARD-01`: Invalid card numbers are rejected by Luhn algorithm validation.

---

## 14. Deployment & Operational Requirements

* **Node.js Runtime:** Containerized (Docker) deployment on cloud platforms (Render, Railway, Fly.io, or AWS ECS).
* **Database Reliability:** Supabase PostgreSQL with continuous Point-in-Time Recovery (PITR) ensuring Recovery Point Objective (RPO) < 5 minutes and Recovery Time Objective (RTO) < 30 minutes. Target uptime: 99.95%.
* **Observability:** Structured JSON logging (Pino or Winston) including distributed trace IDs (`X-Correlation-ID`) across all requests.

---

## 15. Open Questions & "Needs Decision" Items

Before building the backend, we must align on these 3 architectural decisions:

> [!IMPORTANT]
> **Decision 1: Notifications Table Schema**  
> The SRS requires an in-app Notification Center (`/notify`) grouped by "Transactions", "Promos", and "System Alerts", with "mark as read" capability, but omitted the `notifications` table in Section 6.2 DDL.  
> **Recommendation:** Add a `public.notifications` table with columns: `id`, `user_id`, `category`, `title`, `body`, `is_read`, `metadata`, and `created_at`.

> [!IMPORTANT]
> **Decision 2: Payment Requests Storage**  
> Should pending payment requests live directly in `transactions` (with `type = 'REQUEST'` and `status = 'PENDING'`), or should we create a dedicated `payment_requests` table?  
> **Recommendation:** A dedicated `payment_requests` table keeps the `transactions` table strictly for executed/settled financial ledger records.

> [!IMPORTANT]
> **Decision 3: Cash Flow Analytics Execution**  
> Should the monthly/weekly cash flow charts be calculated client-side in Flutter from the user's `transactions` records, or should Node.js provide a pre-aggregated analytics endpoint (`GET /api/v1/analytics/cash-flow`)?  
> **Recommendation:** Implement a lightweight PostgreSQL function / Node.js endpoint to return aggregated numbers, minimizing network overhead on mobile.

---

## 16. Implementation Roadmap & Milestones

```
+-------------------------------------------------------------------------------+
| MILESTONE 1: Supabase Database Schema & Setup                                 |
| - Enable uuid-ossp, pgcrypto extensions                                       |
| - Run DDL migrations: profiles, wallets, transactions, ledger_entries, etc.   |
| - Implement missing notifications table                                       |
| - Create user signup trigger (auto-provision profile & wallet)                |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| MILESTONE 2: PostgreSQL RPCs & Atomic Engines                                 |
| - Write transfer_funds_atomic stored procedure                                |
| - Implement row locking (FOR UPDATE) & balance validation                     |
| - Test atomic rollback on simulated failures                                  |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| MILESTONE 3: Row Level Security (RLS) Configuration                           |
| - Enable RLS on all public tables                                             |
| - Configure SELECT policies for profiles, wallets, transactions, messages     |
| - Restrict UPDATE/INSERT on wallets and transactions to service role          |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| MILESTONE 4: Node.js Express Core & PIN Engine                                |
| - Initialize Node.js TypeScript/Express project                               |
| - Integrate @supabase/supabase-js with service role credentials               |
| - Implement Argon2id PIN setup, verification, and 15-min lockout endpoints    |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| MILESTONE 5: Financial Orchestration (Transfers & Top-Ups)                   |
| - Implement POST /api/v1/transfers with idempotency validation                |
| - Build payment gateway integration & webhook listener (HMAC signature)       |
| - Implement payment request settlement endpoints                              |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| MILESTONE 6: Notifications, Realtime & Flutter Handoff                        |
| - Configure Firebase Admin SDK for FCM push notifications                     |
| - Verify Supabase Realtime channels for chat and balance updates              |
| - Run Acceptance Tests (TC-AUTH-01 through TC-CARD-01)                        |
| - Export Postman/OpenAPI documentation for Flutter GetX integration           |
+-------------------------------------------------------------------------------+
```
