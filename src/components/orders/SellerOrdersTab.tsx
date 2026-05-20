import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Order } from '@/types/order';
import { Search, RefreshCcw, ShoppingCart, Printer } from 'lucide-react';
import { SUB_TABS, mapOrderToStage, LifecycleStage, TO_SHIP_SUB_TABS, ToShipStage } from './config';
import AllOrdersView from './views/AllOrdersView';
// Hidden views - orders go directly to to-ship after payment
// import UnpaidOrdersView from './views/UnpaidOrdersView';
// import ConfirmedOrdersView from './views/ConfirmedOrdersView';
import ToShipOrdersView from './views/ToShipOrdersView';
import ShippingOrdersView from './views/ShippingOrdersView';
import DeliveredOrdersView from './views/DeliveredOrdersView';
import CompletedOrdersView from './views/CompletedOrdersView';
import UnfulfilledOrdersView from './views/UnfulfilledOrdersView';
import ReturnRefundOrdersView from './views/ReturnRefundOrdersView';
import OrdersService, { type OrderHandler } from '@/services/orders';
import { doc as fsDoc, getDoc as fsGetDoc } from 'firebase/firestore';
import { db as fsDb } from '@/lib/firebase';
import SellersService from '@/services/sellers';
import ProductService from '@/services/product';
import { useAuth } from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import QRCode from 'qrcode';
import dentpalLogo from '@/assets/dentpal_logo.png';

/**
 * OrderTab
 * Professional, scalable UI for managing seller orders with horizontal filter bar.
 * Future extension points are clearly marked with comments.
 */
interface OrderTabProps {
  orders: Order[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onSelectOrder?: (order: Order) => void;
}

const viewMap: Record<LifecycleStage, React.FC<{ orders: Order[]; onSelectOrder?: (o: Order) => void }>> = {
  'all': AllOrdersView,
  // Hidden views - these statuses are skipped, orders go directly to to-ship
  'unpaid': AllOrdersView,  // Fallback to AllOrdersView (should not be accessed)
  'confirmed': AllOrdersView,  // Fallback to AllOrdersView (should not be accessed)
  'to-ship': ToShipOrdersView,
  'shipping': ShippingOrdersView,
  'delivered': DeliveredOrdersView,
  'completed': CompletedOrdersView,
  'unfulfilled': UnfulfilledOrdersView,
  'return-refund': ReturnRefundOrdersView,
};

export const OrderTab: React.FC<OrderTabProps> = ({
  orders,
  loading = false,
  error,
  onRefresh,
  onSelectOrder
}) => {
  const [query, setQuery] = useState('');
  const [dateRange, setDateRange] = useState<string>('');
  const [paymentType, setPaymentType] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [activeSubTab, setActiveSubTab] = useState<LifecycleStage>('all');
  
  // Date picker states (similar to Sales Summary)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerRange, setDatePickerRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const dateDropdownRef = useRef<HTMLDivElement>(null);
  
  // Keep legacy date inputs for now (will be replaced by calendar picker)
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  
  // Pagination state
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  // New: details dialog state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [copied, setCopied] = useState<null | 'id' | 'barcode'>(null);
  // New: to-ship sub-tab state
  const [toShipSubTab, setToShipSubTab] = useState<ToShipStage>('to-pack');
  // JRS shipping state
  const [shippingLoading, setShippingLoading] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);
  const [pickupScheduleDialog, setPickupScheduleDialog] = useState<{
    open: boolean;
    order: Order | null;
    pickupDate: string;
    pickupTime: string;
  }>({
    open: false,
    order: null,
    pickupDate: '',
    pickupTime: '09:00',
  });
  const { user } = useAuth();

