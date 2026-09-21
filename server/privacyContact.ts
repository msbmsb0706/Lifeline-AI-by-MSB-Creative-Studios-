/**
 * LifeLine AI — Privacy Contact Form backend (server-side only).
 *
 * POST /api/privacy-contact
 *
 * Security model:
 *  - The destination mailbox is read ONLY from the server-side environment
 *    variable PRIVACY_CONTACT_EMAIL. It is never bundled into the frontend,
 *    never echoed in an API response, and never written to the repository.
 *  - Mail is relayed by the server through a standard SMTP provider whose
 *    credentials also live only in server-side environment variables.
 *  - Submissions are validated, size-limited, rate-limited and honeypot-checked.
 *  - Submitted names, email addresses and messages are NOT logged. Only a
 *    random reference id and a coarse outcome/error code are logged.
 *  - Responses are generic success/failure payloads.
 */
import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import nodemailer, { type Transporter } from 'nodemailer';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
export const PRIVACY_CONTACT_LIMITS = {
  nameMax: 100,
  emailMax: 254,
  messageMin: 10,
  messageMax: 4000,
  // Per client address: attempts (any request) and accepted submissions.
  attemptsPerIp: { max: 30, windowMs: 15 * 60 * 1000 },
  sendsPerIp: { max: 5, windowMs: 15 * 60 * 1000 },
  // Whole server: protects the mailbox from floods regardless of source.
  sendsGlobal: { max: 100, windowMs: 60 * 60 * 1000 }
} as const;

const GENERIC_SUCCESS =
  'Your message has been sent to the MSB Creative Studios privacy team. We will reply to the email address you provided.';
const GENERIC_UNAVAILABLE =
  'The Privacy Contact Form is temporarily unavailable. Please try again later.';
const GENERIC_SEND_FAILURE =
  'We could not send your message right now. Please try again in a few minutes.';
const GENERIC_RATE_LIMITED =
  'Too many requests. Please wait a few minutes before trying again.';

// ---------------------------------------------------------------------------
// Configuration (read lazily from process.env so dotenv can load first)
// ---------------------------------------------------------------------------
interface PrivacyContactConfig {
  destination: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  from: string;
}

