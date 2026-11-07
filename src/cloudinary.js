// Cloudinary hosting for feedback photos and printable QR sheets. Gated on CLOUDINARY_URL; the app works without it.
// We never use Cloudinary's OCR add-on: Gemini reads the handwriting.
import { v2 as cloudinary } from 'cloudinary';

let api = cloudinary; // replaceable in tests
export let cloudinaryEnabled = !!process.env.CLOUDINARY_URL;

/** Test hook: inject a fake ({ uploader: { upload }, url }) or null to disable. */
export function __setCloudinaryForTests(fake) {
  api = fake || cloudinary;
  cloudinaryEnabled = !!fake || !!process.env.CLOUDINARY_URL;
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

// Handwriting-friendly derived version (the original asset is kept untouched as `originalUrl`).
const READABLE = [
  { angle: 'exif' },                                       // auto-orient from phone EXIF data
  { width: 2000, height: 2000, crop: 'limit' },            // cap size, never upscale
  { effect: 'improve' },                                   // automatic colour/contrast improvement
  { effect: 'sharpen:100' },
  { quality: 'auto', fetch_format: 'jpg' },
];

/** Upload a local photo; returns { url (readable version), originalUrl, publicId }. Throws on failure. */
export async function uploadFeedbackPhoto(filePath, { programToken }) {
  if (!cloudinaryEnabled) throw new Error('Cloudinary is not configured');
  const tok = slug(programToken);
  const r = await api.uploader.upload(filePath, {
    folder: `strongstart/feedback/${tok}`,
    tags: ['strongstart', 'feedback', `program-${tok}`],
    resource_type: 'image',
    use_filename: false,
    unique_filename: true,
    overwrite: false,
  });
  const url = api.url(r.public_id, {
    secure: true, resource_type: 'image', type: 'upload', version: r.version, format: 'jpg', transformation: READABLE,
  });
  return { url, originalUrl: r.secure_url, publicId: r.public_id };
}

/** Upload the QR PNG and return a hosted printable sheet image URL (name + QR + call to action). */
export async function uploadQrSheet(qrPngBuffer, programName) {
  if (!cloudinaryEnabled) throw new Error('Cloudinary is not configured');
  const r = await api.uploader.upload(`data:image/png;base64,${Buffer.from(qrPngBuffer).toString('base64')}`, {
    folder: 'strongstart/qr', tags: ['strongstart', 'qr-sheet'], resource_type: 'image',
  });
  const text = (t) => String(t).replace(/[\r\n]+/g, ' ').slice(0, 60);
  return api.url(r.public_id, {
    secure: true, resource_type: 'image', type: 'upload', version: r.version, format: 'png',
    transformation: [
      { width: 800, crop: 'scale' },
      { width: 1000, height: 1300, crop: 'pad', background: 'white', gravity: 'center' },
      { overlay: { font_family: 'Arial', font_size: 54, font_weight: 'bold', text: text(programName) }, color: '#1a1a1a', gravity: 'north', y: 90 },
      { overlay: { font_family: 'Arial', font_size: 44, font_weight: 'bold', text: 'Scan to share your feedback' }, color: '#1a1a1a', gravity: 'south', y: 150 },
      { overlay: { font_family: 'Arial', font_size: 30, text: 'Escanea para compartir tu opinion' }, color: '#444444', gravity: 'south', y: 90 },
    ],
  });
}
