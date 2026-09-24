import { DocumentService } from '../backend/src/services/DocumentService';
import { DocumentWorker } from '../backend/src/worker';
import { IDocumentProcessor } from '../backend/src/services/ExtractionService';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const documentService = new DocumentService();
const testFilePath = path.join(__dirname, 'dummy-test-file.pdf');
const pipelineTestMarker = { testSuite: 'pipeline' };

beforeAll(async () => {
  // Keep only the documents created by the current pipeline test run in the dashboard.
  // The marker prevents deleting real uploads that happen to share the test filenames.
  await prisma.document.deleteMany({
    where: { metadata: { path: ['testSuite'], equals: 'pipeline' } },
  });

  // Ensure uploads directory exists for the test
  const uploadDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  // Create a dummy file to test streaming hash logic
  fs.writeFileSync(testFilePath, 'fake pdf content ' + Date.now()); // Unique content per test run
});

afterAll(async () => {
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  await prisma.$disconnect();
});

describe('Document Processing Pipeline Tests', () => {
  let uploadedDocId: string;
  let fileHashKey: string;

  it('1. Should successfully upload a valid document', async () => {
    const { document, isDuplicate } = await documentService.handleDocumentUpload(
      testFilePath,
      'dummy-test-file.pdf',
      'INVOICE',
      { ...pipelineTestMarker, test: true }
    );

    expect(document.status).toBe('UPLOADED');
    expect(document.documentType).toBe('INVOICE');
    expect(isDuplicate).toBe(false);

    uploadedDocId = document.id;
    fileHashKey = document.fileHash;
  });

  it('2. Should detect duplicate document uploads via file hashing', async () => {
    const { document, isDuplicate } = await documentService.handleDocumentUpload(
      testFilePath,
      'dummy-test-file.pdf',
      'INVOICE',
      {}
    );

    // It should return the exact same document ID and flag it as a duplicate
    expect(document.id).toBe(uploadedDocId);
    expect(isDuplicate).toBe(true);
  });

  it('3. Processor Failure & Retry-to-Success Pathway', async () => {
    // -------------------------------------------------------------
    // Create a Custom Mock AI that fails the FIRST time, but succeeds the SECOND time
    // -------------------------------------------------------------
    let attemptCount = 0;
    const flappyAiProcessor: IDocumentProcessor = {
      process: async (hash: string) => {
        attemptCount++;
        if (attemptCount === 1) {
          return { success: false, isTransient: true, error: 'Simulated Network Timeout' };
        }
        return {
          success: true,
          data: { companyName: 'Test Corp', registrationNumber: '123', address: 'New Delhi', annualRevenue: 500, documentDate: '2026-01-01', unexpectedField: 'must be stripped' }
        };
      }
    };

    // Instantiate worker with our custom test AI
    const testWorker = new DocumentWorker(flappyAiProcessor);

    // We hack the visibility of processDocument for testing purposes by casting to any
    // In a real environment we would test processNextBatch, but this allows targeted unit testing.

    // ATTEMPT 1: Should Transient Fail
    await (testWorker as any).processDocument(uploadedDocId, fileHashKey, 0);

    let dbDoc = await prisma.document.findUnique({ where: { id: uploadedDocId } });
    expect(dbDoc?.status).toBe('FAILED');
    expect(dbDoc?.retryCount).toBe(1);

    // ATTEMPT 2: Should Succeed
    await (testWorker as any).processDocument(uploadedDocId, fileHashKey, 1);

    dbDoc = await prisma.document.findUnique({ where: { id: uploadedDocId } });
    expect(dbDoc?.status).toBe('PROCESSED');
    expect(dbDoc?.retryCount).toBe(1); // Retry count stays at 1 since it succeeded
    expect(dbDoc?.extractedData).toBeDefined();
    expect(dbDoc?.extractedData).toMatchObject({ address: 'New Delhi' });
    expect(dbDoc?.extractedData).not.toHaveProperty('unexpectedField');

    // Verify Audit History was tracked
    const history = await prisma.processingHistory.findMany({
      where: { documentId: uploadedDocId },
      orderBy: { createdAt: 'asc' }
    });

    expect(history.map((h: any) => h.status)).toEqual(
      expect.arrayContaining(['PROCESSING', 'FAILED', 'PROCESSING', 'PROCESSED'])
    );
  });

  it('4. Processor Permanent Validation Failure Pathway', async () => {
    // Upload a new document for this test
    fs.writeFileSync(testFilePath, 'bad pdf content ' + Date.now());
    const { document } = await documentService.handleDocumentUpload(
      testFilePath,
      'bad.pdf',
      'OTHER',
      pipelineTestMarker
    );

    // Create an AI that hallucinates bad data (negative revenue)
    const hallucinatingAiProcessor: IDocumentProcessor = {
      process: async (hash: string) => {
        return {
          success: true,
          data: { companyName: 'Bad Corp', registrationNumber: '999', annualRevenue: -5000, documentDate: '2026-01-01' }
        };
      }
    };

    const testWorker = new DocumentWorker(hallucinatingAiProcessor);
    await (testWorker as any).processDocument(document.id, document.fileHash, 0);

    // It should instantly hit a terminal VALIDATION_FAILED state without retrying
    const dbDoc = await prisma.document.findUnique({ where: { id: document.id } });
    expect(dbDoc?.status).toBe('VALIDATION_FAILED');
    expect(dbDoc?.retryCount).toBe(0);
  });
});
