/**
 * Keyboard focus guard — keeps the active input focused and visible while the
 * Android soft keyboard opens, closes, or animates.
 *
 * WHAT IT DEFENDS AGAINST
 * -----------------------
 * 1. "Phantom" blurs: the layout jump that accompanies the keyboard opening
 *    (or a WebView container re-applying its own scroll position mid-
 *    animation) can blur the focused input. A `blur` while an IME
 *    composition is active silently cancels voice dictation — the entire
 *    pending utterance is discarded. The guard detects such blurs (focus
 *    dropped to <body> without an explicit user focus-move) and restores
 *    focus with `preventScroll: true`, plus the previous caret/selection.
 * 2. Input scrolled out of the VISUAL viewport: Android dismisses the IME
 *    when its target is no longer visible. While the keyboard is open and
 *    the guarded field owns focus, the field is kept inside the visual
 *    viewport (Chrome usually does this natively; WebView containers often
 *    don't).
 *
 * SAFETY RULES (why this never fights the user)
 * ---------------------------------------------
 * - Acts on exactly one element (the transcript field); never on others.
 * - Only refocuses while the keyboard is actually open.
 * - Never steals focus the user just moved somewhere else (a tapped button,
 *   a modal) — tracked via document-level `focusin` with a time window.
 * - Requires recent typing/IME activity on the field, so a stale field that
 *   lost focus long ago is not re-focused.
 * - Backs off after repeated failed refocus attempts.
 * - Complete no-op on desktop (no visualViewport, no keyboard).
 * - Defensive: every browser call is guarded; this module never throws.
 *
 * Listen on `document` (capture) rather than the element so the guard
 * survives the field being unmounted/remounted by React without re-attaching.
 */

export interface KeyboardFocusGuardOptions {
  /** Minimum visual-viewport height drop (px) that counts as "keyboard open". */
  keyboardDeltaPx?: number;
  /** The guarded field must stay at least this many px inside the visual viewport. */
  marginPx?: number;
  /** Recent typing/IME activity window (ms) required before a blur counts as "phantom". */
  activityWindowMs?: number;
  /** A focus move to another control within this window (ms) suppresses refocus. */
  focusMoveWindowMs?: number;
  /** After this many failed refocus attempts, stop trying for 5 seconds. */
  maxFailedRefocuses?: number;
}

export function attachKeyboardFocusGuard(
  targetRef: { current: HTMLElement | null },
  options: KeyboardFocusGuardOptions = {}
): () => void {
  try {
    const doc = document;
    const win = window as any;
    const vv: any = (win.visualViewport ?? null);

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
    let keepInViewRaf = 0;
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
        if (open && targetRef.current && doc.activeElement === targetRef.current) {
          markActivity();
        }
      }
    };

    const keepInView = (): void => {
      const el = targetRef.current;
      if (!el || !keyboardOpen || doc.activeElement !== el) return;
      let rect: DOMRect | null = null;
      try {
        rect = el.getBoundingClientRect();
      } catch {
        return;
      }
      if (!rect) return;
      const h = heightNow();
      let delta = 0;
      // getBoundingClientRect is relative to the VISUAL viewport, so the
      // field is in view while margin <= rect.top and rect.bottom <= h-margin.
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
      if (keepInViewRaf) return;
      let scheduled = true;
      raf(() => {
        keepInViewRaf = 0;
        if (scheduled && !disposed) keepInView();
      });
      keepInViewRaf = 1;
    };

    const saveSelection = (el: HTMLElement | null): void => {
      savedSelection = null;
      if (!el) return;
      try {
        const anyEl = el as any;
        if (typeof anyEl.selectionStart === 'number' && typeof anyEl.selectionEnd === 'number') {
          savedSelection = { start: anyEl.selectionStart, end: anyEl.selectionEnd };
        }
      } catch {
        savedSelection = null;
      }
    };

    const restoreSelection = (el: HTMLElement): void => {
      if (!savedSelection) return;
      try {
        (el as any).setSelectionRange(savedSelection.start, savedSelection.end);
      } catch {
        /* element not editable or value changed — caret defaults are fine */
      }
    };

    /**
     * Called after one task following a blur. If focus simply dropped to
     * <body> (layout jump / container glitch) while the keyboard is open and
     * the field has recent typing/IME activity, restore it. If the user
     * moved focus to another control, or the keyboard is closed, do nothing.
     */
    const maybeRefocus = (): void => {
      const el = targetRef.current;
      if (!el || disposed) return;
      if (doc.activeElement === el) return; // no longer blurred
      if (!keyboardOpen) return; // keyboard went away: the user likely left the field
      if (doc.hidden) return; // backgrounded app — never grab focus
      try {
        if ((el as any).disabled) return;
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
        el.focus({ preventScroll: true });
      } catch {
        try {
          el.focus();
        } catch {
          /* not focusable right now */
        }
      }
      if (doc.activeElement === el) {
        failedRefocuses = 0;
        restoreSelection(el);
        scheduleKeepInView();
      } else {
        failedRefocuses += 1;
        if (failedRefocuses >= maxFailedRefocuses) backoffUntil = Date.now() + 5000;
      }
    };

    const onFocusIn = (event: FocusEvent): void => {
      const t = event.target as HTMLElement | null;
      if (!t) return;
      if (t === targetRef.current) {
        markActivity();
        saveSelection(t);
        return;
      }
      // The user moved focus somewhere else — the guard must not fight that.
      lastFocusMoveAt = Date.now();
    };

    const onFocusOut = (event: FocusEvent): void => {
      if (event.target !== targetRef.current) return;
      // Defer one task: a genuine focus target (another control) usually
      // receives focus in the same task, so the check below sees it.
      win.setTimeout(() => maybeRefocus(), 0);
    };

    const onInput = (event: Event): void => {
      if (event.target !== targetRef.current) return;
      markActivity();
      saveSelection(event.target as HTMLElement);
    };

    const onKeyUp = (event: Event): void => {
      if (event.target !== targetRef.current) return;
      markActivity();
      saveSelection(event.target as HTMLElement);
    };

    const onCompositionEnd = (event: Event): void => {
      if (event.target !== targetRef.current) return;
      saveSelection(event.target as HTMLElement);
    };

    const onClick = (event: Event): void => {
      if (event.target !== targetRef.current) return;
      saveSelection(event.target as HTMLElement);
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

    const vvAttached = Boolean(
      vv && typeof vv.addEventListener === 'function'
    );
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
      keepInViewRaf = 0;
    };
  } catch {
    // The guard is a pure enhancement — if anything is wrong with the
    // environment, degrade to no-op instead of breaking the app.
    return () => undefined;
  }
}
