import { PrismaClient } from '@prisma/client';
import { IDocumentProcessor, MockDocumentProcessor } from './services/ExtractionService';
import { ExtractedDataSchema } from './schema';
import { logger } from './utils/logger';

const prisma = new PrismaClient();

export class DocumentWorker {
  private processor: IDocumentProcessor;
  private isRunning = false;

  /**
   * SOLID: Dependency Injection
   * The worker accepts any processor that implements IDocumentProcessor.
   * This means we can swap MockDocumentProcessor for RealAiProcessor later without modifying this class.
   */
  constructor(processor: IDocumentProcessor) {
    this.processor = processor;
  }

  /**
   * Starts the worker polling loop.
   * Uses recursive setTimeout instead of setInterval to guarantee that
   * a slow processing batch doesn't cause overlapping executions.
   */
  public start(intervalMs: number = 5000) {
    console.log(`[Worker] Started polling every ${intervalMs}ms...`);
    this.isRunning = true;

    const loop = async () => {
      if (!this.isRunning) return;
      try {
        await this.processNextBatch();
      } catch (error) {
        console.error('[Worker] Critical Loop Error:', error);
      } finally {
        setTimeout(loop, intervalMs);
      }
    };

    loop();
  }

  public stop() {
    this.isRunning = false;
    console.log('[Worker] Stopped.');
  }

  private async recoverStuckDocuments() {
    // If a document has been stuck in 'PROCESSING' for over 5 minutes, assume the worker crashed.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    try {
      const stuckDocs = await prisma.document.findMany({
        where: { status: 'PROCESSING', updatedAt: { lt: fiveMinutesAgo } }
      });

      if (stuckDocs.length > 0) {
        for (const doc of stuckDocs) {
          // Recheck staleness and update status, retry count, and history atomically.
          // This bounds crash recovery to the same three total attempts as normal failures.
          const recovered = await prisma.$transaction(async (tx) => {
            const update = await tx.document.updateMany({
              where: {
                id: doc.id,
                status: 'PROCESSING',
                updatedAt: { lt: fiveMinutesAgo },
              },
              data: {
                status: 'FAILED',
                retryCount: { increment: 1 },
              },
            });

            if (update.count === 0) return false;

            await tx.processingHistory.create({
              data: {
                documentId: doc.id,
                status: 'FAILED',
                reason: 'RECOVERED_FROM_STUCK_PROCESSING_STATE',
              },
            });
            return true;
          });

          if (recovered) {
            logger.warn('Recovered stuck zombie document', {
              documentId: doc.id,
              attempt: doc.retryCount + 1,
              retryLimit: 3,
            });
          }
        }
      }
    } catch (err) {
      logger.error('Failed to run stuck document recovery sweep', { error: err });
    }
  }

  private async processNextBatch() {
    // 1. Sweep for any zombie documents from a previous server crash
    await this.recoverStuckDocuments();

    // This MVP runs one worker loop. Recursive setTimeout prevents overlapping
    // batches in this process; this read is not an atomic multi-worker claim.
    // If concurrent workers are added, select and transition rows in one transaction.
    const pendingDocs = await prisma.document.findMany({
      where: {
        status: { in: ['UPLOADED', 'FAILED'] },
        retryCount: { lt: 3 },
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { id: true, retryCount: true, fileHash: true },
    });

    if (!pendingDocs || pendingDocs.length === 0) return;

    for (const doc of pendingDocs) {
      await this.processDocument(doc.id, doc.fileHash, doc.retryCount);
    }
  }

  private async processDocument(documentId: string, fileHash: string, currentRetries: number) {
    try {
      // 1. Mark the document as PROCESSING (single-worker MVP)
      await prisma.$transaction(async (tx) => {
        await tx.document.update({
          where: { id: documentId },
          data: { status: 'PROCESSING' }
        });
        await tx.processingHistory.create({
          data: { documentId, status: 'PROCESSING' }
        });
      });

      console.log(`[Worker] Processing Document: ${documentId}`);

      // 2. Execute the Strategy (Mock AI)
      const result = await this.processor.process(fileHash);

      // 3. Handle Resolution & Validation
      await prisma.$transaction(async (tx) => {
        if (result.success) {
          // STRICT VALIDATION RULE: Validate the AI output using Zod
          const validation = ExtractedDataSchema.safeParse(result.data);

          if (!validation.success) {
            // PERMANENT FAILURE: Validation Failed. Transition to distinct terminal state.
            const errorDetails = validation.error.errors.map(e => e.message).join(', ');
            await tx.document.update({
              where: { id: documentId },
              data: { status: 'VALIDATION_FAILED' } // No longer hacking the retry count
            });
            await tx.processingHistory.create({
              data: { documentId, status: 'VALIDATION_FAILED', reason: `VALIDATION_ERROR: ${errorDetails}` }
            });
            logger.error('Document validation failed', { documentId, attempt: currentRetries + 1, status: 'VALIDATION_FAILED', reason: errorDetails });
          } else {
            // TRUE SUCCESS
            await tx.document.update({
              where: { id: documentId },
              data: { status: 'PROCESSED', extractedData: validation.data }
            });
            await tx.processingHistory.create({
              data: { documentId, status: 'PROCESSED' }
            });
            logger.info('Document processed successfully', { documentId, attempt: currentRetries + 1, status: 'PROCESSED' });
          }
        } else {
          // ERROR HANDLING
          if (result.isTransient) {
            // TRANSIENT ERROR: Increment retry count
            await tx.document.update({
              where: { id: documentId },
              data: { status: 'FAILED', retryCount: currentRetries + 1 }
            });
            await tx.processingHistory.create({
              data: { documentId, status: 'FAILED', reason: result.error || 'UNKNOWN_TRANSIENT_ERROR' }
            });
            logger.warn('Document processing failed (Transient)', { documentId, attempt: currentRetries + 1, status: 'FAILED', reason: result.error });
          } else {
            // PERMANENT ERROR: e.g., Unrecoverable AI failure
            await tx.document.update({
              where: { id: documentId },
              data: { status: 'VALIDATION_FAILED' }
            });
            await tx.processingHistory.create({
              data: { documentId, status: 'VALIDATION_FAILED', reason: result.error || 'PERMANENT_ERROR' }
            });
            logger.error('Document processing failed (Permanent)', { documentId, attempt: currentRetries + 1, status: 'VALIDATION_FAILED', reason: result.error });
          }
        }
      });
    } catch (error: any) {
      // Unexpected System Failure Path (e.g., DB crash during save)
      logger.error('Unexpected system error during processing', { documentId, attempt: currentRetries + 1, status: 'FAILED', reason: error.message });
      try {
        await prisma.document.update({
          where: { id: documentId },
          data: { status: 'FAILED', retryCount: currentRetries + 1 }
        });
        await prisma.processingHistory.create({
          data: { documentId, status: 'FAILED', reason: 'UNEXPECTED_SYSTEM_ERROR' }
        });
      } catch (fallbackError) {
        logger.error('CRITICAL: Could not update failure state in DB', { documentId });
      }
    }
  }
}

// Instantiate and start the worker with our Mock processor (unless in test environment)
if (process.env.NODE_ENV !== 'test') {
  const worker = new DocumentWorker(new MockDocumentProcessor());
  worker.start();
}
