import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  pgEnum,
  index,
  char,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const emailStatusEnum = pgEnum("email_status", [
  "pending_enqueue", // Saved in DB, not yet in BullMQ
  "scheduled", // Enqueued in BullMQ as a delayed job
  "processing", // Worker has claimed this email
  "sent", // Successfully sent via SMTP
  "failed", // All retries exhausted
]);

// ─── Tenants ─────────────────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  googleSub: varchar("google_sub", { length: 255 }).unique().notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  avatarUrl: text("avatar_url"),
  // Encrypted with AES-256-GCM; key from env ENCRYPTION_KEY
  slackWebhookUrlEncrypted: text("slack_webhook_url_encrypted"),
  slackTeamName: varchar("slack_team_name", { length: 255 }),
  slackConnectedAt: timestamp("slack_connected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Senders ─────────────────────────────────────────────────────────────────
// Multiple Ethereal accounts per tenant for parallel sending.

export const senders = pgTable("senders", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  smtpHost: varchar("smtp_host", { length: 255 }).notNull(),
  smtpPort: integer("smtp_port").notNull(),
  smtpUser: varchar("smtp_user", { length: 255 }).notNull(),
  // Plaintext is acceptable for Ethereal-only test accounts (see DECISIONS.md)
  smtpPass: varchar("smtp_pass", { length: 255 }).notNull(),
  hourlyLimit: integer("hourly_limit").notNull().default(100),
  minDelayMs: integer("min_delay_ms").notNull().default(2000),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Campaigns ───────────────────────────────────────────────────────────────

export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id, { onDelete: "cascade" })
    .notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  delayBetweenMs: integer("delay_between_ms").notNull(),
  hourlyLimit: integer("hourly_limit").notNull(),
  totalRecipients: integer("total_recipients").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Emails ──────────────────────────────────────────────────────────────────
// Each row = one email to one recipient in one campaign.
// idempotency_key = sha256(campaign_id + ":" + lowercase(recipient_email))

export const emails = pgTable(
  "emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id, { onDelete: "cascade" })
      .notNull(),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    // SET NULL if sender is deleted; worker marks email failed (D14)
    senderId: uuid("sender_id").references(() => senders.id, {
      onDelete: "set null",
    }),
    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    body: text("body").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: emailStatusEnum("status").notNull().default("pending_enqueue"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    etherealPreviewUrl: text("ethereal_preview_url"),
    // sha256 hex digest — deterministic, used as BullMQ jobId too
    idempotencyKey: char("idempotency_key", { length: 64 }).unique().notNull(),
    // Assigned after deduplication so there are no gaps (D12)
    sequenceNo: integer("sequence_no").notNull(),
    // Incremented each time a rate-limit reschedule happens (D13)
    rescheduledCount: integer("rescheduled_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Hot path: the reconciler and dashboards query by status + time
    index("idx_emails_status_scheduled").on(table.status, table.scheduledAt),
    // Dashboard: filter by tenant and status
    index("idx_emails_tenant_status").on(table.tenantId, table.status),
    // Campaign detail views
    index("idx_emails_campaign").on(table.campaignId),
  ],
);

// ─── Type exports for use across the codebase ────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type EmailStatus = Email["status"];
