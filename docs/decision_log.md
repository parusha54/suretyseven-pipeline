# Architectural Decision Records (ADR) & Decision Log

This document tracks all significant architectural decisions, our reasoning, and the trade-offs considered during the development of the SuretySeven Document Processing Pipeline.

---

### Decision 1: Backend Framework & Tech Stack

**Date:** 2026-09-12
**Decision:** Node.js, Express, TypeScript, Zod, Prisma ORM, and PostgreSQL.
**Reasoning:**
For this MVP, Node.js and Express provide an asynchronous API for uploads and database work. TypeScript adds compile-time checks, while Zod validates processor output at runtime. PostgreSQL provides durable document and history records and can support the polling queue without another service. Multi-worker row claiming is not implemented in this version.
**Trade-offs:**

- _Pro:_ Node's asynchronous I/O fits the upload and database coordination in this MVP; TypeScript is used in both frontend and backend to provide compile-time checks.
- _Con (and Mitigation):_ If real extraction becomes CPU/GPU-heavy or needs a specialized ML stack, I would run that work in a separate processor service. `IDocumentProcessor` gives the worker a useful boundary, while a real integration would still need work to provide the file and map the processor's result.

### Decision 2: Duplicate Document Handling Strategy

**Date:** 2026-09-12
**Decision:** Compute a SHA-256 hash of the uploaded file and store it in PostgreSQL with a `UNIQUE` constraint.
**Reasoning:**
A client-provided idempotency key is unreliable if the user forgets to send it or sends it incorrectly across multiple devices. Filename + size is too brittle (two different files can have the same name and size). A SHA-256 content hash with a database `UNIQUE` constraint prevents duplicate document records for identical file contents and lets the API return the existing document. Worker retries may still invoke processing again for that record; idempotency for processor side effects is a separate concern for a real integration.
_(Note: See Decision 8 for how we memory-optimized the hashing process)._

### Decision 3: Background Worker Architecture (Database Polling)

**Date:** 2026-09-12
**Decision:** PostgreSQL Database-Backed Queue (Polling)
**Reasoning:**
We implemented a continuous background worker loop that polls PostgreSQL every 5 seconds for `UPLOADED` and retryable `FAILED` documents. For this MVP, using document status as the work queue keeps the architecture self-contained and avoids operating a separate broker. As volume or latency requirements grow, we would measure the polling query and database load. If independent worker scaling becomes necessary, AWS SQS is a concrete next step: a transactional outbox can safely publish accepted jobs, and workers can consume them independently of the API.
**Trade-offs:**

- _Pro:_ The document status itself is the work item, so the upload transaction persists the document and its initial history without a separate broker publish. This keeps the MVP infrastructure small. If a broker is added later, an outbox or equivalent handoff can keep database writes and queue publishing consistent.
- _Con:_ Polling adds recurring database reads and up to one polling interval of pickup delay. If measured workload makes that costly, a managed queue such as AWS SQS can let the worker fleet scale independently.

### Decision 4: Service Layer & Processor Boundary

**Date:** 2026-09-12
**Decision:** Upload and document business logic lives in `DocumentService`, and the worker calls extraction through the `IDocumentProcessor` interface.
**Reasoning:**
This keeps HTTP handling, document operations, and extraction responsibilities distinct. The interface gives a future processor an existing boundary to implement and keeps the worker's polling flow separate from extraction details. A real OCR provider may need an adapter to retrieve the PDF and translate the provider's output. `DocumentService` also keeps upload, hashing, and database work outside the HTTP controller.

### Decision 5: Handling Permanent Errors (Terminal Database States)

**Date:** 2026-09-12
**Decision:** We introduced a distinct terminal state (`VALIDATION_FAILED`) in the database Enum, rather than artificially inflating the `retryCount` to bypass the queue.
**Reasoning:**
When the processor returns invalid data or a permanent error, another attempt is unlikely to help. A separate `VALIDATION_FAILED` terminal state keeps these outcomes distinct from transient failures and leaves `retryCount` useful for understanding retry behavior. The worker's polling query selects `UPLOADED` and retryable `FAILED` documents, so terminal validation failures are naturally excluded.
**Trade-offs:**

- _Pro:_ Keeps retry counts meaningful and makes the state machine easy to interpret.
- _Con:_ Requires slightly more boilerplate to manage extra enum states across the backend and frontend.

### Decision 6: Single-Worker MVP Queue Polling

**Date:** 2026-09-12
**Decision:** The MVP uses one background worker loop that polls PostgreSQL for pending documents. The loop processes batches sequentially and schedules the next batch only after the current one finishes.
**Reasoning:**
This keeps the assignment implementation small and avoids adding a message broker. The current single-process worker does not overlap its own batches. The earlier standalone `FOR UPDATE SKIP LOCKED` query did not keep its row locks through the subsequent status update, so it did not provide a multi-worker claim guarantee and has been removed. Before running concurrent workers, selection and transition to `PROCESSING` should happen atomically in a short transaction. The processor call should happen after commit so slow work does not hold database locks. Even then, crash recovery means processing is at-least-once; a real side-effecting processor would need an idempotency key.
**Trade-offs:**

