import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, MapPin, Radio, ShieldAlert, Smartphone, Video, X, Send, Save, Info } from 'lucide-react';
import { classifyEmergencyOffline } from '../lib/offlineClassifier.ts';
import { detectLanguage } from '../lib/languages.ts';
import { EmergencyAnalysisResult, SeverityLevel } from '../types.ts';
import {
  createSOSPackage,
  createQueuedSOSItem,
  markWaitingForConnection,
  savePendingSOS
} from '../lib/emergencyPartnerQueue.ts';
import { LOCAL_ONLY_PROVIDER } from '../lib/emergencyPartnersData.ts';
import { PartnerConsentModal } from './PartnerConsentModal.tsx';
import { SOSDeliveryStatusCard } from './SOSDeliveryStatus.tsx';

interface SilentSOSProps {
  offlineMode: boolean;
  onClose: () => void;
  onSaveResult?: (result: EmergencyAnalysisResult) => void;
  onQueueUpdated?: () => void;
}

type QuickEvent = { label: string; icon: string; text: string };

const QUICK_EVENTS: QuickEvent[] = [
  { label: 'MEDICAL', icon: '🩺', text: 'Medical emergency. Immediate medical help may be needed.' },
  { label: 'FIRE', icon: '🔥', text: 'Possible fire or smoke emergency.' },
  { label: 'ACCIDENT', icon: '🚗', text: 'Possible accident with injury or vehicle damage.' },
  { label: 'SECURITY', icon: '🚔', text: 'Possible security or dangerous situation.' },
  { label: 'TRAPPED', icon: '🆘', text: 'Person may be trapped and needs rescue.' },
  { label: 'OTHER', icon: '❓', text: 'Possible emergency requiring assessment.' }
];

const MAX_EVIDENCE_IMAGES = 2;
const MAX_VIDEO_SECONDS = 10;

function severityLabel(severity: SeverityLevel | undefined): string {
  if (severity === 5) return 'Critical';
  if (severity === 4) return 'High';
  if (severity === 3) return 'Moderate';
  return 'Unknown';
}

function gpsErrorMessage(code?: number): string {
  if (code === 1) return 'GPS unavailable: permission denied. Location was not included.';
  if (code === 2) return 'GPS unavailable: position could not be determined.';
  if (code === 3) return 'GPS unavailable: location request timed out.';
  return 'GPS unavailable.';
}

