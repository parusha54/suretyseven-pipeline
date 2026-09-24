# SuretySeven Document Processing Pipeline

SuretySeven is a document-processing MVP that turns a PDF upload into a trackable asynchronous job. It accepts and stores the file, avoids duplicate document records with a SHA-256 content hash, processes eligible documents with a single in-process worker, validates extracted fields, and records each status change so users can follow the result from the dashboard.

> **Scope:** The extractor is mocked, uploads use local disk, and the worker is not horizontally safe as-is. See [Current scope and limitations](#current-scope-and-limitations).

## Interface screenshots

### 1. Dashboard

![SuretySeven dashboard](./docs/screenshots/dashboard.png)

### 2. Upload document

![Upload document form](./docs/screenshots/upload-modal.png)

### 3. Document details and processing timeline

![Document details](./docs/screenshots/document-details.png)

The detail screenshot shows sample output from the mock processor; the application does not perform real OCR or AI extraction.

## Architecture

The diagram maps the browser, API, worker, local file storage, and PostgreSQL. The explanation is in [docs/architecture.md](./docs/architecture.md). The worker runs in the API process and its batch selection is not an atomic multi-process claim.

![SuretySeven system architecture](./docs/architecture.png)

The mock processor receives the file hash but does not read the PDF or derive its simulated output from that hash.

## Technology

| Area | Implementation |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, React Router, TanStack Query, Axios, Tailwind CSS |
| API | Node.js, Express, TypeScript, Multer |
| Processing | Single in-process polling worker; IDocumentProcessor strategy and mock implementation |
| Validation | Zod validates extracted fields before PROCESSED is saved |
| Persistence | PostgreSQL with Prisma ORM; Document and ProcessingHistory models |
| Local environment | Docker Compose database; local backend and frontend development servers |

## Repository map

| Path | Responsibility |
| --- | --- |
| frontend/src/App.tsx | React Query provider and routes for dashboard and document details |
| frontend/src/pages/Dashboard.tsx | Upload form, document table, filters, pagination, summary counts; list refreshes every 5 seconds |
| frontend/src/pages/DocumentDetails.tsx | Status, filename, extraction result, and timeline; refreshes details every 3 seconds while active |
| backend/src/index.ts | Express app, CORS, health endpoint, server startup; starts the worker with the API process |
| backend/src/routes/document.routes.ts | HTTP routes and Multer disk storage / file size configuration |
| backend/src/controllers/document.controller.ts | HTTP request/response handling for upload, list, detail, and history |
| backend/src/services/DocumentService.ts | Stream-based SHA-256, duplicate lookup, unique-key race handling, document/history creation |
| backend/src/worker.ts | Single-worker polling, sequential batches, status transitions, retries, stuck-document recovery |
| backend/src/services/ExtractionService.ts | IDocumentProcessor contract and randomized MockDocumentProcessor |
| backend/src/schema.ts | Zod schema for extracted company name, registration number, revenue, and date |
| backend/prisma/schema.prisma | PostgreSQL models, status enum, unique file hash, history relation, and status index |
| tests/ | Jest API, schema, and document-processing pipeline tests |
| docs/ | Architecture notes, diagram PNGs, interview notes, and interface screenshots |

## Diagrams

- [Architecture explanation and PNG](./docs/architecture.md)
- [Class diagram PNG](./docs/class_diagram.png)
- [Sequence diagram PNG](./docs/sequence_diagram.png)

## API overview

Document endpoints use the /documents prefix. The health check is at /health.

| Method and path | Purpose | Success response |
| --- | --- | --- |
| POST /documents | Upload multipart fields file (PDF) and documentType, plus optional metadata JSON | 201 for a new document; 200 with the existing ID for duplicate content |
| GET /documents?page=1&limit=10&status=...&documentType=...&search=... | Paginated dashboard list (limit 1–100) and global status counts | data, meta, and stats |
| GET /documents/:documentId | Detail response with filename, status, retry count, extracted result, and history | Document object |
| GET /documents/:documentId/history | Lifecycle history for a document | History event array |
| GET /health | Basic API liveness check | status: ok |

Statuses are UPLOADED, PROCESSING, PROCESSED, FAILED, and VALIDATION_FAILED. Transient failures can be retried up to three total attempts; schema-invalid output is terminal. A stale PROCESSING document is recovered after five minutes and recovery consumes an attempt.

## Run locally

You need Docker Desktop and Node.js/npm. PostgreSQL runs in Docker; the backend and frontend run locally with Node.js.

### Shared setup (do this for either launch method)

#### 1. Start PostgreSQL

Open a terminal at the repository root—the folder containing `docker-compose.yml`—and make sure Docker Desktop is running. Run:

```sh
docker compose up -d db
```

On the first run, Docker downloads the PostgreSQL image. Wait for the command to finish before continuing.

#### 2. Create `backend/.env`

This command creates the actual `backend/.env` file by copying the included example. Run it from the repository root. If `backend/.env` already exists, keep it and skip this command.

PowerShell:

```powershell
Copy-Item .\backend\.env.example .\backend\.env
```

macOS/Linux terminal (zsh or bash):

```sh
cp backend/.env.example backend/.env
```

The created file should contain this database setting, which is already in `.env.example`:

```ini
DATABASE_URL="postgresql://postgres:password@localhost:5432/suretyseven?schema=public"
```

### Choose one way to start the app

#### Option 1: Windows shortcut with `start.bat`

`start.bat` runs on Windows only. From the repository root in PowerShell, run:

```powershell
.\start.bat
```

It installs dependencies if either `node_modules` folder is missing, checks that PostgreSQL is ready, applies the Prisma schema, and opens backend and frontend terminal windows. It does **not** run tests. Open http://localhost:5173 when the frontend starts; the API runs at http://localhost:3000.

#### Option 2: Start manually

Use this option on macOS/Linux, or if you prefer to start each server yourself. The PostgreSQL and `backend/.env` steps above apply first.

**Terminal 1 — Backend (PowerShell):** Open the first terminal at the repository root and run:

```powershell
Set-Location .\backend
npm install
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/suretyseven?schema=public"
npx prisma db push
npm run dev
```

**Terminal 1 — Backend (macOS/Linux, zsh or bash):** Open the first terminal at the repository root and run:

```sh
cd backend
npm install
export DATABASE_URL="postgresql://postgres:password@localhost:5432/suretyseven?schema=public"
npx prisma db push
npm run dev
```

Leave Terminal 1 running; it hosts the API at http://localhost:3000 and runs the worker.

**Terminal 2 — Frontend (Windows, macOS, or Linux):** Open a second terminal at the repository root, then run:

PowerShell:

```powershell
Set-Location .\frontend
npm install
npm run dev
```

macOS/Linux terminal:

```sh
cd frontend
npm install
npm run dev
```

Leave Terminal 2 running and open http://localhost:5173. The frontend defaults to the API at http://localhost:3000. To use another browser-reachable API host, set `VITE_API_URL` in `frontend/.env.local` and restart Vite. Docker Compose starts PostgreSQL only; the backend and frontend run locally.

## Build and test

Build the backend and frontend from the repository root:

```sh
cd backend
npm run build
cd ../frontend
npm run build
```

To try the app manually, start it and upload a PDF in the browser. You do not need to run `npm test` for that. `npm test` runs the automated Jest test suite. The tests create two test document records, so use a dedicated database to keep them out of the demo dashboard. This separate test database is recommended for automated tests; it is not required to upload a PDF and try the app.

With PostgreSQL running, create the test database **once** from the repository root:

```sh
docker compose exec -T db psql -U postgres -c "CREATE DATABASE suretyseven_test;"
```

If PostgreSQL says `suretyseven_test` already exists, do not create it again. Open a new terminal at the repository root, then run these commands from `backend/`.

PowerShell:

```powershell
Set-Location .\backend
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/suretyseven_test?schema=public"
npx prisma db push
npm test
Remove-Item Env:DATABASE_URL
```

macOS/Linux terminal (zsh or bash):

```sh
cd backend
export DATABASE_URL="postgresql://postgres:password@localhost:5432/suretyseven_test?schema=public"
npx prisma db push
npm test
unset DATABASE_URL
```

The pipeline tests clear their tagged records before a run and leave two test document records in the test database. They remove their temporary local test file afterward.
## Design notes

- [Decision log](./docs/decision_log.md)
- [Engineering Q&A](./docs/engineering_qa.md)

## Current scope and limitations

- **Mock extraction:** MockDocumentProcessor generates randomized demo outcomes after a simulated delay. It does not parse PDF contents or call an external AI/OCR service.
- **Single worker only:** one worker loop runs inside each backend process. Selection and transition to PROCESSING are not an atomic claim across processes. Do not run multiple backend processes against the same queue. Before horizontal scaling, implement a transactional claim or use a dedicated queue, keep processor work outside the short claim transaction, and design for at-least-once delivery.
- **Local file storage:** uploads are written to local disk. Successful new uploads are retained and there is no retention/deletion policy. This is not shared storage for multiple backend instances.
- **PDF content verification:** uploads are checked for the application/pdf MIME type, but the server does not inspect the file signature or parse PDF contents. The mock processor does not need the PDF bytes.
- **Pagination bounds:** the list API requires positive integer pages, limits from 1 to 100, and a safe offset. Unsupported status and document-type filters return 400.
- **Metadata shape:** optional metadata must be valid JSON representing an object; malformed JSON and other JSON shapes return 400.
- **No authentication:** the API has no user authentication or authorization. CORS restricts browser origins; it is not an authorization boundary.

These are explicit MVP boundaries, not guarantees of a production-ready distributed pipeline.
