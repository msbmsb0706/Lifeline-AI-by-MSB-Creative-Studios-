/**
 * Regression suite — the offline SAVE choice must be visible up front.
 *
 * User report: in offline mode, after entering an SOS and saving it locally to
 * share, the built-in confirmation showed only "SAVE + AUTO-SEND WHEN THE
 * CONNECTION RETURNS" on screen. The other choice — "SAVE ON THIS DEVICE ONLY",
 * which is the default — was pushed below the fold on a phone by the auto-send
 * option's four preconditions, so the person could not see or reach it without
 * scrolling, and the dialog read as if automatic sending were the only offer.
 *
 * Fix (PartnerConsentModal.tsx): the two choices are rendered FIRST, compact and
 * side by side, immediately after the destination box and before the long
 * "data saved on this device" checklist; the full consequences of each choice
 * (including all four auto-send preconditions) are rendered underneath them, so
 * nothing is hidden and nothing has to be scrolled past to make the choice.
 *
 * Pinned here:
 *  1. Both choices are rendered as radios in one block, device-only by default.
 *  2. The choice block comes before the notice and before the data checklist.
 *  3. Neither compact choice contains the long precondition list (that is what
 *     used to push the second choice off screen) — the detail follows below.
 *  4. Behaviour: both radios are on screen together, the confirm button names
 *     the selected action, and the choice is passed to onConfirm exactly.
 *  5. Every precondition sentence the earlier PR #28 tests require still exists.
 */
import { readFileSync } from 'node:fs';
import { installDomHarness, wait } from './dom-harness.ts';
import { section, assert, assertEqual } from './helpers.ts';

function readRepoSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const src = readRepoSource('../src/components/PartnerConsentModal.tsx');

// ---------------------------------------------------------------------------
// 1-3 + 5. Source contracts.
// ---------------------------------------------------------------------------
section('Offline save choice — both options are offered up front');

const choiceIndex = src.indexOf('id="offline-save-choice"');
assert(choiceIndex !== -1, 'the offline choice block exists with a stable id');

const noticeIndex = src.indexOf('LOCAL SAVE ONLY — Nothing is being sent now');
const checklistIndex = src.indexOf('Data saved on this device (not sent):');
assert(noticeIndex !== -1 && checklistIndex !== -1, 'fixture: the notice and the data checklist exist');
assert(
  choiceIndex < noticeIndex,
  'the choice is rendered before the local-save notice (it is the first decision on screen)'
);
assert(
  choiceIndex < checklistIndex,
  'the choice is rendered before the long "data saved on this device" checklist'
);

assert(
  src.includes('SAVE ON THIS DEVICE ONLY') && src.includes('SAVE + AUTO-SEND WHEN THE CONNECTION RETURNS'),
  'both choices are still named for what they do'
);
assertEqual(
  (src.match(/name="lifeline-offline-choice"/g) || []).length,
  2,
  'the two choices are mutually exclusive radios in one group'
);
assert(
  src.includes('checked={!automaticRecovery}') && src.includes('checked={automaticRecovery}'),
  'each radio reports its own selected state'
);
assert(
  src.includes('const [automaticRecovery, setAutomaticRecovery] = useState(false);'),
  'the default stays SAVE ON THIS DEVICE ONLY (nothing is sent automatically)'
);
assert(
  !src.includes('<input type="checkbox" checked={automaticRecovery}'),
  'the choice is not a single buried checkbox'
);
assert(
  src.includes('Without the optional consent chosen above'),
  'the notice points at the choice that now sits above it'
);

// The compact choice row must not contain the long precondition list — that list
// is what pushed the second choice below the fold before.
{
  const gridStart = src.indexOf('<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">', choiceIndex);
  assert(gridStart !== -1 && gridStart > choiceIndex, 'the two choices sit in one compact grid');
  const detailStart = src.indexOf('— what it does', gridStart);
  assert(detailStart !== -1, 'the consequences of each choice are rendered below the grid');
  const gridBlock = src.slice(gridStart, detailStart);
  assert(!gridBlock.includes('list-decimal'), 'the compact choice grid holds no long numbered list');
  assert(
    gridBlock.split('\n').length < 60,
    `the two choices together stay short enough to see at once (${gridBlock.split('\n').length} lines)`
  );
}

// The honest detail is still present, word for word.
for (const needle of [
  'page is still open on this device and in the foreground',
  'A real Internet connection is verified',
  'authorized partner destination is actually configured',
  'You have not deleted the record or already sent it from the Pending SOS Queue',
  'Never sent automatically: GPS coordinates, photos, video.',
  'SHARE VIA DEVICE',
  'SAVE + AUTO-SEND WHEN ONLINE'
]) {
  assert(src.includes(needle), `the dialog still states: "${needle.slice(0, 48)}…"`);
}

// ---------------------------------------------------------------------------
// 4. Behaviour: the real component in jsdom.
// ---------------------------------------------------------------------------
let jsdomReady = true;
try {
  await import('jsdom');
} catch {
  jsdomReady = false;
}

