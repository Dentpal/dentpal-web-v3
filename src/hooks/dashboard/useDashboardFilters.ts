/**
 * Dashboard Filters Hook
 * Manages filter state and date range for seller dashboard
 */

import { useState, useRef, useEffect } from 'react';
import { DashboardFilters, DateRange } from '@/types/dashboard';
import { toISO, getPresetDateRange } from '@/utils/dashboard/dateHelpers';

export const useDashboardFilters = () => {
  // Filter state
  const [filters, setFilters] = useState<DashboardFilters>({
    dateRange: 'last-30',
    brand: 'all',
    subcategory: 'all',
    location: 'all',
    paymentType: 'all',
    viewType: 'summary',
    viewExpanded: false,
  });

  // Date range picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null });
  const dateDropdownRef = useRef<HTMLDivElement | null>(null);

  // Handle day click in calendar
  const handleDayClick = (day: Date) => {
    setDateRange(prev => {
      if (!prev.start || (prev.start && prev.end)) {
        return { start: day, end: null };
      }
      if (day < prev.start) {
        return { start: day, end: prev.start };
      }
      return { start: prev.start, end: day };
    });
  };

  // Apply custom date range
  const applyDateRange = () => {
    const start = dateRange.start;
    const end = dateRange.end || dateRange.start;
    if (!start || !end) return;
    
    setFilters(f => ({ 
      ...f, 
      dateRange: `custom:${toISO(start)}:${toISO(end)}` 
    }));
    setShowDatePicker(false);
  };

  // Apply preset date range
  const applyPreset = (preset: 'today' | '7' | '30') => {
    const range = getPresetDateRange(preset);
    setDateRange(range);
    setCalendarMonth(new Date((range.end || range.start)!.getFullYear(), (range.end || range.start)!.getMonth(), 1));
    
    if (preset === 'today') {
      setFilters(f => ({ 
        ...f, 
        dateRange: `custom:${toISO(range.start!)}:${toISO(range.end!)}` 
      }));
    } else {
      setFilters(f => ({ ...f, dateRange: `last-${preset}` }));
    }
  };

  // Clear date range
  const clearDateRange = () => {
    setDateRange({ start: null, end: null });
    setFilters(f => ({ ...f, dateRange: 'last-30' }));
  };

  // Reset all filters
  const resetFilters = () => {
    setFilters({
      dateRange: 'last-30',
      brand: 'all',
      subcategory: 'all',
      location: 'all',
      paymentType: 'all',
      viewType: 'summary',
      viewExpanded: false,
    });
    setDateRange({ start: null, end: null });
  };

  // Close date picker on outside click
  useEffect(() => {
    if (!showDatePicker) return;
    
    const handler = (e: MouseEvent) => {
      if (!dateDropdownRef.current) return;
      if (!dateDropdownRef.current.contains(e.target as Node)) {
        setShowDatePicker(false);
      }
    };
    
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDatePicker]);

  return {
    filters,
    setFilters,
    dateRange,
    setDateRange,
    showDatePicker,
    setShowDatePicker,
    calendarMonth,
    setCalendarMonth,
    dateDropdownRef,
    handleDayClick,
    applyDateRange,
    applyPreset,
    clearDateRange,
    resetFilters,
  };
};
