import { section, assert, assertEqual } from './helpers.ts';
import { SHOW_TECH_DETAILS, friendlyTranslationText } from '../src/lib/uiVisibility.ts';

section('public UI hides technical lines');
assertEqual(SHOW_TECH_DETAILS, false, 'technical details hidden by default');
assertEqual(
  friendlyTranslationText('[TA faithful translation not available offline for English free text — original message preserved] No'),
  'Translation not available offline. Please show the original message: "No"',
  'offline translation marker shown in plain language'
);
assertEqual(friendlyTranslationText('உதவி தேவை'), 'உதவி தேவை', 'real translations untouched');
assert(true, 'ok');
