/**
 * Seller Dashboard Container
 * Main container for seller dashboard views with filter management
 */

import { Order } from '@/types/order';
import { useDashboardFilters } from '@/hooks/dashboard/useDashboardFilters';
import { useDashboardMetrics } from '@/hooks/dashboard/useDashboardMetrics';
import { useCategoryResolution } from '@/hooks/dashboard/useCategoryResolution';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { generateCSV, generatePDF } from '@/utils/dashboard/dataProcessing';
import { DateRangePicker, ExportMenu, LoadingSpinner, MetricCard } from '../shared';
import { DollarSign, TrendingUp, Receipt, ShoppingCart } from 'lucide-react';
import { SummaryView } from './SummaryView';
import { ItemsView } from './ItemsView';
import { CategoryView } from './CategoryView';
import { PaymentTypeView } from './PaymentTypeView';
import { ReceiptsView } from './ReceiptsView';

interface SellerDashboardProps {
  orders: Order[];
  user: { name?: string; email: string };
  sellerUidToName?: Record<string, string>;
  loading?: boolean;
}

export const SellerDashboard = ({ 
  orders, 
  user, 
  sellerUidToName = {}, 
  loading = false 
}: SellerDashboardProps) => {
  const {
    filters,
    setFilters,
    dateRange,
    showDatePicker,
    setShowDatePicker,
    calendarMonth,
    setCalendarMonth,
    dateDropdownRef,
    handleDayClick,
    applyDateRange,
    applyPreset,
    resetFilters,
  } = useDashboardFilters();

  const { productCategoryMap, categoryNameMap } = useCategoryResolution(orders);

  const {
    paidOrders,
    kpiMetrics,
    financialMetrics,
    itemMetrics,
    categoryMetrics,
    paymentTypeMetrics,
    revenueByDate,
  } = useDashboardMetrics({ orders, filters, productCategoryMap, categoryNameMap });

  // CSV Export handlers
  const handleExportItemsCSV = () => {
    const csv = generateCSV(paidOrders, 'seller');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seller-items-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCategoryCSV = () => {
    const csv = generateCSV(paidOrders, 'seller');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seller-categories-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPaymentTypeCSV = () => {
    const csv = generateCSV(paidOrders, 'seller');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seller-payment-types-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportReceiptsCSV = () => {
    const csv = generateCSV(paidOrders, 'seller');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seller-receipts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Date range display for views
  const dateRangeDisplay = dateRange.start 
    ? `${dateRange.start.toLocaleDateString()} - ${(dateRange.end || dateRange.start).toLocaleDateString()}`
    : filters.dateRange.replace('last-', 'Last ');

  if (loading) {
    return <LoadingSpinner size="lg" text="Loading your dashboard..." />;
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sales Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">Welcome back, {user.name || user.email}</p>
        </div>
      </div>

      {/* Filters Section - TO BE EXTRACTED TO SellerFilters.tsx */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="text-sm font-semibold text-gray-900 mb-3">Filters</div>
        <div className="flex flex-col lg:flex-row lg:items-end lg:space-x-4 gap-4">
          {/* Date Filter */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">Select date</label>
            <div ref={dateDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setShowDatePicker(v => !v)}
                className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="truncate pr-2">
                  {dateRange.start 
                    ? `${dateRange.start.toLocaleDateString()} → ${(dateRange.end || dateRange.start).toLocaleDateString()}`
                    : filters.dateRange.replace('last-', 'Last ')}
                </span>
                <span className={`text-[11px] transition-transform ${showDatePicker ? 'rotate-180' : ''}`}>⌄</span>
              </button>
              
              {/* Integrated DateRangePicker Component */}
              <DateRangePicker
                dateRange={dateRange}
                onApply={applyDateRange}
                onClear={resetFilters}
                show={showDatePicker}
                onClose={() => setShowDatePicker(false)}
                anchorRef={dateDropdownRef}
              />
            </div>
          </div>

          {/* View Type Selector */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">View</label>
            <select 
              className="w-full p-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              value={filters.viewType}
              onChange={(e) => setFilters(f => ({ ...f, viewType: e.target.value as any }))}
            >
              <option value="summary">Summary</option>
              <option value="item">By Item</option>
              <option value="category">By Category</option>
              <option value="paymentType">By Payment Type</option>
              <option value="receipts">Receipts</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-end gap-2 pt-2">
            <button className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg shadow-sm transition">
              Apply
            </button>
            <button 
              onClick={resetFilters}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Quick Stats - Using MetricCard Component */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="Gross Sales"
          value={formatCurrency(financialMetrics.totalGross)}
          subtitle="Total revenue"
          icon={<DollarSign className="w-6 h-6 text-white" />}
          color="green"
        />
        <MetricCard
          title="Net Payout"
          value={formatCurrency(financialMetrics.totalNetPayout)}
          subtitle="After fees"
          icon={<TrendingUp className="w-6 h-6 text-white" />}
          color="teal"
        />
        <MetricCard
          title="Receipts"
          value={kpiMetrics.receipts.toLocaleString()}
          subtitle="Paid orders"
          icon={<Receipt className="w-6 h-6 text-white" />}
          color="blue"
        />
        <MetricCard
          title="Avg Sale"
          value={formatCurrency(kpiMetrics.avgSalePerTxn)}
          subtitle="Per transaction"
          icon={<ShoppingCart className="w-6 h-6 text-white" />}
          color="purple"
        />
      </div>

      {/* View-specific content */}
      {filters.viewType === 'summary' && (
        <SummaryView 
          paidOrders={paidOrders}
          revenueByDate={revenueByDate}
          dateRangeDisplay={dateRangeDisplay}
        />
      )}
      
      {filters.viewType === 'item' && (
        <ItemsView 
          itemMetrics={itemMetrics}
          onExportCSV={handleExportItemsCSV}
        />
      )}
      
      {filters.viewType === 'category' && (
        <CategoryView 
          categoryMetrics={categoryMetrics}
          onExportCSV={handleExportCategoryCSV}
        />
      )}
      
      {filters.viewType === 'paymentType' && (
        <PaymentTypeView 
          paymentTypeMetrics={paymentTypeMetrics}
          onExportCSV={handleExportPaymentTypeCSV}
        />
      )}
      
      {filters.viewType === 'receipts' && (
        <ReceiptsView 
          paidOrders={paidOrders}
          sellerUidToName={sellerUidToName}
          onExportCSV={handleExportReceiptsCSV}
        />
      )}
    </div>
  );
};
