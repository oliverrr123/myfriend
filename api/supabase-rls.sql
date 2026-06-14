-- RLS for the newly added calling preference and follow-up topic tables.
-- The API uses the Supabase service role key on the backend, which bypasses RLS.

ALTER TABLE IF EXISTS calling_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS topics ENABLE ROW LEVEL SECURITY;

-- Intentionally no anon/authenticated policies here.
-- Add explicit policies later only if a frontend should access Supabase directly.
