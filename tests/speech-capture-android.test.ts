/**
 * Browser voice lifecycle — reproduces Chrome/Android auto end-pointing with a
 * fake SpeechRecognition. No paid ASR service involved.
 */
import { section, assert, assertEqual as eq } from './helpers.ts';
const assertEqual = (a: unknown, b: unknown, m: string) =>
  typeof b === 'object' ? eq(JSON.stringify(a), JSON.stringify(b), m) : eq(a, b, m);
import { SpeechCaptureController, buildTranscript, type RecognitionLike } from '../src/lib/speechCapture.ts';

class FakeRec implements RecognitionLike {
  lang = ''; continuous = false; interimResults = false;
  onstart: any = null; onresult: any = null; onerror: any = null; onend: any = null;
  started = false; aborted = false; stopped = false;
  start() { if (this.started) throw new Error('InvalidStateError'); this.started = true; }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; }
  emit(results: Array<[string, boolean]>) {
    const r: any = results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));
    this.onresult?.({ resultIndex: results.length - 1, results: r });
  }
}

function setup() {
  const recs: FakeRec[] = [];
  const log = { listening: [] as boolean[], transcripts: [] as Array<[string, boolean]>, errors: [] as (string | null)[], ends: [] as string[] };
  const c = new SpeechCaptureController(() => { const r = new FakeRec(); recs.push(r); return r; }, {
    onListeningChange: (l) => log.listening.push(l),
    onTranscript: (t, f) => log.transcripts.push([t, f]),
    onError: (e) => log.errors.push(e),
    onSessionEnd: (t) => log.ends.push(t),
  });
  return { c, recs, log };
}

section('speech capture — start, interim/final, language');
{
  const { c, recs, log } = setup();
  assert(c.start('ta-IN'), 'start succeeds');
  assertEqual(recs[0].lang, 'ta-IN', 'selected language locale applied');
  assert(recs[0].continuous && recs[0].interimResults, 'continuous + interim enabled');
  assertEqual(c.isListening, true, 'listening immediately after tap');
  recs[0].onstart();
  recs[0].emit([['help', false]]);
  assertEqual(log.transcripts.at(-1), ['help', false], 'interim result delivered immediately');
  recs[0].emit([['help my father', true], ['fell', false]]);
  assertEqual(log.transcripts.at(-1), ['help my father fell', false], 'final + interim combined');
}

section('speech capture — Chrome auto-ends: text is not lost');
{
  const { c, recs, log } = setup();
  c.start('en-US'); recs[0].onstart();
  recs[0].emit([['there is a fire', true]]);
  recs[0].emit([['there is a fire', true], ['on the second floor', false]]);
  recs[0].onend(); // Android end-point, no final for the trailing interim
  assertEqual(log.ends, ['there is a fire on the second floor'], 'trailing interim promoted and preserved');
  assertEqual(log.transcripts.at(-1), ['there is a fire on the second floor', true], 'final transcript emitted on end');
  assertEqual(c.isListening, false, 'listening cleared on end');
}

section('speech capture — earlier finals kept across resultIndex');
{
  const r = buildTranscript(Object.assign([
    Object.assign([{ transcript: 'car crash' }], { isFinal: true }),
    Object.assign([{ transcript: 'two injured' }], { isFinal: true }),
  ]));
  assertEqual(r.finalText, 'car crash two injured', 'all finals included, not only from resultIndex');
  const dup = buildTranscript([
    Object.assign([{ transcript: 'help' }], { isFinal: true }),
    Object.assign([{ transcript: 'help me' }], { isFinal: true }),
  ]);
  assertEqual(dup.finalText, 'help me', 'Android cumulative duplicate finals collapsed');
}

section('speech capture — onerror/onend handled once');
{
  const { c, recs, log } = setup();
  c.start('en-US'); recs[0].onstart();
  recs[0].emit([['chest pain', false]]);
  recs[0].onerror({ error: 'network' });
  recs[0].onend();
  assertEqual(log.ends.length, 1, 'session ends exactly once');
  assertEqual(log.ends[0], 'chest pain', 'text preserved on error');
  assert(String(log.errors.at(-1)).includes('network'), 'network error surfaced');

  const s2 = setup();
  s2.c.start('en-US'); s2.recs[0].onerror({ error: 'no-speech' }); s2.recs[0].onend();
  assertEqual(s2.log.errors.filter(Boolean).length, 0, 'no-speech is silent');
  assertEqual(s2.c.isListening, false, 'no-speech resets listening');

  const s3 = setup();
  s3.c.start('en-US'); s3.recs[0].onerror({ error: 'not-allowed' });
  assert(String(s3.log.errors.at(-1)).includes('permission'), 'permission error surfaced');
}

section('speech capture — manual stop and clean restart');
{
  const { c, recs, log } = setup();
  c.start('hi-IN'); recs[0].onstart(); recs[0].emit([['madad', true]]);
  c.stop();
  assert(recs[0].stopped, 'stop() forwarded to recognizer');
  recs[0].onend();
  assertEqual(log.ends, ['madad'], 'manual stop delivers text once');

  // Restart while the old session is still shutting down (no onend yet)
  c.start('hi-IN'); recs[1].onstart(); recs[1].emit([['first', false]]);
  c.stop();
  assert(c.start('en-IN'), 'second tap restarts without InvalidStateError');
  assert(recs[1].aborted, 'previous recognizer aborted');
  assert(recs[2] && recs[2] !== recs[1], 'fresh recognizer per tap');
  assertEqual(recs[2].lang, 'en-IN', 'new language used on restart');
  recs[1].onend?.(); recs[1].onresult?.({ results: [] });
  assertEqual(log.ends.length, 1, 'stale events from old recognizer ignored');
  recs[2].onstart(); recs[2].emit([['second', true]]); recs[2].onend();
  assertEqual(log.ends.at(-1), 'second', 'new session captured cleanly');
  assertEqual(c.isListening, false, 'idle after session');
}
