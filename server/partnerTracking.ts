import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { PartnerCaseStatus } from '../src/types.ts';

/**
 * OPTIONAL authorized-partner contract. This adapter is inert without explicit
 * HTTPS endpoints, the existing dispatch credential, and a separate signing
 * secret. It is NOT an emergency service or a source of invented case details.
 */
export interface PartnerTrackingEnv {
  AUTHORIZED_PARTNER_API_URL?: string;
  AUTHORIZED_PARTNER_API_KEY?: string;
  AUTHORIZED_PARTNER_STATUS_URL?: string;
  AUTHORIZED_PARTNER_LOCATION_URL?: string;
  AUTHORIZED_PARTNER_STOP_URL?: string;
  AUTHORIZED_PARTNER_TRACKING_SECRET?: string;
}

const CASE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const PARTNER_TIMEOUT_MS = 8000;
const MAX_RESPONSE_CHARS = 16_384;
const MIN_LOCATION_INTERVAL_MS = 10_000;
const MAX_POSITION_AGE_MS = 30_000;
const MAX_STATUS_AGE_MS = 60_000;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,100}$/;

export function isSecurePartnerEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password &&
      !url.hash && !url.search; // do not embed case IDs or credentials in endpoint URLs
  } catch {
    return false;
  }
}

export function getPartnerTrackingCapabilities(env: PartnerTrackingEnv): {
  caseStatusEnabled: boolean;
  liveTrackingEnabled: boolean;
} {
  const caseStatusEnabled = isSecurePartnerEndpoint(env.AUTHORIZED_PARTNER_API_URL) &&
    Boolean(env.AUTHORIZED_PARTNER_API_KEY?.trim()) &&
    isSecurePartnerEndpoint(env.AUTHORIZED_PARTNER_STATUS_URL) &&
    Boolean(env.AUTHORIZED_PARTNER_TRACKING_SECRET && env.AUTHORIZED_PARTNER_TRACKING_SECRET.length >= 32);
  return {
    caseStatusEnabled,
    liveTrackingEnabled: caseStatusEnabled && isSecurePartnerEndpoint(env.AUTHORIZED_PARTNER_LOCATION_URL) &&
      isSecurePartnerEndpoint(env.AUTHORIZED_PARTNER_STOP_URL)
  };
}

interface CaseCapability {
  purpose: 'case-status';
  sosId: string;
  referenceId: string;
  expiresAt: number;
}

