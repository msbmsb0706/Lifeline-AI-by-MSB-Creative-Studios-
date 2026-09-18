import React, { useState } from 'react';

interface OfficialLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  imageClassName?: string;
}

export const OfficialLogo: React.FC<OfficialLogoProps> = ({
  size = 'md',
  showText = false,
  className = '',
  imageClassName = ''
}) => {
  const [imgError, setImgError] = useState(false);

  // Dimension presets
  const sizeConfig = {
    xs: { iconPx: 'w-7 h-7', titleText: 'text-sm', subText: 'text-[9px]' },
    sm: { iconPx: 'w-9 h-9 sm:w-10 sm:h-10', titleText: 'text-base sm:text-lg', subText: 'text-[10px] sm:text-[11px]' },
    md: { iconPx: 'w-16 h-16', titleText: 'text-xl', subText: 'text-xs' },
    lg: { iconPx: 'w-24 h-24 sm:w-28 sm:h-28', titleText: 'text-2xl sm:text-3xl', subText: 'text-xs sm:text-sm' },
    xl: { iconPx: 'w-32 h-32 sm:w-36 sm:h-36', titleText: 'text-3xl sm:text-4xl', subText: 'text-sm sm:text-base' }
  };

  const currentSize = sizeConfig[size] || sizeConfig.md;

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Logo Graphic Container */}
      <div
        className={`${currentSize.iconPx} relative flex-shrink-0 rounded-2xl overflow-hidden shadow-lg border border-neutral-700/60 bg-neutral-950 flex items-center justify-center`}
      >
        {!imgError ? (
          <img
            src="/file_00000000f3ec8211ba741b84f232a029.png"
            alt="LifeLine AI by MSB Creative Studios"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className={`w-full h-full object-cover select-none ${imageClassName}`}
          />
        ) : (
          /* High-fidelity Vector Fallback preserving exact design */
          <svg viewBox="0 0 512 512" className="w-full h-full select-none" xmlns="http://www.w3.org/2000/svg">
            <rect width="512" height="512" rx="100" fill="#0b101a" />
            <path d="M 256 100 L 320 135 C 320 220 290 275 256 300 C 222 275 192 220 192 135 Z" fill="#dc2626" />
            <path
              d="M 160 215 L 215 215 L 235 170 L 250 260 L 265 160 L 280 240 L 295 205 L 310 215 L 352 215"
              fill="none"
              stroke="#ffffff"
              strokeWidth="12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Brand Text */}
      {showText && (
        <div className="flex flex-col justify-center select-none">
          <div className="flex items-center gap-1.5 leading-tight">
            <span className={`font-black tracking-tight text-white ${currentSize.titleText}`}>
              LifeLine <span className="text-red-500">AI</span>
            </span>
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-red-950/90 text-red-400 border border-red-800 tracking-wider">
              EMERGENCY
            </span>
          </div>
          <div className={`text-neutral-400 font-semibold tracking-widest uppercase ${currentSize.subText}`}>
            BY MSB CREATIVE STUDIOS
          </div>
        </div>
      )}
    </div>
  );
};
