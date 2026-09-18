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

const severityLabel = (severity: SeverityLevel | undefined) =>
  severity === 5 ? 'Critical' : severity === 4 ? 'High' : severity === 3 ? 'Moderate' : 'Unknown';

export const SilentSOS: React.FC<SilentSOSProps> = ({ offlineMode, onClose, onSaveResult }) => {
  const [selectedEvent, setSelectedEvent] = useState<QuickEvent | null>(null);
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState<{ text: string; coords?: { latitude: number; longitude: number } }>({ text: 'Not available' });
  const [locationRequested, setLocationRequested] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageNotice, setImageNotice] = useState('');
  const [sensorSignal, setSensorSignal] = useState(false);
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const motionRef = useRef<{ x: number; y: number; z: number } | null>(null);

  // One permission request and one position read per activation. No watcher/background tracking.
  useEffect(() => {
    if (locationRequested) return;
    setLocationRequested(true);
    if (!navigator.geolocation) {
      setLocation({ text: 'Not available' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setLocation({
        text: `Available (±${Math.round(position.coords.accuracy)}m)`,
        coords: { latitude: position.coords.latitude, longitude: position.coords.longitude }
      }),
      () => setLocation({ text: 'Not available' }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }, [locationRequested]);

  // Motion is an optional, activation-scoped signal only. It never proves an emergency.
  useEffect(() => {
    if (!('DeviceMotionEvent' in window)) return;
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a) return;
      setSensorAvailable(true);
      const previous = motionRef.current;
      const current = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };
      if (previous && Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) + Math.abs(current.z - previous.z) > 24) {
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
  const evidence = [location.text !== 'Not available' && 'GPS', image && 'Image', sensorSignal && 'Sensor', 'User trigger'].filter(Boolean).join(' / ');

  const selectImage = (file?: File) => {
    if (!file) return;
    setImage(file);
    setImagePreview(URL.createObjectURL(file));
    setImageNotice(offlineMode ? 'Offline image analysis unavailable' : 'Possible visual evidence supplied; image interpretation is not certain.');
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
    const shareText = `SILENT SOS\nEmergency type: ${possibleEvent}\nSeverity: ${severityLabel(result.severity)}\nLocation: ${location.text}\nEvidence: ${evidence}\nMessage: ${silentResult.raw_transcript}${image ? `\nImage: ${image.name} (user-provided)` : ''}`;
    if (navigator.share) {
      try {
        const shareData: ShareData = { title: 'LifeLine AI Silent SOS', text: shareText };
        if (image && typeof navigator.canShare === 'function' && navigator.canShare({ files: [image] })) {
          shareData.files = [image];
        }
        await navigator.share(shareData);
      } catch { /* user cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(shareText); } catch { /* sharing remains user-controlled */ }
    }
    setShowConfirmation(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm overflow-y-auto p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="silent-sos-title">
      <div className="max-w-2xl mx-auto rounded-2xl border-2 border-red-600 bg-neutral-950 text-white shadow-2xl">
        <div className="p-4 sm:p-5 flex items-start justify-between border-b border-neutral-800">
          <div>
            <div className="text-[10px] font-black tracking-[0.2em] text-red-400">LIFELINE AI • SILENT SOS</div>
            <h2 id="silent-sos-title" className="text-2xl font-black mt-1">🚨 POSSIBLE EMERGENCY</h2>
            <p className="text-xs text-neutral-400 mt-1">This creates an alert for your review. It never contacts services automatically.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700" aria-label="Cancel Silent SOS"><X /></button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {QUICK_EVENTS.map((event) => (
              <button key={event.label} onClick={() => setSelectedEvent(event)} className={`p-3 rounded-xl border text-left font-black text-xs ${selectedEvent?.label === event.label ? 'bg-red-700 border-white' : 'bg-neutral-900 border-neutral-700 hover:border-red-500'}`}>
                <span className="text-xl block">{event.icon}</span>{event.label}
              </button>
            ))}
          </div>

          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="Optional emergency message (no speaking required)" className="w-full rounded-xl bg-black border border-neutral-700 p-3 text-sm outline-none focus:border-red-500" />

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 cursor-pointer hover:border-red-500">
              <span className="flex items-center gap-2 font-bold text-sm"><Camera className="w-4 h-4 text-red-400" /> Add emergency image</span>
              <span className="block text-[11px] text-neutral-400 mt-1">Capture or select one image only. No continuous camera.</span>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => selectImage(e.target.files?.[0])} />
            </label>
            <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm">
              <div className="flex items-center gap-2 font-bold"><MapPin className="w-4 h-4 text-emerald-400" /> Location</div>
              <div className={`mt-1 text-xs ${location.text.startsWith('Available') ? 'text-emerald-300' : 'text-amber-300'}`}>{location.text}</div>
              <div className="text-[10px] text-neutral-500 mt-1">One-time permission request; no background tracking.</div>
            </div>
          </div>

          {imagePreview && <div className="rounded-xl overflow-hidden border border-neutral-700"><img src={imagePreview} alt="User-provided emergency evidence" className="max-h-48 w-full object-cover" />{imageNotice && <div className="p-2 text-xs text-amber-300 bg-amber-950/70">{imageNotice}</div>}</div>}

          <div className="rounded-xl bg-red-950/50 border-2 border-red-700 p-4">
            <div className="text-xl font-black mb-3">🚨 POSSIBLE EMERGENCY</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <strong>Possible event:</strong><span>{possibleEvent}</span>
              <strong>Severity:</strong><span>{severityLabel(result.severity)}</span>
              <strong>Location:</strong><span>{location.text}</span>
              <strong>Evidence:</strong><span>{evidence}</span>
            </div>
            <div className="mt-3 text-[11px] text-amber-200">Image evidence is not certainty. Sensor data alone is not proof of an emergency.</div>
            {sensorAvailable && <div className="mt-2 text-[11px] text-sky-300 flex items-center gap-1"><Smartphone className="w-3 h-3" /> Optional motion sensor available {sensorSignal ? '(possible impact signal)' : '(no impact signal)'}</div>}
          </div>

          <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-300">
            <div className="font-bold text-white flex items-center gap-2"><Radio className="w-4 h-4 text-emerald-400" /> Locally generated SOS card</div>
            <div className="mt-2 grid grid-cols-2 gap-2"><span>SOS • {possibleEvent}</span><span>Severity: {severityLabel(result.severity)}</span><span>Location: {location.text}</span><span>{new Date().toLocaleString()}</span></div>
            <div className="mt-2 font-black tracking-widest text-red-400">LIFELINE AI • MSB CREATIVE STUDIOS</div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button onClick={() => setShowConfirmation(true)} className="py-4 rounded-xl bg-red-600 hover:bg-red-500 font-black text-sm flex items-center justify-center gap-2"><ShieldAlert className="w-5 h-5" /> SHARE SOS ALERT</button>
            <button onClick={onClose} className="py-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 font-black text-sm flex items-center justify-center gap-2"><CheckCircle2 className="w-5 h-5" /> CANCEL</button>
          </div>
        </div>
      </div>

      {showConfirmation && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl border-2 border-amber-500 bg-neutral-950 p-5 shadow-2xl">
            <h3 className="text-xl font-black text-amber-300">Confirm what will be shared</h3>
            <p className="text-xs text-neutral-300 mt-2">Nothing has been shared yet. Review and explicitly confirm.</p>
            <div className="my-4 rounded-xl bg-neutral-900 border border-neutral-700 p-3 text-sm space-y-2">
              <div><b>Emergency type:</b> {possibleEvent}</div>
              <div><b>Severity:</b> {severityLabel(result.severity)}</div>
              <div><b>Location:</b> {location.text}</div>
              <div><b>User-provided emergency message:</b> {message || selectedEvent?.text || 'None'}</div>
              <div><b>User-provided image:</b> {image ? `${image.name} (selected)` : 'None'}</div>
            </div>
            <div className="grid grid-cols-2 gap-3"><button onClick={confirmShare} className="py-3 rounded-xl bg-red-600 font-black">CONFIRM SHARE</button><button onClick={() => setShowConfirmation(false)} className="py-3 rounded-xl bg-neutral-800 border border-neutral-600 font-black">GO BACK</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
