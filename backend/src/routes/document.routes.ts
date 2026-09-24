import { Router } from 'express';
import multer from 'multer';
import {
  uploadDocument,
  getDocumentStatus,
  getDocumentHistory,
  listDocuments
} from '../controllers/document.controller';

import fs from 'fs';
import path from 'path';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }
 });


// Routes
router.post('/', upload.single('file'), uploadDocument);
router.get('/', listDocuments);
router.get('/:documentId', getDocumentStatus);
router.get('/:documentId/history', getDocumentHistory);

export default router;
