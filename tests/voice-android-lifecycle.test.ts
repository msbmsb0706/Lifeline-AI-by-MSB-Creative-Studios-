/**
 * Android / Chrome speech-recognition lifecycle, exercised against the REAL
 * EmergencyVoiceButton component rendered in jsdom with a fake recognizer that
 * models Chrome's behaviour on Android:
 *
 *   - `start()` throws InvalidStateError while a session is running
 *   - `stop()` / `abort()` end the session and fire `onend` asynchronously
 *   - Chrome ends a continuous session BY ITSELF at its speech end-point
 *     (`autoEnd`), often with interim text only
 *   - finals can be re-emitted cumulatively (Android duplicates)
 *
 * No paid ASR service, no MediaRecorder, no fetch is involved: the browser
 * recognizer is the microphone path under test.
 */
import { installDomHarness, wait, FakeSpeechRecognition } from './dom-harness.ts';
import { section, assert, assertEqual } from './helpers.ts';

// jsdom is a dev-only test dependency. Without it the DOM suite cannot run, so
// report a loud skip instead of failing the whole regression run.
let jsdomReady = true;
try {
  await import('jsdom');
} catch {
  jsdomReady = false;
}

if (!jsdomReady) {
  section('EmergencyVoiceButton — Android lifecycle (jsdom missing)');
  assert(true, 'jsdom is not installed — DOM voice lifecycle suite skipped (npm install)');
} else {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { EmergencyVoiceButton } = await import('../src/components/EmergencyVoiceButton.tsx');

  interface Harness {
    h: ReturnType<typeof installDomHarness>;
    rec: FakeSpeechRecognition;
    changes: Array<{ text: string; isFinal: boolean }>;
    submissions: string[];
    tap: () => Promise<void>;
    label: () => string;
    caption: () => string;
    status: () => string;
    stop: () => Promise<void>;
  }

  async function mount(options?: {
    selectedLanguage?: string;
    onResolveVoiceMode?: () => Promise<'server' | 'browser'>;
  }): Promise<Harness> {
    const h = installDomHarness();
    const changes: Array<{ text: string; isFinal: boolean }> = [];
    const submissions: string[] = [];
    const root = createRoot(h.root);
    await act(async () => {
      root.render(
        React.createElement(EmergencyVoiceButton, {
          onTranscriptChange: (text: string, isFinal: boolean) => changes.push({ text, isFinal }),
          onSubmitEmergency: (text?: string) => submissions.push(String(text)),
          isAnalyzing: false,
          soundEnabled: false,
          highContrast: false,
          selectedLanguage: options?.selectedLanguage || 'en',
          onResolveVoiceMode: options?.onResolveVoiceMode
        })
      );
    });
    await flush(20);
    const rec = h.recognition();
    const tap = async () => {
      await act(async () => {
        h.document
          .getElementById('emergency-voice-record-btn')
          .dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
      });
    };
    return {
      h,
      rec,
      changes,
      submissions,
      tap,
      label: () => h.document.getElementById('emergency-voice-record-btn')?.textContent || '',
      caption: () => h.document.getElementById('live-voice-caption')?.textContent || '',
      status: () => h.document.body.textContent || '',
      stop: async () => {
        await act(async () => {
          root.unmount();
        });
        h.cleanup();
      }
    };
  }

  /** Let timers run inside act() so React flushes without warnings. */
  const flush = async (ms: number) => {
    await act(async () => {
      await wait(ms);
    });
  };

  // -------------------------------------------------------------------------
  section('Tap starts recognition in the selected language');
  {
    const v = await mount({ selectedLanguage: 'ta' });
    assertEqual(v.rec.continuous, true, 'continuous mode requested (Chrome/Android end-pointing handled)');
    assertEqual(v.rec.interimResults, true, 'interim results requested');
    assertEqual(v.rec.startCalls, 0, 'nothing listens before the person taps');
    await v.tap();
    await flush(20);
    assertEqual(v.rec.startCalls, 1, 'a single tap starts exactly one recognition session');
    assertEqual(v.rec.started, true, 'recognizer is running after the tap');
    assertEqual(v.rec.lang, 'ta-IN', 'multilingual language selection applied to the recognizer');
    assertEqual(v.rec.startLangs[0], 'ta-IN', 'the language used for the FIRST start is Tamil, not English');
    assert(v.label().includes('Listening'), 'button reports Listening while the mic is open');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Interim and final results are accepted immediately');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.emit([{ transcript: 'my father', isFinal: false }]);
    });
    assertEqual(v.changes.length, 1, 'interim result forwarded to the parent immediately');
    assertEqual(v.changes[0].text, 'my father', 'interim text forwarded verbatim');
    assertEqual(v.changes[0].isFinal, false, 'interim flagged as not final');
    assert(v.caption().includes('my father'), 'live caption shows the interim words');
    await act(async () => {
      v.rec.emit([{ transcript: 'my father is not breathing', isFinal: true }]);
    });
    assertEqual(v.changes[v.changes.length - 1].text, 'my father is not breathing', 'final result forwarded');
    assertEqual(v.changes[v.changes.length - 1].isFinal, true, 'final flagged as final');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Chrome ends the session at its end-point — captured text is not lost');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.emit([{ transcript: 'my father', isFinal: false }]);
    });
    // Chrome/Android ends the continuous session by itself, with interim text
    // only and no final result at all.
    await act(async () => {
      v.rec.autoEnd();
    });
    await flush(250);
    assertEqual(v.rec.started, true, 'recognition is restarted after Chrome ends it by itself');
    assert(v.caption().includes('my father'), 'interim text kept after Chrome ended the session');
    // Continued speech in the restarted session completes the sentence.
    await act(async () => {
      v.rec.emit([{ transcript: 'is not breathing', isFinal: true }]);
    });
    await flush(1900); // silence commit
    assertEqual(v.submissions.length, 1, 'the captured emergency is submitted exactly once');
    assertEqual(v.submissions[0], 'my father is not breathing', 'text heard before AND after the auto-end is preserved');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Android cumulative final duplicates do not corrupt the transcript');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.emit([{ transcript: 'help', isFinal: true }]);
    });
    await act(async () => {
      v.rec.emit([{ transcript: 'help my father', isFinal: true }]);
    });
    await flush(1900);
    assertEqual(v.submissions.length, 1, 'one submission for one spoken sentence');
    assertEqual(v.submissions[0], 'help my father', 'cumulative final replaced, not duplicated');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Repeated no-speech / end-point churn stops instead of looping forever');
  {
    const v = await mount();
    await v.tap();
    const before = v.rec.startCalls;
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        v.rec.fireError('no-speech');
        v.rec.autoEnd();
      });
      await flush(190);
    }
    assert(
      v.rec.startCalls - before <= 3,
      `auto-restart is bounded (${v.rec.startCalls - before} restarts), the microphone is not restarted forever`
    );
    assertEqual(v.rec.started, false, 'session ends when Chrome keeps ending it without hearing anything');
    assert(!v.label().includes('Listening'), 'button no longer claims to be listening');
    assert(v.status().includes('Tap the microphone to speak again'), 'the person is told how to continue');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('A fatal recognition error ends the session instead of restarting');
  {
    const v = await mount();
    await v.tap();
    const before = v.rec.startCalls;
    await act(async () => {
      v.rec.fireError('network');
      v.rec.autoEnd();
    });
    await flush(250);
    assertEqual(v.rec.startCalls, before, 'a network error does not trigger another recognition start');
    assertEqual(v.rec.started, false, 'session is finished after a fatal error');
    assert(v.status().includes('needs a network connection'), 'network failure is explained to the user');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Microphone permission denial is reported and never retried');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.fireError('not-allowed');
      v.rec.autoEnd();
    });
    await flush(250);
    assertEqual(v.rec.startCalls, 1, 'permission denial is not retried automatically');
    assert(v.status().includes('permission'), 'permission problem is shown in plain language');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Another tap restarts a clean session');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.emit([{ transcript: 'fire in the kitchen', isFinal: false }]);
    });
    await flush(1900); // silence commit → submitted
    assertEqual(v.submissions.length, 1, 'first session submitted once');
    v.changes.length = 0;
    await v.tap();
    await flush(30);
    assertEqual(v.rec.startCalls, 2, 'a new tap starts a new session');
    assertEqual(v.rec.started, true, 'the new session is running');
    assertEqual(v.changes.length, 0, 'no transcript is carried over from the previous emergency');
    assert(!v.caption().includes('fire in the kitchen'), 'the caption is cleared for the new session');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('A tap while Chrome is still closing the previous session is not lost');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.emit([{ transcript: 'car crash', isFinal: false }]);
    });
    await v.tap(); // stop
    await v.tap(); // speak again immediately — Chrome may still be closing
    await flush(400);
    assert(v.rec.startCalls >= 2, 'the second tap still produces a new recognition session');
    assertEqual(v.rec.started, true, 'the queued restart leaves the microphone listening again');
    assertEqual(v.submissions.length, 1, 'the stopped session submitted only its own text');
    assertEqual(v.submissions[0], 'car crash', 'text from the stopped session is preserved');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Locking a language chip retargets the live recognizer');
  {
    const v = await mount();
    await v.tap();
    assertEqual(v.rec.lang, 'en-US', 'auto mode starts from the app/device language');
    const chips = Array.from(v.h.document.querySelectorAll('#voice-language-chips button')) as any[];
    const tamilChip = chips.find((c) => c.textContent === 'தமிழ்');
    assert(Boolean(tamilChip), 'Tamil language chip is offered');
    await act(async () => {
      tamilChip.dispatchEvent(new v.h.window.MouseEvent('click', { bubbles: true }));
    });
    await flush(60);
    assertEqual(v.rec.lang, 'ta-IN', 'locking Tamil retargets the recognizer language');
    assert(v.rec.started, 'listening continues in the newly selected language');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Browser voice path needs no paid ASR service and uploads nothing');
  {
    let resolveCalls = 0;
    let fetchCalls = 0;
    const v = await mount({
      onResolveVoiceMode: async () => {
        resolveCalls += 1;
        return 'browser';
      }
    });
    (globalThis as any).fetch = () => {
      fetchCalls += 1;
      throw new Error('the browser voice path must not use the network');
    };
    await v.tap();
    await flush(20);
    assertEqual(resolveCalls, 0, 'the server ASR probe is never reached when the browser can listen live');
    assertEqual(v.rec.startCalls, 1, 'browser SpeechRecognition is the microphone path');
    assertEqual(fetchCalls, 0, 'no network request is made by the browser voice path');
    assert(
      v.h.window.navigator.mediaDevices === undefined,
      'no MediaRecorder / getUserMedia capture is used by the live browser path'
    );
    await v.stop();
  }
}