- _Pro:_ Simple to operate for the expected single-instance MVP and sufficient for the assignment's asynchronous workflow.
- _Con:_ The current polling read is not safe for multiple worker processes. A transactional claim or dedicated queue is needed before horizontal worker scaling.

### Decision 7: AI Output Validation Boundary (Zod)

**Date:** 2026-09-12
**Decision:** We treat processor output as untrusted data, passing it through the Zod schema before transitioning the document to `PROCESSED`.
**Reasoning:**
AI models (and mock processors) can return unexpected values or data types. The worker validates the processor result against the fields and constraints in the Zod schema, then persists the parsed result so downstream code receives that defined shape. Unknown keys are stripped by Zod's object schema; the schema should evolve alongside the processor contract and persistence model.
**Trade-offs:**

- _Pro:_ Keeps persisted extraction data aligned with the fields and constraints defined by the schema.
- _Con:_ Requires maintaining a Zod schema alongside the Prisma schema.

### Decision 8: File Storage & Stream-Based Hashing (Memory Optimization)

**Date:** 2026-09-13
**Decision:** We use `multer.diskStorage()` and Node.js `fs.ReadStream` for hashing, rather than loading file buffers into memory.
**Reasoning:**
The service streams the saved file through SHA-256 instead of first loading the whole file into a Buffer. This keeps hashing memory use tied to the stream buffer rather than the full file size; the 10 MiB upload limit also bounds each request. Local storage is convenient for this MVP and can be persisted with an appropriate volume, while shared or ephemeral deployments would need durable object storage such as S3.
**Trade-offs:**

- _Pro:_ Avoids buffering the full upload in application memory during hash calculation.
- _Con:_ Local files are not shared across backend instances and may not survive ephemeral deployments; a production deployment would need a durable shared storage option.

### Decision 9: Frontend State Management (TanStack React Query)

**Date:** 2026-09-13
**Decision:** We use TanStack React Query for remote server state and polling; React `useState` remains for local interface state such as filters and modal visibility.
**Reasoning:**
Because the background worker processes documents asynchronously, the frontend polls the API to reflect status changes. TanStack Query manages the request cache, loading/error state, and polling intervals (5 seconds for the dashboard and 3 seconds while a detail is active), while local controls remain component state. This avoids hand-written timer and cache coordination for server data.
**Trade-offs:**

- _Pro:_ React Query manages server-data caching and polling, so the pages do not need to implement their own timer and cache behavior.
- _Con:_ Adds a third-party dependency to the frontend bundle.

### Decision 10: Upload Limits & Temporary File Cleanup

**Date:** 2026-09-13
**Decision:** Applied a 10 MiB `fileSize` limit to Multer and implemented a `finally` cleanup block in the Express controller.
**Reasoning:**
The 10 MiB per-file limit bounds the size of an individual upload. The controller's `finally` block removes the local file when validation rejects the request, the upload is a duplicate, or request handling fails before the new document takes ownership of it. This covers normal returns and handled errors; an abrupt process or host failure would need a separate stale-file cleanup policy.

### Decision 11: Database Indexing for Polling Performance

**Date:** 2026-09-13
**Decision:** Added a B-Tree index (`@@index([status])`) to the Document model in Prisma.
**Reasoning:**
The background worker polls the database every 5 seconds for `UPLOADED` or retryable `FAILED` documents. The status index gives PostgreSQL an indexable path for this recurring filter and can reduce the rows it needs to examine as the table grows. The query planner's choice and the performance benefit depend on data distribution and workload, so a larger deployment should confirm them with representative query plans and measurements.

### Decision 12: Fault Tolerance & Zombie Document Recovery

**Date:** 2026-09-13
**Decision:** Implemented a `recoverStuckDocuments` sweep in the worker.
**Reasoning:**
If the Node.js server stops while a document is in the `PROCESSING` state, the record can remain there after restart. The worker periodically checks for documents in that state for more than 5 minutes and moves them to `FAILED`, increments the retry count, and records the recovery. Documents with retries remaining can re-enter the normal polling flow; exhausted documents remain `FAILED`.

### Decision 13: Sequential Batch Processing

**Date:** 2026-09-15
**Decision:** The background worker processes its batch of 5 documents sequentially (via a `for...of` loop) rather than concurrently (via `Promise.all`).
**Reasoning:**
While `Promise.all` could process the batch faster, sequential processing keeps the MVP's concurrency and resource use simple. It trades throughput for simpler behavior. If throughput needs grow, first add a transactional job claim and bounded worker concurrency; do not assume the current polling query makes multiple worker nodes safe.
