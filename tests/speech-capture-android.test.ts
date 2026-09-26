/**
 * Browser voice helpers + EmergencyVoiceButton lifecycle contracts for
 * Chrome/Android auto end-pointing. No paid ASR service involved.
 */
import { readFileSync } from 'node:fs';
import { section, assert, assertEqual } from './helpers.ts';
import { buildTranscript, mergeFinalChunk, speechErrorMessage } from '../src/lib/speechCapture.ts';

section('speech capture — final merging (Android duplicates)');
assertEqual(mergeFinalChunk('', 'help'), 'help', 'first chunk');
assertEqual(mergeFinalChunk('help', 'my father fell'), 'help my father fell', 'new chunk appended');
assertEqual(mergeFinalChunk('help', 'help my father'), 'help my father', 'cumulative final replaces, not duplicates');
assertEqual(mergeFinalChunk('help my father', 'help my father'), 'help my father', 'exact repeat ignored');
assertEqual(mergeFinalChunk('car crash fire', 'fire on floor two'), 'car crash fire on floor two', 'repeated tail merged');
assertEqual(mergeFinalChunk('உதவி', 'தேவை'), 'உதவி தேவை', 'Tamil chunks appended');

section('speech capture — all results kept');
const r = buildTranscript([
  Object.assign([{ transcript: 'car crash' }], { isFinal: true }),
  Object.assign([{ transcript: 'two injured' }], { isFinal: true }),
  Object.assign([{ transcript: 'hurry' }], { isFinal: false }),
]);
assertEqual(r.finalText, 'car crash two injured', 'finals kept');
assertEqual(r.interimText, 'hurry', 'interim kept');

section('speech capture — error messages');
assertEqual(speechErrorMessage('no-speech'), null, 'no-speech silent');
assertEqual(speechErrorMessage('aborted'), null, 'aborted silent');
assert(String(speechErrorMessage('not-allowed')).includes('permission'), 'permission message');
assert(String(speechErrorMessage('audio-capture')).includes('in use by another app'),
  'audio-capture covers a missing OR a busy microphone');
assert(String(speechErrorMessage('network')).includes('network'), 'network message');

section('EmergencyVoiceButton — Android lifecycle contracts');
const src = readFileSync(new URL('../src/components/EmergencyVoiceButton.tsx', import.meta.url), 'utf8');
const onend = src.slice(src.indexOf('recognition.onend = () => {'), src.indexOf('recognitionRef.current = recognition;'));
assert(
  onend.indexOf('committedRef.current = liveTextRef.current.trim()') !== -1 &&
    onend.indexOf('committedRef.current = liveTextRef.current.trim()') < onend.indexOf('startRecognizer('),
  'interim text is committed BEFORE Chrome auto-restart (text not lost)'
);
assert(src.includes('buildTranscript(event.results)'), 'every result is read, not only from resultIndex');
assert(src.includes('mergeFinalChunk(committedRef.current, finalText)'), 'finals merged duplicate-safely');
assert(src.includes("err?.name === 'InvalidStateError'") && src.includes('pendingStartRef.current = true'),
  'tap during shutdown queues a clean restart instead of failing');
assert(onend.includes('pendingStartRef.current'), 'queued restart handled in onend');
assert(src.includes('submitOnce'), 'submission happens once per session');
assert(src.includes('getSpeechRecognitionLocale(startCode)'), 'selected/locked language applied on start');
assert(!src.includes('Nebius'), 'no provider name in public voice UI');
assert(src.includes('stream.getTracks().forEach((track) => track.stop())'),
  'the permission probe stream is stopped immediately — only the permission was needed');
assert(!src.includes('alert('), 'no browser alert dialogs in the voice UI — errors stay in-app, never public');

section('EmergencyVoiceButton — Chrome auto-end churn is bounded');
assert(src.includes('MAX_AUTO_RESTARTS'), 'auto-restart after Chrome end-pointing has a hard cap');
assert(
  !/onstart = \(\) => \{[\s\S]{0,240}restartCountRef\.current = 0/.test(src),
  'the restart budget is NOT reset on every onstart (otherwise the cap can never be reached)'
);
assert(src.includes('startBrowserSession') && /startBrowserSession[\s\S]{0,1400}restartCountRef\.current = 0/.test(src),
  'a user-initiated session resets the restart budget');
assert(
  /onresult[\s\S]{0,600}restartCountRef\.current = 0/.test(src),
  'hearing real speech also resets the restart budget');
assert(src.includes('FATAL_RECOGNITION_ERRORS') && src.includes("'network'"),
  'fatal recognition errors end the session instead of restarting forever');
assert(src.includes('runningRef.current'), 'tap decisions use the recognizer real state, not stale React state');
