import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import multer from 'multer'

// Files land on a docker volume with unguessable names; /api/files serves them
// statically. Random 32-hex names are the access control — never list the dir.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads'
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }) } catch { /* exists */ }

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/heic': '.heic', 'application/pdf': '.pdf',
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '.bin')),
})

export const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype]),
})

export function removeFile(filename) {
  if (!filename || filename.includes('/') || filename.includes('\\')) return
  fs.unlink(path.join(UPLOAD_DIR, filename), () => {})
}
