# Active Leaderboard Read Policy

Activated on 2026-10-22 after 13 isolated Firebase emulator checks. The attached deployment record was verified through the Rules management API. Exactly four public leaderboard read permissions changed; all other production rules are byte-identical to the September 25 baseline.

This is NOT the older, broader backend-only-public.rules candidate. It does not close direct profile/PB reads or submissions, legacy aggregate writes, or event archive reads. Worker origin, revision, and IP limiters do not cover direct Firebase SDK calls. App Check or a separately tested Worker-only write migration is still needed. Do not describe this as a complete domain lock.

No credentials or tokens are included. The previous Ruleset remains available for rollback.
