/**
 * Metric Card Component
 * Reusable card for displaying KPI metrics
 */

import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
    label: string;
  };
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'teal';
  onClick?: () => void;
}

export const MetricCard = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  color = 'blue',
  onClick,
}: MetricCardProps) => {
  const colorClasses = {
    blue: 'from-blue-50 to-blue-100 border-blue-200',
    green: 'from-green-50 to-green-100 border-green-200',
    purple: 'from-purple-50 to-purple-100 border-purple-200',
    orange: 'from-orange-50 to-orange-100 border-orange-200',
    red: 'from-red-50 to-red-100 border-red-200',
    teal: 'from-teal-50 to-teal-100 border-teal-200',
  };

  const iconColorClasses = {
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    purple: 'bg-purple-600',
    orange: 'bg-orange-600',
    red: 'bg-red-600',
    teal: 'bg-teal-600',
  };

  const textColorClasses = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    purple: 'text-purple-700',
    orange: 'text-orange-700',
    red: 'text-red-700',
    teal: 'text-teal-700',
  };

  const valueColorClasses = {
    blue: 'text-blue-900',
    green: 'text-green-900',
    purple: 'text-purple-900',
    orange: 'text-orange-900',
    red: 'text-red-900',
    teal: 'text-teal-900',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-gradient-to-br ${colorClasses[color as keyof typeof colorClasses]} rounded-2xl p-6 shadow-sm border ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        {icon && (
          <div className={`w-12 h-12 ${iconColorClasses[color as keyof typeof iconColorClasses]} rounded-xl flex items-center justify-center shadow-lg`}>
            {icon}
          </div>
        )}
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-semibold ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(trend.value)}%
          </div>
        )}
      </div>
      
      <div className="space-y-1">
        <p className={`text-xs font-medium ${textColorClasses[color as keyof typeof textColorClasses]} uppercase tracking-wide`}>
          {title}
        </p>
        <p className={`text-3xl font-bold ${valueColorClasses[color as keyof typeof valueColorClasses]}`}>
          {value}
        </p>
        {subtitle && (
          <p className={`text-xs ${textColorClasses[color as keyof typeof textColorClasses]}`}>
            {subtitle}
          </p>
        )}
        {trend && (
          <p className="text-xs text-gray-600 mt-1">
            {trend.label}
          </p>
        )}
      </div>
    </div>
  );
};
