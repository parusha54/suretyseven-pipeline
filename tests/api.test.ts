import request from 'supertest';
import { app } from '../backend/src/index';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const testFilePath = path.join(__dirname, 'api-dummy.pdf');

beforeAll(async () => {
  const uploadDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(testFilePath, 'dummy API pdf content ' + Date.now());
});

afterAll(async () => {
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  await prisma.$disconnect();
});

describe('API Integration Tests (Express Endpoints)', () => {

  describe('POST /documents (Upload)', () => {
    it('Should reject uploads missing the file', async () => {
      const res = await request(app)
        .post('/documents')
        .field('documentType', 'INVOICE');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('File is required');
    });

    it('Should reject non-PDF files', async () => {
      const txtPath = path.join(__dirname, 'test.txt');
      fs.writeFileSync(txtPath, 'text content');

      const res = await request(app)
        .post('/documents')
        .field('documentType', 'INVOICE')
        .attach('file', txtPath);

      fs.unlinkSync(txtPath);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Only PDF files');
    });

    it('Should reject uploads missing documentType', async () => {
      const res = await request(app)
        .post('/documents')
        .attach('file', testFilePath);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('documentType is required');
    });

    it('Should reject unsupported document types', async () => {
      const res = await request(app)
        .post('/documents')
        .field('documentType', 'UNSUPPORTED')
        .attach('file', testFilePath, { contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unsupported documentType');
      expect(res.body.error).toContain('INVOICE');
    });

    it('Should reject malformed metadata instead of silently discarding it', async () => {
      const res = await request(app)
        .post('/documents')
        .field('documentType', 'INVOICE')
        .field('metadata', '{invalid json')
        .attach('file', testFilePath, { contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('metadata must be valid JSON');
    });

    it('Should reject metadata that is valid JSON but not an object', async () => {
      const res = await request(app)
        .post('/documents')
        .field('documentType', 'INVOICE')
        .field('metadata', '[]')
        .attach('file', testFilePath, { contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('metadata must be valid JSON');
    });
  });

  describe('GET /documents (Retrieval & Filtering)', () => {
    it('Should paginate results correctly', async () => {
      const res = await request(app).get('/documents?page=1&limit=2');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta.page).toBe(1);
    });

    it('Should treat empty dashboard filters as unset', async () => {
      const res = await request(app).get('/documents?status=&documentType=&search=');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('Should reject malformed or out-of-range pagination parameters', async () => {
      for (const query of ['page=abc', 'page=1abc', 'page=0', 'page=1.5', 'limit=0', 'limit=101', 'limit=2x']) {
        const res = await request(app).get(`/documents?${query}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toBeTruthy();
      }
    });

    it('Should reject unsupported status and document type filters', async () => {
      const invalidStatus = await request(app).get('/documents?status=NOT_A_STATUS');
      expect(invalidStatus.status).toBe(400);
      expect(invalidStatus.body.error).toContain('Unsupported status');

      const invalidType = await request(app).get('/documents?documentType=NOT_A_TYPE');
      expect(invalidType.status).toBe(400);
      expect(invalidType.body.error).toContain('Unsupported documentType');
    });

    it('Should filter by status', async () => {
      const res = await request(app).get('/documents?status=UPLOADED');
      expect(res.status).toBe(200);
      res.body.data.forEach((doc: any) => {
        expect(doc.status).toBe('UPLOADED');
      });
    });

    it('Should return 404 for a non-existent document ID', async () => {
      const res = await request(app).get('/documents/invalid-uuid-1234');
      expect(res.status).toBe(404);
    });
  });
});
