# Horizontal Scaling (DRAFT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This is a **draft** outline — no code yet. Treat each task as a brainstorming bracket; refine into a full plan before execution.

**Goal:** Scale beyond a single Node process by turning the platform into a fleet of stateless API/orchestrator nodes coordinated through a job queue. The single-machine bottleneck (worker_threads on one box) is removed; new capacity is added by spinning up another container.

**Architecture (target):** API tier behind a load balancer; orchestrator tier consuming a Redis-backed job queue (BullMQ); worker tier as separate processes (or pods) pulling page-tasks from the queue. PostgreSQL remains the authoritative store for tasks, results, and run metadata. Redis carries the queue + ephemeral pub/sub for SSE fan-out across API replicas.

**Tech Stack (proposed):** BullMQ, Redis 7+, Docker / Kubernetes (or systemd + nginx for bare-metal), existing PG + Node stack.

> **Prerequisites:** *Browser Context Pool*, *DB Pool Sizing + Write Batching*, and *Orchestrator Persistence Offload* all merged. Without them, horizontal scaling magnifies the existing single-box bottlenecks.

---

## File Structure (anticipated, not final)

**Likely new modules:**
- `src/infrastructure/queue/` — BullMQ producer/consumer wrappers (`PageTaskQueue`, `RunLifecycleQueue`)
- `src/infrastructure/queue/RedisClient.ts` — shared ioredis client factory
- `src/infrastructure/pubsub/SsePubSub.ts` — Redis pub/sub bridge for SSE events across API replicas
- `src/workers/page-task-worker/` — standalone worker entrypoint (replaces `node:worker_threads` ExtractorWorker/TraverserWorker for distributed mode)
- `infra/` — Dockerfiles and k8s/compose manifests for api, orchestrator, worker
- `design-log/NNN-horizontal-scaling.md`

**Likely modified:**
- `src/application/orchestrator/ParserOrchestrator.ts` — `dispatchTask` enqueues into BullMQ instead of `worker.postMessage`; in-process `worker_threads` path kept behind a feature flag for dev
- `src/application/services/ParserRunnerService.ts` — `activeRuns` map becomes a Redis-backed leadership lease (only one orchestrator instance owns a given run at a time)
- `src/api/server.ts` — SSE emitters subscribe to a Redis channel; health endpoint reflects queue depth
- `src/infrastructure/db/client.ts` — pool size tuned per replica (e.g., `DB_POOL_MAX=20` × 8 replicas = 160 total)

---

### Task 1: Adopt Redis + BullMQ

**Scope:** introduce Redis as infrastructure and BullMQ as the task queue library. Establish a single shared `RedisClient` factory; build a thin `PageTaskQueue` abstraction (enqueue, consume, ack, retry) on top of BullMQ so the rest of the code is queue-vendor-agnostic.

**Open questions:**
- Single Redis or Redis Cluster? Start single until queue throughput pushes >10k jobs/sec.
- Job payload size cap — `PageTask` is small (UUIDs + URL + parent_data JSON); should comfortably fit under BullMQ's default limits, but `parent_data` from large traverser results needs auditing.
- Retry policy in BullMQ vs. the existing `RetryConfig` on `PageTask` — pick one source of truth (recommendation: keep retries in our domain, use BullMQ retries only for transport-level failures with `attempts: 1` BullMQ-side).

**Deliverables:**
- Reusable `PageTaskQueue.enqueue(task)` / `.consume(handler)` API
- Health endpoint surfaces `waiting`, `active`, `delayed`, `failed` counters from BullMQ
- Docker-compose dev stack with Redis added

---

### Task 2: Move workers to separate processes

**Scope:** the existing `ExtractorWorker.ts` and `TraverserWorker.ts` live inside `node:worker_threads` of the orchestrator process. For horizontal scaling they must become standalone Node processes that pull from BullMQ.

**Open questions:**
- Keep the worker_threads path as a "local mode" toggle (`SCRAPER_MODE=local|distributed`) so single-machine development stays cheap?
- How do workers receive parser code? Two options:
  1. Workers read the parser definition from DB on startup keyed by `(parserName, stepName)` — simple but every code edit forces a worker restart (or a code-version field in the DB).
  2. Workers receive a `stepCodeRef` (DB row id + version) per job and lazy-cache the compiled `AsyncFunction` — slightly more complex but supports zero-downtime parser edits.
  Recommendation: start with (1) and iterate.
- Browser context pool stays *per worker process*. With `contextPoolSize=20` and 8 worker processes per host, the box runs one chromium with ~20 contexts × 8 = 160 active pages — well within RAM budget on a 32 GB machine.

**Deliverables:**
- `src/workers/page-task-worker/index.ts` standalone entrypoint
- Worker reads `WorkerData`-equivalent from the BullMQ job payload
- Dockerfile.worker; k8s `Deployment` with horizontal pod autoscaler keyed on `bullmq_waiting` metric
- Existing worker message protocol (`LINKS_DISCOVERED`, `DATA_EXTRACTED`, `PAGE_SUCCESS`, `PAGE_FAILED`, `LOG`) becomes BullMQ job results / events instead of `parentPort.postMessage` — but message *shape* stays identical so consumers don't change

---

### Task 3: Orchestrator becomes a stateless coordinator

**Scope:** the `ParserOrchestrator` loses its `Map<StepName, Worker>` and instead enqueues jobs onto `PageTaskQueue`. Worker results arrive via a BullMQ events stream, which the orchestrator subscribes to and routes into the existing `handleWorkerMessage` switch.

