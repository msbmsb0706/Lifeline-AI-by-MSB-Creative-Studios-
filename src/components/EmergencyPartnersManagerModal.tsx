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
  getAutoSendSetting,
  setAutoSendSetting,
  isSOSInFlight,
  markWaitingForConnection,
  processPendingQueue,
  retrySingleSOS,
  createSOSPackage,
  savePendingSOS
} from '../lib/emergencyPartnerQueue.ts';
import { PartnerConsentModal } from './PartnerConsentModal.tsx';
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
  Lock,
  Radio,
  AlertTriangle,
  Info,
  Clock,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

interface EmergencyPartnersManagerModalProps {
  selectedCountry: string;
  onCountryChange: (country: string) => void;
  authorizedPartner?: EmergencyPartnerProvider | null;
  isOpen: boolean;
  onClose: () => void;
  isOffline: boolean;
  onQueueUpdated?: () => void;
}

export const EmergencyPartnersManagerModal: React.FC<
  EmergencyPartnersManagerModalProps
> = ({ isOpen, onClose, isOffline, onQueueUpdated, selectedCountry, onCountryChange: setSelectedCountry, authorizedPartner }) => {
  const [activeTab, setActiveTab] = useState<'providers' | 'queue'>('providers');
  const [pendingItems, setPendingItems] = useState<PendingSOSItem[]>([]);
  const [autoSendEnabled, setAutoSendEnabled] = useState<boolean>(getAutoSendSetting());
  const [isProcessingQueue, setIsProcessingQueue] = useState<boolean>(false);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);

  // Consent modal state for demo dispatch
  const [consentTargetProvider, setConsentTargetProvider] = useState<EmergencyPartnerProvider | null>(null);
  const [demoSOSPackage, setDemoSOSPackage] = useState<any | null>(null);

  useEffect(() => {
    if (isOpen) {
      refreshQueue();
      setAutoSendEnabled(getAutoSendSetting());
    }
  }, [isOpen]);

  const refreshQueue = () => {
    const queue = getPendingQueue();
    setPendingItems(queue);
    onQueueUpdated?.();
  };

  const handleToggleAutoSend = (enabled: boolean) => {
    setAutoSendEnabled(enabled);
    setAutoSendSetting(enabled);
    setQueueNotice(
      enabled
        ? 'Automatic resume enabled: user-confirmed pending SOS packages will transmit when connection returns.'
        : 'Automatic resume disabled: pending SOS packages will stay stored locally until you transmit them manually.'
    );
  };

  // Per-item manual retry (explicit user action; requires connectivity).
  const handleRetryItem = async (sosId: string) => {
    setIsProcessingQueue(true);
    setQueueNotice(null);
    try {
      const res = await retrySingleSOS(sosId);
      refreshQueue();
      if (res.success) {
        setQueueNotice(`SOS ${sosId} transmitted successfully. Partner acknowledgment received.`);
      } else if (res.error) {
        setQueueNotice(`Retry failed for ${sosId}: ${res.error}`);
      }
    } catch (err: any) {
      setQueueNotice(`Retry error: ${err.message}`);
    } finally {
      setIsProcessingQueue(false);
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
    setIsProcessingQueue(true);
    setQueueNotice(null);
    try {
      const res = await processPendingQueue({ forceManual: true });
      refreshQueue();
      if (res.processedCount === 0) {
        setQueueNotice('No approved pending SOS packages available to transmit.');
      } else if (res.errors.length > 0) {
        setQueueNotice(`Processed ${res.processedCount} package(s): ${res.successCount} succeeded. Errors: ${res.errors.join('; ')}`);
      } else {
        setQueueNotice(`Successfully transmitted ${res.successCount} SOS package(s) with provider acknowledgment.`);
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
      source: isOffline ? 'offline' : 'online'
    });

    setDemoSOSPackage(testPackage);
    setConsentTargetProvider(provider);
  };

  const handleConfirmDemoConsent = async () => {
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

    // Save to local queue
    savePendingSOS(pendingItem);
    refreshQueue();

    if (isOffline) {
      markWaitingForConnection(pendingItem, 'Device offline — waiting for connection.');
      setQueueNotice(
        'OFFLINE — SOS saved locally (PENDING LOCAL). It will be sent when a supported connection becomes available.'
      );
      setActiveTab('queue');
      return;
    }

    // Process immediately if online
    setIsProcessingQueue(true);
    try {
      const res = await processPendingQueue({ forceManual: true });
      refreshQueue();
      if (res.successCount > 0) {
        setQueueNotice(
          'DEMO SUCCESS: SOS transmitted to TEST provider. Acknowledgment reference ID received.'
        );
      } else if (res.errors.length > 0) {
        setQueueNotice(`Transmission failed: ${res.errors.join('; ')}`);
      }
    } catch (err: any) {
      setQueueNotice(`Demo transmission failed: ${err.message}`);
    } finally {
      setIsProcessingQueue(false);
      setActiveTab('queue');
    }
  };

  if (!isOpen) return null;

  const currentProviders = getProvidersByCountry(selectedCountry).filter(p => p.providerType !== 'AUTHORIZED_API');
  if (authorizedPartner && (selectedCountry === 'ALL' || authorizedPartner.country === 'GLOBAL' || authorizedPartner.country === selectedCountry)) currentProviders.push(authorizedPartner);
  // "Pending" = not yet handed off (excludes terminal SENT/DELIVERED/ACKNOWLEDGED).
  const pendingCount = pendingItems.filter(
    (i) => !SOS_DELIVERY_STATUS_META[i.status]?.terminal
  ).length;

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
              {/* Country Selection Pills */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">
                  Select Country / Region
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORTED_COUNTRIES.map((c) => (
                    <button
                      key={c.code}
                      onClick={() => setSelectedCountry(c.code)}
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
                    onClick={() => setSelectedCountry('ALL')}
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
                            ? 'AUTHORIZED API (CONFIGURED — UNVERIFIED)'
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
              {/* Connection Setting: Privacy Preserving Auto-Send */}
              <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-extrabold text-white text-xs sm:text-sm">
                      Send pending SOS when connection returns
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      Controls automatic resume of already user-confirmed SOS packages when network connectivity returns. Consent is always captured per SOS before it is queued; this setting only governs automatic resume vs. manual transmit.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleAutoSend(true)}
                      className={`px-3 py-1 rounded-lg font-extrabold text-xs transition-colors ${
                        autoSendEnabled
                          ? 'bg-emerald-600 text-white shadow'
                          : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      ON (Default)
                    </button>
                    <button
                      onClick={() => handleToggleAutoSend(false)}
                      className={`px-3 py-1 rounded-lg font-extrabold text-xs transition-colors ${
                        !autoSendEnabled
                          ? 'bg-amber-600 text-white shadow'
                          : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      OFF
                    </button>
                  </div>
                </div>
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
                    disabled={isProcessingQueue || pendingItems.length === 0}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-extrabold text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        isProcessingQueue ? 'animate-spin' : ''
                      }`}
                    />
                    <span>Transmit Pending Now</span>
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
                    When you save an offline Silent SOS with partner consent, it will appear here for review and transmission.
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
                    const canRetryItem =
                      item.status === 'FAILED' ||
                      item.status === 'PENDING_LOCAL' ||
                      item.status === 'WAITING_FOR_CONNECTION';
                    const sentAt = item.statusHistory?.find(
                      (t) => t.status === 'SENT' || t.status === 'DELIVERED' || t.status === 'ACKNOWLEDGED'
                    )?.timestamp;
                    // True when the active final state was produced by the local
                    // TEST / DEMO ONLY lifecycle simulator (never real partner
                    // integration). Rendered so a simulated DELIVERED/ACKNOWLEDGED
                    // can never be mistaken for a real emergency-service receipt.
                    const isSimulatedFinal =
                      item.status === 'DELIVERED' || item.status === 'ACKNOWLEDGED'
                        ? Boolean(
                            item.statusHistory?.some(
                              (t) => t.status === item.status && t.simulated
                            )
                          )
                        : false;

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
                              {statusMeta.label}
                            </span>

                            {isSimulatedFinal && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-900 text-purple-200 border border-purple-600 uppercase">
                                Simulated
                              </span>
                            )}

                            {canRetryItem && (
                              <button
                                onClick={() => handleRetryItem(item.sosPackage.sosId)}
                                disabled={isProcessingQueue || isSending || isOffline}
                                className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-emerald-400 hover:text-emerald-300"
                                title={isOffline ? 'Retry available when connection returns' : 'Retry transmitting this SOS'}
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${isSending ? 'animate-spin' : ''}`} />
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
                          <div className="col-span-1 sm:col-span-2 truncate">
                            <b>Message:</b> "{item.sosPackage.message}"
                          </div>
                          <div>
                            <b>Created:</b>{' '}
                            {new Date(item.sosPackage.timestamp).toLocaleString()}
                          </div>
                          <div>
                            <b>Attempts:</b> {item.attempts}
                          </div>
                          <div className="col-span-1 sm:col-span-2">
                            <b>Status:</b> {statusMeta.detail}
                          </div>
                          {sentAt && (
                            <div>
                              <b>Handed off:</b> {new Date(sentAt).toLocaleString()}
                            </div>
                          )}
                          <div>
                            <b>Delivery:</b>{' '}
                            {item.deliveredAt ? (
                              <span className="text-emerald-300">Confirmed — {new Date(item.deliveredAt).toLocaleString()}</span>
                            ) : (
                              <span className="text-neutral-500">Not available</span>
                            )}
                          </div>
                          <div>
                            <b>Acknowledgement:</b>{' '}
                            {item.acknowledgedAt ? (
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
                              <span>Partner Acknowledgment Received</span>
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

      {/* Demo Consent Modal */}
      {consentTargetProvider && demoSOSPackage && (
        <PartnerConsentModal
          isOpen={Boolean(consentTargetProvider)}
          provider={consentTargetProvider}
          sosPackage={demoSOSPackage}
          isOffline={isOffline}
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
