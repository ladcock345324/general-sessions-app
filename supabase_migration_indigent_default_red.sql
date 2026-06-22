-- Indigent-status circle: remove 'gray', make 'red' the default (2026-06-22)
--
-- Cycle changed from gray → red → green → gray  to  red → yellow → green → gold (wrapping).
-- 'gray' is no longer a valid state, default, or fallback anywhere.
--
-- 1. Change the column default from 'gray' to 'red' so new clients start red.
-- 2. Backfill EVERY existing client to 'red' (also cleans up any legacy 'gray',
--    null, or empty values). The app no longer backfills; this is authoritative.

ALTER TABLE clients ALTER COLUMN indigent_status SET DEFAULT 'red';

UPDATE clients SET indigent_status = 'red';
