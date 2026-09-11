CREATE TABLE IF NOT EXISTS void_cloud_state (key text PRIMARY KEY, document jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS void_cloud_ledger (workspace text NOT NULL, seq integer NOT NULL, entry jsonb NOT NULL, PRIMARY KEY(workspace,seq));
CREATE OR REPLACE FUNCTION void_cloud_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'VOID ledger is append only'; END $$;
DROP TRIGGER IF EXISTS void_cloud_immutable ON void_cloud_ledger;
CREATE TRIGGER void_cloud_immutable BEFORE UPDATE OR DELETE ON void_cloud_ledger FOR EACH ROW EXECUTE FUNCTION void_cloud_immutable();
