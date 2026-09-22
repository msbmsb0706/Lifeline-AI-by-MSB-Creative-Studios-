import React, { useEffect, useState } from 'react';
import { OfficialLogo } from './OfficialLogo.tsx';
import { ShieldAlert, Sparkles, ArrowRight, Radio } from 'lucide-react';

interface SplashScreenProps {
  onDismiss: () => void;
  nebiusConfigured?: boolean;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onDismiss, nebiusConfigured = true }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const duration = 2200; // 2.2 seconds smooth intro

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const nextProgress = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(nextProgress);

      if (elapsed >= duration) {
        clearInterval(timer);
        setTimeout(onDismiss, 200);
      }
    }, 40);

    return () => clearInterval(timer);
  }, [onDismiss]);

  return (
    <div
      id="lifeline-splash-screen"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between p-6 sm:p-10 bg-neutral-950 text-white overflow-hidden"
    >
      {/* Background ambient lighting */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-red-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-80 h-80 bg-blue-900/10 rounded-full blur-3xl" />
      </div>

      {/* Top Security & System Status Tag */}
      <div className="relative z-10 w-full flex items-center justify-between text-xs text-neutral-400 font-mono max-w-md">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          <span className="text-neutral-300 font-semibold">STANDBY ACTIVE</span>
        </div>
        <div className="text-neutral-400">BUILD v2.4.0</div>
      </div>

      {/* Center Branding Block */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-md my-auto">
        {/* Official LifeLine AI Brand Artwork (supplied by MSB Creative Studios) */}
        <div className="relative mb-6">
          <div className="absolute -inset-2 rounded-3xl bg-gradient-to-tr from-red-600/30 to-red-500/10 blur-md" />
          <div className="relative w-40 h-40 sm:w-56 sm:h-56 rounded-3xl overflow-hidden border-2 border-red-500/30 shadow-2xl bg-neutral-950 flex items-center justify-center">
            <img
              src="/assets/branding/lifeline-ai-brand-1200.png"
              srcSet="/assets/branding/lifeline-ai-brand-1200.png 1200w, /assets/branding/lifeline-ai-brand.png 1536w"
              sizes="(min-width: 640px) 224px, 160px"
              alt="LifeLine AI by MSB Creative Studios — Voice to Help, Signal to Rescue"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              onError={(e) => {
                // Fallback to local asset path if needed
                const target = e.currentTarget;
                if (!target.src.includes('logo.png')) {
                  target.src = '/logo.png';
                }
              }}
            />
          </div>
        </div>

        {/* Official Typography */}
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white mb-1.5 flex items-center justify-center gap-2">
          <span>LifeLine</span>
          <span className="text-red-500">AI</span>
        </h1>
        
        <p className="text-xs sm:text-sm font-extrabold tracking-[0.25em] text-neutral-400 uppercase mb-5">
          BY MSB CREATIVE STUDIOS
        </p>

        <p className="text-sm text-neutral-300 font-normal leading-relaxed max-w-sm mb-6">
          Mission-critical emergency communication assistant with speech-to-text triage and deterministic visual SOS dispatch.
        </p>

        {/* Engine Capability Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 border border-neutral-800 text-neutral-200">
            <Sparkles className="w-3.5 h-3.5 text-red-400" />
            <span>Nebius Token Factory (Nemotron)</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 border border-neutral-800 text-neutral-200">
            <Radio className="w-3.5 h-3.5 text-blue-400" />
            <span>Deterministic Offline Engine</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-xs bg-neutral-900 rounded-full h-1.5 overflow-hidden mb-3 border border-neutral-800">
          <div
            className="bg-gradient-to-r from-red-600 to-red-400 h-full transition-all duration-75 ease-out rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="text-[11px] font-mono text-neutral-400">
          Initializing Audio &amp; Triage Services... {progress}%
        </p>
      </div>

      {/* Bottom Dismiss / Direct Skip */}
      <div className="relative z-10 w-full max-w-md flex flex-col items-center">
        <button
          id="skip-splash-btn"
          onClick={onDismiss}
          className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold text-sm tracking-wide transition-all shadow-lg flex items-center justify-center gap-2"
        >
          <span>ENTER EMERGENCY CONSOLE</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
