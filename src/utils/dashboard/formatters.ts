/**
 * Dashboard Formatting Utilities
 * Pure functions for consistent data formatting
 */

/**
 * Format number as Philippine Peso currency
 * Truncates to 2 decimal places without rounding
 */
export const formatCurrency = (num: number): string => {
  const currency = new Intl.NumberFormat("en-PH", { 
    style: "currency", 
    currency: "PHP", 
    maximumFractionDigits: 2 
  });
  const truncated = Math.floor(num * 100) / 100;
  return currency.format(truncated);
};

/**
 * Truncate number to 2 decimal places without rounding
 */
export const truncate = (num: number): number => {
  return Math.floor(num * 100) / 100;
};

/**
 * Format minutes into hours and minutes display
 * @example formatDuration(125) => "2h 5m"
 */
export const formatDuration = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${h}h ${m}m`;
};

/**
 * Format date to ISO string (YYYY-MM-DD)
 */
export const toISO = (d: Date | null): string => {
  if (!d) return '';
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    .toISOString()
    .slice(0, 10);
};

/**
 * Format date for display
 */
export const formatDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
};

/**
 * Format date with time for display
 */
export const formatDateTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Format date key for grouping (e.g., "Jan 15, 2026")
 */
export const formatDateKey = (date: Date): string => {
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
};

/**
 * Format number with locale-specific thousands separator
 */
export const formatNumber = (num: number): string => {
  return num.toLocaleString('en-PH');
};

/**
 * Format percentage
 */
export const formatPercentage = (num: number): string => {
  return `${num.toFixed(1)}%`;
};
