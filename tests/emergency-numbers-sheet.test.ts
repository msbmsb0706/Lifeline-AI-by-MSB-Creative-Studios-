/**
 * Regression suite — the sliding Emergency Numbers layer (country picker).
 *
 * The top triage/alert banner offers "Select country to view its emergency
 * number". That trigger opens a sliding bottom-sheet layer which lists EVERY
 * verified public/government number by country (Canada, EU, UK, India, US,
 * Australia) and lets the person promote one of them in the banner.
 *
 * Contracts pinned here:
 *  1. PUBLIC DATA: the sheet needs no GPS/geolocation, no sign-in and no
 *     partner authentication, and it says so on screen.
 *  2. NEVER INVENTED: the component contains no hard-coded emergency number —
 *     every digit comes from the verified directory (`listPublicEmergencyNumbers`).
 *     The "Global / Test Providers" demo bucket is never offered as a country.
 *  3. NEVER HIDDEN: choosing a country promotes ONE number in the banner; the
 *     always-visible public list on the main screen is untouched, and the sheet
 *     itself keeps every country row visible.
 *  4. LAYER BEHAVIOUR: real slide-in / slide-out (mounted only while visible or
 *     animating), Escape and backdrop close, clicks inside the sheet do not
 *     close it, and the rest of the app stays mounted.
 *  5. WIRING: the App handler persists the choice exactly once through the
 *     shared setter (the PR #16 self-shadowing/recursion bug class) and the
 *     banner re-reads the directory selection when the partner modal closes.
 */
import { readFileSync } from 'node:fs';
import { installDomHarness, wait } from './dom-harness.ts';
import { section, assert, assertEqual } from './helpers.ts';

function readRepoSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const sheetSrc = readRepoSource('../src/components/EmergencyNumbersModal.tsx');
const appSrc = readRepoSource('../src/App.tsx');

// ---------------------------------------------------------------------------
// 1-2. Source contracts: public data, single source of truth, no invented digits.
// ---------------------------------------------------------------------------
section('Emergency numbers sheet — public data, never invented');

