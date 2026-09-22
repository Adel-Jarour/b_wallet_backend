# B-Wallet FinTech Backend — Complete API Reference Manual
**Version**: 1.0.0 (Sprint 10 Final Backend Release)  
**Base URL**: `http://localhost:3000` (Local Development) | `https://api.bwallet.dev` (Production)  
**Specification**: OpenAPI 3.0.3 compliant (`/api-docs.json`, `/api-docs`)

---

## 1. Architectural & Security Overview

### Standard Response Envelopes
All API endpoints (except binary streams and raw docs) return consistent JSON response envelopes:

#### Success Envelope (HTTP 200 / 201)
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional human-readable description"
}
```

#### Error Envelope (HTTP 4xx / 5xx)
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CONSTANT_CODE",
    "message": "Human-readable diagnostic message",
    "details": {}
  }
}
```

### Security Headers & Authentication Schemes

| Header | Required For | Description | Format / Example |
| :--- | :--- | :--- | :--- |
| `Authorization` | Protected routes | Supabase Auth JWT Access Token | `Bearer eyJhbGciOi...` |
| `X-Idempotency-Key` | State-mutating routes (`/transfers`, `/requests/:id/pay`, `/top-up/intent`) | UUIDv4 idempotency key | `550e8400-e29b-41d4-a716-446655440000` |
| `X-Webhook-Signature` | Payment Gateway Webhooks | HMAC-SHA256 timestamp signature | `t=1726800000,v1=6a2b...` |
| `Content-Type` | JSON payload routes | MIME type | `application/json` |

---

## 2. API Documentation & System Health

### 2.1 System Health Check
`GET /health`  
Returns system status, service timestamp, and uptime health indicators.
- **Auth**: None
- **Response**: `200 OK`
```json
{
  "status": "ok",
  "service": "b-wallet-backend",
  "timestamp": "2026-09-21T13:30:00.000Z"
}
```

### 2.2 OpenAPI 3.0 Specification
`GET /api-docs.json`  
Returns the full machine-readable OpenAPI 3.0 specification in JSON format.
- **Auth**: None
- **Response**: `200 OK` (JSON)

### 2.3 Interactive API Documentation UI
`GET /api-docs`  
Interactive documentation viewer powered by Redoc standalone engine.
- **Auth**: None
- **Response**: `200 OK` (HTML)

---

## 3. Authentication & Session Subsystem (`/api/v1/auth`)

### 3.1 User Registration
`POST /api/v1/auth/register`  
Registers a new user, provisions Supabase Auth credentials, creates a profile record, and auto-provisions a default USD wallet.

- **Request Body**:
```json
{
  "email": "user@bwallet.dev",
  "password": "SecurePassword123!",
  "firstName": "Alex",
  "lastName": "Morgan",
  "phoneNumber": "+15551234567"
}
```
- **Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "c3b88b48-d3f2-4e89-9a26-302a92631551",
      "email": "user@bwallet.dev"
    },
    "profile": {
      "id": "c3b88b48-d3f2-4e89-9a26-302a92631551",
      "first_name": "Alex",
      "last_name": "Morgan",
      "phone_number": "+15551234567"
    }
  }
}
```

### 3.2 User Login
`POST /api/v1/auth/login`  
Authenticates email and password, returning short-lived JWT access token and refresh token.

- **Request Body**:
```json
{
  "email": "user@bwallet.dev",
  "password": "SecurePassword123!"
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "v1.abc...",
    "expiresIn": 3600,
    "user": {
      "id": "c3b88b48-d3f2-4e89-9a26-302a92631551",
      "email": "user@bwallet.dev"
    }
  }
}
```

### 3.3 Refresh Session Token
`POST /api/v1/auth/refresh`  
Exchanges a valid refresh token for a new access token.

- **Request Body**:
```json
{
  "refreshToken": "v1.abc..."
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "v1.def...",
    "expiresIn": 3600
  }
}
```

### 3.4 Logout
`POST /api/v1/auth/logout`  
Terminates the active session and invalidates the session token.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

---

## 4. Transaction PIN Security Engine (`/api/v1/auth/pin`)

High-security PIN management using **Argon2id** cryptographic hashing with automatic 15-minute account lockout upon 3 consecutive failed attempts.

### 4.1 Check PIN Status
`GET /api/v1/auth/pin/status`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "hasPin": true,
    "isLocked": false,
    "remainingAttempts": 3,
    "lockoutExpiresAt": null
  }
}
```

