-- PDF text extraction columns
-- Run this once in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/afhzkqjrciyoeizrpaxt/sql

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS warrant_text text;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS criminal_history_text text;

ALTER TABLE courtroom_documents
  ADD COLUMN IF NOT EXISTS extracted_text text;
