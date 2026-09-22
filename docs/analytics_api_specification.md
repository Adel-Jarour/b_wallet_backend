# Cash Flow Analytics API Specification & Chart Contract

**Document Version:** 1.0.0  
**Project:** B-Wallet (FinTech Digital E-Wallet)  
**Module:** Sprint 7 — Cash Flow Analytics & Financial Intelligence  
**Target UI Component:** Syncfusion Flutter Charts (`syncfusion_flutter_charts`)  
**SRS References:** `FR-ANA-001`, `FR-ANA-002`, `FR-ANA-003`  
**Classification:** API Specification & Client Integration Contract  

---

## 1. Executive Summary

The **Cash Flow Analytics Engine** provides high-performance server-side aggregation for user financial telemetry. By performing aggregations on the PostgreSQL database layer rather than the mobile device (Architectural Decision 4), B-Wallet achieves:
1. **Sub-100ms Response Times:** Backed by compound partial indexes (`idx_transactions_sender_created_at`, `idx_transactions_receiver_created_at`).
2. **Deterministic Financial Math:** Eliminates client-side IEEE 754 floating-point errors by calculating all metrics using PostgreSQL `NUMERIC(15,2)`.
3. **Bandwidth Optimization:** The mobile client receives pre-aggregated summary statistics, category percentage distributions, and time-series buckets ready for direct binding to `syncfusion_flutter_charts`.
4. **Single Source of Truth:** Aggregations query completed transaction headers directly, maintaining mathematical synchronization with the immutable double-entry ledger without secondary cache desynchronization.

---

## 2. API Endpoint Specification

### `GET /api/v1/analytics/cash-flow`

Retrieves comparative income vs. expense analytics, net savings ratio, category breakdowns, and time-series data for the authenticated user.

#### Authentication
- **Header:** `Authorization: Bearer <JWT>` (Mandatory)
- The user identity is extracted strictly from the verified JWT claim (`auth.uid()`).

#### Query Parameters

| Parameter | Type | Required | Default | Allowed Values | Description |
|---|:---:|:---:|:---:|---|---|
| `period` | string | No | `monthly` | `weekly`, `monthly`, `yearly` | Aggregation time window and time-series bucket granularity. |
| `currency` | string | No | `USD` | ISO 4217 (e.g. `USD`) | Currency filter. |
| `start_date` | string (ISO 8601) | No | *Derived* | `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss.sssZ` | Custom window start. |
| `end_date` | string (ISO 8601) | No | *Derived* | `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss.sssZ` | Custom window end. |

> [!NOTE]
> When `start_date` and `end_date` are omitted, the engine automatically resolves:
> - **`weekly`:** Last 7 days (including current UTC day), grouped into 7 daily buckets.
> - **`monthly`:** 1st day of the current calendar month to the last millisecond of the month, grouped into weekly buckets (Week 1..Week 5).
> - **`yearly`:** 1st day of the current calendar year to the last millisecond of the year, grouped into 12 monthly buckets (Jan..Dec).
>
> The date range between `start_date` and `end_date` is constrained to a maximum of **5 years (1826 days)** to prevent query exhaustion attacks.

---

## 3. Financial Metrics & Accounting Definitions

### 3.1 Total Income (Inflows)
Represents all credited funds entering the user's wallet where the user is the beneficiary (`receiver_id = user_id`) with status `COMPLETED`:
- **Top-Ups:** External deposits settled via payment gateway.
- **P2P Inflows:** Transfers received from other users.
- **Settled Requests:** Payment requests settled where the user was the requester.

$$\text{Total Income} = \sum_{\text{inflows}} \text{amount}$$

### 3.2 Total Expense (Outflows)
Represents all debited funds leaving the user's wallet where the user is the payer (`sender_id = user_id`) with status `COMPLETED`:
- **P2P Outflows:** Transfers sent to other users ($\text{amount} + \text{fee}$).
- **Settled Requests:** Payment requests paid by the user ($\text{amount} + \text{fee}$).
- **Bill Payments:** Utility and bill payments ($\text{amount} + \text{fee}$).

$$\text{Total Expense} = \sum_{\text{outflows}} (\text{amount} + \text{fee})$$

### 3.3 Net Savings
$$\text{Net Savings} = \text{Total Income} - \text{Total Expense}$$

