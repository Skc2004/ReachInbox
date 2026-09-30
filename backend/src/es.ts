import { Client } from "@elastic/elasticsearch";
import { env } from "./config.js";

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
});
