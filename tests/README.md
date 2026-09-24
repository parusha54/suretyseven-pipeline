# Test Suite

The backend uses Jest with `ts-jest` (configured in `backend/jest.config.js`). Run the suites from the backend directory:

```bash
npm test
```

The tests exercise API behavior, schema validation, content-hash duplicate detection, and retry-to-success / validation-failure processing paths. They use Prisma and write to the database in `DATABASE_URL`; point it to a dedicated test database. The pipeline suite removes previously tagged pipeline-test documents before creating its two demo records, and deletes its temporary local test file after the suite.
