/**
 * Date Range Picker Component
 * Full calendar implementation with preset options
 */

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { toISO, daysInMonth, firstWeekday, isInRange } from '@/utils/dashboard/dateHelpers';

interface DateRangePickerProps {
  dateRange: { start: Date | null; end: Date | null };
  onApply: (start: Date, end: Date) => void;
  onClear: () => void;
  presets?: Array<{ label: string; value: string }>;
  show: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

export const DateRangePicker = ({
  dateRange,
  onApply,
  onClear,
  presets = [
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: '7' },
    { label: 'Last 30 days', value: '30' },
    { label: 'Last 90 days', value: '90' },
  ],
  show,
  onClose,
  anchorRef,
}: DateRangePickerProps) => {
  const [localStart, setLocalStart] = useState<Date | null>(dateRange.start);
  const [localEnd, setLocalEnd] = useState<Date | null>(dateRange.end);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update local state when props change
  useEffect(() => {
    setLocalStart(dateRange.start);
    setLocalEnd(dateRange.end);
  }, [dateRange.start, dateRange.end]);

  // Close on outside click
  useEffect(() => {
    if (!show) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [show, onClose, anchorRef]);

  if (!show) return null;

  const handleDayClick = (day: number) => {
    const selectedDate = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth(),
      day
    );

    if (!localStart || (localStart && localEnd)) {
      // Start new selection
      setLocalStart(selectedDate);
      setLocalEnd(null);
    } else {
      // Complete selection
      if (selectedDate < localStart) {
        setLocalEnd(localStart);
        setLocalStart(selectedDate);
      } else {
        setLocalEnd(selectedDate);
      }
    }
  };

  const handlePresetClick = (value: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let start: Date;
    let end: Date = today;

    switch (value) {
      case 'today':
        start = today;
        break;
      case '7':
        start = new Date(today);
        start.setDate(start.getDate() - 6);
        break;
      case '30':
        start = new Date(today);
        start.setDate(start.getDate() - 29);
        break;
      case '90':
        start = new Date(today);
        start.setDate(start.getDate() - 89);
        break;
      default:
        return;
    }

    setLocalStart(start);
    setLocalEnd(end);
  };

  const handleApply = () => {
    if (localStart && localEnd) {
      onApply(localStart, localEnd);
      onClose();
    }
  };

  const handleClear = () => {
    setLocalStart(null);
    setLocalEnd(null);
    onClear();
  };

  const prevMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
  };

  // Calendar rendering
  const totalDays = daysInMonth(calendarMonth);
  const firstDay = firstWeekday(calendarMonth);
  const monthName = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div
      ref={dropdownRef}
      className="absolute left-0 mt-2 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl"
      style={{ minWidth: '360px' }}
    >
      <div className="p-4 space-y-4">
        {/* Presets */}
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2">Quick Select</div>
          <div className="flex flex-wrap gap-2">
            {presets.map(preset => (
              <button
                key={preset.value}
                onClick={() => handlePresetClick(preset.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white hover:bg-teal-50 hover:border-teal-300 transition"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Calendar */}
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2">Select Date Range</div>
          <div className="bg-gray-50 rounded-lg p-3">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={prevMonth}
                className="p-1 hover:bg-gray-200 rounded transition"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
              <div className="text-sm font-semibold text-gray-900">{monthName}</div>
              <button
                onClick={nextMonth}
                className="p-1 hover:bg-gray-200 rounded transition"
              >
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            {/* Weekday Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells for days before month start */}
              {Array.from({ length: firstDay }).map((_, idx) => (
                <div key={`empty-${idx}`} className="h-8" />
              ))}

              {/* Days of month */}
              {Array.from({ length: totalDays }).map((_, idx) => {
                const day = idx + 1;
                const date = new Date(
                  calendarMonth.getFullYear(),
                  calendarMonth.getMonth(),
                  day
                );
                const dateStr = toISO(date);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const isToday = date.getTime() === today.getTime();
                const isStart = localStart && toISO(localStart) === dateStr;
                const isEnd = localEnd && toISO(localEnd) === dateStr;
                const inRange = localStart && localEnd && isInRange(date, {
                  start: localStart,
                  end: localEnd,
                });

                let className = 'h-8 flex items-center justify-center text-xs rounded cursor-pointer transition ';
                
                if (isStart || isEnd) {
                  className += 'bg-teal-600 text-white font-bold ';
                } else if (inRange) {
                  className += 'bg-teal-100 text-teal-900 ';
                } else if (isToday) {
                  className += 'bg-blue-100 text-blue-900 font-medium ';
                } else {
                  className += 'text-gray-700 hover:bg-gray-200 ';
                }

                return (
                  <button
                    key={day}
                    onClick={() => handleDayClick(day)}
                    className={className}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Range Display */}
        {localStart && (
          <div className="text-xs text-gray-600 bg-blue-50 rounded-lg p-2 border border-blue-200">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-medium text-blue-900">
                {localStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {localEnd && (
                  <> → {localEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
          <button
            onClick={handleClear}
            className="text-xs px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
          >
            Clear
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!localStart || !localEnd}
              className="text-xs px-4 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