/** Issued only after the authorized endpoint supplied a real reference ID. */
export function issueCaseAccessToken(
  env: PartnerTrackingEnv,
  sosId: unknown,
  referenceId: unknown,
  now = Date.now()
): { token: string; expiresAt: string } | null {
  if (!getPartnerTrackingCapabilities(env).caseStatusEnabled ||
      typeof sosId !== 'string' || !IDENTIFIER.test(sosId) ||
      typeof referenceId !== 'string' || !IDENTIFIER.test(referenceId)) return null;
  const payload: CaseCapability = { purpose: 'case-status', sosId, referenceId, expiresAt: now + CASE_TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', env.AUTHORIZED_PARTNER_TRACKING_SECRET!).update(encoded).digest('base64url');
  return { token: `${encoded}.${signature}`, expiresAt: new Date(payload.expiresAt).toISOString() };
}

export function verifyCaseAccessToken(env: PartnerTrackingEnv, token: unknown, now = Date.now()): CaseCapability | null {
  if (!getPartnerTrackingCapabilities(env).caseStatusEnabled || typeof token !== 'string' || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  try {
    const expected = createHmac('sha256', env.AUTHORIZED_PARTNER_TRACKING_SECRET!).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed: CaseCapability = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (parsed?.purpose !== 'case-status' || typeof parsed.sosId !== 'string' || !IDENTIFIER.test(parsed.sosId) ||
        typeof parsed.referenceId !== 'string' || !IDENTIFIER.test(parsed.referenceId) ||
        !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= now ||
        parsed.expiresAt > now + CASE_TOKEN_TTL_MS) return null;
    return parsed;
  } catch { return null; }
}

const shortText = (value: unknown, max = 100): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : undefined;

/** Reject cross-case results; accept ONLY partner-supplied, strictly typed facts. */
export function parsePartnerCaseStatus(raw: any, caseId: CaseCapability): PartnerCaseStatus | null {
  if (!raw || typeof raw !== 'object' || raw.sosId !== caseId.sosId ||
      raw.referenceId !== caseId.referenceId || typeof raw.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(raw.updatedAt))) return null;
  const accepted = raw.partnerAccepted === true;
  const caseNumber = accepted && typeof raw.caseNumber === 'string' && IDENTIFIER.test(raw.caseNumber)
    ? raw.caseNumber : undefined;
  const responder = accepted && caseNumber && raw.assignedResponder &&
    typeof raw.assignedResponder.id === 'string' && IDENTIFIER.test(raw.assignedResponder.id) &&
    shortText(raw.assignedResponder.name, 120)
    ? { id: raw.assignedResponder.id, name: shortText(raw.assignedResponder.name, 120)! } : undefined;
  const numberInRange = (value: unknown, max: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  const stages = ['ACCEPTED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'CLOSED'] as const;
  const stage = accepted && stages.find((value) => value === raw.stage);
  return {
    sosId: caseId.sosId,
    referenceId: caseId.referenceId,
    partnerAccepted: accepted,
    trackingAccepted: accepted && Boolean(caseNumber && responder && raw.trackingAccepted === true && stage !== 'CLOSED'),
    updatedAt: raw.updatedAt,
    ...(caseNumber ? { caseNumber } : {}),
    ...(responder ? { assignedResponder: responder } : {}),
    ...(stage ? { stage } : {}),
    // An unassigned person has no independently verifiable route, ETA or
    // distance. These values come ONLY from the authorized partner response.
    ...(responder && numberInRange(raw.distanceKm, 20_000) ? { distanceKm: raw.distanceKm } : {}),
    ...(responder && numberInRange(raw.etaMinutes, 1440) ? { etaMinutes: raw.etaMinutes } : {})
  };
}

export function canSharePartnerLocation(status: PartnerCaseStatus, now = Date.now()): boolean {
  const updated = Date.parse(status.updatedAt);
  return status.partnerAccepted === true && status.trackingAccepted === true &&
    Boolean(status.caseNumber && status.assignedResponder?.id && status.assignedResponder?.name) &&
    status.stage !== 'CLOSED' && Number.isFinite(updated) && updated <= now + 30_000 &&
    updated >= now - MAX_STATUS_AGE_MS;
}

function bearer(req: Request): string | null {
  const header = req.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

async function partnerPost(url: string, key: string, payload: object, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), PARTNER_TIMEOUT_MS);
  try {
    if (controller.signal.aborted) throw new Error('canceled');
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}`
      },
      body: JSON.stringify(payload),
      redirect: 'error', // a redirected credential/location must never reach another host
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`partner HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new Error('partner response too large');
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

interface TrackingSession {
  caseId: CaseCapability;
  caseNumber: string;
  startedAt: string;
  expiresAt: number;
  lastLocationAt: number;
  inFlight?: AbortController;
}

/** All session tokens and GPS points stay out of localStorage and server logs. */
export function createPartnerTrackingRouter(options: {
  env: PartnerTrackingEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Router {
  const { env } = options;
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const router = Router();
  const sessions = new Map<string, TrackingSession>();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Authorization');
    next();
  });

  function authorizeCase(req: Request, res: Response): CaseCapability | null {
    if (!getPartnerTrackingCapabilities(env).caseStatusEnabled) {
      res.status(503).json({ success: false, error: 'Authorized partner case status is not configured.' });
      return null;
    }
    const caseId = verifyCaseAccessToken(env, bearer(req), now());
    if (!caseId) res.status(401).json({ success: false, error: 'A valid, unexpired authorized case receipt is required.' });
    return caseId;
  }

  async function requestStatus(caseId: CaseCapability): Promise<PartnerCaseStatus> {
    const raw = await partnerPost(env.AUTHORIZED_PARTNER_STATUS_URL!, env.AUTHORIZED_PARTNER_API_KEY!, {
      sosId: caseId.sosId, referenceId: caseId.referenceId
    }, fetchImpl);
    const status = parsePartnerCaseStatus(raw, caseId);
    if (!status) throw new Error('partner status does not match this case');
    return status;
  }

  function authorizeSession(req: Request, res: Response): { token: string; session: TrackingSession } | null {
    if (!getPartnerTrackingCapabilities(env).liveTrackingEnabled) {
      res.status(503).json({ success: false, error: 'Authorized partner live tracking is not configured.' });
      return null;
    }
    const token = bearer(req);
    const session = token && sessions.get(token);
    if (!token || !session || session.expiresAt <= now()) {
      if (token) sessions.delete(token);
      res.status(401).json({ success: false, error: 'This tracking session has ended. Restart manually after partner confirmation.' });
      return null;
    }
    return { token, session };
  }

  router.post('/case-status', async (req, res) => {
    const caseId = authorizeCase(req, res);
    if (!caseId) return;
    try {
      const status = await requestStatus(caseId);
      res.json({ success: true, data: status });
    } catch {
      res.status(502).json({ success: false, error: 'Partner case status unavailable or invalid. Verify directly with the destination.' });
    }
  });

  router.post('/start-tracking', async (req, res) => {
    const caseId = authorizeCase(req, res);
    if (!caseId) return;
    if (req.body?.userConsentConfirmed !== true) {
      res.status(403).json({ success: false, error: 'Separate, explicit live-location consent is required.' });
      return;
    }
    if (!getPartnerTrackingCapabilities(env).liveTrackingEnabled) {
      res.status(503).json({ success: false, error: 'Authorized partner live tracking is not configured.' });
      return;
    }
    try {
      const status = await requestStatus(caseId);
      if (!canSharePartnerLocation(status, now())) {
        res.status(409).json({ success: false, error: 'Verified partner has not accepted fresh, assigned live-location tracking for this case.' });
        return;
      }
      const token = randomBytes(32).toString('base64url');
      const startedAt = new Date(now()).toISOString();
      const expiresAt = now() + SESSION_TTL_MS;
      sessions.set(token, { caseId, caseNumber: status.caseNumber!, startedAt, expiresAt, lastLocationAt: 0 });
      res.json({ success: true, data: { sessionToken: token, expiresAt: new Date(expiresAt).toISOString(), status } });
    } catch {
      res.status(502).json({ success: false, error: 'Partner confirmation unavailable. GPS sharing did not start.' });
    }
  });

  router.post('/location-update', async (req, res) => {
    const authorized = authorizeSession(req, res);
    if (!authorized) return;
    const { token, session } = authorized;
    const { latitude, longitude, accuracyMeters, timestamp } = req.body || {};
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 50_000 ||
        typeof timestamp !== 'number' || !Number.isFinite(timestamp) ||
        timestamp > now() + 30_000 || timestamp < now() - MAX_POSITION_AGE_MS) {
      res.status(400).json({ success: false, error: 'Fresh, valid GPS coordinates are required; no location was forwarded.' });
      return;
    }
    if (session.lastLocationAt && now() - session.lastLocationAt < MIN_LOCATION_INTERVAL_MS) {
      res.status(429).json({ success: false, error: 'Live location is rate-limited; no location was forwarded.' });
      return;
    }
    // Close the race between simultaneous callbacks before any network work.
    session.lastLocationAt = now();
    const inFlight = new AbortController();
    session.inFlight = inFlight;
    try {
      const status = await requestStatus(session.caseId);
      if (sessions.get(token) !== session || inFlight.signal.aborted ||
          !canSharePartnerLocation(status, now()) || status.caseNumber !== session.caseNumber) {
        sessions.delete(token); // revocation, stop, or case reassignment is fail-closed
        res.status(409).json({ success: false, error: 'Partner tracking consent has ended or changed. Location was NOT forwarded.' });
        return;
      }
      const result = await partnerPost(env.AUTHORIZED_PARTNER_LOCATION_URL!, env.AUTHORIZED_PARTNER_API_KEY!, {
        sosId: session.caseId.sosId,
        referenceId: session.caseId.referenceId,
        caseNumber: session.caseNumber,
        userConsentAt: session.startedAt,
        latitude, longitude, accuracyMeters,
        timestamp: new Date(timestamp).toISOString()
      }, fetchImpl, inFlight.signal);
      if (sessions.get(token) !== session || result?.accepted !== true ||
          result?.referenceId !== session.caseId.referenceId || result?.caseNumber !== session.caseNumber) {
        throw new Error('location receipt mismatch or revoked session');
      }
      res.json({ success: true, data: { accepted: true, at: new Date(now()).toISOString() } });
    } catch {
      sessions.delete(token); // never retry an uncertain GPS delivery automatically
      res.status(502).json({ success: false, error: 'Partner location update unconfirmed. Tracking stopped; no automatic retry.' });
    } finally {
      if (session.inFlight === inFlight) session.inFlight = undefined;
    }
  });

  router.post('/stop-tracking', async (req, res) => {
    const authorized = authorizeSession(req, res);
    if (!authorized) return;
    const { token, session } = authorized;
    // Local revocation happens FIRST, even if the partner endpoint is offline.
    sessions.delete(token);
    session.inFlight?.abort(); // best effort: abort an in-flight location POST
    try {
      const result = await partnerPost(env.AUTHORIZED_PARTNER_STOP_URL!, env.AUTHORIZED_PARTNER_API_KEY!, {
        sosId: session.caseId.sosId,
        referenceId: session.caseId.referenceId,
        caseNumber: session.caseNumber,
        userConsentAt: session.startedAt,
        reason: 'USER_STOPPED_SHARING'
      }, fetchImpl);
      if (result?.accepted !== true || result?.referenceId !== session.caseId.referenceId ||
          result?.caseNumber !== session.caseNumber) throw new Error('stop receipt mismatch');
      res.json({ success: true, data: { locallyStopped: true, partnerNotified: true } });
    } catch {
      res.status(502).json({ success: false, data: { locallyStopped: true, partnerNotified: false },
        error: 'Local sharing stopped, but the partner did not confirm the stop request. Contact them directly.' });
    }
  });
  return router;
}