if (!jsdomReady) {
  section('Offline save choice UI suite (jsdom missing)');
  assert(true, 'jsdom is not installed — UI rendering suite skipped (npm install)');
} else {
  const env = installDomHarness();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { PartnerConsentModal } = await import('../src/components/PartnerConsentModal.tsx');
  const { LOCAL_ONLY_PROVIDER } = await import('../src/lib/emergencyPartnersData.ts');
  const { createSOSPackage } = await import('../src/lib/emergencyPartnerQueue.ts');

  const flush = async (ms: number) => {
    await act(async () => {
      await wait(ms);
    });
  };

  const root = createRoot(env.root);
  const doc = env.document;
  const text = () => doc.body.textContent || '';

  const makePackage = () =>
    createSOSPackage({
      emergencyType: 'Medical',
      severity: 3,
      message: 'DISPATCH ALERT: Priority 3/5 - [MEDICAL] Medical.',
      source: 'offline',
      originalTranscript: 'எனக்கு மூச்சு விட முடியவில்லை',
      detectedLanguage: { code: 'ta', name: 'Tamil' }
    });

  const confirmBtn = () => doc.getElementById('consent-confirm-send-btn');
  const radios = () =>
    Array.from(doc.querySelectorAll('input[name="lifeline-offline-choice"]')) as any[];

  try {
    // -----------------------------------------------------------------------
    section('Both choices are on screen together, device-only selected first');
    {
      const confirmed: Array<{ includeGps: boolean; automaticRecovery: boolean }> = [];
      await act(async () => {
        root.render(
          React.createElement(PartnerConsentModal, {
            isOpen: true,
            provider: LOCAL_ONLY_PROVIDER,
            sosPackage: makePackage(),
            isOffline: true,
            onCancel: () => {},
            onConfirm: (options: any) => {
              confirmed.push(options);
            }
          })
        );
      });
      await flush(30);

      const block = doc.getElementById('offline-save-choice');
      assert(Boolean(block), 'the choice block is rendered for a local-only save');
      assertEqual(radios().length, 2, 'exactly two choices are offered');

      const body = text();
      const deviceOnlyAt = body.indexOf('SAVE ON THIS DEVICE ONLY');
      const autoSendAt = body.indexOf('SAVE + AUTO-SEND WHEN THE CONNECTION RETURNS');
      const checklistAt = body.indexOf('Data saved on this device (not sent):');
      assert(deviceOnlyAt !== -1, 'choice 1 (device only) is on screen');
      assert(autoSendAt !== -1, 'choice 2 (auto-send) is on screen');
      assert(
        deviceOnlyAt < checklistAt && autoSendAt < checklistAt,
        'BOTH choices appear before the data checklist — neither is below the fold behind it'
      );
      assert(
        Math.abs(deviceOnlyAt - autoSendAt) < 400,
        'the two choices sit next to each other, not separated by the long precondition list'
      );
      assert(
        body.indexOf('page is still open on this device and in the foreground') > autoSendAt,
        'the auto-send preconditions are rendered after the choices, not inside them'
      );

      assertEqual(radios()[0].checked, true, 'SAVE ON THIS DEVICE ONLY is selected by default');
      assertEqual(radios()[1].checked, false, 'auto-send is NOT selected by default');
      assert(
        Boolean(confirmBtn()) && confirmBtn()!.textContent!.includes('SAVE ON THIS DEVICE ONLY'),
        'the confirm button names the selected action'
      );

      await act(async () => {
        confirmBtn()!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(confirmed.length, 1, 'one tap confirms once');
      assertEqual(confirmed[0].automaticRecovery, false, 'the default choice sends nothing automatically');
      assertEqual(confirmed[0].includeGps, false, 'a local save never includes GPS');
    }

    // -----------------------------------------------------------------------
    section('Choosing auto-send is explicit and is what gets saved');
    {
      const confirmed: Array<{ includeGps: boolean; automaticRecovery: boolean }> = [];
      await act(async () => {
        root.render(
          React.createElement(PartnerConsentModal, {
            isOpen: true,
            provider: LOCAL_ONLY_PROVIDER,
            sosPackage: makePackage(),
            isOffline: true,
            onCancel: () => {},
            onConfirm: (options: any) => {
              confirmed.push(options);
            }
          })
        );
      });
      await flush(30);
      assertEqual(radios()[0].checked, true, 'reopening the dialog resets to the device-only default');

      const autoSendRadio = radios()[1];
      await act(async () => {
        autoSendRadio.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      await flush(20);
      assertEqual(radios()[1].checked, true, 'tapping the second choice selects auto-send');
      assertEqual(radios()[0].checked, false, 'the two choices stay mutually exclusive');
      assert(
        Boolean(confirmBtn()) && confirmBtn()!.textContent!.includes('SAVE + AUTO-SEND WHEN ONLINE'),
        'the confirm button changes to name the automatic action'
      );

      await act(async () => {
        confirmBtn()!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(confirmed.length, 1, 'one tap confirms once');
      assertEqual(confirmed[0].automaticRecovery, true, 'the explicit auto-send choice is what is saved');
      assertEqual(confirmed[0].includeGps, false, 'even auto-send never includes GPS, photos or video');
    }
  } finally {
    await act(async () => {
      root.unmount();
    });
    env.cleanup();
  }
}
