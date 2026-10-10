# Suspicious Replay Review

Physics verification checks whether recorded controls can produce a finish.
It cannot prove that a person entered those controls in real time.

After a normal or Extra run passes verification, an optional local check compares
it with up to ten physics-verified runs from the current public snapshot.
Matches require at least 95% exact transition agreement, at least 95% matching
nontrivial control time, twenty transitions, and one second of nontrivial inputs.
Own replays and forward-only runs are ignored. Snapshot coverage may be incomplete
or outdated, so this is not a complete anti-TAS system.

In Firebase, open `0.6.2_s1_verification_audit` and filter `needsReview == true`.
`reviewEvidence` includes similarity scores, the reference replay hash, its
snapshot rank, and the snapshot generation. Review manually; a flag is not proof
of cheating and does not revoke verification or RP. Event-only verification does
not perform this check; an event's canonical run can be checked in the normal queue.

The check uses local snapshot files and the existing audit write. It adds no
Firebase reads or writes. Missing references never block verification. Reference
controls are retained only within the invocation, for at most sixteen tracks.

Browser keyword scans, console detection, and secret client-side checks are not
trusted evidence. Players can alter their browser and rename injected tools.
Do not automatically punish a player for developer tools or a word on the page.
