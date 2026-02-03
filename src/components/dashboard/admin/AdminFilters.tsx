/**
 * Admin Filters Component
 * Province/city multi-select filters with search
 */

import { useState, useRef, useEffect } from 'react';
import { AdminFilters as AdminFiltersType } from '@/types/dashboard';
import { Order } from '@/types/order';
import { Search, MapPin, X } from 'lucide-react';

interface AdminFiltersProps {
  filters: AdminFiltersType;
  setFilters: (filters: AdminFiltersType | ((prev: AdminFiltersType) => AdminFiltersType)) => void;
  sellers: Array<{ uid: string; name: string; email: string; province?: string; city?: string }>;
  orders: Order[];
}

export const AdminFilters = ({ filters, setFilters, sellers, orders }: AdminFiltersProps) => {
  const [showProvinceDropdown, setShowProvinceDropdown] = useState(false);
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const provinceDropdownRef = useRef<HTMLDivElement>(null);
  const cityDropdownRef = useRef<HTMLDivElement>(null);

  // Get unique provinces and cities from sellers
  const provinces = Array.from(new Set(sellers.map(s => s.province).filter(Boolean))).sort();
  const cities = Array.from(new Set(sellers.map(s => s.city).filter(Boolean))).sort();

  // Get cities for selected provinces
  const availableCities = filters.provinces.length > 0
    ? Array.from(new Set(
        sellers
          .filter(s => s.province && filters.provinces.includes(s.province))
          .map(s => s.city)
          .filter(Boolean)
      )).sort()
    : cities;

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (provinceDropdownRef.current && !provinceDropdownRef.current.contains(event.target as Node)) {
        setShowProvinceDropdown(false);
      }
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(event.target as Node)) {
        setShowCityDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleProvinceToggle = (province: string) => {
    setFilters(prev => {
      const newProvinces = prev.provinces.includes(province)
        ? prev.provinces.filter(p => p !== province)
        : [...prev.provinces, province];
      
      // Clear cities if no provinces selected
      return {
        ...prev,
        provinces: newProvinces,
        cities: newProvinces.length === 0 ? [] : prev.cities,
      };
    });
  };

  const handleCityToggle = (city: string) => {
    setFilters(prev => ({
      ...prev,
      cities: prev.cities.includes(city)
        ? prev.cities.filter(c => c !== city)
        : [...prev.cities, city],
    }));
  };

  const clearProvinces = () => {
    setFilters(prev => ({ ...prev, provinces: [], cities: [] }));
  };

  const clearCities = () => {
    setFilters(prev => ({ ...prev, cities: [] }));
  };

  const resetAllFilters = () => {
    setFilters({
      dateRange: 'last-30',
      provinces: [],
      cities: [],
      searchQuery: '',
    });
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="text-sm font-semibold text-gray-900 mb-3">Filters</div>
      <div className="flex flex-col lg:flex-row lg:items-end lg:space-x-4 gap-4">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Seller name or Order ID..."
              value={filters.searchQuery}
              onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Province Multi-Select */}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-700 mb-1">Province</label>
          <div ref={provinceDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setShowProvinceDropdown(!showProvinceDropdown)}
              className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white hover:bg-gray-50 flex items-center justify-between"
            >
              <span className="truncate pr-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-500" />
                {filters.provinces.length === 0 
                  ? 'All Provinces' 
                  : `${filters.provinces.length} selected`}
              </span>
              <span className={`text-[11px] transition-transform ${showProvinceDropdown ? 'rotate-180' : ''}`}>⌄</span>
            </button>

            {showProvinceDropdown && (
              <div className="absolute left-0 mt-2 z-30 w-full border border-gray-200 rounded-xl bg-white shadow-xl max-h-64 overflow-y-auto">
                <div className="p-2 space-y-1">
                  {provinces.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500 text-center">No provinces found</div>
                  ) : (
                    provinces.map(province => (
                      <label
                        key={province}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={filters.provinces.includes(province!)}
                          onChange={() => handleProvinceToggle(province!)}
                          className="w-4 h-4 text-teal-600 rounded focus:ring-2 focus:ring-teal-500"
                        />
                        <span className="text-xs text-gray-700 flex-1">{province}</span>
                      </label>
                    ))
                  )}
                </div>
                {filters.provinces.length > 0 && (
                  <div className="border-t border-gray-200 p-2">
                    <button
                      onClick={clearProvinces}
                      className="w-full text-xs text-gray-600 hover:text-gray-900 py-1"
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* City Multi-Select */}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-700 mb-1">City</label>
          <div ref={cityDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setShowCityDropdown(!showCityDropdown)}
              disabled={filters.provinces.length === 0}
              className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white hover:bg-gray-50 flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="truncate pr-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-gray-500" />
                {filters.cities.length === 0 
                  ? 'All Cities' 
                  : `${filters.cities.length} selected`}
              </span>
              <span className={`text-[11px] transition-transform ${showCityDropdown ? 'rotate-180' : ''}`}>⌄</span>
            </button>

            {showCityDropdown && (
              <div className="absolute left-0 mt-2 z-30 w-full border border-gray-200 rounded-xl bg-white shadow-xl max-h-64 overflow-y-auto">
                <div className="p-2 space-y-1">
                  {availableCities.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500 text-center">No cities found</div>
                  ) : (
                    availableCities.map(city => (
                      <label
                        key={city}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={filters.cities.includes(city!)}
                          onChange={() => handleCityToggle(city!)}
                          className="w-4 h-4 text-teal-600 rounded focus:ring-2 focus:ring-teal-500"
                        />
                        <span className="text-xs text-gray-700 flex-1">{city}</span>
                      </label>
                    ))
                  )}
                </div>
                {filters.cities.length > 0 && (
                  <div className="border-t border-gray-200 p-2">
                    <button
                      onClick={clearCities}
                      className="w-full text-xs text-gray-600 hover:text-gray-900 py-1"
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Date Range */}
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs font-medium text-gray-700 mb-1">Date Range</label>
          <select
            value={filters.dateRange}
            onChange={(e) => setFilters(prev => ({ ...prev, dateRange: e.target.value as any }))}
            className="w-full p-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="today">Today</option>
            <option value="last-7">Last 7 days</option>
            <option value="last-30">Last 30 days</option>
            <option value="last-90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        {/* Reset Button */}
        <div className="flex items-end gap-2 pt-2">
          <button
            onClick={resetAllFilters}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            Reset All
          </button>
        </div>
      </div>

      {/* Active Filters Display */}
      {(filters.provinces.length > 0 || filters.cities.length > 0 || filters.searchQuery) && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Active Filters:</span>
            
            {filters.provinces.map(province => (
              <span
                key={province}
                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
              >
                {province}
                <button
                  onClick={() => handleProvinceToggle(province)}
                  className="hover:text-blue-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            {filters.cities.map(city => (
              <span
                key={city}
                className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full"
              >
                {city}
                <button
                  onClick={() => handleCityToggle(city)}
                  className="hover:text-green-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            {filters.searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                Search: {filters.searchQuery}
                <button
                  onClick={() => setFilters(prev => ({ ...prev, searchQuery: '' }))}
                  className="hover:text-purple-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