### 4.2 Set Up Transaction PIN
`POST /api/v1/auth/pin/setup`  
Configures a strict 6-digit PIN. One-time setup; once established, PIN cannot be overridden via this endpoint.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Request Body**:
```json
{
  "pin": "123456",
  "confirmPin": "123456"
}
```
- **Response**: `201 Created`

### 4.3 Verify Transaction PIN
`POST /api/v1/auth/pin/verify`  
Verifies a 6-digit PIN against the Argon2id hash. Upon success, issues a cryptographically signed, single-use `transactionTicket` valid for 300 seconds (5 minutes).
- **Headers**: `Authorization: Bearer <accessToken>`
- **Request Body**:
```json
{
  "pin": "123456"
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "authorized": true,
    "ticket": "eyJuYW1lIjoidGlja2V0Ii...",
    "expiresInSeconds": 300
  }
}
```
- **Failed Verification Response (HTTP 400)**:
```json
{
  "success": false,
  "error": {
    "code": "INCORRECT_PIN",
    "message": "Incorrect PIN. 2 attempts remaining.",
    "details": { "remainingAttempts": 2 }
  }
}
```
- **Lockout Response (HTTP 423 Locked)**:
```json
{
  "success": false,
  "error": {
    "code": "PIN_LOCKED",
    "message": "Too many failed attempts. Transaction capability locked for 15 minutes.",
    "details": { "lockedUntil": "2026-09-21T13:45:00.000Z" }
  }
}
```

---

## 5. User Profile Subsystem (`/api/v1/profile`)

### 5.1 Get Profile
`GET /api/v1/profile/me`  
Retrieves user profile information. Anti-data-leakage control guarantees `pin_hash` is stripped.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "c3b88b48-d3f2-4e89-9a26-302a92631551",
      "first_name": "Alex",
      "last_name": "Morgan",
      "phone_number": "+15551234567",
      "avatar_url": "https://cdn.bwallet.dev/avatars/user.png"
    }
  }
}
```

### 5.2 Update Profile
`PATCH /api/v1/profile/me`  
Updates personal profile details.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Request Body**:
```json
{
  "firstName": "Alex",
  "lastName": "Morgan",
  "avatarUrl": "https://cdn.bwallet.dev/avatars/alex_new.png"
}
```
- **Response**: `200 OK`

---

## 6. Wallet & Ledger Subsystem (`/api/v1/wallets`)

### 6.1 Get Wallet Summary
`GET /api/v1/wallets`  
Returns the current wallet balance, currency, account status, and spending limit metrics.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "wallet": {
      "id": "4a7e9112-9bf0-4b2a-89a1-05d3b6f281e7",
      "currency": "USD",
      "balance": "175.00",
      "status": "ACTIVE"
    },
    "limits": {
      "dailyLimit": "5000.00",
      "spentToday": "75.00",
      "remainingToday": "4925.00"
    }
  }
}
```

### 6.2 Transaction History & Audit Ledger
`GET /api/v1/wallets/transactions?limit=20&page=1`  
Paginated transaction history with linked counterparty metadata.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "8f8b89d4-b4a1-4389-a5c9-9407137f8188",
        "reference": "TXN-20260921-A1B2C3D4",
        "type": "TRANSFER",
        "amount": "50.00",
        "fee": "0.00",
        "currency": "USD",
        "status": "COMPLETED",
        "category": "Food",
        "note": "Dinner split",
        "createdAt": "2026-09-21T13:31:00.000Z",
        "counterparty": {
          "fullName": "Bob Receiver",
          "phoneNumber": "+15559876543"
        }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1 }
  }
}
```

---

## 7. P2P Fund Transfers (`/api/v1/transfers`)

Executes real-time peer-to-peer fund transfers with atomic ledger settlement.

### 7.1 Execute P2P Transfer
`POST /api/v1/transfers`  
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `X-Idempotency-Key: <uuidv4>`
- **Request Body**:
```json
{
  "receiver_phone": "+15559876543",
  "amount": 50.00,
  "category": "Food",
  "note": "Dinner split",
  "pin": "123456"
}
```
*(Alternatively, provide `"ticket": "<transactionTicket>"` in lieu of `"pin"`).*

- **Allowed Categories**: `Food`, `Expense`, `Property`, `Hobby`, `Entertainment`
- **Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "receipt": {
      "transactionId": "8f8b89d4-b4a1-4389-a5c9-9407137f8188",
      "transactionReference": "TXN-20260921-A1B2C3D4",
      "amount": "50.00",
      "fee": "0.00",
      "currency": "USD",
      "status": "COMPLETED",
      "category": "Food",
      "senderBalanceAfter": "150.00",
      "timestamp": "2026-09-21T13:31:00.000Z"
    }
  }
}
```

