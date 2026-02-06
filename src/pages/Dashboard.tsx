import { useState, useEffect, useMemo, useRef } from "react";
import { getDoc, doc } from 'firebase/firestore';

// EmployeeName now uses a provided sellerUidToName map for lookup, no per-row Firestore fetch
interface EmployeeNameProps {
  handledBy: string;
  sellerUidToName: Record<string, string>;
}
const EmployeeName = ({ handledBy, sellerUidToName }: EmployeeNameProps) => {
  // Synchronous lookup from map, fallback to handledBy
  const name = sellerUidToName[handledBy] || handledBy;
  return <span>{name}</span>;
};
import Sidebar from "@/components/dashboard/Sidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RevenueChart from "@/components/dashboard/RevenueChart";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import Booking from "@/pages/Booking";
import ConfirmationTab from "@/components/confirmation/ConfirmationTab";
import WithdrawalTab from "@/components/withdrawal/WithdrawalTab";
import SellerWithdrawalTab from "@/components/withdrawal/SellerWithdrawalTab";
import AccessTab from "@/components/access/AccessTab";
import ImagesTab from "@/components/images/ImagesTab";
import UsersTab from "@/components/users/UsersTab";
import OrderTab from '@/components/orders/SellerOrdersTab';
import InventoryTab from '@/components/inventory/InventoryTab';
import ProductQCTab from '@/components/admin/ProductQCTab';
import PoliciesTab from '@/components/policies/PoliciesTab';
import ChatsTab from '@/components/chats/ChatsTab';
import { ItemsTab, ItemsAll, ItemsList } from '@/components/items';
import AddItem from '@/components/items/AddItem';
import ItemsView from '@/components/items/ItemsView';
import { Order } from "@/types/order";
import { DollarSign, Users, ShoppingCart, TrendingUp, Filter, Download, ChevronDown, ChevronRight, ClipboardList, CreditCard } from "lucide-react";
// Add permission-aware auth hook
import { useAuth } from "@/hooks/use-auth";
import SellerProfileTab from '@/components/profile/SellerProfileTab';
import ReportsTab from '@/components/reports/ReportsTab';
import OrdersService from '@/services/orders';
//import NotificationsTab from '@/components/notifications/NotificationsTab';
import { useLocation, useNavigate } from 'react-router-dom';
import WarrantyManager from '@/pages/admin/WarrantyManager';
import CategoryManager from '@/pages/admin/CategoryManager';
import { getProvinces as getPhProvinces, getCitiesByProvince as getPhCities, getCitiesByProvinceAsync as getPhCitiesAsync } from '../lib/phLocations';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

interface DashboardProps {
  user: { name?: string; email: string };
  onLogout: () => void;
}

// Lazy address API loader (provinces & cities only)
let _addressApiCache: any | null = null;
const getAddressApi = async () => {
  if (_addressApiCache) return _addressApiCache;
  const mod: any = await import('select-philippines-address');
  const api = {
    regions: mod.regions || mod.default?.regions,
    provinces: mod.provinces || mod.default?.provinces,
    cities: mod.cities || mod.default?.cities,
    barangays: mod.barangays || mod.default?.barangays,
  };
  if (!api.regions || !api.provinces || !api.cities) {
    throw new Error('select-philippines-address API not available');
  }
  _addressApiCache = api;
  return api as {
    regions: () => Promise<any[]>;
    provinces: (regionCode: string) => Promise<any[]>;
    cities: (provinceCode: string) => Promise<any[]>;
  };
};

