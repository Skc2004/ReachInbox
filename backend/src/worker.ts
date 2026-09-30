import { Worker, Job, DelayedError } from "bullmq";
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { redisConnectionOptions, redis } from "./redis.js";
import { db } from "./db/index.js";
import { emails, campaigns, senders } from "./db/schema.js";
import { EMAIL_QUEUE } from "./queue.js";
import { logger } from "./logger.js";

// Rate Limiting Lua Script: Fixed Window
// Returns -1 if limited, otherwise returns the new count
const RATE_LIMIT_LUA = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local current = tonumber(redis.call("GET", key) or "0")
  if current >= limit then
    return -1
  else
    redis.call("INCR", key)
    redis.call("EXPIRE", key, 3600)
    return current + 1
  end
`;

// Pacing Lua Script: Slot Reservation
// Returns the delay in milliseconds required before sending.
const PACING_LUA = `
  local key = KEYS[1]
  local min_delay = tonumber(ARGV[1])
  local now = tonumber(ARGV[2])
  local last_sent = tonumber(redis.call("GET", key) or "0")
  
  local next_free = last_sent + min_delay
  
  if now < next_free then
    local delay = next_free - now
    -- TTL = delay + buffer (e.g. 5000ms)
    redis.call("SET", key, next_free, "PX", delay + 5000)
    return delay
  else
    redis.call("SET", key, now, "PX", 5000)
    return 0
  end
