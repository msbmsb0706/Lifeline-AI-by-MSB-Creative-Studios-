import React, { useState, useEffect, useMemo } from 'react';
import {
  EmergencyAnalysisResult,
  VisualSOSCard,
  StandardEmergencyCategory
} from '../types.ts';
import { SeverityGauge } from './SeverityGauge.tsx';
import {
  HeartPulse,
  Flame,
  ShieldAlert,
  Car,
  Biohazard,
  Ambulance,
  AlertTriangle,
  Copy,
  Check,
  Volume2,
  Maximize2,
  Minimize2,
  Radio,
  Clock,
  Sparkles,
  WifiOff,
  Activity,
  PhoneCall,
  Zap,
  Languages,
  Globe,
  Lock,
  RefreshCw,
  Eye,
  Columns,
  Share2,
  Shield
} from 'lucide-react';
import { playPing } from '../lib/audio.ts';
import { speakText, speechSynthesisAvailable, stopSpeaking } from '../lib/speech.ts';
import { looksLikeGeneratedDispatch } from '../lib/translationSafety.ts';
import {
  GENERIC_EMERGENCY_GUIDANCE,
  getCountryEmergencyNumber,
  getEmergencyNumberDisplay,
  getSelectedCountry
} from '../lib/emergencyNumbers.ts';
import {
  SUPPORTED_LANGUAGES,
  STANDARDIZED_CATEGORIES,
  getLanguageByCodeOrName
} from '../lib/languages.ts';
import { ShareAlertConfirmModal } from './ShareAlertConfirmModal.tsx';
import { PartnerConsentModal } from './PartnerConsentModal.tsx';
import { SOSDeliveryStatusCard } from './SOSDeliveryStatus.tsx';
import { LOCAL_ONLY_PROVIDER } from '../lib/emergencyPartnersData.ts';
import {
  createSOSPackage,
  createQueuedSOSItem,
  savePendingSOS
} from '../lib/emergencyPartnerQueue.ts';

interface SOSCardViewProps {
  result: EmergencyAnalysisResult;
  highContrast: boolean;
  soundEnabled: boolean;
  onTranslateSOS?: (targetLangCode: string) => Promise<void>;
  isTranslating?: boolean;
  /** Manual OFFLINE mode never sends to a partner, even if the OS reports online. */
  offlineMode?: boolean;
}

