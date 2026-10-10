# Suspicious Replay Review

Physics verification checks whether recorded controls can produce a finish.
It cannot prove that a person entered those controls in real time.

After a normal or Extra run passes verification, an optional local check compares
it with up to ten physics-verified runs from the current public snapshot.
Matches require at least 95% exact transition agreement, at least 95% matching
nontrivial control time, twenty transitions, and one second of nontrivial inputs.
Own replays and forward-only runs are ignored. Snapshot coverage may be incomplete
or outdated, so this is not a complete anti-TAS system.

In Firebase, open `0.6.2_s1_review_inbox` and filter `status == open`.
This collection contains only findings, never ordinary verified runs. Set
`status` to `resolved` or `dismissed` after review, and optionally add `reviewNote`.
Retries do not overwrite existing findings or decisions. The full audit retains
the original verification history and a `needsReview` flag for similarity matches.
`evidence` in the inbox includes similarity scores, the reference replay hash, its
snapshot rank, and the snapshot generation. Review manually; a flag is not proof
of cheating and does not revoke verification or RP. Event-only verification does
not perform this check; an event's canonical run can be checked in the normal queue.

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
