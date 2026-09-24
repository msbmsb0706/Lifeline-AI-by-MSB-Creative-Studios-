/**
 * BUG 1 regression tests — multilingual browser voice locale mapping.
 *
 * Verifies that application language codes map to the correct BCP-47 browser
 * SpeechRecognition locales (requirements A, B, C).
 */
import { getSpeechRecognitionLocale } from '../src/lib/languages.ts';
import { section, assertEqual } from './helpers.ts';

section('Multilingual browser SpeechRecognition locale mapping');

// A. selectedLanguage='ta' produces browser locale 'ta-IN'.
assertEqual(getSpeechRecognitionLocale('ta'), 'ta-IN', "selectedLanguage 'ta' → 'ta-IN'");

// B. selectedLanguage='hi' produces 'hi-IN'.
assertEqual(getSpeechRecognitionLocale('hi'), 'hi-IN', "selectedLanguage 'hi' → 'hi-IN'");

// C. selectedLanguage='en' produces 'en-US'.
assertEqual(getSpeechRecognitionLocale('en'), 'en-US', "selectedLanguage 'en' → 'en-US'");

// Full documented mapping table.
section('Complete application language → BCP-47 locale table');
assertEqual(getSpeechRecognitionLocale('te'), 'te-IN', "'te' → 'te-IN'");
assertEqual(getSpeechRecognitionLocale('kn'), 'kn-IN', "'kn' → 'kn-IN'");
assertEqual(getSpeechRecognitionLocale('ml'), 'ml-IN', "'ml' → 'ml-IN'");
assertEqual(getSpeechRecognitionLocale('bn'), 'bn-IN', "'bn' → 'bn-IN'");
assertEqual(getSpeechRecognitionLocale('mr'), 'mr-IN', "'mr' → 'mr-IN'");
assertEqual(getSpeechRecognitionLocale('es'), 'es-ES', "'es' → 'es-ES'");
assertEqual(getSpeechRecognitionLocale('fr'), 'fr-FR', "'fr' → 'fr-FR'");

section('Fallback behavior');
assertEqual(getSpeechRecognitionLocale(), 'en-US', 'no code → en-US');
assertEqual(getSpeechRecognitionLocale('xx'), 'en-US', "unknown code 'xx' → en-US");
assertEqual(getSpeechRecognitionLocale('TA'), 'ta-IN', 'case-insensitive matching');
assertEqual(getSpeechRecognitionLocale('ta-IN'), 'ta-IN', "BCP-47 tag 'ta-IN' stays 'ta-IN'");
assertEqual(getSpeechRecognitionLocale('hi_IN'), 'hi-IN', "underscore locale 'hi_IN' → 'hi-IN'");