**Open questions:**
- Only one orchestrator instance must own a given `runId` at a time (otherwise `LINKS_DISCOVERED` duplicates fire). Use a Redis lease (e.g., `SET orch-lease:<runId> <nodeId> NX EX 30`) refreshed every 10s; on lease loss, the orchestrator gracefully releases the run and another node picks it up.
- Where does the dispatch queue live? With state in DB (via `DbTaskStateStore`) the orchestrator no longer holds a mutable in-memory queue — instead the queue *is* BullMQ. `concurrentQuota` becomes per-parser group concurrency (BullMQ supports group-based rate limits).
- Failure path: orchestrator crashes mid-run. Another orchestrator picks up the lease and resumes from DB state (this is exactly the *Orchestrator Persistence Offload* design — that plan unblocks this one).

**Deliverables:**
- Lease service in `src/infrastructure/lease/` with TTL refresh
- `ParserOrchestrator.dispatch(task)` → `await queue.enqueue(task)`
- Bullmq events consumer translates `completed` / `failed` events into orchestrator state mutations through `TaskStateStore`

---

### Task 4: Redis-backed SSE fan-out

**Scope:** SSE today is in-process. With multiple API replicas, a client connected to replica A must see events emitted by an orchestrator on replica B.

**Open questions:**
- Redis pub/sub vs Redis Streams: pub/sub is simpler and good enough for "live tail" semantics (we don't need replay). Streams would be needed if we promise event durability — we don't.
- Event volume: stats updates can be heavy on big runs (one per task transition). Throttle stats events to 1/sec per run before publishing to Redis, just like the UI currently does on the receiving side.
- Channel naming: one channel per run (`run-events:<runId>`) so API replicas only subscribe to channels for which they have connected clients.

**Deliverables:**
- `SsePubSub.publish(runId, event)` + `subscribe(runId, handler)`
- API SSE handler swaps `runnerService.on('stats', …)` direct wiring for a Redis subscription on first client connect, unsubscribe on last disconnect

---

### Task 5: Load balancer + multiple API instances

**Scope:** make the API tier horizontally replicable. With SSE moved to Redis pub/sub (Task 4) and orchestration moved to leased ownership (Task 3), the API becomes truly stateless.

**Open questions:**
- Sticky sessions needed? With SSE on Redis, no — a client can reconnect to any replica and resume the same `run-events:<runId>` channel.
- Long-lived SSE connections: ensure the LB has a high idle timeout (e.g., 600s on nginx `proxy_read_timeout`); send keep-alive comments every 15s server-side.
- File downloads (`/api/parsers/:name/files/:file`) currently read from local disk. With multiple API replicas this breaks unless output is on shared storage (S3 / NFS). Likely change: orchestrator uploads CSV/JSON output to object storage at end of run; API redirects downloads to a signed URL.

**Deliverables:**
- nginx (or k8s `Ingress`) config example committed under `infra/`
- Output writer swappable: local filesystem (dev) vs. S3 (prod) via env flag
- Health endpoint differentiates "process up" from "ready to accept SSE" (depends on Redis reachable)

---

### Task 6: Operational concerns

**Scope:** the operations that matter once you're running 8+ pods.

**Topics:**
- **Metrics:** Prometheus exporter for `bullmq_waiting`, `bullmq_active`, `pg_pool_size_used`, `chromium_processes_total`. Grafana dashboards for the dev team.
- **Tracing:** OpenTelemetry around `dispatchTask` → BullMQ job → worker handler so a single page fault is debuggable across processes.
- **Backpressure:** BullMQ `rateLimiter` per parser group so one greedy parser can't starve others.
- **Cost controls:** auto-scale workers down to zero between runs to save compute.
- **Disaster recovery:** documented runbook for "Redis is gone": Bull queue is rebuilt from PG (`pending` and `retry` tasks re-enqueued by a cron); SSE clients reconnect.

**Deliverables:**
- `docs/operations/runbook.md`
- Prometheus scrape config and a starter Grafana dashboard JSON
- Smoke load test (k6 / Artillery) script under `infra/loadtest/`

---

### Task 7: Migration path

**Scope:** roll out without downtime.

**Phased plan:**
1. Ship `SCRAPER_MODE=local` (default) — existing single-process behavior, BullMQ classes installed but unused.
2. Stand up Redis + a single worker pod in staging; switch staging to `SCRAPER_MODE=distributed`. Verify parity (same parser, same input, same output rows).
3. Add a second worker pod; verify stable scaling.
4. Add a second API replica behind LB; verify SSE works.
5. Cut production to `distributed`. Keep `local` mode supported for local dev and CI.

**Open questions:**
- Schema changes? Likely none — tasks already have `runId`, `state`, `attempts`. May want a small `worker_id` column on `run_tasks` for forensics (which worker handled which task), but optional.
- Backward compatibility for parser definitions: none broken; parser code in DB stays the source of truth.

---

### Task 8: Document in design-log

- One `NNN-horizontal-scaling.md` entry capturing the final architecture (after Tasks 1-7 are detailed and at least the BullMQ adoption has shipped).
- Cross-link the three prerequisite logs (Browser Context Pool, DB Pool Sizing, Orchestrator Persistence Offload) so the dependency chain is explicit.

---

### Out of scope for this draft

- Specific BullMQ APIs and version pins (settle when Task 1 is detailed)
- Exact k8s manifests (depends on hosting choice — EKS vs. GKE vs. bare-metal)
- Multi-region replication (deferred until single-region scaling is proven)
- Browser-tier autoscaling on RAM pressure (depends on observed production metrics)
