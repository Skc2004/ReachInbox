import express from "express";
import cors from "cors";
import crypto from "crypto";
import { z } from "zod";
import { pinoHttp } from "pino-http";
import { db } from "./db/index.js";
import { campaigns, emails, senders, tenants } from "./db/schema.js";
import { emailQueue } from "./queue.js";
import { logger } from "./logger.js";
import { env } from "./config.js";
import { runBootReconciler } from "./reconciler.js";
import { eq, inArray, and } from "drizzle-orm";
import nodemailer from "nodemailer";
import { setupElasticsearch, indexEmailsBulk, esClient } from "./es.js";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" })); // Large CSV payloads
app.use(cookieParser());
app.use(pinoHttp({ logger }));

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// ─── Dummy Auth Middleware ───────────────────────────────────────────────────
// ─── Real Auth Middleware ──────────────────────────────────────────────────────
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies.token;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    // @ts-ignore
    req.tenantId = payload.tenantId;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

app.use("/api/senders", requireAuth);
app.use("/api/campaigns", requireAuth);
app.use("/api/emails", requireAuth);

// ─── Auth Endpoints ──────────────────────────────────────────────────────────
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({ error: "Missing credential" });
    return;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error("Invalid token payload");
    }

    let tenant = await db.query.tenants.findFirst({
      where: eq(tenants.googleSub, payload.sub),
    });

    if (!tenant) {
      const [newTenant] = await db.insert(tenants).values({
        email: payload.email,
        googleSub: payload.sub,
      }).returning();
      tenant = newTenant;

      // Auto-create an ethereal sender so the user has something to use
      try {
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
      } catch (err) {
        logger.error(err, "Failed to auto-create ethereal sender");
      }
    }

    const token = jwt.sign({ tenantId: tenant.id, email: tenant.email }, env.JWT_SECRET, { expiresIn: "7d" });
    
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ id: tenant.id, email: tenant.email });
  } catch (err) {
    logger.error(err, "Google auth failed");
    res.status(401).json({ error: "Authentication failed" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  // @ts-ignore
  const tenantId = req.tenantId as string;
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) {
    res.status(401).json({ error: "Tenant not found" });
    return;
  }
  res.json({ id: tenant.id, email: tenant.email });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// ─── Health Endpoint ─────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ─── Senders Endpoints ───────────────────────────────────────────────────────
app.get("/api/senders", async (req, res) => {
  // @ts-ignore
  const tenantId = req.tenantId as string;
  const tenantSenders = await db.query.senders.findMany({
    where: eq(senders.tenantId, tenantId),
  });
  res.json(tenantSenders);
});

app.post("/api/senders/ethereal", async (req, res) => {
  // @ts-ignore
  const tenantId = req.tenantId as string;
  try {
    const testAccount = await nodemailer.createTestAccount();
    const [newSender] = await db
      .insert(senders)
      .values({
        tenantId,
        email: testAccount.user,
        smtpHost: testAccount.smtp.host,
        smtpPort: testAccount.smtp.port,
        smtpUser: testAccount.user,
        smtpPass: testAccount.pass,
        hourlyLimit: 100,
        minDelayMs: 2000,
      })
      .returning();
    res.json(newSender);
  } catch (err) {
    logger.error(err, "Failed to create Ethereal sender");
    res.status(500).json({ error: "Failed to create Ethereal sender" });
  }
});

// ─── Ingestion: Schedule Campaign ────────────────────────────────────────────

const scheduleSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1).max(env.MAX_RECIPIENTS_PER_CAMPAIGN),
  startAt: z.string().datetime().refine((val) => new Date(val) >= new Date(), {
    message: "startAt must be in the future",
  }),
  delayBetweenMs: z.number().min(0),
  hourlyLimit: z.number().min(1),
  senderIds: z.array(z.string().uuid()).min(1),
});

