import React, { useCallback, useEffect, useRef } from 'react';

/**
 * IME-safe textarea binding — the fix for Android keyboard voice dictation
 * (Gboard mic) being dropped into the LifeLine AI transcript field.
 *
 * WHY THE NAIVE CONTROLLED INPUT LOSES DICTATION TEXT
 * ---------------------------------------------------
 * On Android, Gboard (and every IME) delivers voice dictation through a
 * *composition session*: interim phrases are written into the field's DOM
 * value while the composition is active, and `compositionend` carries the
 * final commit. During that session React's state still holds the
 * pre-dictation text while the DOM holds the growing dictation.
 *
 * LifeLine AI re-renders its App tree for unrelated reasons at all times —
 * network online/offline flaps, the partner-queue subscription, service
 * worker status, the voice pipeline, geolocation. With a controlled
 * `<textarea value={transcript}>`, every one of those re-renders makes React
 * re-apply the STALE `value` prop to the DOM. A programmatic
 * `textarea.value = <stale>` write while a composition session is active
 * makes Android Chrome / WebView CANCEL the IME session and silently discard
 * everything the user has just said. That is exactly the reported symptom:
 * "the phone clearly hears them, but nothing ever lands in the field."
 *
 * THE FIX
 * -------
 * 1. The textarea is rendered WITHOUT a `value` prop, so React can never
 *    write the DOM value mid-composition, no matter how many unrelated
 *    re-renders happen while the user is still speaking.
 * 2. DOM -> state is mirrored synchronously on every `input` (live char
 *    count / language badge / submit-button state), on `compositionend`
 *    (the authoritative commit — some IMEs never fire a trailing `input`)
 *    and on `blur` (catches an IME retracting preedit text).
 * 3. state -> DOM happens in one guarded effect for EXTERNAL writes only
 *    (server-ASR voice capture, presets, Clear). The guard is the heart of
 *    the fix: while `composingRef.current` is true the DOM is NEVER touched.
 *
 * The parent remains the single source of truth (the `value` prop). The DOM
 * is the source of truth only while the user/IME is actively editing it, and
 * that ownership is mirrored back synchronously, so the two can never
 * meaningfully diverge.
 */
export interface ImeSafeTextareaBindings {
  /** Stable ref object — attach with `<textarea ref={bindings.ref} ...>`. */
  ref: React.RefObject<HTMLTextAreaElement | null>;
  /** Native `input` mirror (fires for plain typing AND IME interim text). */
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  /** Synchronously flags the start of an IME composition session. */
  onCompositionStart: React.CompositionEventHandler<HTMLTextAreaElement>;
  /** Authoritative commit: syncs the final IME text into state. */
  onCompositionEnd: React.CompositionEventHandler<HTMLTextAreaElement>;
  /** Kept for a stable spread surface; no-op on focus. */
  onFocus: React.FocusEventHandler<HTMLTextAreaElement>;
  /** Resyncs state with whatever the field actually contains after blur. */
  onBlur: React.FocusEventHandler<HTMLTextAreaElement>;
}

export function useImeSafeTextarea(
  value: string,
  onTextChange: (text: string) => void
): ImeSafeTextareaBindings {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  /** True while an IME composition session (voice dictation, Tamil/Hindi
   *  transliteration, emoji, ...) is active. Must be set synchronously from
   *  the composition events — `e.nativeEvent.isComposing` alone is not
   *  reliable across every Android IME build. */
  const composingRef = useRef(false);
  const valueRef = useRef(value);
  const onTextChangeRef = useRef(onTextChange);
  valueRef.current = value;
  onTextChangeRef.current = onTextChange;

  const mirrorDomToState = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const text = el.value;
    if (text !== valueRef.current) {
      onTextChangeRef.current(text);
    }
  }, []);

  // Every native `input` event — including IME interim updates — keeps the
  // React state live. Because the textarea has NO `value` prop, the
  // re-render this causes can never disturb the in-progress composition.
  const handleChange = useCallback<React.ChangeEventHandler<HTMLTextAreaElement>>(
    (event) => {
      const text = event.target.value;
      if (text !== valueRef.current) {
        onTextChangeRef.current(text);
      }
    },
    []
  );

  const handleCompositionStart =
    useCallback<React.CompositionEventHandler<HTMLTextAreaElement>>(() => {
      composingRef.current = true;
    }, []);

  const handleCompositionEnd =
    useCallback<React.CompositionEventHandler<HTMLTextAreaElement>>((event) => {
      composingRef.current = false;
      // Authoritative commit: whatever the IME left in the DOM is the final
      // text. Re-read from the DOM (not from the event) because a few Android
      // IMEs deliver the final text with the compositionend event itself.
      const text = event.currentTarget.value;
      if (text !== valueRef.current) {
        onTextChangeRef.current(text);
      }
    }, []);

  const handleFocus = useCallback<React.FocusEventHandler<HTMLTextAreaElement>>(
    () => {
      // Intentionally a no-op — present so callers can spread one stable
      // object onto the textarea.
    },
    []
  );

  const handleBlur = useCallback<React.FocusEventHandler<HTMLTextAreaElement>>(
    (event) => {
      // Blurring can cancel/retract in-progress preedit text; resync state
      // with what the field actually contains now.
      const text = event.currentTarget.value;
      if (text !== valueRef.current) {
        onTextChangeRef.current(text);
      }
    },
    []
  );

  // state -> DOM. External writes (voice capture injection, presets, Clear)
  // reach the field here. The composition guard is the core of the fix:
  // while the IME owns the value, the DOM is never touched, regardless of
  // how many unrelated re-renders fire with a stale `value` prop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (composingRef.current) {
      return; // an active IME session owns the value — never overwrite it
    }
    if (el.value !== value) {
      el.value = value;
    }
  }, [value]);

  return {
    ref,
    onChange: handleChange,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onFocus: handleFocus,
    onBlur: handleBlur
  };
}
