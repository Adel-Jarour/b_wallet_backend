# B-Wallet Real-Time Messaging & Notification Engine

## Overview

Sprint 8 establishes B-Wallet's real-time messaging and notification subsystem:
1. **Real-Time Chat (`/api/v1/conversations`)**: Peer-to-peer messaging backed by PostgreSQL, Supabase Realtime (WebSockets), Row-Level Security (RLS), and embedded financial transaction action cards (`FR-MSG-001` – `FR-MSG-005`).
2. **Notification Center (`/api/v1/notifications`)**: Persistent categorized in-app notification center (`FR-NOT-002`, `FR-NOT-003`) with unread counters, single and bulk read operations.
3. **Background Push Engine (`/api/v1/users/device-token`)**: FCM/APNs push notification dispatcher (`FR-NOT-001`) with multi-device support and safe mock fallback for offline/development environments.
4. **Resilient Financial Integration**: Strict decoupling of notification delivery from atomic financial ledger commits (`transfer_funds_atomic`, `settle_payment_request_atomic`).

---

## Architecture & Security Boundary

```
[Flutter / Mobile Client]
     │
     ├──── HTTP/REST (Port 3000) ────────► [Node.js Express API]
     │                                            │
     │                                            ├─► Atomic DB RPCs (transfer_funds_atomic)
     │                                            ├─► Non-blocking In-App Notification Record
     │                                            └─► PushProvider (Firebase Admin / Mock FCM)
     │
     └──── WSS (WebSockets) ──────────────► [Supabase Realtime Engine]
                                                  │
                                          (Postgres Publication:
                                           ALTER PUBLICATION supabase_realtime
                                           ADD TABLE public.messages;)
                                                  │
                                          (Evaluates RLS via JWT:
                                           messages_select_own)
```

---

## 1. Supabase Realtime WebSocket Guide

### Channel Subscription (Client-Side)

Clients subscribe directly to message events for their active conversation using the Supabase Flutter / JS client:

```javascript
// JavaScript / Flutter Supabase Realtime Client
const channel = supabase
  .channel(`conversation:${conversationId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${conversationId}`
    },
    (payload) => {
      console.log('New message received:', payload.new);
      // Render message in chat bubble UI
      // If payload.new.transaction_id is present, render embedded financial card
    }
  )
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log('Connected to conversation stream');
    }
  });
```

### RLS Protection against Eavesdropping
- The PostgreSQL publication `supabase_realtime` replicates rows from `public.messages`.
- Supabase Realtime strictly enforces Postgres Row Level Security (RLS) on each connected client JWT.
- Policy `messages_select_own`:
  ```sql
  CREATE POLICY "messages_select_own"
    ON public.messages
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.conversations
        WHERE conversations.id = messages.conversation_id
          AND (conversations.participant_one = auth.uid()
               OR conversations.participant_two = auth.uid())
      )
    );
  ```
- Any unauthorized user (non-participant) attempting to subscribe to a conversation's channel will receive zero events because the RLS filter evaluates to false.

---

## 2. Push Notification Architecture (FCM/APNs)

### Device Token Registration

Clients register their device push token immediately after authentication or token rotation:

```http
POST /api/v1/users/device-token
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "token": "dK_3g7s0K...fcm_token_string...",
  "platform": "android"
}
```

- Platform values: `'android' | 'ios' | 'web'` (defaults to `'android'`).
- Tokens are persisted in `public.device_tokens` with unique constraint `(user_id, token)`.

### Push Notification Payload Schema

```json
{
  "token": "<target_device_token>",
  "notification": {
    "title": "Funds Received",
    "body": "You received USD 50.00 from Jane Doe."
  },
  "data": {
    "type": "TRANSFER_RECEIVED",
    "transactionId": "099a9ecf-b78b-4b13-8fc7-62281a81dc1c",
    "transactionReference": "TXN-20260914-A1B2C3D4",
    "amount": "50.00",
    "currency": "USD"
  }
}
```

### Supported Push & In-App Event Types

| Event Type | Category | Trigger | Recipient |
|------------|----------|---------|-----------|
| `TRANSFER_RECEIVED` | `TRANSACTIONS` | Atomic P2P fund transfer executed | Transfer Receiver |
| `PAYMENT_REQUEST_RECEIVED` | `TRANSACTIONS` | New payment request created | Target Payer |
| `PAYMENT_REQUEST_PAID` | `TRANSACTIONS` | Payment request settled via PIN | Original Requester |
| `PAYMENT_REQUEST_DECLINED` | `TRANSACTIONS` | Payment request declined by payer | Original Requester |
| `PIN_LOCKOUT` | `SYSTEM` | 3 consecutive failed PIN entries | Account Owner |
| `NEW_CHAT_MESSAGE` | `SYSTEM` | Chat message sent in conversation | Counterparty |

---

## 3. Financial Integration Guarantee

To protect financial transactions and ledger integrity (`NFR-INT-001`, `NFR-INT-003`):

1. **Strict Post-Commit Execution**: Notification records and push dispatches are executed strictly after the atomic database RPC (`transfer_funds_atomic` or `settle_payment_request_atomic`) has successfully committed.
2. **Non-Blocking Fault Isolation**: All notification calls are wrapped in non-blocking error handlers (`try { ... } catch (err) { logger.error(...) }`). If FCM or database notification insertion fails, the financial response (`200 OK` / `201 Created` with receipt) is still returned to the client.
3. **No Phantom Notifications**: If a transaction fails (e.g., Insufficient funds, invalid PIN, AML velocity breach), the request aborts before the post-commit handler, guaranteeing no incorrect notification records are ever generated.

---

## 4. API Endpoints Reference

### Conversations & Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/conversations` | List user's conversations with preview & unread count |
| `POST` | `/api/v1/conversations` | Get existing or create new conversation with user |
| `GET` | `/api/v1/conversations/:id/messages` | Paginated messages history (`page`, `limit`) |
| `POST` | `/api/v1/conversations/:id/messages` | Send message (with optional `transaction_id`) |

### Notification Center

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/notifications` | List in-app notifications (filters: `category`, `is_read`, `page`, `limit`) |
| `PATCH` | `/api/v1/notifications/:id/read` | Mark single notification as read |
| `POST` | `/api/v1/notifications/read-all` | Mark all notifications as read (optional `category`) |
| `POST` | `/api/v1/users/device-token` | Register device token for FCM push alerts |
