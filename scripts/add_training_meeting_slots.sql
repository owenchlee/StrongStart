-- Migration: create meeting slots table for training sessions
CREATE TABLE IF NOT EXISTS training_meeting_slots (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  slot_start TIMESTAMPTZ NOT NULL,
  slot_end TIMESTAMPTZ NOT NULL,
  booked_by INTEGER REFERENCES facilitators(id),
  outlook_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookup of available slots per session
CREATE INDEX IF NOT EXISTS idx_meeting_slots_session ON training_meeting_slots (session_id, slot_start);
