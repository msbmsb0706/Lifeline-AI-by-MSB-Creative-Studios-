import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, MapPin, Radio, ShieldAlert, Smartphone, X } from 'lucide-react';
import { classifyEmergencyOffline } from '../lib/offlineClassifier.ts';
import { EmergencyAnalysisResult, SeverityLevel } from '../types.ts';

interface SilentSOSProps {
  offlineMode: boolean;
  onClose: () => void;
  onSaveResult?: (result: EmergencyAnalysisResult) => void;
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

export const SilentSOS: React.FC<SilentSOSProps> = ({ offlineMode, onClose, onSaveResult }) => {
  const [selectedEvent, setSelectedEvent] = useState<QuickEvent | null>(null);
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState<{
    text: string;
    coords?: { latitude: number; longitude: number };
  }>({ text: 'Requesting current location once…' });
  const [locationRequested, setLocationRequested] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageNotice, setImageNotice] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const [sensorSignal, setSensorSignal] = useState(false);
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const motionRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
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

  const createSilentResult = (): EmergencyAnalysisResult => ({
    ...result,
    source: 'offline_fallback',
    model_used: 'LifeLine Local Deterministic Triage Rules',
    timestamp: new Date().toISOString(),
    raw_transcript: message.trim() || selectedEvent?.text || 'Possible emergency reported by silent user trigger.',
    offline_notice: offlineMode ? 'Silent SOS classified locally. No cloud API was called.' : undefined,
    location_coordinates: location.coords || null
  });

  const confirmShare = async () => {
    const silentResult = createSilentResult();
    onSaveResult?.(silentResult);
    const imageNames = images.length ? images.map((file, i) => `${i + 1}. ${file.name}`).join('; ') : 'None';
    const shareText = [
      'SILENT SOS',
      `Emergency type: ${possibleEvent}`,
      `Severity: ${severityLabel(result.severity)}`,
      `Location: ${location.text}`,
      `Timestamp: ${silentResult.timestamp}`,
      `Evidence: ${evidence}`,
      `Message: ${silentResult.raw_transcript}`,
      `Image attachments: ${imageNames}`,
      'This alert is user-confirmed. LifeLine AI does not automatically contact government or rescue services.'
    ].join('\n');

    let notice = '';
    const canAttachFiles =
      images.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files: images });

    if (navigator.share) {
      try {
        const shareData: ShareData = { title: 'LifeLine AI Silent SOS', text: shareText };
        if (canAttachFiles) {
          shareData.files = images;
        }
        await navigator.share(shareData);
        if (images.length > 0 && !canAttachFiles) {
          notice =
            'Share sheet opened. Image files could not be attached because this browser does not support file sharing. Nothing was sent to government or rescue services.';
        }
      } catch {
        /* user cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        notice =
          images.length > 0
            ? 'Alert text copied to clipboard. Image files could not be attached because file sharing is unavailable. Nothing was sent to government or rescue services.'
            : 'Alert text copied to clipboard. Nothing was sent to government or rescue services.';
      } catch {
        notice = 'Sharing remains user-controlled. Clipboard access was unavailable.';
      }
    }

    setShowConfirmation(false);
    if (notice) {
      setShareNotice(notice);
      return;
    }
    onClose();
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={confirmShare} className="py-3 rounded-xl bg-red-600 font-black">
                CONFIRM SHARE
              </button>
              <button
                onClick={() => setShowConfirmation(false)}
                className="py-3 rounded-xl bg-neutral-800 border border-neutral-600 font-black"
              >
                GO BACK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
