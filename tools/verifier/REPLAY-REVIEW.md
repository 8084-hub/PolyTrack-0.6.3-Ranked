# Suspicious Replay Review

Physics verification checks whether recorded controls can produce a finish.
It cannot prove that a person entered those controls in real time.

After a normal or Extra run passes verification, an optional local check compares
it with at most ten physics-verified references from the current public snapshot,
plus a bounded set of verified runs in the same batch. Same-batch near-time
comparisons cap at ten candidate runs per submission. This avoids an unbounded
pairwise scan. Matches require at least 95% exact transition agreement, at least
95% matching nontrivial control time, twenty transitions, and one second of
non-forward input activity. Own-account references and low-information runs are
ignored.

Each newly verified normal-queue slot also stores a server-derived SHA-256
signature of decoded control transitions, with its informativeness, replay,
time, account, track, engine, verifier, and verification-key bindings. Existing
queue reads supply a bounded set of these proofs to selected jobs, without an
additional Firestore query. Matching informative signatures at the exact same
time across distinct accounts are held for manual review. Historic slots that
pre-date this proof have no retroactive signature and cannot be detected this
way; no production queue backfill or historic reads are performed.

An exact-time match with identical transitions in all five control channels and
the above information threshold is held unverified for manual review. It is not
recorded as a cheating verdict, does not ban or penalize an account, and does not
automatically award the run. The hold does not retry automatically; a reviewer
must resolve the finding and arrange any needed queue action. This deliberately
avoids an automatic retry loop. Low-information identical runs are never held.
Within 10 ms, similar inputs create a manual-review finding only and do not
change verification status. Such comparisons require the native result's track,
replay hash, and corrected time to match the selected job; legacy time-correction
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
the original verification history and a `needsReview` flag for duplicate holds and
similarity matches.
`evidence` in the inbox includes similarity scores, the reference replay hash, its
snapshot rank, and the snapshot generation. Review manually; a flag is not proof
of cheating and does not revoke verification or RP. Event-only verification does
not perform this check. An event-only result may therefore be awarded before its
canonical run reaches the normal queue and is held there; this change does not
provide pre-award duplicate protection for event-only runs.

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
