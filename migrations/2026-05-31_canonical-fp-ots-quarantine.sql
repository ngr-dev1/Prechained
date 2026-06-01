-- 2026-05-31 · Trust-model migration: canonical fingerprints + real OpenTimestamps
-- Run once against the Supabase Postgres database (SQL editor or psql).
-- It does NOT touch any row captured by the new pipeline (raw_metadata.fp = 'v2').
--
-- Background:
--   * Old captures hashed a synthetic payload that embedded `new Date()`, so the
--     stored SHA-384 can never be reproduced from the archived manifest. The new
--     verify.html re-hashes the manifest, so these rows would otherwise show a
--     false MISMATCH.
--   * The old anchor-checker stamped every row with the *current* Bitcoin block
--     height — a number that proves nothing. Those anchors are not real.
--
-- This migration quarantines those legacy rows and strips the fake anchor so the
-- UI can honestly label them "legacy pre-OTS record, not independently
-- verifiable" instead of MISMATCH. A real re-capture (canonical fingerprint +
-- genuine OTS proof) of these versions is a separate backfill, not done here.

begin;

-- 1. Flag every pre-OTS row (anything not marked canonical) as legacy.
update snapshots
set raw_metadata = coalesce(raw_metadata, '{}'::jsonb) || '{"legacy": true}'::jsonb
where coalesce(raw_metadata->>'fp', '') <> 'v2';

-- 2. Clear the fake Bitcoin anchor on those legacy rows. They were never really
--    anchored; the height was just whatever block was tip at capture time.
update snapshots
set btc_anchored = false,
    btc_block    = null
where coalesce(raw_metadata->>'fp', '') <> 'v2'
  and btc_anchored = true;

commit;

-- 3. (Optional, recommended) Speed up anchor-checker's two passes.
--    Pending proofs awaiting Bitcoin confirmation:
create index if not exists snapshots_pending_ots_idx
  on snapshots (btc_anchored)
  where ots_proof is not null and btc_anchored = false;

--    Canonical rows still needing a first stamp:
create index if not exists snapshots_unstamped_v2_idx
  on snapshots ((raw_metadata->>'fp'))
  where ots_proof is null;

-- Sanity checks (run manually after):
--   select count(*) from snapshots where raw_metadata->>'legacy' = 'true';   -- quarantined
--   select count(*) from snapshots where raw_metadata->>'fp' = 'v2';         -- new pipeline
--   select count(*) from snapshots where btc_anchored = true;                -- should be only real OTS upgrades
