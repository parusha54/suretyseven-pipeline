import { Prisma, PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';

const prisma = new PrismaClient();

export class DocumentService {
  /**
   * Handles the business logic for uploading a document.
   * Computes the hash via stream, checks for duplicates, and wraps DB creation in a transaction.
   */
  async handleDocumentUpload(filePath: string, filename: string, documentType: string, metadata: any) {
    // Memory Optimization: Compute hash via File Stream instead of holding the entire PDF in RAM
    const fileHash = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', err => reject(err));
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });

    // Idempotency: Check if duplicate exists
    const existingDoc = await prisma.document.findUnique({ where: { fileHash } });
    if (existingDoc) {
      return { document: existingDoc, isDuplicate: true };
    }

    // Persist new document and its history simultaneously
    try {
      const newDoc = await prisma.$transaction(async (tx) => {
        const doc = await tx.document.create({
          data: {
            filename,
            documentType,
            fileHash,
            metadata,
            status: 'UPLOADED',
          },
        });

        await tx.processingHistory.create({
          data: {
            documentId: doc.id,
            status: 'UPLOADED',
          },
        });

        return doc;
      });

      return { document: newDoc, isDuplicate: false };
    } catch (error) {
      // Another request may have inserted this hash after our initial lookup.
      // The unique constraint is the final authority for duplicate detection.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrentDuplicate = await prisma.document.findUnique({ where: { fileHash } });
        if (concurrentDuplicate) {
          return { document: concurrentDuplicate, isDuplicate: true };
        }
      }

      throw error;
    }
  }

  async getDocumentById(documentId: string) {
    return await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        history: { orderBy: { createdAt: 'asc' } }
      }
    });
  }

  async getDocumentHistory(documentId: string) {
    return await prisma.processingHistory.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
      select: { status: true, reason: true, createdAt: true }
    });
  }
}

export const documentService = new DocumentService();