---

## 8. Payment Requests & Invoicing Subsystem (`/api/v1/requests`)

### 8.1 Create Payment Request
`POST /api/v1/requests`  
Initiates a bill or reimbursement request towards another user.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Request Body**:
```json
{
  "payerPhone": "+15551234567",
  "amount": 25.00,
  "category": "Food",
  "note": "Coffee reimbursement"
}
```
- **Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "e2e92c4f-9ef1-4cf5-9988-518cf503b41d",
    "status": "PENDING",
    "amount": "25.00",
    "currency": "USD",
    "note": "Coffee reimbursement"
  }
}
```

### 8.2 List Incoming Requests
`GET /api/v1/requests?direction=received`  
Retrieves pending payment requests received by the authenticated user.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

### 8.3 Pay / Settle Payment Request
`POST /api/v1/requests/:id/pay`  
Settles a pending payment request atomically.
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `X-Idempotency-Key: <uuidv4>`
- **Request Body**:
```json
{
  "pin": "123456"
}
```
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "receipt": {
      "requestId": "e2e92c4f-9ef1-4cf5-9988-518cf503b41d",
      "transactionId": "...",
      "status": "COMPLETED",
      "amount": "25.00",
      "payerBalanceAfter": "125.00"
    }
  }
}
```

### 8.4 Decline Payment Request
`POST /api/v1/requests/:id/decline`  
Payer declines a pending request.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

### 8.5 Cancel Payment Request
`POST /api/v1/requests/:id/cancel`  
Requester cancels their own pending request.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

---

## 9. Cards, Top-Up & Payment Webhooks

### 9.1 Tokenize Card
`POST /api/v1/cards/tokenize`  
Tokenizes a card with PCI-oriented controls (CVV and full PAN never stored in database).
- **Headers**: `Authorization: Bearer <accessToken>`
- **Request Body**:
```json
{
  "cardNumber": "4111111111111111",
  "expMonth": 12,
  "expYear": 2028,
  "cvv": "123",
  "cardholderName": "Alex Morgan"
}
```
- **Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "card": {
      "id": "...",
      "card_brand": "Visa",
      "last4": "1111",
      "exp_month": 12,
      "exp_year": 2028
    }
  }
}
```

### 9.2 List Tokenized Cards
`GET /api/v1/cards`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

### 9.3 Create Top-Up Intent
`POST /api/v1/top-up/intent`  
Initializes an external payment gateway deposit intent.
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `X-Idempotency-Key: <uuidv4>`
- **Request Body**:
```json
{
  "amount": 100.00,
  "currency": "USD"
}
```
- **Response**: `201 Created`

### 9.4 Payment Gateway Webhook Listener
`POST /api/v1/webhooks/payments`  
Receives cryptographically verified settlement notifications from the payment gateway.
- **Headers**: `X-Webhook-Signature: t=<timestamp>,v1=<hmac>`
- **Request Body**:
```json
{
  "event": "payment_intent.succeeded",
  "data": {
    "id": "pi_1234567890",
    "amount": 100.00,
    "currency": "USD",
    "metadata": {
      "user_id": "...",
      "wallet_id": "..."
    }
  }
}
```
- **Response**: `200 OK`
```json
{
  "received": true,
  "status": "success",
  "receipt": {
    "transaction_id": "...",
    "amount": 100.00
  }
}
```

---

## 10. Cash Flow Analytics (`/api/v1/analytics/cash-flow`)

### 10.1 Get Cash Flow Analytics
`GET /api/v1/analytics/cash-flow?period=monthly&currency=USD`  
Calculates financial intelligence metrics, categorized outflows, and continuous zero-filled time-series chart data for Syncfusion charts.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query Parameters**:
  - `period`: `weekly` | `monthly` | `yearly` (default: `monthly`)
  - `currency`: ISO code (default: `USD`)
  - `startDate`: `YYYY-MM-DD` (optional)
  - `endDate`: `YYYY-MM-DD` (optional)
- **Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_income": 250.00,
      "total_expense": 75.00,
      "net_savings": 175.00,
      "net_savings_ratio": 70.00
    },
    "categories": [
      {
        "category": "Food",
        "total_amount": 75.00,
        "percentage": 100.00,
        "transaction_count": 2
      }
    ],
    "chart_data": [
      { "date": "2026-09-01", "income": 0, "expense": 0, "net": 0 },
      { "date": "2026-09-21", "income": 250.00, "expense": 75.00, "net": 175.00 }
    ]
  }
}
```

