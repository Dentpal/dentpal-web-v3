/**
 * Empty State Component
 * Reusable empty state display for dashboard views
 */

import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  size?: 'sm' | 'md' | 'lg';
}

export const EmptyState = ({
  icon,
  title,
  description,
  action,
  size = 'md',
}: EmptyStateProps) => {
  const containerClasses = {
    sm: 'py-8',
    md: 'py-12',
    lg: 'py-16',
  };

  const iconSizes = {
    sm: 'w-12 h-12',
    md: 'w-16 h-16',
    lg: 'w-20 h-20',
  };

  const titleSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  return (
    <div className={`flex flex-col items-center justify-center text-center ${containerClasses[size]}`}>
      {icon && (
        <div className={`${iconSizes[size]} rounded-full bg-gray-100 flex items-center justify-center mb-4`}>
          {icon}
        </div>
      )}
      
      <div className={`${titleSizes[size]} font-semibold text-gray-900 mb-2`}>
        {title}
      </div>
      
      {description && (
        <div className="text-sm text-gray-500 max-w-md">
          {description}
        </div>
      )}
      
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
