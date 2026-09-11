CREATE TABLE IF NOT EXISTS void_cloud_state (key text PRIMARY KEY, document jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS void_cloud_ledger (workspace text NOT NULL, seq integer NOT NULL, entry jsonb NOT NULL, PRIMARY KEY(workspace,seq));
CREATE OR REPLACE FUNCTION void_cloud_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VOID ledger is append only'; END $$;
DROP TRIGGER IF EXISTS void_cloud_immutable ON void_cloud_ledger;
CREATE TRIGGER void_cloud_immutable BEFORE UPDATE OR DELETE ON void_cloud_ledger FOR EACH ROW EXECUTE FUNCTION void_cloud_immutable();

-- GUI history is additive. Existing retained events are backfilled without
-- pretending previously truncated events can be recovered.
CREATE TABLE IF NOT EXISTS void_cloud_events (session_id text NOT NULL, seq integer NOT NULL, event jsonb NOT NULL, PRIMARY KEY(session_id,seq));
INSERT INTO void_cloud_events(session_id,seq,event)
SELECT document->>'id', (event->>'seq')::integer, event
FROM void_cloud_state CROSS JOIN LATERAL jsonb_array_elements(COALESCE(document->'events','[]'::jsonb)) event
WHERE key LIKE 'session:%' ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS void_cloud_session_created ON void_cloud_state ((document->>'createdAt') DESC, key) WHERE key LIKE 'session:%';
CREATE INDEX IF NOT EXISTS void_cloud_session_status ON void_cloud_state ((document->>'status')) WHERE key LIKE 'session:%';
CREATE INDEX IF NOT EXISTS void_cloud_events_type ON void_cloud_events ((event->>'type'),session_id,seq);
DROP TRIGGER IF EXISTS void_cloud_events_immutable ON void_cloud_events;
CREATE TRIGGER void_cloud_events_immutable BEFORE UPDATE OR DELETE ON void_cloud_events FOR EACH ROW EXECUTE FUNCTION void_cloud_immutable();
