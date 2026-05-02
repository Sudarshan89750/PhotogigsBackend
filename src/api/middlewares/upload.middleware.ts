import multer from 'multer';
import fileType from 'file-type';
import { BadRequestError } from '../../utils/errors';

// Only image types — video is handled via Cloudinary signed upload from the client
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const DOCUMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

// 10 MB cap — safe for memory storage across concurrent uploads
// (e.g. 50 concurrent × 10 MB = 500 MB peak heap — acceptable)
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const imageFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (IMAGE_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError(`Only images are accepted here (jpeg/png/webp/gif). Got: ${file.mimetype}`));
  }
};

const documentFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (DOCUMENT_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError(`Only images or PDFs are accepted here. Got: ${file.mimetype}`));
  }
};

// Use for: avatar, post images (backwards compat), campaign banners
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: imageFilter,
});

// Use for: ID document upload (allows PDF + images)
export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: documentFilter,
});

/**
 * Validate a file buffer's actual content type via magic bytes.
 * Prevents MIME-type spoofing where an attacker renames a malicious
 * executable to .pdf and sets the Content-Type header to application/pdf.
 *
 * Uses file-type@16.5.4 for CommonJS compatibility.
 *
 * Call AFTER multer has buffered the file but BEFORE processing it.
 */
export const validateMagicBytes = async (
  buffer: Buffer,
  allowedMimes: Set<string>
): Promise<boolean> => {
  const result = await fileType.fromBuffer(buffer);
  if (!result) return false;
  return allowedMimes.has(result.mime);
};

// VIDEO UPLOADS — DO NOT ADD MULTER HERE.
// Videos must be uploaded directly from the browser to Cloudinary using a signed upload URL.
// The backend provides a signature via GET /api/v1/users/cloudinary-signature
// The browser then POSTs the file directly to https://api.cloudinary.com/v1_1/<cloud>/video/upload
// This keeps video bytes off the Node.js heap entirely.
