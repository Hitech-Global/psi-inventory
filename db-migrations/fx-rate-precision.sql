-- FX-P0 2026-09-13
-- IDR/RMB is ~0.00038. NUMERIC(18,8) collapses materially different daily values
-- (for example 0.000381xx and 0.000382xx) into the same stored value.
-- Widening scale is backward compatible; existing values are preserved exactly as stored.
ALTER TABLE public.exchange_rates
  ALTER COLUMN rate TYPE NUMERIC(24,12)
  USING rate::numeric;
