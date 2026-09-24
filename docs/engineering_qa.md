# Engineering Design Q&A

### 1. Architectural Rationale

**Why Node.js, Express, React, and PostgreSQL?**
I chose a simple monolith for the assignment: a React and TypeScript dashboard, a Node.js and Express API, and PostgreSQL. The API mainly coordinates file uploads and database work, so Node's asynchronous I/O is a good fit. PostgreSQL gives me durable document and history records, unique constraints for duplicate detection, and transactions for related writes. The worker uses document status in PostgreSQL as a lightweight queue, which keeps this MVP simple to run. TypeScript catches many mistakes while I build; Zod checks processor data at runtime before it is saved.

### 2. Async Processing Mechanics

**How does the background worker function?**
The API process starts one worker loop. Every five seconds, it looks for up to five `UPLOADED` or retryable `FAILED` documents and processes them one at a time. It records `PROCESSING` and its history before calling the processor, then records the result. The next poll starts after the current batch finishes, so this loop does not overlap itself. The database read is not a safe claim across multiple backend processes. Before adding concurrent workers, I would claim rows and save their `PROCESSING` state in one short transaction, commit, and then call the processor.

### 3. Content-Based Duplicate Detection

**How does upload deduplication work?**
I identify an upload by its contents rather than its filename. The service streams the file through SHA-256, and PostgreSQL enforces a unique constraint on that hash. If the same bytes are uploaded again, the API returns the existing document. If two identical uploads arrive at once, the unique constraint resolves the race and the service reads the winning record. This prevents duplicate records; it does not prevent the worker from retrying a document. If a real processor performs external side effects, I would give those operations an idempotency key as well.

### 4. Retry Policy

**How do retries work?**
The worker retries transient processor failures up to three total attempts: the first attempt and at most two retries. Each transient failure moves the document to `FAILED`, increments `retryCount`, and adds a history event. Documents at the limit are no longer selected by the normal polling query. Validation failures and permanent processor errors become `VALIDATION_FAILED`, so the worker does not retry outcomes that are unlikely to improve with another attempt.

### 5. Crash Recovery & Resilience

**What happens if the application crashes during processing?**
The document can remain marked `PROCESSING` if the process stops mid-job. After restart, the worker's recovery sweep finds records that have been in that state for more than five minutes, changes them to `FAILED`, increments `retryCount`, and adds a history event. The normal polling loop then picks it up if attempts remain. Recovery uses the same three-attempt limit as transient failures. This makes the MVP recoverable after a process restart; with multiple workers, I would add an atomic claim or use a queue and make processor operations safe to repeat.

### 6. Scaling to 1 Million Documents / Day

**How would this architecture evolve at massive scale?**
One million documents per day is a hypothetical interview scenario; this MVP has not been load-tested at that volume. That averages roughly 12 documents per second, but real capacity depends on traffic peaks, file sizes, and processing time. I would measure those first rather than assume the database is already the bottleneck.

If the measurements called for independently scaling workers, I would consider AWS SQS. The API would save the document and an outbox row in one PostgreSQL transaction. A publisher would send unsent outbox rows to SQS, and separate workers would consume the messages. The outbox prevents a saved document from being forgotten if publishing is temporarily unavailable. SQS may deliver a message again, so processing must be safe to repeat; a configured dead-letter queue can hold messages that keep failing for investigation.

I would move retained PDFs to S3 and consider presigned upload URLs if sending file bytes through the API becomes a constraint. `IDocumentProcessor` gives the mock and a future OCR adapter a clear boundary. The real adapter would still need to retrieve the PDF and translate the provider's response into the application's result schema. I would keep the current UI polling unless measurements showed a need for server-sent events or WebSockets.

### 7. Current Scope and Next Steps

**What would you improve next, and why?**

I would take the next steps in response to product and workload needs. First, I would connect a real OCR or extraction provider through `IDocumentProcessor` and validate its output with the existing Zod schema. For multiple instances, I would atomically claim jobs or move delivery to SQS with an outbox, then make processing safe to repeat. I would move retained files from local disk to S3 before using ephemeral or multi-instance deployments. I would also add authentication and authorization before exposing documents to multiple users. The current API checks the declared PDF MIME type; checking the file signature and contents would strengthen upload validation. Five-second worker polling is a deliberate MVP trade-off, and I would consider event-driven UI updates only if measured user needs justified them.
