import React from 'react';

interface PwaHeaderProps {
  title: string;
  onBackClick?: () => void;
  showBack?: boolean;
}

export const PwaHeader: React.FC<PwaHeaderProps> = ({ 
  title, 
  onBackClick, 
  showBack = true 
}) => {
  const handleBack = () => {
    if (onBackClick) {
      onBackClick();
    } else {
      // Direct window fallback history pop for pure web apps
      window.history.back();
    }
  };

  return (
    <div className="pwa-mobile-nav flex justify-between items-center bg-white shadow-sm">
      {showBack ? (
        <button 
          onClick={handleBack}
          className="flex items-center text-blue-600 font-medium text-sm focus:outline-none cursor-pointer"
          aria-label="Go Back"
        >
          {/* Native Unicode chevron arrow anchor */}
          <span className="text-lg mr-1">←</span> Back
        </button>
      ) : (
        <div className="w-12"></div>
      )}
      
      <h1 className="text-base font-bold text-gray-900 mx-auto">{title}</h1>
      
      {/* Visual balance placeholder spacer */}
      <div className="w-12"></div>
    </div>
  );
};
