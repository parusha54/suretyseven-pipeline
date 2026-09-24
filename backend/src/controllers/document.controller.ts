import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { documentService } from '../services/DocumentService';
import fs from 'fs';
import { logger } from '../utils/logger';
import { z } from 'zod';

const prisma = new PrismaClient();

const DOCUMENT_TYPES = ['INVOICE', 'CONTRACT', 'FINANCIAL_STATEMENT', 'OTHER'] as const;
const DOCUMENT_STATUSES = ['UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED', 'VALIDATION_FAILED'] as const;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 2_147_483_647;

const MetadataSchema = z.record(z.unknown());

const parseOptionalMetadata = (input: unknown): { valid: true; value: Record<string, unknown> | null } | { valid: false } => {
  if (input === undefined || input === null || input === '') return { valid: true, value: null };

  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { valid: false };
    }
  }

  const parsed = MetadataSchema.safeParse(value);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : { valid: false };
};

const parsePositiveInteger = (input: unknown, defaultValue: number): number | null => {
  if (input === undefined) return defaultValue;
  if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input)) return null;

  const value = Number(input);
  return Number.isSafeInteger(value) ? value : null;
};

export const uploadDocument = async (req: Request, res: Response) => {
  let fileToCleanUp: string | null = null;

  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required.' });
    fileToCleanUp = file.path; // Track for cleanup

    if (file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF files are supported.' });
    }

    const documentType = req.body.documentType;
    if (typeof documentType !== 'string' || documentType.length === 0) {
      return res.status(400).json({ error: 'documentType is required.' });
    }

    if (!DOCUMENT_TYPES.includes(documentType as typeof DOCUMENT_TYPES[number])) {
      return res.status(400).json({
        error: `Unsupported documentType. Supported values: ${DOCUMENT_TYPES.join(', ')}.`,
      });
    }

    const metadataResult = parseOptionalMetadata(req.body.metadata);
    if (!metadataResult.valid) {
      return res.status(400).json({ error: 'metadata must be valid JSON representing an object.' });
    }
    const metadata = metadataResult.value;

    const { document, isDuplicate } = await documentService.handleDocumentUpload(
      file.path,
      file.originalname,
      documentType,
      metadata
    );

    if (isDuplicate) {
      // It's a duplicate, we don't need the new file
      return res.status(200).json({
        documentId: document.id,
        status: document.status,
        message: 'Duplicate document detected. Returning existing record.'
      });
    }

    // Success! Don't clean it up if you need it later, or do clean it up if extracted instantly.
    // In our architecture, the worker uses the fileHash, but doesn't actually need the physical file
    // because we use a mock AI. In a real system you'd keep it for S3 upload.
    // Let's keep it if successful so the user can view it later.
    fileToCleanUp = null;

    return res.status(201).json({ documentId: document.id, status: document.status });
  } catch (error: any) {
    logger.error('API Error during uploadDocument', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error.' });
  } finally {
    // SECURITY/STORAGE FIX: Delete orphaned file if the API crashed during upload
    if (fileToCleanUp && fs.existsSync(fileToCleanUp)) {
      try { fs.unlinkSync(fileToCleanUp); } catch (e: any) { logger.warn('Failed to clean up orphaned file (Potential disk leak)', { filePath: fileToCleanUp, error: e.message }); }
    }
  }
};

export const getDocumentStatus = async (req: Request, res: Response) => {
  try {
    const document = await documentService.getDocumentById(req.params.documentId);

    if (!document) return res.status(404).json({ error: 'Document not found' });

    return res.status(200).json({
      documentId: document.id,
      filename: document.filename,
      status: document.status,
      retryCount: document.retryCount,
      documentType: document.documentType,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      result: document.extractedData,
      history: document.history
    });
  } catch (error: any) {
    logger.error('API Error during getDocumentStatus', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

export const getDocumentHistory = async (req: Request, res: Response) => {
  try {
    const history = await documentService.getDocumentHistory(req.params.documentId);

    if (history.length === 0) {
      const doc = await documentService.getDocumentById(req.params.documentId);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
    }

    const formattedHistory = history.map(h => ({
      status: h.status,
      timestamp: h.createdAt,
      reason: h.reason || undefined
    }));

    return res.status(200).json(formattedHistory);
  } catch (error: any) {
    logger.error('API Error during getDocumentHistory', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

export const listDocuments = async (req: Request, res: Response) => {
  try {
    const { status, documentType, page = '1', limit = '10', search } = req.query;

    const pageNum = parsePositiveInteger(page, 1);
    const limitNum = parsePositiveInteger(limit, 10);

    if (pageNum === null) {
      return res.status(400).json({ error: 'page must be a positive safe integer within the supported range.' });
    }
    if (limitNum === null || limitNum > MAX_PAGE_SIZE) {
      return res.status(400).json({ error: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}.` });
    }
    if ((pageNum - 1) * limitNum > MAX_OFFSET) {
      return res.status(400).json({ error: 'page and limit produce an offset outside the supported range.' });
    }
    const statusFilter = status === '' ? undefined : status;
    const documentTypeFilter = documentType === '' ? undefined : documentType;

    if (statusFilter !== undefined && (typeof statusFilter !== 'string' || !DOCUMENT_STATUSES.includes(statusFilter as typeof DOCUMENT_STATUSES[number]))) {
      return res.status(400).json({ error: `Unsupported status. Supported values: ${DOCUMENT_STATUSES.join(', ')}.` });
    }
    if (documentTypeFilter !== undefined && (typeof documentTypeFilter !== 'string' || !DOCUMENT_TYPES.includes(documentTypeFilter as typeof DOCUMENT_TYPES[number]))) {
      return res.status(400).json({ error: `Unsupported documentType. Supported values: ${DOCUMENT_TYPES.join(', ')}.` });
    }
    if (search !== undefined && typeof search !== 'string') {
      return res.status(400).json({ error: 'search must be a single string.' });
    }

    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (statusFilter) where.status = statusFilter;
    if (documentTypeFilter) where.documentType = documentTypeFilter;
    if (search) where.filename = { contains: search as string, mode: 'insensitive' };

    const [total, documents, allProcessed, allFailed, allProcessing, allTotal] = await prisma.$transaction([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where, skip, take: limitNum, orderBy: { createdAt: 'desc' },
        select: { id: true, filename: true, documentType: true, status: true, createdAt: true, }
      }),
      prisma.document.count({ where: { status: 'PROCESSED' } }),
      prisma.document.count({ where: { status: { in: ['FAILED', 'VALIDATION_FAILED'] } } }),
      prisma.document.count({ where: { status: 'PROCESSING' } }),
      prisma.document.count()
    ]);

    return res.status(200).json({
      data: documents,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      stats: { total: allTotal, processed: allProcessed, failed: allFailed, processing: allProcessing }
    });
  } catch (error: any) {
    logger.error('API Error during listDocuments', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
