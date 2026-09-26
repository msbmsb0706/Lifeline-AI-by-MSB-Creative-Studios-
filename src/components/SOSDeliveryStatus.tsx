import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  Clock,
  FlaskConical,
  Radio,
  RefreshCw,
  Send,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  PendingSOSItem,
  SOSDeliveryStatus
} from '../types.ts';
import {
  SOS_DELIVERY_STATUS_META,
  getPendingQueue,
  isSOSInFlight,
  retrySingleSOS,
  simulateDemoLifecycleAdvance,
  isDemoSimulatableItem,
  isSimulatedFinalStatus,
  getDeliveryDisplayLabel,
  SIMULATED_DELIVERED_LABEL,
  SIMULATED_ACKNOWLEDGED_LABEL,
  SIMULATED_DELIVERY_EXPLANATION,
  SIMULATED_ACK_EXPLANATION,
  subscribeToQueue
} from '../lib/emergencyPartnerQueue.ts';

interface SOSDeliveryStatusProps {
  /** The SOS package that was confirmed/dispatched from the parent record. */
  sosId: string | null;
  /** Called after a user-initiated retry attempt finishes (for parent toasts/counters). */
  onRetryFinished?: () => void;
  /** User-forced offline mode blocks retries even if the OS reports online. */
  offlineMode?: boolean;
  /** Opens the Pending SOS Queue (share manually / review an authorized send). */
  onOpenQueue?: () => void;
}

/**
 * Always-visible delivery status for an SOS record.
 *
 * Rendered directly on the SOS card after the user confirms an SOS — no extra
 * button is required to see the transmission status. Includes a small
 * expandable "Delivery details" section with the lifecycle timestamps.
 *
 * Trust rules:
 * - SENT is shown only after the configured endpoint accepted the handoff.
 * - DELIVERED / RESPONDER ACKNOWLEDGED are shown only when the configured
 *   receiving integration explicitly provided those confirmations, OR when the
 *   developer/demo user explicitly advances the local record via the clearly
 *   labelled "TEST / DEMO ONLY — Lifecycle Simulator" (which never touches the
 *   network and stamps every transition as simulated). The normal TEST / DEMO
 *   dispatch path never fabricates these states.
 */