function readConfig(): PrivacyContactConfig {
  const smtpUser = (process.env.SMTP_USER || '').trim();
  return {
    destination: (process.env.PRIVACY_CONTACT_EMAIL || '').trim(),
    smtpHost: (process.env.SMTP_HOST || '').trim(),
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: (process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true',
    smtpUser,
    smtpPass: process.env.SMTP_PASS || '',
    from: (process.env.PRIVACY_CONTACT_FROM || '').trim() || smtpUser
  };
}

/** Boolean-only configuration summary — safe to log at startup. */
export function getPrivacyContactConfigStatus(): { destinationConfigured: boolean; smtpConfigured: boolean } {
  const cfg = readConfig();
  return {
    destinationConfigured: cfg.destination.length > 0,
    smtpConfigured: cfg.smtpHost.length > 0 && Number.isFinite(cfg.smtpPort) && cfg.smtpPort > 0 && cfg.from.length > 0
  };
}

function isDeliveryConfigured(): boolean {
  const status = getPrivacyContactConfigStatus();
  return status.destinationConfigured && status.smtpConfigured;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export interface PrivacyContactSubmission {
  name: string; // '' when not provided
  email: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; data: PrivacyContactSubmission }
  | { ok: false; error: string };

// Pragmatic address check: one "@", no whitespace, a dot in the domain, and
// none of the characters that could be abused to smuggle extra recipients or
// header content. Deliverability is ultimately confirmed by the reply itself.
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[A-Za-z0-9-]{2,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// eslint-disable-next-line no-control-regex
const ALL_CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function isValidContactEmail(value: string): boolean {
  return value.length <= PRIVACY_CONTACT_LIMITS.emailMax && EMAIL_PATTERN.test(value);
}

export function validatePrivacyContactSubmission(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid submission.' };
  }
  const raw = body as Record<string, unknown>;

  if (raw.name !== undefined && raw.name !== null && typeof raw.name !== 'string') {
    return { ok: false, error: 'Invalid submission.' };
  }
  if (typeof raw.email !== 'string' || typeof raw.message !== 'string') {
    return { ok: false, error: 'An email address and a message are required.' };
  }

  // Name is optional: strip every control character (it may appear in a header).
  const name = ((raw.name as string | undefined) || '')
    .replace(ALL_CONTROL_CHARS, '')
    .trim()
    .slice(0, PRIVACY_CONTACT_LIMITS.nameMax);

  const email = raw.email.trim();
  if (email.length === 0) {
    return { ok: false, error: 'An email address is required so we can reply to you.' };
  }
  if (!isValidContactEmail(email)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  const message = raw.message
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS_EXCEPT_NEWLINE_TAB, '')
    .trim();
  if (message.length === 0) {
    return { ok: false, error: 'A message is required.' };
  }
  if (message.length < PRIVACY_CONTACT_LIMITS.messageMin) {
    return { ok: false, error: `Please describe your request in at least ${PRIVACY_CONTACT_LIMITS.messageMin} characters.` };
  }
  if (message.length > PRIVACY_CONTACT_LIMITS.messageMax) {
    return { ok: false, error: `Your message is too long (maximum ${PRIVACY_CONTACT_LIMITS.messageMax} characters).` };
  }

  return { ok: true, data: { name, email, message } };
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory sliding window; per process)
// ---------------------------------------------------------------------------
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxTrackedKeys = 5000
  ) {
    const timer = setInterval(() => this.prune(Date.now()), windowMs);
    // Never keep the process alive just for housekeeping.
    if (typeof timer.unref === 'function') timer.unref();
  }

  private prune(now: number): void {
    for (const [key, stamps] of this.hits) {
      const kept = stamps.filter((t) => now - t < this.windowMs);
      if (kept.length > 0) this.hits.set(key, kept);
      else this.hits.delete(key);
    }
  }

  private current(key: string, now: number): number[] {
    if (this.hits.size > this.maxTrackedKeys) this.prune(now);
    return (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
  }

  /** Returns true when another hit would still be within the limit. */
  peek(key: string): boolean {
    return this.current(key, Date.now()).length < this.max;
  }

  /** Records a hit if allowed. */
  consume(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const stamps = this.current(key, now);
    if (stamps.length >= this.max) {
      this.hits.set(key, stamps);
      const retryAfterMs = this.windowMs - (now - stamps[0]);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    stamps.push(now);
    this.hits.set(key, stamps);
    return { allowed: true, retryAfterSec: 0 };
  }
}

// ---------------------------------------------------------------------------
// Mail delivery
// ---------------------------------------------------------------------------
let cachedTransporter: Transporter | null = null;
let cachedTransporterKey = '';

function getTransporter(cfg: PrivacyContactConfig): Transporter {
  const key = `${cfg.smtpHost}|${cfg.smtpPort}|${cfg.smtpSecure}|${cfg.smtpUser}`;
  if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure, // true = implicit TLS (465); false = STARTTLS upgrade when offered (587)
    auth: cfg.smtpUser && cfg.smtpPass ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });
  cachedTransporterKey = key;
  return cachedTransporter;
}

function buildMailText(data: PrivacyContactSubmission, reference: string, receivedAt: string): string {
  return [
    'LifeLine AI — Privacy Contact Form submission',
    '',
    `Reference: ${reference}`,
    `Received:  ${receivedAt}`,
    `Name:      ${data.name || '(not provided)'}`,
    `Email:     ${data.email}`,
    '',
    'Message:',
    '----------------------------------------',
    data.message,
    '----------------------------------------',
    '',
    'Submitted through the LifeLine AI Privacy Contact Form.',
    'Reply to this email to respond directly to the user.'
  ].join('\n');
}

