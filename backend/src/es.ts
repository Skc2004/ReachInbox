import { Client } from "@elastic/elasticsearch";
import { env } from "./config.js";
import { logger } from "./logger.js";

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
});

const INDEX_NAME = "emails";

export async function setupElasticsearch() {
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    if (!exists) {
      await esClient.indices.create({
        index: INDEX_NAME,
        mappings: {
          properties: {
            id: { type: "keyword" },
            campaignId: { type: "keyword" },
            tenantId: { type: "keyword" },
            senderId: { type: "keyword" },
            recipientEmail: { type: "keyword" },
            subject: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            lastError: { type: "text" },
          },
        },
      });
      logger.info(`Elasticsearch index '${INDEX_NAME}' created.`);
    }
  } catch (err) {
    logger.error(err, "Failed to setup Elasticsearch");
  }
}

export async function indexEmailsBulk(emails: any[]) {
  if (emails.length === 0) return;
  const operations = emails.flatMap((doc) => [
    { index: { _index: INDEX_NAME, _id: doc.id } },
    {
      id: doc.id,
      campaignId: doc.campaignId,
      tenantId: doc.tenantId,
      senderId: doc.senderId,
      recipientEmail: doc.recipientEmail,
      subject: doc.subject,
      status: doc.status,
      scheduledAt: doc.scheduledAt,
    },
  ]);
  
  try {
    await esClient.bulk({ refresh: true, operations });
  } catch (err) {
    logger.error(err, "Failed to bulk index emails in ES");
  }
}

export async function updateEmailStatusInES(id: string, updates: any) {
  try {
    await esClient.update({
      index: INDEX_NAME,
      id,
      doc: updates,
      doc_as_upsert: true,
    });
  } catch (err) {
    logger.error(err, `Failed to update email ${id} in ES`);
  }
}