assert(
  sheetSrc.includes("listPublicEmergencyNumbers") &&
    sheetSrc.includes("from '../lib/emergencyNumbers.ts'"),
  'the sheet reads its numbers from the verified public directory'
);
assert(
  sheetSrc.includes('EMERGENCY_NUMBER_NOT_CONFIGURED'),
  'an unverified country shows the explicit not-configured notice'
);
// A hard-coded number could only ever appear as a quoted digit string or a
// literal tel: target — both are forbidden: every digit must come from the
// verified directory at render time.
const digitLiterals = sheetSrc.match(/['"`]\d{2,5}['"`]/g) || [];
const telLiterals = sheetSrc.match(/tel:[^'"`\s]*\d/g) || [];
assertEqual(
  digitLiterals.length,
  0,
  `the sheet hard-codes no emergency number literal (found ${JSON.stringify(digitLiterals)})`
);
assertEqual(
  telLiterals.length,
  0,
  `no tel: target contains a literal number (found ${JSON.stringify(telLiterals)})`
);
assert(
  sheetSrc.includes('href={`tel:${entry.phone}`}'),
  'the only tel: link is built from the directory entry phone'
);
assert(
  !/navigator\.geolocation|getCurrentPosition\s*\(|navigator\.languages|Intl\.DateTimeFormat|ip-api|ipapi/.test(
    sheetSrc
  ),
  'the sheet never calls GPS, geolocation, browser-language or IP-lookup APIs to pick a country'
);
assert(
  !/fetch\(|api\/emergency-partner|Authorization/.test(sheetSrc),
  'reading the numbers needs no network call, no API key and no partner authentication'
);
assert(
  sheetSrc.includes("country.code === 'GLOBAL'") && sheetSrc.includes('continue'),
  'the Global / Test demo bucket is excluded — it is not a country with a public number'
);
assert(
  sheetSrc.includes('No GPS or location needed to see these') &&
    sheetSrc.includes('No account, no partner authentication'),
  'the sheet states plainly that it needs neither location nor an account'
);

// ---------------------------------------------------------------------------
// 4. Layer behaviour contracts (source-level; exercised in jsdom below).
// ---------------------------------------------------------------------------
section('Emergency numbers sheet — sliding layer behaviour');

assert(
  sheetSrc.includes('translate-y-full') && sheetSrc.includes('translate-y-0'),
  'the sheet slides in from the bottom (translate-y-full → translate-y-0)'
);
assert(
  sheetSrc.includes('transition-transform') && sheetSrc.includes('items-end'),
  'the layer is bottom-anchored and animated'
);
assert(
  sheetSrc.includes('role="dialog"') &&
    sheetSrc.includes('aria-modal="true"') &&
    sheetSrc.includes('aria-labelledby="emergency-numbers-modal-title"'),
  'the layer is a labelled modal dialog for assistive technology'
);
assert(
  sheetSrc.includes("event.key === 'Escape'"),
  'Escape closes the sheet'
);
assert(
  sheetSrc.includes('if (!mounted) return null;'),
  'the sheet leaves the DOM once it is closed and has finished sliding out'
);
assert(
  sheetSrc.includes('event.stopPropagation()'),
  'clicks inside the sheet do not fall through to the backdrop close handler'
);

// ---------------------------------------------------------------------------
// 3 + 5. App wiring: trigger, persistence, banner promotion, nothing hidden.
// ---------------------------------------------------------------------------
section('Emergency numbers sheet — App wiring');

assert(
  appSrc.includes("import { EmergencyNumbersModal } from './components/EmergencyNumbersModal.tsx';"),
  'App imports the sliding numbers layer'
);
assert(
  appSrc.includes('<EmergencyNumbersModal') &&
    appSrc.includes('isOpen={showNumbersSheet}') &&
    appSrc.includes('onClose={() => setShowNumbersSheet(false)}') &&
    appSrc.includes('selectedCountry={bannerCountry}') &&
    appSrc.includes('onSelectCountry={handleBannerCountrySelected}'),
  'App renders the layer with open state, close handler, highlighted country and selection callback'
);
assert(
  appSrc.includes('Select country to view its emergency number'),
  'the banner keeps its country-selection trigger label'
);
assertEqual(
  (appSrc.match(/setShowNumbersSheet\(true\)/g) || []).length,
  2,
  'the banner offers the sheet both before a country is chosen and via "Change" afterwards'
);
assert(
  appSrc.includes('id="open-emergency-numbers-btn"') && appSrc.includes('id="banner-change-country-btn"'),
  'both sheet triggers are addressable (stable ids)'
);

// The PR #16 bug class: a local setter shadowing the imported persistence
// setter, recursing into itself on every click.
assert(
  !/(^|\n)\s*(const|let|var|function)\s+setSelectedCountry\s*[=(]/.test(appSrc),
  'App declares no local setSelectedCountry (the imported setter is not shadowed)'
);
assert(
  appSrc.includes("setSelectedCountry } from './lib/emergencyNumbers.ts'"),
  'App imports the real persistence setter from emergencyNumbers'
);
{
  const declIndex = appSrc.indexOf('const handleBannerCountrySelected');
  assert(declIndex !== -1, 'the country-selection handler exists under a non-conflicting name');
  const handlerEnd = declIndex === -1 ? -1 : appSrc.indexOf('};', declIndex);
  const handlerBody = declIndex === -1 || handlerEnd === -1 ? '' : appSrc.slice(declIndex, handlerEnd);
  assertEqual(
    (handlerBody.match(/setSelectedCountry\(/g) || []).length,
    1,
    'the handler persists the chosen country exactly once'
  );
  assertEqual(
    (handlerBody.match(/setBannerCountry\(/g) || []).length,
    1,
    'the handler promotes the chosen country in the banner exactly once'
  );
  assert(
    !handlerBody.includes('handleBannerCountrySelected('),
    'the handler never calls itself (no recursion)'
  );
}
assert(
  appSrc.includes('const configuredEmergencyNumber = getCountryEmergencyNumber(bannerCountry);'),
  'the banner number is resolved from the selected country through the directory helper'
);
assert(
  appSrc.includes('setBannerCountry(getSelectedCountry());'),
  'closing the partner directory re-reads the persisted country so the banner stays in sync'
);
assert(
  appSrc.includes('<PublicEmergencyNumbers compact highlightCountry={bannerCountry} />'),
  'the always-visible public numbers list is still rendered unconditionally on the main screen'
);

// ---------------------------------------------------------------------------
// Behaviour: the real component in jsdom.
// ---------------------------------------------------------------------------
let jsdomReady = true;
try {
  await import('jsdom');
} catch {
  jsdomReady = false;
}

if (!jsdomReady) {
  section('Emergency numbers sheet UI suite (jsdom missing)');
  assert(true, 'jsdom is not installed — UI rendering suite skipped (npm install)');
} else {
  const env = installDomHarness();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { EmergencyNumbersModal } = await import('../src/components/EmergencyNumbersModal.tsx');
  const { listPublicEmergencyNumbers } = await import('../src/lib/emergencyNumbers.ts');

  const flush = async (ms: number) => {
    await act(async () => {
      await wait(ms);
    });
  };

  const root = createRoot(env.root);
  const text = () => env.document.body.textContent || '';
  const sheet = () => env.document.getElementById('emergency-numbers-modal');
  const openSheet = async (props: Record<string, unknown> = {}) => {
    await act(async () => {
      root.render(React.createElement(EmergencyNumbersModal, { isOpen: true, onClose: () => {}, ...props }));
    });
    await flush(40);
  };

  try {
    // -----------------------------------------------------------------------
    section('Sheet is absent while closed and slides in when opened');
    {
      await act(async () => {
        root.render(
          React.createElement(EmergencyNumbersModal, { isOpen: false, onClose: () => {} })
        );
      });
      await flush(40);
      assertEqual(sheet(), null, 'a closed sheet is not in the DOM at all');

      await openSheet();
      const el = sheet();
      assert(Boolean(el), 'opening the sheet mounts the sliding layer');
      assert(
        Boolean(el) && el.className.includes('translate-y-0'),
        'the mounted layer has slid into place (translate-y-0)'
      );
      assert(
        Boolean(env.document.getElementById('emergency-numbers-modal-title')) &&
          text().includes('Select country to view its emergency number'),
        'the sheet is titled with the banner trigger text'
      );
    }

    // -----------------------------------------------------------------------
    section('Every verified public number is listed — none hidden, none invented');
    {
      const entries = listPublicEmergencyNumbers();
      assert(entries.length > 0, 'fixture: the verified directory exposes public numbers');

      const links = Array.from(env.document.querySelectorAll('#emergency-numbers-modal a[href^="tel:"]')) as any[];
      const rendered = links.map((a) => String(a.getAttribute('href')).replace('tel:', ''));
      for (const entry of entries) {
        assert(
          rendered.includes(entry.phone),
          `the ${entry.countryName} ${entry.serviceType} number ${entry.phone} is a tappable tel: link`
        );
      }
      assertEqual(
        links.length,
        entries.length,
        'the sheet renders exactly the verified directory — no extra (invented) numbers'
      );

      for (const code of ['CA', 'EU', 'GB', 'IN', 'US', 'AU']) {
        assert(
          Boolean(env.document.getElementById(`emergency-number-row-${code}`)),
          `the ${code} country row is present in the list`
        );
      }
      const indiaRow = env.document.getElementById('emergency-number-row-IN');
      const indiaNumbers = indiaRow
        ? Array.from(indiaRow.querySelectorAll('a[href^="tel:"]')).map((a: any) =>
            String(a.getAttribute('href')).replace('tel:', '')
          )
        : [];
      assert(
        indiaNumbers.includes('112') && indiaNumbers.includes('108'),
        'India keeps BOTH verified numbers (112 and 108) — the banner pick never drops the other'
      );

      assertEqual(
        env.document.getElementById('emergency-number-row-GLOBAL'),
        null,
        'the Global / Test demo bucket is not offered as a country'
      );
      assertEqual(
        env.document.getElementById('select-country-btn-GLOBAL'),
        null,
        'the demo bucket cannot be selected as the banner country'
      );
      assert(
        text().includes('No GPS or location needed to see these'),
        'the sheet states that no location is used'
      );
      assert(
        text().includes('No account, no partner authentication'),
        'the sheet states that no sign-in is required'
      );
    }

    // -----------------------------------------------------------------------
    section('Choosing a country promotes it without hiding the others');
    {
      const chosen: string[] = [];
      const onSelectCountry = (code: string) => {
        chosen.push(code);
      };
      await act(async () => {
        root.render(
          React.createElement(EmergencyNumbersModal, { isOpen: true, onClose: () => {}, onSelectCountry })
        );
      });
      await flush(40);

      const btn = env.document.getElementById('select-country-btn-IN');
      assert(Boolean(btn), 'India offers an explicit "Use this country" control');
      await act(async () => {
        btn!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(chosen.length, 1, 'one tap selects exactly one country');
      assertEqual(chosen[0], 'IN', 'the selected country code is passed to the call-site');

      // Re-render with the selection applied, as App does after persisting it.
      await act(async () => {
        root.render(
          React.createElement(EmergencyNumbersModal, {
            isOpen: true,
            onClose: () => {},
            selectedCountry: 'IN',
            onSelectCountry
          })
        );
      });
      await flush(40);

      const india = env.document.getElementById('emergency-number-row-IN');
      assert(
        Boolean(india) && india!.textContent!.includes('selected'),
        'the chosen country is visibly marked as selected'
      );
      assertEqual(
        (env.document.getElementById('select-country-btn-IN') as any)?.getAttribute('aria-pressed'),
        'true',
        'the selected country control reports its pressed state'
      );
      for (const code of ['CA', 'EU', 'GB', 'US', 'AU']) {
        assert(
          Boolean(env.document.getElementById(`emergency-number-row-${code}`)),
          `the ${code} row stays visible after another country is selected`
        );
      }
      assert(
        text().includes('every other verified number above stays visible'),
        'the sheet states that the country pick only promotes one number'
      );
    }

    // -----------------------------------------------------------------------
    section('Escape, backdrop and Done close the layer; inner clicks do not');
    {
      let closes = 0;
      const onClose = () => {
        closes += 1;
      };
      await openSheet({ onClose });

      const overlay = env.document.getElementById('emergency-numbers-modal-overlay');
      const inner = env.document.getElementById('emergency-numbers-country-list');
      assert(Boolean(overlay) && Boolean(inner), 'fixture: overlay and list are mounted');

      await act(async () => {
        inner!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(closes, 0, 'clicking inside the sheet does not close it');

      await act(async () => {
        overlay!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(closes, 1, 'clicking the backdrop closes the sheet');

      await act(async () => {
        env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      assertEqual(closes, 2, 'pressing Escape closes the sheet');

      const done = env.document.getElementById('emergency-numbers-done-btn');
      assert(Boolean(done), 'the sheet offers an explicit Done control');
      await act(async () => {
        done!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(closes, 3, 'Done closes the sheet (back to Tap to Speak)');

      const closeBtn = env.document.getElementById('close-emergency-numbers-btn');
      assert(Boolean(closeBtn), 'the sheet offers a close button in its header');
      await act(async () => {
        closeBtn!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
      });
      assertEqual(closes, 4, 'the header close button closes the sheet');
    }

    // -----------------------------------------------------------------------
    section('Closing slides the layer out and then removes it from the DOM');
    {
      // While open, focus lives inside the layer (keyboard/screen-reader users
      // land on it instead of the app behind the backdrop).
      assertEqual(
        env.document.activeElement,
        env.document.getElementById('close-emergency-numbers-btn'),
        'opening the sheet moves focus into the layer'
      );

      await act(async () => {
        root.render(React.createElement(EmergencyNumbersModal, { isOpen: false, onClose: () => {} }));
      });
      await flush(20);
      const el = sheet();
      assert(Boolean(el), 'the layer stays mounted while it slides out');
      assert(
        Boolean(el) && el.className.includes('translate-y-full'),
        'the sliding-out layer is translated back below the viewport'
      );
      assert(
        Boolean(el) && !el.contains(env.document.activeElement),
        'focus leaves the aria-hidden layer as it slides out (next Tab stays in the app)'
      );
      await flush(400);
      assertEqual(sheet(), null, 'after the transition the closed layer is removed from the DOM');
    }
  } finally {
    await act(async () => {
      root.unmount();
    });
    env.cleanup();
  }
}
