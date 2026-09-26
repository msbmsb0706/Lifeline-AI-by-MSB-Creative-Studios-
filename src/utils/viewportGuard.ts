/**
 * Keyboard visual-viewport guard — keeps the focused input focused and
 * visible while the Android soft keyboard slides up, down, or animates.
 *
 * ROOT CAUSE ADDRESSED
 * --------------------
 * When the keyboard opens, the visual viewport shrinks. In WebView
 * containers (or legacy `resizes-content` behaviour) that layout jump can
 * blur the focused input — and on Android a `blur()` while a voice-dictation
 * composition is active silently cancels the session and discards the entire
 * pending utterance. The same layout pass can also push the input out of the
 * visual viewport, which makes Android dismiss the IME outright.
 *
 * BEHAVIOUR (and the safety rules that keep it from fighting the user)
 * --------------------------------------------------------------------
 * - Tracks `window.visualViewport` height (debounced `window.resize`
 *   fallback): a drop of >`keyboardDeltaPx` below the running baseline =
 *   keyboard open; growth back = closed. Baseline re-sets on rotation.
 * - While the keyboard is open AND the guarded element owns focus, the
 *   element is kept >=`marginPx` inside the VISUAL viewport (rAF-throttled
 *   minimal `scrollBy`; `getBoundingClientRect` is already
 *   visual-viewport-relative).
 * - "Phantom blur" repair: if the element blurs to `<body>` while the
 *   keyboard is open and there was recent typing/IME activity, focus is
 *   restored with `focus({preventScroll:true})` plus the saved
 *   caret/selection.
 * - NEVER steals an intentional focus move: focus moves to another control
 *   (a tapped button, a modal — tracked via document-level `focusin` with a
 *   time window) are respected; recent activity is required; it backs off
 *   after repeated failed refocus attempts; it never grabs focus in a
 *   backgrounded tab or on a disabled element.
 * - Document-level (capture) listeners so the guard survives the element
 *   being re-created by React without re-attaching; every browser call is
 *   guarded — this module never throws; complete no-op on desktop (no
 *   visualViewport, no keyboard).
 *
 * A naive "on resize: setTimeout(() => el.focus())" approach is NOT used on
 * purpose: without the checks above it yanks focus back to the input 30ms
 * after the user taps ANY other control (e.g. Attach GPS), which is a real
 * UX regression in an emergency app.
 */

export interface ViewportGuardOptions {
  /** Minimum visual-viewport height drop (px) that counts as "keyboard open". */
  keyboardDeltaPx?: number;
  /** The guarded element must stay at least this many px inside the visual viewport. */
  marginPx?: number;
  /** Recent typing/IME activity window (ms) required before a blur counts as "phantom". */
  activityWindowMs?: number;
  /** A focus move to another control within this window (ms) suppresses refocus. */
  focusMoveWindowMs?: number;
  /** After this many failed refocus attempts, stop trying for 5 seconds. */
  maxFailedRefocuses?: number;
}

