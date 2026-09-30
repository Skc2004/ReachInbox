import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config.js";
import * as schema from "./schema.js";

// Create a pg pool
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  // A standard connection limit for a small to medium app
  max: 20,
});

// Create the Drizzle instance
export const db = drizzle(pool, { schema });

// Export the pool if raw queries are ever needed
export { pool };
