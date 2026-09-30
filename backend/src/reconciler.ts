import { db } from "./db/index.js";
import { emails } from "./db/schema.js";
import { emailQueue } from "./queue.js";
import { logger } from "./logger.js";
import { eq, or, inArray, lt, and } from "drizzle-orm";
import { env } from "./config.js";

/**
 * Boot-time reconciler. Runs exactly ONCE on server start.
 * 
 * 1. Finds orphaned emails ('pending_enqueue' or 'scheduled' but missing in BullMQ).
 *    This happens if the server crashes between a DB commit and queue.addBulk().
 * 2. Resets stale 'processing' emails back to 'scheduled'.
 *    This happens if a worker is hard-killed (SIGKILL) while processing a job and
 *    the BullMQ stalled-job checker hasn't caught it yet, or the DB status didn't sync.
 */
export async function runBootReconciler() {
  logger.info("Starting boot-time reconciler...");

  let reconciledOrphans = 0;
  let resetProcessing = 0;

  // 1. Find potential orphans (limit to active statuses)
  // In a massive dataset, this might need pagination, but for our scale,
  // we can fetch them. We only care about jobs in the future or recently missed.
  const activeEmails = await db.query.emails.findMany({
    where: or(
      eq(emails.status, "pending_enqueue"),
      eq(emails.status, "scheduled")
    ),
    columns: {
      id: true,
      idempotencyKey: true,
      scheduledAt: true,
      campaignId: true,
      senderId: true,
    },
  });

  const orphansToReEnqueue: typeof activeEmails = [];

  // Check BullMQ for existence. We batch getJob calls for efficiency.
  for (let i = 0; i < activeEmails.length; i += 100) {
    const batch = activeEmails.slice(i, i + 100);
    const jobs = await Promise.all(
      batch.map((e) => emailQueue.getJob(e.idempotencyKey))
    );
    for (let j = 0; j < batch.length; j++) {
      if (!jobs[j]) {
        orphansToReEnqueue.push(batch[j]!);
      }
    }
  }

  // Re-enqueue orphans in batches
  for (let i = 0; i < orphansToReEnqueue.length; i += 500) {
    const batch = orphansToReEnqueue.slice(i, i + 500);
    const now = Date.now();
    
    await emailQueue.addBulk(
      batch.map((e) => ({
        name: "send-email",
        data: {
          emailId: e.id,
          campaignId: e.campaignId,
          senderId: e.senderId,
        },
        opts: {
          jobId: e.idempotencyKey,
          delay: Math.max(0, e.scheduledAt.getTime() - now),
        },
      }))
    );

    await db
      .update(emails)
      .set({ status: "scheduled", updatedAt: new Date() })
      .where(
        inArray(
          emails.id,
          batch.map((e) => e.id)
        )
      );

    reconciledOrphans += batch.length;
  }

  // 2. Reset stale 'processing' rows
  const staleThreshold = new Date(Date.now() - env.STALE_PROCESSING_THRESHOLD_MS);
  
  const staleResult = await db
    .update(emails)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(
      and(
        eq(emails.status, "processing"),
        lt(emails.updatedAt, staleThreshold)
      )
    );

  // In Drizzle for postgres, rowCount is available if we use the underlying result
  // But wait, the standard update returns the pg result
  resetProcessing = staleResult.rowCount ?? 0;

  logger.info(
    `Reconciler finished: enqueued ${reconciledOrphans} orphans, reset ${resetProcessing} stale processing rows.`
  );
}