### 3.4 Net Savings Ratio
$$\text{Net Savings Ratio} = \begin{cases} \text{ROUND}\left(\frac{\text{Total Income} - \text{Total Expense}}{\text{Total Income}} \times 100\%, 2\right) & \text{if } \text{Total Income} > 0.00 \\ 0.00 & \text{if } \text{Total Income} \le 0.00 \end{cases}$$

> [!TIP]
> **Zero-Division Defense:** When a user has zero income, the formula evaluates cleanly to `0.00%`, preventing divide-by-zero database or application errors.

---

## 4. Response Payload Schema

```json
{
  "success": true,
  "data": {
    "period": "monthly",
    "currency": "USD",
    "start_date": "2026-09-01T00:00:00.000Z",
    "end_date": "2026-09-30T23:59:59.999Z",
    "summary": {
      "total_income": 3500.00,
      "total_expense": 1200.00,
      "net_savings": 2300.00,
      "net_savings_ratio": 65.71
    },
    "categories": [
      {
        "category": "Food",
        "total_amount": 600.00,
        "percentage": 50.00,
        "transaction_count": 4
      },
      {
        "category": "Entertainment",
        "total_amount": 360.00,
        "percentage": 30.00,
        "transaction_count": 2
      },
      {
        "category": "Expense",
        "total_amount": 240.00,
        "percentage": 20.00,
        "transaction_count": 1
      }
    ],
    "chart_data": [
      {
        "label": "Week 1",
        "start_date": "2026-09-01",
        "end_date": "2026-09-07",
        "income": 1000.00,
        "expense": 300.00,
        "net": 700.00
      },
      {
        "label": "Week 2",
        "start_date": "2026-09-08",
        "end_date": "2026-09-14",
        "income": 1500.00,
        "expense": 400.00,
        "net": 1100.00
      },
      {
        "label": "Week 3",
        "start_date": "2026-09-15",
        "end_date": "2026-09-21",
        "income": 500.00,
        "expense": 200.00,
        "net": 300.00
      },
      {
        "label": "Week 4",
        "start_date": "2026-09-22",
        "end_date": "2026-09-28",
        "income": 500.00,
        "expense": 300.00,
        "net": 200.00
      },
      {
        "label": "Week 5",
        "start_date": "2026-09-29",
        "end_date": "2026-09-30",
        "income": 0.00,
        "expense": 0.00,
        "net": 0.00
      }
    ]
  }
}
```

---

## 5. Syncfusion Flutter Charts Integration Contract

The `chart_data` array is designed for zero-transformation binding to `syncfusion_flutter_charts`.

### 5.1 Weekly View (Daily Trend)
- **X-Axis:** `label` (`Mon`, `Tue`, `Wed`, etc.) or `date` (`YYYY-MM-DD`).
- **Series 1 (Income):** `ColumnSeries` or `SplineSeries` using green palette (`#27AE60`).
- **Series 2 (Expense):** `ColumnSeries` or `SplineSeries` using primary accent (`#E74C3C` / `#2C3E50`).
- **Guaranteed Structure:** Always yields exactly 7 sequential buckets.

### 5.2 Monthly View (Weekly Breakdown)
- **X-Axis:** `label` (`Week 1`, `Week 2`, etc.).
- **Y-Axis:** Numerical amount in currency units.
- **Series:** Stacked or comparative column series.
- **Guaranteed Structure:** Yields 4–5 sequential buckets spanning the entire calendar month.

### 5.3 Yearly View (Monthly Breakdown)
- **X-Axis:** `label` (`Jan`, `Feb`, `Mar`, etc.) or `date` (`YYYY-MM`).
- **Guaranteed Structure:** Always yields exactly 12 sequential month buckets.

### 5.4 Empty State Rendering
When a user has no transaction activity in the period:
- `summary.total_income`: `0.00`
- `summary.total_expense`: `0.00`
- `summary.net_savings`: `0.00`
- `summary.net_savings_ratio`: `0.00`
- `categories`: `[]`
- `chart_data`: Populated with all period buckets with `income: 0.00`, `expense: 0.00`, `net: 0.00`.
- This ensures the Flutter chart renders continuous axes and zero baselines without null pointer exceptions or empty screen flickers.
