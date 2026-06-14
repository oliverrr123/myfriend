CREATE TABLE IF NOT EXISTS calling_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekdays VARCHAR(50) NOT NULL,
  hour_range_from VARCHAR(5) NOT NULL CHECK (hour_range_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  hour_range_to VARCHAR(5) NOT NULL CHECK (hour_range_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  agent_id VARCHAR(255),
  agent_phone_number VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hour_range_from < hour_range_to)
);

CREATE INDEX IF NOT EXISTS idx_calling_preferences_user_id
  ON calling_preferences(user_id);

DROP INDEX IF EXISTS idx_calling_preferences_active;

ALTER TABLE calling_preferences
  DROP COLUMN IF EXISTS active;

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_from TIMESTAMPTZ NOT NULL,
  time_to TIMESTAMPTZ NOT NULL,
  topic TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (time_from < time_to)
);

CREATE INDEX IF NOT EXISTS idx_topics_user_active_window
  ON topics(user_id, active, time_from, time_to);
