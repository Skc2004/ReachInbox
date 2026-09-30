# ReachInbox Mass Scheduler

A massively concurrent, reliable email scheduling and pacing system, designed as a distributed task queue handling millions of emails with strict rate-limiting and slot-reservation.

## 🏗️ Architecture

- **Postgres (Single Source of Truth):** Stores all core entities (Campaigns, Emails, Senders, Tenants) securely.
- **BullMQ + Redis (Job Queue):** Enables massive concurrency and horizontal scaling of worker processes.
- **Redis Lua Scripts (Atomic Locks):** Implements atomic Fixed Window Rate Limiting and Slot Reservation (Pacing) directly in memory.
- **Elasticsearch (Derived State):** Asynchronously populated for extremely fast, aggregatable searches across large email logs.
- **Transactional Outbox Pattern:** Guarantees that API crashes never lose an email or duplicate an email job.

## 🛡️ Key Guarantees

1. **Strictly 1-Time Delivery:** Jobs use idempotency keys. Even if killed with `SIGKILL` mid-flight, the boot reconciler detects the orphan and re-enqueues it safely. Emails never get sent twice.
2. **Dynamic Cross-Worker Pacing:** If Campaign A mandates a 2000ms delay, and 10 workers pull jobs for Campaign A, the Redis Lua script ensures the exact milliseconds required to wait are respected across the distributed fleet.
3. **No Cron Dependencies:** Uses BullMQ's native delayed jobs + an on-boot cleanup reconciler. Zero repeatable crons used.

## 🚀 Getting Started

### 1. Start Infrastructure
Start Postgres, Redis, and Elasticsearch using Docker Compose:
```bash
docker compose up -d
```

### 2. Backend Setup
Navigate to the `backend` folder and run migrations/seeds:
```bash
cd backend
npm install
npm run db:generate
npm run db:migrate
npm run seed     # Sets up the tenant and 2 Ethereal SMTP senders
```

### 3. Start the System
You can start the API and Worker(s) in separate terminals:
```bash
# Terminal 1 - API
npm run api

# Terminal 2 - Worker 1
npm run worker

# Terminal 3 - Worker 2 (Scale out!)
npm run worker
```

### 4. Start the Frontend
Navigate to the `frontend` folder:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

## 🌪️ Chaos Testing

We designed the system to withstand abrupt crashes (e.g., node evictions or power failures).

1. Ensure the API is running (`npm run api`).
2. Run the Chaos Script:
   ```bash
   cd backend
   npm run chaos
   ```
3. Use the Frontend to schedule a massive campaign (e.g., 500 emails).
4. Watch the terminal as the `chaos` script continuously spawns a worker and abruptly executes a `SIGKILL` (kill -9) on it mid-execution. 
5. **Observe:** The worker goes down. Wait for the timeout to pass, or kill and restart the API server. The **Boot Reconciler** will instantly spot the stuck jobs in Postgres and automatically heal the state. Zero double-sends.

## 🔔 Slack Integration
To enable Slack alerts on campaign completion, add your Slack webhook URL to `backend/.env`:
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```
When a campaign finishes processing all of its recipients, a fast `SELECT COUNT` will verify completion and trigger a celebratory Slack message!
