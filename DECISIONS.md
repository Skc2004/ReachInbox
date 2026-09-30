# =============================================================================
# ReachInbox Scheduler — Design Decisions
# =============================================================================
# Each entry records a design choice, why it was made, and the trade-off.

## D1: Postgres is the source of truth
Redis (BullMQ jobs, rate counters) and Elasticsearch (search index) are derived
state that can be rebuilt from Postgres at any time.
**Trade-off**: Slightly slower reads for search (ES) and queue state (Redis),
but crash-safe — we never lose data even if Redis or ES are wiped.

## D2: Transactional outbox pattern
Emails are inserted into Postgres with status `pending_enqueue` inside the same
transaction as the campaign. Only after the transaction commits do we enqueue
into BullMQ and flip status to `scheduled`.
**Trade-off**: Two-step process adds complexity, but guarantees DB and queue
never silently diverge. A crash between commit and enqueue is caught by the
boot-time reconciler.

## D3: Deterministic BullMQ jobIds from idempotency keys
`jobId = sha256(campaign_id + ":" + lowercase(recipient_email))`. BullMQ rejects
duplicate adds, and the worker's CLAIM query skips already-sent rows.
**Trade-off**: Cannot re-queue the same recipient in the same campaign (by
design — that's deduplication, not a limitation).

## D4: Simple round-robin sender assignment
`sender_id = senders[sequence_no % senders.length]` after deduplication, so
sequence numbers have no gaps.
**Trade-off**: Doesn't account for differing per-sender hourly limits. A
weighted approach would be fairer if senders have very different capacities, but
round-robin is deterministic and trivially explainable.

## D5: Fixed-window rate limiter via Lua
An atomic Lua script INCRs a per-sender-per-hour counter in Redis. If the count
exceeds the limit, it DECRs back and returns blocked.
**Trade-off**: Fixed windows allow a burst at window boundaries (up to 2×limit
across two adjacent windows). A sliding-window or token-bucket approach would be
smoother but adds significant complexity. For email pacing, fixed windows are
standard practice.

## D6: Effective hourly limit = min(sender, campaign)
The worker uses `Math.min(sender.hourly_limit, campaign.hourly_limit)` so both
per-sender and per-campaign caps are respected. The effective limit is passed in
the BullMQ job data for transparency.
**Trade-off**: The sender's counter is shared across campaigns, so a campaign
with a lower limit doesn't "save" capacity for other campaigns on the same sender.

## D7: Lua pacing with slot reservation
A Redis key `pace:{senderId}` holds the next free timestamp. Each job atomically
reserves `max(now, nextFree)` and sets `nextFree = reserved + minDelayMs`. The
key TTL is set to `(nextFree - now) + buffer` inside the Lua script.
If the reserved wait exceeds 10 seconds, the job uses `moveToDelayed` instead
of sleeping, freeing the worker for other jobs.
**Trade-off**: One Redis round-trip per send, but guarantees a true per-sender
minimum gap regardless of worker count or concurrency.

## D8: Boot-time reconciler, not periodic
Orphaned emails (`pending_enqueue` or `scheduled` without a BullMQ job) are
re-enqueued once at server startup. No cron, no interval.
**Trade-off**: Orphans are only caught on restart. In practice this is fine
because BullMQ's stalled-job checker handles mid-flight crashes, and orphans
only appear after a crash between DB commit and queue.addBulk().

## D9: Separate API and Worker entrypoints
`npm run api` and `npm run worker` are independent processes. `npm run dev`
runs both via concurrently. This allows the chaos test to kill only the worker
and proves that two worker instances respect the same Redis-backed hourly limit.
**Trade-off**: Slightly more operational complexity vs. a monolith, but better
fault isolation and more realistic for production.

## D10: AES-256-GCM for Slack webhook URLs
Webhooks are encrypted at rest with a key from env. Each ciphertext includes a
random IV and auth tag.
**Trade-off**: Key management burden (the env var must be kept safe), but
webhooks in plaintext in the DB is a security anti-pattern even for dev.

## D11: DECR rate-limit counter on failed SMTP send
If the SMTP send fails, we DECR the rate-limit counter so the failed attempt
doesn't "waste" a slot in the hourly window. The send never reached the
recipient's mail server, so it shouldn't count against the limit.
**Trade-off**: A tiny race window exists where another worker might have seen
the incremented counter and delayed itself unnecessarily. This is acceptable
because it's conservative (delays, never drops).

## D12: sequence_no assigned after deduplication
Recipients are deduplicated before sequence numbers are assigned, so there are
no gaps. This makes round-robin sender assignment and delay calculation
predictable: `scheduled_at = startAt + sequence_no * delayBetweenMs`.
**Trade-off**: Requires deduplication in application code before bulk insert,
rather than relying solely on ON CONFLICT DO NOTHING (which would leave gaps).

## D13: rescheduled_count tracks rate-limit reschedules
Each time an email is delayed to the next hour window due to a rate limit hit,
`rescheduled_count` is incremented. This provides observability into how often
rate limits are causing delays.
**Trade-off**: One extra DB write per reschedule, negligible cost.

## D14: Null sender_id at processing time → immediate failure
If a sender is deleted between scheduling and processing, the email is marked
`failed` with a clear error message rather than silently dropped or crashed.
**Trade-off**: The email is not retried with a different sender. Re-assigning
senders mid-flight would add significant complexity for an edge case.
