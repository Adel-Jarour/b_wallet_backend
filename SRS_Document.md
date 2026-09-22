# SOFTWARE REQUIREMENTS SPECIFICATION (SRS)
## Project: B-Wallet (Next-Generation Digital E-Wallet & FinTech Ecosystem)
**Document Version:** 1.0.0  
**Date:** September 2026  
**Author:** Senior FinTech Solutions Architect & Software Consultant  
**Status:** Approved for Implementation  
**Standard:** IEEE Std 830-1998 / ISO/IEC/IEEE 29148 Compliant  

---

## Table of Contents
1. [Introduction](#1-introduction)
   - 1.1 Purpose
   - 1.2 Document Conventions
   - 1.3 Intended Audience
   - 1.4 Product Scope
   - 1.5 Glossary and Acronyms
2. [Overall Description](#2-overall-description)
   - 2.1 Product Perspective & Ecosystem Architecture
   - 2.2 Core Product Functions
   - 2.3 User Classes and Personas
   - 2.4 Operating Environment & Platform Targets
   - 2.5 Design, Regulatory, and Implementation Constraints
   - 2.6 Assumptions and Dependencies
3. [External Interface Requirements](#3-external-interface-requirements)
   - 3.1 User Interface (UI/UX) Requirements
   - 3.2 Hardware Interfaces
   - 3.3 Software & Cloud Services Interfaces
   - 3.4 Communications & Security Interfaces
4. [System Features & Functional Requirements](#4-system-features--functional-requirements)
   - 4.1 Module 1: Authentication, Authorization & Identity
   - 4.2 Module 2: Transaction Security & PIN Verification
   - 4.3 Module 3: Digital Wallet & Balance Operations
   - 4.4 Module 4: Fund Inflow (Top-Up & Card Linking)
   - 4.5 Module 5: Peer-to-Peer (P2P) Fund Transfers
   - 4.6 Module 6: Payment Requests & Invoicing
   - 4.7 Module 7: Cash Flow Analytics & Financial Intelligence
   - 4.8 Module 8: Transaction Ledger & Digital Receipts
   - 4.9 Module 9: Real-Time Social Messaging & Conversation Threading
   - 4.10 Module 10: Notification Engine & Alert Dispatcher
   - 4.11 Module 11: User Profile & Security Preferences
5. [Non-Functional Requirements (NFRs)](#5-non-functional-requirements-nfrs)
   - 5.1 Performance & Latency Benchmarks
   - 5.2 Financial Data Integrity & Atomic Transactions
   - 5.3 Cyber Security, Cryptography & RLS Policies
   - 5.4 Reliability, Availability & Disaster Recovery
   - 5.5 Maintainability, Modularity & Observability
   - 5.6 Compliance, AML & Regulatory Readiness
6. [Data Architecture & Database Schema (Supabase / PostgreSQL)](#6-data-architecture--database-schema)
   - 6.1 Entity-Relationship Overview
   - 6.2 Relational Data DDL & Schema Definitions
   - 6.3 Row Level Security (RLS) Matrix
7. [System Architecture & Backend Blueprint (Node.js + Supabase)](#7-system-architecture--backend-blueprint)
   - 7.1 Hybrid Client-Server Architecture
   - 7.2 Node.js Financial Microservice Responsibilities
   - 7.3 Real-Time WebSocket Infrastructure
8. [Verification, Acceptance Criteria & Traceability](#8-verification-acceptance-criteria--traceability)
   - 8.1 Acceptance Test Matrix
   - 8.2 Traceability Matrix

---

## 1. Introduction

### 1.1 Purpose
This Software Requirements Specification (SRS) establishes the complete, authoritative technical, functional, and non-functional requirements for the **B-Wallet** mobile application and its associated backend cloud ecosystem. It serves as the single source of truth for executive stakeholders, mobile software engineers, backend developers, QA automation specialists, security auditors, and system architects.

### 1.2 Document Conventions
- **Requirement Identifiers:** Tagged hierarchically (e.g., `FR-AUTH-001` for functional requirements, `NFR-SEC-001` for non-functional security requirements).
- **RFC 2119 Keywords:** **SHALL** / **MUST** indicates mandatory items; **SHOULD** / **RECOMMENDED** indicates desirable best practices; **MAY** indicates optional capabilities.
- **Financial Integrity Standard:** All arithmetic operations involving monetary currency MUST employ fixed-point decimal arithmetic (64-bit BigInt / PostgreSQL `NUMERIC(15,2)`), never raw IEEE floating-point math.

### 1.3 Intended Audience
- **Mobile Development Team (Flutter / Dart):** Implements views, controllers, state containers, local persistence, and client-side encryption.
- **Backend Engineering Team (Node.js & Supabase / PostgreSQL):** Deploys database migrations, Row Level Security (RLS) policies, RPC transaction routines, and payment gateway webhooks.
- **Quality Assurance (QA) & Test Engineers:** Derives automated test suites, end-to-end integration scenarios, and regression tests.
- **Compliance & Security Officers:** Verifies data privacy (GDPR), PCI-DSS tokenization boundaries, and Anti-Money Laundering (AML) auditability.

### 1.4 Product Scope
B-Wallet is a high-performance, mobile-first FinTech digital wallet designed to deliver instantaneous peer-to-peer (P2P) transfers, bill payments, top-ups, bank card tokenization, intelligent cash flow telemetry, and contextualized real-time messaging between transacting parties. The solution eliminates reliance on traditional physical currency, minimizing transaction latency while maximizing cryptographic safety.

### 1.5 Glossary and Acronyms
- **ACID:** Atomicity, Consistency, Isolation, Durability.
- **AML:** Anti-Money Laundering.
- **BaaS:** Backend-as-a-Service (Supabase).
- **CVC / CVV:** Card Verification Code / Value.
- **FCM:** Firebase Cloud Messaging.
- **GetX:** Flutter state management, dependency injection, and micro-routing framework.
- **Idempotency Key:** Unique UUID sent with financial requests to prevent duplicate charging on network retries.
- **JWT:** JSON Web Token.
- **MFA / 2FA:** Multi-Factor Authentication.
- **OTP:** One-Time Password.
- **P2P:** Peer-to-Peer.
- **PCI-DSS:** Payment Card Industry Data Security Standard.
- **RLS:** Row Level Security (PostgreSQL engine).
- **RPC:** Remote Procedure Call (PostgreSQL stored procedures).

---

## 2. Overall Description

### 2.1 Product Perspective & Ecosystem Architecture
B-Wallet is an integrated ecosystem consisting of:
1. **Frontend Mobile Client (Flutter):** Target OS: Android (API 26+) and iOS (14.0+), structured via GetX architecture with custom reactive components and responsive design via `flutter_screenutil`.
2. **Database & Realtime Core (Supabase / PostgreSQL):** Stores transactional ledgers, user accounts, and conversation tables. Enforces Row Level Security (RLS) and broadcasts real-time updates via PostgreSQL CDC (Change Data Capture) WebSockets.
3. **Financial Orchestration API (Node.js / Express or NestJS):** Handles atomic fund transfers, webhook signature validation, third-party payment gateways (Stripe, local switch), and transaction PIN verification.

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
|  - Realtime WebSocket Engine      |   |  - PIN Argon2 Verification      |
|  - S3-Compatible Storage (Avatars)|   |  - Webhook Consumer (HMAC-SHA)  |
+-----------------------------------+   +---------------------------------+
```

### 2.2 Core Product Functions
- **Identity & Access Management:** Passwordless or credentialed access with OTP SMS/Email fallback and 6-digit cryptographic PIN authentication.
- **Balance & Multi-Funding Wallet:** Real-time balance ledger with toggleable privacy mode ("show/hide balance").
- **Direct P2P Settlement:** Transfer funds instantly to known contacts or phone numbers with transaction tagging and attached messaging.
- **Interactive Money Requests:** Generate and send money request tickets to contacts with automatic debt settlement tracking.
- **Cash Flow Intelligence:** Dynamic income vs. expense analytics, periodic category breakdown (Food, Entertainment, Utilities), and interactive charts via Syncfusion.
- **Integrated Transaction Chat:** Real-time conversational threads linked directly to monetary actions (send/request/settle).
- **Payment Card Vault:** Secure tokenized storage of Visa/MasterCard debit/credit cards conforming to PCI-DSS zero-raw-card-storage principles.

### 2.3 User Classes and Personas
- **Consumer User (Standard):** Everyday mobile user performing balance top-ups, paying utility bills, sending money to acquaintances, and chatting.
- **Recipient / Payee:** Contact receiving inbound transfers or handling requested invoice tickets.
- **System Administrator (Back Office):** Operates through a secured admin dashboard to monitor system liquidity, resolve dispute tickets, and enforce AML blacklists.
- **Automated Payment Gateway:** External webhook caller that notifies the system of card authorization and settlement events.

### 2.4 Operating Environment & Platform Targets
- **Android Support:** Android 8.0 (API Level 26) through Android 15+. Optimized with Skia/Impeller hardware acceleration fallback (`io.flutter.embedding.android.EnableImpeller = false` on vulnerable hardware).
- **iOS Support:** iOS 14.0 through iOS 18+.
- **Screen Resolution:** Scaled dynamically to 375x812 baseline via `flutter_screenutil`. Supports portrait orientation with fluid multi-density responsiveness.
- **Network Environment:** Fully functional over unstable mobile data (3G, 4G, 5G, Wi-Fi). Implements auto-reconnect on WebSocket drops and idempotent retry mechanisms.

### 2.5 Design, Regulatory, and Implementation Constraints
- **Zero Raw Card Storage:** Credit card numbers and CVC codes MUST NEVER be stored in plain text or in the application database. Only PCI-compliant gateway tokens, last 4 digits, and expiration dates may be persisted.
- **Double-Entry Bookkeeping:** Every monetary transaction must involve an equal and offsetting debit and credit entry across system ledger accounts.
- **State Integrity:** All screen navigation, reactive state, and bindings MUST adhere to GetX dependency injection rules to prevent circular instantiation and memory leaks.
- **Android 13+ Predictive Back:** Manifest MUST explicitly configure `android:enableOnBackInvokedCallback="true"`.

### 2.6 Assumptions and Dependencies
- Users possess an active cellular connection capable of receiving SMS OTP verification codes.
- Third-party payment gateway provides test and production sandbox APIs with 99.9% availability.
- PostgreSQL database operates with timezones standardized to UTC (`TIMESTAMPTZ`).

---

## 3. External Interface Requirements

### 3.1 User Interface (UI/UX) Requirements
- **Design Language:** Clean, modern FinTech aesthetics utilizing high-contrast typography, tailored neutral backgrounds (`#FFFFFF`, `#F9F9F9`), Deep Primary Blue (`#1E3A8A`), Vibrant Orange Accent (`#FF6B00`), and Soft Success Green (`#10B981`).
- **Typography:** Scaled via SP units matching platform text accessibility scaling.
- **Responsive Layout:** Hardcoded pixel coordinates are strictly prohibited. All dimensions must utilize `ScreenUtil` responsive extension methods (`.w`, `.h`, `.sp`, `.r`).
- **Feedback & Micro-interactions:** Every destructive action (e.g., Delete Card) MUST require a modal confirmation dialogue. Every successful transaction must trigger a dedicated confirmation screen with printable/shareable receipt cards.

### 3.2 Hardware Interfaces
- **Biometric Sensors:** Interface with Android BiometricPrompt and iOS LocalAuthentication (TouchID / FaceID) to unlock wallet and authenticate transactions below configured thresholds.
- **Haptic Engine:** Gentle haptic feedback on numeric keypad touches and transaction success triggers.

### 3.3 Software & Cloud Services Interfaces
- **Supabase Authentication:** Handles RFC 7519 compliant JSON Web Tokens (access token lifespan: 1 hour, refresh token: 30 days).
- **Supabase PostgreSQL 15+:** Interfaced via `supabase_flutter` for direct reads with RLS, and `@supabase/supabase-js` from Node.js with elevated service credentials.
- **Payment Processing Switch (e.g., Stripe / Checkout.com / Local Switch):** Exposes tokenized payment intents for card top-ups.
- **Push Notification Service (FCM & APNs):** Transmits high-priority data payloads when incoming transfers or payment requests occur.

### 3.4 Communications & Security Interfaces
- **Transport Security:** All communications between client, Node.js API, and Supabase MUST be encrypted via TLS 1.3. Plaintext HTTP is rejected.
- **WebSockets (WSS):** Realtime chat and live balance update streams connect over TLS-secured WebSocket channels.
- **Idempotency Headers:** Sensitive POST requests MUST include an `X-Idempotency-Key` header with a client-generated UUIDv4.

---

## 4. System Features & Functional Requirements

### 4.1 Module 1: Authentication, Authorization & Identity
#### Description
Provides secure onboarding, credential verification, session maintenance, and credential recovery.

#### Functional Requirements
- `FR-AUTH-001`: The system **SHALL** allow users to register an account using Email/Phone Number, Full Name, and a strong password (minimum 8 characters, at least 1 uppercase letter, 1 digit, and 1 special character).
- `FR-AUTH-002`: The system **SHALL** provide a password recovery mechanism allowing users to choose between SMS OTP or Email Magic Link / Code verification.
- `FR-AUTH-003`: When an OTP is requested, the system **SHALL** initiate a 60-second cooldown timer before permitting re-transmission.
- `FR-AUTH-004`: The system **SHALL** validate OTP codes within a 5-minute validity window. Three consecutive incorrect entries **SHALL** invalidate the current OTP.
- `FR-AUTH-005`: Upon successful authentication, the system **SHALL** securely persist JWT credentials into encrypted device storage (`FlutterSecureStorage` / Keystore / Keychain).
- `FR-AUTH-006`: The system **SHALL** support session termination (Logout) which revokes the active refresh token and purges local in-memory caches.

---

### 4.2 Module 2: Transaction Security & PIN Verification
#### Description
Ensures that all monetary operations are protected by a dedicated 6-digit numeric Security PIN distinct from the login password.

#### Functional Requirements
- `FR-PIN-001`: During initial onboarding, the user **SHALL** be prompted to create a 6-digit numeric Transaction PIN with a mandatory confirmation step.
- `FR-PIN-002`: The Transaction PIN **SHALL NEVER** be transmitted to the database in plain text. It **MUST** be hashed using Argon2id or bcrypt with a per-user cryptographic salt.
- `FR-PIN-003`: The system **SHALL** intercept all fund transfers (`/send`), balance withdrawals, and payment requests, requiring entry of the 6-digit PIN before execution.
- `FR-PIN-004`: If the user enters an incorrect PIN 3 times consecutively, the wallet transaction capability **SHALL** be locked for a mandatory duration of 15 minutes.

---

### 4.3 Module 3: Digital Wallet & Balance Operations
#### Description
Manages user balances, multi-currency ledger accounts, and balance privacy controls.

#### Functional Requirements
- `FR-WAL-001`: The home screen **SHALL** display the user's available balance formatted to two decimal places, prefixed by the primary currency symbol (e.g., `$ 5,000.00`).
- `FR-WAL-002`: The system **SHALL** provide a "Hide / Show Balance" toggle on the main dashboard. When hidden, the monetary digits **SHALL** be obfuscated with masking dots (e.g., `•••••`).
- `FR-WAL-003`: The state of the balance visibility toggle **SHALL** persist across application sessions in local preferences.
- `FR-WAL-004`: Balance changes caused by completed transactions **SHALL** update the UI instantaneously via reactive GetX state bindings without requiring manual pull-to-refresh.

---

### 4.4 Module 4: Fund Inflow (Top-Up & Card Linking)
#### Description
Enables users to add funds to their wallet via linked credit/debit cards or external payment methods.

#### Functional Requirements
- `FR-TOP-001`: The system **SHALL** provide a dedicated Top-Up interface with predefined quick-select amount chips (`$100`, `$500`, `$1000`, `$1500`, `$2500`) and a custom numeric input field.
- `FR-TOP-002`: The user **SHALL** be able to link a credit or debit card by supplying Cardholder Name, 16-digit Card Number, Expiration Month (MM), Expiration Year (YY), and 3-digit CVC.
- `FR-TOP-003`: The system **SHALL** validate card formats client-side using the Luhn algorithm prior to submission.
- `FR-TOP-004`: The client **SHALL** tokenize card data via the payment processor SDK. The B-Wallet database **SHALL ONLY** store the non-sensitive card token, brand (Visa/MasterCard), expiration date, and the last 4 digits.
- `FR-TOP-005`: Upon successful top-up authorization, the wallet balance **SHALL** be credited atomically, and a dedicated `top_up_success` confirmation screen **SHALL** be displayed.

---

### 4.5 Module 5: Peer-to-Peer (P2P) Fund Transfers
#### Description
Allows instant transfer of funds from the user's wallet to another registered user.

#### Functional Requirements
- `FR-TX-001`: The user **SHALL** be able to search for recipients by Name, Registered Phone Number, or Email via a debounced search input.
- `FR-TX-002`: The transfer form **SHALL** require Amount, Category selection (Food, Expense, Property, Hobby, Entertainment), and an optional text note (up to 120 characters).
- `FR-TX-003`: The system **SHALL** reject any transfer where `Transfer Amount + Transfer Fee > Sender Available Balance` with an explicit "Insufficient Funds" alert.
- `FR-TX-004`: Transfers **MUST** be processed as an atomic database transaction (Debit Sender, Credit Recipient, Insert Ledger Record). If any sub-operation fails, the entire transaction **MUST** roll back completely.
- `FR-TX-005`: Upon completion, the system **SHALL** navigate to the `send_success` screen, showing an itemized receipt with the option to share the receipt or trigger a "Send Again" workflow.

---

### 4.6 Module 6: Payment Requests & Invoicing
#### Description
Allows users to create payment requests from other users with status tracking.

#### Functional Requirements
- `FR-REQ-001`: The user **SHALL** be able to initiate a payment request by selecting a contact, entering the requested amount, selecting an expense category, and adding a memo.
- `FR-REQ-002`: When a request is created, the target recipient **SHALL** receive an in-app notification and an interactive conversation card.
- `FR-REQ-003`: The target recipient **SHALL** be presented with options to "Pay Now" or "Decline".
- `FR-REQ-004`: Clicking "Pay Now" **SHALL** pre-fill the transfer form, require Security PIN entry, and upon settlement, automatically mark the request ticket as `COMPLETED`.

---

### 4.7 Module 7: Cash Flow Analytics & Financial Intelligence
#### Description
Provides visual feedback on spending habits, monthly inflows, and expense distributions.

#### Functional Requirements
- `FR-ANA-001`: The Cash Flow screen **SHALL** render an interactive visual chart (using `syncfusion_flutter_charts`) depicting comparative Income vs. Expense trends over Weekly, Monthly, and Yearly intervals.
- `FR-ANA-002`: The system **SHALL** display aggregated metrics for:
  - Total Monthly Income
  - Total Monthly Expense
  - Net Savings Ratio
- `FR-ANA-003`: Transactions **SHALL** be grouped and rendered by category with percentage breakdowns and designated visual icons.

---

### 4.8 Module 8: Transaction Ledger & Digital Receipts
#### Description
Maintains the complete, immutable historical audit log of all account operations.

#### Functional Requirements
- `FR-LED-001`: The system **SHALL** maintain a chronological list of all transactions with infinite scroll / pagination (default 20 records per page).
- `FR-LED-002`: Users **SHALL** be able to filter the ledger by Transaction Type (`All`, `Income`, `Expense`) and Date Range.
- `FR-LED-003`: Tapping any record **SHALL** open the `TransactionDetailScreen`, rendering:
  - Unique Transaction ID
  - Date and precise timestamp
  - Counterparty Name & Phone Number
  - Monetary Amount with sign and color coding (Green for Inflow, Black/Red for Outflow)
  - Category Badge & Note
  - Status Indicator (`Completed`, `Pending`, `Failed`)
- `FR-LED-004`: The detail screen **SHALL** provide a native Share button that generates a formatted digital receipt for export or social sharing.

---

### 4.9 Module 9: Real-Time Social Messaging & Conversation Threading
#### Description
Combines financial interactions with real-time peer messaging.

#### Functional Requirements
- `FR-MSG-001`: The Message screen **SHALL** list all active conversation threads sorted by latest activity timestamp, displaying recipient avatar, name, verification badge, last message preview, unread indicator, and timestamp.
- `FR-MSG-002`: Inside a conversation thread, the system **SHALL** render messages in chronological order, distinguishing between outbound (right-aligned) and inbound (left-aligned) bubbles.
- `FR-MSG-003`: Financial transactions associated with a conversation (Send / Request confirmations) **SHALL** be rendered as rich interactive embedded cards within the chat stream.
- `FR-MSG-004`: The client **SHALL** establish a WebSocket connection via Supabase Realtime to broadcast new messages and receive incoming messages with sub-second latency.
- `FR-MSG-005`: The message input area **SHALL** support multi-line text input, keyboard dismiss gestures, and send triggers.

---

### 4.10 Module 10: Notification Engine & Alert Dispatcher
#### Description
Keeps users informed of critical account movements, security alerts, and promotional announcements.

#### Functional Requirements
- `FR-NOT-001`: The system **SHALL** dispatch push notifications via FCM / APNs when:
  - An inbound transfer is credited to the user's wallet.
  - A payment request is directed to the user.
  - A login from an unrecognized device occurs.
- `FR-NOT-002`: The app **SHALL** provide an in-app Notification Center (`/notify`) grouping alerts into "Transactions", "Promos", and "System Alerts".
- `FR-NOT-003`: Users **SHALL** have the ability to mark notifications as read or dismiss them individually.

---

### 4.11 Module 11: User Profile & Security Preferences
#### Description
Allows users to manage personal identity attributes, saved cards, and legal terms.

#### Functional Requirements
- `FR-PRF-001`: The Profile screen **SHALL** display user avatar, full name, phone number, and verified status badge.
- `FR-PRF-002`: Users **SHALL** be able to edit profile details (First Name, Last Name, Email, Birthday, Profile Picture) via `ProfileSettingScreen`.
- `FR-PRF-003`: The Saved Cards screen (`/saved_card`) **SHALL** list all tokenized cards, allow designation of a default payment method, and support card deletion with confirmation.
- `FR-PRF-004`: The application **SHALL** provide accessible static screens for Terms & Conditions (`/terms_and_condition`), Privacy Policy (`/privacy_policy`), and Customer Support (`/contact`).

---

## 5. Non-Functional Requirements (NFRs)

### 5.1 Performance & Latency Benchmarks
- `NFR-PERF-001 (Cold Start):` The application cold start time until the interactive dashboard is loaded **SHALL NOT** exceed 2.0 seconds on standard devices.
- `NFR-PERF-002 (API Latency):` 95% of standard read API calls **SHALL** respond within 250 milliseconds under normal network conditions.
- `NFR-PERF-003 (Transaction Execution):` P2P atomic fund transfer execution **SHALL** complete within 800 milliseconds from the moment of PIN validation.
- `NFR-PERF-004 (Frame Rate):` The Flutter rendering engine **SHALL** maintain a minimum of 60 frames per second (FPS) during list scrolling, screen transitions, and animations.
- `NFR-PERF-005 (Realtime Message Latency):` Chat messages delivered via Supabase WebSockets **SHALL** appear on the recipient device within 300 milliseconds.

### 5.2 Financial Data Integrity & Atomic Transactions
- `NFR-INT-001 (ACID Compliance):` All balance updates **MUST** satisfy complete ACID guarantees. Split-brain or partial updates are strictly prohibited.
- `NFR-INT-002 (Idempotency):` All monetary transaction requests **MUST** accept an `Idempotency-Key` header. Submitting the same key multiple times **SHALL** return the original result without executing duplicate debits.
- `NFR-INT-003 (Double-Entry Bookkeeping):` Every credit to a wallet account **MUST** be balanced by a corresponding debit from an external settlement or counterpart account.
- `NFR-INT-004 (Immutable Audit Trail):` Financial transaction records **SHALL NEVER** be updated or deleted (`UPDATE` or `DELETE` commands are forbidden on the `transactions` table). Corrections must be modeled as adjusting credit/debit entries.

### 5.3 Cyber Security, Cryptography & RLS Policies
- `NFR-SEC-001 (Data in Transit):` All client-server communications **MUST** utilize TLS 1.3 with Strict-Transport-Security (HSTS).
- `NFR-SEC-002 (Data at Rest):` All local persistent stores containing session tokens or PII **MUST** be encrypted using AES-256 via the platform Keystore / Keychain. Database storage volumes **MUST** be encrypted at rest.
- `NFR-SEC-003 (Row Level Security):` Direct Supabase client queries **MUST** be governed by PostgreSQL RLS policies ensuring that `auth.uid() = user_id`. No user can query or modify another user's wallet or ledger rows.
- `NFR-SEC-004 (Secret Isolation):` The Node.js `SUPABASE_SERVICE_ROLE_KEY` **MUST NEVER** be bundled or accessible within the Flutter mobile client binary.
- `NFR-SEC-005 (Penetration Defense):` The mobile app **SHALL** incorporate root/jailbreak detection and block transaction execution on compromised environments.

### 5.4 Reliability, Availability & Disaster Recovery
- `NFR-REL-001 (System Availability):` The backend API and Supabase database cluster **SHALL** maintain a minimum monthly uptime of 99.95% (excluding scheduled maintenance).
- `NFR-REL-002 (Recovery Point Objective - RPO):` Continuous Point-in-Time Recovery (PITR) for the PostgreSQL database **SHALL** guarantee an RPO of less than 5 minutes.
- `NFR-REL-003 (Recovery Time Objective - RTO):` In the event of a regional cloud outage, failover to secondary replicas **SHALL** achieve an RTO of less than 30 minutes.

### 5.5 Maintainability, Modularity & Observability
- `NFR-MAINT-001 (Modular Architecture):` Codebase **SHALL** maintain strict separation of concerns following GetX pattern: Model (Entities), View (Declarative Widgets), Controller (Business Logic), and Binding (Dependency Injection).
- `NFR-MAINT-002 (Telemetry & Logging):` All Node.js backend services **SHALL** emit structured JSON logs (Winston / Pino) accompanied by distributed trace IDs (`X-Correlation-ID`).

### 5.6 Compliance, AML & Regulatory Readiness
- `NFR-COMP-001 (PCI-DSS Scope):` The mobile app and Node.js backend **SHALL** remain PCI-DSS Level 4 compliant by delegating all primary account number (PAN) capture to certified gateway iframe/SDK components.
- `NFR-COMP-002 (AML Velocity Limits):` The backend **SHALL** enforce velocity rules (e.g., maximum daily transfer limit of $10,000 per unverified tier; maximum single transfer limit of $2,500).
- `NFR-COMP-003 (Data Retention):` All ledger and identity audit logs **MUST** be preserved for a statutory minimum of 7 years in cold storage.

---

## 6. Data Architecture & Database Schema

### 6.1 Entity-Relationship Overview
The database architecture is centered around the Supabase `auth.users` entity and enforces strict referential integrity.

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
                 |
                 +-------------------+ 1:N
                 |                   |--------------------+
                 v                   v                    v
       +---------+----+      +-------+------+     +-------+------+
       | saved_cards  |      | conversation |     | transactions |
       +--------------+      +-------+------+     +--------------+
                                     | 1:N
                                     v
                             +-------+------+
                             |   messages   |
                             +--------------+
```

### 6.2 Relational Data DDL & Schema Definitions (PostgreSQL)

```sql
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles Table (Extends Supabase auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    birthday DATE,
    avatar_url TEXT,
    pin_hash TEXT NOT NULL,
    pin_failed_attempts INT DEFAULT 0,
    pin_locked_until TIMESTAMPTZ,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Wallets Table
CREATE TABLE public.wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    currency VARCHAR(3) DEFAULT 'USD',
    balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0.00),
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_currency UNIQUE (user_id, currency)
);

-- 3. Transactions Table (Immutable Ledger Headers)
CREATE TYPE transaction_type AS ENUM ('TOP_UP', 'TRANSFER', 'REQUEST', 'BILL_PAYMENT');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_reference VARCHAR(32) UNIQUE NOT NULL,
    sender_id UUID REFERENCES public.profiles(id),
    receiver_id UUID REFERENCES public.profiles(id),
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    fee NUMERIC(15, 2) DEFAULT 0.00 CHECK (fee >= 0),
    currency VARCHAR(3) DEFAULT 'USD',
    type transaction_type NOT NULL,
    status transaction_status DEFAULT 'PENDING',
    category VARCHAR(50) NOT NULL,
    note VARCHAR(150),
    idempotency_key UUID UNIQUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);

-- 4. Double-Entry Ledger Entries Table
CREATE TYPE entry_direction AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE public.ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
    direction entry_direction NOT NULL,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Saved Payment Cards Table (Tokenized)
CREATE TABLE public.saved_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    gateway_customer_id VARCHAR(100) NOT NULL,
    gateway_payment_method_id VARCHAR(100) NOT NULL,
    brand VARCHAR(30) NOT NULL, -- Visa, MasterCard, etc.
    last4 VARCHAR(4) NOT NULL,
    expiry_month INT NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
    expiry_year INT NOT NULL CHECK (expiry_year >= 2026),
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Conversations Table
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_one UUID NOT NULL REFERENCES public.profiles(id),
    participant_two UUID NOT NULL REFERENCES public.profiles(id),
    last_message_text TEXT,
    last_message_time TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_participants UNIQUE (participant_one, participant_two)
);

-- 7. Messages Table
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    transaction_id UUID REFERENCES public.transactions(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.3 Row Level Security (RLS) Matrix

| Table | Operations Permitted | Target Policy Definition |
| :--- | :--- | :--- |
| `profiles` | `SELECT`, `UPDATE` | `auth.uid() = id` |
| `wallets` | `SELECT` | `auth.uid() = user_id` (Direct client `UPDATE` prohibited; mutated only via RPC/Node.js) |
| `transactions` | `SELECT` | `auth.uid() IN (sender_id, receiver_id)` (Direct client `INSERT`/`UPDATE` prohibited) |
| `saved_cards` | `SELECT`, `DELETE` | `auth.uid() = user_id` |
| `conversations`| `SELECT` | `auth.uid() IN (participant_one, participant_two)` |
| `messages` | `SELECT`, `INSERT` | `auth.uid() = sender_id AND EXISTS (SELECT 1 FROM conversations WHERE id = conversation_id AND auth.uid() IN (participant_one, participant_two))` |

---

## 7. System Architecture & Backend Blueprint

### 7.1 Hybrid Client-Server Architecture
The B-Wallet architecture partitions responsibilities between Supabase (BaaS) and Node.js (Microservice) to ensure optimal client latency while protecting financial transaction boundaries.

```
       +--------------------------------------------------------------+
       |                        FLUTTER CLIENT                        |
       |  GetX Controllers / Screens / Secure Storage / ScreenUtil    |
       +---------------+------------------------------+---------------+
                       |                              |
      Read Queries,    |                              | Sensitive Transactions
      Auth Tokens,     |                              | (P2P Transfer, Top-Up,
      Realtime Streams |                              |  PIN Verification)
                       v                              v
       +---------------+--------------+      +--------+---------------+
       |        SUPABASE BaaS         |      |    NODE.JS API GATEWAY |
       |                              |      |  (Express / Fastify)   |
       |  - Auth JWT Validation       |      +--------+---------------+
       |  - Postgres RLS Protected    |               |
       |  - WebSocket CDC Pub/Sub     |<--------------+ (Admin / Service Key)
       |  - Storage Buckets (Avatars) |  Postgres RPC / Atomic Engine
       +------------------------------+
```

### 7.2 Node.js Financial Microservice Responsibilities
The Node.js backend handles operations that require elevated administrative privileges (`SUPABASE_SERVICE_ROLE_KEY`):

1. **Atomic Fund Transfer Orchestration (`POST /api/v1/transfers`):**
   - Receives: `sender_token`, `receiver_phone`, `amount`, `category`, `pin`, `idempotency_key`.
   - Validates client JWT token and extracts verified `sender_id`.
   - Verifies Argon2 hash of transaction PIN against `profiles.pin_hash`.
   - Executes atomic stored procedure `transfer_funds_atomic(...)` inside PostgreSQL.
   - Emits background FCM push notification to recipient.
   - Responds to client with finalized transaction receipt payload.

2. **Top-Up Payment Gateway Webhook Listener (`POST /api/v1/webhooks/payments`):**
   - Validates HMAC-SHA256 signature of inbound webhook payload from payment provider.
   - Confirms settlement of card authorization.
   - Credits user's `wallets` balance and inserts matching `ledger_entries` record.

### 7.3 Real-Time WebSocket Infrastructure
- Handled through Supabase Realtime protocol.
- Client subscribes to channel: `realtime:public:messages:conversation_id=eq.{id}`.
- New message inserts automatically broadcast to connected peer clients within < 200ms.

---

## 8. Verification, Acceptance Criteria & Traceability

### 8.1 Acceptance Test Matrix

| ID | Test Scenario | Expected Outcome | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- |
| **TC-AUTH-01** | User registers with valid data | Account created, JWT returned, user redirected to PIN setup | HTTP 201, DB record created in `profiles` |
| **TC-PIN-01** | User enters invalid PIN 3 times | Wallet locked for 15 minutes, descriptive error banner displayed | Locked flag set, transactions rejected |
| **TC-TX-01** | Transfer amount exceeds balance | Transaction rejected with "Insufficient balance", zero DB mutations | HTTP 400, Ledger balance unchanged |
| **TC-TX-02** | Valid transfer with correct PIN | Sender debited, Receiver credited, Transaction status `COMPLETED` | Balance Delta = Amount, Ledger balanced |
| **TC-IDEM-01** | Duplicate request with same Idempotency Key | Original transaction returned, no second debit occurs | Single debit recorded, exact receipt returned |
| **TC-CHAT-01** | Peer sends message in active thread | Message bubble appears on recipient screen without refresh | Latency < 300ms, read receipt updated |
| **TC-CARD-01** | User inputs invalid Luhn card number | Client highlights field in red with validation message | Submission blocked prior to API call |

### 8.2 Traceability Matrix

| Requirement ID | Screen / View (Flutter) | Controller / Binding | Database Entity / API Endpoint |
| :--- | :--- | :--- | :--- |
| `FR-AUTH-001` | `LoginScreen` / `SignUpScreen` | `AuthController` | Supabase Auth / `profiles` table |
| `FR-PIN-001` | `PinScreen` / `SecurityPinScreen` | `PinController` | `profiles.pin_hash` |
| `FR-WAL-001` | `HomeScreen` | `HomeController` | `wallets` table (`balance`) |
| `FR-TOP-001` | `TopUpScreen` | `TopUpController` | `POST /api/v1/top-up` |
| `FR-TX-001` | `SendScreen` | `SendController` | `POST /api/v1/transfers` |
| `FR-REQ-001` | `RequestScreen` | `RequestController` | `POST /api/v1/requests` |
| `FR-ANA-001` | `CashFlowScreen` | `CashFlowController` | `transactions` table aggregation |
| `FR-LED-003` | `TransactionDetailScreen` | `TransactionDetailController`| `transactions` record lookup |
| `FR-MSG-001` | `MessageScreen` / `ConversationScreen` | `MessageController` | `conversations` & `messages` |
| `FR-PRF-003` | `SavedCardScreen` | `CardController` | `saved_cards` table |

---

## 9. Approval & Document Sign-Off

| Stakeholder Role | Name / Title | Signature | Date |
| :--- | :--- | :--- | :--- |
| **Lead Software Consultant** | FinTech Solutions Architect | *Approved* | 2026-09-09 |
| **Client Technical Lead** | Engineering Director | *Pending Sign-off* | ___________ |
| **Chief Information Security Officer** | Head of Cyber Risk | *Pending Sign-off* | ___________ |

*(End of Software Requirements Specification)*
