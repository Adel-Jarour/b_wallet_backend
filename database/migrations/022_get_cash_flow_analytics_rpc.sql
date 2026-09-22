-- ============================================================================
-- Migration 022: get_cash_flow_analytics PL/pgSQL Stored Procedure
-- B-Wallet FinTech Database Schema (Sprint 7)
-- ============================================================================
-- Server-side aggregation engine for cash flow telemetry:
--   1. Calculates Total Income (inflows: receiver_id = user_id, status = 'COMPLETED')
--   2. Calculates Total Expense (outflows: sender_id = user_id, status = 'COMPLETED')
--   3. Computes Net Savings and Net Savings Ratio ((Income - Expense) / Income * 100)
--   4. Computes categorized expense distributions with percentage shares
--   5. Generates continuous, zero-filled periodic time-series for Syncfusion charts:
--        - 'weekly'  -> 7 daily buckets (Mon..Sun or 7-day window)
--        - 'monthly' -> 4-5 weekly buckets
--        - 'yearly'  -> 12 monthly buckets (Jan..Dec)
--
-- Precision & Edge Cases:
--   - Strict NUMERIC(15,2) fixed-point math throughout.
--   - Zero division guarded: returns 0.00 when income or expense is zero.
--   - Clean empty state: users with no transactions return zeroed metrics.
--
-- Security:
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - REVOKE ALL FROM PUBLIC, anon, authenticated
--   - GRANT EXECUTE TO service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cash_flow_analytics(
  p_user_id     UUID,
  p_period      VARCHAR(10) DEFAULT 'monthly',
  p_start_date  TIMESTAMPTZ DEFAULT NULL,
  p_end_date    TIMESTAMPTZ DEFAULT NULL,
  p_currency    CHAR(3) DEFAULT 'USD'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_date          TIMESTAMPTZ;
  v_end_date            TIMESTAMPTZ;
  v_total_income        NUMERIC(15,2) := 0.00;
  v_total_expense       NUMERIC(15,2) := 0.00;
  v_net_savings         NUMERIC(15,2) := 0.00;
  v_net_savings_ratio   NUMERIC(15,2) := 0.00;
  v_categories          JSONB := '[]'::jsonb;
  v_chart_data          JSONB := '[]'::jsonb;
  v_summary             JSONB;
BEGIN
  -- ============================================================================
  -- 1. Date Range Resolution
  -- ============================================================================
  IF p_period = 'weekly' THEN
    v_start_date := COALESCE(p_start_date, (DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '6 days'));
    v_end_date   := COALESCE(p_end_date, (DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day' - INTERVAL '1 millisecond'));
  ELSIF p_period = 'yearly' THEN
    v_start_date := COALESCE(p_start_date, DATE_TRUNC('year', NOW() AT TIME ZONE 'UTC'));
    v_end_date   := COALESCE(p_end_date, (DATE_TRUNC('year', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 year' - INTERVAL '1 millisecond'));
  ELSE -- 'monthly' is default
    v_start_date := COALESCE(p_start_date, DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC'));
    v_end_date   := COALESCE(p_end_date, (DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month' - INTERVAL '1 millisecond'));
  END IF;

  -- Safety check: prevent query windows larger than 5 years
  IF (v_end_date - v_start_date) > INTERVAL '1826 days' THEN
    RAISE EXCEPTION 'Query window cannot exceed 5 years'
      USING ERRCODE = '22000';
  END IF;

  -- ============================================================================
  -- 2. Aggregate Total Income (Inflows)
  -- ============================================================================
  SELECT COALESCE(SUM(amount), 0.00)::NUMERIC(15,2)
  INTO v_total_income
  FROM public.transactions
  WHERE receiver_id = p_user_id
    AND status = 'COMPLETED'
    AND currency = p_currency
    AND created_at >= v_start_date
    AND created_at <= v_end_date;

  -- ============================================================================
  -- 3. Aggregate Total Expense (Outflows: Amount + Fee)
  -- ============================================================================
  SELECT COALESCE(SUM(amount + COALESCE(fee, 0.00)), 0.00)::NUMERIC(15,2)
  INTO v_total_expense
  FROM public.transactions
  WHERE sender_id = p_user_id
    AND status = 'COMPLETED'
    AND currency = p_currency
    AND created_at >= v_start_date
    AND created_at <= v_end_date;

  -- ============================================================================
  -- 4. Net Savings & Savings Ratio
  -- ============================================================================
  v_net_savings := (v_total_income - v_total_expense)::NUMERIC(15,2);

  IF v_total_income > 0.00 THEN
    v_net_savings_ratio := ROUND(((v_total_income - v_total_expense) / v_total_income) * 100.0, 2)::NUMERIC(15,2);
  ELSE
    v_net_savings_ratio := 0.00;
  END IF;

  v_summary := jsonb_build_object(
    'total_income', v_total_income,
    'total_expense', v_total_expense,
    'net_savings', v_net_savings,
    'net_savings_ratio', v_net_savings_ratio
  );

  -- ============================================================================
  -- 5. Category Breakdown (Expenses)
  -- ============================================================================
  WITH cat_totals AS (
    SELECT
      COALESCE(category, 'Expense') AS category_name,
      SUM(amount + COALESCE(fee, 0.00))::NUMERIC(15,2) AS cat_amount,
      COUNT(*)::INT AS tx_count
    FROM public.transactions
    WHERE sender_id = p_user_id
      AND status = 'COMPLETED'
      AND currency = p_currency
      AND created_at >= v_start_date
      AND created_at <= v_end_date
    GROUP BY COALESCE(category, 'Expense')
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'category', category_name,
        'total_amount', cat_amount,
        'percentage', CASE
          WHEN v_total_expense > 0.00 THEN ROUND((cat_amount / v_total_expense) * 100.0, 2)::NUMERIC(15,2)
          ELSE 0.00
        END,
        'transaction_count', tx_count
      )
      ORDER BY cat_amount DESC
    ),
    '[]'::jsonb
  )
  INTO v_categories
  FROM cat_totals;

  -- ============================================================================
  -- 6. Periodic Time-Series Generation (Chart Data)
  -- ============================================================================
  IF p_period = 'weekly' THEN
    -- 7 daily buckets from start_date to end_date
    WITH daily_series AS (
      SELECT generate_series(
        DATE_TRUNC('day', v_start_date),
        DATE_TRUNC('day', v_end_date),
        INTERVAL '1 day'
      ) AS bucket_start
    ),
    daily_inflows AS (
      SELECT
        DATE_TRUNC('day', created_at) AS day_bucket,
        SUM(amount) AS income
      FROM public.transactions
      WHERE receiver_id = p_user_id
        AND status = 'COMPLETED'
        AND currency = p_currency
        AND created_at >= v_start_date
        AND created_at <= v_end_date
      GROUP BY DATE_TRUNC('day', created_at)
    ),
    daily_outflows AS (
      SELECT
        DATE_TRUNC('day', created_at) AS day_bucket,
        SUM(amount + COALESCE(fee, 0.00)) AS expense
      FROM public.transactions
      WHERE sender_id = p_user_id
        AND status = 'COMPLETED'
        AND currency = p_currency
        AND created_at >= v_start_date
        AND created_at <= v_end_date
      GROUP BY DATE_TRUNC('day', created_at)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'label', TO_CHAR(ds.bucket_start, 'Dy'),
          'date', TO_CHAR(ds.bucket_start, 'YYYY-MM-DD'),
          'income', COALESCE(di.income, 0.00)::NUMERIC(15,2),
          'expense', COALESCE(dout.expense, 0.00)::NUMERIC(15,2),
          'net', (COALESCE(di.income, 0.00) - COALESCE(dout.expense, 0.00))::NUMERIC(15,2)
        )
        ORDER BY ds.bucket_start ASC
      ),
      '[]'::jsonb
    )
    INTO v_chart_data
    FROM daily_series ds
    LEFT JOIN daily_inflows di ON di.day_bucket = ds.bucket_start
    LEFT JOIN daily_outflows dout ON dout.day_bucket = ds.bucket_start;

  ELSIF p_period = 'yearly' THEN
    -- 12 monthly buckets
    WITH monthly_series AS (
      SELECT generate_series(
        DATE_TRUNC('month', v_start_date),
        DATE_TRUNC('month', v_end_date),
        INTERVAL '1 month'
      ) AS bucket_start
    ),
    monthly_inflows AS (
      SELECT
        DATE_TRUNC('month', created_at) AS month_bucket,
        SUM(amount) AS income
      FROM public.transactions
      WHERE receiver_id = p_user_id
        AND status = 'COMPLETED'
        AND currency = p_currency
        AND created_at >= v_start_date
        AND created_at <= v_end_date
      GROUP BY DATE_TRUNC('month', created_at)
    ),
    monthly_outflows AS (
      SELECT
        DATE_TRUNC('month', created_at) AS month_bucket,
        SUM(amount + COALESCE(fee, 0.00)) AS expense
      FROM public.transactions
      WHERE sender_id = p_user_id
        AND status = 'COMPLETED'
        AND currency = p_currency
        AND created_at >= v_start_date
        AND created_at <= v_end_date
      GROUP BY DATE_TRUNC('month', created_at)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'label', TO_CHAR(ms.bucket_start, 'Mon'),
          'date', TO_CHAR(ms.bucket_start, 'YYYY-MM'),
          'income', COALESCE(mi.income, 0.00)::NUMERIC(15,2),
          'expense', COALESCE(mo.expense, 0.00)::NUMERIC(15,2),
          'net', (COALESCE(mi.income, 0.00) - COALESCE(mo.expense, 0.00))::NUMERIC(15,2)
        )
        ORDER BY ms.bucket_start ASC
      ),
      '[]'::jsonb
    )
    INTO v_chart_data
    FROM monthly_series ms
    LEFT JOIN monthly_inflows mi ON mi.month_bucket = ms.bucket_start
    LEFT JOIN monthly_outflows mo ON mo.month_bucket = ms.bucket_start;

  ELSE
    -- 'monthly': weekly buckets (4-5 weeks)
    WITH weekly_series AS (
      SELECT
        s AS bucket_start,
        row_number() OVER (ORDER BY s) AS week_num
      FROM generate_series(
        v_start_date,
        v_end_date,
        INTERVAL '7 days'
      ) s
    ),
    weekly_buckets AS (
      SELECT
        week_num,
        bucket_start,
        LEAST(bucket_start + INTERVAL '7 days' - INTERVAL '1 millisecond', v_end_date) AS bucket_end
      FROM weekly_series
    ),
    weekly_inflows AS (
      SELECT
        wb.week_num,
        SUM(t.amount) AS income
      FROM weekly_buckets wb
      JOIN public.transactions t
        ON t.receiver_id = p_user_id
       AND t.status = 'COMPLETED'
       AND t.currency = p_currency
       AND t.created_at >= wb.bucket_start
       AND t.created_at <= wb.bucket_end
      GROUP BY wb.week_num
    ),
    weekly_outflows AS (
      SELECT
        wb.week_num,
        SUM(t.amount + COALESCE(t.fee, 0.00)) AS expense
      FROM weekly_buckets wb
      JOIN public.transactions t
        ON t.sender_id = p_user_id
       AND t.status = 'COMPLETED'
       AND t.currency = p_currency
       AND t.created_at >= wb.bucket_start
       AND t.created_at <= wb.bucket_end
      GROUP BY wb.week_num
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'label', 'Week ' || wb.week_num,
          'start_date', TO_CHAR(wb.bucket_start, 'YYYY-MM-DD'),
          'end_date', TO_CHAR(wb.bucket_end, 'YYYY-MM-DD'),
          'income', COALESCE(wi.income, 0.00)::NUMERIC(15,2),
          'expense', COALESCE(wo.expense, 0.00)::NUMERIC(15,2),
          'net', (COALESCE(wi.income, 0.00) - COALESCE(wo.expense, 0.00))::NUMERIC(15,2)
        )
        ORDER BY wb.week_num ASC
      ),
      '[]'::jsonb
    )
    INTO v_chart_data
    FROM weekly_buckets wb
    LEFT JOIN weekly_inflows wi ON wi.week_num = wb.week_num
    LEFT JOIN weekly_outflows wo ON wo.week_num = wb.week_num;
  END IF;

  -- ============================================================================
  -- 7. Return Final Analytics Payload
  -- ============================================================================
  RETURN jsonb_build_object(
    'summary', v_summary,
    'categories', v_categories,
    'chart_data', v_chart_data,
    'period', p_period,
    'currency', p_currency,
    'start_date', v_start_date,
    'end_date', v_end_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_flow_analytics(UUID, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, CHAR(3)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_analytics(UUID, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, CHAR(3)) TO service_role;

COMMENT ON FUNCTION public.get_cash_flow_analytics IS
  'Aggregates cash flow analytics (income, expense, net savings ratio, category breakdown, chart time-series) for an authenticated user.';
