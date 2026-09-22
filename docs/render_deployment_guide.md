# B-Wallet Backend — Render Production Deployment Guide

This guide provides step-by-step instructions for deploying the B-Wallet Node.js/Express backend to [Render](https://render.com).

---

## 1. Overview & Architectural Compatibility

The B-Wallet backend has been specifically verified and configured for Render deployment:
- **Server Entrypoint:** `src/server.js` invoked via `npm start` (`node src/server.js`).
- **Dynamic Port Binding:** Binds to `process.env.PORT` dynamically assigned by Render (with safe local fallback to `3000`).
- **Interface Binding:** Binds explicitly to `0.0.0.0` (required for containerized cloud environments).
- **Health Checks:** Native zero-auth `GET /health` responding with `200 OK` and status diagnostics.
- **Graceful Shutdown:** Handles `SIGTERM` and `SIGINT` signals with a 10-second drain period.
- **Zero Secret Leaks:** `SUPABASE_SERVICE_ROLE_KEY` is strictly managed via environment variables and never logged.

---

## 2. Deployment Steps on Render

### Method A: Blueprint Deployment (Recommended)
1. In the [Render Dashboard](https://dashboard.render.com), click **New +** -> **Blueprint**.
2. Connect your GitHub repository: `https://github.com/Adel-Jarour/b_wallet_backend.git`.
3. Render will detect `render.yaml` automatically.
4. Fill in the required secret environment variables (see Section 3).
5. Click **Apply**. Render will install dependencies, build, and deploy.

### Method B: Manual Web Service Deployment
1. In Render Dashboard, click **New +** -> **Web Service**.
2. Connect the repository `b_wallet_backend`.
3. Configure the following settings:
   - **Name:** `b-wallet-backend`
   - **Language:** `Node`
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free` or `Starter`
4. Under **Advanced Settings**:
   - **Health Check Path:** `/health`
   - **Auto-Deploy:** `Yes`
5. Configure Environment Variables as specified below.

---

## 3. Production Environment Variables

Configure these in the Render Dashboard (**Environment** tab):

| Variable Name | Required | Default / Sample | Description |
|---|---|---|---|
| `NODE_ENV` | **Yes** | `production` | Enables production optimizations, disables stack traces in errors. |
| `SUPABASE_URL` | **Yes** | `https://your-project.supabase.co` | Supabase project API gateway URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | `eyJh...` (Secret) | Server-only admin key with elevated privileges for financial ledgering and RLS bypass. **Never expose this to mobile clients.** |
| `CORS_ORIGIN` | Optional | `*` | Allowed CORS origins. In production, restrict to your mobile/web app origins. |
| `LOG_LEVEL` | Optional | `info` | Logging verbosity (`info`, `warn`, `error`). In production, `info` is recommended. |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | **Yes** | `sec_prod_...` | HMAC shared secret for validating payment gateway webhooks. |

> [!WARNING]
> **DO NOT set `PORT` in Render environment variables.**
> Render automatically allocates and injects a dynamic `PORT` at runtime into the container's environment. Hardcoding `PORT=3000` will cause port collisions or routing failures.

---

## 4. Verification After Deployment

Once deployment is complete:
1. Verify the service is live by visiting:
   ```bash
   curl -i https://<your-service-name>.onrender.com/health
   ```
   **Expected Response:**
   ```json
   HTTP/1.1 200 OK
   Content-Type: application/json; charset=utf-8

   {
     "status": "UP",
     "timestamp": "2026-09-22T...",
     "uptime": "...",
     "environment": "production",
     "services": {
       "api": "HEALTHY",
       "supabase": "CONNECTED"
     }
   }
   ```
2. Verify API documentation is accessible at:
   ```
   https://<your-service-name>.onrender.com/api-docs
   ```
