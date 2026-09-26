import React, { useState, useEffect } from 'react';
import {
  EmergencyPartnerProvider,
  PendingSOSItem,
  CountryInfo
} from '../types.ts';
import {
  SUPPORTED_COUNTRIES,
  EMERGENCY_PARTNER_PROVIDERS,
  getProvidersByCountry,
  getTestProvider
} from '../lib/emergencyPartnersData.ts';
import {
  SOS_DELIVERY_STATUS_META,
  createQueuedSOSItem,
  getPendingQueue,
  deletePendingSOS,
  clearPendingQueue,
  isSOSInFlight,
  isSimulatedFinalStatus,
  getDeliveryDisplayLabel,
  SIMULATED_DELIVERY_EXPLANATION,
  SIMULATED_ACK_EXPLANATION,
  markWaitingForConnection,
  processPendingQueue,
  retrySingleSOS,
  createSOSPackage,
  savePendingSOS,
  transmitSingleSOSItem
} from '../lib/emergencyPartnerQueue.ts';
import {
  fetchPartnerConfigState,
  getPartnerConfigDisplayText,
  PARTNER_STATUS_UNAVAILABLE_TEXT,
  type PartnerConfigResult
} from '../lib/partnerConfig.ts';
import { getSelectedCountry, setSelectedCountry } from '../lib/emergencyNumbers.ts';
import { PartnerConsentModal } from './PartnerConsentModal.tsx';
import { PublicEmergencyNumbers } from './PublicEmergencyNumbers.tsx';
import { PartnerCaseTrackingPanel } from './PartnerCaseTrackingPanel.tsx';
import {
  ShieldAlert,
  X,
  PhoneCall,
  Globe,
  Wifi,
  WifiOff,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Send,
  Share2,
  Lock,
  Radio,
  AlertTriangle,
  Info,
  Clock,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

interface EmergencyPartnersManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isOffline: boolean;
  onQueueUpdated?: () => void;
}

export const EmergencyPartnersManagerModal: React.FC<
  EmergencyPartnersManagerModalProps