app.post("/api/campaigns/schedule", async (req, res) => {
  // @ts-ignore
  const tenantId = req.tenantId as string;
  
  const parseResult = scheduleSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const {
    subject,
    body,
    recipients,
    startAt,
    delayBetweenMs,
    hourlyLimit,
    senderIds,
  } = parseResult.data;

  // 1. Verify senders belong to the tenant
  const validSenders = await db.query.senders.findMany({
    where: and(
      eq(senders.tenantId, tenantId),
      inArray(senders.id, senderIds)
    ),
  });

  if (validSenders.length !== senderIds.length) {
    res.status(400).json({ error: "Invalid sender selection" });
    return;
  }

  // 2. Deduplicate recipients (lowercased)
  const uniqueRecipients = Array.from(
    new Set(recipients.map((email) => email.toLowerCase().trim()))
  );

  const startTime = new Date(startAt);

  // 3. Database Transaction: Insert Campaign + Emails
  let newCampaignId = "";
  const emailsToEnqueue: {
    id: string;
    idempotencyKey: string;
    scheduledAt: Date;
    senderId: string;
  }[] = [];

  try {
    await db.transaction(async (tx) => {
      // Create campaign
      const [newCampaign] = await tx
        .insert(campaigns)
        .values({
          tenantId,
          subject,
          body,
          startAt: startTime,
          delayBetweenMs,
          hourlyLimit,
          totalRecipients: uniqueRecipients.length,
        })
        .returning({ id: campaigns.id });
      
      newCampaignId = newCampaign!.id;

      // Prepare email records
      const newEmailRecords = uniqueRecipients.map((recipient, i) => {
        // Deterministic round-robin sender assignment (D4)
        // Sequence assigned after deduplication (D12)
        const sender = validSenders[i % validSenders.length]!;
        
        const scheduledTime = new Date(
          startTime.getTime() + i * delayBetweenMs
        );
        
        // sha256(campaign_id:recipient_email)
        const idempotencyKey = crypto
          .createHash("sha256")
          .update(`${newCampaignId}:${recipient}`)
          .digest("hex");

        return {
          campaignId: newCampaignId,
          tenantId,
          senderId: sender.id,
          recipientEmail: recipient,
          subject,
          body,
          scheduledAt: scheduledTime,
          status: "pending_enqueue" as const, // D2
          idempotencyKey,
          sequenceNo: i,
        };
      });

      // Bulk insert in chunks of 500 to respect Postgres limits
      for (let i = 0; i < newEmailRecords.length; i += 500) {
        const chunk = newEmailRecords.slice(i, i + 500);
        // ON CONFLICT DO NOTHING just in case, though we deduped in JS
        const inserted = await tx
          .insert(emails)
          .values(chunk)
          .onConflictDoNothing()
          .returning();
        
        emailsToEnqueue.push(...(inserted as any));
      }
    });
  } catch (err) {
    logger.error(err, "Transaction failed for schedule campaign");
    res.status(500).json({ error: "Failed to save campaign" });
    return;
  }

  // 4. Return 202 fast, enqueue asynchronously (D2)
  res.status(202).json({
    message: "Campaign accepted for scheduling",
    campaignId: newCampaignId!,
    totalRecipients: emailsToEnqueue.length,
  });

  // Sync with ES asynchronously (Phase 5)
  indexEmailsBulk(emailsToEnqueue).catch((err) =>
    logger.error(err, "Failed to async sync emails to ES")
  );

  // Background Outbox flush
  // We use chunks of 500 for BullMQ too
  (async () => {
    try {
      const now = Date.now();
      for (let i = 0; i < emailsToEnqueue.length; i += 500) {
        const chunk = emailsToEnqueue.slice(i, i + 500);
        
        await emailQueue.addBulk(
          chunk.map((e) => ({
            name: "send-email",
            data: {
              emailId: e.id,
              campaignId: newCampaignId,
              senderId: e.senderId,
              totalRecipients: uniqueRecipients.length,
            },
            opts: {
              jobId: e.idempotencyKey, // D3
              delay: Math.max(0, e.scheduledAt.getTime() - now),
            },
          }))
        );

        // Flip status to scheduled in Postgres
        await db
          .update(emails)
          .set({ status: "scheduled", updatedAt: new Date() })
          .where(
            inArray(
              emails.id,
              chunk.map((e) => e.id)
            )
          );
      }
      logger.info(`Successfully enqueued campaign ${newCampaignId}`);
    } catch (err) {
      // If this crashes midway, the boot reconciler will catch the remaining 'pending_enqueue' (D8)
      logger.error(err, `Background enqueue failed for campaign ${newCampaignId}`);
    }
  })();
});

// ─── Search Emails ───────────────────────────────────────────────────────────
app.get("/api/emails", async (req, res) => {
  // @ts-ignore
  const tenantId = req.tenantId as string;
  const { status, q, page = "1", limit = "10" } = req.query;
  
  const must: any[] = [{ term: { tenantId } }];
  
  if (status) {
    must.push({ term: { status } });
  }
  
  if (q) {
    must.push({
      multi_match: {
        query: q as string,
        fields: ["subject", "recipientEmail", "lastError"]
      }
    });
  }

  const from = (Number(page) - 1) * Number(limit);
  
  try {
    const result = await esClient.search({
      index: "emails",
      query: { bool: { must } },
      from,
      size: Number(limit),
      sort: [{ scheduledAt: "desc" }]
    });
    
    res.json({
      total: (result.hits.total as any).value,
      data: result.hits.hits.map(h => h._source)
    });
  } catch (err) {
    logger.error(err, "ES search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

// Start the server
const port = env.API_PORT;
app.listen(port, async () => {
  logger.info(`🚀 API Server running on port ${port}`);

  // Initialize Elasticsearch
  await setupElasticsearch();

  // Run the reconciler EXACTLY ONCE on boot
  try {
    await runBootReconciler();
  } catch (err) {
    logger.error(err, "Boot reconciler failed");
    // We don't crash the server, just log it. Stalled jobs will stay stuck until next restart.
  }
});
