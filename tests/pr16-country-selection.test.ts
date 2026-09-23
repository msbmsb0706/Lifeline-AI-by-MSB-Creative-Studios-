/**
 * PR #16 follow-up: country-selection wiring regression tests.
 *
 * Root cause (audit HIGH blocker): EmergencyPartnersManagerModal.tsx declared
 * a LOCAL `const setSelectedCountry` that shadowed the imported persistence
 * setter of the same name from emergencyNumbers.ts. The wrapper body called
 * `setSelectedCountry(code)`, which resolved to ITSELF, so every country-pill
 * click threw `RangeError: Maximum call stack size exceeded` and the country
 * was never persisted.
 *
 * Fix: the local wrapper is renamed to `handleSelectedCountryChange`, which
 * updates local state and calls the imported setter exactly once.
 *
 * These tests prove (per the repo's call-site/source-assertion convention,
 * since the modal is a React component):
 *  1. No local declaration shadows the imported `setSelectedCountry`.
 *  2. The wrapper calls the imported persistence setter exactly once and
 *     updates local state exactly once.
 *  3. The wrapper never calls itself (no recursion possible).
 *  4. Both country pills route through the wrapper.
 *  5. Behaviourally (real persistence functions): selecting a country
 *     persists it under the shared storage key and survives re-read.
 *  6. SOSCardView still reads the selected country and resolves/displays the
 *     configured number (wiring intact).
 * Also guards the two audit cleanup items (memo deps, doc comment).
 */
import { readFileSync } from 'node:fs';
import { installBrowserStub } from './browser-stub.ts';
import { section, assert, assertEqual } from './helpers.ts';
import {
  getSelectedCountry,
  setSelectedCountry,
  SELECTED_COUNTRY_STORAGE_KEY
} from '../src/lib/emergencyNumbers.ts';

function readRepoSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const modalSrc = readRepoSource('../src/components/EmergencyPartnersManagerModal.tsx');

// ---------------------------------------------------------------------------
// 1-4. Wiring: no shadowing, no self-recursion, pills routed via the wrapper.
// ---------------------------------------------------------------------------
section('PR16-FIX country selection — no self-recursive shadowing');

assert(
  !/(^|\n)\s*(const|let|var|function)\s+setSelectedCountry\s*[=(]/.test(modalSrc),
  'modal declares no local setSelectedCountry (import is not shadowed)'
);

assert(
  modalSrc.includes("setSelectedCountry } from '../lib/emergencyNumbers.ts'"),
  'modal still imports the real persistence setter from emergencyNumbers'
);

const wrapperDecl = 'const handleSelectedCountryChange';
const declIndex = modalSrc.indexOf(wrapperDecl);
assert(declIndex !== -1, 'country-change wrapper exists under a non-conflicting name');
const wrapperEnd = declIndex === -1 ? -1 : modalSrc.indexOf('};', declIndex);
const wrapperBody = declIndex === -1 || wrapperEnd === -1 ? '' : modalSrc.slice(declIndex, wrapperEnd);

assertEqual(
  (wrapperBody.match(/setSelectedCountry\(/g) || []).length,
  1,
  'wrapper calls the imported persistence setter exactly once'
);
assertEqual(
  (wrapperBody.match(/setSelectedCountryState\(/g) || []).length,
  1,
  'wrapper updates local country state exactly once'
);
assert(!wrapperBody.includes('handleSelectedCountryChange('), 'wrapper never calls itself (no recursion)');

assertEqual(
  (modalSrc.match(/handleSelectedCountryChange\(/g) || []).length,
  2,
  'both country pills (country + ALL) route through the wrapper'
);
assert(
  !/onClick=\{\(\) => setSelectedCountry\(/.test(modalSrc),
  'no pill bypasses the wrapper with a bare setter call'
);

// ---------------------------------------------------------------------------
// 5. Behaviour: selecting a country persists it (real persistence functions).
// ---------------------------------------------------------------------------
section('PR16-FIX country selection — selection persists');

installBrowserStub({ online: true });

assertEqual(getSelectedCountry(), null, 'no country selected initially');
setSelectedCountry('IN');
assertEqual(getSelectedCountry(), 'IN', 'selecting IN persists IN');
assertEqual(getSelectedCountry(), 'IN', 'selection survives re-read (reload)');
setSelectedCountry('US');
assertEqual(getSelectedCountry(), 'US', 'changing selection to US persists US');
assertEqual(
  (globalThis as any).localStorage.getItem(SELECTED_COUNTRY_STORAGE_KEY),
  'US',
  'selection persists under the shared storage key'
);

// ---------------------------------------------------------------------------
// 6. SOS card still receives the configured country.
// ---------------------------------------------------------------------------
section('PR16-FIX country selection — SOS card wiring');

const cardSrc = readRepoSource('../src/components/SOSCardView.tsx');
assert(cardSrc.includes('getSelectedCountry()'), 'SOS card reads the selected country');
assert(
  cardSrc.includes('getCountryEmergencyNumber(selectedCountry)'),
  'SOS card resolves the configured number for the country'
);
assert(
  cardSrc.includes('getEmergencyNumberDisplay(selectedCountry)'),
  'SOS card displays the configured/not-configured number state'
);

// ---------------------------------------------------------------------------
// Audit cleanups: memo dependencies + partner-config doc comment.
// ---------------------------------------------------------------------------
section('PR16-FIX audit cleanups');

const deliverySrc = readRepoSource('../src/components/SOSDeliveryStatus.tsx');
assert(
  deliverySrc.includes('[effectiveStatus, simulatedFinal]'),
  'delivery-card memo lists simulatedFinal in its dependencies'
);
const partnerConfigSrc = readRepoSource('../server/partnerConfig.ts');
assert(
  !partnerConfigSrc.includes('Throws when the lookup cannot be performed'),
  'partner-config doc no longer claims to throw'
);
