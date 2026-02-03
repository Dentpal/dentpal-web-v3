/**
 * Export Menu Component
 * Dropdown menu for CSV and PDF export options
 */

import { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown } from 'lucide-react';

interface ExportMenuProps {
  onExportCSV: () => void;
  onExportPDF?: () => void;
  disabled?: boolean;
  label?: string;
  showPDF?: boolean;
}

export const ExportMenu = ({
  onExportCSV,
  onExportPDF,
  disabled = false,
  label = 'Export',
  showPDF = true,
}: ExportMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleCSVClick = () => {
    onExportCSV();
    setIsOpen(false);
  };

  const handlePDFClick = () => {
    if (onExportPDF) {
      onExportPDF();
    }
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="w-3.5 h-3.5" />
        {label}
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 z-50 w-48 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <button
            onClick={handleCSVClick}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-600" />
            <div className="text-left">
              <div className="font-medium">Export as CSV</div>
              <div className="text-xs text-gray-500">Spreadsheet format</div>
            </div>
          </button>

          {showPDF && onExportPDF && (
            <button
              onClick={handlePDFClick}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition border-t border-gray-100"
            >
              <FileText className="w-4 h-4 text-red-600" />
              <div className="text-left">
                <div className="font-medium">Export as PDF</div>
                <div className="text-xs text-gray-500">Document format</div>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
