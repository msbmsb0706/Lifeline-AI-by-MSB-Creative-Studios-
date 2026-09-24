import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PartnerCaseStatus, PendingSOSItem } from '../types.ts';
import { getPendingQueue, savePendingSOS } from '../lib/emergencyPartnerQueue.ts';
import {
  canViewPartnerCase, canStartPartnerTracking, fetchPartnerCaseStatus,
  isPartnerCaseCurrent, sendPartnerLocation, startPartnerTracking, stopPartnerTracking
} from '../lib/partnerCaseTracking.ts';

interface Props {
  item: PendingSOSItem;
  isOffline: boolean;
  isVisible: boolean;
  onCaseUpdated: () => void;
}

/**
 * The ONLY ongoing geolocation watcher in this app. Mounted only for an
 * authorized partner record with a verified handoff receipt. No watcher or
 * network request starts on mount, reload, reconnect, or receipt alone.
 */
export const PartnerCaseTrackingPanel: React.FC<Props> = ({ item, isOffline, isVisible, onCaseUpdated }) => {
  const [caseStatus, setCaseStatus] = useState<PartnerCaseStatus | null>(item.caseStatus || null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [userConsents, setUserConsents] = useState(false);
  const [lastSharedAt, setLastSharedAt] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const sessionToken = useRef<string | null>(null); // memory only — never persisted
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lastSentAt = useRef(0);
  const busyRef = useRef(false);
  const offlineRef = useRef(isOffline);
  offlineRef.current = isOffline;

  const stopSensors = useCallback((): string | null => {
    generation.current += 1;
    if (watchId.current !== null) {
      navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    }
    inFlight.current?.abort();
    inFlight.current = null;
    lastSentAt.current = 0;
    const token = sessionToken.current;
    sessionToken.current = null;
    return token;
  }, []);

  const persistStatus = useCallback((status: PartnerCaseStatus) => {
    const current = getPendingQueue().find((saved) => saved.sosPackage.sosId === item.sosPackage.sosId);
    if (!current || !canViewPartnerCase(current) ||
        current.acknowledgment?.referenceId !== status.referenceId) return false;
    current.caseStatus = status;
    const saved = savePendingSOS(current);
    if (saved) onCaseUpdated();
    return saved;
  }, [item.sosPackage.sosId, onCaseUpdated]);

  const refresh = useCallback(async () => {
    if (isOffline || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const run = generation.current;
    try {
      const result = await fetchPartnerCaseStatus(item);
      if (run !== generation.current) return;
      setCaseStatus(result);
      const saved = persistStatus(result);
      setNotice(saved ? 'Partner-reported case status refreshed. This is not a guaranteed arrival time.'
        : 'Status received but could not be saved to this device. Keep the case reference and verify directly.');
      if (tracking && !canStartPartnerTracking(result)) {
        stopSensors();
        setTracking(false);
        setNotice('Partner acceptance or fresh assignment is no longer verified. GPS sharing stopped here.');
      }
    } catch (err: any) {
      if (run === generation.current) {
        if (tracking) {
          stopSensors();
          setTracking(false);
        }
        setNotice(err?.message || 'Partner status unavailable. Verify with the emergency organization.');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [isOffline, item, persistStatus, tracking, stopSensors]);

  const beginTracking = async () => {
    if (!userConsents || isOffline || !isVisible || document.hidden ||
        !canStartPartnerTracking(caseStatus || undefined) || !navigator.geolocation?.watchPosition || busyRef.current) {
      setNotice('Fresh, assigned partner acceptance and separate user consent are required. GPS was not shared.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const run = generation.current;
    try {
      // The server checks partner status AGAIN before issuing a short-lived,
      // in-memory tracking session. A cached status alone cannot enable GPS.
      const started = await startPartnerTracking(item);
      if (run !== generation.current || offlineRef.current || !isVisible || document.hidden) {
        if (navigator.onLine) void stopPartnerTracking(started.sessionToken).catch(() => undefined);
        return;
      }
      sessionToken.current = started.sessionToken;
      setCaseStatus(started.status);
      persistStatus(started.status);
      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          if (run !== generation.current || offlineRef.current || !navigator.onLine || document.hidden ||
              !sessionToken.current || Date.now() - lastSentAt.current < 20_000 || inFlight.current) return;
          const controller = new AbortController();
          inFlight.current = controller;
          lastSentAt.current = Date.now();
          void sendPartnerLocation(item, started.sessionToken, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            timestamp: position.timestamp
          }, controller.signal).then((at) => {
            if (run === generation.current) setLastSharedAt(at);
          }).catch((err: any) => {
            if (run === generation.current) {
              stopSensors();
              setTracking(false);
              setNotice(`${err?.message || 'GPS update unconfirmed.'} Local sharing stopped; partner stop notification is not verified.`);
            }
          }).finally(() => {
            if (inFlight.current === controller) inFlight.current = null;
          });
        },
        (error) => {
          if (run !== generation.current) return;
          stopSensors();
          setTracking(false);
          setNotice(`GPS unavailable (${error?.message || 'permission denied'}). Sharing stopped locally; contact the partner directly if needed.`);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 }
      );
      setTracking(true);
      setConfirmOpen(false);
      setUserConsents(false);
      setNotice('Sharing started ONLY while this screen stays open and visible. A GPS update is not proof of responder dispatch.');
    } catch (err: any) {
      if (run === generation.current) setNotice(err?.message || 'Tracking could not start. No GPS was shared.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const stopByUser = async () => {
    const token = stopSensors(); // always stop device GPS FIRST
    setTracking(false);
    setConfirmOpen(false);
    setNotice('GPS sharing stopped on this device. Partner stop confirmation is pending.');
    if (!token || isOffline || !navigator.onLine) {
      setNotice('GPS stopped locally. Offline: partner was NOT notified; contact them directly when you can. No automatic retry.');
      return;
    }
    try {
      if (await stopPartnerTracking(token)) {
        setNotice('GPS stopped locally; authorized partner confirmed the stop request.');
      } else {
        setNotice('GPS stopped locally. Partner did not confirm stopping; contact them directly.');
      }
    } catch {
      setNotice('GPS stopped locally. Partner did NOT confirm the stop request; contact them directly. No automatic retry.');
    }
  };

  useEffect(() => {
    if (!isOffline && isVisible) return;
    if (sessionToken.current) {
      stopSensors();
      setTracking(false);
      setNotice('GPS stopped locally (offline or panel closed). Partner may not have been notified. Restart manually after reconnecting.');
    }
  }, [isOffline, isVisible, stopSensors]);

  useEffect(() => {
    const stopOnLeave = () => {
      if (!document.hidden && navigator.onLine) return;
      if (sessionToken.current) {
        stopSensors();
        setTracking(false);
        setNotice('GPS stopped locally on lock/background/offline. Partner may not have been notified. No automatic resume.');
      }
    };
    document.addEventListener('visibilitychange', stopOnLeave);
    window.addEventListener('offline', stopOnLeave);
    return () => {
      document.removeEventListener('visibilitychange', stopOnLeave);
      window.removeEventListener('offline', stopOnLeave);
      stopSensors(); // no background/location work after unmount
    };
  }, [stopSensors]);

  useEffect(() => {
    if (!tracking || isOffline || !isVisible) return;
    // Poll only during an EXPLICITLY started, active tracking session.
    // Failure or partner revocation stops the watcher; no automatic retries.
    const timer = window.setInterval(() => { void refresh(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [tracking, isOffline, isVisible, refresh]);

  const current = !isOffline && isPartnerCaseCurrent(caseStatus || undefined);
  const accepted = caseStatus?.partnerAccepted === true;
  const canTrack = current && canStartPartnerTracking(caseStatus || undefined) && isVisible && !isOffline;

  return (
    <div className="rounded-lg border border-sky-800 bg-sky-950/30 p-3 text-[11px] text-sky-100 space-y-2" data-testid="authorized-partner-case">
      <div className="font-extrabold text-sky-200">AUTHORIZED PARTNER CASE — VERIFIED STATUS ONLY</div>
      <p className="text-sky-100/80">
        A handoff reference is not a case number or responder acceptance. Only this configured partner can supply a case,
        assigned person, distance and ETA. Offline data is last-known, not live. Call your emergency number if urgent.
      </p>
      {canViewPartnerCase(item) ? (
        <button type="button" onClick={() => void refresh()} disabled={busy || isOffline}
          className="rounded bg-sky-700 px-2 py-1 font-bold disabled:opacity-40" aria-label="Refresh authorized partner case">
          Refresh verified case
        </button>
      ) : (
        <p className="text-amber-300">Status/tracking unavailable for this handoff: no configured case access or receipt expired. Verify with the partner directly; do not resend automatically.</p>
      )}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        <div><dt className="inline font-bold">Case number: </dt><dd className="inline">{accepted && caseStatus?.caseNumber ? caseStatus.caseNumber : 'Not provided by partner'}</dd></div>
        <div><dt className="inline font-bold">Partner acceptance: </dt><dd className="inline">{accepted ? 'Partner reported accepted' : 'Not confirmed'}</dd></div>
        <div><dt className="inline font-bold">Assigned responder: </dt><dd className="inline">{accepted && caseStatus?.assignedResponder ? caseStatus.assignedResponder.name : 'Not provided by partner'}</dd></div>
        <div><dt className="inline font-bold">Arrival time: </dt><dd className="inline">{current && caseStatus?.etaMinutes !== undefined ? `${caseStatus.etaMinutes} minutes (partner-reported, not guaranteed)` : 'Unavailable or stale'}</dd></div>
        <div><dt className="inline font-bold">Distance: </dt><dd className="inline">{current && caseStatus?.distanceKm !== undefined ? `${caseStatus.distanceKm} km (partner-reported)` : 'Unavailable or stale'}</dd></div>
        <div><dt className="inline font-bold">Stage: </dt><dd className="inline">{accepted && caseStatus?.stage || 'Not provided'}</dd></div>
      </dl>
      {caseStatus && <div className="text-sky-200/70">Last partner report: {new Date(caseStatus.updatedAt).toLocaleString()}. {current ? 'Recent report; not a live guarantee.' : 'STALE / OFFLINE — no live arrival estimate.'}</div>}
      {tracking ? (
        <div className="space-y-1.5 border-t border-sky-800 pt-2">
          <div className="font-bold text-amber-200">LIVE GPS ON — only while this panel remains open, online and visible. Last confirmed location: {lastSharedAt ? new Date(lastSharedAt).toLocaleTimeString() : 'not yet confirmed'}.</div>
          <button type="button" onClick={() => void stopByUser()} className="rounded bg-red-700 px-2 py-1 font-bold" aria-label="Stop live GPS sharing">Stop GPS sharing</button>
        </div>
      ) : canViewPartnerCase(item) ? (
        <div className="space-y-2 border-t border-sky-800 pt-2">
          <div className="text-amber-200">Live GPS requires a fresh case, assigned responder, explicit partner tracking acceptance and separate user consent. No GPS points are queued or resumed on reconnect.</div>
          <button type="button" disabled={!canTrack || busy} onClick={() => setConfirmOpen(true)}
            className="rounded bg-emerald-800 px-2 py-1 font-bold disabled:opacity-40" aria-label="Request live GPS sharing">
            Request opt-in live GPS
          </button>
          {confirmOpen && (
            <div className="rounded border border-amber-600 p-2 space-y-2 bg-neutral-950">
              <label className="flex gap-2 items-start font-medium">
                <input type="checkbox" checked={userConsents} onChange={(event) => setUserConsents(event.target.checked)} />
                I agree to share my continuously updated GPS with this authorized partner for this confirmed case while the app is open and visible. I can stop it. Updates already sent cannot be recalled. Lock, airplane mode and closure stop local updates; partner stop may not be confirmed.
              </label>
              <button type="button" disabled={!userConsents || busy} onClick={() => void beginTracking()}
                className="rounded bg-red-700 px-2 py-1 font-bold disabled:opacity-40" aria-label="Confirm and begin partner GPS sharing">Confirm & begin GPS</button>{' '}
              <button type="button" onClick={() => { setConfirmOpen(false); setUserConsents(false); }} className="rounded bg-neutral-700 px-2 py-1">Cancel</button>
            </div>
          )}
        </div>
      ) : null}
      {notice && <p role="status" className="text-amber-200">{notice}</p>}
    </div>
  );
};
