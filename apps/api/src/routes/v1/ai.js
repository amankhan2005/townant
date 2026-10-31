import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError, forbidden } from '../../lib/errors.js';
import { text, validate } from '../../lib/validate.js';
import { requireAuth, requireVendor } from '../../middleware/auth.js';
import { byUserOrIp, rateLimit } from '../../middleware/rateLimit.js';
import { aiUnavailableError, draftBio, extractSearchIntent, getAi, polishText } from '../../services/ai.js';
import { assistantTurn, MAX_TURNS } from '../../services/assistant.js';
import { logger } from '../../lib/logger.js';
import { searchCompanies } from '../../services/catalog.js';
import { providers } from '../../providers/index.js';
import { searchQuery } from './catalog.js';

const router = Router();
const MIN = 60 * 1000;

// Per-caller short- and long-window limits on every AI route (provider cost protection).
const aiLimits = [
  rateLimit({ name: 'ai-minute', windowMs: MIN, max: 6, key: byUserOrIp, failClosed: true }),
  rateLimit({ name: 'ai-day', windowMs: 24 * 60 * MIN, max: 60, key: byUserOrIp, failClosed: true }),
];

// Natural-language discovery. The model only produces filters; results come from the same
// search service as manual search, so every business shown is a real published listing.
router.post(
  '/search',
  ...aiLimits,
  validate({ body: z.object({ query: text(300, { min: 3 }), timezone: z.string().max(64).optional() }).strict() }),
  async (req, res) => {
    const intent = await extractSearchIntent(req.valid.body.query, { timezone: req.valid.body.timezone });
    const filters = {
      q: intent.keywords || undefined,
      category: intent.categorySlug || undefined,
      city: intent.city || undefined,
      region: intent.region || undefined,
      postalCode: intent.postalCode || undefined,
      country: intent.country || undefined,
      availableOn: intent.date || undefined,
      sort: 'relevance',
      page: 1,
      limit: 20,
    };
    let { items, total } = await searchCompanies(filters);
    // If keywords were too narrow, retry with the structured filters alone.
    if (!total && filters.q && (filters.category || filters.city || filters.postalCode)) {
      ({ items, total } = await searchCompanies({ ...filters, q: undefined }));
      filters.q = undefined;
    }
    res.json({ data: { intent, filters, results: items, total } });
  },
);

// Which assistant features are configured, so clients only offer what works. No secrets.
router.get('/status', (_req, res) => {
  const ai = providers().ai;
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ data: { assistant: Boolean(ai), voice: Boolean(ai && typeof ai.transcribe === 'function') } });
});

// Conversational discovery assistant. Stateless: the client sends the recent turns and nothing
// is stored server-side. Only public, published listings can be returned (same search service),
// and the assistant has no booking capability.
const assistantLimits = [
  rateLimit({ name: 'ai-chat-minute', windowMs: MIN, max: 10, key: byUserOrIp, failClosed: true }),
  rateLimit({ name: 'ai-chat-day', windowMs: 24 * 60 * MIN, max: 120, key: byUserOrIp, failClosed: true }),
];

const turn = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: text(500, { min: 1 }) }).strict(),
  z.object({ role: z.literal('assistant'), content: text(1200, { min: 1 }) }).strict(),
]);

const savedLocation = searchQuery.pick({ country: true, region: true, city: true, postalCode: true, lat: true, lng: true, radiusKm: true }).extend({ label: text(120).optional() }).strict();

router.post(
  '/assistant',
  ...assistantLimits,
  validate({
    body: z
      .object({
        messages: z.array(turn).min(1).max(MAX_TURNS).refine((m) => m.at(-1).role === 'user', 'The last message must be from the customer.'),
        location: savedLocation.optional(),
        timezone: z.string().max(64).regex(/^[A-Za-z0-9_+\-/]+$/).optional(),
      })
      .strict(),
  }),
  async (req, res) => {
    const { messages, location, timezone } = req.valid.body;
    const { label, ...place } = location ?? {};
    const hasPlace = Object.values(place).some((v) => v !== undefined);
    const data = await assistantTurn({ messages, savedLocation: hasPlace ? place : null, savedLocationLabel: label, timezone, searchSchema: searchQuery });
    res.json({ data });
  },
);

// Voice input: transcribes a short recording for the customer to review before sending.
// Audio is held in memory for the request only and never stored.
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 1, parts: 2 } });

// Detects the container from magic bytes; the client's declared type is ignored.
export function sniffAudio(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mimeType: 'audio/webm', ext: 'webm' };
  if (b.toString('ascii', 0, 4) === 'OggS') return { mimeType: 'audio/ogg', ext: 'ogg' };
  if (b.toString('ascii', 4, 8) === 'ftyp') return { mimeType: 'audio/mp4', ext: 'm4a' };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return { mimeType: 'audio/wav', ext: 'wav' };
  if (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mimeType: 'audio/mpeg', ext: 'mp3' };
  return null;
}

router.post(
  '/transcribe',
  rateLimit({ name: 'ai-voice-minute', windowMs: MIN, max: 8, key: byUserOrIp, failClosed: true }),
  rateLimit({ name: 'ai-voice-day', windowMs: 24 * 60 * MIN, max: 60, key: byUserOrIp, failClosed: true }),
  audioUpload.single('audio'),
  validate({ body: z.object({ language: z.string().regex(/^[a-z]{2}$/).optional() }).strict() }),
  async (req, res) => {
    if (!req.file) throw new AppError(400, 'UPLOAD_INVALID', 'No recording was received.');
    const kind = sniffAudio(req.file.buffer);
    if (!kind) throw new AppError(415, 'UNSUPPORTED_AUDIO', 'That recording format is not supported.');
    const ai = await getAi();
    if (typeof ai.transcribe !== 'function') throw aiUnavailableError();
    let out;
    try {
      out = await ai.transcribe({ buffer: req.file.buffer, mimeType: kind.mimeType, filename: `voice.${kind.ext}`, language: req.valid.body.language });
    } catch (err) {
      logger.warn({ err: err.message }, 'transcription failed');
      throw aiUnavailableError();
    }
    res.json({ data: { text: out.text.replace(/\s+/g, ' ').trim().slice(0, 500) } });
  },
);

router.post(
  '/polish',
  requireAuth,
  ...aiLimits,
  validate({ body: z.object({ text: text(2000, { min: 3, multiline: true }), purpose: z.enum(['message', 'review']) }).strict() }),
  async (req, res) => {
    res.json({ data: { suggestion: await polishText(req.valid.body.text, req.valid.body.purpose) } });
  },
);

router.post(
  '/bio',
  requireVendor,
  ...aiLimits,
  validate({ body: z.object({ facts: text(2000, { min: 10, multiline: true }) }).strict() }),
  async (req, res) => {
    if (!req.vendor.permissions.includes('company:write')) throw forbidden();
    res.json({ data: { suggestion: await draftBio(req.valid.body.facts, req.vendor.company.name) } });
  },
);

export default router;