`;

// Define the lua scripts on the redis client
redis.defineCommand("checkRateLimit", {
  numberOfKeys: 1,
  lua: RATE_LIMIT_LUA,
});

redis.defineCommand("reservePacingSlot", {
  numberOfKeys: 1,
  lua: PACING_LUA,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const worker = new Worker(
  EMAIL_QUEUE,
  async (job: Job) => {
    const { emailId, campaignId, senderId } = job.data;

    if (!senderId) {
      await db
        .update(emails)
        .set({ status: "failed", lastError: "Missing senderId at processing time", updatedAt: new Date() })
        .where(eq(emails.id, emailId));
      throw new Error(`Missing senderId for email ${emailId}`);
    }

    // 1. Fetch relations
    const [email] = await db.query.emails.findMany({ where: eq(emails.id, emailId) });
    if (!email) throw new Error("Email not found");
    
    // Set to processing
    await db.update(emails).set({ status: "processing", updatedAt: new Date() }).where(eq(emails.id, emailId));

    const [campaign] = await db.query.campaigns.findMany({ where: eq(campaigns.id, campaignId) });
    const [sender] = await db.query.senders.findMany({ where: eq(senders.id, senderId) });

    if (!campaign || !sender) {
      throw new Error("Campaign or Sender missing");
    }

    // 2. Hourly Rate Limit Check
    // Effective limit = min(sender.hourly_limit, campaign.hourly_limit)
    const effectiveLimit = Math.min(sender.hourlyLimit, campaign.hourlyLimit);
    
    // Format hour epoch: YYYY-MM-DD-HH
    const now = new Date();
    const hourKey = `ratelimit:${sender.id}:${now.toISOString().slice(0, 13)}`;

    // @ts-ignore - custom commands
    const rlResult = await redis.checkRateLimit(hourKey, effectiveLimit);

    if (rlResult === -1) {
      logger.info(`Rate limit hit for sender ${sender.id}. Rescheduling to next hour.`);
      
      // Calculate delay until the start of the next hour
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1);
      nextHour.setMinutes(0, 0, 0);
      const delayToNextHour = nextHour.getTime() - now.getTime();

      // Increment rescheduled_count
      await db
        .update(emails)
        .set({
          status: "scheduled",
          rescheduledCount: (email.rescheduledCount || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(emails.id, emailId));

      // Use MoveToDelayed to push the job to the next window safely
      await job.moveToDelayed(Date.now() + delayToNextHour, job.token!);
      throw new DelayedError(); // Tells BullMQ to stop processing this job currently
    }

    // 3. Pacing Check
    const pacingKey = `pacing:${sender.id}`;
    // @ts-ignore
    const delayRequired = await redis.reservePacingSlot(pacingKey, sender.minDelayMs, Date.now());

    if (delayRequired > 10000) {
      // If delay > 10s, move to delayed queue instead of holding up the worker memory
      // We must DECR the rate limit since we aren't sending in this window right now, 
      // or we just accept it counts towards this hour's limit since it will send this hour.
      // But if it crosses an hour boundary, it gets complex. We will DECR to be safe.
      await redis.decr(hourKey);
      
      await db.update(emails).set({ status: "scheduled", updatedAt: new Date() }).where(eq(emails.id, emailId));
      logger.info(`Pacing delay is ${delayRequired}ms (>10s). Moving to delayed.`);
      await job.moveToDelayed(Date.now() + delayRequired, job.token!);
      throw new DelayedError();
    } else if (delayRequired > 0) {
      logger.debug(`Pacing requires sleep of ${delayRequired}ms`);
      await sleep(delayRequired);
    }

    // 4. Send Email via SMTP
    const transporter = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpPort === 465,
      auth: {
        user: sender.smtpUser,
        pass: sender.smtpPass,
      },
    });

    try {
      const info = await transporter.sendMail({
        from: sender.email,
        to: email.recipientEmail,
        subject: email.subject,
        text: email.body, // In reality, we'd render the HTML here
      });

      logger.info(`Email sent! MsgID: ${info.messageId}`);
      
      await db
        .update(emails)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(emails.id, emailId));
        
    } catch (err: any) {
      logger.error(err, `SMTP Send Failed for email ${emailId}`);
      
      // On failed SMTP send, DECR the rate-limit counter because the email didn't actually go out,
      // meaning it shouldn't consume the provider's quota.
      await redis.decr(hourKey);

      await db
        .update(emails)
        .set({ status: "failed", lastError: err.message, updatedAt: new Date() })
        .where(eq(emails.id, emailId));
      
      throw err; // Trigger BullMQ retry (exponential backoff will kick in)
    }
  },
  {
    connection: redisConnectionOptions,
    concurrency: 50,
  }
);

import { env } from "./config.js";
import { sql } from "drizzle-orm";

async function checkAndNotifyCompletion(job: Job) {
  const { campaignId, totalRecipients } = job.data;
  if (!campaignId || !totalRecipients) return;

  // Check how many emails for this campaign are in terminal states
  const result = await db.execute(
    sql`SELECT count(*) as c FROM emails WHERE campaign_id = ${campaignId} AND status IN ('sent', 'failed')`
  );
  const completedCount = parseInt(result.rows[0]?.c as string, 10) || 0;

  if (completedCount >= totalRecipients) {
    logger.info(`Campaign ${campaignId} completed! Firing Slack webhook...`);
    if (env.SLACK_WEBHOOK_URL) {
      try {
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🎉 *Campaign Completed* 🎉\nCampaign ID: \`${campaignId}\`\nTotal Recipients processed: ${completedCount}/${totalRecipients}`,
          }),
        });
        logger.info("Slack webhook sent.");
      } catch (err) {
        logger.error(err, "Failed to send Slack webhook");
      }
    }
  }
}

worker.on("completed", (job) => {
  logger.debug(`Job ${job.id} completed successfully.`);
  checkAndNotifyCompletion(job).catch((err) => logger.error(err));
});

worker.on("failed", (job, err) => {
  if (err.name !== "DelayedError") {
    logger.error(`Job ${job?.id} failed with error: ${err.message}`);
    // Check if it's the final attempt
    const maxAttempts = job?.opts?.attempts || 3;
    if (job && job.attemptsMade >= maxAttempts) {
      checkAndNotifyCompletion(job).catch((e) => logger.error(e));
    }
  }
});

logger.info("Worker started successfully! Listening for jobs...");