export const SOSCardView: React.FC<SOSCardViewProps> = ({
  result,
  highContrast,
  soundEnabled,
  onTranslateSOS,
  isTranslating = false,
  offlineMode = false
}) => {
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedTranslated, setCopiedTranslated] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [strobeActive, setStrobeActive] = useState(false);
  const [strobeTick, setStrobeTick] = useState(false);

  // Target language for translation: default to Tamil or Hindi if original is English, else English
  const sourceCode = result.detected_language?.code || 'en';
  const defaultTarget = sourceCode === 'ta' ? 'en' : 'ta';
  const [selectedTargetLang, setSelectedTargetLang] = useState<string>(
    result.translation?.target_language || defaultTarget
  );

  // User confirmation dialog before sharing alert
  const [showShareConfirmModal, setShowShareConfirmModal] = useState(false);
  const [showPartnerConsent, setShowPartnerConsent] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);

  // A saved local SOS is shown directly on this card, clearly marked NOT SENT.
  const [dispatchedSosId, setDispatchedSosId] = useState<string | null>(null);

  // View mode for SOS card: 'translated' (if available) or 'original' or 'side-by-side'
  const [viewMode, setViewMode] = useState<'translated' | 'original' | 'dual'>(
    result.translation ? 'translated' : 'original'
  );

  // Update view mode if a new translation arrives
  useEffect(() => {
    if (result.translation) {
      setViewMode('translated');
      setSelectedTargetLang(result.translation.target_language);
    }
  }, [result.translation]);

  // A completely new analysis result must never display the previous
  // emergency's delivery lifecycle card. The result timestamp identifies the
  // emergency (translation updates of the same emergency preserve it), so the
  // locally dispatched SOS id resets whenever a different emergency is shown.
  useEffect(() => {
    setDispatchedSosId(null);
  }, [result.timestamp]);

  // Strobe effect for emergency beacon
  useEffect(() => {
    let interval: any;
    if (strobeActive) {
      interval = setInterval(() => {
        setStrobeTick((prev) => !prev);
      }, 350);
    } else {
      setStrobeTick(false);
    }
    return () => clearInterval(interval);
  }, [strobeActive]);

  const copyText = async (text: string, isTrans: boolean) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isTrans) {
        setCopiedTranslated(true);
        setTimeout(() => setCopiedTranslated(false), 2500);
      } else {
        setCopiedOriginal(true);
        setTimeout(() => setCopiedOriginal(false), 2500);
      }
      if (soundEnabled) playPing('sos');
    } catch {
      // Fallback
    }
  };

  const handleSpeakAloud = (textToRead: string, langCode?: string) => {
    if (!speechSynthesisAvailable()) return;

    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);
    const spoken = speakText(textToRead, {
      languageCode: langCode,
      interrupt: true,
      onEnd: () => setIsSpeaking(false)
    });
    if (!spoken.started) setIsSpeaking(false);
  };

  // Map deterministic priority symbols
  const renderPriorityIcon = (symbol: string, className: string = 'w-7 h-7') => {
    switch (symbol.toUpperCase()) {
      case 'HEART_PULSE':
        return <HeartPulse className={className} />;
      case 'FLAME':
        return <Flame className={className} />;
      case 'SHIELD_ALERT':
        return <ShieldAlert className={className} />;
      case 'CAR_CRASH':
        return <Car className={className} />;
      case 'BIOHAZARD':
        return <Biohazard className={className} />;
      case 'AMBULANCE':
        return <Ambulance className={className} />;
      case 'ALERT_TRIANGLE':
      default:
        return <AlertTriangle className={className} />;
    }
  };

  // Color scheme deterministically determined from visual_card.badge_color
  const getBadgeStyle = (color: VisualSOSCard['badge_color']) => {
    switch (color) {
      case 'RED':
        return {
          border: 'border-red-600',
          bg: 'bg-red-950/90',
          bannerBg: 'bg-red-600',
          badgeText: 'text-red-400',
          cardGlow: 'shadow-red-900/40'
        };
      case 'ORANGE':
        return {
          border: 'border-orange-600',
          bg: 'bg-orange-950/90',
          bannerBg: 'bg-orange-600',
          badgeText: 'text-orange-400',
          cardGlow: 'shadow-orange-900/40'
        };
      case 'YELLOW':
        return {
          border: 'border-amber-600',
          bg: 'bg-amber-950/90',
          bannerBg: 'bg-amber-600',
          badgeText: 'text-amber-400',
          cardGlow: 'shadow-amber-900/40'
        };
      case 'BLUE':
        return {
          border: 'border-blue-600',
          bg: 'bg-blue-950/90',
          bannerBg: 'bg-blue-600',
          badgeText: 'text-blue-400',
          cardGlow: 'shadow-blue-900/40'
        };
      case 'GREEN':
      default:
        return {
          border: 'border-emerald-600',
          bg: 'bg-emerald-950/90',
          bannerBg: 'bg-emerald-600',
          badgeText: 'text-emerald-400',
          cardGlow: 'shadow-emerald-900/40'
        };
    }
  };

  const visualCardObj: VisualSOSCard = useMemo(() => {
    if (typeof result.visual_card === 'object' && result.visual_card !== null) {
      const v = result.visual_card as VisualSOSCard;
      return {
        headline: v.headline || `${result.emergency_type || 'EMERGENCY ALERT'}`,
        badge_color: v.badge_color || (result.severity >= 4 ? 'RED' : result.severity === 3 ? 'ORANGE' : 'YELLOW'),
        action_steps: Array.isArray(v.action_steps) && v.action_steps.length > 0
          ? v.action_steps
          : ['Stay in a secure location if possible', 'Keep airway and breathing clear', 'Await responders with phone line active'],
        priority_symbol: v.priority_symbol || 'ALERT_TRIANGLE',
        instructions_for_responders: v.instructions_for_responders || `Priority ${result.severity}/5 distress reported. Immediate response requested.`,
        first_aid_actions: Array.isArray(v.first_aid_actions) && v.first_aid_actions.length > 0
          ? v.first_aid_actions
          : ['Check responsiveness and vitals', 'Do not move injured person unless danger is imminent']
      };
    }
    const cardStr = typeof result.visual_card === 'string' && result.visual_card.trim()
      ? result.visual_card.trim()
      : `${result.emergency_type || 'EMERGENCY ALERT'} (PRIORITY ${result.severity}/5)`;
    return {
      headline: cardStr,
      badge_color: result.severity >= 4 ? 'RED' : result.severity === 3 ? 'ORANGE' : 'YELLOW',
      action_steps: [
        cardStr,
        'Stay calm and move to safe vantage point',
        'Keep phone line available for dispatchers'
      ],
      priority_symbol: 'ALERT_TRIANGLE',
      instructions_for_responders: `Emergency Category: ${result.emergency_type || 'DISTRESS'}. Priority level ${result.severity}/5. Direct access required.`,
      first_aid_actions: ['Keep victim warm and still', 'Monitor vitals until arrival']
    };
  }, [result.visual_card, result.emergency_type, result.severity]);

  const badgeStyle = getBadgeStyle(visualCardObj.badge_color);

  // Standardized Category Metadata
  const currentCategory: StandardEmergencyCategory =
    result.emergency_category || (result.translation?.category as StandardEmergencyCategory) || 'MEDICAL';
  const categoryMeta =
    STANDARDIZED_CATEGORIES.find((c) => c.id === currentCategory) || STANDARDIZED_CATEGORIES[0];

  // Active displayed content based on translation state & viewMode
  const hasTranslation = Boolean(result.translation);

  // Translation display guard (PR #16): a translated_message that looks like
  // generated dispatch/triage boilerplate is NEVER displayed as the user's
  // translated transmission — an explicit error state is shown instead and
  // the original transmission below is preserved.
  const translationFailedValidation =
    Boolean(result.translation) && looksLikeGeneratedDispatch(result.translation?.translated_message || '');
  const safeTranslatedMessage = translationFailedValidation ? '' : result.translation?.translated_message || '';

  // Explicit ONLINE translation failure state. The original transmission stays
  // exactly as the user sent it — an unavailable online translation is never
  // replaced by a silently generated offline one.
  const translationError =
    result.translation_status === 'error' && result.translation_error ? result.translation_error : null;

  // Country-aware emergency number (PR #16): the configured number for the
  // country selected in the partner directory, or an explicit notice when
  // the country is unknown/unconfigured. Never invented, never universal.
  const selectedCountry = getSelectedCountry();
  const configuredEmergencyNumber = getCountryEmergencyNumber(selectedCountry);
  const showTranslated = hasTranslation && viewMode !== 'original';

  const activeHeadline = showTranslated && result.translation?.translated_headline
    ? result.translation.translated_headline
    : visualCardObj.headline;

  const activeActionSteps = showTranslated && result.translation?.translated_action_steps && result.translation.translated_action_steps.length > 0
    ? result.translation.translated_action_steps
    : visualCardObj.action_steps;

  const activeResponderInstructions = showTranslated && result.translation?.translated_instructions_for_responders
    ? result.translation.translated_instructions_for_responders
    : visualCardObj.instructions_for_responders;

  const activeFirstAid = showTranslated && result.translation?.translated_first_aid_actions && result.translation.translated_first_aid_actions.length > 0
    ? result.translation.translated_first_aid_actions
    : visualCardObj.first_aid_actions;

  const activeNeeds = showTranslated && result.translation?.translated_needs && result.translation.translated_needs.length > 0
    ? result.translation.translated_needs
    : result.needs;

  const detectedSourceLangInfo = result.detected_language
    ? getLanguageByCodeOrName(result.detected_language.code)
    : getLanguageByCodeOrName('en');

  const currentTargetLangInfo = getLanguageByCodeOrName(selectedTargetLang);

  const handleTriggerTranslate = () => {
    if (onTranslateSOS) {
      onTranslateSOS(selectedTargetLang);
    }
  };

  const handleConfirmedShare = async () => {
    const alertMessage = showTranslated && safeTranslatedMessage ? safeTranslatedMessage : result.message;

    const locSuffix = result.location_coordinates
      ? `\nGPS Location: https://maps.google.com/?q=${result.location_coordinates.latitude},${result.location_coordinates.longitude} (${result.location_coordinates.latitude.toFixed(5)}, ${result.location_coordinates.longitude.toFixed(5)})`
      : '';

    const sharePayload = `${alertMessage}${locSuffix}\n\n[LifeLine AI by MSB Creative Studios • Emergency Alert]`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `EMERGENCY ALERT: ${activeHeadline}`,
          text: sharePayload
        });
        setShareToast('Device share sheet completed. Recipient delivery is NOT verified; check the app you chose.');
        setTimeout(() => setShareToast(null), 3000);
        return;
      } catch (err) {
        console.log('Share dismissed or cancelled');
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(sharePayload);
      setShareToast('Alert & GPS copied to clipboard for direct sharing');
      setTimeout(() => setShareToast(null), 3500);
    } catch {
      setShareToast('Clipboard access unavailable');
    }
  };

  const handleSaveLocalSOS = () => {
    const sosPkg = createSOSPackage({
      emergencyType: result.emergency_type,
      category: result.emergency_category,
      severity: result.severity,
      message: showTranslated && safeTranslatedMessage ? safeTranslatedMessage : result.message,
      gps: result.location_coordinates ? { latitude: result.location_coordinates.latitude, longitude: result.location_coordinates.longitude } : null,
      source: result.source === 'nebius_nemotron' ? 'online' : 'offline',
      originalTranscript: result.raw_transcript || result.transcript || undefined,
      detectedLanguage: result.detected_language || undefined,
      voiceCapture: result.voice_capture
        ? {
            detectedLanguage: result.voice_capture.detectedLanguage,
            originalTranscript: result.voice_capture.originalTranscript,
            englishTranslation: result.voice_capture.englishTranslation
          }
        : null
    });

    const consentTimestamp = new Date().toISOString();
    const pendingItem = createQueuedSOSItem({
      sosPackage: sosPkg,
      targetPartner: LOCAL_ONLY_PROVIDER,
      userConsentTimestamp: consentTimestamp
    });

    if (!savePendingSOS(pendingItem)) {
      setShowPartnerConsent(false);
      setShareToast('SAVE FAILED — device storage is unavailable or full. This SOS was NOT queued or sent. Call your local emergency number directly.');
      return;
    }
    setShowPartnerConsent(false);
    setDispatchedSosId(sosPkg.sosId);
    setShareToast('SAVED ON THIS DEVICE ONLY — NOT SENT. Nothing uploads on reconnect or restart. Review the saved text in the queue or use Share Alert to send it manually.');
  };

  return (
    <div
      id="visual-sos-card"
      className={`relative mt-6 rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
        badgeStyle.border
      } ${
        strobeTick
          ? 'bg-red-700 ring-8 ring-white shadow-2xl'
          : highContrast
          ? 'bg-black text-white shadow-2xl'
          : `${badgeStyle.bg} text-neutral-100 shadow-2xl ${badgeStyle.cardGlow}`
      } ${isFullScreen ? 'fixed inset-0 z-50 overflow-y-auto p-4 sm:p-8 m-0 rounded-none' : 'p-4 sm:p-6'}`}
    >
      {/* Top Banner: Priority and Standardized Category */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-black/60 border border-white/10 text-white flex items-center justify-center">
            {renderPriorityIcon(visualCardObj.priority_symbol, 'w-6 h-6 sm:w-7 sm:h-7')}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-extrabold uppercase tracking-widest px-2 py-0.5 rounded bg-white text-black">
                PRIORITY {result.severity} / 5
              </span>

              {/* Standardized Emergency Category Badge */}
              <span
                id="standard-category-badge"
                className="text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded bg-neutral-800 text-amber-300 border border-amber-500/40 flex items-center gap-1"
                title={categoryMeta.description}
              >
                <span>CATEGORY:</span>
                <span className="text-white underline decoration-amber-400">{currentCategory}</span>
              </span>
            </div>

            <h2 className="text-lg sm:text-2xl font-black tracking-tight text-white mt-1 leading-tight">
              {activeHeadline}
            </h2>
          </div>
        </div>

        {/* Quick Utility Actions */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Beacon strobe toggle */}
          <button
            id="optical-sos-strobe-btn"
            onClick={() => setStrobeActive((prev) => !prev)}
            title={strobeActive ? 'Disable emergency strobe' : 'Activate optical rescue strobe beacon'}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              strobeActive
                ? 'bg-red-600 text-white animate-pulse ring-2 ring-white'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">{strobeActive ? 'Strobe ON' : 'SOS Beacon'}</span>
          </button>

          {/* Text to speech readout */}
          <button
            id="read-aloud-sos-btn"
            onClick={() => {
              const textToRead = `Emergency Alert: ${activeHeadline}. Priority ${result.severity} of 5. Emergency Category: ${currentCategory}. Type: ${result.emergency_type}. Required assistance: ${activeNeeds.join(', ')}. Instructions: ${activeResponderInstructions}. Immediate action: ${activeActionSteps.join('. ')}`;
              handleSpeakAloud(textToRead, showTranslated ? result.translation?.target_language : result.detected_language?.code);
            }}
            title={isSpeaking ? 'Stop speaking' : 'Read aloud for first responders or bystanders'}
            className={`p-2 rounded-lg text-xs font-bold transition-all ${
              isSpeaking
                ? 'bg-amber-500 text-black'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700'
            }`}
          >
            <Volume2 className="w-4 h-4" />
          </button>

          {/* Store this real SOS locally; never send private text to TEST/DEMO. */}
          <button
            id="save-local-sos-btn"
            onClick={() => setShowPartnerConsent(true)}
            title="Review and save SOS on this device — not sent"
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-700/80 flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
          >
            <Shield className="w-3.5 h-3.5 text-red-400" />
            <span className="hidden sm:inline">Save SOS Locally</span>
          </button>

          {/* Share Alert button with explicit privacy review */}
          <button
            id="share-sos-alert-btn"
            onClick={() => setShowShareConfirmModal(true)}
            title="Review and confirm before sharing emergency alert"
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-purple-950/80 hover:bg-purple-900 text-purple-300 border border-purple-700/80 flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
          >
            <Share2 className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden xs:inline">Share Alert</span>
          </button>

          {/* Full-screen toggle */}
          <button
            id="fullscreen-sos-btn"
            onClick={() => setIsFullScreen((prev) => !prev)}
            title={isFullScreen ? 'Exit full-screen card' : 'Enlarge for first responder presentation'}
            className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition-all"
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Live SOS delivery lifecycle status — always visible after confirmation,
          expandable for delivery details. No extra button required. */}
      <SOSDeliveryStatusCard sosId={dispatchedSosId} offlineMode={offlineMode} />

      {/* Multilingual Emergency Translation Control Bar */}
      <div
        id="multilingual-translation-bar"
        className="my-3 p-3 rounded-xl bg-black/60 border border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs"
      >
        {/* Source Language & Safety Invariant Notice */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-neutral-300">
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <span>Detected Source:</span>
            <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 font-bold text-emerald-300">
              {detectedSourceLangInfo.name} ({detectedSourceLangInfo.nativeName})
            </span>
          </div>

          <div
            className="flex items-center gap-1 text-[11px] text-amber-300/90 font-medium px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800/60"
            title="Safety Rule: Emergency type, category and severity are strictly locked and cannot be changed by translation."
          >
            <Lock className="w-3 h-3 text-amber-400 shrink-0" />
            <span>Severity & Type Locked</span>
          </div>
        </div>

        {/* Target Language Selection & "Translate SOS" Button */}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div className="flex items-center gap-1">
            <Languages className="w-3.5 h-3.5 text-neutral-400" />
            <select
              id="sos-target-lang-select"
              value={selectedTargetLang}
              onChange={(e) => setSelectedTargetLang(e.target.value)}
              disabled={isTranslating}
              className="bg-neutral-800 text-neutral-200 text-xs rounded-lg px-2.5 py-1.5 border border-neutral-700 outline-none cursor-pointer hover:border-neutral-600"
            >
              <optgroup label="International">
                {SUPPORTED_LANGUAGES.filter(l => !l.isIndianRegional).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name} ({l.nativeName})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Indian Regional Languages">
                {SUPPORTED_LANGUAGES.filter(l => l.isIndianRegional).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName} ({l.name})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* "Translate SOS" Action Button */}
          <button
            id="translate-sos-btn"
            onClick={handleTriggerTranslate}
            disabled={isTranslating}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow transition-all ${
              isTranslating
                ? 'bg-neutral-800 text-neutral-400 cursor-wait border border-neutral-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
            }`}
          >
            {isTranslating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-300" />
                <span>Translating SOS...</span>
              </>
            ) : (
              <>
                <Languages className="w-3.5 h-3.5" />
                <span>Translate SOS</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Translation View Mode Toggle (If translation is present) */}
      {hasTranslation && (
        <div className="mb-3 p-2 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-neutral-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Translated into:</span>
            <span className="font-bold text-white uppercase tracking-wide">
              {result.translation?.target_language_name}
            </span>
          </div>

          {/* View selector: Translated | Original | Dual / Side-by-Side */}
          <div className="flex items-center gap-1 bg-black/60 p-1 rounded-lg border border-neutral-800">
            <button
              onClick={() => setViewMode('translated')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                viewMode === 'translated'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Eye className="w-3 h-3 inline mr-1" />
              Show Translated
            </button>
            <button
              onClick={() => setViewMode('original')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                viewMode === 'original'
                  ? 'bg-neutral-700 text-white shadow'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Original ({detectedSourceLangInfo.code.toUpperCase()})
            </button>
            <button
              onClick={() => setViewMode('dual')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                viewMode === 'dual'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Columns className="w-3 h-3 inline mr-1" />
              Dual View
            </button>
          </div>
        </div>
      )}

      {/* Model Attribution & Triage Engine Notice */}
      <div className="my-2.5 py-1.5 px-3 rounded-xl bg-black/40 border border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          {result.source === 'nebius_nemotron' ? (
            <>
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-300">
                Classified & Translated by NVIDIA Nemotron via Nebius Token Factory
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-300 font-semibold">
                Deterministic Multilingual Triage & Translation Engine
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-neutral-400 font-mono">
          {result.latency_ms && <span>{result.latency_ms}ms</span>}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(result.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {result.offline_notice && (
        <div className="mb-3 p-2.5 rounded-xl bg-amber-950/70 border border-amber-800/80 text-amber-200 text-xs flex items-start gap-2">
          <WifiOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Offline Resilience Notice:</div>
            <div>{result.offline_notice}</div>
          </div>
        </div>
      )}

      {/* Core Grid: Standard Category, Emergency Type, Severity Gauge & Required Needs */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 my-4">
        {/* Left Column: Emergency Category & Severity */}
        <div className="md:col-span-5 space-y-3">
          {/* Emergency Type & Standard Category Box */}
          <div className="p-3.5 rounded-xl bg-black/40 border border-neutral-800">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
              <span>Standard Category</span>
              <span className="text-amber-400 font-mono">{currentCategory}</span>
            </div>
            <div className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-red-400" />
              <span>{result.emergency_type}</span>
            </div>
          </div>

          {/* Severity Gauge */}
          <SeverityGauge severity={result.severity} />
        </div>

        {/* Right Column: Required Assistance & Units */}
        <div className="md:col-span-7 p-3.5 rounded-xl bg-black/40 border border-neutral-800 flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-red-400" />
                <span>Required Assistance & Units</span>
              </div>
              {showTranslated && (
                <span className="text-[10px] text-emerald-400 font-bold">
                  {result.translation?.target_language_name}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeNeeds.map((need, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800/90 text-neutral-100 font-bold text-xs border border-neutral-700 flex items-center gap-1"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  {need}
                </span>
              ))}
            </div>
          </div>

          {/* Instructions for Responders on Arrival */}
          <div className="mt-3 pt-3 border-t border-neutral-800">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-1 flex items-center justify-between">
              <span>Responder On-Arrival Directive</span>
              {showTranslated && (
                <span className="text-[10px] text-neutral-400">Translated</span>
              )}
            </div>
            <p className="text-xs sm:text-sm font-semibold text-neutral-200 leading-relaxed bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800">
              "{activeResponderInstructions}"
            </p>
          </div>
        </div>
      </div>

      {/* Immediate Survival Action Steps & First Aid Directives */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-4">
        {/* Action Steps for Victims / Bystanders */}
        <div className="p-3.5 rounded-xl bg-black/40 border border-neutral-800">
          <div className="text-xs font-bold uppercase tracking-wider text-neutral-300 mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span>Immediate Survival Action Steps</span>
            </div>
            {showTranslated && (
              <span className="text-[10px] text-emerald-400 font-mono">
                {result.translation?.target_language_name}
              </span>
            )}
          </div>
          <ol className="space-y-1.5 text-xs text-neutral-200">
            {activeActionSteps.map((step, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="font-mono font-bold text-neutral-400 shrink-0">
                  {idx + 1}.
                </span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* First Aid Actions */}
        <div className="p-3.5 rounded-xl bg-black/40 border border-neutral-800">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>On-Scene First Aid Protocols</span>
            </div>
            {showTranslated && (
              <span className="text-[10px] text-emerald-400 font-mono">
                {result.translation?.target_language_name}
              </span>
            )}
          </div>
          <ul className="space-y-1.5 text-xs text-neutral-200">
            {activeFirstAid.map((act, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold shrink-0">•</span>
                <span className="leading-snug">{act}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 911 / EMS Dispatch Broadcast Transmission Section (Displaying Both Original & Translated Messages) */}
      <div id="dispatch-transmission-container" className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
            <span>Standard Dispatch Radio Transmission</span>
          </div>

          <div className="flex items-center gap-2">
            {hasTranslation && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                Both Messages Preserved
              </span>
            )}
          </div>
        </div>

        {/* Country-aware emergency guidance (PR #16): generic sentence plus
            the configured country number, or an explicit notice. */}
        <div className="mb-2 text-[11px] text-neutral-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{GENERIC_EMERGENCY_GUIDANCE}</span>
          <span className="text-neutral-600">•</span>
          {configuredEmergencyNumber ? (
            <a
              href={`tel:${configuredEmergencyNumber}`}
              className="font-bold text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
            >
              Configured emergency number{selectedCountry ? ` (${selectedCountry})` : ''}: {configuredEmergencyNumber}
            </a>
          ) : (
            <span className="font-bold text-amber-300">{getEmergencyNumberDisplay(selectedCountry)}</span>
          )}
        </div>

        {/* Explicit translation-unavailable state (online translation failed) */}
        {translationError && (
          <div
            id="translation-unavailable-state"
            role="alert"
            className="mb-2 p-2.5 rounded-xl bg-red-950/40 border border-red-700"
          >
            <div className="text-[11px] font-bold text-red-300 flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-red-400" />
              <span>Translation unavailable — original transmission preserved.</span>
            </div>
            <p className="mt-1 text-xs text-red-200/90">{translationError.error}</p>
          </div>
        )}

        {/* Display both original and translated messages */}
        {hasTranslation ? (
          <div className="space-y-3">
            {/* Translated Message Box (or an explicit error state when the
                stored translation failed safety validation) */}
            {translationFailedValidation ? (
              <div className="p-2.5 rounded-xl bg-red-950/40 border border-red-700" role="alert">
                <div className="text-[11px] font-bold text-red-300 flex items-center gap-1.5">
                  <Languages className="w-3.5 h-3.5 text-red-400" />
                  <span>Translation unavailable — safety validation failed.</span>
                </div>
                <p className="mt-1 text-xs text-red-200/90">
                  The received content was rejected because it resembled generated dispatch text. The original transmission below is preserved.
                </p>
              </div>
            ) : (
            <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/60">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                  <Languages className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Translated Transmission ({result.translation?.target_language_name}):</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSpeakAloud(safeTranslatedMessage, result.translation?.target_language)}
                    title="Read translated message aloud"
                    className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-[11px]"
                  >
                    <Volume2 className="w-3 h-3" />
                  </button>
                  <button
                    id="copy-translated-dispatch-btn"
                    onClick={() => copyText(safeTranslatedMessage, true)}
                    className={`text-[11px] px-2 py-0.5 rounded font-semibold flex items-center gap-1 transition-all ${
                      copiedTranslated
                        ? 'bg-emerald-600 text-white'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-emerald-300 border border-neutral-700'
                    }`}
                  >
                    {copiedTranslated ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedTranslated ? 'Copied' : 'Copy Translated'}</span>
                  </button>
                </div>
              </div>
              <pre className="text-xs sm:text-sm font-mono text-emerald-300/95 whitespace-pre-wrap leading-relaxed p-2 rounded-lg bg-black/70 border border-emerald-900/60 select-all">
                {safeTranslatedMessage}
              </pre>
            </div>
            )}

            {/* Original Message Box */}
            <div className="p-2.5 rounded-xl bg-neutral-900/60 border border-neutral-800">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] font-bold text-neutral-300 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Original Transmission ({detectedSourceLangInfo.name}):</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSpeakAloud(result.raw_transcript || result.message, detectedSourceLangInfo.code)}
                    title="Read original message aloud"
                    className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-[11px]"
                  >
                    <Volume2 className="w-3 h-3" />
                  </button>
                  <button
                    id="copy-original-dispatch-btn"
                    onClick={() => copyText(result.raw_transcript || result.message, false)}
                    className={`text-[11px] px-2 py-0.5 rounded font-semibold flex items-center gap-1 transition-all ${
                      copiedOriginal
                        ? 'bg-emerald-600 text-white'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700'
                    }`}
                  >
                    {copiedOriginal ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedOriginal ? 'Copied' : 'Copy Original'}</span>
                  </button>
                </div>
              </div>
              <pre className="text-xs sm:text-sm font-mono text-neutral-300/90 whitespace-pre-wrap leading-relaxed p-2 rounded-lg bg-black/60 border border-neutral-900 select-all">
                {result.raw_transcript || result.message}
              </pre>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-medium text-neutral-400">
                Source Language: {detectedSourceLangInfo.name} ({detectedSourceLangInfo.code.toUpperCase()})
              </div>
              <button
                id="copy-dispatch-msg-btn"
                onClick={() => copyText(result.message, false)}
                className={`text-xs px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
                  copiedOriginal
                    ? 'bg-emerald-600 text-white'
                    : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700'
                }`}
              >
                {copiedOriginal ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Transmission</span>
                  </>
                )}
              </button>
            </div>
            <pre className="text-xs sm:text-sm font-mono text-emerald-300/90 whitespace-pre-wrap leading-relaxed p-2.5 rounded-lg bg-black/60 border border-neutral-900 select-all">
              {result.message}
            </pre>
          </div>
        )}
      </div>

      {/* Original spoken transcript from multilingual voice ASR — preserved for verification.
          The dispatch message above is generated; this is the authoritative user speech. */}
      {result.voice_capture &&
        result.voice_capture.detectedLanguage?.code !== 'en' &&
        result.voice_capture.originalTranscript && (
          <div
            id="sos-original-speech-container"
            className="mt-3 p-3 rounded-xl bg-neutral-950 border border-emerald-900/70"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Original Speech ({result.voice_capture.detectedLanguage?.name || 'Detected language'}) — Authoritative
                </span>
              </div>
              {result.voice_capture.englishTranslation && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                  English Aid Translation Included
                </span>
              )}
            </div>
            <p dir="auto" className="text-xs sm:text-sm text-neutral-200 whitespace-pre-wrap break-words leading-relaxed p-2 rounded-lg bg-black/60 border border-neutral-900 select-all">
              {result.voice_capture.originalTranscript}
            </p>
            {result.voice_capture.englishTranslation && (
              <>
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mt-2 mb-0.5">
                  English (machine translation — aid only)
                </div>
                <p dir="auto" className="text-xs sm:text-sm text-neutral-300 whitespace-pre-wrap break-words leading-relaxed p-2 rounded-lg bg-black/40 border border-neutral-900 select-all">
                  {result.voice_capture.englishTranslation}
                </p>
              </>
            )}
          </div>
        )}

      {/* Official LifeLine AI by MSB Creative Studios Badge */}
      <div className="mt-3 pt-2.5 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
        <div className="flex items-center gap-1.5">
          <img
            src="/logo.png"
            alt="LifeLine AI"
            className="w-4 h-4 rounded object-cover"
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.src.includes('logo.png')) target.src = '/logo.png';
            }}
          />
          <span className="font-bold text-neutral-300">LifeLine AI</span>
          <span className="text-neutral-600">•</span>
          <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-400">
            BY MSB CREATIVE STUDIOS
          </span>
        </div>
        <div className="flex items-center gap-2">
          {result.source === 'nebius_nemotron' && result.nebius_connected && (
            <span
              id="sos-card-nebius-connected-badge"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-600"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Nebius • Nemotron Connected
            </span>
          )}
          <span className="text-[10px] text-neutral-500 font-mono tracking-wide">
            VERIFIED EMERGENCY RECORD
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
            {currentCategory}
          </span>
        </div>
      </div>

      {/* Share Toast Banner */}
      {shareToast && (
        <div
          id="share-status-toast"
          className="mt-3 p-2.5 rounded-xl bg-purple-950 border border-purple-700 text-purple-200 text-xs font-bold flex items-center justify-between animate-fadeIn"
        >
          <span>{shareToast}</span>
          <button
            onClick={() => setShareToast(null)}
            className="text-purple-400 hover:text-white text-xs ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Full-Screen Exit Helper */}
      {isFullScreen && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setIsFullScreen(false)}
            className="px-6 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold border border-neutral-700 shadow-xl"
          >
            Exit Full-Screen SOS View
          </button>
        </div>
      )}

      {/* Share Alert Review & Confirm Modal */}
      <ShareAlertConfirmModal
        isOpen={showShareConfirmModal}
        onClose={() => setShowShareConfirmModal(false)}
        result={result}
        onConfirmShare={handleConfirmedShare}
      />

      {/* Explicit local save; no partner or demo endpoint is used. */}
      {showPartnerConsent && (
        <PartnerConsentModal
          isOpen={showPartnerConsent}
          provider={LOCAL_ONLY_PROVIDER}
          sosPackage={createSOSPackage({
            emergencyType: result.emergency_type,
            category: result.emergency_category,
            severity: result.severity,
            message: showTranslated && safeTranslatedMessage ? safeTranslatedMessage : result.message,
            gps: result.location_coordinates ? { latitude: result.location_coordinates.latitude, longitude: result.location_coordinates.longitude } : null,
            source: result.source === 'nebius_nemotron' ? 'online' : 'offline',
            originalTranscript: result.raw_transcript || result.transcript || undefined,
            detectedLanguage: result.detected_language || undefined
          })}
          isOffline={offlineMode || !navigator.onLine}
          onCancel={() => setShowPartnerConsent(false)}
          onConfirm={handleSaveLocalSOS}
        />
      )}
    </div>
  );
};
