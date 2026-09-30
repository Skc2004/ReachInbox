import Redis from "ioredis";
import { env } from "./config.js";

/**
 * BullMQ requires connections to have maxRetriesPerRequest: null.
 * We export a shared connection instance and a factory for creating new ones.
 */
export const redisConnectionOptions = {
  maxRetriesPerRequest: null,
};

// Create a shared default connection
export const redis = new Redis(env.REDIS_URL, redisConnectionOptions);

// Expose a factory if a component needs its own connection (e.g. BullMQ worker blocking connections)
export function createRedisConnection() {
  return new Redis(env.REDIS_URL, redisConnectionOptions);
}
