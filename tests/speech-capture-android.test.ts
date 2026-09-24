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
assert(String(speechErrorMessage('network')).includes('network'), 'network message');

section('EmergencyVoiceButton — Android lifecycle contracts');
const src = readFileSync(new URL('../src/components/EmergencyVoiceButton.tsx', import.meta.url), 'utf8');
const onend = src.slice(src.indexOf('recognition.onend = () => {'), src.indexOf('recognitionRef.current = recognition;'));
assert(
  onend.indexOf('committedRef.current = liveTextRef.current.trim()') !== -1 &&
    onend.indexOf('committedRef.current = liveTextRef.current.trim()') < onend.indexOf('recognition.start()'),
  'interim text is committed BEFORE Chrome auto-restart (text not lost)'
);
assert(src.includes('mergeFinalChunk(committedRef.current, finalChunk)'), 'finals merged duplicate-safely');
assert(src.includes("err?.name === 'InvalidStateError'") && src.includes('pendingStartRef.current = true'),
  'tap during shutdown queues a clean restart instead of failing');
assert(onend.includes('pendingStartRef.current'), 'queued restart handled in onend');
assert(src.includes('submitOnce'), 'submission happens once per session');
assert(src.includes('getSpeechRecognitionLocale(startCode)'), 'selected/locked language applied on start');
assert(!src.includes('Nebius'), 'no provider name in public voice UI');
