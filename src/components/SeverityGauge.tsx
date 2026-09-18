import React from 'react';
import { SeverityLevel } from '../types.ts';
import { ShieldAlert, AlertTriangle, Activity, AlertOctagon, HeartCrack } from 'lucide-react';

interface SeverityGaugeProps {
  severity: SeverityLevel;
}

const SEVERITY_CONFIG: Record<
  SeverityLevel,
  {
    label: string;
    sublabel: string;
    bgColor: string;
    textColor: string;
    borderColor: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  1: {
    label: 'LEVEL 1 — MINOR',
    sublabel: 'Non-life threatening • Basic first aid',
    bgColor: 'bg-emerald-950/80',
    textColor: 'text-emerald-400',
    borderColor: 'border-emerald-700',
    icon: Activity
  },
  2: {
    label: 'LEVEL 2 — MODERATE',
    sublabel: 'Requires medical evaluation • Delayed risk',
    bgColor: 'bg-sky-950/80',
    textColor: 'text-sky-400',
    borderColor: 'border-sky-700',
    icon: Activity
  },
  3: {
    label: 'LEVEL 3 — URGENT',
    sublabel: 'Potentially serious • Urgent dispatch recommended',
    bgColor: 'bg-amber-950/80',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-700',
    icon: AlertTriangle
  },
  4: {
    label: 'LEVEL 4 — SEVERE',
    sublabel: 'High life-threat risk • Rapid response needed',
    bgColor: 'bg-orange-950/80',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-600',
    icon: ShieldAlert
  },
  5: {
    label: 'LEVEL 5 — CRITICAL',
    sublabel: 'Imminent life danger / Resuscitation • Immediate ALS',
    bgColor: 'bg-red-950/90',
    textColor: 'text-red-400',
    borderColor: 'border-red-600',
    icon: HeartCrack
  }
};

export const SeverityGauge: React.FC<SeverityGaugeProps> = ({ severity }) => {
  const current = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG[3];
  const IconComponent = current.icon;

  return (
    <div
      id={`severity-gauge-${severity}`}
      className={`rounded-xl border p-3 sm:p-4 ${current.bgColor} ${current.borderColor} transition-all`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg bg-black/40 ${current.textColor}`}>
            <IconComponent className="w-5 h-5" />
          </div>
          <div>
            <div className={`text-xs font-black tracking-wider ${current.textColor}`}>
              {current.label}
            </div>
            <div className="text-[11px] text-neutral-300">
              {current.sublabel}
            </div>
          </div>
        </div>
        <div className={`text-2xl font-black ${current.textColor} tracking-tight font-mono`}>
          {severity}<span className="text-sm font-normal text-neutral-400">/5</span>
        </div>
      </div>

      {/* 5-segment triage bar */}
      <div className="grid grid-cols-5 gap-1.5 mt-2">
        {([1, 2, 3, 4, 5] as SeverityLevel[]).map((level) => {
          const isActive = level <= severity;
          const isCurrent = level === severity;
          let segmentColor = 'bg-neutral-800';

          if (isActive) {
            if (level === 1) segmentColor = 'bg-emerald-500';
            else if (level === 2) segmentColor = 'bg-sky-500';
            else if (level === 3) segmentColor = 'bg-amber-500';
            else if (level === 4) segmentColor = 'bg-orange-500';
            else if (level === 5) segmentColor = 'bg-red-500';
          }

          return (
            <div
              key={level}
              className={`h-2 rounded-sm transition-all ${segmentColor} ${
                isCurrent ? 'ring-2 ring-white ring-offset-1 ring-offset-black scale-y-125' : 'opacity-80'
              }`}
              title={`Severity Level ${level}`}
            />
          );
        })}
      </div>
    </div>
  );
};
