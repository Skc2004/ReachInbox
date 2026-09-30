import { db, pool } from "./db/index.js";
import { tenants, senders } from "./db/schema.js";
import nodemailer from "nodemailer";
import { logger } from "./logger.js";
import { eq } from "drizzle-orm";

async function seed() {
  logger.info("Starting seed process...");

  // 1. Create or get test tenant
  const testGoogleSub = "seed_test_sub";
  let tenant = await db.query.tenants.findFirst({
    where: eq(tenants.googleSub, testGoogleSub),
  });

  if (!tenant) {
    const [newTenant] = await db
      .insert(tenants)
      .values({
        googleSub: testGoogleSub,
        email: "demo@reachinbox.test",
        name: "Demo User",
      })
      .returning();
    tenant = newTenant;
    logger.info(`Created demo tenant: ${tenant?.id}`);
  } else {
    logger.info(`Demo tenant already exists: ${tenant.id}`);
  }

  if (!tenant) {
    throw new Error("Failed to create or find tenant");
  }

  // 2. Create 3 Ethereal test accounts
  const existingSenders = await db.query.senders.findMany({
    where: eq(senders.tenantId, tenant.id),
  });

  if (existingSenders.length >= 3) {
    logger.info(`Tenant already has ${existingSenders.length} senders.`);
  } else {
    logger.info(`Creating ${3 - existingSenders.length} ethereal senders...`);
    const sendersToCreate = 3 - existingSenders.length;

    for (let i = 0; i < sendersToCreate; i++) {
      const testAccount = await nodemailer.createTestAccount();
      await db.insert(senders).values({
        tenantId: tenant.id,
        email: testAccount.user,
        smtpHost: testAccount.smtp.host,
        smtpPort: testAccount.smtp.port,
        smtpUser: testAccount.user,
        smtpPass: testAccount.pass,
        hourlyLimit: 100,
        minDelayMs: 2000,
      });
      logger.info(`Created ethereal sender: ${testAccount.user}`);
    }
  }

  logger.info("Seed process completed.");
  await pool.end();
}

seed().catch((err) => {
  logger.error(err, "Seed failed");
  process.exit(1);
});
