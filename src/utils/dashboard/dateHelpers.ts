/**
 * Dashboard Date Utilities
 * Pure functions for date manipulation and validation
 */

import { DateRange } from '@/types/dashboard';

/**
 * Convert Date to ISO string format (YYYY-MM-DD)
 */
export const toISO = (d: Date | null): string => {
  if (!d) return '';
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    .toISOString()
    .slice(0, 10);
};

/**
 * Get number of days in a month
 */
export const daysInMonth = (month: Date): number => {
  return new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
};

/**
 * Get first weekday of month (0 = Sunday, 6 = Saturday)
 */
export const firstWeekday = (month: Date): number => {
  return new Date(month.getFullYear(), month.getMonth(), 1).getDay();
};

/**
 * Check if a date is within a range
 */
export const isInRange = (day: Date, range: DateRange): boolean => {
  const { start, end } = range;
  if (!start) return false;
  if (start && !end) return day.getTime() === start.getTime();
  if (start && end) return day >= start && day <= end;
  return false;
};

/**
 * Parse date string to Date object
 */
export const parseDate = (s?: string): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Check if date string is within last N days
 */
export const withinLastDays = (dateStr?: string, rangeKey?: string): boolean => {
  if (!dateStr) return false;
  const d = parseDate(dateStr);
  if (!d) return false;
  
  // Handle custom date range
  if (rangeKey && rangeKey.startsWith('custom:')) {
    const parts = rangeKey.split(':');
    if (parts.length === 3) {
      const startDate = parseDate(parts[1]);
      const endDate = parseDate(parts[2]);
      if (startDate && endDate) {
        const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);
        return d >= start && d <= end;
      }
    }
  }
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Handle 'today' case
  if (rangeKey === 'today') {
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    return d >= todayStart && d <= todayEnd;
  }
  
  // Handle last N days
  let days = 30;
  switch (rangeKey) {
    case 'last-7': days = 7; break;
    case 'last-30': days = 30; break;
    case 'last-90': days = 90; break;
    case 'last-365': days = 365; break;
    default: days = 30;
  }
  
  const from = new Date(today.getTime() - (days - 1) * 86400000);
  return d >= from && d <= new Date(today.getTime() + 86399999);
};

/**
 * Get date range preset
 */
export const getPresetDateRange = (preset: 'today' | '7' | '30'): DateRange => {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start = new Date(end);
  
  if (preset === '7') start = new Date(end.getTime() - 6 * 86400000);
  if (preset === '30') start = new Date(end.getTime() - 29 * 86400000);
  if (preset === 'today') start = end;
  
  return { start, end };
};

/**
 * Convert timestamp to milliseconds
 */
export const toMs = (s?: string): number | undefined => {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};

/**
 * Calculate average from array of numbers
 */
export const avg = (arr: number[]): number | undefined => {
  if (arr.length === 0) return undefined;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};
