import React from 'react';

/**
 * IME composition session manager (Gboard voice dictation, Tamil/Hindi
 * transliteration, emoji, ...) — decoupled from any specific component.
 *
 * WHY THIS EXISTS
 * ---------------
 * Android IMEs deliver dictation through a *composition session*: interim
 * phrases write into the field's DOM value in real time, and only
 * `compositionend` carries the final commit. A controlled React input
 * (`value={state}`) that re-renders during that window (network flaps, queue
 * updates, voice-pipeline state — all of which happen in this app) stamps the
 * stale state back into the DOM, and Android Chromium treats that external
 * write as a command override: it CANCELS the IME session and discards the
 * whole dictation buffer. That is the reported "spoken words disappear" bug.
 *
 * THE CONTRACT
 * ------------
 * Components render their textareas WITHOUT a `value` prop (uncontrolled),
 * mirror every DOM change up to state via `onChange`, and gate the
 * state->DOM sync effect on `isImeComposing(element)`:
 *
 *     useEffect(() => {
 *       const el = ref.current;
 *       if (el && !isImeComposing(el) && el.value !== state) el.value = state;
 *     }, [state]);
 *
 * while binding `imeEventHandlers.onCompositionStart/End` (+ a blur commit)
 * to the textarea. The session singleton below is what makes that gate work
 * across the component tree without prop drilling.
 */

export interface IMESession {
  isComposing: boolean;
  element: HTMLTextAreaElement | HTMLInputElement | null;
}

/**
 * The single active IME composition session. At most one composition session
 * exists at a time (one field owns the IME), so a singleton is correct — but
 * the element binding matters: consumers MUST check `isImeComposing(el)`
 * with their own element so a composition in the Silent SOS field never
 * blocks a state->DOM sync in the transcript field (or vice versa).
 */
export const activeIMESession: IMESession = {
  isComposing: false,
  element: null
};

/**
 * True when an IME composition session is active on `el`. Pass the element
 * (never call this bare in a per-field sync effect): a composition in a
 * DIFFERENT field must not block this field's external writes.
 */
export const isImeComposing = (
  el: HTMLTextAreaElement | HTMLInputElement | null | undefined
): boolean =>
  activeIMESession.isComposing &&
  (el === null || el === undefined || activeIMESession.element === el);

/**
 * Read the element's current DOM text — the authoritative source during and
 * right after an IME commit (state may still lag).
 */
export const readImeValue = (el: HTMLTextAreaElement | HTMLInputElement | null): string =>
  el ? el.value : '';

/**
 * Authoritative commit: push the element's DOM value into React state via
 * `onTextChange` — but only when it actually differs from `currentState`.
 *
 * Used on `compositionend` (final dictation commit — some Android IMEs
 * deliver the last text with compositionend itself and never fire a trailing
 * `input`, so the DOM must be read directly) and on `blur` (an IME can
 * retract preedit text on blur; state must end equal to what the user sees).
 *
 * Deterministic in every environment — unlike relying on a synthesized
 * `input` event, which depends on React's internal value-tracker behavior.
 */
export const commitImeValueToState = (
  el: HTMLTextAreaElement | HTMLInputElement | null,
  currentState: string,
  onTextChange: (text: string) => void
): void => {
  const value = readImeValue(el);
  if (value !== currentState) {
    onTextChange(value);
  }
};

/**
 * Composition handlers to bind on any IME-protected textarea/input:
 *
 *     <textarea
 *       onCompositionStart={imeEventHandlers.onCompositionStart}
 *       onCompositionEnd={(e) => {
 *         imeEventHandlers.onCompositionEnd(e);
 *         commitImeValueToState(e.currentTarget, state, setState);
 *       }}
 *       onBlur={(e) => commitImeValueToState(e.currentTarget, state, setState)}
 *       onChange={(e) => setState(e.target.value)}
 *     />
 */
export const imeEventHandlers = {
  /** Synchronously flags the start of a composition session. This must run
   *  before any re-render that could follow, so it does nothing else. */
  onCompositionStart: (
    e: React.CompositionEvent<HTMLTextAreaElement | HTMLInputElement>
  ): void => {
    activeIMESession.isComposing = true;
    activeIMESession.element = e.currentTarget;
  },

  /** Ends the session and surfaces the committed text through the normal
   *  onChange path: a native IME commit bypasses React's value setter, so a
   *  synthesized `input` event makes the value-tracker deliver the final
   *  text to `onChange` (in real browsers). The binding component ALSO calls
   *  commitImeValueToState for a deterministic, environment-independent
   *  commit (see usage above) — the two are idempotent together. */
  onCompositionEnd: (
    e: React.CompositionEvent<HTMLTextAreaElement | HTMLInputElement>
  ): void => {
    activeIMESession.isComposing = false;
    activeIMESession.element = null;
    try {
      e.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      /* the deterministic commitImeValueToState path covers the commit */
    }
  }
};
