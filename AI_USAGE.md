# AI Usage & Collaboration

I used Google Gemini as a pair-programming assistant during development and review. I used it to explore implementation options, draft code and tests, and prepare diagrams and documentation. I reviewed the suggestions against the assignment requirements and the actual implementation, then adapted or rejected them where needed. The final design choices and verification are my responsibility.

### How AI supported the project:

1. **Scaffolding and UI:** AI helped draft parts of the Vite/React setup, Express route structure, and Tailwind layouts. I reviewed and connected these pieces to the upload and processing flow.
2. **Frontend formatting:** AI helped draft the logic that turns camelCase extraction keys into readable labels.
3. **Tests:** AI helped scaffold Jest and Supertest configuration and test cases. I reviewed the scenarios and used the test suite to verify the implementation.
4. **Diagrams and documentation:** AI helped turn my architecture and sequence descriptions into Mermaid diagrams and draft explanations. I checked names, relationships, and flow against the source before including them.

### Code Modifications & Engineering Decisions:

I used AI to discuss options, then checked the resulting decisions against the code and the MVP's scope:

- **Worker concurrency:** The MVP runs one sequential worker loop. Review showed that a standalone `FOR UPDATE SKIP LOCKED` query did not keep its row locks through the later status update, so it was not an atomic multi-worker claim. For concurrent workers, I would claim the row and set `PROCESSING` in one short transaction, commit, and then call the processor. If workload calls for independent worker scaling, a queue such as SQS with a transactional outbox is a clear next design step.
- **Duplicate uploads and retries:** The upload service streams the saved file through SHA-256, and the database unique constraint prevents duplicate document records for identical content. That is separate from retrying processing for a document. A real processor that performs external side effects should use an idempotency key for those operations.
- **Stream-based hashing:** The service uses `fs.ReadStream` instead of loading the whole PDF into a Buffer. The 10 MiB upload limit bounds each request; this is a practical MVP implementation, not a claim of tested large-file throughput.
- **Sequential batching:** The worker processes batches of up to five documents using a sequential `for...of` loop. This keeps the current worker's behavior straightforward. The mock processor simulates a delay and randomized success, transient failure, or invalid result; it does not read or extract PDF contents.
- **Terminal states:** Invalid processor output is stored as `VALIDATION_FAILED`, while transient failures use `FAILED` and the retry counter. This keeps validation outcomes separate from retryable failures.
- **Upload handling:** Multer applies a 10 MiB per-file limit, and CORS restricts browser origins. The controller's `finally` block removes files for rejected or duplicate uploads and handled request failures before a new document record takes ownership. Abrupt process or host failure calls for a separate stale-file cleanup policy. CORS controls browser access; it is not authentication.
- **Polling index:** The Prisma schema defines a B-Tree index on document status for the worker's recurring filter. PostgreSQL's planner and the workload determine its benefit, so I would measure query plans with representative data before making further indexing decisions.

### What I Learned and Discovered:

- **Polling for asynchronous status:** TanStack React Query provides cached polling for background job status. It fits the MVP's update needs without requiring a persistent WebSocket connection; I would revisit event-driven updates if measured product needs justified them.
- **Validating processor output:** Runtime validation is useful at internal boundaries as well as user-input boundaries. Zod checks the extracted fields and constraints, and the worker stores the parsed result only when it passes validation.
- **Using indexes with evidence:** A status index gives PostgreSQL an indexable path for the worker's recurring filter. The query plan and measured workload should guide whether the index helps and what to optimize next.
