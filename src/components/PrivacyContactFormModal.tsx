import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Mail, MessageSquareText, Send, ShieldCheck, WifiOff, X, AlertTriangle } from 'lucide-react';

/**
 * Privacy Contact Form
 *
 * Lets a user contact the MSB Creative Studios privacy team without any email
 * address being published in the app. The form posts to the same-origin
 * endpoint POST /api/privacy-contact; the server relays the message to a
 * destination mailbox that exists only as a server-side environment variable.
 *
 * Works identically in the production website and in an Android WebView that
 * loads the same production origin (relative URL, standard inputs, no
 * mailto:, no window.open, no alert()).
 */

interface PrivacyContactFormModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const NAME_MAX = 100;
const EMAIL_MAX = 254;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 4000;
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[A-Za-z0-9-]{2,63}$/;

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export const PrivacyContactFormModal: React.FC<PrivacyContactFormModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — hidden from real users
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    if (!isOpen) return;
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && status !== 'submitting') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, status]);

  if (!isOpen) return null;

  const trimmedEmail = email.trim();
  const trimmedMessage = message.trim();
  const emailValid = trimmedEmail.length > 0 && trimmedEmail.length <= EMAIL_MAX && EMAIL_PATTERN.test(trimmedEmail);
  const messageValid = trimmedMessage.length >= MESSAGE_MIN && trimmedMessage.length <= MESSAGE_MAX;
  const canSubmit = emailValid && messageValid && status !== 'submitting';

  const resetForm = () => {
    setName('');
    setEmail('');
    setMessage('');
    setWebsite('');
    setStatus('idle');
    setErrorText(null);
    setReference(null);
  };

  const handleClose = () => {
    if (status === 'submitting') return;
    if (status === 'success') resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!emailValid) {
      setErrorText('Please enter a valid email address so we can reply to you.');
      return;
    }
    if (!messageValid) {
      setErrorText(
        trimmedMessage.length < MESSAGE_MIN
          ? `Please describe your request in at least ${MESSAGE_MIN} characters.`
          : `Your message is too long (maximum ${MESSAGE_MAX} characters).`
      );
      return;
    }

    setStatus('submitting');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // Relative URL: resolves against whichever origin served the app
      // (production website or the Android WebView loading that same origin).
      const response = await fetch('/api/privacy-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: trimmedEmail,
          message: trimmedMessage,
          website
        }),
        signal: controller.signal
      });

      const json: { success?: boolean; message?: string; error?: string; reference?: string } =
        await response.json().catch(() => ({}));

      if (response.ok && json.success) {
        setReference(json.reference || null);
        setStatus('success');
        return;
      }

      setStatus('error');
      setErrorText(
        json.error ||
          (response.status === 429
            ? 'Too many requests. Please wait a few minutes before trying again.'
            : 'We could not send your message right now. Please try again in a few minutes.')
      );
    } catch (err: unknown) {
      setStatus('error');
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setErrorText(
        aborted
          ? 'The request timed out. Please check your connection and try again.'
          : 'Network error. Please check your connection and try again.'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const inputClass =
    'w-full rounded-xl bg-black border border-neutral-700 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/60 disabled:opacity-60';

  return (
    <div
      id="privacy-contact-form-modal"
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-contact-form-title"
    >
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl text-neutral-100 relative my-6 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-800 bg-neutral-950/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-700/80 text-emerald-400">
              <Mail className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h2 id="privacy-contact-form-title" className="text-base sm:text-lg font-black text-white leading-tight">
                PRIVACY CONTACT FORM
              </h2>
              <p className="text-xs text-neutral-400 font-medium">
                Contact the MSB Creative Studios privacy team
              </p>
            </div>
          </div>
          <button
            id="close-privacy-contact-form-btn"
            type="button"
            onClick={handleClose}
            disabled={status === 'submitting'}
            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
            title="Close Privacy Contact Form"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 text-xs sm:text-sm">
          {status === 'success' ? (
            <div id="privacy-contact-success" className="space-y-4" role="status" aria-live="polite">
              <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-700 flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-black text-white text-sm">Message sent</div>
                  <p className="text-neutral-300 text-xs mt-1 leading-relaxed">
                    Your request has been delivered to the MSB Creative Studios privacy team. We will reply to{' '}
                    <span className="font-mono text-emerald-300">{trimmedEmail}</span>.
                  </p>
                  {reference && (
                    <p className="text-neutral-400 text-[11px] mt-2">
                      Reference: <span className="font-mono text-neutral-200">{reference}</span> — quote this if you follow up.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  id="privacy-contact-done-btn"
                  type="button"
                  onClick={handleClose}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form id="privacy-contact-form" onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 text-neutral-300 leading-relaxed">
                Use this form for questions about the Privacy Policy, data access or deletion requests, or feedback about how
                LifeLine AI handles information.
                <span className="block mt-1.5 text-red-300 font-bold">
                  Not for emergencies. In immediate danger, contact your local emergency services immediately.
                </span>
              </div>

              {!isOnline && (
                <div className="p-3 rounded-xl bg-amber-950/70 border border-amber-700 text-amber-200 flex items-start gap-2">
                  <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>You appear to be offline. Sending this form requires an internet connection.</span>
                </div>
              )}

              {/* Honeypot: invisible to people, tempting to bots. Leave empty. */}
              <div aria-hidden="true" className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden">
                <label htmlFor="pcf-website">Website</label>
                <input
                  id="pcf-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="pcf-name" className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                  Name <span className="normal-case font-medium text-neutral-500">(optional)</span>
                </label>
                <input
                  id="pcf-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  maxLength={NAME_MAX}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={status === 'submitting'}
                  placeholder="How should we address you?"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="pcf-email" className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                  Email address <span className="text-red-400">*</span>
                </label>
                <input
                  id="pcf-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  maxLength={EMAIL_MAX}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === 'submitting'}
                  placeholder="you@example.com"
                  aria-invalid={email.length > 0 && !emailValid}
                  className={inputClass}
                />
                <p className="text-[11px] text-neutral-500 mt-1">Required so we can reply to you.</p>
              </div>

              <div>
                <label htmlFor="pcf-message" className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                  Message <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="pcf-message"
                  name="message"
                  required
                  rows={5}
                  maxLength={MESSAGE_MAX}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={status === 'submitting'}
                  placeholder="Describe your privacy question or request."
                  aria-invalid={message.length > 0 && !messageValid}
                  className={`${inputClass} resize-y min-h-[110px]`}
                />
                <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
                  <span>Minimum {MESSAGE_MIN} characters.</span>
                  <span className={trimmedMessage.length > MESSAGE_MAX ? 'text-red-400' : ''}>
                    {trimmedMessage.length}/{MESSAGE_MAX}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-neutral-950/60 border border-neutral-800 flex items-start gap-2.5 text-[11px] text-neutral-400 leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  The details you submit are used only to respond to your request. Because a reply email address is
                  required, submissions are not anonymous. Nothing is sent until you tap <b>Send message</b>; your message
                  then travels over HTTPS to the LifeLine AI server, which forwards it to the MSB Creative Studios privacy
                  team. It is not shared with any AI model or advertising service.
                </span>
              </div>

              {errorText && (
                <div
                  id="privacy-contact-error"
                  role="alert"
                  className="p-3 rounded-xl bg-red-950/70 border border-red-700 text-red-200 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{errorText}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  id="privacy-contact-cancel-btn"
                  type="button"
                  onClick={handleClose}
                  disabled={status === 'submitting'}
                  className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  id="privacy-contact-submit-btn"
                  type="submit"
                  disabled={!canSubmit}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-400 text-white font-black text-xs sm:text-sm transition-all shadow-lg shadow-emerald-950/50 flex items-center gap-2 active:scale-95 disabled:active:scale-100"
                >
                  {status === 'submitting' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending…</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Send message</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-neutral-800 bg-neutral-950/90 text-[10px] text-neutral-500 flex items-center gap-1.5">
          <MessageSquareText className="w-3 h-3" />
          <span>LifeLine AI by MSB Creative Studios — Privacy Contact Form</span>
        </div>
      </div>
    </div>
  );
};
