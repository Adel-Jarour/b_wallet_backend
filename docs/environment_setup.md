# B-Wallet Backend Environment Setup & Developer Guide

This document provides complete instructions for setting up, configuring, and verifying the **B-Wallet Backend** environment.

---

## 1. Prerequisites

Ensure you have the following installed on your local development machine:
* **Node.js:** v18.0.0 or higher (v24.x recommended)
* **npm:** v9.0.0 or higher
* **Supabase Account & Project:** An active Supabase project (Free or Pro tier)

---

## 2. Installation

1. Clone or navigate to the project directory:
   ```bash
   cd d:/Adel/nodejs-projects/b-wallet
   ```

2. Install all dependencies:
   ```bash
   npm install
   ```

---

## 3. Environment Configuration (`.env`)

Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```

Open `.env` and configure the following variables:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `PORT` | The local port the Express server will listen on | `3000` |
| `NODE_ENV` | Application environment (`development`, `production`, `test`) | `development` |
| `SUPABASE_URL` | Your Supabase Project API URL | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **Service Role** secret key (Server-only!) | `eyJhbGciOi...` |
| `CORS_ORIGIN` | Allowed CORS origins (`*` for local testing) | `*` |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `debug` |

> [!CAUTION]
> **CRITICAL SECURITY RULE:**  
> The `SUPABASE_SERVICE_ROLE_KEY` has full administrative bypass over Row Level Security (RLS).  
> **NEVER** commit your `.env` file to version control.  
> **NEVER** expose this key to the Flutter mobile application or client bundles.

---

## 4. Supabase Verification

To verify that your server can communicate with your Supabase project, execute the standalone diagnostic script:

```bash
npm run verify:supabase
```

**Expected Output (Successful Connection):**
```
=====================================================
       B-Wallet Supabase Connectivity Diagnostic     
=====================================================
[Target URL] : https://your-project.supabase.co
[Service Key]: ***xyz123
[Environment]: development
-----------------------------------------------------
Testing connection to Supabase API...

✅ STATUS: CONNECTED
⏱️  Latency: 142ms
🎉 Supabase Auth Admin API reachable with provided service_role key!
Your empty Supabase project is ready for Sprint 1 schema migrations.
```

---

## 5. Running the Application

### Development Mode (with auto-reload):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

---

## 6. Verifying System Health

Open your browser, Postman, or terminal and query:

```bash
curl http://localhost:3000/health
```

**Sample JSON Response:**
```json
{
  "status": "UP",
  "timestamp": "2026-09-09T15:40:00.000Z",
  "uptime": "14.20s",
  "environment": "development",
  "correlationId": "48b6c00d-3172-46a2-a9b1-6a31034f5934",
  "services": {
    "api": "HEALTHY",
    "supabase": "CONNECTED"
  },
  "diagnostics": {
    "supabaseLatencyMs": 115,
    "supabaseDetails": {
      "usersAccessible": true,
      "projectUrl": "https://your-project.supabase.co"
    },
    "supabaseError": null
  },
  "system": {
    "nodeVersion": "v24.19.0",
    "memoryUsageMb": {
      "rss": "42.15",
      "heapUsed": "18.30",
      "heapTotal": "25.50"
    }
  }
}
```

---

## 7. Running Automated Tests

Run the test suite via Jest:
```bash
npm test
```