> = ({ isOpen, onClose, isOffline, onQueueUpdated }) => {
  const [selectedCountry, setSelectedCountryState] = useState<string>(() => getSelectedCountry() || 'GLOBAL');
  const [activeTab, setActiveTab] = useState<'providers' | 'queue'>('providers');
  // Authorized-API configuration status for the selected country. Resolved only
  // while online; offline the lookup cannot run (no fetch, explicit notice).
  const [authConfig, setAuthConfig] = useState<PartnerConfigResult | null>(null);
  const [authConfigLoading, setAuthConfigLoading] = useState<boolean>(false);

  const handleSelectedCountryChange = (code: string) => {
    setSelectedCountryState(code);
    setSelectedCountry(code);
  };
  const [pendingItems, setPendingItems] = useState<PendingSOSItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState<boolean>(false);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);

  // Consent modal state for demo dispatch
  const [consentTargetProvider, setConsentTargetProvider] = useState<EmergencyPartnerProvider | null>(null);
  const [demoSOSPackage, setDemoSOSPackage] = useState<any | null>(null);
  // A separate, user-initiated handoff of a LOCAL_ONLY record, available only
  // after the server confirms an authorized partner endpoint is configured.
  const [authorizedReviewItem, setAuthorizedReviewItem] = useState<PendingSOSItem | null>(null);

  useEffect(() => {
    if (isOpen) {
      refreshQueue();
    }
  }, [isOpen]);

  // Resolve the authorized-API configuration status for the selected country
  // whenever the directory is visible and online. Failures (503, timeout,
  // malformed) surface as "unavailable" — never as "not configured".
  useEffect(() => {
    if (!isOpen || isOffline) {
      if (isOffline) setAuthConfigLoading(false);
      return;
    }
    let cancelled = false;
    setAuthConfigLoading(true);
    fetchPartnerConfigState(selectedCountry)
      .then((result) => {
        if (!cancelled) setAuthConfig(result);
      })
      .catch(() => {
        if (!cancelled) setAuthConfig({ state: 'CONFIGURATION_UNAVAILABLE', country: selectedCountry });
      })
      .finally(() => {
        if (!cancelled) setAuthConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, selectedCountry, isOffline]);

  const refreshQueue = () => {
    const queue = getPendingQueue();
    setPendingItems(queue);
    onQueueUpdated?.();
  };

  // Per-item manual retry (explicit user action; requires connectivity).
  const handleRetryItem = async (sosId: string) => {
    if (isOffline) {
      setQueueNotice('OFFLINE MODE — nothing was sent. Retry after reconnecting.');
      return;
    }
    setIsProcessingQueue(true);
    setQueueNotice(null);
    try {
      const res = await retrySingleSOS(sosId);
      refreshQueue();
      if (res.success) {
        const sent = getPendingQueue().find((record) => record.sosPackage.sosId === sosId);
        setQueueNotice(sent?.targetPartner.providerType === 'TEST'
          ? `TEST / DEMO ${sosId} reached only the demonstration endpoint — NO RESPONDER received it.`
          : `SOS ${sosId} handed to the configured authorized partner endpoint. Check status for delivery confirmation.`);
      } else if (res.error) {
        setQueueNotice(`Retry failed for ${sosId}: ${res.error}`);
      }
    } catch (err: any) {
      setQueueNotice(`Retry error: ${err.message}`);
    } finally {
      setIsProcessingQueue(false);
    }
  };

  // Only a deliberate share-sheet/clipboard action can export a saved user SOS.
  // Neither API demo dispatch nor a network event is involved in this path.
  const handleShareItem = async (sosId: string) => {
    const item = getPendingQueue().find((record) => record.sosPackage.sosId === sosId);
    if (!item) { setQueueNotice('SOS not found on this device. Nothing was shared.'); return; }
    const sos = item.sosPackage;
    const text = [
      'EMERGENCY ALERT — shared manually from LifeLine AI',
      `Type: ${sos.emergencyType} | Priority: ${sos.severity}/5`,
      `Message: ${sos.message}`,
      sos.originalTranscript ? `Original words (${sos.detectedLanguage?.name || 'as entered'}): ${sos.originalTranscript}` : '',
      sos.gps ? `Location: https://maps.google.com/?q=${sos.gps.latitude},${sos.gps.longitude}` : 'Location: unavailable',
      `Recorded: ${sos.timestamp}`,
      'No recording is attached to this text. Call your local emergency number directly in immediate danger.'
    ].filter(Boolean).join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Emergency alert — manual share', text });
        setQueueNotice('Device share sheet completed. LifeLine cannot verify that a recipient received the alert. No API dispatch was made.');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setQueueNotice('SOS text copied to clipboard ONLY. Paste into your chosen app to share; no delivery is confirmed.');
      } else {
        setQueueNotice('Share sheet and clipboard are unavailable. The SOS text remains visible here; copy it manually. Nothing was sent.');
      }
    } catch {
      setQueueNotice('Sharing canceled or failed. The SOS remains on this device; delivery is not confirmed.');
    }
  };

  const handleDeleteItem = (sosId: string) => {
    deletePendingSOS(sosId);
    refreshQueue();
    setQueueNotice(`Pending SOS ${sosId} deleted.`);
  };

  const handleClearAll = () => {
    clearPendingQueue();
    refreshQueue();
    setQueueNotice('Pending SOS queue cleared.');
  };

  const handleProcessQueueNow = async () => {
    if (isOffline) {
      setQueueNotice('OFFLINE MODE — no network request was made. Exit offline mode and retry after reconnecting.');
      return;
    }
    setIsProcessingQueue(true);
    setQueueNotice(null);
    try {
      const res = await processPendingQueue({ forceManual: true });
      refreshQueue();
      if (res.processedCount === 0) {
        setQueueNotice('No eligible approved partner API records. To share a locally saved SOS, use Share via device or review an authorized handoff below.');
      } else if (res.errors.length > 0) {
        setQueueNotice(`Processed ${res.processedCount} package(s): ${res.successCount} succeeded. Errors: ${res.errors.join('; ')}`);
      } else {
        setQueueNotice(`Manually processed ${res.successCount} eligible record(s). TEST/DEMO handoffs are demonstrations only — no responder receives them. Check each destination and delivery status.`);
      }
    } catch (err: any) {
      setQueueNotice(`Queue transmission error: ${err.message}`);
    } finally {
      setIsProcessingQueue(false);
    }
  };

  // Launch Demo / Test Dispatch Flow
  const handleInitiateDemoDispatch = (provider: EmergencyPartnerProvider) => {
    const testPackage = createSOSPackage({
      emergencyType: 'MEDICAL EMERGENCY (DEMO)',
      category: 'MEDICAL',
      severity: 3,
      message: 'TEST / DEMO SOS transmission — Simulated distress alert for system validation.',
      gps: { latitude: 37.7749, longitude: -122.4194, accuracyMeters: 10 },
      photos: [
        {
          type: 'image',
          name: 'test-evidence-1.jpg',
          mimeType: 'image/jpeg'
        }
      ],
      video: {
        type: 'video',
        name: 'test-sos-video-10s.webm',
        mimeType: 'video/webm'
      },
      source: isOffline ? 'offline' : 'online',
      demoOnly: true // synthetic training fixture — NEVER real user SOS text
    });

    setDemoSOSPackage(testPackage);
    setConsentTargetProvider(provider);
  };

  const handleConfirmDemoConsent = async (_options?: { includeGps: boolean }) => {
    if (!consentTargetProvider || !demoSOSPackage) return;

    const targetProvider = consentTargetProvider;
    const sosPkg = demoSOSPackage;

    setConsentTargetProvider(null);
    setDemoSOSPackage(null);

    const consentTimestamp = new Date().toISOString();
    const pendingItem = createQueuedSOSItem({
      sosPackage: sosPkg,
      targetPartner: targetProvider,
      userConsentTimestamp: consentTimestamp
    });

    if (!savePendingSOS(pendingItem)) {
      setQueueNotice('SAVE FAILED — storage is full or unavailable. This demo SOS was not queued or sent.');
      setActiveTab('queue');
      return;
    }
    refreshQueue();

    if (isOffline) {
      markWaitingForConnection(pendingItem, 'Offline — manually retry this synthetic demo after reconnecting.');
      setQueueNotice(
        'SAVED LOCALLY — NOT SENT. Reopening or reconnecting will NOT upload this TEST/DEMO record. Retry manually if you want to test. No real emergency service will receive it.'
      );
      setActiveTab('queue');
      return;
    }

    // Only this synthetic record is sent; confirming a demo must not upload
    // any other pending record from the device.
    setIsProcessingQueue(true);
    try {
      const res = await retrySingleSOS(sosPkg.sosId);
      refreshQueue();
      if (res.success) {
        setQueueNotice('TEST / DEMO SUCCESS — synthetic example accepted by demo endpoint ONLY. No real responder received it.');
      } else if (res.error) {
        setQueueNotice(`Demo transmission failed: ${res.error}`);
      }
    } catch (err: any) {
      setQueueNotice(`Demo transmission failed: ${err.message}`);
    } finally {
      setIsProcessingQueue(false);
      setActiveTab('queue');
    }
  };

  const authorizedTemplate = EMERGENCY_PARTNER_PROVIDERS.find(
    (provider) => provider.providerType === 'AUTHORIZED_API' && provider.country === selectedCountry
  );
  const verifiedAuthorizedConfig = !isOffline && !authConfigLoading &&
    authConfig?.state === 'CONFIGURED' && authConfig.country === selectedCountry;

  const handleAuthorizeLocalRecord = (item: PendingSOSItem) => {
    if (!verifiedAuthorizedConfig || !authorizedTemplate || !navigator.onLine ||
        item.targetPartner.providerType !== 'LOCAL_ONLY' || item.sosPackage.demoOnly === true) {
      setQueueNotice('No verified authorized partner for this country/connection. The SOS remains local; nothing was sent.');
      return;
    }
    setAuthorizedReviewItem(item);
  };

  const handleConfirmAuthorizedHandoff = async ({ includeGps }: { includeGps: boolean }) => {
    const reviewed = authorizedReviewItem;
    setAuthorizedReviewItem(null);
    if (!reviewed || !verifiedAuthorizedConfig || !authorizedTemplate || !navigator.onLine) {
      setQueueNotice('Partner configuration/connection changed. Nothing was sent; please review again.');
      return;
    }
    // Re-read immediately before sending: stale modals must not transmit a
    // deleted or changed record. LOCAL_ONLY becomes AUTHORIZED_API only after
    // this specific review/consent, never on startup or reconnect.
    const current = getPendingQueue().find((saved) => saved.sosPackage.sosId === reviewed.sosPackage.sosId);
    if (!current || current.targetPartner.providerType !== 'LOCAL_ONLY' ||
        current.sosPackage.demoOnly === true ||
        !['PENDING_LOCAL', 'WAITING_FOR_CONNECTION', 'FAILED'].includes(current.status)) {
      setQueueNotice('Local SOS changed or was deleted. Nothing was sent; review it again.');
      return;
    }
    const at = new Date().toISOString();
    const approved: PendingSOSItem = {
      ...current,
      targetPartner: { ...authorizedTemplate, apiEnabled: true },
      userApprovedForPartnerTransmission: true,
      gpsApprovedForPartnerTransmission: includeGps && Boolean(current.sosPackage.gps),
      userConsentTimestamp: at,
      statusHistory: [...(current.statusHistory || []), {
        status: 'PENDING_LOCAL', timestamp: at,
        detail: `User explicitly approved authorized-partner handoff; one-time GPS ${includeGps ? 'approved' : 'excluded'}. Live GPS not approved.`
      }]
    };
    if (!savePendingSOS(approved)) {
      setQueueNotice('Device could not save the reviewed handoff. NO partner request was made. Share manually or free storage.');
      return;
    }
    refreshQueue();
    setIsProcessingQueue(true);
    try {
      const result = await transmitSingleSOSItem(approved);
      refreshQueue();
      setQueueNotice(result.success
        ? `Partner endpoint acknowledged handoff for SOS ${approved.sosPackage.sosId}. Case number, responder and ETA require separate partner confirmation; refresh case status below.`
        : `Authorized handoff not confirmed: ${result.error || 'unknown error'}. Verify directly before any manual retry.`);
    } finally {
      setIsProcessingQueue(false);
    }
  };

  if (!isOpen) return null;

  const currentProviders = getProvidersByCountry(selectedCountry);
  // "Pending" = not yet handed off (excludes terminal SENT/DELIVERED/ACKNOWLEDGED).
  const pendingCount = pendingItems.filter(
    (i) => !SOS_DELIVERY_STATUS_META[i.status]?.terminal
  ).length;
  const canSendPartnerRecord = pendingItems.some((item) =>
    item.userApprovedForPartnerTransmission && !SOS_DELIVERY_STATUS_META[item.status]?.terminal &&
    item.status !== 'SENDING' && (item.targetPartner.providerType === 'AUTHORIZED_API' ||
      (item.targetPartner.providerType === 'TEST' && item.sosPackage.demoOnly === true))
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md overflow-y-auto p-3 sm:p-6 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="partner-manager-title"
    >
      <div className="w-full max-w-3xl rounded-2xl border-2 border-red-600 bg-neutral-950 text-white shadow-2xl overflow-hidden my-4">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-neutral-900 border-b border-neutral-800 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-950 text-red-400 border border-red-800 shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black tracking-widest text-red-400 uppercase">
                  COUNTRY-AWARE FRAMEWORK
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                  REALISTIC TEST/DEMO
                </span>
              </div>
              <h2 id="partner-manager-title" className="text-xl font-black">
                Emergency Partners & Services
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
            aria-label="Close Emergency Partners Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Disclaimer / Privacy banner */}
        <div className="px-4 py-2.5 bg-neutral-900/90 border-b border-neutral-800 text-[11px] text-neutral-300 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              LifeLine AI does NOT automatically dispatch government or rescue authorities without an authorized API.
            </span>
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
            <span>Server Side Secrets</span>
            <Lock className="w-3 h-3 text-amber-400" />
          </div>
        </div>

        {/* Main Content Area */}
        <div className="p-4 sm:p-5 space-y-4">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-neutral-800 pb-3">
            <button
              onClick={() => setActiveTab('providers')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                activeTab === 'providers'
                  ? 'bg-red-600 text-white shadow'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white'
              }`}
            >
              Emergency Partners Directory
            </button>
            <button
              onClick={() => setActiveTab('queue')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeTab === 'queue'
                  ? 'bg-red-600 text-white shadow'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white'
              }`}
            >
              <span>Pending SOS Queue</span>
              {pendingCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-black font-black">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>

          {/* Queue Notice Banner */}
          {queueNotice && (
            <div className="p-3 rounded-xl bg-purple-950/80 border border-purple-700 text-xs text-purple-200 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <span>{queueNotice}</span>
              </div>
              <button
                onClick={() => setQueueNotice(null)}
                className="text-purple-300 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {/* TAB 1: PROVIDERS DIRECTORY */}
          {activeTab === 'providers' && (
            <div className="space-y-4">
              {/* Government numbers are public: shown before any country pick,
                  with no sign-in and no location request. */}
              <PublicEmergencyNumbers defaultOpen highlightCountry={selectedCountry === 'ALL' ? null : selectedCountry} />

              {/* Country Selection Pills */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                  Select Country / Region
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORTED_COUNTRIES.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => handleSelectedCountryChange(c.code)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                        selectedCountry === c.code
                          ? 'bg-neutral-100 text-black ring-2 ring-red-500 font-extrabold'
                          : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800'
                      }`}
                    >
                      <span>{c.flag}</span>
                      <span>{c.name}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => handleSelectedCountryChange('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      selectedCountry === 'ALL'
                        ? 'bg-neutral-100 text-black ring-2 ring-red-500'
                        : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800'
                    }`}
                  >
                    View All
                  </button>
                </div>
              </div>

              {/* Providers List */}
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {currentProviders.map((provider) => {
                  const isTest = provider.providerType === 'TEST';
                  const isPublic = provider.providerType === 'PUBLIC_CONTACT';
                  const isAuth = provider.providerType === 'AUTHORIZED_API';

                  return (
                    <div
                      key={provider.id}
                      className={`p-4 rounded-xl border text-xs space-y-2 transition-all ${
                        isTest
                          ? 'bg-purple-950/40 border-purple-700/80'
                          : isPublic
                          ? 'bg-neutral-900/80 border-neutral-800'
                          : 'bg-emerald-950/30 border-emerald-800/80'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-white">
                              {provider.providerName}
                            </span>
                            <span className="text-[10px] text-neutral-400 font-mono">
                              ({provider.countryName})
                            </span>
                          </div>
                          <div className="text-[10px] text-neutral-400 mt-0.5">
                            Service Type:{' '}
                            <span className="text-white font-semibold">
                              {provider.serviceType}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase tracking-wider ${
                            isTest
                              ? 'bg-purple-900/90 text-purple-200 border-purple-600'
                              : isPublic
                              ? 'bg-blue-950 text-blue-300 border-blue-700'
                              : provider.apiEnabled
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                              : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          }`}
                        >
                          {isTest
                            ? 'TEST / DEMO'
                            : isPublic
                            ? 'PUBLIC CONTACT'
                            : provider.apiEnabled
                            ? 'AUTHORIZED API (ACTIVE)'
                            : 'AUTHORIZED API (DISABLED)'}
                        </span>
                      </div>

                      <p className="text-neutral-300 text-xs leading-relaxed">
                        {provider.description}
                      </p>

                      {provider.verifiedOfficialSource && (
                        <div className="text-[10px] text-neutral-400 flex items-center gap-1 font-mono">
                          <span>Verified Source:</span>
                          <span className="text-neutral-300 font-semibold">
                            {provider.verifiedOfficialSource}
                          </span>
                        </div>
                      )}

                      {/* Actions for provider */}
                      <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800/60">
                        {isPublic && (
                          <div className="flex items-center gap-2">
                            {provider.phone && (
                              <a
                                href={`tel:${provider.phone}`}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white font-extrabold rounded-lg flex items-center gap-1 transition-colors text-xs"
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                                <span>Call {provider.phone}</span>
                              </a>
                            )}
                            {provider.website && (
                              <a
                                href={provider.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold rounded-lg flex items-center gap-1 transition-colors text-xs"
                              >
                                <Globe className="w-3.5 h-3.5" />
                                <span>Official Website</span>
                              </a>
                            )}
                          </div>
                        )}

                        {isTest && (
                          <button
                            onClick={() => handleInitiateDemoDispatch(provider)}
                            className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-extrabold rounded-lg flex items-center gap-1.5 transition-colors text-xs shadow"
                          >
                            <Radio className="w-3.5 h-3.5" />
                            <span>TEST / DEMO DISPATCH</span>
                          </button>
                        )}

                        {isAuth && (
                          <div className="text-[11px] text-neutral-400 italic">
                            Requires server-side API integration configuration.
                          </div>
                        )}

                        {isAuth && (
                          <div
                            id={`partner-config-status-${provider.id}`}
                            className="text-[11px] font-bold"
                            role="status"
                          >
                            {isOffline ? (
                              <span className="text-amber-300">{PARTNER_STATUS_UNAVAILABLE_TEXT}</span>
                            ) : authConfigLoading ? (
                              <span className="text-neutral-400">Checking Emergency API configuration…</span>
                            ) : authConfig ? (
                              <span
                                className={
                                  authConfig.state === 'CONFIGURED'
                                    ? 'text-emerald-300'
                                    : authConfig.state === 'NOT_CONFIGURED'
                                    ? 'text-neutral-300'
                                    : 'text-amber-300'
                                }
                              >
                                {getPartnerConfigDisplayText(authConfig)}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: PENDING QUEUE & SETTINGS */}
          {activeTab === 'queue' && (
            <div className="space-y-4">
              {/* Per-record opt-in only; legacy and demo records never auto-send. */}
              <div className="p-4 rounded-xl bg-neutral-900 border border-amber-800 space-y-2">
                <div className="font-extrabold text-amber-200 text-xs sm:text-sm">SAVED SOS — PER-RECORD CONSENT</div>
                <p className="text-[11px] text-neutral-300">
                  Only records explicitly opted in to automatic recovery may send after backend verification, while this app can execute. Otherwise use Share via device;
                  an authorized partner API must be configured before any direct API dispatch is possible.
                  TEST/DEMO records are synthetic and never alert responders.
                </p>
              </div>

              {/* Pending Items Actions */}
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-white flex items-center gap-2">
                  <span>Local Pending Queue ({pendingItems.length})</span>
                  <span
                    className={`text-[10px] font-normal px-2 py-0.5 rounded border ${
                      isOffline
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    }`}
                  >
                    {isOffline ? 'Offline' : 'Online Connection Active'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleProcessQueueNow}
                    disabled={isProcessingQueue || isOffline || !canSendPartnerRecord}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-extrabold text-xs flex items-center gap-1.5 transition-colors"
                    title="Only explicitly approved synthetic demos or configured authorized partner records; local SOS stays here"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        isProcessingQueue ? 'animate-spin' : ''
                      }`}
                    />
                    <span>Send Eligible Partner Records</span>
                  </button>

                  {pendingItems.length > 0 && (
                    <button
                      onClick={handleClearAll}
                      className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-red-400 font-bold text-xs flex items-center gap-1 transition-colors"
                      title="Clear all local pending SOS records"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Pending Queue Items List */}
              {pendingItems.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-neutral-900/50 border border-neutral-800 text-neutral-400 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
                  <p className="font-bold text-white">No pending SOS packages in queue.</p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Save an SOS locally to review and share its text manually, online or offline. Only synthetic demos use the TEST endpoint.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                  {pendingItems.map((item) => {
                    const statusMeta = SOS_DELIVERY_STATUS_META[item.status] || SOS_DELIVERY_STATUS_META.PENDING_LOCAL;
                    const isTerminal = statusMeta.terminal;
                    const isSending =
                      item.status === 'SENDING' || (isSOSInFlight(item.sosPackage.sosId) && !isTerminal && item.status !== 'FAILED');
                    const isFailed = item.status === 'FAILED';
                    const canRetryItem = item.userApprovedForPartnerTransmission &&
                      (item.targetPartner.providerType === 'AUTHORIZED_API' ||
                        (item.targetPartner.providerType === 'TEST' && item.sosPackage.demoOnly === true)) &&
                      (item.status === 'FAILED' || item.status === 'PENDING_LOCAL' ||
                        item.status === 'WAITING_FOR_CONNECTION');
                    const sentAt = item.statusHistory?.find(
                      (t) => t.status === 'SENT' || t.status === 'DELIVERED' || t.status === 'ACKNOWLEDGED'
                    )?.timestamp;
                    // True when the active final state was produced by the local
                    // TEST / DEMO ONLY lifecycle simulator (never real partner
                    // integration). Rendered so a simulated DELIVERED/ACKNOWLEDGED
                    // can never be mistaken for a real emergency-service receipt.
                    const isSimulatedFinal = isSimulatedFinalStatus(item);
                    const simulatedDeliveryLine = Boolean(
                      item.statusHistory?.some((t) => t.status === 'DELIVERED' && t.simulated)
                    );
                    const simulatedAckLine = Boolean(
                      item.statusHistory?.some((t) => t.status === 'ACKNOWLEDGED' && t.simulated)
                    );

                    return (
                      <div
                        key={item.sosPackage.sosId}
                        className={`p-3.5 rounded-xl border text-xs space-y-2 transition-all ${
                          isTerminal
                            ? 'bg-emerald-950/30 border-emerald-800/80'
                            : isFailed
                            ? 'bg-red-950/40 border-red-800/80'
                            : 'bg-amber-950/30 border-amber-800/80'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white">
                              {item.sosPackage.sosId}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 font-extrabold">
                              P{item.sosPackage.severity}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase ${
                                isSending
                                  ? 'bg-purple-900 text-purple-200 border-purple-600 animate-pulse'
                                  : isFailed
                                  ? 'bg-red-900 text-red-200 border-red-600'
                                  : isTerminal
                                  ? 'bg-emerald-900 text-emerald-200 border-emerald-600'
                                  : 'bg-amber-900 text-amber-200 border-amber-600'
                              }`}
                              title={statusMeta.detail}
                            >
                              {getDeliveryDisplayLabel(item)}
                            </span>

                            {isSimulatedFinal && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-900 text-purple-200 border border-purple-600 uppercase">
                                Simulated
                              </span>
                            )}

                            {item.targetPartner.providerType === 'LOCAL_ONLY' && verifiedAuthorizedConfig && authorizedTemplate && (
                              <button
                                onClick={() => handleAuthorizeLocalRecord(item)}
                                className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100 flex items-center gap-1"
                                title="Review this local SOS for one-time authorized-partner handoff"
                                aria-label={`Review SOS ${item.sosPackage.sosId} for authorized partner handoff`}
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold">SEND NOW — review partner</span>
                              </button>
                            )}
                            <button
                              onClick={() => void handleShareItem(item.sosPackage.sosId)}
                              className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-amber-300 hover:text-white flex items-center gap-1"
                              title="Manually share SOS text and saved location (if any) via device or clipboard — no partner API upload"
                              aria-label={`Share SOS ${item.sosPackage.sosId} manually`}
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-bold">SHARE VIA DEVICE{item.sosPackage.gps ? ' + location' : ''}</span>
                            </button>
                            {canRetryItem && (
                              <button
                                onClick={() => handleRetryItem(item.sosPackage.sosId)}
                                disabled={isProcessingQueue || isSending || isOffline}
                                className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-emerald-400 hover:text-emerald-300"
                                title={isOffline ? 'Retry available when connection returns' : 'Retry transmitting this SOS'}
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${isSending ? 'animate-spin' : ''}`} />
                                <span className="text-[10px] font-bold">SEND NOW</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleDeleteItem(item.sosPackage.sosId)}
                              className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-red-400"
                              title="Delete this pending SOS"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-neutral-300">
                          <div>
                            <b>Destination:</b> {item.targetPartner.providerName}
                          </div>
                          <div>
                            <b>Type:</b> {item.sosPackage.emergencyType}
                          </div>
                          <div className="col-span-1 sm:col-span-2 whitespace-pre-wrap break-words" dir="auto">
                            <b>Message:</b> "{item.sosPackage.message}"
                          </div>
                          {item.sosPackage.originalTranscript && (
                            <div className="col-span-1 sm:col-span-2 whitespace-pre-wrap break-words" dir="auto">
                              <b>Original words ({item.sosPackage.detectedLanguage?.name || 'as entered'}):</b>{' '}
                              {item.sosPackage.originalTranscript}
                            </div>
                          )}
                          {item.sosPackage.translation?.translatedMessage && (
                            <div className="col-span-1 sm:col-span-2 whitespace-pre-wrap break-words text-emerald-200" dir="auto">
                              <b>Translation of those words ({item.sosPackage.translation.targetLanguageName}):</b>{' '}
                              {item.sosPackage.translation.translatedMessage}
                            </div>
                          )}
                          {item.sosPackage.gps && (
                            <div className="col-span-1 sm:col-span-2 text-amber-200">
                              <b>Location included in manual share:</b> {item.sosPackage.gps.latitude}, {item.sosPackage.gps.longitude}
                            </div>
                          )}
                          <div>
                            <b>Created:</b>{' '}
                            {new Date(item.sosPackage.timestamp).toLocaleString()}
                          </div>
                          <div>
                            <b>Attempts:</b> {item.attempts}
                          </div>
                          <div className="col-span-1 sm:col-span-2">
                            <b>Status:</b> {item.targetPartner.providerType === 'LOCAL_ONLY'
                              ? item.errorMessage === 'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION'
                                ? 'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION. Your SOS remains saved locally. SEND NOW (review authorized partner) or SHARE VIA DEVICE.'
                                : item.automaticRecovery === true
                                ? 'WAITING FOR CONNECTION — automatic recovery requested, but no unverified real partner will be contacted. Nothing has been sent; Share via device remains available.'
                                : 'On this device only — not sent. Manual sharing only.'
                              : item.targetPartner.providerType === 'TEST' && !item.sosPackage.demoOnly
                              ? 'Older real SOS saved for TEST/DEMO — API send blocked. Use Share via device.'
                              : item.status === 'UNCONFIRMED' ? 'HANDOFF UNCONFIRMED. Partner may have received this SOS. No API retry; SHARE VIA DEVICE or verify directly.'
                              : item.recoveryBlocked ? `${item.errorMessage || 'Authorized dispatch unavailable.'} Automatic retry stopped. Use SEND NOW or SHARE VIA DEVICE.` : statusMeta.detail}
                          </div>
                          {sentAt && (
                            <div>
                              <b>Handed off:</b> {new Date(sentAt).toLocaleString()}
                            </div>
                          )}
                          <div>
                            <b>Delivery:</b>{' '}
                            {simulatedDeliveryLine ? (
                              <span className="text-purple-300">{SIMULATED_DELIVERY_EXPLANATION}</span>
                            ) : item.deliveredAt ? (
                              <span className="text-emerald-300">Confirmed — {new Date(item.deliveredAt).toLocaleString()}</span>
                            ) : (
                              <span className="text-neutral-500">Not available</span>
                            )}
                          </div>
                          <div>
                            <b>Acknowledgement:</b>{' '}
                            {simulatedAckLine ? (
                              <span className="text-purple-300">{SIMULATED_ACK_EXPLANATION}</span>
                            ) : item.acknowledgedAt ? (
                              <span className="text-emerald-300">Confirmed — {new Date(item.acknowledgedAt).toLocaleString()}</span>
                            ) : (
                              <span className="text-neutral-500">Not available</span>
                            )}
                          </div>
                        </div>

                        {/* Provider Acknowledgment Details */}
                        {item.acknowledgment && (
                          <div className="p-2.5 rounded-lg bg-black/60 border border-emerald-700/80 text-[11px] space-y-1">
                            <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{item.targetPartner.providerType === 'TEST'
                                ? 'TEST / DEMO ENDPOINT ONLY — NO RESPONDER'
                                : 'Partner Acknowledgment Received'}</span>
                            </div>
                            <div className="font-mono text-emerald-300">
                              Reference ID:{' '}
                              <span className="font-extrabold text-white">
                                {item.acknowledgment.referenceId}
                              </span>
                            </div>
                            <div className="text-neutral-400 italic">
                              "{item.acknowledgment.message}"
                            </div>
                          </div>
                        )}

                        {item.targetPartner.providerType === 'AUTHORIZED_API' && item.acknowledgment?.caseAccessToken && (
                          <PartnerCaseTrackingPanel
                            item={item}
                            isOffline={isOffline}
                            isVisible={isOpen && activeTab === 'queue'}
                            onCaseUpdated={refreshQueue}
                          />
                        )}

                        {item.errorMessage && (
                          <div className="p-2 rounded bg-red-950/80 border border-red-700 text-[11px] text-red-300">
                            <b>Error:</b> {item.errorMessage}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Authorized partner handoff review — distinct from local save and live GPS consent. */}
      {authorizedReviewItem && authorizedTemplate && (
        <PartnerConsentModal
          isOpen={true}
          provider={authorizedTemplate}
          sosPackage={authorizedReviewItem.sosPackage}
          isOffline={isOffline}
          allowGpsSelection={true}
          onCancel={() => setAuthorizedReviewItem(null)}
          onConfirm={handleConfirmAuthorizedHandoff}
        />
      )}

      {/* Demo Consent Modal */}
      {consentTargetProvider && demoSOSPackage && (
        <PartnerConsentModal
          isOpen={Boolean(consentTargetProvider)}
          provider={consentTargetProvider}
          sosPackage={demoSOSPackage}
          isOffline={isOffline}
          allowGpsSelection={false}
          onCancel={() => {
            setConsentTargetProvider(null);
            setDemoSOSPackage(null);
          }}
          onConfirm={handleConfirmDemoConsent}
        />
      )}
    </div>
  );
};
