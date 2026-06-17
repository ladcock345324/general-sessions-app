-- Enable RLS on courtroom_documents and personal_notes.
-- Applied 2026-06-17 directly via Supabase MCP connector.
-- The other 5 tables (clients, incidents, cases, hours, next_events) already
-- had RLS enabled with an identical policy from a prior session.
-- This file is version-control only — do not re-run against the live database.

ALTER TABLE public.courtroom_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users only" ON public.courtroom_documents
  FOR ALL
  TO public
  USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated users only" ON public.personal_notes
  FOR ALL
  TO public
  USING (auth.role() = 'authenticated');
