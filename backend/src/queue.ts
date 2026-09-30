import { Queue } from "bullmq";
import { redisConnectionOptions } from "./redis.js";

// The queue name
export const EMAIL_QUEUE = "email-jobs";

// Create the shared BullMQ queue instance
export const emailQueue = new Queue(EMAIL_QUEUE, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    // Exponential backoff for retries
    backoff: {
      type: "exponential",
      delay: 5000, // 5s, 10s, 20s, etc.
    },
    attempts: 3,
    removeOnComplete: true, // Don't bloat Redis with completed jobs
    removeOnFail: false, // Keep failed jobs for inspection
  },
});