export const SilentSOS: React.FC<SilentSOSProps> = ({ offlineMode, onClose, onSaveResult, onQueueUpdated }) => {
  const [selectedEvent, setSelectedEvent] = useState<QuickEvent | null>(null);
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState<{
    text: string;
    coords?: { latitude: number; longitude: number; accuracyMeters?: number };
  }>({ text: 'Requesting current location once…' });
  const [locationRequested, setLocationRequested] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageNotice, setImageNotice] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const [sensorSignal, setSensorSignal] = useState(false);
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showPartnerConsentModal, setShowPartnerConsentModal] = useState(false);
  // Locally saved SOS status is shown directly here, never as a partner dispatch.
  const [dispatchedSosId, setDispatchedSosId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoNotice, setVideoNotice] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MAX_VIDEO_SECONDS);

  const motionRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const videoPreviewRef = useRef<string | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);

  const stopMediaTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const clearCountdown = () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  };

  const revokeVideoPreview = () => {
    if (videoPreviewRef.current) {
      URL.revokeObjectURL(videoPreviewRef.current);
      videoPreviewRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
      revokeVideoPreview();
      clearCountdown();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* already stopped */
        }
      }
      stopMediaTracks();
    };
  }, []);

  useEffect(() => {
    if (locationRequested) return;
    setLocationRequested(true);
    if (!navigator.geolocation) {
      setLocation({ text: 'GPS unavailable: this browser does not support geolocation.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          text: `Available (±${Math.round(position.coords.accuracy)}m) — ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`,
          coords: { latitude: position.coords.latitude, longitude: position.coords.longitude }
        });
      },
      (error) => {
        setLocation({ text: gpsErrorMessage(error?.code) });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }, [locationRequested]);

  useEffect(() => {
    if (!('DeviceMotionEvent' in window)) return;
    const onMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity;
      if (!acceleration) return;
      setSensorAvailable(true);
      const previous = motionRef.current;
      const current = { x: acceleration.x || 0, y: acceleration.y || 0, z: acceleration.z || 0 };
      if (
        previous &&
        Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) + Math.abs(current.z - previous.z) > 24
      ) {
        setSensorSignal(true);
      }
      motionRef.current = current;
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  const result = useMemo(() => {
    const text = message.trim() || selectedEvent?.text || 'Possible emergency reported by silent user trigger.';
    return classifyEmergencyOffline(text, location.text);
  }, [message, selectedEvent, location.text]);

  const possibleEvent = selectedEvent?.label || result.emergency_type || 'Other emergency';
  const gpsAvailable = Boolean(location.coords);
  const evidence = [
    gpsAvailable && 'GPS',
    images.length > 0 && `Image (${images.length})`,
    videoFile && 'Video',
    sensorSignal && 'Sensor',
    'User trigger'
  ]
    .filter(Boolean)
    .join(' / ');

  const addImages = (fileList?: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    const remaining = MAX_EVIDENCE_IMAGES - images.length;
    if (remaining <= 0) {
      setImageNotice('Maximum of two evidence images already selected.');
      return;
    }
    const nextFiles = incoming.slice(0, remaining);
    const nextUrls = nextFiles.map((file) => URL.createObjectURL(file));
    previewUrlsRef.current = [...previewUrlsRef.current, ...nextUrls];
    setImages((prev) => [...prev, ...nextFiles]);
    setImagePreviews((prev) => [...prev, ...nextUrls]);
    setImageNotice(
      offlineMode
        ? 'Images are evidence only. They are not sent to any vision AI model. Offline image analysis unavailable.'
        : 'Images are evidence only. They are not sent to any vision AI model.'
    );
  };

  const removeImage = (index: number) => {
    const url = imagePreviews[index];
    if (url) URL.revokeObjectURL(url);
    previewUrlsRef.current = previewUrlsRef.current.filter((_, i) => i !== index);
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const finishRecording = (keep: boolean) => {
    clearCountdown();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    mediaRecorderRef.current = null;
    stopMediaTracks();
    setIsRecording(false);
    setSecondsLeft(MAX_VIDEO_SECONDS);
    if (!keep) recordedChunksRef.current = [];
  };

  const discardVideo = () => {
    finishRecording(false);
    revokeVideoPreview();
    setVideoFile(null);
    setVideoPreview(null);
    setVideoNotice('SOS video discarded. Nothing was uploaded.');
  };

  const startSosVideo = async () => {
    if (isRecording) return;
    setVideoNotice('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVideoNotice('Short SOS video is not supported in this browser. Photo evidence can still be used.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: true
      });
      mediaStreamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play().catch(() => undefined);
      }
      recordedChunksRef.current = [];
      const preferredTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        finishRecording(false);
        setVideoNotice('Video recording failed. Camera was stopped. Nothing was uploaded.');
      };
      recorder.onstop = () => {
        stopMediaTracks();
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        if (!chunks.length) return;
        const type = recorder.mimeType || 'video/webm';
        const blob = new Blob(chunks, { type });
        const extension = type.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `silent-sos-video.${extension}`, { type });
        revokeVideoPreview();
        const url = URL.createObjectURL(file);
        videoPreviewRef.current = url;
        setVideoFile(file);
        setVideoPreview(url);
        setVideoNotice(
          'SOS video captured locally as evidence only. It is not sent to any vision AI model. Review before sharing.'
        );
      };
      recorder.start(250);
      setIsRecording(true);
      setSecondsLeft(MAX_VIDEO_SECONDS);
      countdownTimerRef.current = window.setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            finishRecording(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (error) {
      stopMediaTracks();
      setIsRecording(false);
      const denied =
        error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      setVideoNotice(
        denied
          ? 'Camera permission denied. Video was not recorded. Photo evidence can still be used.'
          : 'Camera could not be opened. Video was not recorded.'
      );
    }
  };

  const createSilentResult = (): EmergencyAnalysisResult => ({
    ...result,
    source: 'offline_fallback',
    model_used: 'LifeLine Local Deterministic Triage Rules',
    timestamp: new Date().toISOString(),
    raw_transcript: message.trim() || selectedEvent?.text || 'Possible emergency reported by silent user trigger.',
    offline_notice: 'Silent SOS classified locally. No cloud API was called. No SOS was automatically sent.',
    location_coordinates: location.coords || null
  });


  const buildSOSPkg = () => {
    const silentResult = createSilentResult();
    return createSOSPackage({
      emergencyType: possibleEvent,
      category: silentResult.emergency_category,
      severity: result.severity,
      message: message.trim() || selectedEvent?.text || 'Possible emergency reported by silent user trigger.',
      gps: location.coords ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null,
      photos: images.map((f, i) => ({
        type: 'image',
        name: f.name,
        mimeType: f.type,
        sizeBytes: f.size
      })),
      video: videoFile
        ? {
            type: 'video',
            name: videoFile.name,
            mimeType: videoFile.type,
            sizeBytes: videoFile.size
          }
        : null,
      source: 'offline', // Silent SOS classification is always on-device.
      originalTranscript: silentResult.raw_transcript,
      detectedLanguage: silentResult.detected_language
    });
  };

  const handleSaveLocalSOS = ({ automaticRecovery }: { automaticRecovery: boolean }) => {
    const sosPkg = buildSOSPkg();
    const silentResult = createSilentResult();
    onSaveResult?.(silentResult);

    const pendingItem = createQueuedSOSItem({
      sosPackage: sosPkg,
      targetPartner: LOCAL_ONLY_PROVIDER,
      automaticRecovery,
      userConsentTimestamp: new Date().toISOString()
    });

    if (!savePendingSOS(pendingItem)) {
      setShowPartnerConsentModal(false);
      setShowConfirmation(false);
      setShareNotice('SAVE FAILED — storage is full or unavailable. This SOS was NOT queued or sent. Call your local emergency number directly.');
      return;
    }
    // Confirmed while offline: record the waiting state in the lifecycle itself.
    // Still nothing is transmitted.
    if (offlineMode || !navigator.onLine) markWaitingForConnection(pendingItem, 'Device offline when the SOS was confirmed — stored, not sent.');
    onQueueUpdated?.();
    setShowPartnerConsentModal(false);
    setShowConfirmation(false);
    setDispatchedSosId(sosPkg.sosId);
    if (automaticRecovery) window.dispatchEvent(new Event('lifeline-sos-saved'));

    setShareNotice(
      `SAVED ON THIS DEVICE ONLY — NOT SENT. ${automaticRecovery ? 'Automatic recovery requested. No real partner is verified by default; your SOS remains local until an authorized integration is available.' : 'Saved locally. Manual sharing only.'} Nothing has been sent yet. Open the queue to share text manually; photo/video files are NOT stored in this queue, so save or share them now before closing.`
    );
  };

  const confirmShare = async () => {
    const silentResult = createSilentResult();
    onSaveResult?.(silentResult);
    const imageNames = images.length ? images.map((file, i) => `${i + 1}. ${file.name}`).join('; ') : 'None';
    const attachmentFiles = videoFile ? [...images, videoFile] : images;
    const shareText = [
      'SILENT SOS',
      `Emergency type: ${possibleEvent}`,
      `Severity: ${severityLabel(result.severity)}`,
      `Location: ${location.text}`,
      `Timestamp: ${silentResult.timestamp}`,
      `Evidence: ${evidence}`,
      `Message: ${silentResult.raw_transcript}`,
      `Image attachments: ${imageNames}`,
      `Video attachment: ${videoFile ? videoFile.name : 'None'}`,
      'This alert is user-confirmed. LifeLine AI does not automatically contact government or rescue services.'
    ].join('\n');

    let notice = '';
    const canAttachFiles =
      attachmentFiles.length > 0 &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: attachmentFiles });

    if (navigator.share) {
      try {
        const shareData: ShareData = { title: 'LifeLine AI Silent SOS', text: shareText };
        if (canAttachFiles) shareData.files = attachmentFiles;
        await navigator.share(shareData);
        notice = attachmentFiles.length > 0 && !canAttachFiles
          ? 'Share sheet closed. This browser cannot attach files; photo/video bytes were NOT shared. Check your chosen app for delivery.'
          : 'Share sheet closed. LifeLine cannot verify delivery; check the chosen app. Nothing was sent automatically to emergency services.';
      } catch {
        notice = 'Share canceled or failed. No delivery was confirmed; evidence is still on this screen.';
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        notice =
          attachmentFiles.length > 0
            ? 'Alert text copied to clipboard. Photo/video files could not be attached because file sharing is unavailable. Nothing was sent to government or rescue services.'
            : 'Alert text copied to clipboard. Nothing was sent to government or rescue services.';
      } catch {
        notice = 'Sharing remains user-controlled. Clipboard access was unavailable.';
      }
    }

    setShowConfirmation(false);
    setShareNotice(notice || 'Sharing could not be verified. Check the chosen app before closing.');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm overflow-y-auto p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="silent-sos-title"
    >
      <div className="max-w-2xl mx-auto rounded-2xl border-2 border-red-600 bg-neutral-950 text-white shadow-2xl">
        <div className="p-4 sm:p-5 flex items-start justify-between border-b border-neutral-800">
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] text-red-400">LIFELINE AI • SILENT SOS</div>
            <h2 id="silent-sos-title" className="text-2xl font-black mt-1">
              🚨 POSSIBLE EMERGENCY
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              This creates an alert for your review. It never contacts services automatically.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700" aria-label="Cancel Silent SOS">
            <X />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {QUICK_EVENTS.map((event) => (
              <button
                key={event.label}
                onClick={() => setSelectedEvent(event)}
                className={`p-3 rounded-xl border text-left font-black text-xs ${
                  selectedEvent?.label === event.label
                    ? 'bg-red-700 border-white'
                    : 'bg-neutral-900 border-neutral-700 hover:border-red-500'
                }`}
              >
                <span className="text-xl block">{event.icon}</span>
                {event.label}
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            dir="auto"
            lang="mul"
            rows={2}
            placeholder="Optional emergency message (no speaking required)"
            className="w-full rounded-xl bg-black border border-neutral-700 p-3 text-sm outline-none focus:border-red-500"
          />

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 cursor-pointer hover:border-red-500">
              <span className="flex items-center gap-2 font-bold text-sm">
                <Camera className="w-4 h-4 text-red-400" /> Add emergency image
              </span>
              <span className="block text-[11px] text-neutral-400 mt-1">
                Capture or select up to two images. No continuous camera.
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm">
              <div className="flex items-center gap-2 font-bold">
                <MapPin className="w-4 h-4 text-emerald-400" /> Location
              </div>
              <div className={`mt-1 text-xs ${gpsAvailable ? 'text-emerald-300' : 'text-amber-300'}`}>{location.text}</div>
              <div className="text-[10px] text-neutral-500 mt-1">
                One-time current-position request after Silent SOS activation; no background tracking.
              </div>
            </div>
          </div>

          {imagePreviews.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {imagePreviews.map((src, index) => (
                <div key={src} className="rounded-xl overflow-hidden border border-neutral-700 relative">
                  <img
                    src={src}
                    alt={`User-provided emergency evidence ${index + 1}`}
                    className="max-h-48 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-1 right-1 text-[10px] bg-black/70 px-2 py-1 rounded"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          {imageNotice && <div className="p-2 text-xs text-amber-300 bg-amber-950/70 rounded-xl">{imageNotice}</div>}

          <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-bold text-sm">
                <Video className="w-4 h-4 text-red-400" /> Short SOS video
              </span>
              {isRecording && <span className="text-xs font-black text-red-400 animate-pulse">RECORDING {secondsLeft}s</span>}
            </div>
            <p className="text-[11px] text-neutral-400">
              Video is captured only after you tap CAPTURE SOS VIDEO. Recording stops after 10 seconds.
              It stays in this browser tab only; it is NOT uploaded or kept in the SOS queue. Save it to your device before closing.
            </p>
            <video
              ref={liveVideoRef}
              muted
              playsInline
              className={`w-full max-h-48 rounded-lg bg-black object-cover ${isRecording ? 'block' : 'hidden'}`}
            />
            {videoPreview && !isRecording && (
              <video src={videoPreview} controls playsInline className="w-full max-h-48 rounded-lg bg-black" />
            )}
            <div className="flex flex-wrap gap-2">
              {!isRecording && (
                <button
                  type="button"
                  onClick={startSosVideo}
                  className="px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 font-black text-xs"
                >
                  CAPTURE SOS VIDEO
                </button>
              )}
              {isRecording && (
                <>
                  <button
                    type="button"
                    onClick={() => finishRecording(true)}
                    className="px-3 py-2 rounded-lg bg-amber-600 font-black text-xs"
                  >
                    STOP
                  </button>
                  <button
                    type="button"
                    onClick={discardVideo}
                    className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-600 font-black text-xs"
                  >
                    CANCEL
                  </button>
                </>
              )}
              {videoFile && videoPreview && !isRecording && (
                <a href={videoPreview} download={videoFile.name}
                   className="px-3 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-700 font-black text-xs">
                  SAVE VIDEO TO DEVICE
                </a>
              )}
              {videoFile && !isRecording && (
                <button
                  type="button"
                  onClick={discardVideo}
                  className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-600 font-black text-xs"
                >
                  DISCARD AND RETAKE
                </button>
              )}
            </div>
            {videoNotice && <div className="text-[11px] text-amber-300">{videoNotice}</div>}
            {videoFile && <p className="text-[11px] text-amber-300">Partner queue saves file name/type/size ONLY; it cannot upload or recover the recording after this screen closes.</p>}
          </div>

          <div className="rounded-xl bg-red-950/50 border-2 border-red-700 p-4">
            <div className="text-xl font-black mb-3">🚨 POSSIBLE EMERGENCY</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <strong>Possible event:</strong>
              <span>{possibleEvent}</span>
              <strong>Severity:</strong>
              <span>{severityLabel(result.severity)}</span>
              <strong>Location:</strong>
              <span>{location.text}</span>
              <strong>Evidence:</strong>
              <span>{evidence}</span>
            </div>
            <div className="mt-3 text-[11px] text-amber-200">
              Image evidence is not certainty. Sensor data alone is not proof of an emergency.
            </div>
            {sensorAvailable && (
              <div className="mt-2 text-[11px] text-sky-300 flex items-center gap-1">
                <Smartphone className="w-3 h-3" /> Optional motion sensor available{' '}
                {sensorSignal ? '(possible impact signal)' : '(no impact signal)'}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-300">
            <div className="font-bold text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400" /> Locally generated SOS card
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <span>SOS • {possibleEvent}</span>
              <span>Severity: {severityLabel(result.severity)}</span>
              <span>Location: {location.text}</span>
              <span>{new Date().toLocaleString()}</span>
            </div>
            <div className="mt-2 font-black tracking-widest text-red-400">LIFELINE AI • MSB CREATIVE STUDIOS</div>
          </div>

          {/* Live SOS delivery lifecycle status — always visible after confirmation. */}
          <SOSDeliveryStatusCard sosId={dispatchedSosId} offlineMode={offlineMode} onRetryFinished={onQueueUpdated} />

          {shareNotice && (
            <div className="p-3 rounded-xl bg-purple-950/60 border border-purple-700 text-xs text-purple-100">{shareNotice}</div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={() => setShowConfirmation(true)}
              className="py-4 rounded-xl bg-red-600 hover:bg-red-500 font-black text-sm flex items-center justify-center gap-2"
            >
              <ShieldAlert className="w-5 h-5" /> SHARE SOS ALERT
            </button>
            <button
              onClick={onClose}
              className="py-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 font-black text-sm flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" /> CANCEL
            </button>
          </div>
        </div>
      </div>

      {showConfirmation && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-lg w-full rounded-2xl border-2 border-amber-500 bg-neutral-950 p-5 shadow-2xl my-6">
            <h3 className="text-xl font-black text-amber-300">Confirm what will be shared</h3>
            <p className="text-xs text-neutral-300 mt-2">
              Nothing has been shared yet. Review and explicitly confirm. LifeLine AI does not automatically contact
              government agencies, police, ambulance, fire service, or rescue organizations.
            </p>
            <div className="my-4 rounded-xl bg-neutral-900 border border-neutral-700 p-3 text-sm space-y-2">
              <div>
                <b>Emergency type:</b> {possibleEvent}
              </div>
              <div>
                <b>Severity:</b> {severityLabel(result.severity)}
              </div>
              <div>
                <b>Location:</b> {location.text}
              </div>
              <div>
                <b>Timestamp:</b> {new Date().toISOString()}
              </div>
              <div>
                <b>User-provided emergency message:</b> {message || selectedEvent?.text || 'None'}
              </div>
              <div>
                <b>User-provided images:</b> {images.length ? `${images.length} selected` : 'None'}
              </div>
              <div>
                <b>User-provided SOS video:</b> {videoFile ? videoFile.name : 'None'}
              </div>
              {imagePreviews.length > 0 && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {imagePreviews.map((src, index) => (
                    <img
                      key={src}
                      src={src}
                      alt={`Review evidence ${index + 1}`}
                      className="rounded-lg max-h-32 w-full object-cover border border-neutral-700"
                    />
                  ))}
                </div>
              )}
              {videoPreview && (
                <video src={videoPreview} controls playsInline className="w-full max-h-40 rounded-lg bg-black border border-neutral-700" />
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
              <button
                onClick={() => {
                  setShowConfirmation(false);
                  setShowPartnerConsentModal(true);
                }}
                className="py-3 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow"
              >
                <Radio className="w-4 h-4" />
                <span>SAVE SOS ON THIS DEVICE</span>
              </button>
              <button onClick={confirmShare} className="py-3 px-3 rounded-xl bg-red-600 hover:bg-red-500 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow">
                <ShieldAlert className="w-4 h-4" />
                <span>SHARE VIA DEVICE</span>
              </button>
              <button
                onClick={() => setShowConfirmation(false)}
                className="py-3 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 font-bold text-xs sm:text-sm col-span-1 sm:col-span-2"
              >
                GO BACK
              </button>
            </div>
          </div>
        </div>
      )}
      {showPartnerConsentModal && (
        <PartnerConsentModal
          isOpen={showPartnerConsentModal}
          provider={LOCAL_ONLY_PROVIDER}
          sosPackage={buildSOSPkg()}
          isOffline={offlineMode || !navigator.onLine}
          onCancel={() => setShowPartnerConsentModal(false)}
          onConfirm={handleSaveLocalSOS}
        />
      )}
    </div>
  );
};
