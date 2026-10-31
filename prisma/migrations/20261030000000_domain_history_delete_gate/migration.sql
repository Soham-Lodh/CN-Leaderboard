-- Domain delete feature: the append-only guards on ScoreEntry and
-- AuditEvent stay fully in force for every normal code path. The only
-- sanctioned exception is the domain-delete transaction documented in
-- lib/services/domains.ts, which sets the transaction-scoped GUC below
-- right before its history-touching statements.
-- SET LOCAL binds the value to the current transaction: it can never
-- leak across connections, is cleared at COMMIT/ROLLBACK and cannot be
-- set by another session. No table, column or constraint is changed.

CREATE OR REPLACE FUNCTION prohibit_history_mutation() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('app.history_delete_bypass', true), '') = 'DOMAIN_DELETE' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% is append-only; use compensating entries instead.', TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;