---

## 11. Messaging & In-App Notifications

### 11.1 Start or Get Conversation
`POST /api/v1/conversations`  
Finds or creates a conversation thread with a counterparty.
- **Headers**: `Authorization: Bearer <accessToken>`
- **Request Body**:
```json
{
  "participantId": "target-user-uuid"
}
```
- **Response**: `200 OK`

### 11.2 List Conversations
`GET /api/v1/conversations`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

### 11.3 Send Message (With Optional Transaction Card Reference)
`POST /api/v1/conversations/:id/messages`  
- **Headers**: `Authorization: Bearer <accessToken>`
- **Request Body**:
```json
{
  "content": "Here is the transaction receipt for dinner.",
  "transactionId": "8f8b89d4-b4a1-4389-a5c9-9407137f8188"
}
```
- **Response**: `201 Created`

### 11.4 Get Conversation Message History
`GET /api/v1/conversations/:id/messages?limit=50`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

### 11.5 List In-App Notifications
`GET /api/v1/notifications?limit=20`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

### 11.6 Mark Notification Read
`PATCH /api/v1/notifications/:id/read`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

### 11.7 Mark All Notifications Read
`PATCH /api/v1/notifications/read-all`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Response**: `200 OK`

---

## 12. Standard Error Code Dictionary

| Error Code | HTTP Status | Description |
| :--- | :--- | :--- |
| `VALIDATION_ERROR` | 400 | Payload violates Joi schema rules |
| `INSUFFICIENT_FUNDS` | 400 | Wallet balance is lower than transfer amount + fee |
| `SELF_TRANSFER_NOT_ALLOWED` | 400 | Cannot transfer funds to self |
| `SELF_REQUEST_NOT_ALLOWED` | 400 | Cannot request payment from self |
| `INCORRECT_PIN` | 400 | PIN does not match Argon2id hash |
| `IDEMPOTENCY_KEY_MISSING` | 400 | Missing `X-Idempotency-Key` header |
| `IDEMPOTENCY_KEY_INVALID` | 400 | `X-Idempotency-Key` must be a valid UUIDv4 |
| `UNAUTHORIZED` | 401 | Missing, invalid, or expired JWT bearer token |
| `WEBHOOK_SIGNATURE_MISSING` | 401 | Missing `X-Webhook-Signature` header |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | HMAC-SHA256 signature verification failed |
| `FORBIDDEN` | 403 | User does not own the target resource |
| `PIN_LOCKED` | 423 | 3 failed attempts; account locked for 15 minutes |
| `TRANSACTION_TICKET_EXPIRED` | 401 | Transaction ticket exceeded 300s lifetime |
| `RESOURCE_NOT_FOUND` | 404 | Target entity does not exist |
| `PIN_ALREADY_EXISTS` | 409 | PIN has already been configured |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit threshold reached |
| `INTERNAL_SERVER_ERROR` | 500 | Unhandled server exception |