export function setupViewportGuard(
  element: HTMLTextAreaElement | HTMLInputElement | null,
  options: ViewportGuardOptions = {}
): () => void {
  try {
    if (!element || typeof window === 'undefined') return () => undefined;

    const doc = document;
    const win = window as any;
    const vv: any = win.visualViewport ?? null;

    const keyboardDeltaPx = options.keyboardDeltaPx ?? 120;
    const marginPx = options.marginPx ?? 12;
    const activityWindowMs = options.activityWindowMs ?? 3000;
    const focusMoveWindowMs = options.focusMoveWindowMs ?? 1200;
    const maxFailedRefocuses = options.maxFailedRefocuses ?? 3;

    let disposed = false;
    let baselineHeight = 0; // last "keyboard closed" visual height
    let keyboardOpen = false;
    let lastActivityAt = 0;
    let lastFocusMoveAt = -Infinity;
    let failedRefocuses = 0;
    let backoffUntil = 0;
    let keepInViewScheduled = false;
    let resizeDebounce = 0;
    let savedSelection: { start: number; end: number } | null = null;

    const heightNow = (): number => {
      try {
        if (vv && typeof vv.height === 'number') return vv.height;
      } catch {
        /* fall through */
      }
      return typeof win.innerHeight === 'number' ? win.innerHeight : 0;
    };

    const markActivity = (): void => {
      lastActivityAt = Date.now();
    };

    const keyboardState = (): void => {
      const h = heightNow();
      if (h <= 0) return;
      if (!baselineHeight || h >= baselineHeight - 8) baselineHeight = h;
      const open = baselineHeight - h > keyboardDeltaPx;
      if (open !== keyboardOpen) {
        keyboardOpen = open;
        if (open && doc.activeElement === element) markActivity();
      }
    };

    const keepInView = (): void => {
      if (!keyboardOpen || doc.activeElement !== element) return;
      let rect: DOMRect | null = null;
      try {
        rect = element.getBoundingClientRect();
      } catch {
        return;
      }
      if (!rect) return;
      const h = heightNow();
      let delta = 0;
      if (rect.top < marginPx) delta = rect.top - marginPx;
      else if (rect.bottom > h - marginPx) delta = rect.bottom - (h - marginPx);
      if (delta !== 0 && typeof win.scrollBy === 'function') {
        try {
          win.scrollBy(0, delta);
        } catch {
          /* never throw from a layout guard */
        }
      }
    };

    const raf = (fn: () => void): void => {
      try {
        if (typeof win.requestAnimationFrame === 'function') {
          win.requestAnimationFrame(fn);
          return;
        }
        if (typeof (globalThis as any).requestAnimationFrame === 'function') {
          (globalThis as any).requestAnimationFrame(fn);
          return;
        }
      } catch {
        /* fall through */
      }
      win.setTimeout(fn, 16);
    };

    const scheduleKeepInView = (): void => {
      if (keepInViewScheduled) return;
      keepInViewScheduled = true;
      raf(() => {
        keepInViewScheduled = false;
        if (!disposed) keepInView();
      });
    };

    const saveSelection = (): void => {
      savedSelection = null;
      try {
        const anyEl = element as any;
        if (typeof anyEl.selectionStart === 'number' && typeof anyEl.selectionEnd === 'number') {
          savedSelection = { start: anyEl.selectionStart, end: anyEl.selectionEnd };
        }
      } catch {
        savedSelection = null;
      }
    };

    const restoreSelection = (): void => {
      if (!savedSelection) return;
      try {
        (element as any).setSelectionRange(savedSelection.start, savedSelection.end);
      } catch {
        /* not editable / value changed — default caret is fine */
      }
    };

    /**
     * Runs one task after the element blurred. If focus simply dropped to
     * <body> (layout jump / container glitch) while the keyboard is open and
     * the element has recent typing/IME activity, restore it. If the user
     * moved focus to another control, or the keyboard is closed, do nothing.
     */
    const maybeRefocus = (): void => {
      if (!element || disposed) return;
      if (doc.activeElement === element) return; // no longer blurred
      if (!keyboardOpen) return; // keyboard went away: the user likely left the field
      if (doc.hidden) return; // backgrounded app — never grab focus
      try {
        if ((element as any).disabled) return;
      } catch {
        /* ignore */
      }
      const active = doc.activeElement;
      if (active && active !== doc.body) return; // focus intentionally moved elsewhere
      const now = Date.now();
      if (now - lastFocusMoveAt < focusMoveWindowMs) return; // the user just moved focus — respect it
      if (now - lastActivityAt > activityWindowMs) return; // no recent typing/IME activity
      if (now < backoffUntil) return;
      try {
        element.focus({ preventScroll: true });
      } catch {
        try {
          element.focus();
        } catch {
          /* not focusable right now */
        }
      }
      if (doc.activeElement === element) {
        failedRefocuses = 0;
        restoreSelection();
        scheduleKeepInView();
      } else {
        failedRefocuses += 1;
        if (failedRefocuses >= maxFailedRefocuses) backoffUntil = Date.now() + 5000;
      }
    };

    const onFocusIn = (event: FocusEvent): void => {
      const t = event.target as HTMLElement | null;
      if (!t) return;
      if (t === element) {
        markActivity();
        saveSelection();
        return;
      }
      // The user moved focus somewhere else — the guard must not fight that.
      lastFocusMoveAt = Date.now();
    };

    const onFocusOut = (event: FocusEvent): void => {
      if (event.target !== element) return;
      // Defer one task: a genuine focus target (another control) usually
      // receives focus in the same task, so the check below sees it.
      win.setTimeout(() => maybeRefocus(), 0);
    };

    const onInput = (event: Event): void => {
      if (event.target !== element) return;
      markActivity();
      saveSelection();
    };

    const onKeyUp = (event: Event): void => {
      if (event.target !== element) return;
      markActivity();
      saveSelection();
    };

    const onCompositionEnd = (event: Event): void => {
      if (event.target !== element) return;
      saveSelection();
    };

    const onClick = (event: Event): void => {
      if (event.target !== element) return;
      saveSelection();
    };

    const onVvResize = (): void => {
      keyboardState();
      scheduleKeepInView();
    };

    const onVvScroll = (): void => {
      scheduleKeepInView();
    };

    const onWinResize = (): void => {
      // Fallback for engines without visualViewport (and orientation changes
      // that resize the layout viewport): debounce to avoid layout storms.
      if (resizeDebounce) return;
      resizeDebounce = win.setTimeout(() => {
        resizeDebounce = 0;
        if (disposed) return;
        keyboardState();
        scheduleKeepInView();
      }, 120);
    };

    const onOrientationChange = (): void => {
      baselineHeight = 0; // re-baseline on rotation
      keyboardState();
    };

    // Attach (document-level capture so remounts are handled for free).
    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('focusout', onFocusOut, true);
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('keyup', onKeyUp, true);
    doc.addEventListener('compositionend', onCompositionEnd, true);
    doc.addEventListener('click', onClick, true);

    const vvAttached = Boolean(vv && typeof vv.addEventListener === 'function');
    if (vvAttached) {
      vv.addEventListener('resize', onVvResize);
      vv.addEventListener('scroll', onVvScroll);
    }
    win.addEventListener('resize', onWinResize);
    win.addEventListener('orientationchange', onOrientationChange);

    // Initial state: keyboard is closed at attach time.
    keyboardState();

    return () => {
      disposed = true;
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('focusout', onFocusOut, true);
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('keyup', onKeyUp, true);
      doc.removeEventListener('compositionend', onCompositionEnd, true);
      doc.removeEventListener('click', onClick, true);
      if (vvAttached) {
        try {
          vv.removeEventListener('resize', onVvResize);
          vv.removeEventListener('scroll', onVvScroll);
        } catch {
          /* ignore */
        }
      }
      win.removeEventListener('resize', onWinResize);
      win.removeEventListener('orientationchange', onOrientationChange);
      if (resizeDebounce) {
        win.clearTimeout(resizeDebounce);
        resizeDebounce = 0;
      }
      keepInViewScheduled = false;
    };
  } catch {
    // The guard is a pure enhancement — if anything is wrong with the
    // environment, degrade to a no-op instead of breaking the app.
    return () => undefined;
  }
}