  // Resolve current handler (main seller vs sub-account) once for use in
  // every status / fulfillment-stage write.
  const [handler, setHandler] = useState<OrderHandler | null>(null);
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) { setHandler(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await fsGetDoc(fsDoc(fsDb, 'User', uid));
        const d = snap.exists() ? (snap.data() as { isSubAccount?: boolean; parentId?: string }) : null;
        if (cancelled) return;
        if (d?.isSubAccount && d.parentId) {
          setHandler({ id: uid, role: 'sub', parentId: d.parentId });
        } else {
          setHandler({ id: uid, role: 'main' });
        }
      } catch {
        if (!cancelled) setHandler({ id: uid, role: 'main' });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Selection state for bulk actions in To Hand Over tab
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  // Selection state for bulk JRS shipping in To Arrangement tab
  const [selectedArrangementOrderIds, setSelectedArrangementOrderIds] = useState<Set<string>>(new Set());

  // Selection state for bulk pack list in To Pack tab
  const [selectedPackOrderIds, setSelectedPackOrderIds] = useState<Set<string>>(new Set());

  // Clear selection when switching tabs or sub-tabs
  useEffect(() => {
    setSelectedOrderIds(new Set());
    setSelectedArrangementOrderIds(new Set());
    setSelectedPackOrderIds(new Set());
  }, [activeSubTab, toShipSubTab]);

  // Close date picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(event.target as Node)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper functions for calendar
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const firstWeekday = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  const isInRange = (day: Date) => {
    if (!datePickerRange.start || !datePickerRange.end) return false;
    const t = day.getTime();
    return t >= datePickerRange.start.getTime() && t <= datePickerRange.end.getTime();
  };

  const handleDayClick = (day: Date) => {
    if (!datePickerRange.start || (datePickerRange.start && datePickerRange.end)) {
      setDatePickerRange({ start: day, end: null });
    } else {
      if (day >= datePickerRange.start) {
        setDatePickerRange({ ...datePickerRange, end: day });
      } else {
        setDatePickerRange({ start: day, end: datePickerRange.start });
      }
    }
  };

  const applyPreset = (preset: string) => {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    if (preset === 'today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setDatePickerRange({ start: today, end: now });
      setDateFrom(toISO(today));
      setDateTo(toISO(now));
      setShowDatePicker(false);
    } else {
      const days = parseInt(preset);
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      setDatePickerRange({ start, end: now });
      setDateFrom(toISO(start));
      setDateTo(toISO(now));
      setShowDatePicker(false);
    }
  };

  const applyDateRange = () => {
    if (datePickerRange.start) {
      const end = datePickerRange.end || datePickerRange.start;
      setDateFrom(toISO(datePickerRange.start));
      setDateTo(toISO(end));
      setShowDatePicker(false);
    }
  };

  const clearDateFilter = () => {
    setDatePickerRange({ start: null, end: null });
    setDateFrom('');
    setDateTo('');
  };

  // Reset to first page when filters or tab change
  useEffect(() => { setPage(1); }, [activeSubTab, dateFrom, dateTo]);

  // Reset to-ship sub-tab when switching to to-ship
  useEffect(() => {
    if (activeSubTab === 'to-ship') {
      setToShipSubTab('to-pack');
    }
  }, [activeSubTab]);

  // Date-filter orders once for reuse (reverted: no hour restriction, only date range)
  const dateFilteredOrders = useMemo(() => {
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
    if (!from && !to) return orders;
    return orders.filter(o => {
      const ts = new Date(o.timestamp);
      if (from && ts < from) return false;
      if (to && ts > to) return false;
      return true; // no hour filtering here
    });
  }, [orders, dateFrom, dateTo]);

  // Precompute counts per sub tab for badges (now respects date range)
  const countsBySubTab = useMemo(() => {
    const base: Record<LifecycleStage, number> = { 
      'all': 0, 
      'unpaid': 0, 
      'confirmed': 0, 
      'to-ship': 0, 
      'shipping': 0, 
      'delivered': 0, 
      'completed': 0,
      'unfulfilled': 0,
      'return-refund': 0 
    };
    dateFilteredOrders.forEach(o => { const stage = mapOrderToStage(o); base[stage] += 1; base.all += 1; });
    return base;
  }, [dateFilteredOrders]);

  // Counts for to-ship sub-tabs
  const countsByToShipSubTab = useMemo(() => {
    const toShipOrders = dateFilteredOrders.filter(o => mapOrderToStage(o) === 'to-ship');
    const base: Record<ToShipStage, number> = { 'to-pack': 0, 'to-arrangement': 0, 'to-hand-over': 0 };
    toShipOrders.forEach(o => {
      const stage = o.fulfillmentStage || 'to-pack';
      base[stage as ToShipStage] += 1;
    });
    return base;
  }, [dateFilteredOrders]);

  const filtered = useMemo(() => {
    return dateFilteredOrders.filter(o => {
      // text query filter
      const q = (query || '').trim().toLowerCase();
      if (q) {
        const hay = [o.id, o.barcode, o.itemsBrief, o.customer?.name]
          .filter(Boolean)
          .map(v => String(v).toLowerCase());
        if (!hay.some(h => h.includes(q))) return false;
      }
      // stage filter
      if (activeSubTab !== 'all' && !SUB_TABS.find(t => t.id === activeSubTab)?.predicate(o)) return false;
      // to-ship sub-stage filter
      if (activeSubTab === 'to-ship') {
        const stage = o.fulfillmentStage || 'to-pack';
        if (stage !== toShipSubTab) return false;
      }
      return true;
    });
  }, [dateFilteredOrders, activeSubTab, toShipSubTab, query]);

  // Compute pagination
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const startIdx = (currentPage - 1) * pageSize;
  const pagedOrders = filtered.slice(startIdx, startIdx + pageSize);
  const rangeStart = total === 0 ? 0 : startIdx + 1;
  const rangeEnd = Math.min(startIdx + pageSize, total);

  const ActiveView = viewMap[activeSubTab];

  // When a row asks to show details, open dialog and also bubble if parent provided handler
  const handleSelectOrder = (o: Order) => {
    setSelectedOrder(o);
    setDetailsOpen(true);
    onSelectOrder?.(o);
  };

  // Handle moving order to arrangement
  const handleMoveToArrangement = async (order: Order) => {
    try {
      await OrdersService.updateFulfillmentStage(order.id, 'to-arrangement', handler ?? undefined);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to move order to arrangement:', error);
      alert('Failed to move order. Please try again.');
    }
  };

  // Handle Print Pack List - prints and moves selected orders (or all if none selected)
  const handlePrintPackList = async () => {
    const allToPackOrders = dateFilteredOrders.filter(o =>
      mapOrderToStage(o) === 'to-ship' &&
      (o.fulfillmentStage || 'to-pack') === 'to-pack'
    );

    const hasSelection = selectedPackOrderIds.size > 0;
    const toPackOrders = hasSelection
      ? allToPackOrders.filter(o => selectedPackOrderIds.has(o.id))
      : allToPackOrders;

    if (toPackOrders.length === 0) {
      alert(hasSelection
        ? 'Selected orders are no longer in To Pack stage.'
        : 'No orders in To Pack stage.');
      return;
    }

    const printWindow = printPackList(toPackOrders);

    if (!printWindow) {
      alert('Unable to open print window. Please check your popup blocker settings.');
      return;
    }

    try {
      await Promise.all(
        toPackOrders.map(order =>
          OrdersService.updateFulfillmentStage(order.id, 'to-arrangement', handler ?? undefined)
        )
      );

      setSelectedPackOrderIds(new Set());
      setToShipSubTab('to-arrangement');
      onRefresh?.();
    } catch (error) {
      console.error('Failed to move orders:', error);
      alert('Failed to move orders. Please try again.');
    }
  };

  // Toggle selection for a pack order
  const handleTogglePackOrderSelection = (order: Order) => {
    setSelectedPackOrderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(order.id)) newSet.delete(order.id);
      else newSet.add(order.id);
      return newSet;
    });
  };

  // Print pack list for multiple orders with detailed information
  const printPackList = (orders: Order[]) => {
    const w = window.open('', '_blank');
    if (!w) return null;
    
    // Generate detailed order cards
    const orderCardsHTML = orders.map((order, idx) => {
      // Get shipping address
      const address = order.shippingInfo 
        ? `${order.shippingInfo.addressLine1 || ''}${order.shippingInfo.addressLine2 ? ', ' + order.shippingInfo.addressLine2 : ''}, ${order.shippingInfo.city || ''}, ${order.shippingInfo.state || ''} ${order.shippingInfo.postalCode || ''}`
        : order.region 
        ? `${order.region.barangay || ''}, ${order.region.municipality || ''}, ${order.region.province || ''} ${order.region.zip || ''}`
        : 'No address available';

      const packagingSize = order.summary?.packagingSize || order.shippingInfo?.packagingSize || '—';

      // Generate items list with variation
      const itemsHTML = order.items && order.items.length > 0
        ? order.items.map(item => {
            const variation = item.sku ? ` (${item.sku})` : '';
            return `<div class="item-row">
              <span class="item-name">${item.name}${variation}</span>
              <span class="item-qty">x${item.quantity}</span>
            </div>`;
          }).join('')
        : `<div class="item-row"><span class="item-name">${order.itemsBrief || `${order.orderCount || 0} item(s)`}</span></div>`;

      return `
        <div class="order-card">
          <div class="order-header">
            <span class="order-number">#${idx + 1}</span>
            <span class="order-id">Order ID: ${order.id}</span>
          </div>
          <div class="order-info">
            <div class="info-row">
              <span class="label">Date:</span>
              <span class="value">${order.timestamp || '—'}</span>
            </div>
            <div class="info-row">
              <span class="label">Buyer:</span>
              <span class="value">${order.customer?.name || '—'}</span>
            </div>
            <div class="info-row">
              <span class="label">Address:</span>
              <span class="value">${address}</span>
            </div>
            <div class="info-row packaging-row">
              <span class="label">Packaging:</span>
              <span class="value packaging-value">${packagingSize}</span>
            </div>
          </div>
          <div class="items-section">
            <div class="items-header">Products:</div>
            ${itemsHTML}
          </div>
        </div>
        <div class="divider"></div>
      `;
    }).join('');
    
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Pack List - ${new Date().toLocaleDateString()}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; 
      padding: 16px; 
      color: #1f2937;
      background: #ffffff;
    }
    .header { 
      border-bottom: 3px solid #0d9488; 
      padding-bottom: 10px; 
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header-left {
      flex: 1;
    }
    .header h1 { 
      font-size: 24px; 
      color: #0d9488; 
      font-weight: 700;
      margin-bottom: 2px;
    }
    .header .date { 
      font-size: 13px; 
      color: #6b7280;
    }
    .header-right {
      text-align: right;
    }
    .order-count {
      font-size: 20px;
      font-weight: 700;
      color: #0d9488;
      background: #f0fdfa;
      padding: 6px 14px;
      border-radius: 6px;
      border: 2px solid #5eead4;
    }
    .order-count-label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 4px;
    }
    .summary {
      background: #f0fdfa;
      border: 2px solid #5eead4;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 16px;
      font-size: 14px;
      color: #134e4a;
      font-weight: 600;
      display: none;
    }
    .order-card {
      background: #ffffff;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    .order-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 2px solid #f3f4f6;
      margin-bottom: 8px;
    }
    .order-number {
      font-size: 18px;
      font-weight: 700;
      color: #0d9488;
      background: #f0fdfa;
      padding: 3px 10px;
      border-radius: 5px;
    }
    .order-id {
      font-size: 13px;
      font-weight: 600;
      color: #4b5563;
    }
    .order-info {
      margin-bottom: 8px;
    }
    .info-row {
      display: flex;
      padding: 3px 0;
      font-size: 13px;
    }
    .info-row .label {
      font-weight: 600;
      color: #6b7280;
      min-width: 70px;
    }
    .info-row .value {
      color: #1f2937;
      flex: 1;
    }
    .packaging-value {
      font-weight: 700;
      color: #0d9488;
    }
    .items-section {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 8px;
    }
    .items-header {
      font-weight: 700;
      color: #374151;
      font-size: 13px;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .item-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .item-row:last-child {
      border-bottom: none;
    }
    .item-name {
      font-size: 12px;
      color: #1f2937;
      flex: 1;
    }
    .item-qty {
      font-size: 12px;
      font-weight: 600;
      color: #0d9488;
      margin-left: 10px;
    }
    .divider {
      height: 1px;
      background: linear-gradient(to right, #e5e7eb, #d1d5db, #e5e7eb);
      margin: 12px 0;
    }
    .footer { 
      margin-top: 20px; 
      padding-top: 16px; 
      border-top: 2px solid #e5e7eb; 
      text-align: center; 
      font-size: 11px; 
      color: #9ca3af;
    }
    @media print {
      body { 
        padding: 10mm; 
      }
      .header { 
        page-break-after: avoid; 
      }
      .order-card { 
        page-break-inside: avoid; 
        break-inside: avoid;
      }
      .divider {
        page-break-after: avoid;
      }
      @page { 
        size: A4; 
        margin: 10mm; 
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>📦 Pack List</h1>
      <div class="date">Generated: ${new Date().toLocaleString('en-US', { 
        dateStyle: 'full', 
        timeStyle: 'short' 
      })}</div>
    </div>
    <div class="header-right">
      <span class="order-count-label">Total Orders</span>
      <div class="order-count">${orders.length}</div>
    </div>
  </div>
  
  <div class="summary">
    Total Orders to Pack: ${orders.length}
  </div>
  
  ${orderCardsHTML}
  
  <div class="footer">
    DentPal Pack List - All orders listed above are ready for packing and arrangement<br>
    Please verify all items before moving to the next stage
  </div>
  
  <script>
    // Auto-trigger print dialog when page loads
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>`);
    
    w.document.close();
    return w;
  };

  // Handle moving order to hand over - Now called from To Hand Over tab to complete handover and move to Shipping
  const handleMoveToHandOver = async (order: Order) => {
    try {
      // Move order to shipping tab (status: processing/shipping)
      await OrdersService.updateOrderStatus(order.id, 'processing', handler ?? undefined);
      
      // Navigate to Shipping tab after successful handover
      setActiveSubTab('shipping');
      setPage(1);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to complete handover:', error);
      alert('Failed to complete handover. Please try again.');
    }
  };

  // Handle toggling order selection in To Hand Over tab
  const handleToggleOrderSelection = (order: Order) => {
    setSelectedOrderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(order.id)) {
        newSet.delete(order.id);
      } else {
        newSet.add(order.id);
      }
      return newSet;
    });
  };

  // Handle bulk complete handover for selected orders
  const handleBulkCompleteHandover = async () => {
    if (selectedOrderIds.size === 0) return;

    const confirmed = window.confirm(
      `Complete handover for ${selectedOrderIds.size} selected order(s)? They will be moved to the Shipping tab.`
    );
    
    if (!confirmed) return;

    try {
      // Process all selected orders
      const promises = Array.from(selectedOrderIds).map(orderId =>
        OrdersService.updateOrderStatus(orderId, 'processing', handler ?? undefined)
      );
      
      await Promise.all(promises);
      
      // Clear selection and refresh
      setSelectedOrderIds(new Set());
      setActiveSubTab('shipping');
      setPage(1);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to complete bulk handover:', error);
      alert('Failed to complete handover for some orders. Please try again.');
    }
  };

  // Handle toggling order selection in To Arrangement tab
  const handleToggleArrangementOrderSelection = (order: Order) => {
    setSelectedArrangementOrderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(order.id)) {
        newSet.delete(order.id);
      } else {
        newSet.add(order.id);
      }
      return newSet;
    });
  };

  // Handle bulk JRS shipping for selected orders in To Arrangement tab
  const handleBulkCreateJRSShipping = async () => {
    if (selectedArrangementOrderIds.size === 0) return;

    // Show pickup schedule dialog for bulk orders
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const pickupDate = prompt(
      `Create JRS shipping for ${selectedArrangementOrderIds.size} selected order(s).\n\nEnter pickup date (YYYY-MM-DD):`,
      tomorrow.toISOString().split('T')[0]
    );
    
    if (!pickupDate) return;

    const pickupTime = prompt('Enter pickup time (HH:MM in 24-hour format, between 09:00 and 14:00):', '09:00');
    
    if (!pickupTime) return;

    // Validate pickup date and time
    const selectedDateTime = new Date(`${pickupDate}T${pickupTime}`);
    const now = new Date();
    if (selectedDateTime < now) {
      alert('Pickup date and time must be in the future.');
      return;
    }
    const hour = selectedDateTime.getHours();
    if (hour < 9 || hour > 14) {
      alert('Pickup time must be between 9:00 AM and 2:00 PM.');
      return;
    }

    const confirmed = window.confirm(
      `Create JRS shipping for ${selectedArrangementOrderIds.size} order(s)?\n\nPickup: ${pickupDate} at ${pickupTime}\n\nThis will create shipping requests and move orders to Hand Over stage.`
    );
    
    if (!confirmed) return;

    try {
      const userEmail = user?.email || 'admin@dentpal.ph';
      const requestedPickupSchedule = selectedDateTime.toISOString();
      const idToken = await auth.currentUser?.getIdToken();
      
      if (!idToken) {
        alert('Unable to authenticate your shipping request. Please sign in again.');
        return;
      }

      const firebaseFunctionUrl = 'https://asia-southeast1-dentpal-161e5.cloudfunctions.net/createJRSShipping';
      
      // Process each order sequentially to avoid overwhelming the API
      let successCount = 0;
      let failCount = 0;
      const selectedOrders = pagedOrders.filter(o => selectedArrangementOrderIds.has(o.id));
      
      for (const order of selectedOrders) {
        try {
          const response = await fetch(firebaseFunctionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              orderId: order.id,
              requestedPickupSchedule,
              createdByUserEmail: userEmail,
              remarks: `DentPal Order #${order.id} - Bulk Pickup scheduled for ${pickupDate} at ${pickupTime}`,
            }),
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const jrsResponse = await response.json();
          
          if (jrsResponse.success) {
            // Move order to To Hand Over stage
            await OrdersService.updateFulfillmentStage(order.id, 'to-hand-over', handler ?? undefined);
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          console.error(`Failed to create JRS shipping for order ${order.id}:`, error);
          failCount++;
        }
      }
      
      // Show result
      if (successCount > 0) {
        alert(`JRS shipping created successfully for ${successCount} order(s)!${failCount > 0 ? `\n\n${failCount} order(s) failed.` : ''}\n\nPickup scheduled: ${pickupDate} at ${pickupTime}\n\nOrders moved to Hand Over stage.`);
      } else {
        alert('Failed to create JRS shipping for all orders. Please try again.');
      }
      
      // Clear selection and switch to To Hand Over tab
      setSelectedArrangementOrderIds(new Set());
      setToShipSubTab('to-hand-over');
      setPage(1);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to create bulk JRS shipping:', error);
      alert('Failed to create JRS shipping for some orders. Please try again.');
    }
  };

  // Handle moving order back to pack (from arrangement)
  const handleMoveToPack = async (order: Order) => {
    try {
      await OrdersService.moveOrderToPreviousStage(order.id, 'to-arrangement', 'to-pack', handler ?? undefined);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to move order back to pack:', error);
      alert('Failed to move order. Please try again.');
    }
  };

  // Handle moving order from confirmed to to_ship (starts fulfillment workflow)
  const handleMoveToToShip = async (order: Order) => {
    try {
      // Update order status to 'to_ship' and set fulfillmentStage to 'to-pack'
      await OrdersService.updateOrderStatus(order.id, 'to_ship', handler ?? undefined);
      
      // The updateOrderStatus function now handles adding the to-pack fulfillment stage
      onRefresh?.();
      
      // Switch to the to-ship tab to show the order in the fulfillment workflow
      setActiveSubTab('to-ship');
      setToShipSubTab('to-pack');
    } catch (error) {
      console.error('Failed to move order to to-ship:', error);
      alert('Failed to move order to fulfillment. Please try again.');
    }
  };

  // Handle moving order to shipping (from to-arrangement) with JRS integration
  // Creates JRS shipping and moves order to to-hand-over stage
  const handleMoveToShipping = async (order: Order) => {
    // Show pickup schedule dialog first
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    setPickupScheduleDialog({
      open: true,
      order,
      pickupDate: tomorrow.toISOString().split('T')[0], // Default to tomorrow
      pickupTime: '09:00', // Default to 9 AM
    });
  };

  // Handle confirming the pickup schedule and proceeding with shipping
  const handleConfirmPickupSchedule = async () => {
    const { order, pickupDate, pickupTime } = pickupScheduleDialog;
    
    if (!order || !pickupDate || !pickupTime) {
      alert('Please select a pickup date and time.');
      return;
    }

    // Validate pickup date is not in the past
    const selectedDateTime = new Date(`${pickupDate}T${pickupTime}`);
    const now = new Date();
    if (selectedDateTime < now) {
      alert('Pickup date and time must be in the future.');
      return;
    }
    const hour = selectedDateTime.getHours();
    if (hour < 9 || hour > 14) {
      alert('Pickup time must be between 9:00 AM and 2:00 PM.');
      return;
    }

    setPickupScheduleDialog(prev => ({ ...prev, open: false }));
    setShippingLoading(order.id);
    
    try {
      // Create JRS shipping request with pickup schedule
      const userEmail = user?.email || 'admin@dentpal.ph';
      const requestedPickupSchedule = selectedDateTime.toISOString();
      
      // Debug: Log order details before shipping request
      console.log('Attempting to ship order:', {
        orderId: order.id,
        status: order.status,
        fulfillmentStage: order.fulfillmentStage,
        requestedPickupSchedule
      });
      
      // Call Firebase Cloud Function which proxies to JRS API (avoids CORS issues)
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        alert('Unable to authenticate your shipping request. Please sign in again.');
        setShippingLoading(null);
        return;
      }

      // Use the Firebase Cloud Function URL instead of calling JRS API directly
      const firebaseFunctionUrl = 'https://asia-southeast1-dentpal-161e5.cloudfunctions.net/createJRSShipping';
      
      const response = await fetch(firebaseFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          requestedPickupSchedule,
          createdByUserEmail: userEmail,
          remarks: `DentPal Order #${order.id} - Pickup scheduled for ${pickupDate} at ${pickupTime}`,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('JRS shipping request failed:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          orderId: order.id,
          orderStatus: order.status,
          orderFulfillmentStage: order.fulfillmentStage
        });
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      const jrsResponse = await response.json();
      
      console.log('Creating JRS shipping request for order:', order.id, 'Pickup:', requestedPickupSchedule);
      
      if (jrsResponse.success) {
        console.log('JRS shipping created successfully:', jrsResponse);
        // Extract tracking ID - improved function returns it directly
        const trackingId = jrsResponse.trackingId || 
                          jrsResponse.jrsResponse?.ShippingRequestEntityDto?.TrackingId || 
                          '';
        const trackingInfo = trackingId ? `, Tracking ID: ${trackingId}` : '';
        alert(`JRS shipping created successfully!\n\nReference: ${jrsResponse.shippingReferenceNo}${trackingInfo}\n\nPickup scheduled: ${pickupDate} at ${pickupTime}\n\nOrder moved to Hand Over stage.`);
      } else {
        console.error('JRS shipping failed:', jrsResponse);
        alert(`Shipping request created but JRS returned error: ${jrsResponse.error || 'Unknown error'}`);
      }
      
      // Move order to To Hand Over stage after creating JRS shipping
      await OrdersService.updateFulfillmentStage(order.id, 'to-hand-over', handler ?? undefined);
      
      // Switch to To Hand Over tab
      setToShipSubTab('to-hand-over');
      setPage(1);
      onRefresh?.();
      
    } catch (error) {
      console.error('Failed to move order to shipping:', error);
      
      // Show user-friendly error message with more details
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Failed to process shipping request';
        
      const detailsMessage = `Order: ${order.id}\nStatus: ${order.status}\nFulfillment Stage: ${order.fulfillmentStage || 'none'}\n\nError: ${errorMessage}`;
        
      alert(`Failed to create shipping request.\n\n${detailsMessage}\n\nPlease try again or contact support if the issue persists.`);
      
      // Stay on the current tab since no changes were made
      onRefresh?.();
    } finally {
      setShippingLoading(null);
    }
  };

  // Cancel JRS shipping for a hand-over order and roll it back to to-arrangement.
  // Calls the cancelJRSShipping cloud function which hits the JRS cancel endpoint
  // and updates shippingInfo + fulfillmentStage in Firestore.
  const handleCancelShipment = async (order: Order) => {
    const confirmed = window.confirm(
      `Cancel JRS shipment for order #${order.id}?\n\nThis will move the order back to To Arrangement so you can re-issue shipping.`
    );
    if (!confirmed) return;

    setCancelLoading(order.id);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        alert('Unable to authenticate your request. Please sign in again.');
        return;
      }

      const firebaseFunctionUrl = 'https://asia-southeast1-dentpal-161e5.cloudfunctions.net/cancelJRSShipping';
      const response = await fetch(firebaseFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          cancellationDetails: 'Cancelled by seller',
          canceledByUserEmail: user?.email || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const baseError = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
        const detailText = errorData.details
          ? `\n\nJRS details: ${typeof errorData.details === 'string' ? errorData.details : JSON.stringify(errorData.details)}`
          : '';
        throw new Error(`${baseError}${detailText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Cancel request did not succeed');
      }

      alert(`Shipment cancelled successfully.\n\nOrder #${order.id} moved back to To Arrangement.`);
      setToShipSubTab('to-arrangement');
      setPage(1);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to cancel JRS shipment:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to cancel shipment.\n\n${message}\n\nPlease try again or contact support.`);
    } finally {
      setCancelLoading(null);
    }
  };

  // Handle confirming handover -> move to Shipping (processing) - deprecated, use handleMoveToShipping instead
  const handleConfirmHandover = async (order: Order) => {
    try {
      await OrdersService.updateOrderStatus(order.id, 'processing', handler ?? undefined);
      // After confirming handover, navigate to Shipping tab
      setActiveSubTab('shipping');
      setPage(1);
      onRefresh?.();
    } catch (error) {
      console.error('Failed to confirm handover:', error);
      alert('Failed to confirm handover. Please try again.');
    }
  };

  // Accessibility: close on Escape
  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetailsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailsOpen]);

  const statusClasses = (s: Order['status']) => {
    switch (s) {
      case 'pending': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'confirmed': return 'bg-green-100 text-green-800 border-green-200';
      case 'to_ship': return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'processing': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'completed': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'cancelled': return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'failed-delivery': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'returned':
      case 'refunded':
      case 'return_refund':
        return 'bg-violet-100 text-violet-800 border-violet-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const stepOrder: LifecycleStage[] = ['unpaid','confirmed','to-ship','shipping','delivered'];

  const copyToClipboard = async (text: string, which: 'id' | 'barcode') => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(()=> setCopied(null), 1200); } catch {}
  };

  // Build waybill HTML (landscape, courier-grade)
  const buildInvoiceHTML = async (order: Order) => {
    const DEFAULT_SELLER_ADDRESS = 'Unit 1207, 12/F Cityland Herrera Tower, Rufino St. cor. Valero St., Brgy. Bel-Air, Makati City, Metro Manila, 1227';

    // Logo → base64
    let logoDataUrl = '';
    try {
      const response = await fetch(dentpalLogo);
      const blob = await response.blob();
      logoDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('Failed to load logo:', err);
    }

    // QR code for tracking ID — generated at higher resolution so 180px render stays crisp
    const trackingId = order.shippingInfo?.jrs?.trackingId || 'N/A';
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(trackingId, {
        width: 320,
        margin: 1,
        color: { dark: '#0b0f17', light: '#ffffff' },
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    }

    // Buyer (shipping) address
    const ship = order.shippingInfo;
    const buyerName = ship?.fullName || order.customer?.name || '—';
    const buyerAddressParts = [
      ship?.addressLine1,
      ship?.addressLine2 || '',
      [ship?.city, ship?.state, ship?.postalCode].filter(Boolean).join(', '),
    ].filter(s => s && String(s).trim().length > 0);
    const buyerAddress = buyerAddressParts.length ? buyerAddressParts.join(', ') : '—';
    const buyerContact = ship?.phoneNumber || order.customer?.contact || '—';

    // Seller name + address — always resolve to the PARENT seller's store.
    // Try the order's sellerId first, follow parentId if the resolved profile is a sub-account,
    // and fall back to the logged-in user's own parent chain so sub-accounts print the parent store.
    let sellerName = order.sellerName || 'DentPal Seller';
    let sellerAddress = DEFAULT_SELLER_ADDRESS;
    const rawSellerFees = (order as unknown as { sellerFeeBreakdowns?: unknown }).sellerFeeBreakdowns;
    const sellerFeesEntry = Array.isArray(rawSellerFees)
      ? (rawSellerFees[0] as Record<string, unknown> | undefined)
      : (rawSellerFees as Record<string, unknown> | undefined);
    const orderSellerId = (sellerFeesEntry?.sellerId as string | undefined) || undefined;

    type ParentAwareProfile = {
      name?: string;
      parentId?: string;
      isSubAccount?: boolean;
      vendor?: {
        company?: {
          name?: string;
          storeName?: string;
          address?: { line1?: string; line2?: string; city?: string; province?: string; zip?: string };
        };
      };
    };

    const loadOwnerProfile = async (id: string | undefined): Promise<ParentAwareProfile | null> => {
      if (!id) return null;
      const first = (await SellersService.get(id)) as unknown as ParentAwareProfile | null;
      if (!first) return null;
      // If this profile is a sub-account, jump to its parent so we always print the parent store.
      if (first.parentId) {
        const parent = (await SellersService.get(first.parentId)) as unknown as ParentAwareProfile | null;
        if (parent) return parent;
      }
      return first;
    };

    try {
      let ownerProfile = await loadOwnerProfile(orderSellerId);

      // Fallback: if the order's sellerId didn't yield a usable store, try the logged-in user's
      // parent chain (covers sub-accounts whose orders weren't tagged with the parent uid).
      if (!ownerProfile?.vendor?.company?.storeName && user?.uid) {
        const fromAuth = await loadOwnerProfile(user.uid);
        if (fromAuth?.vendor?.company?.storeName) ownerProfile = fromAuth;
      }

      if (ownerProfile) {
        const company = ownerProfile.vendor?.company;
        sellerName = company?.storeName || company?.name || ownerProfile.name || sellerName;
        const a = company?.address;
        if (a) {
          const parts = [a.line1, a.line2 || '', [a.city, a.province, a.zip].filter(Boolean).join(', ')]
            .filter(s => s && String(s).trim().length > 0);
          if (parts.length) sellerAddress = parts.join(', ');
        }
      }
    } catch (err) {
      console.error('Failed to load seller profile:', err);
    }

    // Package size + dimensions/weight
    const packageSize = ship?.packagingSize || order.package?.size || '—';
    let packageDimensions = order.package?.dimensions || '';
    let packageWeight = order.package?.weight || '';

    // If the order doesn't carry parcel dimensions/weight, fall back to the first item's product
    if ((!packageDimensions || !packageWeight) && Array.isArray(order.items) && order.items.length > 0) {
      const firstProductId = order.items.find(it => it.productId)?.productId;
      if (firstProductId) {
        try {
          const product = await ProductService.getProductById(firstProductId) as
            | (Record<string, any> & {
                dimensions?: { length?: number; width?: number; height?: number };
                dimensionsUnit?: string;
                weight?: number;
                weightUnit?: string;
              })
            | null;
          if (product) {
            if (!packageDimensions && product.dimensions) {
              const { length, width, height } = product.dimensions;
              const dimsParts = [length, width, height].filter(v => v != null && v !== 0);
              if (dimsParts.length > 0) {
                const unit = product.dimensionsUnit || 'cm';
                packageDimensions = `${dimsParts.join(' × ')} ${unit}`;
              }
            }
            if (!packageWeight && product.weight != null) {
              const unit = product.weightUnit || 'kg';
              packageWeight = `${product.weight} ${unit}`;
            }
          }
        } catch (err) {
          console.error('Failed to load product dimensions:', err);
        }
      }
    }

    // Mode of payment — COD or NON-COD
    const rawPayment = (order.feesBreakdown?.paymentMethod || order.paymentType || '').toString().trim().toLowerCase();
    const paymentMode = rawPayment === 'cash_on_delivery' ? 'COD' : 'NON-COD';

    const printedAt = new Date().toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Waybill ${order.id}</title>
  <style>
    :root { --ink:#0b0f17; --line:#0b0f17; }
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; background:#fff; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--ink);
      font-size: 10pt;
      font-weight: 700;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet { width: 6in; height: 4in; padding: 0.1in 0.14in; overflow: hidden; box-sizing: border-box; display: flex; flex-direction: column; border: 2.5px solid var(--ink); }
    .header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-bottom:3px; border-bottom: 1.5px solid var(--ink); flex-shrink:0; }
    .brand { display:flex; align-items:center; gap:6px; }
    .brand img { width:24px; height:24px; object-fit:contain; }
    .title { font-size:16pt; font-weight:900; letter-spacing:0.4px; line-height:1; }
    .meta { text-align:right; }
    .meta .order-id { font-size:12pt; font-weight:900; word-break:break-all; line-height:1.15; }
    .meta .order-date { font-size:8pt; font-weight:700; margin-top:1px; }

    .qr-row { display:flex; align-items:center; gap:10px; padding:5px 0; border-bottom: 1px solid var(--ink); flex-shrink:0; }
    .qr-box { width:1in; height:1in; border:2px solid var(--ink); padding:2px; background:#fff; flex-shrink:0; display:flex; align-items:center; justify-content:center; }
    .qr-box img { width:100%; height:100%; display:block; }
    .qr-no { font-size:7pt; font-weight:800; color:var(--ink); text-align:center; }
    .qr-meta { display:flex; flex-direction:column; gap:2px; flex:1; min-width:0; }
    .field-value { font-size:11pt; font-weight:900; line-height:1.15; }
    .field-value.lg { font-size:14pt; }

    .party { padding:4px 0; }
    .party .field-label { font-size:8pt; font-weight:900; letter-spacing:1px; text-transform:uppercase; }
    .party .name { font-size:13pt; font-weight:900; margin-top:1px; line-height:1.15; }
    .party .addr { font-size:9.5pt; font-weight:700; margin-top:1px; line-height:1.25; }
    .party .contact { font-size:9.5pt; font-weight:800; margin-top:1px; }

    .divider { border-top: 1px solid var(--ink); margin: 1px 0; }

    .printed { text-align:right; font-size:7.5pt; font-weight:800; margin-top:2px; }

    .footer { display:none; }

    .actions { margin-top:6px; }
    .actions button { padding:6px 12px; border:2px solid var(--ink); border-radius:6px; background:#fff; font-weight:800; cursor:pointer; }

    @media print {
      html, body { width: 6in; height: 4in; }
      .sheet { padding: 0.08in 0.12in; width: 6in; height: 4in; page-break-after: avoid; page-break-inside: avoid; }
      .actions { display:none !important; }
      @page { size: 6in 4in; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="sheet">

    <div class="header">
      <div class="brand">
        ${logoDataUrl ? `<img src="${logoDataUrl}" alt="DentPal Logo" />` : '<div style="width:56px; height:56px; border-radius:10px; background:linear-gradient(135deg,#0ea5e9,#0d9488);"></div>'}
        <div class="title">DentPal</div>
      </div>
      <div class="meta">
        <div class="order-id">Order # ${order.id}</div>
        <div class="order-date">${order.timestamp || ''}</div>
      </div>
    </div>

    <div class="qr-row">
      <div class="qr-box">
        ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" />` : '<div class="qr-no">No QR</div>'}
      </div>
      <div class="qr-meta">
        <div class="field-value lg">${packageSize}</div>
        <div class="field-value">${paymentMode}</div>
        ${packageDimensions ? `<div style="font-size:12pt; font-weight:800;">${packageDimensions}</div>` : ''}
        ${packageWeight ? `<div style="font-size:12pt; font-weight:800;">${packageWeight}</div>` : ''}
      </div>
    </div>

    <div class="party">
      <div class="field-label">Buyer</div>
      <div class="name">${buyerName}</div>
      <div class="addr">${buyerAddress}</div>
      <div class="contact">${buyerContact}</div>
    </div>

    <div class="divider"></div>

    <div class="party">
      <div class="field-label">Seller</div>
      <div class="name">${sellerName}</div>
      <div class="addr">${sellerAddress}</div>
    </div>

    <div class="printed">Printed: ${printedAt}</div>

    <div class="footer">
      Thanks for your purchase. This is a system-generated waybill. For concerns, contact support.
    </div>

    <div class="actions">
      <button onclick="window.print()">Print</button>
    </div>
  </div>
</body>
</html>`;
  };

  // Print invoice with QR code
  const printInvoice = async (order: Order) => {
    const html = await buildInvoiceHTML(order);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 200);
  };

  const printSummary = (o: Order) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Order ${o.id}</title></head><body style="font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding:24px;">`);
    w.document.write(`<h2 style="margin:0 0 12px;">Order #${o.id}</h2>`);
    w.document.write(`<div>Date: ${o.timestamp}</div>`);
    w.document.write(`<div>Status: ${o.status}</div>`);
    w.document.write(`<div>Tracking No.: ${o.barcode}</div>`);
    if (Array.isArray(o.items) && o.items.length) {
      w.document.write('<h3 style="margin:16px 0 6px;">Items</h3>');
      w.document.write('<table style="width:100%; border-collapse:collapse;">');
      w.document.write('<thead><tr><th align="left" style="border-bottom:1px solid #e5e7eb; padding:6px 0;">Name</th><th align="right" style="border-bottom:1px solid #e5e7eb; padding:6px 0;">Qty</th><th align="right" style="border-bottom:1px solid #e5e7eb; padding:6px 0;">Price</th></tr></thead>');
      w.document.write('<tbody>');
      o.items.forEach(it => {
        w.document.write(`<tr><td style="padding:6px 0; border-bottom:1px solid #f3f4f6;">${it.name}</td><td align="right" style="padding:6px 0; border-bottom:1px solid #f3f4f6;">${it.quantity}</td><td align="right" style="padding:6px 0; border-bottom:1px solid #f3f4f6;">${it.price ?? ''}</td></tr>`);
      });
      w.document.write('</tbody></table>');
    } else if (o.itemsBrief) {
      w.document.write(`<div>Items: ${o.itemsBrief}</div>`);
    }
    if (o.total != null) w.document.write(`<div style="margin-top:10px;">Total: ${o.currency || 'PHP'} ${o.total}</div>`);
    w.document.write(`<div>Buyer: ${o.customer.name || ''}</div>`);
    w.document.write(`<div>Contact: ${o.customer.contact || ''}</div>`);
    w.document.write(`</body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by order ID, buyer, tracking no., or items"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
        <button
          type="button"
          onClick={() => onRefresh?.()}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          <RefreshCcw className="w-4 h-4" /> Refresh
        </button>
      </div>
      
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          {SUB_TABS.map(tab => {
            const isActive = tab.id === activeSubTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`relative px-4 py-2 rounded-lg text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60
                  ${isActive ? 'bg-teal-600 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}
                `}
              >
                <span>{tab.label}</span>
                <span className={`ml-2 inline-flex items-center justify-center text-[11px] font-semibold rounded-full px-1.5 min-w-[1.25rem]
                  ${isActive ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>{countsBySubTab[tab.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Date Filter Section with Calendar Picker */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900 mb-3">Date Filter</div>
        <div className="flex flex-col lg:flex-row lg:items-end lg:space-x-4 gap-4">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Select date range
            </label>
            <div ref={dateDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setShowDatePicker(v => !v)}
                aria-haspopup="dialog"
                aria-expanded={showDatePicker}
                className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="truncate pr-2">
                  {(() => {
                    if (datePickerRange.start) {
                      return `${toISO(datePickerRange.start)} → ${toISO(datePickerRange.end || datePickerRange.start)}`;
                    }
                    if (dateFrom && dateTo) {
                      return `${dateFrom} → ${dateTo}`;
                    }
                    if (dateFrom) {
                      return `From ${dateFrom}`;
                    }
                    return 'Select date range';
                  })()}
                </span>
                <span className={`text-[11px] transition-transform ${showDatePicker ? 'rotate-180' : ''}`}>⌄</span>
              </button>
              {showDatePicker && (
                <div className="absolute left-0 mt-2 z-30 w-[280px] border border-gray-200 rounded-xl bg-white shadow-xl p-3 space-y-3 animate-fade-in">
                  {/* Presets */}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => applyPreset('today')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Today</button>
                    <button onClick={() => applyPreset('7')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Last 7 days</button>
                    <button onClick={() => applyPreset('30')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Last 30 days</button>
                    {datePickerRange.start && (
                      <span className="text-[10px] text-gray-500 ml-auto">{toISO(datePickerRange.start)} → {toISO(datePickerRange.end || datePickerRange.start)}</span>
                    )}
                  </div>
                  {/* Calendar header */}
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">◀</button>
                    <div className="text-xs font-medium text-gray-700">
                      {calendarMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                    </div>
                    <button type="button" onClick={() => setCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">▶</button>
                  </div>
                  {/* Weekday labels */}
                  <div className="grid grid-cols-7 text-[10px] font-medium text-gray-500">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
                  </div>
                  {/* Days grid with range highlight */}
                  <div className="grid grid-cols-7 gap-1 text-xs">
                    {Array.from({ length: firstWeekday(calendarMonth) }).map((_,i) => <div key={'spacer'+i} />)}
                    {Array.from({ length: daysInMonth(calendarMonth) }).map((_,i) => {
                      const day = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), i+1);
                      const selectedStart = datePickerRange.start && day.getTime() === datePickerRange.start.getTime();
                      const selectedEnd = datePickerRange.end && day.getTime() === datePickerRange.end.getTime();
                      const inRange = isInRange(day);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleDayClick(day)}
                          className={`h-7 rounded-md flex items-center justify-center transition border text-gray-700 ${selectedStart || selectedEnd ? 'bg-teal-600 text-white border-teal-600 font-semibold' : inRange ? 'bg-teal-100 border-teal-200' : 'bg-white border-gray-200 hover:bg-gray-100'} ${day.toDateString() === new Date().toDateString() && !selectedStart && !selectedEnd ? 'ring-1 ring-teal-400' : ''}`}
                          title={toISO(day)}
                        >{i+1}</button>
                      );
                    })}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center justify-between pt-1">
                    <button type="button" onClick={clearDateFilter} className="text-[11px] px-2 py-1 rounded-md border bg-white hover:bg-gray-100">Clear</button>
                    <div className="flex gap-2">
                      <button type="button" onClick={applyDateRange} disabled={!datePickerRange.start} className="text-[11px] px-3 py-1 rounded-md bg-teal-600 text-white disabled:opacity-40">Apply</button>
                      <button type="button" onClick={() => setShowDatePicker(false)} className="text-[11px] px-3 py-1 rounded-md border bg-white hover:bg-gray-100">Done</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-end gap-2 pt-2">
            <button
              type="button"
              onClick={clearDateFilter}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {activeSubTab === 'to-ship' && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 shadow-sm mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {TO_SHIP_SUB_TABS.map(subTab => {
                const isActive = subTab.id === toShipSubTab;
                return (
                  <button
                    key={subTab.id}
                    onClick={() => setToShipSubTab(subTab.id)}
                    className={`relative px-3 py-1.5 rounded-lg text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60
                      ${isActive ? 'bg-orange-600 text-white shadow-sm' : 'bg-white text-orange-700 hover:bg-orange-100 border border-orange-300'}
                    `}
                  >
                    <span>{subTab.label}</span>
                    <span className={`ml-2 inline-flex items-center justify-center text-[11px] font-semibold rounded-full px-1.5 min-w-[1.25rem]
                      ${isActive ? 'bg-white/20 text-white' : 'bg-orange-200 text-orange-800'}`}>{countsByToShipSubTab[subTab.id]}</span>
                  </button>
                );
              })}
            </div>
            
            {/* Print Pack List buttons - only show on To Pack tab */}
            {toShipSubTab === 'to-pack' && countsByToShipSubTab['to-pack'] > 0 && (() => {
              const visiblePackIds = filtered.map(o => o.id);
              const allVisibleSelected = visiblePackIds.length > 0 && visiblePackIds.every(id => selectedPackOrderIds.has(id));
              const hasSelection = selectedPackOrderIds.size > 0;
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (allVisibleSelected) {
                        setSelectedPackOrderIds(new Set());
                      } else {
                        setSelectedPackOrderIds(new Set(visiblePackIds));
                      }
                    }}
                    className="px-3 py-2 text-sm font-medium rounded-lg border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 transition"
                  >
                    {allVisibleSelected ? 'Deselect All' : 'Select All'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrintPackList}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition flex items-center gap-2 shadow-sm"
                  >
                    <Printer className="w-4 h-4" />
                    {hasSelection
                      ? `Print Pack List & Move Selected (${selectedPackOrderIds.size})`
                      : 'Print Pack List & Move All to Arrangement'}
                  </button>
                </div>
              );
            })()}

            {/* Bulk Complete Handover button - only show on To Hand Over tab when orders are selected */}
            {toShipSubTab === 'to-hand-over' && selectedOrderIds.size > 0 && (
              <button
                type="button"
                onClick={handleBulkCompleteHandover}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition flex items-center gap-2 shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Complete Handover ({selectedOrderIds.size} selected)
              </button>
            )}

            {/* Bulk Create JRS Shipping button - only show on To Arrangement tab when orders are selected */}
            {toShipSubTab === 'to-arrangement' && selectedArrangementOrderIds.size > 0 && (
              <button
                type="button"
                onClick={handleBulkCreateJRSShipping}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition flex items-center gap-2 shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Create JRS Shipping ({selectedArrangementOrderIds.size} selected)
              </button>
            )}
          </div>
          <div className="mt-2 text-xs text-orange-600">
            Manage orders through packing, arrangement, and handover stages.
          </div>
        </div>
      )}

      {activeSubTab === 'to-ship'
        ? (
          <ToShipOrdersView
            orders={pagedOrders}
            onSelectOrder={handleSelectOrder}
            onMoveToArrangement={handleMoveToArrangement}
            onMoveToHandOver={handleMoveToHandOver}
            onConfirmHandover={handleConfirmHandover}
            onMoveToPack={handleMoveToPack}
            onMoveToShipping={handleMoveToShipping}
            onCancelShipment={handleCancelShipment}
            shippingLoading={shippingLoading}
            cancelLoading={cancelLoading}
            selectedOrderIds={selectedOrderIds}
            onToggleOrderSelection={handleToggleOrderSelection}
            selectedArrangementOrderIds={selectedArrangementOrderIds}
            onToggleArrangementOrderSelection={handleToggleArrangementOrderSelection}
            selectedPackOrderIds={selectedPackOrderIds}
            onTogglePackOrderSelection={handleTogglePackOrderSelection}
          />
        )
        : (!loading && pagedOrders.length === 0 && activeSubTab !== 'return-refund'
          ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <ShoppingCart className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-lg font-medium text-gray-900 mb-2">No orders found</p>
              <p className="text-gray-500">Try adjusting filters or date range to see orders here</p>
            </div>
          )
          : (
            <ActiveView orders={pagedOrders} onSelectOrder={handleSelectOrder} />
          )
        )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600 mr-2">
          <span>Rows per page</span>
          <select
            className="p-1.5 border border-gray-200 rounded-md text-xs"
            value={pageSize}
            onChange={(e)=> { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="ml-3">{rangeStart}-{rangeEnd} of {total}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            disabled={currentPage >= pageCount}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-md disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* Pickup Schedule Dialog */}
      {pickupScheduleDialog.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => setPickupScheduleDialog(prev => ({ ...prev, open: false }))} />
          <div role="dialog" aria-modal="true" className="relative z-10 w-[95vw] max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-teal-50">
              <h3 className="text-lg font-semibold text-gray-900">Schedule Pickup</h3>
              <p className="text-sm text-gray-600 mt-1">Select pickup date and time for JRS Express</p>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Order Details
                </label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="font-medium text-gray-900">Order #{pickupScheduleDialog.order?.id}</div>
                  <div className="text-gray-600">{pickupScheduleDialog.order?.customer?.name}</div>
                  <div className="text-gray-600">{pickupScheduleDialog.order?.itemsBrief}</div>
                </div>
              </div>

              <div>
                <label htmlFor="pickupDate" className="block text-sm font-medium text-gray-700 mb-2">
                  Pickup Date
                </label>
                <input
                  id="pickupDate"
                  type="date"
                  value={pickupScheduleDialog.pickupDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setPickupScheduleDialog(prev => ({ ...prev, pickupDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="pickupTime" className="block text-sm font-medium text-gray-700 mb-2">
                  Pickup Time
                </label>
                <select
                  id="pickupTime"
                  value={pickupScheduleDialog.pickupTime}
                  onChange={(e) => setPickupScheduleDialog(prev => ({ ...prev, pickupTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="09:00">9:00 AM</option>
                  <option value="10:00">10:00 AM</option>
                  <option value="11:00">11:00 AM</option>
                  <option value="12:00">12:00 PM</option>
                  <option value="13:00">1:00 PM</option>
                  <option value="14:00">2:00 PM</option>
                </select>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <div className="text-blue-600 text-sm font-medium">
                    <b>Note: </b>
                  </div>
                  <div className="text-blue-600 text-sm">
                    JRS Express will pick up the package at the scheduled date and time. <br />
                    Make sure the items are properly packed and ready for pickup.
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => setPickupScheduleDialog(prev => ({ ...prev, open: false }))}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPickupSchedule}
                disabled={!pickupScheduleDialog.pickupDate || !pickupScheduleDialog.pickupTime}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 border border-transparent rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm & Ship
              </button>
            </div>
          </div>
        </div>
      )}

      {detailsOpen && selectedOrder && (() => {
        const stg = mapOrderToStage(selectedOrder);
        const isTerminal = ['failed-delivery','cancellation','return-refund'].includes(stg);
        const activeIdx = stepOrder.indexOf(stg as any);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => setDetailsOpen(false)} />
            <div role="dialog" aria-modal="true" className="relative z-10 w-[95vw] max-w-3xl bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-white to-gray-50/60">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">Order</div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">#{selectedOrder.id}</h3>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusClasses(selectedOrder.status)}`}>
                        {selectedOrder.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeSubTab === 'to-ship' && toShipSubTab === 'to-hand-over' && (
                      <button
                        className="text-xs px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50"
                        onClick={async () => {
                          try {
                            await printInvoice(selectedOrder);
                          } catch (e) {
                            console.error('Error printing waybill:', e);
                          }
                        }}
                      >
                        Print Waybill
                      </button>
                    )}
                    <button 
                      className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-red-50 text-red-600 border border-red-200" 
                      onClick={() => setDetailsOpen(false)}
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
                  <div className="space-y-3 md:col-span-1">
                    <div>
                      <div className="text-xs text-gray-500">Date</div>
                      <div className="text-sm font-medium text-gray-900">{selectedOrder.timestamp}</div>
                    </div>
                    {(selectedOrder.summary?.packagingSize || selectedOrder.shippingInfo?.packagingSize) && (
                      <div>
                        <div className="text-xs text-gray-500">Packaging</div>
                        <div className="text-sm font-medium text-gray-900">
                          {selectedOrder.summary?.packagingSize || selectedOrder.shippingInfo?.packagingSize}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-gray-500">Buyer</div>
                      <div className="text-sm font-medium text-gray-900">{selectedOrder.customer.name || '—'}</div>
                      <div className="text-xs text-gray-500">
                        {(() => {
                          const parts: string[] = [];
                          if (selectedOrder.shippingInfo?.addressLine1) parts.push(selectedOrder.shippingInfo.addressLine1);
                          if (selectedOrder.shippingInfo?.addressLine2) parts.push(selectedOrder.shippingInfo.addressLine2);
                          if (selectedOrder.shippingInfo?.city) parts.push(selectedOrder.shippingInfo.city);
                          if (selectedOrder.shippingInfo?.state) parts.push(selectedOrder.shippingInfo.state);
                          if (selectedOrder.shippingInfo?.postalCode) parts.push(selectedOrder.shippingInfo.postalCode);
                          return parts.length > 0 ? parts.join(', ') : '—';
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden mb-4">
                  <div className="grid grid-cols-12 gap-2 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                    <div className="col-span-1" />
                    <div className="col-span-6">Product</div>
                    <div className="col-span-2 text-center">Qty</div>
                    <div className="col-span-3 text-right">Price</div>
                  </div>
                  <div className="divide-y">
                    {Array.isArray(selectedOrder.items) && selectedOrder.items.length > 0 ? (
                      selectedOrder.items.map((it, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center px-3 py-3">
                          <div className="col-span-1 flex items-center">
                            <input type="checkbox" className="h-4 w-4 text-teal-600 border-gray-300 rounded" />
                          </div>
                          <div className="col-span-6 flex items-start gap-3 min-w-0">
                            {/* Optional thumbnail for better UX */}
                            {(it as any).image || it.imageUrl ? (
                              <img src={(it as any).image || it.imageUrl!} alt={it.name} className="w-10 h-10 rounded-md object-cover border border-gray-200 flex-shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] text-gray-400">No Image</div>
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">{it.name || 'Unnamed product'}</div>
                              <div className="text-[11px] text-gray-500 truncate mt-0.5">
                                {it.sku ? `SKU: ${it.sku}` : (it as any).variation ? `Variant: ${(it as any).variation}` : it.productId ? `Product: ${it.productId}` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="col-span-2 text-center text-sm text-gray-700">{it.quantity}</div>
                          <div className="col-span-3 text-right text-sm text-gray-900">{typeof it.price !== 'undefined' ? `${selectedOrder.currency || 'PHP'} ${it.price}` : ''}</div>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-sm text-gray-600">{selectedOrder.itemsBrief || `${selectedOrder.orderCount} item(s)`}</div>
                    )}
                  </div>
                </div>

                {/* Total Amount - removed Package section */}
                <div className="flex justify-end">
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Total Amount</div>
                    <div className="text-lg font-semibold">{selectedOrder.currency || 'PHP'} {selectedOrder.total != null ? selectedOrder.total : ''}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default OrderTab;
