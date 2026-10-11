# Suspicious Replay Review

Physics verification checks whether recorded controls can produce a finish.
It cannot prove that a person entered those controls in real time.

After a normal or Extra run passes verification, an optional local check compares
it with at most ten physics-verified references from the current public snapshot,
plus a bounded set of verified runs in the same batch. Same-batch near-time
comparisons cap at ten candidate runs per submission. This avoids an unbounded
pairwise scan. Advisory matches require at least 95% exact transition agreement,
at least 95% matching nontrivial control time, twenty transitions, and one second
of non-forward input activity. Low-information runs are ignored.

Each newly verified normal-queue slot also stores a server-derived SHA-256
signature of decoded control transitions, with its informativeness, replay,
time, account, track, engine, verifier, and verification-key bindings. Existing
queue reads supply a bounded set of these proofs to selected jobs, without an
additional Firestore query. Historic slots that pre-date this proof have no
retroactive signature and cannot be detected this way; no production queue
backfill or historic reads are performed.

An exact duplicate requires the same track, exact same finish time, identical
transitions in all five control channels, at least twenty transitions, and at
least one second of non-forward input activity. It is returned as a rejected
`mismatch` with reason `exact_duplicate_run`; it is not an unavailable/manual
hold, cheating verdict, account ban, or account-wide penalty. For same-batch
duplicates, the earliest trusted server ingestion/receipt timestamp wins, with
the result ID as a deterministic fallback tie-breaker. The remaining exact
duplicates from other accounts are denied; same-account repetitions and
same-account historical references are ignored. Existing verified snapshot
references are trusted winners. Low-information identical runs are never denied.
Within 10 ms, non-exact similar inputs remain advisory and do not change
verification status. Such comparisons require the native result's track, replay
hash, and corrected time to match the selected job; legacy time-correction
candidates are excluded until reverified at their corrected time. A gap by itself
is not evidence.

Reference coverage is intentionally incomplete: snapshots may be stale, only the
ten fastest qualifying snapshot entries are loaded, and same-batch near-time
comparisons are capped. A match outside those references will not be discovered.
This is a bounded review aid, not exhaustive duplicate detection or a complete
anti-TAS system.

In Firebase, open `0.6.2_s1_review_inbox` and filter `status == open`.
This collection contains only findings, never ordinary verified runs. Set
`status` to `resolved` or `dismissed` after review, and optionally add `reviewNote`.
Retries do not overwrite existing findings or decisions. The full audit retains
the original verification history and a `needsReview` flag for exact duplicate
findings and advisory similarity matches. That flag is not an account sanction
and does not change the exact-duplicate rejection reason.
`evidence` in the inbox includes similarity scores, the reference replay hash, its
snapshot rank, and the snapshot generation. Review manually; a flag is not proof
of cheating. Event-only verification runs the same bounded local snapshot and
same-batch comparisons after native verification but before event publication.
The callback only reviews results whose binding matches the leased event run,
trusted period track, exact time, and replay hash; Kodub results must also match
the period's trusted track-content hash. Exact duplicates are denied before
event RP is awarded. Event near-match evidence is not persisted by the event
result schema, so those comparisons remain non-actionable hints. Event review adds
no Firestore reads and does not create an account ban. Low-information patterns
remain eligible for ordinary verification.

The check uses local snapshot files and the existing audit write. Ordinary runs
add no Firebase operations. A flagged run adds one inbox read and, if absent, one
inbox write in the existing atomic commit. Missing references never block verification. Reference
controls are retained only within the invocation, for at most sixteen tracks.

Browser keyword scans, console detection, and secret client-side checks are not
trusted evidence. Players can alter their browser and rename injected tools.
Do not automatically punish a player for developer tools or a word on the page.

For a private, bounded inbox report, run `review-report.mjs` with the same private
service-account environment variable as diagnostics and `--html=<private path>`.
It reads at most fifty findings by default, not the full audit. `--status=all`,
`--status=resolved`, and `--status=dismissed` select other views. `--after=<cursor>`
loads the next page; `--limit` is capped at one hundred. No automatic polling or
public endpoint is added. The existing default-deny rules protect this collection.

`--backfill` copies at most twenty-five similarity flags and twenty-five mismatches
from existing audits using two indexed queries. It does not scan normal runs,
delete audits, alter verdicts, or overwrite decisions. A full page means additional
historical findings may remain; it is not a complete historical migration.
