import { randomToken } from '../lib/crypto.js';
import { AppError, unavailable } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { providers } from '../providers/index.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_GALLERY_IMAGES = 12;

// Detects the real image type from magic bytes; extensions and client MIME types are ignored.
export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Real pixel dimensions read from the image bytes (never from client-supplied values). Returns null
// for malformed or truncated files. JPEG EXIF orientations 5–8 (rotated 90°) swap width and height,
// matching how browsers and Cloudinary display the image.
export function imageDimensions(buffer) {
  try {
    const type = sniffImage(buffer);
    if (type === 'image/png') {
      if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
      return positive(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
    }
    if (type === 'image/webp') {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return positive(1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3));
      if (chunk === 'VP8L') {
        if (buffer[20] !== 0x2f) return null;
        const bits = buffer.readUInt32LE(21);
        return positive((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      if (chunk === 'VP8 ') {
        if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
        return positive(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
      }
      return null;
    }
    if (type === 'image/jpeg') return jpegDimensions(buffer);
  } catch {
    return null;
  }
  return null;
}

const positive = (width, height) => (width > 0 && height > 0 ? { width, height } : null);

function jpegDimensions(buffer) {
  let offset = 2;
  let orientation = 1;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    if (marker === 0xe1 && buffer.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') orientation = exifOrientation(buffer, offset + 10) ?? orientation;
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return orientation >= 5 && orientation <= 8 ? positive(height, width) : positive(width, height);
    }
    if (marker === 0xda || marker === 0xd9) return null;
    offset += 2 + length;
  }
  return null;
}

function exifOrientation(buffer, tiff) {
  const little = buffer.toString('ascii', tiff, tiff + 2) === 'II';
  const u16 = (o) => (little ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const u32 = (o) => (little ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const ifd = tiff + u32(tiff + 4);
  const entries = u16(ifd);
  for (let i = 0; i < entries; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

// Promotional banners are shown at a fixed 3:1 ratio, so the source must be 3:1 (e.g. 1200 × 400,
// 1800 × 600). A 1% tolerance absorbs a pixel of rounding from resizing or cropping tools.
export const BANNER_RULES = { ratio: 3, tolerance: 0.01, minWidth: 600, minHeight: 200, recommended: { width: 1200, height: 400 } };

export function checkBannerDimensions(dims) {
  const { ratio, tolerance, minWidth, minHeight, recommended } = BANNER_RULES;
  const req = `The promotional banner must be a 3:1 image, such as ${recommended.width} × ${recommended.height} px`;
  if (!dims) return new AppError(415, 'UNSUPPORTED_IMAGE', 'This file could not be read as an image. Upload a JPEG, PNG or WebP image.');
  const actual = dims.width / dims.height;
  if (Math.abs(actual - ratio) / ratio > tolerance) {
    return new AppError(422, 'BANNER_RATIO_INVALID', `${req}. This image is ${dims.width} × ${dims.height} px (${actual.toFixed(2)}:1).`, { width: dims.width, height: dims.height, requiredRatio: '3:1', recommended });
  }
  if (dims.width < minWidth || dims.height < minHeight) {
    return new AppError(422, 'BANNER_TOO_SMALL', `${req}, at least ${minWidth} × ${minHeight} px. This image is ${dims.width} × ${dims.height} px.`, { width: dims.width, height: dims.height, requiredRatio: '3:1', recommended });
  }
  return null;
}

// Provider failures become a clear, recoverable response instead of a generic 500. The provider's
// own message and status stay in the server log (with the request ID); credentials, URLs and paths
// are never part of either.
function uploadFailure(err, folder) {
  logger.warn({ provider: err.provider ?? 'media', status: err.status, detail: err.code, retryable: err.retryable, folder }, 'image upload failed');
  if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 401 && err.status !== 403) {
    return new AppError(422, 'IMAGE_REJECTED', 'The image service could not process this file. Try a different JPEG, PNG or WebP image.');
  }
  return new AppError(502, 'UPLOAD_FAILED', "The image couldn't be uploaded right now. Nothing was changed — please try again.");
}

// Validates the bytes and uploads into `folder`. The folder and public ID are always chosen
// by the server; the stored result must land inside that folder.
// Images larger than this on either side are refused before upload (no legitimate use here).
const MAX_EDGE_PX = 12000;

async function uploadValidatedImage({ folder, file, userId, check }) {
  const media = providers().media;
  if (!media) throw unavailable('MEDIA_UNAVAILABLE', 'Image uploads are not configured yet.');
  if (!file) throw new AppError(400, 'UPLOAD_INVALID', 'Choose an image to upload.');
  const mimeType = sniffImage(file.buffer);
  if (!mimeType) throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP image.');
  const dims = imageDimensions(file.buffer);
  if (!dims) throw new AppError(415, 'UNSUPPORTED_IMAGE', 'This file could not be read as an image. Upload a JPEG, PNG or WebP image.');
  if (dims.width > MAX_EDGE_PX || dims.height > MAX_EDGE_PX) throw new AppError(422, 'IMAGE_TOO_LARGE', `Images can be at most ${MAX_EDGE_PX} px on each side.`);
  // Feature-specific rules (e.g. the banner's 3:1 ratio) run on the real dimensions, before upload.
  const rejected = check?.(dims);
  if (rejected) throw rejected;
  let result;
  try {
    result = await media.upload({ buffer: file.buffer, mimeType, folder, publicId: randomToken(12) });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw uploadFailure(err, folder);
  }
  if (!result.publicId?.startsWith(`${folder}/`)) {
    throw new AppError(502, 'UPLOAD_FAILED', 'The image could not be stored. Please try again.');
  }
  return { ...result, uploadedBy: userId, uploadedAt: new Date() };
}

// Uploads a validated image into a folder derived from the company ID on the server.
// The client controls neither the folder nor the public ID, so it cannot overwrite
// another vendor's assets.
export function uploadCompanyImage({ companyId, kind, file, userId }) {
  return uploadValidatedImage({ folder: `townant/companies/${companyId}/${kind}`, file, userId });
}

// Platform imagery managed by Super Admins (category images, homepage hero, promotional banner).
export const PLATFORM_FOLDERS = {
  category: (id) => `townant/platform/categories/${id}`,
  hero: () => 'townant/platform/site/hero',
  banner: () => 'townant/platform/site/banner',
};

export function uploadPlatformImage({ folder, file, userId, check }) {
  return uploadValidatedImage({ folder, file, userId, check });
}

export async function deleteImage(publicId) {
  const media = providers().media;
  if (!media || !publicId) return;
  try {
    await media.destroy(publicId);
  } catch {
    // Orphaned assets are acceptable; the reference is already removed from the profile.
  }
}
