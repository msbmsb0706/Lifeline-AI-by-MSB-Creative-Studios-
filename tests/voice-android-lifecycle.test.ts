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
import { installDomHarness, installReactInputProbeEnvironment, wait, FakeSpeechRecognition } from './dom-harness.ts';
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

  // React probes the GLOBAL document once, at module init, to learn whether
  // the 'input' event is natively supported. Install a script-enabled jsdom
  // window BEFORE the first react-dom/client import so the modern change
  // detection path is active for this whole suite (see dom-harness).
  installReactInputProbeEnvironment();

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act, useState } = await import('react');
  const { EmergencyVoiceButton } = await import('../src/components/EmergencyVoiceButton.tsx');
  const { TranscriptArea } = await import('../src/components/TranscriptArea.tsx');

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
    onVoiceRecordingStopped?: (audioBase64: string, mimeType: string, durationMs: number) => void;
    micPermission?: 'granted' | 'denied' | 'prompt';
    micProbeErrorName?: string | null;
    navigatorLanguages?: string[];
    withMediaRecorder?: boolean;
  }): Promise<Harness> {
    const h = installDomHarness({
      micPermission: options?.micPermission,
      micProbeErrorName: options?.micProbeErrorName,
      navigatorLanguages: options?.navigatorLanguages,
      withMediaRecorder: options?.withMediaRecorder
    });
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
          onResolveVoiceMode: options?.onResolveVoiceMode,
          onVoiceRecordingStopped: options?.onVoiceRecordingStopped
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
  section('Language choices remain available while speaking, without an Any language chip');
  {
    const v = await mount();
    await v.tap();
    assertEqual(v.rec.lang, 'en-US', 'auto mode starts from the app/device language');
    const languageChips = v.h.document.querySelectorAll('#voice-language-chips button');
    assertEqual(languageChips.length, 10, 'all supported language choices are available while speaking');
    assert(
      Array.from(languageChips as NodeListOf<HTMLButtonElement>).some((button) => button.textContent?.includes('தமிழ்')),
      'Tamil remains available as a microphone language'
    );
    assert(
      Array.from(languageChips as NodeListOf<HTMLButtonElement>).every((button) => !button.textContent?.includes('Any language')),
      'only the Any language choice is removed from the language picker'
    );
    assert(
      v.caption().includes('Auto'),
      'the live caption still reports the language being heard automatically'
    );
    assert(
      !v.label().includes('Any language'),
      'the Any language wording is removed from the microphone button too'
    );

    // What the chips used to do by hand now happens by itself: hearing another
    // language retargets the live recognizer.
    await act(async () => {
      v.rec.emit([{ transcript: 'முதியவருக்கு கடுமையான நெஞ்சு வலி காப்பாத்துங்க', isFinal: false }]);
    });
    await flush(120);
    assertEqual(v.rec.lang, 'ta-IN', 'hearing Tamil retargets the recognizer with no manual choice');
    assert(v.rec.started, 'listening continues in the detected language');
    assert(
      v.caption().includes('தமிழ்') || v.caption().includes('Tamil'),
      'the caption names the language now being heard'
    );
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Choosing a language chip switches the active recognizer');
  {
    const v = await mount();
    await v.tap();
    const hindiChip = Array.from(
      v.h.document.querySelectorAll('#voice-language-chips button') as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.includes('हिन्दी'));
    assert(Boolean(hindiChip), 'Hindi language chip is present');
    await act(async () => {
      hindiChip!.dispatchEvent(new v.h.window.MouseEvent('click', { bubbles: true }));
    });
    await flush(30);
    assertEqual(v.rec.lang, 'hi-IN', 'selecting Hindi switches the active browser recognizer');
    assert(v.caption().includes('Locked'), 'the caption shows that a language was explicitly selected');
    assertEqual(v.rec.started, true, 'recognition continues after the language switch');
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

  // -------------------------------------------------------------------------
  // The getUserMedia() permission probe was REMOVED from the browser voice path.
  //
  // On Chrome/Android that probe was the reason live voice failed: it grabbed
  // the microphone and, even after track.stop(), the Android audio stack had
  // not released it when recognition.start() ran — the recognizer failed with
  // 'audio-capture' having heard nothing. Awaiting the probe also pushed
  // recognition.start() outside the tap's user-activation window, so Chrome
  // could answer 'not-allowed' and the app reported a permission denial the
  // user never saw a prompt for.
  // -------------------------------------------------------------------------
  section('Browser voice path opens NO getUserMedia probe — the recognizer owns the mic');
  {
    const v = await mount({ micPermission: 'prompt' });
    await v.tap();
    await flush(30);
    assertEqual(v.h.mic.getUserMediaCalls.length, 0, 'no getUserMedia probe on the browser voice path');
    assertEqual(v.h.mic.trackStops, 0, 'no probe stream is opened, so none needs closing');
    assertEqual(v.rec.startCalls, 1, 'SpeechRecognition opens the microphone itself');
    assert(v.label().includes('Listening'), 'listening UI appears from the recognizer alone');
    assertEqual(v.h.mic.alerts, 0, 'no browser alert dialog in the emergency voice UI');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('recognition.start() runs synchronously inside the tap (user gesture intact)');
  {
    const v = await mount({ micPermission: 'prompt' });
    // Dispatch the click and inspect IMMEDIATELY, before any microtask or timer
    // can run: a start that survives this check cannot have awaited anything.
    await act(async () => {
      v.h.document
        .getElementById('emergency-voice-record-btn')
        .dispatchEvent(new v.h.window.MouseEvent('click', { bubbles: true }));
    });
    assertEqual(v.rec.startCalls, 1, 'recognition started synchronously within the tap handler');
    assertEqual(v.rec.startLangs.length, 1, 'exactly one start was issued by the tap');
    assert(v.rec.started, 'the recognizer is running without a preceding getUserMedia round trip');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Insecure origin: honest https explanation, recognizer never starts');
  {
    const v = await mount();
    // Chrome/Android refuses microphone access on an insecure origin — a very
    // common way to hit "the mic does nothing" on a LAN test build.
    v.h.window.isSecureContext = false;
    await v.tap();
    await flush(30);
    assertEqual(v.rec.startCalls, 0, 'no recognition attempt on an insecure origin');
    assert(v.status().includes('https'), 'the page explains that a secure (https) connection is required');
    assert(v.status().includes('type your emergency below'), 'typing is offered as the always-working path');
    assertEqual(v.h.mic.alerts, 0, 'the explanation is in-app, not a browser alert');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section("Browser engine unreachable ('network'): explained in-app, LifeLine recorder offered");
  {
    let resolveCalls = 0;
    const v = await mount({
      micPermission: 'prompt',
      withMediaRecorder: true,
      onVoiceRecordingStopped: () => {},
      onResolveVoiceMode: async () => {
        resolveCalls += 1;
        return 'server';
      }
    });
    await v.tap();
    await flush(20);
    // Android Chrome: Google's speech service is unreachable → one 'network'
    // error, nothing heard. The old UI just stopped and said nothing.
    v.rec.fireError('network');
    v.rec.autoEnd();
    await flush(60);
    assert(v.status().includes('unreachable'), "the failure is named: Chrome's speech service is unreachable");
    assertEqual(resolveCalls, 1, 'the server transcription availability is checked exactly once');
    const fallbackBtn = v.h.document.getElementById('voice-engine-fallback-btn');
    assert(Boolean(fallbackBtn), 'a RECORD WITH LIFELINE VOICE fallback is offered');
    assertEqual(v.h.mic.alerts, 0, 'still no browser alert dialog');
    // Tapping the fallback must open a real MediaRecorder capture.
    await act(async () => {
      fallbackBtn!.dispatchEvent(new v.h.window.MouseEvent('click', { bubbles: true }));
    });
    await flush(60);
    assertEqual(v.h.mic.recorderStarts, 1, 'the fallback recorder starts exactly one MediaRecorder capture');
    assert(v.h.mic.getUserMediaCalls.length >= 1, 'the fallback recorder opens the microphone via getUserMedia');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Browser engine unreachable but no server ASR: typing is offered, no dead end');
  {
    const v = await mount({ onResolveVoiceMode: async () => 'browser', onVoiceRecordingStopped: () => {} });
    await v.tap();
    await flush(20);
    v.rec.fireError('network');
    v.rec.autoEnd();
    await flush(60);
    assert(v.status().includes('unreachable'), 'the engine failure is still stated plainly');
    assert(v.status().includes('type the emergency below'), 'typing is presented as the always-working path');
    assert(
      v.h.document.getElementById('voice-engine-fallback-btn') === null,
      'no server-recorder fallback is offered when server ASR is not configured'
    );
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Nothing heard within the watchdog: the session is diagnosed, never left silent');
  {
    const { NO_SPEECH_WATCHDOG_MS } = await import('../src/components/EmergencyVoiceButton.tsx');
    const v = await mount({ onResolveVoiceMode: async () => 'browser' });
    await v.tap();
    await flush(20);
    assert(!v.status().includes('unreachable'), 'no failure is claimed while results may still arrive');
    await flush(NO_SPEECH_WATCHDOG_MS + 120);
    assert(
      v.status().includes('unreachable') || v.status().includes('type'),
      'a session that produced nothing is reported instead of pulsing forever'
    );
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Real speech cancels the watchdog and any fallback offer');
  {
    const v = await mount({ onResolveVoiceMode: async () => 'server' });
    await v.tap();
    await flush(20);
    v.rec.emit([{ transcript: 'fire in the kitchen', isFinal: true }]);
    await flush(40);
    assertEqual(v.changes.length > 0, true, 'the transcript reached the parent');
    await flush(9000);
    assert(!v.status().includes('unreachable'), 'a session that heard speech is never reported as failed');
    assert(
      v.h.document.getElementById('voice-engine-fallback-btn') === null,
      'no fallback offer survives a working session'
    );
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Recognition starts in the USER language immediately on tap');
  {
    // App language left at the default (auto): the device language must win
    // for the VERY FIRST start — no English-first start that gets re-targeted.
    const v = await mount({ navigatorLanguages: ['ta-IN', 'en-US'] });
    await v.tap();
    await flush(20);
    assertEqual(v.rec.startCalls, 1, 'a tap starts recognition immediately');
    assertEqual(v.rec.startLangs[0], 'ta-IN', 'the FIRST start is the user language, not English');
    assertEqual(v.rec.lang, 'ta-IN', 'the recognizer stays in the user language');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Re-emitted identical finals never duplicate the transcript or the submission');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.emit([{ transcript: 'help', isFinal: true }]);
    });
    await act(async () => {
      v.rec.emit([{ transcript: 'help', isFinal: true }]); // device re-emits the exact same final
    });
    await flush(1900); // silence commit
    assertEqual(v.submissions.length, 1, 'one submission despite the duplicated final');
    assertEqual(v.submissions[0], 'help', 'the duplicated final is not appended twice');
    assert(!v.caption().includes('help help'), 'no duplicated words in the transcript');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Interim words are not repeated when the final arrives');
  {
    const v = await mount();
    await v.tap();
    await act(async () => {
      v.rec.emit([{ transcript: 'my father', isFinal: false }]);
    });
    assert(v.caption().includes('my father'), 'interim words shown live');
    await act(async () => {
      v.rec.emit([{ transcript: 'my father', isFinal: true }]);
    });
    await flush(1900); // silence commit
    assertEqual(v.submissions.length, 1, 'one submission for interim-then-final speech');
    assertEqual(v.submissions[0], 'my father', 'the final does not repeat the interim words');
    await v.stop();
  }

  // -------------------------------------------------------------------------
  section('Typing is instant while recognition is live — input is never blocked');
  {
    const h = installDomHarness();
    const typed: string[] = [];
    const Host = () => {
      const [text, setText] = useState('');
      return React.createElement(TranscriptArea, {
        transcript: text,
        onTranscriptChange: (t: string) => { typed.push(t); setText(t); },
        onSubmitEmergency: () => {},
        isAnalyzing: false,
        offlineForce: false,
        highContrast: false,
        locationInfo: null,
        onLocationUpdate: () => {},
        selectedLanguage: 'en',
        onLanguageChange: () => {}
      });
    };
    const root = createRoot(h.root);
    await act(async () => {
      root.render(React.createElement(React.Fragment, null,
        React.createElement(EmergencyVoiceButton, {
          onTranscriptChange: () => {},
          isAnalyzing: false,
          soundEnabled: false,
          highContrast: false,
          selectedLanguage: 'en'
        }),
        React.createElement(Host)
      ));
    });
    await flush(20);
    await act(async () => {
      h.document.getElementById('emergency-voice-record-btn')
        .dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));
    });
    await flush(20);
    const rec = FakeSpeechRecognition.instances[FakeSpeechRecognition.instances.length - 1];
    assertEqual(rec.started, true, 'recognition is live while we type');
    const textarea = h.document.getElementById('emergency-transcript-input') as any;
    assert(Boolean(textarea), 'the typing box is present');
    assertEqual(textarea.disabled, false, 'typing is NOT blocked while the microphone is live');
    const setter = Object.getOwnPropertyDescriptor(h.window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(textarea, 'help me');
      textarea.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    });
    assertEqual(typed[typed.length - 1], 'help me', 'typed text is accepted instantly');
    assertEqual(textarea.value, 'help me', 'the box shows the typed text instantly');
    await act(async () => {
      root.unmount();
    });
    h.cleanup();
  }
}
