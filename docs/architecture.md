# System architecture

This diagram maps the main runtime components and shows how requests and stored data move between them.

![SuretySeven system architecture](./architecture.png)

The React browser sends upload and status requests to the Express API. Multer writes uploaded PDFs to local disk; `DocumentService` streams the saved file to calculate its SHA-256 hash and persists document metadata and history in PostgreSQL. A single worker loop runs in the backend process, calls the mock processor, validates returned data with Zod, and saves status transitions. The browser refreshes status through the API.

The diagram's “Uses file hash” label means the mock processor receives the hash as input. The current mock does not inspect the PDF or use the hash to determine its simulated output. The worker's batch selection is also not an atomic claim across multiple backend processes; this MVP runs one worker loop.

The connector numbers are reading cues across the upload, worker, and status-read paths, not one strictly chronological timeline. Use the end-to-end flow for the main document journey.

For the chronological user journey, see [the end-to-end flow](./end_to_end_flow.md). The implementation is in [DocumentService](../backend/src/services/DocumentService.ts), [DocumentWorker](../backend/src/worker.ts), and the [Prisma schema](../backend/prisma/schema.prisma).