async function deliver(data: PrivacyContactSubmission, reference: string): Promise<void> {
  const cfg = readConfig();
  const receivedAt = new Date().toISOString();
  const transporter = getTransporter(cfg);

  await transporter.sendMail({
    from: { name: 'LifeLine AI Privacy Contact Form', address: cfg.from },
    to: cfg.destination,
    replyTo: data.name ? { name: data.name, address: data.email } : data.email,
    subject: `[LifeLine AI] Privacy Contact Form request (ref ${reference})`,
    text: buildMailText(data, reference, receivedAt)
  });
}

function newReference(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

function clientKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function createPrivacyContactRouter(): Router {
  const router = Router();

  const attemptsPerIp = new SlidingWindowRateLimiter(
    PRIVACY_CONTACT_LIMITS.attemptsPerIp.max,
    PRIVACY_CONTACT_LIMITS.attemptsPerIp.windowMs
  );
  const sendsPerIp = new SlidingWindowRateLimiter(
    PRIVACY_CONTACT_LIMITS.sendsPerIp.max,
    PRIVACY_CONTACT_LIMITS.sendsPerIp.windowMs
  );
  const sendsGlobal = new SlidingWindowRateLimiter(
    PRIVACY_CONTACT_LIMITS.sendsGlobal.max,
    PRIVACY_CONTACT_LIMITS.sendsGlobal.windowMs
  );

  const rateLimited = (res: Response, retryAfterSec: number) => {
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({ success: false, error: GENERIC_RATE_LIMITED });
  };

  // The SPA fallback would otherwise answer GET with index.html.
  router.get('/', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ success: false, error: 'Use POST to submit the Privacy Contact Form.' });
  });

  router.post('/', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const ip = clientKey(req);

    // 1. Coarse per-client attempt limit (covers invalid/junk traffic too).
    const attempt = attemptsPerIp.consume(ip);
    if (!attempt.allowed) {
      rateLimited(res, attempt.retryAfterSec);
      return;
    }

    if (!req.is('application/json') || !req.body || typeof req.body !== 'object') {
      res.status(400).json({ success: false, error: 'Invalid submission.' });
      return;
    }

    // 2. Honeypot: real users never see or fill this field. Answer like a
    //    success so automated senders learn nothing, but deliver nothing.
    const honeypot = (req.body as Record<string, unknown>).website;
    if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
      res.json({ success: true, message: GENERIC_SUCCESS, reference: newReference() });
      return;
    }

    // 3. Field validation.
    const validation = validatePrivacyContactSubmission(req.body);
    if (validation.ok === false) {
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    // 4. Submission limits (checked before consuming so invalid input above
    //    never eats into a genuine user's allowance).
    if (!sendsPerIp.peek(ip)) {
      rateLimited(res, Math.ceil(PRIVACY_CONTACT_LIMITS.sendsPerIp.windowMs / 1000));
      return;
    }
    if (!sendsGlobal.peek('global')) {
      console.warn('[Privacy Contact] Global submission limit reached; rejecting until the window resets.');
      rateLimited(res, 300);
      return;
    }

    // 5. Delivery must be configured server-side.
    if (!isDeliveryConfigured()) {
      console.warn('[Privacy Contact] Submission rejected: PRIVACY_CONTACT_EMAIL and/or SMTP settings are not configured.');
      res.status(503).json({ success: false, error: GENERIC_UNAVAILABLE });
      return;
    }

    sendsPerIp.consume(ip);
    sendsGlobal.consume('global');

    // 6. Relay to the private destination. Personal data is never logged.
    const reference = newReference();
    const startedAt = Date.now();
    try {
      await deliver(validation.data, reference);
      console.log(`[Privacy Contact] Submission ${reference} delivered (${Date.now() - startedAt}ms).`);
      res.json({ success: true, message: GENERIC_SUCCESS, reference });
    } catch (err: unknown) {
      const e = (err || {}) as { code?: unknown; responseCode?: unknown; name?: unknown };
      const code = e.code || e.responseCode || e.name || 'UNKNOWN';
      console.error(`[Privacy Contact] Submission ${reference} delivery failed (code: ${String(code)}).`);
      res.status(502).json({ success: false, error: GENERIC_SEND_FAILURE });
    }
  });

  return router;
}