export const SOSDeliveryStatusCard: React.FC<SOSDeliveryStatusProps> = ({ sosId, onRetryFinished, offlineMode = false, onOpenQueue }) => {
  const [item, setItem] = useState<PendingSOSItem | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  /** Ticks every second so the "next automatic check" countdown is live. */
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  // TEST / DEMO ONLY local lifecycle simulator busy flag.
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Reflect live queue changes (status transitions happen in the shared queue lib).
  useEffect(() => {
    if (!sosId) {
      setItem(null);
      return;
    }
    const sync = () => {
      const found = getPendingQueue().find((i) => i.sosPackage.sosId === sosId) || null;
      setItem(found);
    };
    sync();
    return subscribeToQueue(sync);
  }, [sosId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Live connectivity for the "Connection" line and retry availability.
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const status: SOSDeliveryStatus | null = item?.status ?? null;
  const meta = status ? SOS_DELIVERY_STATUS_META[status] : null;

  // While a transmission is in flight in this session, always present SENDING
  // even if the persisted write has not landed yet.
  const effectiveStatus: SOSDeliveryStatus | null =
    status && sosId && isSOSInFlight(sosId) && status !== 'FAILED' ? 'SENDING' : status;

  // A simulated final state must NEVER appear to be a real emergency-service
  // acknowledgement. The flag lives in the persisted status history, so the
  // SIMULATED label survives refresh. Real confirmations are unaffected.
  const simulatedFinal = isSimulatedFinalStatus(item);

  const visual = useMemo(() => {
    switch (effectiveStatus) {
      case 'PENDING_LOCAL':
      case 'WAITING_FOR_CONNECTION':
        return {
          dot: '🔴',
          heading: effectiveStatus === 'WAITING_FOR_CONNECTION' ?
            (item?.errorMessage === 'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION' ? item.errorMessage :
            item?.errorMessage?.startsWith('CONNECTION RESTORED') ? 'CONNECTION RESTORED' : 'WAITING FOR CONNECTION') :
            item?.targetPartner.providerType === 'LOCAL_ONLY' ? 'SAVED ON DEVICE — NOT SENT' : 'SOS CONFIRMED',
          container: 'border-red-700/80 bg-red-950/60',
          headingClass: 'text-red-300',
          pulse: false
        };
      case 'UNCONFIRMED':
        return { dot: '🔴', heading: 'HANDOFF UNCONFIRMED — NOT SAFE TO RETRY',
          container: 'border-red-600 bg-red-950/70', headingClass: 'text-red-200', pulse: false };
      case 'SENDING':
        return {
          dot: '🟡',
          heading: 'SENDING SOS...',
          container: 'border-amber-600/80 bg-amber-950/50',
          headingClass: 'text-amber-300',
          pulse: true
        };
      case 'SENT':
        return {
          dot: item?.targetPartner.providerType === 'TEST' ? '🟣' : '🟢',
          heading: item?.targetPartner.providerType === 'TEST' ? 'TEST / DEMO ONLY — NO RESPONDER' : 'SOS SENT',
          container: 'border-emerald-700/80 bg-emerald-950/50',
          headingClass: 'text-emerald-300',
          pulse: false
        };
      case 'DELIVERED':
        return {
          dot: simulatedFinal ? '🟣' : '🟢',
          heading: simulatedFinal ? SIMULATED_DELIVERED_LABEL : 'DELIVERED',
          container: simulatedFinal
            ? 'border-purple-600/80 bg-purple-950/60'
            : 'border-emerald-600/80 bg-emerald-950/60',
          headingClass: simulatedFinal ? 'text-purple-200' : 'text-emerald-300',
          pulse: false
        };
      case 'ACKNOWLEDGED':
        return {
          dot: simulatedFinal ? '🟣' : '🟢',
          heading: simulatedFinal ? SIMULATED_ACKNOWLEDGED_LABEL : 'RESPONDER ACKNOWLEDGED',
          container: simulatedFinal
            ? 'border-purple-500/80 bg-purple-950/70'
            : 'border-emerald-500/80 bg-emerald-950/70',
          headingClass: simulatedFinal ? 'text-purple-200' : 'text-emerald-200',
          pulse: false
        };
      case 'FAILED':
        return {
          dot: '🔴',
          heading: 'DELIVERY FAILED',
          container: 'border-red-600/90 bg-red-950/70',
          headingClass: 'text-red-300',
          pulse: false
        };
      default:
        return null;
    }
  }, [effectiveStatus, simulatedFinal, item?.targetPartner.providerType]);

  if (!item || !effectiveStatus || !visual) return null;

  const isTestProvider = item.targetPartner.providerType === 'TEST';
  const recipientLabel = isTestProvider ? 'TEST / DEMO' : item.targetPartner.providerName;
  const canRetry = (effectiveStatus === 'FAILED' ||
    (effectiveStatus === 'WAITING_FOR_CONNECTION' && item.recoveryBlocked === true)) && isOnline && !offlineMode &&
    (item.targetPartner.providerType === 'AUTHORIZED_API' ||
      (isTestProvider && item.sosPackage.demoOnly === true));

  const handleRetry = async () => {
    if (isRetrying || offlineMode || !navigator.onLine) return;
    setIsRetrying(true);
    try {
      await retrySingleSOS(item.sosPackage.sosId);
    } finally {
      setIsRetrying(false);
      onRetryFinished?.();
    }
  };

  // TEST / DEMO ONLY: advance the local lifecycle record one explicit step
  // (SENT → DELIVERED → ACKNOWLEDGED). No network, no real emergency alert.
  const handleSimulate = async (step: 'DELIVERED' | 'ACKNOWLEDGED') => {
    if (isSimulating) return;
    setIsSimulating(true);
    try {
      simulateDemoLifecycleAdvance(item.sosPackage.sosId, step);
    } finally {
      setIsSimulating(false);
      onRetryFinished?.();
    }
  };

  const formatTime = (iso?: string) =>
    iso ? new Date(iso).toLocaleString() : '—';

  // Lifecycle detail lines (labels fixed for emergency readability).
  const transmissionLabel =
    effectiveStatus === 'PENDING_LOCAL'
      ? item.targetPartner.providerType === 'LOCAL_ONLY'
        ? 'Not sent — stored here for manual sharing'
        : item.automaticRecovery === true
          ? 'Saved locally — automatic send when the connection returns (your opt-in)'
          : 'Saved locally — manual send (SEND NOW / SHARE VIA DEVICE)'
      : effectiveStatus === 'WAITING_FOR_CONNECTION'
      ? item.automaticRecovery === true
        ? 'Saved locally — waiting for the connection, then automatic send'
        : 'Saved locally — waiting for the connection, then manual send'
      : effectiveStatus === 'SENDING'
      ? 'In progress'
      : effectiveStatus === 'FAILED'
      ? 'Failed — retry available'
      : 'Completed';

  // True when the last transition into DELIVERED/ACKNOWLEDGED was produced by the
  // local TEST / DEMO ONLY simulator (never by real partner integration).
  const simulatedDelivery = Boolean(
    item.statusHistory?.some((t) => t.status === 'DELIVERED' && t.simulated)
  );
  const simulatedAcknowledged = Boolean(
    item.statusHistory?.some((t) => t.status === 'ACKNOWLEDGED' && t.simulated)
  );

  const deliveryLabel = simulatedDelivery
    ? `${SIMULATED_DELIVERED_LABEL} — ${formatTime(item.deliveredAt)}. ${SIMULATED_DELIVERY_EXPLANATION}`
    : item.deliveredAt
    ? `Confirmed by receiving system — ${formatTime(item.deliveredAt)}`
    : effectiveStatus === 'FAILED' || effectiveStatus === 'SENDING' || effectiveStatus === 'PENDING_LOCAL' || effectiveStatus === 'WAITING_FOR_CONNECTION'
    ? 'Not available'
    : 'Not confirmed by receiving system';

  const acknowledgementLabel = simulatedAcknowledged
    ? `${SIMULATED_ACKNOWLEDGED_LABEL} — ${formatTime(item.acknowledgedAt)}. ${SIMULATED_ACK_EXPLANATION}`
    : item.acknowledgedAt
    ? `Acknowledged — ${formatTime(item.acknowledgedAt)}`
    : 'Not available';

  // TEST / DEMO ONLY simulator availability: a TEST record that has already been
  // handed off (SENT or later) can advance one explicit step at a time.
  const isTestRecord = isDemoSimulatableItem(item);
  const simulatorAvailable =
    isTestRecord &&
    (effectiveStatus === 'SENT' || effectiveStatus === 'DELIVERED');

  return (
    <div
      id="sos-delivery-status"
      className={`mt-3 rounded-xl border-2 ${visual.container} text-neutral-100`}
      role="status"
      aria-live="polite"
    >
      {/* Collapsed: status always visible — no extra button needed */}
      <div className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className={`text-xs font-black tracking-widest uppercase flex items-center gap-2 ${visual.headingClass}`}>
              <span aria-hidden="true">{visual.dot}</span>
              <span>{visual.heading}</span>
              {visual.pulse && (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-300" aria-hidden="true" />
              )}
            </div>
            <div className="mt-1 text-xs font-bold text-white">{getDeliveryDisplayLabel(item)}</div>
            <div className="text-[11px] text-neutral-300 leading-snug">
              {simulatedFinal && effectiveStatus === 'DELIVERED'
                ? SIMULATED_DELIVERY_EXPLANATION
                : simulatedFinal && effectiveStatus === 'ACKNOWLEDGED'
                ? SIMULATED_ACK_EXPLANATION
                : item.targetPartner.providerType === 'LOCAL_ONLY'
                ? item.errorMessage === 'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION'
                  ? 'Your SOS remains saved locally. Use SEND NOW for an authorized destination, or SHARE VIA DEVICE.'
                  : item.automaticRecovery === true
                  ? 'Saved locally. Automatic recovery requested — but no partner API handoff is enabled without a verified authorized integration. Nothing has been sent yet.'
                  : 'Saved locally. Manual sharing only. Nothing has been sent yet.'
                : effectiveStatus === 'WAITING_FOR_CONNECTION'
                ? item.recoveryBlocked ? `${item.errorMessage || 'Configuration or authorization error.'} Automatic retry stopped. Use SEND NOW or SHARE VIA DEVICE.` :
                  item.errorMessage?.startsWith('CONNECTION RESTORED') ? 'Preparing to send your confirmed SOS...' :
                  item.automaticRecovery === true
                    ? 'Saved locally. Automatic send when the connection returns (your opt-in — authorized partner only). Nothing has been sent yet.'
                    : 'Saved locally. Waiting for the connection — use SEND NOW or SHARE VIA DEVICE when it returns. Nothing has been sent yet.'
                : effectiveStatus === 'UNCONFIRMED'
                ? 'The partner may have received this SOS. Nothing has been confirmed here. Your SOS remains saved locally. Do not retry the API; use SHARE VIA DEVICE or verify directly.'
                : effectiveStatus === 'FAILED'
                ? item.errorMessage || 'Retry available'
                : effectiveStatus === 'SENT'
                ? isTestProvider
                  ? 'Sent to TEST / DEMO ONLY — no real emergency service received it.'
                  : item.automaticRecovery === true
                    ? 'Sent automatically when the connection returned (your opt-in). Awaiting delivery confirmation.'
                    : 'Awaiting delivery confirmation.'
                : meta!.detail}
            </div>
          </div>

          {canRetry && (
            <button
              id="sos-delivery-retry-btn"
              onClick={handleRetry}
              disabled={isRetrying || !isOnline}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-[11px] font-black flex items-center gap-1.5 transition-colors shrink-0"
              title={isOnline ? 'Retry transmitting this SOS' : 'Retry available when connection returns'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
              <span>Retry Now</span>
            </button>
          )}
        </div>

        {/* Expandable delivery details */}
        <button
          id="sos-delivery-details-toggle"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className="mt-2 text-[11px] font-bold text-neutral-300 hover:text-white flex items-center gap-1 transition-colors"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span>Delivery details</span>
        </button>
      </div>

      {/* WHAT HAPPENS NEXT — shown for every record that has NOT been sent.
          "Saved locally" alone is not an answer to "will this ever reach anyone?":
          the exact conditions, the live countdown and the manual escape hatch are
          stated here, in plain language. */}
      {(effectiveStatus === 'PENDING_LOCAL' || effectiveStatus === 'WAITING_FOR_CONNECTION') && (
        <div
          id="sos-what-happens-next"
          className="mx-3 mb-3 p-2.5 rounded-lg bg-black/50 border border-neutral-800 text-[11px] text-neutral-300 space-y-1.5"
        >
          <div className="font-black uppercase tracking-wider text-[10px] text-amber-300">
            What happens next — nothing has been sent yet
          </div>

          {item.automaticRecovery === true ? (
            <ol className="ml-4 list-decimal space-y-1">
              <li>
                This SOS is stored on this device. It will be sent automatically ONLY while this page is open and in
                the foreground.
              </li>
              <li>
                LifeLine re-checks the connection{typeof item.nextRecoveryAt === 'number' && item.nextRecoveryAt > nowTick
                  ? ` in ${Math.max(1, Math.ceil((item.nextRecoveryAt - nowTick) / 1000))} second(s)`
                  : ' within about 5 minutes'}{' '}
                and verifies it against this server — a Wi-Fi icon alone is not enough.
              </li>
              <li>
                {item.errorMessage === 'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION'
                  ? 'No authorized partner destination is configured on the server right now, so nothing can be sent automatically. Use SEND NOW to review a destination, or SHARE VIA DEVICE.'
                  : 'It then needs a configured authorized partner destination. If none is configured, nothing is sent and this card keeps saying NOT SENT.'}
              </li>
              <li>
                GPS, photos and video are never sent automatically. When a send really happens this card turns
                🟢 SOS SENT.
              </li>
            </ol>
          ) : (
            <ol className="ml-4 list-decimal space-y-1">
              <li>This SOS is stored on this device. You chose manual sending, so LifeLine will never send it on its own.</li>
              <li>Open the Pending SOS Queue to review the saved text.</li>
              <li>
                Use <b>SHARE VIA DEVICE</b> (WhatsApp, SMS, call — works on any network) or <b>SEND NOW</b> to review an
                authorized destination when the connection is back.
              </li>
            </ol>
          )}

          {onOpenQueue && (
            <button
              id="sos-open-queue-btn"
              type="button"
              onClick={onOpenQueue}
              className="w-full py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-black text-[11px] flex items-center justify-center gap-1.5 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>OPEN PENDING SOS QUEUE — SHARE OR SEND IT MYSELF</span>
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3">
          <div className="p-3 rounded-lg bg-black/60 border border-neutral-800 space-y-1.5 text-[11px] text-neutral-300">
            <div>
              <span className="text-neutral-500 font-bold">SOS ID:</span>{' '}
              <span className="font-mono text-neutral-200">{item.sosPackage.sosId}</span>
            </div>
            <div>
              <span className="text-neutral-500 font-bold">Created:</span>{' '}
              <span>{formatTime(item.sosPackage.timestamp)}</span>
            </div>
            <div>
              <span className="text-neutral-500 font-bold">Stored:</span>{' '}
              <span>Locally (this device)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500 font-bold">Connection:</span>
              {isOnline ? (
                <span className="flex items-center gap-1 text-emerald-300 font-bold">
                  <Wifi className="w-3 h-3" /> Online
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-300 font-bold">
                  <WifiOff className="w-3 h-3" /> Offline
                </span>
              )}
            </div>
            <div>
              <span className="text-neutral-500 font-bold">Transmission:</span>{' '}
              <span>{transmissionLabel}</span>
              {item.attempts > 0 && (
                <span className="text-neutral-500"> ({item.attempts} attempt{item.attempts === 1 ? '' : 's'})</span>
              )}
            </div>
            <div>
              <span className="text-neutral-500 font-bold">Recipient:</span>{' '}
              <span className={isTestProvider ? 'text-purple-300 font-bold' : 'font-bold'}>
                {recipientLabel}
                {isTestProvider && (
                  <span className="text-purple-400/80"> — DEMONSTRATION ONLY, no real emergency service</span>
                )}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 font-bold">Delivery:</span>{' '}
              <span className={item.deliveredAt ? 'text-emerald-300 font-bold' : 'text-neutral-400'}>
                {deliveryLabel}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 font-bold">Acknowledgement:</span>{' '}
              <span className={item.acknowledgedAt ? 'text-emerald-300 font-bold' : 'text-neutral-400'}>
                {acknowledgementLabel}
              </span>
            </div>
            <div>
              <span className="text-neutral-500 font-bold">Consent:</span>{' '}
              <span className="flex items-center gap-1 inline-flex">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                Confirmed by user — {formatTime(item.userConsentTimestamp)}
              </span>
            </div>
            {item.acknowledgment?.referenceId && (
              <div>
                <span className="text-neutral-500 font-bold">Reference ID:</span>{' '}
                <span className="font-mono text-neutral-200">{item.acknowledgment.referenceId}</span>
              </div>
            )}
            {item.errorMessage && (
              <div className="flex items-start gap-1.5 text-red-300 pt-1 border-t border-neutral-800">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  <span className="font-bold">Last error:</span> {item.errorMessage}
                </span>
              </div>
            )}
            {/* TEST / DEMO ONLY — local lifecycle simulator console.
                Labelled unmistakably and shown only for local TEST records
                that have already been handed off (SENT or later). Advancing
                here never contacts any network or real emergency service. */}
            {simulatorAvailable && (
              <div
                id="demo-lifecycle-simulator"
                className="mt-2 p-2.5 rounded-lg bg-purple-950/50 border-2 border-dashed border-purple-600 space-y-1.5"
              >
                <div className="flex items-center gap-1.5 text-purple-200 font-black uppercase tracking-wider text-[10px]">
                  <FlaskConical className="w-3.5 h-3.5 text-purple-300 shrink-0" aria-hidden="true" />
                  <span>TEST / DEMO ONLY — Lifecycle Simulator</span>
                </div>
                <p className="text-[10px] text-purple-300/90 leading-snug">
                  Advance this local TEST / DEMO record one explicit step:
                  SENT → DELIVERED → ACKNOWLEDGED. Local only — no network, no
                  real emergency service, and the changes are recorded as
                  simulated.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {effectiveStatus === 'SENT' && (
                    <button
                      id="demo-simulate-delivered-btn"
                      onClick={() => handleSimulate('DELIVERED')}
                      disabled={isSimulating}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px] font-black flex items-center gap-1.5 transition-colors"
                    >
                      <FlaskConical className="w-3 h-3" aria-hidden="true" />
                      <span>Simulate DELIVERED</span>
                    </button>
                  )}
                  {effectiveStatus === 'DELIVERED' && (
                    <button
                      id="demo-simulate-acknowledged-btn"
                      onClick={() => handleSimulate('ACKNOWLEDGED')}
                      disabled={isSimulating}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px] font-black flex items-center gap-1.5 transition-colors"
                    >
                      <FlaskConical className="w-3 h-3" aria-hidden="true" />
                      <span>Simulate RESPONDER ACKNOWLEDGED</span>
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* Lifecycle transition timestamps */}
            {item.statusHistory && item.statusHistory.length > 0 && (
              <div className="pt-1.5 border-t border-neutral-800">
                <div className="text-neutral-500 font-bold flex items-center gap-1 mb-1">
                  <Clock className="w-3 h-3" /> Status timeline
                </div>
                <ul className="space-y-0.5">
                  {item.statusHistory.map((t, idx) => (
                    <li key={idx} className="flex items-center gap-1.5">
                      <Radio className="w-2.5 h-2.5 text-neutral-600 shrink-0" aria-hidden="true" />
                      <span className="font-bold text-neutral-300">
                        {SOS_DELIVERY_STATUS_META[t.status]?.label || t.status}
                      </span>
                      <span className="text-neutral-500 font-mono">
                        {new Date(t.timestamp).toLocaleTimeString()}
                      </span>
                      {t.simulated && (
                        <span className="text-[9px] font-black px-1 py-0.5 rounded bg-purple-900 text-purple-200 border border-purple-600">
                          SIMULATED
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-neutral-600">
                        <Send className="w-2.5 h-2.5" aria-hidden="true" />
                        {t.detail ? <span className="truncate max-w-[220px]">{t.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