const Dashboard = ({ user, onLogout }: DashboardProps) => {
  const [activeItem, setActiveItem] = useState("dashboard");
  const { hasPermission, loading: authLoading } = useAuth();
  const { isAdmin } = useAuth();
  const { uid, isSubAccount, parentId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  
  // New: seller dashboard UI state
  const [showTutorial, setShowTutorial] = useState(false);
  const [sellerFilters, setSellerFilters] = useState({ dateRange: 'last-30', brand: 'all', subcategory: 'all', location: 'all', paymentType: 'all', viewType: 'summary', viewExpanded: false });
  const [itemChartType, setItemChartType] = useState<'line' | 'bar' | 'pie'>('bar');
  // Receipt detail side panel state
  const [receiptDetailOpen, setReceiptDetailOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Order | null>(null);
  
  // Handler for sidebar navigation with dashboard sub-items
  const handleItemClick = (itemId: string) => {
    // Handle dashboard sub-items
    if (itemId.startsWith('dashboard-')) {
      setActiveItem('dashboard');
      const viewTypeMap: Record<string, string> = {
        'dashboard-summary': 'summary',
        'dashboard-item': 'item',
        'dashboard-category': 'category',
        'dashboard-payment': 'paymentType',
        'dashboard-receipts': 'receipts'
      };
      setSellerFilters(f => ({ ...f, viewType: viewTypeMap[itemId] || 'summary' }));
    } else {
      setActiveItem(itemId);
    }
  };
  
  // Admin filters (date picker range, province, city, seller/shop name)
  const [adminFilters, setAdminFilters] = useState<{ dateFrom: string; dateTo: string; province: string; city: string; seller: string }>({ dateFrom: '', dateTo: '', province: 'all', city: 'all', seller: 'all' });
  // Date range picker state (moved back after refactor)
  const [adminCalendarMonth, setAdminCalendarMonth] = useState<Date>(new Date());
  const [adminRange, setAdminRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [showAdminDatePicker, setShowAdminDatePicker] = useState(false);
  const adminDateDropdownRef = useRef<HTMLDivElement | null>(null);
  // Dynamic province & city lists (Philippines)
  const [phProvinces, setPhProvinces] = useState<Array<{ code: string; name: string }>>([]);
  const [phCities, setPhCities] = useState<Array<{ code: string; name: string; provinceCode: string }>>([]);
  // Admin sellers list for filtering & export table
  const [adminSellers, setAdminSellers] = useState<Array<{ uid: string; name?: string; shopName?: string; storeName?: string; province?: string; city?: string; zipCode?: string; address?: any }>>([]);
    // Fetch all Seller documents for Employee name mapping (for both admin and sellers)
    useEffect(() => {
      async function fetchSellers() {
        try {
          const snapshot = await getDocs(collection(db, 'Seller'));
          const sellers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
          setAdminSellers(sellers);
        } catch (err) {
          console.error('Failed to fetch sellers:', err);
        }
      }
      fetchSellers();
    }, []);

    // Dedicated sellerNameMap state for employee name lookup (for all roles)
    const [sellerNameMap, setSellerNameMap] = useState<Record<string, string>>({});
    useEffect(() => {
      // Build name map from adminSellers for both admin and non-admin users
      const map: Record<string, string> = {};
      adminSellers.forEach(s => {
        map[s.uid] = s.name || s.shopName || s.storeName || s.uid;
      });
      setSellerNameMap(map);
    }, [adminSellers]);

    // Use sellerNameMap for all lookups
    const sellerUidToName = sellerNameMap;
  // Admin metrics from Firebase (orders)
  const [adminMetrics, setAdminMetrics] = useState<{ totalOrders: number; deliveredOrders: number; shippedOrders: number }>({ totalOrders: 0, deliveredOrders: 0, shippedOrders: 0 });
  // Admin city selection: allow multi-select via checkboxes when a province is chosen
  const [adminSelectedCityCodes, setAdminSelectedCityCodes] = useState<Set<string>>(new Set());
  // Admin City dropdown popover state
  const adminCityDropdownRef = useRef<HTMLDivElement | null>(null);
  const [showAdminCityDropdown, setShowAdminCityDropdown] = useState(false);
  // Export table column visibility state (admin)
  const [exportColumnVisibility, setExportColumnVisibility] = useState<Record<string, boolean>>({
    seller: true,
    gross: true,
    avg: true,
    tx: true,
    logistic: true,
    payment: true,
    inquiry: true,
    orderSummary: true, 
  });
  const columnLabels: Record<string, string> = {
    seller: 'Seller Store',
    gross: 'Gross Sale',
    avg: 'Average Order',
    tx: 'Total Transaction',
    logistic: 'Logistic Fee',
    payment: 'Payment Fee',
    inquiry: 'Platform Fee',
    orderSummary: 'Order Summary', 
  };
  const visibleColumnKeys = Object.keys(exportColumnVisibility).filter(k => exportColumnVisibility[k]);
  const [showExportColumnMenu, setShowExportColumnMenu] = useState(false);
  const exportColumnMenuRef = useRef<HTMLDivElement | null>(null);
  // Export dropdown state
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  // Order Summary Modal state
  const [showOrderSummaryModal, setShowOrderSummaryModal] = useState(false);
  const [selectedSellerForOrders, setSelectedSellerForOrders] = useState<{ uid: string; name: string } | null>(null);
  const [sellerOrders, setSellerOrders] = useState<Order[]>([]);
  // Track which orders have expanded item details
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!showExportColumnMenu) return;
    const handler = (e: MouseEvent) => {
      if (!exportColumnMenuRef.current) return;
      if (!exportColumnMenuRef.current.contains(e.target as Node)) setShowExportColumnMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportColumnMenu]);
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);
  const toISO = (d: Date | null) => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10) : '';
  const daysInMonth = (month: Date) => new Date(month.getFullYear(), month.getMonth()+1, 0).getDate();
  const firstWeekday = (month: Date) => new Date(month.getFullYear(), month.getMonth(), 1).getDay(); // 0=Sun
  const isInRange = (day: Date) => {
    const { start, end } = adminRange;
    if (!start) return false;
    if (start && !end) return day.getTime() === start.getTime();
    if (start && end) return day >= start && day <= end;
    return false;
  };
  const handleDayClick = (day: Date) => {
    setAdminRange(prev => {
      if (!prev.start || (prev.start && prev.end)) return { start: day, end: null };
      if (day < prev.start) return { start: day, end: prev.start };
      return { start: prev.start, end: day };
    });
  };
  const applyRange = () => {
    setAdminFilters(f => ({ ...f, dateFrom: toISO(adminRange.start), dateTo: toISO(adminRange.end || adminRange.start) }));
  };
  const applyPreset = (preset: 'today' | '7' | '30') => {
    const today = new Date();
    const end = today;
    let start = today;
    if (preset === '7') start = new Date(today.getTime() - 6*86400000);
    if (preset === '30') start = new Date(today.getTime() - 29*86400000);
    setAdminRange({ start, end });
    setAdminCalendarMonth(new Date(end.getFullYear(), end.getMonth(), 1));
    setAdminFilters(f => ({ ...f, dateFrom: toISO(start), dateTo: toISO(end) }));
  };

  const [confirmationOrders, setConfirmationOrders] = useState<Order[]>([
    {
      id: "DP-2024-005",
      orderCount: 3,
      barcode: "2345678901",
      timestamp: "2024-09-09T08:30:00Z",
      customer: { name: "Perfect Smile Dental", contact: "+63 917 123 4567" },
      package: { size: "medium" as const, dimensions: "15cm × 10cm × 8cm", weight: "0.7kg" },
      priority: "urgent" as const,
      status: "processing" as const
    },
    {
      id: "DP-2024-006",
      orderCount: 1,
      barcode: "3456789012",
      timestamp: "2024-09-09T09:15:00Z",
      customer: { name: "Bright Teeth Clinic", contact: "+63 917 234 5678" },
      package: { size: "small" as const, dimensions: "10cm × 8cm × 5cm", weight: "0.3kg" },
      priority: "priority" as const,
      status: "processing" as const
    }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productOptions = useMemo(() => {
    return Array.from(
      new Set(
        (confirmationOrders || [])
          .flatMap(o => (o.items || []).map(it => (it.name || '').trim()).filter(Boolean))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [confirmationOrders]);

  const subcategoryOptions = useMemo(() => {
    return Array.from(
      new Set(
        (confirmationOrders || [])
          .flatMap(o => (o.items || []).map(it => (it.subcategory || '').trim()).filter(Boolean))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [confirmationOrders]);

  const paymentTypeOptions = useMemo(() => {
    return Array.from(
      new Set(
        (confirmationOrders || [])
          .map(o => (o.paymentType || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [confirmationOrders]);

  const isPaidStatus = (s: Order['status']) => ['to_ship','processing','completed','shipping'].includes(s);
  const isWithdrawableStatus = (s: Order['status']) => s === 'completed'; // Only completed orders are eligible for withdrawal
  const getAmount = (o: Order) => typeof o.total === 'number' ? o.total : ((o.items || []).reduce((s, it) => s + ((it.price || 0) * (it.quantity || 0)), 0) || 0);

  const filteredOrders = useMemo(() => {
    const parseDate = (s?: string) => {
      if (!s) return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    const withinLastDays = (s?: string, key?: string) => {
      if (!s) return false;
      const d = parseDate(s);
      if (!d) return false;
      
      if (key && key.startsWith('custom:')) {
        const parts = key.split(':');
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
      let days = 30;
      switch (key) {
        case 'last-7': days = 7; break;
        case 'last-30': days = 30; break;
        case 'last-90': days = 90; break;
        case 'last-365': days = 365; break;
        default: days = 30;
      }
      const from = new Date(today.getTime() - (days - 1) * 86400000);
      return d >= from && d <= new Date(today.getTime() + 86399999);
    };

    const { dateRange, brand, subcategory, paymentType } = sellerFilters;

    return (confirmationOrders || []).filter(o => {
      if (!withinLastDays(o.timestamp, dateRange)) return false;
      if (paymentType !== 'all' && (String(o.paymentType || '').trim()) !== paymentType) return false;
      const items = o.items || [];
      const matchProduct = brand === 'all' || items.some(it => String(it.name || '') === brand);
      const matchSubcat = subcategory === 'all' || items.some(it => String(it.subcategory || '') === subcategory);
      if (!matchProduct || !matchSubcat) return false;
      // TODO: implement location filter when region data is standardized
      return true;
    });
  }, [confirmationOrders, sellerFilters]);

  const paidOrders = useMemo(() => filteredOrders.filter(o => isPaidStatus(o.status)), [filteredOrders]);

  const kpiMetrics = useMemo(() => {
    const receipts = paidOrders.length;
    const totalRevenue = paidOrders.reduce((s, o) => s + (Number(o.summary?.subtotal) || 0), 0);
    const avgSalePerTxn = receipts ? (totalRevenue / receipts) : 0;
    const logisticsDue = paidOrders.reduce((s, o) => s + (Number(o.shipping || 0) + Number(o.fees || 0)), 0);

    const toMs = (s?: string) => {
      if (!s) return undefined;
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : undefined;
    };
    const packDurations: number[] = [];
    const handoverDurations: number[] = [];
    paidOrders.forEach(o => {
      const created = toMs(o.createdAt || o.timestamp);
      const packed = toMs(o.packedAt);
      const handover = toMs(o.handoverAt);
      if (created != null && packed != null && packed >= created) packDurations.push((packed - created) / 60000);
      if (created != null && handover != null && handover >= created) handoverDurations.push((handover - created) / 60000);
    });
    const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : undefined;
    const avgPackMins = avg(packDurations) ?? 80;
    const avgHandoverMins = avg(handoverDurations) ?? 165;

    return { receipts, totalRevenue, avgSalePerTxn, logisticsDue, avgPackMins, avgHandoverMins };
  }, [paidOrders]);

  const financialMetrics = useMemo(() => {
    if (!confirmationOrders || confirmationOrders.length === 0) {
      return {
        totalPaymentProcessingFee: 0,
        totalPlatformFee: 0,
        totalShippingCharge: 0,
        totalNetPayout: 0,
        totalGross: 0,
      };
    }

    const parseDate = (s?: string) => {
      if (!s) return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    
    const withinLastDays = (s?: string, key?: string) => {
      if (!s) return false;
      const d = parseDate(s);
      if (!d) return false;
      
      if (key && key.startsWith('custom:')) {
        const parts = key.split(':');
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
      let days = 30;
      switch (key) {
        case 'today': 
          // For today, check if the date is within today's boundaries
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
          const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
          return d >= todayStart && d <= todayEnd;
        case 'last-7': days = 7; break;
        case 'last-30': days = 30; break;
        case 'last-90': days = 90; break;
        case 'last-365': days = 365; break;
        default: days = 30;
      }
      const from = new Date(today.getTime() - (days - 1) * 86400000);
      return d >= from && d <= new Date(today.getTime() + 86399999);
    };

    let totalPaymentProcessingFee = 0;
    let totalPlatformFee = 0;
    let totalShippingCharge = 0;
    let totalNetPayout = 0;
    let totalGross = 0;
    let matchedOrders = 0;

    confirmationOrders.forEach((order: any) => {
      // Only count completed orders for withdrawal metrics
      if (!isWithdrawableStatus(order.status)) {
        return;
      }

      if (!withinLastDays(order.timestamp, sellerFilters.dateRange)) {
        return;
      }

      const summary = order.summary || {};
      const subtotal = Number(summary.subtotal || 0);
      
      if (subtotal > 0) {
        totalGross += subtotal;
        matchedOrders++;
        
        const feesData = order.feesBreakdown || {};
        totalPaymentProcessingFee += Number(feesData.paymentProcessingFee || 0);
        totalPlatformFee += Number(feesData.platformFee || 0);
        
        totalShippingCharge += Number(summary.sellerShippingCharge || 0);
        
        const payout = order.payout || {};
        totalNetPayout += Number(payout.netPayoutToSeller || 0);
      }
    });

    console.log('[Dashboard] Financial metrics calculated (completed orders only):', {
      totalGross,
      totalNetPayout,
      totalPaymentProcessingFee,
      totalPlatformFee,
      totalShippingCharge,
      matchedOrders,
      totalOrders: confirmationOrders.length,
      dateRange: sellerFilters.dateRange,
    });

    return {
      totalPaymentProcessingFee,
      totalPlatformFee,
      totalShippingCharge,
      totalNetPayout,
      totalGross,
    };
  }, [confirmationOrders, sellerFilters.dateRange]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab) setActiveItem(tab);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const tab = params.get('tab');
      if (tab && tab !== activeItem) setActiveItem(tab);
    } catch {}
  }, [location.search]);


  const lastSyncedTab = useRef<string | null>(null);
  useEffect(() => {
    try {
      if (!activeItem) return;
      const params = new URLSearchParams(location.search);
      const current = params.get('tab');
      if (current !== activeItem && lastSyncedTab.current !== activeItem) {
        lastSyncedTab.current = activeItem;
        params.set('tab', activeItem);
        navigate({ pathname: location.pathname || '/', search: params.toString() }, { replace: true });
      }
    } catch {}
  }, [activeItem, location.pathname, location.search, navigate]);

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail?.tab && typeof detail.tab === 'string') {
        setActiveItem(detail.tab);
      }
    };
    window.addEventListener('dentpal:navigate' as any, onNavigate as any);
    return () => window.removeEventListener('dentpal:navigate' as any, onNavigate as any);
  }, []);

  const permissionByMenuId: Record<string, keyof ReturnType<typeof useAuth>["permissions"] | 'dashboard'> = {
    dashboard: "dashboard",
    profile: "dashboard",
    reports: "reports", // fixed: use reports permission
    booking: "bookings",
    confirmation: "confirmation",
    withdrawal: "withdrawal",
    access: "access",
    'sub-accounts': 'dashboard',
    images: "images",
    users: "users",
    'seller-orders': 'seller-orders',
    inventory: 'inventory',
    'inventory-all': 'inventory',
    'inventory-history': 'inventory',
    'stock-adjustment': 'inventory',
    'item-management': 'inventory',
    'add-product': 'add-product',
   // notifications: 'dashboard',
    'product-qc': 'product-qc',
    'warranty': 'warranty',
    'categories': 'categories',
    chats: 'chats',
    policies: 'policies',
  } as any;

  const isAllowed = (itemId: string) => {
    if (itemId === 'profile' && isAdmin) return false;
    return hasPermission((permissionByMenuId[itemId] || 'dashboard') as any);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!isAllowed(activeItem)) {
      const order = [
        "dashboard",
        "profile",
        "reports",
        "booking",
        "seller-orders",
        "inventory",
        "product-qc",
        "confirmation",
        "withdrawal",
        "access",
        "images",
        "users",
      ];
      const firstAllowed = order.find((id) => isAllowed(id));
      if (firstAllowed) setActiveItem(firstAllowed);
    }
  }, [authLoading, activeItem]);

  const handleConfirmOrder = async (orderId: string) => {
    setLoading(true);
    try {
      // TODO: API call to confirm order
      console.log(`Confirming order ${orderId}`);
      setConfirmationOrders(prev => prev.filter(order => order.id !== orderId));
      setError(null);
    } catch (err) {
      setError("Failed to confirm order. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRejectOrder = async (orderId: string) => {
    setLoading(true);
    try {
      // TODO: API call to reject order
      console.log(`Rejecting order ${orderId}`);
      setConfirmationOrders(prev => prev.filter(order => order.id !== orderId));
      setError(null);
    } catch (err) {
      setError("Failed to reject order. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportConfirmations = async (format: string) => {
    setLoading(true);
    try {
      // TODO: API call to export confirmations
      console.log(`Exporting confirmations as ${format}`);
      setError(null);
    } catch (err) {
      setError("Failed to export confirmations. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveItem(tab);
  };

  const handleApproveWithdrawal = async (withdrawalId: string) => {
    setLoading(true);
    try {
      // TODO: API call to approve withdrawal and initiate bank transfer
      console.log(`Approving withdrawal ${withdrawalId}`);
      setError(null);
    } catch (err) {
      setError("Failed to approve withdrawal. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRejectWithdrawal = async (withdrawalId: string) => {
    setLoading(true);
    try {
      // TODO: API call to reject withdrawal
      console.log(`Rejecting withdrawal ${withdrawalId}`);
      setError(null);
    } catch (err) {
      setError("Failed to reject withdrawal. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportWithdrawals = async (format: string) => {
    setLoading(true);
    try {
      // TODO: API call to export withdrawals
      console.log(`Exporting withdrawals as ${format}`);
      setError(null);
    } catch (err) {
      setError("Failed to export withdrawals. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (userData: any) => {
    setLoading(true);
    try {
      // TODO: API call to create user
      console.log(`Creating user:`, userData);
      setError(null);
    } catch (err) {
      setError("Failed to create user. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (userId: string, userData: any) => {
    setLoading(true);
    try {
      // TODO: API call to update user
      console.log(`Updating user ${userId}:`, userData);
      setError(null);
    } catch (err) {
      setError("Failed to update user. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setLoading(true);
    try {
      // TODO: API call to delete user
      console.log(`Deleting user ${userId}`);
      setError(null);
    } catch (err) {
      setError("Failed to delete user. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadImages = async (files: File[], category: string) => {
    setLoading(true);
    try {
      // TODO: API call to upload images
      console.log(`Uploading ${files.length} images to ${category} category`);
      setError(null);
    } catch (err) {
      setError("Failed to upload images. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    setLoading(true);
    try {
      // TODO: API call to delete image
      console.log(`Deleting image ${imageId}`);
      setError(null);
    } catch (err) {
      setError("Failed to delete image. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Handlers for users management actions
  const handleResetRewardPoints = async (userId: string) => {
    setLoading(true);
    try {
      // TODO: API call to reset user reward points
      console.log(`Resetting reward points for user ${userId}`);
      setError(null);
    } catch (err) {
      setError("Failed to reset reward points. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmationAdminPassword = async (userId: string) => {
    setLoading(true);
    try {
      // TODO: API call for admin password confirmation before user suspension
      console.log(`Admin password confirmation for user ${userId}`);
      setError(null);
    } catch (err) {
      setError("Failed to confirm admin password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleExportUsers = async (format: 'csv' | 'pdf' | 'excel') => {
    setLoading(true);
    try {
      // TODO: API call to export users data
      console.log(`Exporting users as ${format.toUpperCase()}`);
      setError(null);
    } catch (err) {
      setError("Failed to export users data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const exportAllItemsCSV = () => {
    try {
      console.log('[exportAllItemsCSV] Starting export with', paidOrders.length, 'paid orders');
      
      const itemMap = new Map<string, {
        name: string;
        sold: number;
        refunded: number;
        grossSales: number;
        refunds: number;
        paymentFee: number;
        shippingFee: number;
        platformFee: number;
        netPayout: number;
      }>();

      paidOrders.forEach((order, idx) => {
        const items = order.items || [];
        const summary = order.summary || {};
        const fees = order.feesBreakdown || {};
        
        const orderSubtotal = Number(summary.subtotal) || 0;
        const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
        const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
        const orderPlatformFee = Number(fees.platformFee) || 0;

        // Debug: log first order
        if (idx === 0) {
          console.log('[exportAllItemsCSV] First order data:', {
            orderId: order.id,
            summary,
            fees,
            orderSubtotal,
            orderPaymentFee,
            orderShippingFee,
            orderPlatformFee,
            itemsCount: items.length,
            sampleItem: items[0]
          });
        }

        items.forEach((item: any) => {
          const itemName = item.productName || item.name || 'Unknown Item';
          const quantity = Number(item.quantity) || 0;
          const price = Number(item.price) || 0;
          const itemSubtotal = Number(item.subtotal) || (price * quantity);
          
          const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
          const itemPaymentFee = orderPaymentFee * feeRatio;
          const itemShippingFee = orderShippingFee * feeRatio;
          const itemPlatformFee = orderPlatformFee * feeRatio;
          const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

          const existing = itemMap.get(itemName) || {
            name: itemName,
            sold: 0,
            refunded: 0,
            grossSales: 0,
            refunds: 0,
            paymentFee: 0,
            shippingFee: 0,
            platformFee: 0,
            netPayout: 0
          };

          itemMap.set(itemName, {
            name: itemName,
            sold: existing.sold + quantity,
            refunded: existing.refunded,
            grossSales: existing.grossSales + itemSubtotal,
            refunds: existing.refunds,
            paymentFee: existing.paymentFee + itemPaymentFee,
            shippingFee: existing.shippingFee + itemShippingFee,
            platformFee: existing.platformFee + itemPlatformFee,
            netPayout: existing.netPayout + itemNetPayout
          });
        });
      });

      const allItems = Array.from(itemMap.values())
        .sort((a, b) => b.netPayout - a.netPayout);

      const headers = [
        'Item Name',
        'Items Sold',
        'Items Refunded',
        'Gross Sales',
        'Refunds',
        'Payment Fee',
        'Shipping Fee',
        'Platform Fee',
        'Net Payout'
      ];

      const rows = allItems.map(item => [
        `"${item.name}"`,
        item.sold,
        item.refunded,
        (Math.floor(item.grossSales * 100) / 100).toFixed(2),
        (Math.floor(item.refunds * 100) / 100).toFixed(2),
        (Math.floor(item.paymentFee * 100) / 100).toFixed(2),
        (Math.floor(item.shippingFee * 100) / 100).toFixed(2),
        (Math.floor(item.platformFee * 100) / 100).toFixed(2),
        (Math.floor(item.netPayout * 100) / 100).toFixed(2)
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `all-items-${new Date().toISOString().slice(0,10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('CSV export failed:', err);
      setError('Failed to export all items CSV. Please try again.');
    }
  };

  const exportSellerMetricsCSV = () => {
    try {
      const headers = visibleColumnKeys.map(k => columnLabels[k]);
      const rows = adminSellersDisplayed.map(s => {
        const sellerOrders = confirmationOrders.filter(o => {
          const orderSellerIds = o.sellerIds || [];
          if (!orderSellerIds.includes(s.uid)) return false;
          
          if (adminFilters.dateFrom && adminFilters.dateTo) {
            const orderDate = o.timestamp ? o.timestamp.slice(0, 10) : '';
            if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) return false;
          }
          
          if (adminFilters.province !== 'all') {
            if (!o.region || !o.region.province) {
              return false;
            }
            const orderProvinceCode = o.region.province;
            if (orderProvinceCode !== adminFilters.province) return false;
          }
          
          if (adminSelectedCityCodes.size > 0) {
            if (!o.region || !o.region.municipality) {
              return false;
            }
            const orderCity = o.region.municipality;
            const matchingCity = phCities.find(c => c.name === orderCity);
            if (!matchingCity || !adminSelectedCityCodes.has(matchingCity.code)) return false;
          }
          
          if (!isPaidStatus(o.status)) return false;
          return true;
        });
        const gross = sellerOrders.reduce((sum, o) => sum + (Number(o.summary?.subtotal) || 0), 0);
        const tx = sellerOrders.length;
        const avgOrder = tx > 0 ? gross / tx : 0;
        const logistic = sellerOrders.reduce((sum, o) => sum + (Number(o.summary?.sellerShippingCharge) || 0), 0);
        const payment = sellerOrders.reduce((sum, o) => sum + (Number(o.feesBreakdown?.paymentProcessingFee) || 0), 0);
        const inquiry = sellerOrders.reduce((sum, o) => sum + (Number(o.feesBreakdown?.platformFee) || 0), 0);
        const cellByKey: Record<string, any> = {
          seller: s.storeName || s.shopName || s.name || s.uid,
          gross: gross,
          avg: avgOrder,
          tx: tx,
          logistic: logistic,
          payment: payment,
          inquiry: inquiry,
        };
        return visibleColumnKeys.map(k => cellByKey[k]);
      });

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `seller-metrics-${new Date().toISOString().slice(0,10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setShowExportMenu(false);
    } catch (err) {
      console.error('CSV export failed:', err);
      setError('Failed to export CSV. Please try again.');
    }
  };

  const exportSellerMetricsPDF = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      
      const doc = new jsPDF();
      
      doc.setFontSize(16);
      doc.text('Seller Metrics Report', 14, 15);
      
      doc.setFontSize(10);
      const dateText = adminFilters.dateFrom 
        ? `Period: ${adminFilters.dateFrom} to ${adminFilters.dateTo}`
        : 'All time';
      doc.text(dateText, 14, 22);

      const headers = visibleColumnKeys.map(k => columnLabels[k]);
      const rows = adminSellersDisplayed.map(s => {
        const sellerOrders = confirmationOrders.filter(o => {
          const orderSellerIds = o.sellerIds || [];
          if (!orderSellerIds.includes(s.uid)) return false;
          
          if (adminFilters.dateFrom && adminFilters.dateTo) {
            const orderDate = o.timestamp ? o.timestamp.slice(0, 10) : '';
            if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) return false;
          }
          
          if (adminFilters.province !== 'all') {
            if (o.region && o.region.province) {
              const orderProvinceCode = o.region.province;
              if (orderProvinceCode !== adminFilters.province) return false;
            }
          }
          
          if (adminSelectedCityCodes.size > 0) {
            if (o.region && o.region.municipality) {
              const orderCity = o.region.municipality;
              const matchingCity = phCities.find(c => c.name === orderCity);
              if (!matchingCity || !adminSelectedCityCodes.has(matchingCity.code)) return false;
            }
          }
          
          if (!isPaidStatus(o.status)) return false;
          return true;
        });
        const gross = sellerOrders.reduce((sum, o) => sum + (Number(o.summary?.subtotal) || 0), 0);
        const tx = sellerOrders.length;
        const avgOrder = tx > 0 ? gross / tx : 0;
        const logistic = sellerOrders.reduce((sum, o) => sum + (Number(o.summary?.sellerShippingCharge) || 0), 0);
        const payment = sellerOrders.reduce((sum, o) => sum + (Number(o.feesBreakdown?.paymentProcessingFee) || 0), 0);
        const inquiry = sellerOrders.reduce((sum, o) => sum + (Number(o.feesBreakdown?.platformFee) || 0), 0);
        const cellByKey: Record<string, any> = {
          seller: s.storeName || s.shopName || s.name || s.uid,
          gross: gross,
          avg: avgOrder,
          tx: tx,
          logistic: logistic,
          payment: payment,
          inquiry: inquiry,
        };
        return visibleColumnKeys.map(k => typeof cellByKey[k] === 'number' ? cellByKey[k].toLocaleString() : cellByKey[k]);
      });

      autoTable(doc, {
        head: [headers],
        body: rows,
        startY: 28,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [13, 148, 136] },
      });

      doc.save(`seller-metrics-${new Date().toISOString().slice(0,10)}.pdf`);
      setShowExportMenu(false);
    } catch (err) {
      console.error('PDF export failed:', err);
      setError('Failed to export PDF. Please try again.');
    }
  };

  const handleOpenOrderSummary = (seller: { uid: string; storeName?: string; shopName?: string; name?: string }) => {
    const sellerName = seller.storeName || seller.shopName || seller.name || seller.uid;
    
    const filteredSellerOrders = confirmationOrders.filter(order => {
      const orderSellerIds = order.sellerIds || [];
      if (!orderSellerIds.includes(seller.uid)) return false;
      
      if (adminFilters.dateFrom && adminFilters.dateTo) {
        const orderDate = order.timestamp ? order.timestamp.slice(0, 10) : '';
        if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) return false;
      }
      
      if (adminFilters.province !== 'all') {
        if (!order.region || !order.region.province) {
          return false;
        }
        const orderProvinceCode = order.region.province;
        if (orderProvinceCode !== adminFilters.province) return false;
      }
      
      if (adminSelectedCityCodes.size > 0) {
        if (!order.region || !order.region.municipality) {
          return false;
        }
        const orderCity = order.region.municipality;
        const matchingCity = phCities.find(c => c.name === orderCity);
        if (!matchingCity || !adminSelectedCityCodes.has(matchingCity.code)) return false;
      }
      
      return true;
    });
    
    setSelectedSellerForOrders({ uid: seller.uid, name: sellerName });
    setSellerOrders(filteredSellerOrders);
    setShowOrderSummaryModal(true);
  };

  console.log("Dashboard component rendered for user:", user);

  const getPageContent = () => {
    switch (activeItem) {
      case "dashboard":
        if (!isAllowed("dashboard")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        // Seller-first dashboard (non-admin)
        if (!isAdmin) {
          const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
          const fmtMins = (mins: number) => { const h = Math.floor(mins / 60); const m = mins % 60; return `${h}h ${m}m`; };
          // Truncate to 2 decimal places without rounding
          const truncate = (num: number) => Math.floor(num * 100) / 100;
          const formatCurrency = (num: number) => currency.format(truncate(num));
          return (
            <div className="space-y-6">
              {/* Title + Tutorial */}
              <div className="flex items-center justify-between">
                {/* <button onClick={() => setShowTutorial(true)} className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 shadow-sm">Tutorial</button> */}
              </div>

              {/* KPI cards - Row 1: Primary Sales Metrics */}
              {/* <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Gross Sales</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">{currency.format(financialMetrics.totalGross)}</div>
                  <div className="mt-1 text-xs text-gray-500">Total subtotal from all orders</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Net Payout</div>
                  <div className="mt-2 text-2xl font-bold text-green-600">{currency.format(financialMetrics.totalNetPayout)}</div>
                  <div className="mt-1 text-xs text-gray-500">After fees & charges</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Number of receipts</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">{kpiMetrics.receipts.toLocaleString()}</div>
                  <div className="mt-1 text-xs text-gray-500">Paid orders</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Average sale per transaction</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">{currency.format(kpiMetrics.avgSalePerTxn)}</div>
                  <div className="mt-1 text-xs text-gray-500">Last {sellerFilters.dateRange.replace('last-','')} days</div>
                </div>
              </div> */}

              {/* KPI cards - Row 2: Fees & Charges */}
              {/* <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Payment Processing Fee</div>
                  <div className="mt-2 text-2xl font-bold text-red-600">{currency.format(financialMetrics.totalPaymentProcessingFee)}</div>
                  <div className="mt-1 text-xs text-gray-500">Total payment gateway fees</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Platform Fee</div>
                  <div className="mt-2 text-2xl font-bold text-red-600">{currency.format(financialMetrics.totalPlatformFee)}</div>
                  <div className="mt-1 text-xs text-gray-500">Total platform commission</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Shipping Charge</div>
                  <div className="mt-2 text-2xl font-bold text-orange-600">{currency.format(financialMetrics.totalShippingCharge)}</div>
                  <div className="mt-1 text-xs text-gray-500">Seller portion of shipping</div>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <div className="text-sm font-medium text-gray-700">Average completion time</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">{`${fmtMins(kpiMetrics.avgPackMins)} / ${fmtMins(kpiMetrics.avgHandoverMins)}`}</div>
                  <div className="mt-1 text-xs text-gray-500">To pack / To handover</div>
                </div>
              </div> */}

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-white-100">
                <div className="text-sm font-semibold text-gray-900 mb-3">Filters</div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:space-x-4 gap-4">
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Select date</label>
                    <div ref={sellerDateDropdownRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowSellerDatePicker(v => !v)}
                        aria-haspopup="dialog"
                        aria-expanded={showSellerDatePicker}
                        className="w-full p-2 border border-gray-200 rounded-lg text-xs bg-white hover:bg-gray-50 flex items-center justify-between"
                      >
                        <span className="truncate pr-2">
                          {sellerRange.start ? `${toISO(sellerRange.start)} → ${toISO(sellerRange.end || sellerRange.start)}` : sellerFilters.dateRange.replace('last-','Last ')}
                        </span>
                        <span className={`text-[11px] transition-transform ${showSellerDatePicker ? 'rotate-180' : ''}`}>⌄</span>
                      </button>
                      {showSellerDatePicker && (
                        <div className="absolute left-0 mt-2 z-30 w-[280px] border border-gray-200 rounded-xl bg-white shadow-xl p-3 space-y-3 animate-fade-in">
                          {/* Presets */}
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => applySellerPreset('today')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Today</button>
                            <button onClick={() => applySellerPreset('7')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Last 7 days</button>
                            <button onClick={() => applySellerPreset('30')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Last 30 days</button>
                            {sellerRange.start && (
                              <span className="text-[10px] text-gray-500 ml-auto">{toISO(sellerRange.start)} → {toISO(sellerRange.end || sellerRange.start)}</span>
                            )}
                          </div>
                          {/* Calendar header */}
                          <div className="flex items-center justify-between">
                            <button type="button" onClick={() => setSellerCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">◀</button>
                            <div className="text-xs font-medium text-gray-700">
                              {sellerCalendarMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                            </div>
                            <button type="button" onClick={() => setSellerCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))} className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100">▶</button>
                          </div>
                          {/* Weekday labels */}
                          <div className="grid grid-cols-7 text-[10px] font-medium text-gray-500">
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
                          </div>
                          {/* Days grid with range highlight */}
                          <div className="grid grid-cols-7 gap-1 text-xs">
                            {Array.from({ length: sellerFirstWeekday(sellerCalendarMonth) }).map((_,i) => <div key={'spacer'+i} />)}
                            {Array.from({ length: sellerDaysInMonth(sellerCalendarMonth) }).map((_,i) => {
                              const day = new Date(sellerCalendarMonth.getFullYear(), sellerCalendarMonth.getMonth(), i+1);
                              const selectedStart = sellerRange.start && day.getTime() === sellerRange.start.getTime();
                              const selectedEnd = sellerRange.end && day.getTime() === sellerRange.end.getTime();
                              const inRange = isSellerInRange(day);
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => handleSellerDayClick(day)}
                                  className={`h-7 rounded-md flex items-center justify-center transition border text-gray-700 ${selectedStart || selectedEnd ? 'bg-teal-600 text-white border-teal-600 font-semibold' : inRange ? 'bg-teal-100 border-teal-200' : 'bg-white border-gray-200 hover:bg-gray-100'} ${day.toDateString() === new Date().toDateString() && !selectedStart && !selectedEnd ? 'ring-1 ring-teal-400' : ''}`}
                                  title={toISO(day)}
                                >{i+1}</button>
                              );
                            })}
                          </div>
                          {/* Actions */}
                          <div className="flex items-center justify-between pt-1">
                            <button type="button" onClick={() => { setSellerRange({ start: null, end: null }); setSellerFilters(f=> ({ ...f, dateRange: 'last-30' })); }} className="text-[11px] px-2 py-1 rounded-md border bg-white hover:bg-gray-100">Clear</button>
                            <div className="flex gap-2">
                              <button type="button" onClick={applySellerRange} disabled={!sellerRange.start} className="text-[11px] px-3 py-1 rounded-md bg-teal-600 text-white disabled:opacity-40">Apply</button>
                              <button type="button" onClick={() => setShowSellerDatePicker(false)} className="text-[11px] px-3 py-1 rounded-md border bg-white hover:bg-gray-100">Done</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Select product</label>
                    <select className="w-full p-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent" value={sellerFilters.brand} onChange={(e)=> setSellerFilters(f=>({ ...f, brand: e.target.value }))}>
                      <option value="all">All products</option>
                      {productOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Select subcategory</label>
                    <select className="w-full p-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent" value={sellerFilters.subcategory} onChange={(e)=> setSellerFilters(f=>({ ...f, subcategory: e.target.value }))}>
                      <option value="all">All subcategories</option>
                      {subcategoryOptions.map(sc => (
                        <option key={sc} value={sc}>{sc}</option>
                      ))}
                    </select>
                  </div> */}
                  <div className="flex items-end gap-2 pt-2">
                    <button className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg shadow-sm transition">Apply</button>
                    <button onClick={()=> setSellerFilters({ dateRange: "last-30", brand: "all", subcategory: "all", location: "all", paymentType: "all", viewType: "summary", viewExpanded: false })} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition">Reset</button>
                  </div>
                </div>
              </div>

              {/* Conditional Content Based on View Type */}
              {sellerFilters.viewType === 'summary' && (
                <>
                  {/* Revenue */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-700">Revenue</h4>
                        <div className="mt-1 text-2xl font-bold text-gray-900">{currency.format(kpiMetrics.totalRevenue)}</div>
                        <div className="text-xs text-gray-500">Sales</div>
                      </div>
                      <div className="hidden md:block text-xs text-gray-500">Date: {sellerFilters.dateRange.replace("last-", "Last ")} days</div>
                    </div>
                    {(() => {
                      const byDate = new Map<string, { amount: number; count: number }>();
                      paidOrders.forEach(o => {
                        const key = o.timestamp.slice(0,10); // YYYY-MM-DD
                        const prev = byDate.get(key) || { amount: 0, count: 0 };
                        byDate.set(key, { amount: prev.amount + (Number(o.summary?.subtotal) || 0), count: prev.count + 1 });
                      });
                      const series = Array.from(byDate.entries())
                        .sort(([a],[b]) => a.localeCompare(b))
                        .map(([date, v]) => {
                          const d = new Date(date);
                          const label = `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}`;
                          return { name: label, revenue: v.amount, count: v.count };
                        });
                      return <RevenueChart data={series} />;
                    })()}
                    <div className="mt-2 text-[11px] text-gray-500">(date)</div>
                  </div>

                  {/* Financial Summary Table 
                  */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100">
                      <h3 className="text-sm font-semibold text-gray-800 tracking-wide">FINANCIAL SUMMARY (PER DATE)</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr className="text-left text-xs font-semibold tracking-wide">
                          <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3 text-right">Gross Sales</th>
                            <th className="px-6 py-3 text-right">Refunds</th>
                            <th className="px-6 py-3 text-right">Payment Fee</th>
                            <th className="px-6 py-3 text-right">Shipping Fee</th>
                            <th className="px-6 py-3 text-right">Platform Fee</th>
                            <th className="px-6 py-3 text-right font-bold">Net Payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const ordersByDate = new Map<string, typeof paidOrders>();
                            const formatDateKey = (date: Date) => {
                              return date.toLocaleDateString('en-US', { 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric' 
                              });
                            };

                            paidOrders.forEach(order => {
                              const orderDate = order.createdAt ? new Date(order.createdAt) : new Date();
                              const dateKey = formatDateKey(orderDate);
                              if (!ordersByDate.has(dateKey)) {
                                ordersByDate.set(dateKey, []);
                              }
                              ordersByDate.get(dateKey)!.push(order);
                            });

                            // Sort dates in descending order
                            const sortedDates = Array.from(ordersByDate.keys()).sort((a, b) => {
                              const dateA = new Date(a);
                              const dateB = new Date(b);
                              return dateB.getTime() - dateA.getTime();
                            });

                            // Calculate totals across all dates
                            let grandTotalGross = 0;
                            let grandTotalPaymentFee = 0;
                            let grandTotalShippingFee = 0;
                            let grandTotalPlatformFee = 0;
                            let grandTotalNetPayout = 0;

                            const rows = sortedDates.map(dateKey => {
                              const dayOrders = ordersByDate.get(dateKey)!;
                              const dayMetrics = dayOrders.reduce((acc, o) => {
                                const summary = o.summary || {};
                                const feesData = o.feesBreakdown || {};
                                
                                const gross = Number(summary.subtotal || 0);
                                const refunds = 0; // Currently no refunds tracked
                                const paymentFee = Number(feesData.paymentProcessingFee || 0);
                                const shippingFee = Number(summary.sellerShippingCharge || 0);
                                const platformFee = Number(feesData.platformFee || 0);
                                // Calculate Net Payout: Gross - Refunds - Payment Fee - Shipping Fee - Platform Fee
                                const netPayout = gross - refunds - paymentFee - shippingFee - platformFee;
                                
                                return {
                                  totalGross: acc.totalGross + gross,
                                  totalPaymentFee: acc.totalPaymentFee + paymentFee,
                                  totalShippingFee: acc.totalShippingFee + shippingFee,
                                  totalPlatformFee: acc.totalPlatformFee + platformFee,
                                  totalNetPayout: acc.totalNetPayout + netPayout
                                };
                              }, {
                                totalGross: 0,
                                totalPaymentFee: 0,
                                totalShippingFee: 0,
                                totalPlatformFee: 0,
                                totalNetPayout: 0
                              });

                              // Add to grand totals
                              grandTotalGross += dayMetrics.totalGross;
                              grandTotalPaymentFee += dayMetrics.totalPaymentFee;
                              grandTotalShippingFee += dayMetrics.totalShippingFee;
                              grandTotalPlatformFee += dayMetrics.totalPlatformFee;
                              grandTotalNetPayout += dayMetrics.totalNetPayout;

                              return (
                                <tr key={dateKey} className="border-t hover:bg-gray-50">
                                  <td className="px-6 py-4 text-gray-700 font-medium text-xs">
                                    {dateKey}
                                  </td>
                                  <td className="px-6 py-4 text-gray-900 text-right font-medium">
                                    {currency.format(dayMetrics.totalGross)}
                                  </td>
                                  <td className="px-6 py-4 text-red-600 text-right font-medium">
                                    {currency.format(0)}
                                  </td>
                                  <td className="px-6 py-4 text-red-600 text-right">
                                    {currency.format(dayMetrics.totalPaymentFee)}
                                  </td>
                                  <td className="px-6 py-4 text-orange-600 text-right">
                                    {currency.format(dayMetrics.totalShippingFee)}
                                  </td>
                                  <td className="px-6 py-4 text-red-600 text-right">
                                    {currency.format(dayMetrics.totalPlatformFee)}
                                  </td>
                                  <td className="px-6 py-4 text-green-600 text-right font-bold">
                                    {formatCurrency(dayMetrics.totalNetPayout)}
                                  </td>
                                </tr>
                              );
                            });

                            // Add total row
                            rows.push(
                              <tr key="total" className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                                <td className="px-6 py-4 text-gray-900 text-xs">
                                  TOTAL
                                </td>
                                <td className="px-6 py-4 text-gray-900 text-right">
                                  {currency.format(grandTotalGross)}
                                </td>
                                <td className="px-6 py-4 text-red-600 text-right">
                                  {currency.format(0)}
                                </td>
                                <td className="px-6 py-4 text-red-600 text-right">
                                  {currency.format(grandTotalPaymentFee)}
                                </td>
                                <td className="px-6 py-4 text-orange-600 text-right">
                                  {currency.format(grandTotalShippingFee)}
                                </td>
                                <td className="px-6 py-4 text-red-600 text-right">
                                  {currency.format(grandTotalPlatformFee)}
                                </td>
                                <td className="px-6 py-4 text-green-600 text-right text-base">
                                  {formatCurrency(grandTotalNetPayout)}
                                </td>
                              </tr>
                            );

                            return rows;
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            Net Payout = Gross Sales - (Payment Fee + Shipping Fee + Platform Fee)
                          </span>
                        </div>
                        <div className="text-gray-500">
                          {(() => {
                            if (sellerRange.start) {
                              return `${toISO(sellerRange.start)} → ${toISO(sellerRange.end || sellerRange.start)}`;
                            } else {
                              return sellerFilters.dateRange.replace('last-', 'Last ') + ' days';
                            }
                          })()} • {paidOrders.length} paid {paidOrders.length === 1 ? 'order' : 'orders'}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* By Item View */}
              {sellerFilters.viewType === 'item' && (
                <>
                  {/* Top 5 Items + Sales Chart */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100">
                      <h3 className="text-sm font-semibold text-gray-800 tracking-wide">TOP 5 ITEMS & SALES BY ITEM</h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {sellerRange.start 
                          ? `${toISO(sellerRange.start)} → ${toISO(sellerRange.end || sellerRange.start)}`
                          : sellerFilters.dateRange.replace('last-', 'Last ') + ' days'
                        }
                      </p>
                    </div>
                    
                    <div className="p-6">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left: Top 5 Items List */}
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-4">Top 5 Items by Net Payout</h4>
                          {(() => {
                            const itemMap = new Map<string, {
                              name: string;
                              netPayout: number;
                            }>();

                            paidOrders.forEach(order => {
                              const items = order.items || [];
                              const summary = order.summary || {};
                              const fees = order.feesBreakdown || {};
                              
                              const orderSubtotal = Number(summary.subtotal) || 0;
                              const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
                              const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
                              const orderPlatformFee = Number(fees.platformFee) || 0;

                              items.forEach((item: any) => {
                                const itemName = item.productName || item.name || 'Unknown Item';
                                const quantity = Number(item.quantity) || 0;
                                const price = Number(item.price) || 0;
                                const itemSubtotal = Number(item.subtotal) || (price * quantity);
                                
                                const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
                                const itemPaymentFee = orderPaymentFee * feeRatio;
                                const itemShippingFee = orderShippingFee * feeRatio;
                                const itemPlatformFee = orderPlatformFee * feeRatio;
                                const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

                                const existing = itemMap.get(itemName) || { name: itemName, netPayout: 0 };
                                itemMap.set(itemName, {
                                  name: itemName,
                                  netPayout: existing.netPayout + itemNetPayout
                                });
                              });
                            });

                            const topItems = Array.from(itemMap.values())
                              .sort((a, b) => b.netPayout - a.netPayout)
                              .slice(0, 5);

                            if (topItems.length === 0) {
                              return (
                                <div className="text-center py-8 text-gray-500">
                                  <div className="text-sm">No items to display</div>
                                  <div className="text-xs mt-1">There are no sales in the selected time period</div>
                                </div>
                              );
                            }

                            return (
                              <div className="space-y-3">
                                {topItems.map((item, idx) => (
                                  <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-teal-300 transition">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-sm">
                                      {idx + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                                      <div className="text-xs text-gray-500 mt-1">Net Payout: <span className="font-semibold text-green-600">{formatCurrency(item.netPayout)}</span></div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Right: Sales Chart with Chart Type Selector */}
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-sm font-medium text-gray-700">TOP 5 ITEMS BY QUANTITY SOLD</h4>
                            <select 
                              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              value={itemChartType}
                              onChange={(e) => setItemChartType(e.target.value as 'line' | 'bar' | 'pie')}
                            >
                              <option value="line">Line Chart</option>
                              <option value="bar">Bar Chart</option>
                              <option value="pie">Pie Chart</option>
                            </select>
                          </div>
                          {(() => {
                            const itemMap = new Map<string, number>();

                            paidOrders.forEach(order => {
                              const items = order.items || [];
                              items.forEach((item: any) => {
                                const itemName = item.productName || item.name || 'Unknown Item';
                                const quantity = Number(item.quantity) || 0;
                                const existing = itemMap.get(itemName) || 0;
                                itemMap.set(itemName, existing + quantity);
                              });
                            });

                            const chartData = Array.from(itemMap.entries())
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 5)
                              .map(([name, quantity]) => ({ name, quantity }));

                            if (chartData.length === 0) {
                              return (
                                <div className="h-64 flex items-center justify-center text-gray-500 border border-gray-200 rounded-lg">
                                  <div className="text-center">
                                    <div className="text-sm">No data to display</div>
                                    <div className="text-xs mt-1">There are no sales in the selected time period</div>
                                  </div>
                                </div>
                              );
                            }

                            const COLORS = ['#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

                            // Line Chart
                            if (itemChartType === 'line') {
                              return (
                                <div className="h-64 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                      <XAxis 
                                        dataKey="name" 
                                        stroke="#9ca3af"
                                        fontSize={11}
                                        angle={-45}
                                        textAnchor="end"
                                        height={80}
                                        interval={0}
                                      />
                                      <YAxis 
                                        stroke="#9ca3af"
                                        fontSize={11}
                                      />
                                      <Tooltip 
                                        contentStyle={{
                                          backgroundColor: "white",
                                          border: "1px solid #e5e7eb",
                                          borderRadius: "8px",
                                          fontSize: "12px",
                                        }}
                                        formatter={(value: any) => [value.toLocaleString() + ' units', 'Quantity Sold']}
                                      />
                                      <Line 
                                        type="monotone" 
                                        dataKey="quantity" 
                                        stroke="#14b8a6" 
                                        strokeWidth={2}
                                        dot={{ fill: '#14b8a6', r: 4 }}
                                        activeDot={{ r: 6 }}
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                              );
                            }

                            // Pie Chart
                            if (itemChartType === 'pie') {
                              return (
                                <div className="h-64 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                      <Pie
                                        data={chartData}
                                        dataKey="quantity"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={90}
                                      >
                                        {chartData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                      </Pie>
                                      <Tooltip 
                                        contentStyle={{
                                          backgroundColor: "white",
                                          border: "1px solid #e5e7eb",
                                          borderRadius: "8px",
                                          fontSize: "12px",
                                          padding: "8px 12px",
                                        }}
                                        formatter={(value: any, name: string) => [value.toLocaleString() + ' units', 'Quantity Sold']}
                                      />
                                      <Legend 
                                        verticalAlign="bottom" 
                                        height={36}
                                        iconType="circle"
                                        iconSize={8}
                                        wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                                      />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </div>
                              );
                            }

                            // Bar Chart (default/original with horizontal bars)
                            return (
                              <div className="h-64 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 100 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                                    <XAxis 
                                      type="number"
                                      stroke="#9ca3af"
                                      fontSize={11}
                                    />
                                    <YAxis 
                                      type="category"
                                      dataKey="name" 
                                      stroke="#9ca3af"
                                      fontSize={11}
                                      width={90}
                                    />
                                    <Tooltip 
                                      contentStyle={{
                                        backgroundColor: "white",
                                        border: "1px solid #e5e7eb",
                                        borderRadius: "8px",
                                        fontSize: "12px",
                                      }}
                                      formatter={(value: any) => [value.toLocaleString() + ' units', 'Quantity Sold']}
                                    />
                                    <Bar 
                                      dataKey="quantity" 
                                      fill="#14b8a6"
                                      radius={[0, 8, 8, 0]}
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Export Table - All Items */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800 tracking-wide">EXPORT - ALL ITEMS</h3>
                      <button 
                        onClick={exportAllItemsCSV}
                        disabled={paidOrders.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr className="text-left text-xs font-semibold tracking-wide">
                            <th className="px-6 py-3">Item Name</th>
                            <th className="px-6 py-3 text-right">Items Sold</th>
                            <th className="px-6 py-3 text-right">Items Refunded</th>
                            <th className="px-6 py-3 text-right">Gross Sales</th>
                            <th className="px-6 py-3 text-right">Refunds</th>
                            <th className="px-6 py-3 text-right">Payment Fee</th>
                            <th className="px-6 py-3 text-right">Shipping Fee</th>
                            <th className="px-6 py-3 text-right">Platform Fee</th>
                            <th className="px-6 py-3 text-right font-bold">Net Payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Aggregate ALL items from paid orders
                            const itemMap = new Map<string, {
                              name: string;
                              sold: number;
                              refunded: number;
                              grossSales: number;
                              refunds: number;
                              paymentFee: number;
                              shippingFee: number;
                              platformFee: number;
                              netPayout: number;
                            }>();

                            paidOrders.forEach(order => {
                              const items = order.items || [];
                              const summary = order.summary || {};
                              const fees = order.feesBreakdown || {};
                              
                              const orderSubtotal = Number(summary.subtotal) || 0;
                              const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
                              const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
                              const orderPlatformFee = Number(fees.platformFee) || 0;

                              // Debug: log first order to check data structure
                              if (items.length > 0 && itemMap.size === 0) {
                                console.log('[EXPORT-ALL-ITEMS] Sample order data:', {
                                  orderId: order.id,
                                  summary,
                                  fees,
                                  orderSubtotal,
                                  orderPaymentFee,
                                  orderShippingFee,
                                  orderPlatformFee,
                                  sampleItem: items[0]
                                });
                                
                                const firstItem = items[0] as any;
                                const qty = Number(firstItem.quantity) || 0;
                                const prc = Number(firstItem.price) || 0;
                                const calculated = prc * qty;
                                console.log('[EXPORT-ALL-ITEMS] First item calculation:', {
                                  name: firstItem.productName || firstItem.name,
                                  price: prc,
                                  quantity: qty,
                                  calculatedSubtotal: calculated,
                                  hasSubtotalField: 'subtotal' in firstItem,
                                  subtotalValue: firstItem.subtotal
                                });
                              }

                              items.forEach((item: any) => {
                                const itemName = item.productName || item.name || 'Unknown Item';
                                const quantity = Number(item.quantity) || 0;
                                const price = Number(item.price) || 0;
                                const itemSubtotal = Number(item.subtotal) || (price * quantity);
                                
                                const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
                                const itemPaymentFee = orderPaymentFee * feeRatio;
                                const itemShippingFee = orderShippingFee * feeRatio;
                                const itemPlatformFee = orderPlatformFee * feeRatio;
                                const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

                                const existing = itemMap.get(itemName) || {
                                  name: itemName,
                                  sold: 0,
                                  refunded: 0,
                                  grossSales: 0,
                                  refunds: 0,
                                  paymentFee: 0,
                                  shippingFee: 0,
                                  platformFee: 0,
                                  netPayout: 0
                                };

                                itemMap.set(itemName, {
                                  name: itemName,
                                  sold: existing.sold + quantity,
                                  refunded: existing.refunded,
                                  grossSales: existing.grossSales + itemSubtotal,
                                  refunds: existing.refunds,
                                  paymentFee: existing.paymentFee + itemPaymentFee,
                                  shippingFee: existing.shippingFee + itemShippingFee,
                                  platformFee: existing.platformFee + itemPlatformFee,
                                  netPayout: existing.netPayout + itemNetPayout
                                });
                              });
                            });

                            const allItems = Array.from(itemMap.values())
                              .sort((a, b) => b.netPayout - a.netPayout);

                            if (allItems.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={9} className="px-6 py-16">
                                    <div className="flex flex-col items-center justify-center text-center text-gray-500">
                                      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                                        <span className="text-xs font-semibold text-gray-400">⌀</span>
                                      </div>
                                      <div className="text-sm font-medium">No items to display</div>
                                      <div className="mt-1 text-xs text-gray-400">There are no sales in the selected time period</div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            return allItems.map((item, idx) => (
                              <tr key={idx} className="border-t hover:bg-gray-50">
                                <td className="px-6 py-4 text-gray-900 font-medium">{item.name}</td>
                                <td className="px-6 py-4 text-gray-700 text-right">{item.sold.toLocaleString()}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{item.refunded.toLocaleString()}</td>
                                <td className="px-6 py-4 text-gray-900 text-right font-medium">{formatCurrency(item.grossSales)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(item.refunds)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(item.paymentFee)}</td>
                                <td className="px-6 py-4 text-orange-600 text-right">{formatCurrency(item.shippingFee)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(item.platformFee)}</td>
                                <td className="px-6 py-4 text-green-600 text-right font-bold text-base">{formatCurrency(item.netPayout)}</td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            Net Payout = Gross Sales - (Payment Fee + Shipping Fee + Platform Fee)
                          </span>
                        </div>
                        <div className="text-gray-500">
                          Based on {paidOrders.length} paid {paidOrders.length === 1 ? 'order' : 'orders'}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* By Category View */}
              {sellerFilters.viewType === 'category' && (
                <>
                  {/* Export Table - All Categories */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800 tracking-wide">SALES BY CATEGORY</h3>
                      <button 
                        onClick={() => {
                          try {
                            console.log('[exportCategoriesCSV] Starting export with', paidOrders.length, 'paid orders');
                            
                            // Aggregate ALL categories from paid orders
                            const categoryMap = new Map<string, {
                              name: string;
                              sold: number;
                              refunded: number;
                              grossSales: number;
                              refunds: number;
                              paymentFee: number;
                              shippingFee: number;
                              platformFee: number;
                              netPayout: number;
                            }>();

                            paidOrders.forEach(order => {
                              const items = order.items || [];
                              const summary = order.summary || {};
                              const fees = order.feesBreakdown || {};
                              
                              const orderSubtotal = Number(summary.subtotal) || 0;
                              const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
                              const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
                              const orderPlatformFee = Number(fees.platformFee) || 0;

                              items.forEach((item: any) => {
                                const categoryName = item.category || 'Uncategorized';
                                const quantity = Number(item.quantity) || 0;
                                const price = Number(item.price) || 0;
                                const itemSubtotal = Number(item.subtotal) || (price * quantity);
                                
                                const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
                                const itemPaymentFee = orderPaymentFee * feeRatio;
                                const itemShippingFee = orderShippingFee * feeRatio;
                                const itemPlatformFee = orderPlatformFee * feeRatio;
                                const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

                                const existing = categoryMap.get(categoryName) || {
                                  name: categoryName,
                                  sold: 0,
                                  refunded: 0,
                                  grossSales: 0,
                                  refunds: 0,
                                  paymentFee: 0,
                                  shippingFee: 0,
                                  platformFee: 0,
                                  netPayout: 0
                                };

                                categoryMap.set(categoryName, {
                                  name: categoryName,
                                  sold: existing.sold + quantity,
                                  refunded: existing.refunded,
                                  grossSales: existing.grossSales + itemSubtotal,
                                  refunds: existing.refunds,
                                  paymentFee: existing.paymentFee + itemPaymentFee,
                                  shippingFee: existing.shippingFee + itemShippingFee,
                                  platformFee: existing.platformFee + itemPlatformFee,
                                  netPayout: existing.netPayout + itemNetPayout
                                });
                              });
                            });

                            const allCategories = Array.from(categoryMap.values())
                              .sort((a, b) => b.netPayout - a.netPayout);

                            const headers = [
                              'Category',
                              'Items Sold',
                              'Items Refunded',
                              'Gross Sales',
                              'Refunds',
                              'Payment Fee',
                              'Shipping Fee',
                              'Platform Fee',
                              'Net Payout'
                            ];

                            const rows = allCategories.map(cat => [
                              `"${cat.name}"`,
                              cat.sold,
                              cat.refunded,
                              (Math.floor(cat.grossSales * 100) / 100).toFixed(2),
                              (Math.floor(cat.refunds * 100) / 100).toFixed(2),
                              (Math.floor(cat.paymentFee * 100) / 100).toFixed(2),
                              (Math.floor(cat.shippingFee * 100) / 100).toFixed(2),
                              (Math.floor(cat.platformFee * 100) / 100).toFixed(2),
                              (Math.floor(cat.netPayout * 100) / 100).toFixed(2)
                            ]);

                            const csvContent = [
                              headers.join(','),
                              ...rows.map(row => row.join(','))
                            ].join('\n');

                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            const url = URL.createObjectURL(blob);
                            link.setAttribute('href', url);
                            link.setAttribute('download', `categories-${new Date().toISOString().slice(0,10)}.csv`);
                            link.style.visibility = 'hidden';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          } catch (err) {
                            console.error('CSV export failed:', err);
                            setError('Failed to export categories CSV. Please try again.');
                          }
                        }}
                        disabled={paidOrders.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr className="text-left text-xs font-semibold tracking-wide">
                            <th className="px-6 py-3">Category</th>
                            <th className="px-6 py-3 text-right">Items Sold</th>
                            <th className="px-6 py-3 text-right">Items Refunded</th>
                            <th className="px-6 py-3 text-right">Gross Sales</th>
                            <th className="px-6 py-3 text-right">Refunds</th>
                            <th className="px-6 py-3 text-right">Payment Fee</th>
                            <th className="px-6 py-3 text-right">Shipping Fee</th>
                            <th className="px-6 py-3 text-right">Platform Fee</th>
                            <th className="px-6 py-3 text-right font-bold">Net Payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Aggregate ALL categories from paid orders
                            const categoryMap = new Map<string, {
                              name: string;
                              sold: number;
                              refunded: number;
                              grossSales: number;
                              refunds: number;
                              paymentFee: number;
                              shippingFee: number;
                              platformFee: number;
                              netPayout: number;
                            }>();

                            paidOrders.forEach(order => {
                              const items = order.items || [];
                              const summary = order.summary || {};
                              const fees = order.feesBreakdown || {};
                              
                              const orderSubtotal = Number(summary.subtotal) || 0;
                              const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
                              const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
                              const orderPlatformFee = Number(fees.platformFee) || 0;

                              items.forEach((item: any) => {
                                const categoryName = item.category || 'Uncategorized';
                                const quantity = Number(item.quantity) || 0;
                                const price = Number(item.price) || 0;
                                // Calculate item subtotal: try item.subtotal first, fallback to price * quantity
                                const itemSubtotal = Number(item.subtotal) || (price * quantity);
                                
                                const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
                                const itemPaymentFee = orderPaymentFee * feeRatio;
                                const itemShippingFee = orderShippingFee * feeRatio;
                                const itemPlatformFee = orderPlatformFee * feeRatio;
                                const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

                                const existing = categoryMap.get(categoryName) || {
                                  name: categoryName,
                                  sold: 0,
                                  refunded: 0,
                                  grossSales: 0,
                                  refunds: 0,
                                  paymentFee: 0,
                                  shippingFee: 0,
                                  platformFee: 0,
                                  netPayout: 0
                                };

                                categoryMap.set(categoryName, {
                                  name: categoryName,
                                  sold: existing.sold + quantity,
                                  refunded: existing.refunded,
                                  grossSales: existing.grossSales + itemSubtotal,
                                  refunds: existing.refunds,
                                  paymentFee: existing.paymentFee + itemPaymentFee,
                                  shippingFee: existing.shippingFee + itemShippingFee,
                                  platformFee: existing.platformFee + itemPlatformFee,
                                  netPayout: existing.netPayout + itemNetPayout
                                });
                              });
                            });

                            // Sort by net payout (descending) - show ALL categories
                            const allCategories = Array.from(categoryMap.values())
                              .sort((a, b) => b.netPayout - a.netPayout);

                            if (allCategories.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={9} className="px-6 py-16">
                                    <div className="flex flex-col items-center justify-center text-center text-gray-500">
                                      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                                        <span className="text-xs font-semibold text-gray-400">⌀</span>
                                      </div>
                                      <div className="text-sm font-medium">No categories to display</div>
                                      <div className="mt-1 text-xs text-gray-400">There are no sales in the selected time period</div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            return allCategories.map((category, idx) => (
                              <tr key={idx} className="border-t hover:bg-gray-50">
                                <td className="px-6 py-4 text-gray-900 font-medium">{category.name}</td>
                                <td className="px-6 py-4 text-gray-700 text-right">{category.sold.toLocaleString()}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{category.refunded.toLocaleString()}</td>
                                <td className="px-6 py-4 text-gray-900 text-right font-medium">{formatCurrency(category.grossSales)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(category.refunds)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(category.paymentFee)}</td>
                                <td className="px-6 py-4 text-orange-600 text-right">{formatCurrency(category.shippingFee)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(category.platformFee)}</td>
                                <td className="px-6 py-4 text-green-600 text-right font-bold text-base">{formatCurrency(category.netPayout)}</td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            Net Payout = Gross Sales - (Payment Fee + Shipping Fee + Platform Fee)
                          </span>
                        </div>
                        <div className="text-gray-500">
                          Based on {paidOrders.length} paid {paidOrders.length === 1 ? 'order' : 'orders'}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* By Payment Type View */}
              {sellerFilters.viewType === 'paymentType' && (
                <>
                  {/* Export Table - All Payment Types */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800 tracking-wide">SALES BY PAYMENT TYPE</h3>
                      <button 
                        onClick={() => {
                          try {
                            console.log('[exportPaymentTypesCSV] Starting export with', paidOrders.length, 'paid orders');
                            
                            // Aggregate ALL payment types from paid orders
                            const paymentTypeMap = new Map<string, {
                              name: string;
                              sold: number;
                              refunded: number;
                              grossSales: number;
                              refunds: number;
                              paymentFee: number;
                              shippingFee: number;
                              platformFee: number;
                              netPayout: number;
                            }>();

                            paidOrders.forEach(order => {
                              const items = order.items || [];
                              const summary = order.summary || {};
                              const fees = order.feesBreakdown || {};
                              
                              // Get payment method from fees.paymentMethod
                              const paymentMethod = fees.paymentMethod || 'Unknown';
                              
                              const orderSubtotal = Number(summary.subtotal) || 0;
                              const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
                              const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
                              const orderPlatformFee = Number(fees.platformFee) || 0;

                              items.forEach((item: any) => {
                                const quantity = Number(item.quantity) || 0;
                                const price = Number(item.price) || 0;
                                const itemSubtotal = Number(item.subtotal) || (price * quantity);
                                
                                const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
                                const itemPaymentFee = orderPaymentFee * feeRatio;
                                const itemShippingFee = orderShippingFee * feeRatio;
                                const itemPlatformFee = orderPlatformFee * feeRatio;
                                const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

                                const existing = paymentTypeMap.get(paymentMethod) || {
                                  name: paymentMethod,
                                  sold: 0,
                                  refunded: 0,
                                  grossSales: 0,
                                  refunds: 0,
                                  paymentFee: 0,
                                  shippingFee: 0,
                                  platformFee: 0,
                                  netPayout: 0
                                };

                                paymentTypeMap.set(paymentMethod, {
                                  name: paymentMethod,
                                  sold: existing.sold + quantity,
                                  refunded: existing.refunded,
                                  grossSales: existing.grossSales + itemSubtotal,
                                  refunds: existing.refunds,
                                  paymentFee: existing.paymentFee + itemPaymentFee,
                                  shippingFee: existing.shippingFee + itemShippingFee,
                                  platformFee: existing.platformFee + itemPlatformFee,
                                  netPayout: existing.netPayout + itemNetPayout
                                });
                              });
                            });

                            const allPaymentTypes = Array.from(paymentTypeMap.values())
                              .sort((a, b) => b.netPayout - a.netPayout);

                            const headers = [
                              'Payment Type',
                              'Items Sold',
                              'Items Refunded',
                              'Gross Sales',
                              'Refunds',
                              'Payment Fee',
                              'Shipping Fee',
                              'Platform Fee',
                              'Net Payout'
                            ];

                            const rows = allPaymentTypes.map(pt => [
                              `"${pt.name}"`,
                              pt.sold,
                              pt.refunded,
                              (Math.floor(pt.grossSales * 100) / 100).toFixed(2),
                              (Math.floor(pt.refunds * 100) / 100).toFixed(2),
                              (Math.floor(pt.paymentFee * 100) / 100).toFixed(2),
                              (Math.floor(pt.shippingFee * 100) / 100).toFixed(2),
                              (Math.floor(pt.platformFee * 100) / 100).toFixed(2),
                              (Math.floor(pt.netPayout * 100) / 100).toFixed(2)
                            ]);

                            const csvContent = [
                              headers.join(','),
                              ...rows.map(row => row.join(','))
                            ].join('\n');

                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            const url = URL.createObjectURL(blob);
                            link.setAttribute('href', url);
                            link.setAttribute('download', `payment-types-${new Date().toISOString().slice(0,10)}.csv`);
                            link.style.visibility = 'hidden';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          } catch (err) {
                            console.error('CSV export failed:', err);
                            setError('Failed to export payment types CSV. Please try again.');
                          }
                        }}
                        disabled={paidOrders.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr className="text-left text-xs font-semibold tracking-wide">
                            <th className="px-6 py-3">Payment Type</th>
                            <th className="px-6 py-3 text-right">Items Sold</th>
                            <th className="px-6 py-3 text-right">Items Refunded</th>
                            <th className="px-6 py-3 text-right">Gross Sales</th>
                            <th className="px-6 py-3 text-right">Refunds</th>
                            <th className="px-6 py-3 text-right">Payment Fee</th>
                            <th className="px-6 py-3 text-right">Shipping Fee</th>
                            <th className="px-6 py-3 text-right">Platform Fee</th>
                            <th className="px-6 py-3 text-right font-bold">Net Payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Aggregate ALL payment types from paid orders
                            const paymentTypeMap = new Map<string, {
                              name: string;
                              sold: number;
                              refunded: number;
                              grossSales: number;
                              refunds: number;
                              paymentFee: number;
                              shippingFee: number;
                              platformFee: number;
                              netPayout: number;
                            }>();

                            paidOrders.forEach(order => {
                              const items = order.items || [];
                              const summary = order.summary || {};
                              const fees = order.feesBreakdown || {};
                              
                              // Get payment method from fees.paymentMethod
                              const paymentMethod = fees.paymentMethod || 'Unknown';
                              
                              const orderSubtotal = Number(summary.subtotal) || 0;
                              const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
                              const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
                              const orderPlatformFee = Number(fees.platformFee) || 0;

                              items.forEach((item: any) => {
                                const quantity = Number(item.quantity) || 0;
                                const price = Number(item.price) || 0;
                                // Calculate item subtotal: try item.subtotal first, fallback to price * quantity
                                const itemSubtotal = Number(item.subtotal) || (price * quantity);
                                
                                const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
                                const itemPaymentFee = orderPaymentFee * feeRatio;
                                const itemShippingFee = orderShippingFee * feeRatio;
                                const itemPlatformFee = orderPlatformFee * feeRatio;
                                const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

                                const existing = paymentTypeMap.get(paymentMethod) || {
                                  name: paymentMethod,
                                  sold: 0,
                                  refunded: 0,
                                  grossSales: 0,
                                  refunds: 0,
                                  paymentFee: 0,
                                  shippingFee: 0,
                                  platformFee: 0,
                                  netPayout: 0
                                };

                                paymentTypeMap.set(paymentMethod, {
                                  name: paymentMethod,
                                  sold: existing.sold + quantity,
                                  refunded: existing.refunded,
                                  grossSales: existing.grossSales + itemSubtotal,
                                  refunds: existing.refunds,
                                  paymentFee: existing.paymentFee + itemPaymentFee,
                                  shippingFee: existing.shippingFee + itemShippingFee,
                                  platformFee: existing.platformFee + itemPlatformFee,
                                  netPayout: existing.netPayout + itemNetPayout
                                });
                              });
                            });

                            // Sort by net payout (descending) - show ALL payment types
                            const allPaymentTypes = Array.from(paymentTypeMap.values())
                              .sort((a, b) => b.netPayout - a.netPayout);

                            if (allPaymentTypes.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={9} className="px-6 py-16">
                                    <div className="flex flex-col items-center justify-center text-center text-gray-500">
                                      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                                        <span className="text-xs font-semibold text-gray-400">⌀</span>
                                      </div>
                                      <div className="text-sm font-medium">No payment types to display</div>
                                      <div className="mt-1 text-xs text-gray-400">There are no sales in the selected time period</div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            return allPaymentTypes.map((paymentType, idx) => (
                              <tr key={idx} className="border-t hover:bg-gray-50">
                                <td className="px-6 py-4 text-gray-900 font-medium">{paymentType.name}</td>
                                <td className="px-6 py-4 text-gray-700 text-right">{paymentType.sold.toLocaleString()}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{paymentType.refunded.toLocaleString()}</td>
                                <td className="px-6 py-4 text-gray-900 text-right font-medium">{formatCurrency(paymentType.grossSales)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(paymentType.refunds)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(paymentType.paymentFee)}</td>
                                <td className="px-6 py-4 text-orange-600 text-right">{formatCurrency(paymentType.shippingFee)}</td>
                                <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(paymentType.platformFee)}</td>
                                <td className="px-6 py-4 text-green-600 text-right font-bold text-base">{formatCurrency(paymentType.netPayout)}</td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            Net Payout = Gross Sales - (Payment Fee + Shipping Fee + Platform Fee)
                          </span>
                        </div>
                        <div className="text-gray-500">
                          Based on {paidOrders.length} paid {paidOrders.length === 1 ? 'order' : 'orders'}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* By Receipts View */}
              {sellerFilters.viewType === 'receipts' && (
                <>
                  {/* Metrics Cards - All Receipts, Sales, Refund */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {/* All Receipts Metric */}
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 shadow-sm border border-blue-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                          <ClipboardList className="w-6 h-6 text-white" />
                        </div>
                        <div className="text-xs font-semibold text-blue-600 bg-blue-200 px-2 py-1 rounded-full">
                          {paidOrders.length > 0 ? '+' + ((paidOrders.length / Math.max(paidOrders.length - 1, 1)) * 100).toFixed(0) + '%' : '0%'}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">All Receipts</p>
                        <p className="text-3xl font-bold text-blue-900">{paidOrders.length.toLocaleString()}</p>
                        <p className="text-xs text-blue-600">Total transactions recorded</p>
                      </div>
                    </div>

                    {/* Sales Metric */}
                    <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl p-6 shadow-sm border border-emerald-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
                          <TrendingUp className="w-6 h-6 text-white" />
                        </div>
                        <div className="text-xs font-semibold text-emerald-600 bg-emerald-200 px-2 py-1 rounded-full">
                          Active
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Total Sales</p>
                        <p className="text-3xl font-bold text-emerald-900">
                          {currency.format(paidOrders.reduce((sum, o) => sum + (Number(o.summary?.subtotal) || 0), 0))}
                        </p>
                        <p className="text-xs text-emerald-600">Revenue from {paidOrders.length} transactions</p>
                      </div>
                    </div>

                    {/* Refund Metric */}
                    <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-2xl p-6 shadow-sm border border-rose-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-12 h-12 bg-rose-600 rounded-xl flex items-center justify-center shadow-lg">
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
                          </svg>
                        </div>
                        <div className="text-xs font-semibold text-rose-600 bg-rose-200 px-2 py-1 rounded-full">
                          {(() => {
                            const refundCount = paidOrders.filter(o => o.status === 'refunded' || o.status === 'returned' || o.status === 'return_refund').length;
                            return refundCount;
                          })()}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-rose-700 uppercase tracking-wide">Total Refunds</p>
                        <p className="text-3xl font-bold text-rose-900">
                          {currency.format(
                            paidOrders
                              .filter(o => o.status === 'refunded' || o.status === 'returned' || o.status === 'return_refund')
                              .reduce((sum, o) => sum + (Number(o.summary?.subtotal) || 0), 0)
                          )}
                        </p>
                        <p className="text-xs text-rose-600">
                          From {paidOrders.filter(o => o.status === 'refunded' || o.status === 'returned' || o.status === 'return_refund').length} refunded orders
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Export Button */}
                  <div className="flex justify-end mb-4">
                    <button 
                      onClick={() => {
                        try {
                          console.log('[exportReceiptsCSV] Starting export with', paidOrders.length, 'paid orders');
                          
                          const headers = [
                            'Receipt No.',
                            'Date',
                            'Customer Name',
                            'Customer ID',
                            'Payment Type',
                            'Amount',
                            'Status'
                          ];

                          const rows = paidOrders.map(order => {
                            const createdAt = order.createdAt || order.timestamp || '';
                            const date = createdAt ? new Date(createdAt).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric' 
                            }) : '';
                            
                            return [
                              `"${order.id || ''}"`,
                              `"${date}"`,
                              `"${order.customer?.name || 'N/A'}"`,
                              `"${order.userId || 'N/A'}"`,
                              `"${order.feesBreakdown?.paymentMethod || 'N/A'}"`,
                              (Number(order.summary?.subtotal) || 0).toFixed(2),
                              `"${order.status || 'N/A'}"`
                            ];
                          });

                          const csvContent = [
                            headers.join(','),
                            ...rows.map(row => row.join(','))
                          ].join('\n');

                          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                          const link = document.createElement('a');
                          const url = URL.createObjectURL(blob);
                          link.setAttribute('href', url);
                          link.setAttribute('download', `receipts-individual-${new Date().toISOString().slice(0,10)}.csv`);
                          link.style.visibility = 'hidden';
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        } catch (err) {
                          console.error('CSV export failed:', err);
                          setError('Failed to export receipts CSV. Please try again.');
                        }
                      }}
                      disabled={paidOrders.length === 0}
                      className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-700 rounded-xl hover:from-teal-700 hover:to-teal-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-4 h-4" />
                      Export Receipts
                    </button>
                  </div>

                  {/* Receipts Table - Individual Transactions */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100">
                      <h3 className="text-lg font-bold text-gray-900">Receipt Transactions</h3>
                      <p className="text-sm text-gray-500 mt-1">Detailed list of all individual receipt transactions</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                          <tr className="text-left text-xs font-bold tracking-wider uppercase">
                            <th className="px-6 py-4 text-gray-700">Receipt No</th>
                            <th className="px-6 py-4 text-gray-700">Date</th>
                            <th className="px-6 py-4 text-gray-700">Employee</th>
                            <th className="px-6 py-4 text-gray-700">Receipt Type</th>
                            <th className="px-6 py-4 text-right text-gray-700">Amount</th>
                            <th className="px-6 py-4 text-center text-gray-700">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(() => {
                            if (paidOrders.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={6} className="px-6 py-16">
                                    <div className="flex flex-col items-center justify-center text-center">
                                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center mb-4 shadow-inner">
                                        <ClipboardList className="w-10 h-10 text-gray-400" />
                                      </div>
                                      <div className="text-lg font-semibold text-gray-900 mb-2">No receipts found</div>
                                      <div className="text-sm text-gray-500">There are no receipt transactions in the selected time period</div>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            // Sort by date descending (most recent first)
                            const sortedOrders = [...paidOrders].sort((a, b) => {
                              const dateA = new Date(a.createdAt || a.timestamp || '').getTime();
                              const dateB = new Date(b.createdAt || b.timestamp || '').getTime();
                              return dateB - dateA;
                            });

                            return sortedOrders.map((order, idx) => {
                              const createdAt = order.createdAt || order.timestamp || '';
                              const date = createdAt ? new Date(createdAt).toLocaleDateString('en-US', { 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              }) : 'N/A';


                              // Find handledBy from statusHistory (any status with handledBy field)
                              let employeeCell: React.ReactNode = 'N/A';
                              
                              if (Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
                                // Find the most recent entry that has handledBy
                                const entryWithHandledBy = order.statusHistory
                                  .filter((e: any) => e.handledBy)
                                  .sort((a: any, b: any) => {
                                    const ta = new Date(a.timestamp as any).getTime();
                                    const tb = new Date(b.timestamp as any).getTime();
                                    return tb - ta; // Most recent first
                                  })[0];
                                
                                if (entryWithHandledBy) {
                                  const handledBy = (entryWithHandledBy as any).handledBy;
                                  let handledById = '';
                                  if (typeof handledBy === 'string') {
                                    handledById = handledBy;
                                  } else if (handledBy && typeof handledBy === 'object' && handledBy.id) {
                                    handledById = handledBy.id;
                                  }
                                  if (handledById) {
                                    employeeCell = <EmployeeName handledBy={handledById} sellerUidToName={sellerUidToName} />;
                                  }
                                }
                              }

                              // Receipt type: 'Sales' for normal, 'Refund' for refunded/returned/return_refund
                              const refundStatuses = ['refunded', 'returned', 'return_refund'];
                              const receiptType = refundStatuses.includes(order.status) ? 'Refund' : 'Sales';
                              const amount = Number(order.summary?.total) || 0;
                              const status = order.status || 'pending';

                              // Status styling
                              const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
                                'completed': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
                                'confirmed': { bg: 'bg-green-100', text: 'text-green-700', label: 'Confirmed' },
                                'processing': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Processing' },
                                'to_ship': { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'To Ship' },
                                'shipping': { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Shipping' },
                                'shipped': { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Shipped' },
                                'pending': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' },
                                'refunded': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Refunded' },
                                'returned': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Returned' },
                                'return_refund': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Return/Refund' },
                                'return_requested': { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Return Requested' },
                                'return_approved': { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Return Approved' },
                                'return_rejected': { bg: 'bg-red-100', text: 'text-red-700', label: 'Return Rejected' },
                                'cancelled': { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' },
                                'canceled': { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' },
                                'failed-delivery': { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed Delivery' }
                              };

                              const statusStyle = statusConfig[status] || statusConfig['pending'];

                              return (
                                <tr 
                                  key={order.id || idx} 
                                  onClick={() => {
                                    setSelectedReceipt(order);
                                    setReceiptDetailOpen(true);
                                  }}
                                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                                >
                                  <td className="px-6 py-4 font-semibold text-gray-900">{order.id}</td>
                                  <td className="px-6 py-4 text-gray-900 font-medium">{date}</td>
                                  <td className="px-6 py-4 font-medium text-gray-900">{employeeCell}</td>
                                  <td className="px-6 py-4 text-blue-700 font-semibold">{receiptType}</td>
                                  <td className="px-6 py-4 text-right text-gray-900 font-bold">{currency.format(amount)}</td>
                                  <td className="px-6 py-4 text-center">
                                    <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text} border border-current border-opacity-20`}>
                                      {statusStyle.label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3 text-gray-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 bg-teal-500 rounded-full shadow-sm"></span>
                            <span className="font-medium">Total Receipts:</span>
                            <span className="font-bold text-gray-900">{paidOrders.length}</span>
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-sm"></span>
                            <span className="font-medium">Total Revenue:</span>
                            <span className="font-bold text-gray-900">
                              {currency.format(paidOrders.reduce((sum, o) => sum + (Number(o.summary?.subtotal) || 0), 0))}
                            </span>
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          Last updated: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Receipt Detail Side Panel */}
                  {receiptDetailOpen && selectedReceipt && (
                    <>
                      {/* Backdrop */}
                      <div 
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
                        onClick={() => setReceiptDetailOpen(false)}
                      />
                      
                      {/* Side Panel */}
                      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto animate-slide-in-right">
                        {/* Header */}
                        <div className="sticky top-0 bg-gradient-to-r from-teal-600 to-teal-700 text-white px-6 py-5 shadow-lg z-10">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-xl font-bold">Receipt Details</h3>
                              <p className="text-sm text-teal-100 mt-1">Order #{selectedReceipt.id}</p>
                            </div>
                            <button
                              onClick={() => setReceiptDetailOpen(false)}
                              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-6">
                          {/* Total Price Card */}
                          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl p-6 border border-emerald-200 shadow-sm">
                            <div className="text-sm font-medium text-emerald-700 mb-2">Total Amount</div>
                            <div className="text-4xl font-bold text-emerald-900">
                              {currency.format(Number(selectedReceipt.summary?.subtotal) || 0)}
                            </div>
                            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                              <span>Paid via {selectedReceipt.feesBreakdown?.paymentMethod || 'N/A'}</span>
                            </div>
                          </div>

                          {/* Order Information */}
                          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-600">Employee</span>
                              <span className="text-sm font-bold text-gray-900">
                                {(() => {
                                  if (Array.isArray(selectedReceipt.statusHistory) && selectedReceipt.statusHistory.length > 0) {
                                    const entryWithHandledBy = selectedReceipt.statusHistory
                                      .filter((e: any) => e.handledBy)
                                      .sort((a: any, b: any) => {
                                        const ta = new Date(a.timestamp as any).getTime();
                                        const tb = new Date(b.timestamp as any).getTime();
                                        return tb - ta;
                                      })[0];
                                    if (entryWithHandledBy) {
                                      const handledBy = (entryWithHandledBy as any).handledBy;
                                      const handledById = typeof handledBy === 'string' ? handledBy : handledBy?.id;
                                      return sellerUidToName[handledById] || handledById || 'N/A';
                                    }
                                  }
                                  return 'N/A';
                                })()}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-600">Order ID</span>
                              <span className="text-sm font-bold text-gray-900">{selectedReceipt.id}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-600">Status</span>
                              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                                selectedReceipt.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                selectedReceipt.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                                selectedReceipt.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                                selectedReceipt.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {selectedReceipt.status?.toUpperCase() || 'PENDING'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-600">Date & Time</span>
                              <span className="text-sm text-gray-900">
                                {new Date(selectedReceipt.createdAt || selectedReceipt.timestamp || '').toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                          </div>

                          {/* Customer Information */}
                          <div>
                            <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                              <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              Customer Details
                            </h4>
                            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                                  {(selectedReceipt.customer?.name || 'U').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-900">{selectedReceipt.customer?.name || 'Unknown Customer'}</div>
                                  <div className="text-xs text-gray-500">ID: {selectedReceipt.userId || 'N/A'}</div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Payment Method */}
                          <div>
                            <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                              <CreditCard className="w-4 h-4 text-teal-600" />
                              Payment Method
                            </h4>
                            <div className="bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
                                  <CreditCard className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-blue-900">
                                    {selectedReceipt.feesBreakdown?.paymentMethod || 'Not specified'}
                                  </div>
                                  <div className="text-xs text-blue-600">Payment gateway processed</div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Products List */}
                          <div>
                            <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                              <ShoppingCart className="w-4 h-4 text-teal-600" />
                              Order Items
                            </h4>
                            <div className="space-y-3">
                              {selectedReceipt.items && Array.isArray(selectedReceipt.items) && selectedReceipt.items.length > 0 ? (
                                selectedReceipt.items.map((item: any, idx: number) => (
                                  <div key={idx} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition">
                                    <div className="flex gap-4">
                                      {/* Product Image */}
                                      <div className="w-20 h-20 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden shadow-sm">
                                        {item.image || item.imageUrl ? (
                                          <img 
                                            src={item.image || item.imageUrl} 
                                            alt={item.name || 'Product'} 
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                              (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"%3E%3Crect fill="%23f3f4f6" width="80" height="80"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="system-ui" font-size="24" fill="%239ca3af"%3E📦%3C/text%3E%3C/svg%3E';
                                            }}
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-3xl">
                                            📦
                                          </div>
                                        )}
                                      </div>
                                      
                                      {/* Product Details */}
                                      <div className="flex-1 min-w-0">
                                        <h5 className="font-semibold text-gray-900 text-sm mb-1 truncate">
                                          {item.name || 'Product'}
                                        </h5>
                                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                                          <span>Qty: {item.quantity || 1}</span>
                                          <span className="text-gray-300">•</span>
                                          <span>{currency.format(Number(item.price) || 0)} each</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-gray-600">Subtotal</span>
                                          <span className="text-base font-bold text-teal-600">
                                            {currency.format((Number(item.price) || 0) * (item.quantity || 1))}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
                                  <div className="text-gray-400 mb-2">📦</div>
                                  <div className="text-sm text-gray-600">
                                    {selectedReceipt.itemsBrief || 'No item details available'}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Price Breakdown */}
                          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                            <h4 className="text-sm font-bold text-gray-900 mb-3">Price Breakdown</h4>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">Subtotal</span>
                              <span className="font-semibold text-gray-900">
                                {currency.format(Number(selectedReceipt.summary?.subtotal) || 0)}
                              </span>
                            </div>
                            {/* Shipping Fee from Order.summary.buyerShippingCharge */}
                            {selectedReceipt.summary?.buyerShippingCharge && Number(selectedReceipt.summary.buyerShippingCharge) > 0 && (
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600">Shipping Fee</span>
                                <span className="font-semibold text-gray-900">
                                  {currency.format(Number(selectedReceipt.summary.buyerShippingCharge))}
                                </span>
                              </div>
                            )}
                            {/* Payment Fee from Order.feesBreakdown.paymentProcessingFee */}
                            {selectedReceipt.feesBreakdown?.paymentProcessingFee && Number(selectedReceipt.feesBreakdown.paymentProcessingFee) > 0 && (
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600">Payment Fee</span>
                                <span className="font-semibold text-gray-900">
                                  {currency.format(Number(selectedReceipt.feesBreakdown.paymentProcessingFee))}
                                </span>
                              </div>
                            )}
                            {/* Platform Fee from Order.feesBreakdown.platformFee */}
                            {selectedReceipt.feesBreakdown?.platformFee && Number(selectedReceipt.feesBreakdown.platformFee) > 0 && (
                              <>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-600">Platform Fee</span>
                                  <span className="font-semibold text-gray-900">
                                    {currency.format(Number(selectedReceipt.feesBreakdown.platformFee))}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-600">Platform VAT (12% inclusive)</span>
                                  <span className="font-semibold text-red-600">
                                    {currency.format(Number(selectedReceipt.feesBreakdown.platformFee) * 0.12)}
                                  </span>
                                </div>
                              </>
                            )}
                            <div className="border-t border-gray-300 pt-2 mt-2">
                              <div className="flex items-center justify-between">
                                <span className="text-base font-bold text-gray-900">Total</span>
                                <span className="text-xl font-bold text-teal-600">
                                  {currency.format(
                                    (Number(selectedReceipt.summary?.subtotal) || 0) +
                                    (Number(selectedReceipt.summary?.buyerShippingCharge) || 0)
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex gap-3 pt-2">
                            <button
                              onClick={() => {
                                window.print();
                              }}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-xl font-semibold hover:from-teal-700 hover:to-teal-800 transition shadow-md hover:shadow-lg"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                              Print Receipt
                            </button>
                            <button
                              onClick={() => setReceiptDetailOpen(false)}
                              className="px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Tutorial modal */}
              {showTutorial && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                  <div className="absolute inset-0 bg-black/40" onClick={() => setShowTutorial(false)} />
                  <div className="relative z-10 w-[92vw] max-w-xl bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                      <div className="text-sm font-medium text-gray-900">Sales tutorial</div>
                      <button className="text-xs px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50" onClick={() => setShowTutorial(false)}>Close</button>
                    </div>
                    <div className="p-4 space-y-2 text-sm text-gray-700">
                      <p>Use the filters below to refine metrics by date, brand, category, location, and payment type.</p>
                      <p>The line chart shows revenue over time. Hover points for details.</p>
                      <p>Track your sales performance and fulfillment times to optimize operations.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        }
        // Admin layout (existing)
        return (
          <div className="space-y-8">
            {/* Top Section - Metrics Cards (3) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Order Shipped Card */}
              {/* <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100"> */}
                {/* <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">ORDER SHIPPED</p>
                    <p className="text-sm text-gray-500 mb-2">TOTAL ORDERS SHIPPED</p>
                    <p className="text-2xl font-bold text-gray-900">{adminMetrics.shippedOrders.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">of {adminMetrics.totalOrders.toLocaleString()} total orders</p>
                  </div>
                  <div className="w-12 h-12 bg-teal-50 rounded-xl flex items-center justify-center">
                    <ShoppingCart className="w-6 h-6 text-teal-600" />
                  </div>
                </div> */}
              {/* </div> */}
              {/* Total Transactions Card */}
              {/* <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">TOTAL NUMBER OF</p>
                    <p className="text-sm text-gray-500 mb-2">DELIVERED TRANSACTIONS</p>
                    <p className="text-2xl font-bold text-gray-900">{adminMetrics.deliveredOrders.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-1">of {adminMetrics.totalOrders.toLocaleString()} total orders</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </div> */}
            </div>
            {/* Horizontal Filters Bar */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex flex-col lg:flex-row lg:items-end lg:space-x-4 gap-4">
                {/* Date Range (picker) */}
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs font-medium text-gray-700 mb-2">DATE RANGE</label>
                  <div ref={adminDateDropdownRef} className="relative">
                    {/* Trigger / summary */}
                    <button
                      type="button"
                      onClick={() => setShowAdminDatePicker(v => !v)}
                      aria-haspopup="dialog"
                      aria-expanded={showAdminDatePicker}
                      className="w-full border border-gray-200 rounded-xl bg-gray-50 px-3 py-2 flex items-center justify-between text-left"
                    >
                      <span className="text-[11px] text-gray-600 truncate pr-2">
                        {adminFilters.dateFrom ? `${adminFilters.dateFrom} → ${adminFilters.dateTo}` : 'Select range or preset'}
                      </span>
                      <span className={`text-[11px] transition-transform ${showAdminDatePicker ? 'rotate-180' : ''}`}>⌄</span>
                    </button>
                    {showAdminDatePicker && (
                      <div className="absolute left-0 mt-2 z-30 w-[300px] border border-gray-200 rounded-xl bg-white shadow-xl p-3 space-y-3 animate-fade-in">
                        {/* Presets */}
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => applyPreset('today')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Today</button>
                          <button onClick={() => applyPreset('7')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Last 7 days</button>
                          <button onClick={() => applyPreset('30')} className="px-2 py-1 text-xs rounded-md border bg-white hover:bg-teal-50">Last 30 days</button>
                          {adminRange.start && (
                            <span className="text-[10px] text-gray-500 ml-auto">{toISO(adminRange.start)} → {toISO(adminRange.end || adminRange.start)}</span>
                          )}
                        </div>
                        {/* Calendar header */}
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => setAdminCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))}
                            className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100"
                          >◀</button>
                          <div className="text-xs font-medium text-gray-700">
                            {adminCalendarMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setAdminCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))}
                            className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100"
                          >▶</button>
                        </div>
                        {/* Weekday labels */}
                        <div className="grid grid-cols-7 text-[10px] font-medium text-gray-500">
                          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
                        </div>
                        {/* Days grid */}
                        <div className="grid grid-cols-7 gap-1 text-xs">
                          {Array.from({ length: firstWeekday(adminCalendarMonth) }).map((_,i) => <div key={'spacer'+i} />)}
                          {Array.from({ length: daysInMonth(adminCalendarMonth) }).map((_,i) => {
                            const day = new Date(adminCalendarMonth.getFullYear(), adminCalendarMonth.getMonth(), i+1);
                            const selectedStart = adminRange.start && day.getTime() === adminRange.start.getTime();
                            const selectedEnd = adminRange.end && day.getTime() === adminRange.end.getTime();
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
                          <button
                            type="button"
                            onClick={() => { setAdminRange({ start: null, end: null }); setAdminFilters(f=> ({ ...f, dateFrom: '', dateTo: '' })); }}
                            className="text-[11px] px-2 py-1 rounded-md border bg-white hover:bg-gray-100"
                          >Clear</button>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={applyRange}
                              disabled={!adminRange.start}
                              className="text-[11px] px-3 py-1 rounded-md bg-teal-600 text-white disabled:opacity-40"
                            >Apply</button>
                            <button
                              type="button"
                              onClick={() => setShowAdminDatePicker(false)}
                              className="text-[11px] px-3 py-1 rounded-md border bg-white hover:bg-gray-100"
                            >Done</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Province Filter */}
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs font-medium text-gray-700 mb-1">PROVINCE</label>
                  <select
                    value={adminFilters.province}
                    onChange={(e)=> setAdminFilters(f=> ({...f, province: e.target.value}))}
                    className="w-full p-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option value="all">All provinces</option>
                    {phProvinces.map(p => (
                      <option key={p.code} value={p.code}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {/* City Filter (dropdown trigger that opens checkbox list) */}
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs font-medium text-gray-700 mb-1">CITY</label>
                  <div ref={adminCityDropdownRef} className="relative">
                    <button
                      type="button"
                      disabled={adminFilters.province === 'all'}
                      onClick={() => setShowAdminCityDropdown(v => !v)}
                      className={`w-full p-2 border rounded-lg text-xs bg-white flex items-center justify-between ${adminFilters.province === 'all' ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}
                    >
                      <span className="truncate pr-2">
                        {adminFilters.province === 'all'
                          ? 'Select a province to choose cities'
                          : adminSelectedCityCodes.size > 0
                            ? `${adminSelectedCityCodes.size} city${adminSelectedCityCodes.size > 1 ? 'ies' : ''} selected`
                            : 'Select cities'}
                      </span>
                      <span className={`text-[11px] transition-transform ${showAdminCityDropdown ? 'rotate-180' : ''}`}>⌄</span>
                    </button>
                    {showAdminCityDropdown && adminFilters.province !== 'all' && (
                      <div className="absolute left-0 mt-2 z-30 w-[300px] border border-gray-200 rounded-xl bg-white shadow-xl p-3 space-y-3 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] text-gray-700">Select cities in {phProvinces.find(p=>p.code===adminFilters.province)?.name || 'province'}</div>
                          {adminSelectedCityCodes.size === 0 && phCities.length > 0 && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800">Required</span>
                          )}
                        </div>
                        {phCities.length > 0 ? (
                          <div className="max-h-40 overflow-auto">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {phCities.map(c => {
                                const checked = adminSelectedCityCodes.has(c.code);
                                return (
                                  <label key={c.code} className="flex items-center gap-2 text-[11px] text-gray-700">
                                    <input
                                      type="checkbox"
                                      className="rounded border-gray-300 accent-[#F68F22] focus:ring-[#F68F22]"
                                      checked={checked}
                                      onChange={() => {
                                        setAdminSelectedCityCodes(prev => {
                                          const next = new Set(prev);
                                          if (next.has(c.code)) next.delete(c.code); else next.add(c.code);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>{c.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500">Loading cities…</div>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => setAdminSelectedCityCodes(new Set())}
                            className="text-[11px] px-2 py-1 rounded-md border bg-white hover:bg-gray-100"
                          >Clear</button>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setShowAdminCityDropdown(false)}
                              className="text-[11px] px-3 py-1 rounded-md bg-teal-600 text-white"
                            >Done</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Shop Name (Seller) */}
                {/* <div className="flex-1 min-w-[160px]">
                  <label className="block text-xs font-medium text-gray-700 mb-1">SHOP NAME</label>
                  <select
                    value={adminFilters.seller}
                    onChange={(e)=> setAdminFilters(f=> ({...f, seller: e.target.value}))}
                    className="w-full p-2 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option value="all">All shops</option>
                    {adminSellers.map(s => (
                      <option key={s.uid} value={s.uid}>{s.shopName || s.name || s.uid}</option>
                    ))}
                  </select>
                </div> */}
                {/* Apply / Reset */}
                <div className="flex items-end gap-2 pt-2">
                  <button className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-lg shadow-sm transition">Apply</button>
                  <button
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition"
                    onClick={() => setAdminFilters({ dateFrom: '', dateTo: '', province: 'all', city: 'all', seller: 'all' })}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
            {/* Revenue Chart Section */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">REVENUE</h3>
                  <p className="text-3xl font-bold text-gray-900">PHP 3,000,000.00</p>
                </div>
              </div>
              <RevenueChart />
            </div>
            {/* NEW: Export + Seller Metrics Table */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              {/* Filter indicator banner */}
              {(adminFilters.dateFrom || adminFilters.dateTo || adminFilters.province !== 'all' || adminSelectedCityCodes.size > 0) && (
                <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-medium text-blue-700">
                      Filters active: Showing sellers with orders in selected {adminFilters.dateFrom && adminFilters.dateTo ? `date range (${adminFilters.dateFrom} to ${adminFilters.dateTo})` : 'criteria'}
                      {adminFilters.province !== 'all' && ', province'}
                      {adminSelectedCityCodes.size > 0 && ', city'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setAdminFilters({ dateFrom: '', dateTo: '', province: 'all', city: 'all', seller: 'all' });
                      setAdminSelectedCityCodes(new Set());
                      setAdminRange({ start: null, end: null });
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium underline"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800 tracking-wide">EXPORT</h3>
                <div className="flex items-center gap-2">
                  {/* Export button with dropdown */}
                  <div ref={exportMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setShowExportMenu(v => !v)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-600"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="whitespace-nowrap">Export</span>
                    </button>
                    {showExportMenu && (
                      <div className="absolute right-0 mt-2 z-40 w-32 border border-gray-200 bg-white rounded-xl shadow-lg py-1 animate-fade-in">
                        <button
                          type="button"
                          onClick={exportSellerMetricsCSV}
                          className="w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <span>📄</span>
                          <span>Export CSV</span>
                        </button>
                        <button
                          type="button"
                          onClick={exportSellerMetricsPDF}
                          className="w-full px-4 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <span>📕</span>
                          <span>Export PDF</span>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Column filter trigger */}
                  <div ref={exportColumnMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setShowExportColumnMenu(v => !v)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-600"
                    >
                      <Filter className="w-3.5 h-3.5" />
                      <span className="whitespace-nowrap">Columns</span>
                    </button>
                    {showExportColumnMenu && (
                      <div className="absolute right-0 mt-2 z-40 w-56 border border-gray-200 bg-white rounded-xl shadow-lg p-3 space-y-2 animate-fade-in">
                        <div className="text-[11px] font-semibold text-gray-700 mb-1">Visible columns</div>
                        {Object.keys(columnLabels).map(key => (
                          <label key={key} className="flex items-center gap-2 text-[11px] text-gray-700">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 accent-[#F68F22] focus:ring-[#F68F22]"
                              checked={exportColumnVisibility[key]}
                              onChange={() => setExportColumnVisibility(v => ({ ...v, [key]: !v[key] }))}
                            />
                            <span>{columnLabels[key]}</span>
                          </label>
                        ))}
                        <div className="pt-1 text-[10px] text-gray-400">Uncheck to hide column from table.</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr className="text-left text-[11px] font-semibold tracking-wide">
                      {visibleColumnKeys.map(k => (
                        <th key={k} className="px-4 py-3">{columnLabels[k]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {adminSellersDisplayed.length === 0 && (
                      <tr>
                        <td colSpan={visibleColumnKeys.length || 1} className="px-4 py-16">
                          <div className="flex flex-col items-center justify-center text-center text-gray-500">
                            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                              <span className="text-xs font-semibold text-gray-400">⌀</span>
                            </div>
                            <div className="text-sm font-medium">No data to display</div>
                            <div className="mt-1 text-[11px] text-gray-400">There are no sales in the selected time period</div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {adminSellersDisplayed.map(s => {
                      const sellerOrders = confirmationOrders.filter(o => {
                        const orderSellerIds = o.sellerIds || [];
                        if (!orderSellerIds.includes(s.uid)) return false;
                        
                        if (adminFilters.dateFrom && adminFilters.dateTo) {
                          const orderDate = o.timestamp ? o.timestamp.slice(0, 10) : '';
                          if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) {
                            return false;
                          }
                        }
                        
                        if (adminFilters.province !== 'all') {
                          if (!o.region || !o.region.province) {
                            return false;
                          }
                          
                          const orderProvinceCode = o.region.province;
                          
                          if (s === adminSellersDisplayed[0] && o === confirmationOrders[0]) {
                            console.log('[PROVINCE FILTER DEBUG]', {
                              filterProvinceCode: adminFilters.province,
                              orderProvinceCode: orderProvinceCode,
                              orderRegion: o.region,
                              orderFullData: { id: o.id, sellerIds: o.sellerIds, region: o.region },
                              match: orderProvinceCode === adminFilters.province,
                            });
                          }
                          
                          if (orderProvinceCode !== adminFilters.province) {
                            return false;
                          }
                        }
                        
                        if (adminSelectedCityCodes.size > 0) {
                          if (!o.region || !o.region.municipality) {
                            return false;
                          }
                          
                          const orderCity = o.region.municipality;
                          const matchingCity = phCities.find(c => c.name === orderCity);
                          if (!matchingCity || !adminSelectedCityCodes.has(matchingCity.code)) {
                            return false;
                          }
                        }
                        
                        if (!isPaidStatus(o.status)) return false;
                        
                        return true;
                      });
                      
                      const gross = sellerOrders.reduce((sum, o) => {
                        const summary = o.summary || {};
                        const subtotal = Number(summary.subtotal) || 0;
                        return sum + subtotal;
                      }, 0);
                      
                      const tx = sellerOrders.length;
                      const avgOrder = tx > 0 ? gross / tx : 0;
                      
                      const logistic = sellerOrders.reduce((sum, o) => {
                        const summary = o.summary || {};
                        return sum + (Number(summary.sellerShippingCharge) || 0);
                      }, 0);
                      
                      const payment = sellerOrders.reduce((sum, o) => {
                        const fees = o.feesBreakdown || {};
                        return sum + (Number(fees.paymentProcessingFee) || 0);
                      }, 0);
                      
                      const inquiry = sellerOrders.reduce((sum, o) => {
                        const fees = o.feesBreakdown || {};
                        return sum + (Number(fees.platformFee) || 0);
                      }, 0);
                      
                      // Debug logging for first seller - COMPREHENSIVE CHECK
                      if (s === adminSellersDisplayed[0]) {
                        console.log('========================================');
                        console.log('[Export Table] COMPREHENSIVE DEBUG');
                        console.log('========================================');
                        
                        // All sellers we're checking
                        console.log('1. ALL SELLERS IN SYSTEM:', adminSellersDisplayed.map(seller => ({
                          uid: seller.uid,
                          shopName: seller.shopName || seller.name,
                        })));
                        
                        // All orders and their sellerIds with seller name lookup
                        console.log('2. ALL ORDERS AND THEIR SELLERIDS:', confirmationOrders.map(o => {
                          const orderSellerIds = o.sellerIds || [];
                          const sellerNames = orderSellerIds.map(sid => {
                            const seller = adminSellersDisplayed.find(s => s.uid === sid);
                            return seller ? (seller.shopName || seller.name) : 'UNKNOWN SELLER';
                          });
                          const paidStatuses = ['to_ship', 'processing', 'completed'];
                          return {
                            orderId: o.id,
                            sellerIds: o.sellerIds,
                            sellerNames: sellerNames,
                            sellerIdsType: Array.isArray(o.sellerIds) ? 'array' : typeof o.sellerIds,
                            sellerIdsLength: Array.isArray(o.sellerIds) ? o.sellerIds.length : 'N/A',
                            status: o.status,
                            isPaid: isPaidStatus(o.status),
                            isPaidCheck: paidStatuses.includes(o.status),
                            timestamp: o.timestamp,
                            subtotal: o.summary?.subtotal,
                          };
                        }));
                        
                        // Match summary: which sellers have orders
                        const sellerOrderCounts = adminSellersDisplayed.map(seller => {
                          const count = confirmationOrders.filter(o => {
                            const orderSellerIds = o.sellerIds || [];
                            return orderSellerIds.includes(seller.uid) && isPaidStatus(o.status);
                          }).length;
                          return {
                            shopName: seller.shopName || seller.name,
                            uid: seller.uid,
                            paidOrderCount: count,
                          };
                        }).filter(x => x.paidOrderCount > 0);
                        
                        console.log('3. SELLERS WITH PAID ORDERS:', sellerOrderCounts);
                        
                        // First seller match attempt
                        console.log('4. FIRST SELLER MATCH ATTEMPT:', {
                          sellerName: s.shopName || s.name || s.uid,
                          sellerUid: s.uid,
                          sellerUidType: typeof s.uid,
                          totalOrders: confirmationOrders.length,
                          matchedOrders: sellerOrders.length,
                          firstOrderSellerIds: confirmationOrders[0]?.sellerIds,
                          doesMatch: confirmationOrders[0]?.sellerIds?.includes(s.uid),
                        });
                        
                        console.log('========================================');
                      }
                      
                      const cellByKey: Record<string, any> = {
                        seller: s.storeName || s.shopName || s.name || s.uid,
                        gross: gross,
                        avg: avgOrder,
                        tx: tx,
                        orderSummary: tx, 
                        logistic: logistic,
                        payment: payment,
                        inquiry: inquiry,
                      };
                      
                      const rowTotal = visibleColumnKeys.reduce((sum, k) => {
                        if (k === 'seller' || k === 'orderSummary') return sum;
                        return sum + (typeof cellByKey[k] === 'number' ? cellByKey[k] : 0);
                      }, 0);
                      
                      return (
                        <tr key={s.uid} className="border-t last:border-b-0 hover:bg-gray-50">
                          {visibleColumnKeys.map(k => (
                            <td key={k} className={`px-4 py-3 text-gray-700 ${k === 'seller' ? 'font-medium text-gray-900' : ''}`}>
                              {k === 'orderSummary' ? (
                                <button
                                  onClick={() => handleOpenOrderSummary(s)}
                                  className="text-teal-600 hover:text-teal-700 font-medium underline cursor-pointer"
                                  title="View order details"
                                >
                                  {tx} {tx === 1 ? 'order' : 'orders'}
                                </button>
                              ) : (
                                typeof cellByKey[k] === 'number' ? cellByKey[k].toLocaleString() : cellByKey[k]
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                    <tr className="text-[11px] font-bold">
                      {visibleColumnKeys.map((k, idx) => {
                        if (k === 'seller') {
                          return <td key={k} className="px-4 py-3 text-gray-900">TOTAL</td>;
                        }
                        if (k === 'orderSummary') {
                          const totalOrders = adminSellersDisplayed.reduce((sum, s) => {
                            const sellerOrders = confirmationOrders.filter(o => {
                              const orderSellerIds = o.sellerIds || [];
                              if (!orderSellerIds.includes(s.uid)) return false;
                              
                              if (adminFilters.dateFrom && adminFilters.dateTo) {
                                const orderDate = o.timestamp ? o.timestamp.slice(0, 10) : '';
                                if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) return false;
                              }
                              
                              if (adminFilters.province !== 'all') {
                                if (o.region && o.region.province) {
                                  const orderProvinceCode = o.region.province;
                                  if (orderProvinceCode !== adminFilters.province) return false;
                                }
                              }
                              
                              if (adminSelectedCityCodes.size > 0) {
                                if (o.region && o.region.municipality) {
                                  const orderCity = o.region.municipality;
                                  const matchingCity = phCities.find(c => c.name === orderCity);
                                  if (!matchingCity || !adminSelectedCityCodes.has(matchingCity.code)) return false;
                                }
                              }
                              
                              if (!isPaidStatus(o.status)) return false;
                              return true;
                            });
                            return sum + sellerOrders.length;
                          }, 0);
                          return <td key={k} className="px-4 py-3 text-gray-900">{totalOrders} {totalOrders === 1 ? 'order' : 'orders'}</td>;
                        }
                        const columnTotal = adminSellersDisplayed.reduce((sum, s) => {
                          const sellerOrders = confirmationOrders.filter(o => {
                            const orderSellerIds = o.sellerIds || [];
                            if (!orderSellerIds.includes(s.uid)) return false;
                            
                            if (adminFilters.dateFrom && adminFilters.dateTo) {
                              const orderDate = o.timestamp ? o.timestamp.slice(0, 10) : '';
                              if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) return false;
                            }
                            
                            if (adminFilters.province !== 'all') {
                              if (!o.region || !o.region.province) {
                                return false;
                              }
                              const orderProvinceCode = o.region.province;
                              if (orderProvinceCode !== adminFilters.province) return false;
                            }
                            
                            if (adminSelectedCityCodes.size > 0) {
                              if (!o.region || !o.region.municipality) {
                                return false;
                              }
                              const orderCity = o.region.municipality;
                              const matchingCity = phCities.find(c => c.name === orderCity);
                              if (!matchingCity || !adminSelectedCityCodes.has(matchingCity.code)) return false;
                            }
                            
                            if (!isPaidStatus(o.status)) return false;
                            return true;
                          });
                          const gross = sellerOrders.reduce((s, o) => s + (Number(o.summary?.subtotal) || 0), 0);
                          const tx = sellerOrders.length;
                          const avgOrder = tx > 0 ? gross / tx : 0;
                          const logistic = sellerOrders.reduce((s, o) => s + (Number(o.summary?.sellerShippingCharge) || 0), 0);
                          const payment = sellerOrders.reduce((s, o) => s + (Number(o.feesBreakdown?.paymentProcessingFee) || 0), 0);
                          const inquiry = sellerOrders.reduce((s, o) => s + (Number(o.feesBreakdown?.platformFee) || 0), 0);
                          const values: Record<string, number> = { gross, avg: avgOrder, tx, logistic, payment, inquiry };
                          return sum + (values[k] || 0);
                        }, 0);
                        return <td key={k} className="px-4 py-3 text-gray-900">{columnTotal.toLocaleString()}</td>;
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
                <div className="flex items-center gap-1">
                  <button className="px-2 py-1 border rounded-md bg-white hover:bg-gray-50">{'<'}</button>
                  <button className="px-2 py-1 border rounded-md bg-white hover:bg-gray-50">{'>'}</button>
                </div>
                <div>Page 1 of 1</div>
                <div>
                  <select className="border rounded-md px-2 py-1 bg-white">
                    <option>10</option>
                    <option>25</option>
                    <option>50</option>
                  </select>
                </div>
              </div>
            </div>
            
            {/* Order Summary Modal */}
            {showOrderSummaryModal && selectedSellerForOrders && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                <div className="relative w-full max-w-6xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-teal-600 to-teal-500 px-6 py-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-white">Order Summary</h3>
                      <p className="text-sm text-white/80 mt-1">{selectedSellerForOrders.name}</p>
                    </div>
                    <button
                      onClick={() => {
                        setShowOrderSummaryModal(false);
                        setSelectedSellerForOrders(null);
                        setSellerOrders([]);
                        setExpandedOrderIds(new Set()); 
                      }}
                      className="text-white/80 hover:text-white transition p-2 hover:bg-white/10 rounded-lg"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Content */}
                  <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                    {sellerOrders.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                          </svg>
                        </div>
                        <p className="text-gray-600 font-medium">No orders found</p>
                        <p className="text-sm text-gray-500 mt-1">This seller has no orders matching the current filters</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-sm text-gray-600">
                            Showing <span className="font-semibold text-gray-900">{sellerOrders.length}</span> {sellerOrders.length === 1 ? 'order' : 'orders'}
                          </p>
                        </div>
                        
                        <div className="space-y-4">
                          {sellerOrders.map((order) => (
                            <div key={order.id} className="border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow bg-white">
                              {/* Order Header */}
                              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <span className="font-semibold text-gray-900">#{order.id}</span>
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                      order.status === 'completed' ? 'bg-green-100 text-green-700' :
                                      order.status === 'processing' || order.status === 'to_ship' ? 'bg-blue-100 text-blue-700' :
                                      order.status === 'shipped' || order.status === 'shipping' ? 'bg-purple-100 text-purple-700' :
                                      order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}>
                                      {order.status.replace(/_/g, ' ').toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-lg font-bold text-gray-900">
                                      ₱{(order.summary?.subtotal || order.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Order Details */}
                              <div className="p-4">
                                <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                                  <div>
                                    <span className="text-gray-500 text-xs">Customer</span>
                                    <p className="text-gray-900 font-medium">{order.customer?.name || 'N/A'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500 text-xs">Date</span>
                                    <p className="text-gray-900 font-medium">
                                      {order.timestamp ? new Date(order.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500 text-xs">Payment</span>
                                    <p className="text-gray-900 font-medium">{order.feesBreakdown?.paymentMethod || order.paymentType || 'N/A'}</p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                                  {order.region && (
                                    <div>
                                      <span className="text-gray-500 text-xs">Location</span>
                                      <p className="text-gray-900 font-medium">
                                        {[order.region.municipality, order.region.province].filter(Boolean).join(', ') || 'N/A'}
                                      </p>
                                    </div>
                                  )}
                                  
                                  {order.paymongo?.paymentStatus && (
                                    <div>
                                      <span className="text-gray-500 text-xs">Payment Status</span>
                                      <p className="text-gray-900 font-medium capitalize">
                                        {order.paymongo.paymentStatus}
                                      </p>
                                    </div>
                                  )}
                                </div>

                                {/* Items List - Collapsible */}
                                {order.items && order.items.length > 0 && (
                                  <div className="mt-4">
                                    <button
                                      onClick={() => {
                                        setExpandedOrderIds(prev => {
                                          const newSet = new Set(prev);
                                          if (newSet.has(order.id)) {
                                            newSet.delete(order.id);
                                          } else {
                                            newSet.add(order.id);
                                          }
                                          return newSet;
                                        });
                                      }}
                                      className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 hover:text-teal-600 transition py-2 px-3 rounded-lg hover:bg-gray-50"
                                    >
                                      <span>Order Items ({order.items.length})</span>
                                      <svg 
                                        className={`w-4 h-4 transition-transform ${expandedOrderIds.has(order.id) ? 'rotate-180' : ''}`}
                                        fill="none" 
                                        stroke="currentColor" 
                                        viewBox="0 0 24 24"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                    {expandedOrderIds.has(order.id) && (
                                      <div className="space-y-2 mt-2 animate-fade-in">
                                        {order.items.map((item, idx) => (
                                          <div key={idx} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
                                            {/* Product Image */}
                                            {item.imageUrl && (
                                              <div className="flex-shrink-0 w-16 h-16 bg-white rounded-lg border border-gray-200 overflow-hidden">
                                                <img 
                                                  src={item.imageUrl} 
                                                  alt={item.name || 'Product'} 
                                                  className="w-full h-full object-cover"
                                                  onError={(e) => {
                                                    e.currentTarget.src = '/placeholder.svg';
                                                  }}
                                                />
                                              </div>
                                            )}
                                            {/* Product Details */}
                                            <div className="flex-1 min-w-0">
                                              <p className="text-sm font-medium text-gray-900 truncate">{item.name || 'Unnamed Item'}</p>
                                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                                {item.category && (
                                                  <span className="text-xs text-gray-500">
                                                    <span className="font-medium">Category:</span> {item.category}
                                                  </span>
                                                )}
                                                {item.subcategory && (
                                                  <span className="text-xs text-gray-500">
                                                    <span className="font-medium">Type:</span> {item.subcategory}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            {/* Pricing */}
                                            <div className="text-right flex-shrink-0 ml-4">
                                              <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                                                ₱{((item.price || 0) * (item.quantity || 1)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                              </p>
                                              <p className="text-xs text-gray-500">
                                                {item.quantity || 1}x ₱{(item.price || 0).toFixed(2)}
                                              </p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Fees Breakdown */}
                                <div className="mt-4 pt-4 border-t border-gray-200">
                                  <div className="space-y-2 text-sm">
                                    <div className="flex justify-between text-gray-600">
                                      <span>Subtotal</span>
                                      <span>₱{(order.summary?.subtotal || 0).toFixed(2)}</span>
                                    </div>
                                    {order.summary?.sellerShippingCharge !== undefined && (
                                      <div className="flex justify-between text-gray-600">
                                        <span>Shipping Charge</span>
                                        <span>₱{(order.summary.sellerShippingCharge || 0).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {order.feesBreakdown?.paymentProcessingFee !== undefined && (
                                      <div className="flex justify-between text-red-600 text-xs">
                                        <span>Payment Processing Fee</span>
                                        <span>-₱{(order.feesBreakdown.paymentProcessingFee || 0).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {order.feesBreakdown?.platformFee !== undefined && (
                                      <div className="flex justify-between text-red-600 text-xs">
                                        <span>Platform Fee</span>
                                        <span>-₱{(order.feesBreakdown.platformFee || 0).toFixed(2)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Footer */}
                  <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
                    <button
                      onClick={() => {
                        const now = new Date();
                        const exportDate = now.toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        });
                        const exportTime = now.toLocaleTimeString('en-US', { 
                          hour: '2-digit', 
                          minute: '2-digit', 
                          second: '2-digit',
                          hour12: true 
                        });
                        
                        const totalOrders = sellerOrders.length;
                        const totalRevenue = sellerOrders.reduce((sum, o) => sum + (o.summary?.subtotal || 0), 0);
                        const totalShipping = sellerOrders.reduce((sum, o) => sum + (o.summary?.sellerShippingCharge || 0), 0);
                        const totalPaymentFees = sellerOrders.reduce((sum, o) => sum + (o.feesBreakdown?.paymentProcessingFee || 0), 0);
                        const totalPlatformFees = sellerOrders.reduce((sum, o) => sum + (o.feesBreakdown?.platformFee || 0), 0);
                        
                        const headerSection = [
                          ['Order Summary Report'],
                          [''],
                          ['Seller:', selectedSellerForOrders.name],
                          ['Export Date:', exportDate],
                          ['Export Time:', exportTime],
                          ['Total Orders:', totalOrders.toString()],
                          [''],
                          ['Summary:'],
                          ['Total Revenue:', `₱${totalRevenue.toFixed(2)}`],
                          ['Total Shipping:', `₱${totalShipping.toFixed(2)}`],
                          ['Total Payment Fees:', `₱${totalPaymentFees.toFixed(2)}`],
                          ['Total Platform Fees:', `₱${totalPlatformFees.toFixed(2)}`],
                          ['Net Amount:', `₱${(totalRevenue - totalPaymentFees - totalPlatformFees).toFixed(2)}`],
                          [''],
                          [''], 
                        ];
                        
                        const headers = ['Order ID', 'Status', 'Customer', 'Date', 'Items', 'Payment', 'Payment Status', 'Location', 'Subtotal', 'Shipping', 'Payment Fee', 'Platform Fee'];
                        const rows = sellerOrders.map(o => [
                          o.id,
                          o.status,
                          o.customer?.name || 'N/A',
                          o.timestamp ? new Date(o.timestamp).toLocaleDateString() : 'N/A',
                          o.items?.map(i => `${i.name} (${i.quantity}x)`).join('; ') || 'N/A',
                          o.feesBreakdown?.paymentMethod || o.paymentType || 'N/A',
                          (o as any).paymongo?.paymentStatus || 'N/A',
                          o.region ? [o.region.municipality, o.region.province].filter(Boolean).join(', ') : 'N/A',
                          (o.summary?.subtotal || 0).toFixed(2),
                          (o.summary?.sellerShippingCharge || 0).toFixed(2),
                          (o.feesBreakdown?.paymentProcessingFee || 0).toFixed(2),
                          (o.feesBreakdown?.platformFee || 0).toFixed(2),
                        ]);
                        
                        const csvContent = [
                          ...headerSection.map(row => row.map(cell => `"${cell}"`).join(',')),
                          headers.map(cell => `"${cell}"`).join(','),
                          ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
                        ].join('\n');
                        
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = `order-summary-${selectedSellerForOrders.name.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().slice(0,10)}.csv`;
                        link.click();
                      }}
                      disabled={sellerOrders.length === 0}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          setShowOrderSummaryModal(false);
                          setSelectedSellerForOrders(null);
                          setSellerOrders([]);
                          setExpandedOrderIds(new Set()); 
                        }}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      case 'seller-orders':
        if (!isAllowed('seller-orders')) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <OrderTab
            orders={confirmationOrders}
            loading={loading}
            error={error}
            onRefresh={() => {/* listener keeps it live; left for future manual refresh */}}
          />
        );
      case 'product-qc':
        if (!isAllowed('product-qc')) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <ProductQCTab />;
      case "profile":
        if (!isAllowed("profile")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <SellerProfileTab />;
      case "reports":
        if (!isAllowed("reports")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <ReportsTab />;
      case "booking":
        if (!isAllowed("booking")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <Booking />;
      case "confirmation":
        if (!isAllowed("confirmation")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <ConfirmationTab 
            orders={confirmationOrders}
            loading={loading}
            error={error}
            setError={setError}
            onConfirmOrder={handleConfirmOrder}
            onRejectOrder={handleRejectOrder}
            onExportConfirmations={handleExportConfirmations}
            onTabChange={handleTabChange}
          />
        );
      case "withdrawal":
        if (!isAllowed("withdrawal")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        if (!isAdmin) {
          return (
            <SellerWithdrawalTab
              financialMetrics={financialMetrics}
              sellerFilters={sellerFilters}
              onFiltersChange={setSellerFilters}
              loading={loading}
            />
          );
        }
        return (
          <WithdrawalTab 
            loading={loading}
            error={error}
            setError={setError}
            onApproveWithdrawal={handleApproveWithdrawal}
            onRejectWithdrawal={handleRejectWithdrawal}
            onExportWithdrawals={handleExportWithdrawals}
            onTabChange={handleTabChange}
          />
        );
      case "access":
        if (!isAllowed("access")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <AccessTab 
            loading={loading}
            error={error}
            setError={setError}
            onTabChange={handleTabChange}
          />
        );
      case "sub-accounts":
        return (
          <AccessTab 
            loading={loading}
            error={error}
            setError={setError}
            onTabChange={handleTabChange}
          />
        );
      case "images":
        if (!isAllowed("images")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <ImagesTab 
            loading={loading}
            error={error}
            setError={setError}
            onTabChange={handleTabChange}
          />
        );
      case "users":
        if (!isAllowed("users")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <UsersTab />
        );
      case "inventory":
      case "inventory-history":
        if (!isAllowed("inventory")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <InventoryTab activeView="history" />
        );
      case "inventory-all":
        if (!isAllowed("inventory")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <InventoryTab activeView="all" />
        );
      case "stock-adjustment":
        if (!isAllowed("inventory")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return (
          <InventoryTab activeView="stock-adjustment" />
        );
      case "items":
        if (!isAllowed("add-product")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <ItemsView />;
      case "items-all":
        if (!isAllowed("add-product")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <ItemsAll />;
      case "items-list":
        if (!isAllowed("add-product")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <ItemsList />;
      case "items-add":
        if (!isAllowed("add-product")) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <AddItem />;
      case 'warranty':
        if (!isAdmin) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <WarrantyManager />;
      case 'categories':
        if (!isAdmin) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <CategoryManager />;
      case "policies":
        if (!isAdmin) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <PoliciesTab />;
      case 'chats':
        if (!isAllowed('chats')) return <div className="p-6 bg-white rounded-xl border">Access denied</div>;
        return <ChatsTab isSeller={!isAdmin} currentUserId={uid || undefined} />;
      default:
        return null;
    }
  };

  const getPageTitle = () => {
    switch (activeItem) {
      case "dashboard": 
        return isAdmin ? "Dashboard" : "Sales";
      case "policies":
        return "Terms & Policies";
      case "confirmation": return "Confirmation";
      case "withdrawal": return "Withdrawal";
      case "access": return "Access";
      case 'seller-orders': return 'Orders';
      case 'reports': return 'Reports'; 
      case 'product-qc': return 'Pending QC';
      case "sub-accounts": return "Sub Account";
      case "images": return "Images";
      case "users": return "Users";
      case 'warranty': return 'Warranty';
      case 'categories': return 'Categories';
      case 'chats': return 'Chats';
      case 'inventory':
      case 'inventory-all': return 'Inventory - All Products';
      case 'inventory-history': return 'Inventory - History';
      case 'inventory-control': return 'Inventory Control';
      case 'stock-adjustment': return 'Stock Adjustment';
      // Removed: Price Management
      case 'item-management': return 'Item Management';
      case 'items': return 'Items';
      case 'items-all': return 'Items - All';
      case 'items-list': return 'Items - Item List';
      case 'items-add': return 'Items - Add Item';
      default: return "Dashboard";
    }
  };

  const getPageSubtitle = () => {
    switch (activeItem) {
      case "dashboard":
        if (!isAdmin) {
          return `Welcome back, ${user.name || user.email}`;
        }
        return `Welcome back, ${user.name || user.email}`;
      case "policies":
        return "Add and manage your platform's terms, conditions, and policies here.";
      case "profile":
        return "Manage seller profile, documents, and security";
      case "reports":
        return "Sales analytics by brand, category, item, and payment type";
      case "booking":
        return "Manage dental appointments and bookings";
      case 'seller-orders':
        return 'Manage seller order statuses and actions';
      case 'product-qc':
        return 'Review and approve products pending quality control';
      case "confirmation":
        return "Review and confirm patient appointments";
      case "withdrawal":
        return "Manage payment withdrawals and financial transactions";
      case "access":
        return "Control user access and system permissions";
      case "sub-accounts":
        return "Create and manage seller sub-accounts";
      case "images":
        return "Manage banners and promotional images";
      case "users":
        return "Manage patients, staff, and user accounts";
      case 'warranty':
        return 'Set warranty durations by category and subcategory';
      case 'categories':
        return 'Create, rename, and delete categories and their subcategories';
      case 'chats':
        return 'Message with buyers and sellers';
      default:
        return "";
    }
  };

  useEffect(() => {
    if (!uid) {
      console.log('[Dashboard] No UID, skipping order subscription');
      return;
    }
    console.log('[Dashboard] Setting up order subscription for:', { uid, isAdmin, isSubAccount, parentId });
    let unsub: (() => void) | undefined;
    if (isAdmin) {
      unsub = OrdersService.listenAll((orders) => {
        setConfirmationOrders(orders);
      });
    } else if (isSubAccount && parentId) {
      unsub = OrdersService.listenBySeller(parentId, (orders) => {
        setConfirmationOrders(orders);
      });
    } else {
      unsub = OrdersService.listenBySeller(uid, (orders) => {
        setConfirmationOrders(orders);
      });
    }
    return () => {
      unsub && unsub();
    };
  }, [isAdmin, isSubAccount, parentId, uid]);
  
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const rows = await getPhProvinces();
      
      const hasMetroManila = rows.some(p => 
        p.name.toLowerCase().includes('metro manila') || 
        p.code === 'NCR' ||
        p.code === 'METRO_MANILA'
      );
      
      if (!hasMetroManila) {
        rows.unshift({ code: 'METRO_MANILA', name: 'Metro Manila' });
        console.log('[Dashboard] Added Metro Manila to province list');
      }
      
      setPhProvinces(rows);
    })();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const provinceCode = adminFilters.province;
    if (!provinceCode || provinceCode === 'all') { setPhCities([]); return; }
    
    (async () => {
      if (provinceCode === 'METRO_MANILA') {
        const metroCities = [
          { code: "MNL", name: "Manila", provinceCode: "NCR" },
          { code: "MAC", name: "Makati", provinceCode: "NCR" },
          { code: "TAG", name: "Taguig", provinceCode: "NCR" },
          { code: "QSZ", name: "Quezon City", provinceCode: "NCR" },
          { code: "PAS", name: "Pasay", provinceCode: "NCR" },
          { code: "PAR", name: "Parañaque", provinceCode: "NCR" },
          { code: "MAN", name: "Mandaluyong", provinceCode: "NCR" },
          { code: "SAN", name: "San Juan", provinceCode: "NCR" },
          { code: "CAL", name: "Caloocan", provinceCode: "NCR" },
          { code: "VAL", name: "Valenzuela", provinceCode: "NCR" },
          { code: "NAV", name: "Navotas", provinceCode: "NCR" },
          { code: "MUN", name: "Muntinlupa", provinceCode: "NCR" },
          { code: "LAS", name: "Las Piñas", provinceCode: "NCR" },
          { code: "MAR", name: "Marikina", provinceCode: "NCR" },
          { code: "PAT", name: "Pateros", provinceCode: "NCR" },
          { code: "PAS2", name: "Pasig", provinceCode: "NCR" },
        ].sort((a, b) => a.name.localeCompare(b.name));
        
        console.log(`[Dashboard] Loaded ${metroCities.length} cities for Metro Manila`);
        setPhCities(metroCities);
        return;
      }
      
      try {
        const rows = await getPhCitiesAsync(provinceCode);
        console.log(`[Dashboard] Loaded ${rows.length} cities for province ${provinceCode}`);
        setPhCities(rows);
      } catch (error) {
        console.error('[Dashboard] Failed to load cities:', error);
        setPhCities([]);
      }
    })();
  }, [adminFilters.province, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const sellersSnap = await getDocs(collection(db, 'Seller'));
        console.log('[Dashboard] Total Seller documents fetched:', sellersSnap.docs.length);
        
        const allSellers = sellersSnap.docs.map(doc => {
          const data = doc.data();
          const storeName = data.vendor?.company?.storeName || '';
          const role = data.role || '';
          const address = data.vendor?.company?.address || {};
          const province = address.province || '';
          const city = address.city || address.municipality || '';
          const zipCode = address.zipCode || address.zip || '';
          
          return {
            uid: doc.id,
            name: data.name || data.ownerName || data.displayName || '',
            shopName: data.shopName || data.storeName || data.businessName || '',
            storeName: storeName, 
            role: role,
            province: province,
            city: city,
            zipCode: zipCode,
            address: address, 
          };
        });
        
        const sellers = allSellers.filter(seller => seller.role !== 'admin');
        
        console.log('[Dashboard] All sellers:', allSellers.length);
        console.log('[Dashboard] Filtered sellers (excluding admins):', sellers.length);
        console.log('[Dashboard] Seller details with addresses:', sellers.map(s => ({ 
          uid: s.uid, 
          storeName: s.storeName, 
          role: s.role,
          province: s.province,
          city: s.city,
          zipCode: s.zipCode
        })));
        
        if (!cancelled) {
          setAdminSellers(sellers);
        }
      } catch (error) {
        console.error('[Dashboard] Error loading sellers:', error);
        if (!cancelled) {
          setAdminSellers([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    
    const filteredOrdersForMetrics = confirmationOrders.filter(order => {
      if (adminFilters.dateFrom && adminFilters.dateTo) {
        const orderDate = order.timestamp ? order.timestamp.slice(0, 10) : ''; 
        if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) {
          return false;
        }
      }
      
      if (adminFilters.province !== 'all') {
        const orderProvinceCode = order.region?.province;
        if (orderProvinceCode !== adminFilters.province) {
          return false;
        }
      }
      
      if (adminSelectedCityCodes.size > 0) {
        const orderCity = order.region?.municipality;
        const matchingCity = phCities.find(c => c.name === orderCity);
        if (!matchingCity || !adminSelectedCityCodes.has(matchingCity.code)) {
          return false;
        }
      }
      
      if (adminFilters.seller !== 'all') {
        const orderSellerIds = order.sellerIds || [];
        const isSeller = orderSellerIds.includes(adminFilters.seller);
        if (!isSeller) {
          return false;
        }
      }
      
      return true;
    });
    
    const totalOrders = filteredOrdersForMetrics.length;
    
    const deliveredOrders = filteredOrdersForMetrics.filter(order => order.status === 'completed').length;
    
    const shippedOrders = filteredOrdersForMetrics.filter(order => {
      if (order.statusHistory && Array.isArray(order.statusHistory)) {
        return order.statusHistory.some(history => 
          history.status === 'shipping' || history.status === 'shipped'
        );
      }
      // Fallback: check current status if no statusHistory
      return order.status === 'shipping' || order.status === 'shipped';
    }).length;
    
    setAdminMetrics({ totalOrders, deliveredOrders, shippedOrders });
    console.log('[Dashboard] Admin metrics calculated:', { 
      totalOrders, 
      deliveredOrders, 
      shippedOrders,
      filters: adminFilters,
      selectedCities: Array.from(adminSelectedCityCodes),
      totalBeforeFilter: confirmationOrders.length 
    });
  }, [isAdmin, confirmationOrders, adminFilters, adminSelectedCityCodes, phCities]);

  // Seller date picker refs/state (fix ReferenceError)
  const sellerDateDropdownRef = useRef<HTMLDivElement | null>(null);
  const [showSellerDatePicker, setShowSellerDatePicker] = useState(false);
  const [sellerCalendarMonth, setSellerCalendarMonth] = useState<Date>(new Date());
  const [sellerRange, setSellerRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const sellerDaysInMonth = (month: Date) => new Date(month.getFullYear(), month.getMonth()+1, 0).getDate();
  const sellerFirstWeekday = (month: Date) => new Date(month.getFullYear(), month.getMonth(), 1).getDay(); // 0=Sun
  const isSellerInRange = (day: Date) => {
    const { start, end } = sellerRange;
    if (!start) return false;
    if (start && !end) return day.getTime() === start.getTime();
    if (start && end) return day >= start && day <= end;
    return false;
  };
  const handleSellerDayClick = (day: Date) => {
    setSellerRange(prev => {
      if (!prev.start || (prev.start && prev.end)) return { start: day, end: null };
      if (day < prev.start) return { start: day, end: prev.start };
      return { start: prev.start, end: day };
    });
  };
  const applySellerRange = () => {
    const start = sellerRange.start;
    const end = sellerRange.end || sellerRange.start;
    if (!start || !end) return;
    setSellerFilters(f => ({ ...f, dateRange: `custom:${toISO(start)}:${toISO(end as Date)}` }));
    setShowSellerDatePicker(false);
  };
  const applySellerPreset = (preset: 'today' | '7' | '30') => {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let start = new Date(end);
    if (preset === '7') start = new Date(end.getTime() - 6*86400000);
    if (preset === '30') start = new Date(end.getTime() - 29*86400000);
    if (preset === 'today') start = end;
    setSellerRange({ start, end });
    setSellerCalendarMonth(new Date(end.getFullYear(), end.getMonth(), 1));
    if (preset === 'today') {
      setSellerFilters(f => ({ ...f, dateRange: `custom:${toISO(start)}:${toISO(end)}` }));
    } else {
      setSellerFilters(f => ({ ...f, dateRange: `last-${preset}` }));
    }
  };
  useEffect(() => {
    if (!showSellerDatePicker) return;
    const handler = (e: MouseEvent) => {
      if (!sellerDateDropdownRef.current) return;
      if (!sellerDateDropdownRef.current.contains(e.target as Node)) setShowSellerDatePicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSellerDatePicker]);

  // Reset selected cities when province changes
  useEffect(() => {
    setAdminSelectedCityCodes(new Set());
  }, [adminFilters.province]);

  // Admin City dropdown popover useEffect
  useEffect(() => {
    if (!showAdminCityDropdown) return;
    const handler = (e: MouseEvent) => {
      if (!adminCityDropdownRef.current) return;
      if (!adminCityDropdownRef.current.contains(e.target as Node)) setShowAdminCityDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAdminCityDropdown]);

  // Derived admin seller rows based on Shop Name filter
  const adminSellersDisplayed = useMemo(() => {
    // If no date filter is applied, show all sellers (or filtered by seller dropdown)
    const hasDateFilter = adminFilters.dateFrom && adminFilters.dateTo;
    const hasProvinceFilter = adminFilters.province !== 'all';
    const hasCityFilter = adminSelectedCityCodes.size > 0;
    const hasAnyFilter = hasDateFilter || hasProvinceFilter || hasCityFilter;
    
    // Start with all sellers or filtered by seller dropdown
    let sellers = adminSellers;
    const sel = adminFilters.seller;
    if (sel && sel !== 'all') {
      sellers = adminSellers.filter(s => s.uid === sel);
    }
    
    // Apply province/city filter on sellers FIRST (based on seller address)
    if (hasProvinceFilter) {
      sellers = sellers.filter(seller => {
        // Match by province name (case-insensitive)
        const sellerProvince = seller.province || '';
        const filterProvince = phProvinces.find(p => p.code === adminFilters.province)?.name || '';
        return sellerProvince.toLowerCase() === filterProvince.toLowerCase();
      });
      console.log('[Dashboard] After province filter:', sellers.length, 'sellers');
    }
    
    if (hasCityFilter) {
      sellers = sellers.filter(seller => {
        const sellerCity = seller.city || '';
        // Check if seller's city matches any selected city
        return Array.from(adminSelectedCityCodes).some(cityCode => {
          const city = phCities.find(c => c.code === cityCode);
          return city && sellerCity.toLowerCase() === city.name.toLowerCase();
        });
      });
      console.log('[Dashboard] After city filter:', sellers.length, 'sellers');
    }
    
    // If date filter is applied, further filter sellers who have orders in that date range
    if (hasDateFilter) {
      sellers = sellers.filter(seller => {
        // Check if this seller has any orders matching the date filter
        const hasMatchingOrders = confirmationOrders.some(o => {
          // Check if order belongs to this seller
          const orderSellerIds = o.sellerIds || [];
          if (!orderSellerIds.includes(seller.uid)) return false;
          
          // Apply date range filter
          if (adminFilters.dateFrom && adminFilters.dateTo) {
            const orderDate = o.timestamp ? o.timestamp.slice(0, 10) : '';
            if (orderDate < adminFilters.dateFrom || orderDate > adminFilters.dateTo) {
              return false;
            }
          }
          
          // Only count PAID orders
          if (!isPaidStatus(o.status)) return false;
          
          return true;
        });
        
        return hasMatchingOrders;
      });
      console.log('[Dashboard] After date filter:', sellers.length, 'sellers');
    }
    
    console.log('[Dashboard] Final filtered sellers:', sellers.map(s => ({
      uid: s.uid,
      name: s.storeName || s.name,
      province: s.province,
      city: s.city
    })));
    
    return sellers;
  }, [adminFilters.seller, adminFilters.dateFrom, adminFilters.dateTo, adminFilters.province, adminSelectedCityCodes, adminSellers, confirmationOrders, phCities, phProvinces]);

  // END useMemo for adminSellersDisplayed

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar
        activeItem={activeItem}
        onItemClick={handleItemClick}
        onLogout={onLogout}
      />
      <div className="flex-1 flex flex-col">
        <DashboardHeader
          title={getPageTitle()}
          subtitle={getPageSubtitle()}
        />
        <main className="flex-1 p-6 animate-fade-in">
          {/* Notification will handle prompting; no inline prompt here */}
          {getPageContent()}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;