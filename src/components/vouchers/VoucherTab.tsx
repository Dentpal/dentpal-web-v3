import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Edit3, Search, Ticket, Copy, Check, CopyPlus,
  StopCircle, Trash2, CalendarPlus, ChevronUp, ChevronDown,
  ArrowUpDown, Truck, Percent, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import {
  createVoucher,
  getSellerVouchers,
  updateVoucher,
  deleteVoucher,
  cloneVoucher,
  bulkEndVouchers,
  bulkDeleteVouchers,
  bulkExtendExpiry,
} from '@/services/voucher';
import type { Voucher, CreateVoucherInput, DiscountType, VoucherScope } from '@/types/voucher';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

const ITEMS_PER_PAGE = 10;

type DerivedStatus = 'active' | 'upcoming' | 'expired' | 'nearly_exhausted' | 'inactive';
type TabFilter = 'all' | 'active' | 'upcoming' | 'expired';
type SortField = 'validity' | 'usage' | 'value' | null;
type SortDir = 'asc' | 'desc';

const deriveStatus = (v: Voucher): DerivedStatus => {
  if (v.status === 'inactive') return 'inactive';
  const now = new Date();
  if (new Date(v.endDate) < now) return 'expired';
  if (new Date(v.startDate) > now) return 'upcoming';
  if (v.maxUses > 0 && v.usedCount >= v.maxUses * 0.9) return 'nearly_exhausted';
  return 'active';
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

const getCountdown = (iso: string): string => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Now';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `in ${days}d ${hours}h`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `in ${hours}h ${mins}m`;
};

/** Value column — shows the concrete discount e.g. "20%", "₱500", "Free Delivery" */
const discountDisplayValue = (v: Voucher): string => {
  if (v.discountType === 'free_delivery') return 'Free Delivery';
  if (v.discountType === 'percentage') return `${v.discountValue}%`;
  return `₱${v.discountValue.toLocaleString()}`;
};

/** Type column — short category label, no symbols that duplicate the Value column */
const discountTypeLabel = (t: DiscountType): string => {
  if (t === 'free_delivery') return 'Free Delivery';
  if (t === 'percentage') return 'Percent Off';
  return 'Peso Off';
};

const discountTypeIcon = (t: DiscountType) => {
  if (t === 'free_delivery') return <Truck className="w-3.5 h-3.5" />;
  if (t === 'percentage') return <Percent className="w-3.5 h-3.5" />;
  return <span className="text-xs font-semibold">₱</span>;
};

const VoucherTab = () => {
  const { uid, isSubAccount, parentId } = useAuth();
  const sellerId = (isSubAccount && parentId) ? parentId : uid;

  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);
  const [detailVoucher, setDetailVoucher] = useState<Voucher | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Tab / Filters
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  // Sorting
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Selection / Bulk
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkExtendModal, setShowBulkExtendModal] = useState(false);
  const [bulkExtendDate, setBulkExtendDate] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDiscountType, setFormDiscountType] = useState<DiscountType>('percentage');
  const [formDiscountValue, setFormDiscountValue] = useState('');
  const [formMaximumSpend, setFormMaximumSpend] = useState('');
  const [formMinOrder, setFormMinOrder] = useState('');
  const [formMaxUses, setFormMaxUses] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formScope, setFormScope] = useState<VoucherScope>('all');

  const fetchVouchers = useCallback(async () => {
    if (!sellerId) return;
    setLoading(true);
    try {
      const data = await getSellerVouchers(sellerId);
      setVouchers(data);
    } catch {
      setError('Failed to load vouchers');
    } finally {
      setLoading(false);
    }
  }, [sellerId]);

  useEffect(() => {
    fetchVouchers();
  }, [fetchVouchers]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts = { all: 0, active: 0, upcoming: 0, expired: 0 };
    vouchers.forEach((v) => {
      counts.all++;
      const s = deriveStatus(v);
      if (s === 'active' || s === 'nearly_exhausted') counts.active++;
      else if (s === 'upcoming') counts.upcoming++;
      else if (s === 'expired') counts.expired++;
    });
    return counts;
  }, [vouchers]);

  // Filter + search + sort
  const filtered = useMemo(() => {
    let result = vouchers.filter((v) => {
      const s = deriveStatus(v);
      if (activeTab === 'active' && s !== 'active' && s !== 'nearly_exhausted') return false;
      if (activeTab === 'upcoming' && s !== 'upcoming') return false;
      if (activeTab === 'expired' && s !== 'expired') return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!v.code.toLowerCase().includes(q) && !v.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (sortField) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortField === 'validity') cmp = new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
        else if (sortField === 'usage') {
          const aRatio = a.maxUses > 0 ? a.usedCount / a.maxUses : a.usedCount;
          const bRatio = b.maxUses > 0 ? b.usedCount / b.maxUses : b.usedCount;
          cmp = aRatio - bRatio;
        } else if (sortField === 'value') cmp = a.discountValue - b.discountValue;
        return sortDir === 'desc' ? -cmp : cmp;
      });
    }

    return result;
  }, [vouchers, activeTab, searchQuery, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Selection helpers
  const allOnPageSelected = paginated.length > 0 && paginated.every((v) => selectedIds.has(v.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      const next = new Set(selectedIds);
      paginated.forEach((v) => next.delete(v.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      paginated.forEach((v) => next.add(v.id));
      setSelectedIds(next);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />;
  };

  // Form helpers
  const resetForm = () => {
    setFormName('');
    setFormCode('');
    setFormDiscountType('percentage');
    setFormDiscountValue('');
    setFormMaximumSpend('');
    setFormMinOrder('');
    setFormMaxUses('');
    setFormStartDate('');
    setFormEndDate('');
    setFormScope('all');
    setError(null);
  };

  const openCreateModal = () => {
    setEditingVoucher(null);
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (v: Voucher) => {
    setEditingVoucher(v);
    setFormName(v.name);
    setFormCode(v.code);
    setFormDiscountType(v.discountType);
    setFormDiscountValue(v.discountType === 'free_delivery' ? '0' : String(v.discountValue));
    setFormMaximumSpend(v.maximumSpend ? String(v.maximumSpend) : '');
    setFormMinOrder(String(v.minimumOrderAmount));
    setFormMaxUses(String(v.maxUses));
    setFormStartDate(v.startDate.slice(0, 10));
    setFormEndDate(v.endDate.slice(0, 10));
    setFormScope(v.scope);
    setError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!sellerId) return;
    setError(null);

    const name = formName.trim();
    if (!name) { setError('Voucher name is required'); return; }

    const code = formCode.toUpperCase().trim();
    if (!code) { setError('Voucher code is required'); return; }
    if (code.length < 3) { setError('Code must be at least 3 characters'); return; }

    let discountValue = 0;
    if (formDiscountType !== 'free_delivery') {
      discountValue = parseFloat(formDiscountValue);
      if (isNaN(discountValue) || discountValue <= 0) { setError('Discount value must be greater than 0'); return; }
      if (formDiscountType === 'percentage' && discountValue > 100) { setError('Percentage cannot exceed 100'); return; }
    }

    let maximumSpend: number | undefined;
    if (formDiscountType === 'percentage' && formMaximumSpend) {
      maximumSpend = parseFloat(formMaximumSpend);
      if (isNaN(maximumSpend) || maximumSpend <= 0) { setError('Maximum spend must be greater than 0'); return; }
    }

    const minimumOrderAmount = parseFloat(formMinOrder) || 0;
    const maxUses = parseInt(formMaxUses) || 0;

    if (!formStartDate || !formEndDate) { setError('Start and end dates are required'); return; }
    if (new Date(formEndDate) <= new Date(formStartDate)) { setError('End date must be after start date'); return; }

    setSaving(true);
    const input: CreateVoucherInput = {
      name,
      code,
      discountType: formDiscountType,
      discountValue,
      ...(maximumSpend !== undefined ? { maximumSpend } : {}),
      minimumOrderAmount,
      maxUses,
      startDate: new Date(formStartDate).toISOString(),
      endDate: new Date(formEndDate).toISOString(),
      scope: formScope,
    };

    let result;
    if (editingVoucher) {
      result = await updateVoucher(sellerId, editingVoucher.id, input);
    } else {
      result = await createVoucher(sellerId, input);
    }

    setSaving(false);
    if (!result.success) {
      setError(result.error || 'Failed to save voucher');
      return;
    }

    setShowModal(false);
    fetchVouchers();
  };

  const handleEndEarly = async (v: Voucher) => {
    if (!sellerId) return;
    await updateVoucher(sellerId, v.id, { status: 'inactive' });
    fetchVouchers();
  };

  const handleClone = async (v: Voucher) => {
    if (!sellerId) return;
    const result = await cloneVoucher(sellerId, v);
    if (result.success) fetchVouchers();
    else setError(result.error || 'Failed to clone voucher');
  };

  const handleDelete = async (id: string) => {
    if (!sellerId) return;
    await deleteVoucher(sellerId, id);
    setConfirmDeleteId(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    fetchVouchers();
  };

  const handleBulkEnd = async () => {
    if (!sellerId || selectedIds.size === 0) return;
    setBulkLoading(true);
    await bulkEndVouchers(sellerId, Array.from(selectedIds));
    setSelectedIds(new Set());
    setBulkLoading(false);
    fetchVouchers();
  };

  const handleBulkDelete = async () => {
    if (!sellerId || selectedIds.size === 0) return;
    setBulkLoading(true);
    await bulkDeleteVouchers(sellerId, Array.from(selectedIds));
    setSelectedIds(new Set());
    setBulkLoading(false);
    fetchVouchers();
  };

  const handleBulkExtend = async () => {
    if (!sellerId || selectedIds.size === 0 || !bulkExtendDate) return;
    setBulkLoading(true);
    await bulkExtendExpiry(sellerId, Array.from(selectedIds), new Date(bulkExtendDate).toISOString());
    setSelectedIds(new Set());
    setBulkLoading(false);
    setShowBulkExtendModal(false);
    setBulkExtendDate('');
    fetchVouchers();
  };

  const handleCopyCode = (code: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Status badge
  const statusBadge = (v: Voucher) => {
    const s = deriveStatus(v);
    switch (s) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>;
      case 'inactive':
        return <Badge className="bg-gray-100 text-gray-600 border-gray-200">Inactive</Badge>;
      case 'expired':
        return <Badge className="bg-red-100 text-red-700 border-red-200">Expired</Badge>;
      case 'upcoming':
        return (
          <div className="flex flex-col gap-0.5">
            <Badge className="bg-blue-100 text-blue-700 border-blue-200">Upcoming</Badge>
            <span className="text-[10px] text-blue-500">{getCountdown(v.startDate)}</span>
          </div>
        );
      case 'nearly_exhausted':
        return <Badge className="bg-orange-100 text-orange-700 border-orange-200">Nearly Exhausted</Badge>;
      default:
        return <Badge variant="outline">{s}</Badge>;
    }
  };

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'expired', label: 'Expired' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ticket className="w-5 h-5 text-gray-600" />
          <span className="text-lg font-semibold text-gray-900">Vouchers</span>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Create Voucher
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setPage(1); setSelectedIds(new Set()); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === t.key ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {tabCounts[t.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search voucher name or code..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-green-50 border border-green-200 rounded-lg">
          <span className="text-sm font-medium text-green-800">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handleBulkEnd}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <StopCircle className="w-3.5 h-3.5" /> End Selected
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button
              onClick={() => setShowBulkExtendModal(true)}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <CalendarPlus className="w-3.5 h-3.5" /> Extend Expiry
            </button>
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 hover:text-gray-600 ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
        </div>
      ) : vouchers.length === 0 ? (
        /* Empty state - no vouchers at all */
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <Ticket className="w-10 h-10 text-gray-300" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800 mb-1">No vouchers yet</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-xs text-center">
            Create discount vouchers to attract more buyers and boost your sales.
          </p>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Create Your First Voucher
          </button>
        </div>
      ) : filtered.length === 0 ? (
        /* Empty state - filter mismatch */
        <div className="text-center py-12 bg-white rounded-xl border">
          <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No vouchers match your search or filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Voucher Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    <button onClick={() => handleSort('value')} className="flex items-center hover:text-gray-900">
                      Value <SortIcon field="value" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Min. Spend</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    <button onClick={() => handleSort('validity')} className="flex items-center hover:text-gray-900">
                      Validity <SortIcon field="validity" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    <button onClick={() => handleSort('usage')} className="flex items-center hover:text-gray-900">
                      Usage <SortIcon field="usage" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((v) => {
                  const s = deriveStatus(v);
                  return (
                    <tr
                      key={v.id}
                      className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setDetailVoucher(v)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(v.id)}
                          onChange={() => toggleSelect(v.id)}
                          className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium text-gray-900">{v.name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-xs text-gray-500">{v.code}</span>
                            <button
                              onClick={(e) => handleCopyCode(v.code, e)}
                              className="text-gray-400 hover:text-gray-600"
                              title="Copy code"
                            >
                              {copiedCode === v.code ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-gray-600">
                          {discountTypeIcon(v.discountType)}
                          <span className="text-xs">{discountTypeLabel(v.discountType)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {discountDisplayValue(v)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {v.minimumOrderAmount > 0 ? `₱${v.minimumOrderAmount.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        <div>{formatDate(v.startDate)}</div>
                        <div className="text-gray-400">to {formatDate(v.endDate)}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex items-center gap-2">
                          <span>{v.usedCount} / {v.maxUses > 0 ? v.maxUses : '∞'}</span>
                          {v.maxUses > 0 && (
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  v.usedCount >= v.maxUses ? 'bg-red-400' :
                                  v.usedCount >= v.maxUses * 0.9 ? 'bg-orange-400' : 'bg-green-400'
                                }`}
                                style={{ width: `${Math.min(100, (v.usedCount / v.maxUses) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{statusBadge(v)}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditModal(v)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="Edit"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {(s === 'active' || s === 'nearly_exhausted' || s === 'upcoming') && (
                            <button
                              onClick={() => handleEndEarly(v)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-600"
                              title="End Early"
                            >
                              <StopCircle className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleClone(v)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="Clone"
                          >
                            <CopyPlus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(v.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <span className="text-xs text-gray-500">
                Page {page} of {totalPages} ({filtered.length} voucher{filtered.length !== 1 ? 's' : ''})
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVoucher ? 'Edit Voucher' : 'Create Voucher'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Voucher Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Summer Sale Discount"
                maxLength={60}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Code */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Voucher Code</label>
              <input
                type="text"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                placeholder="e.g. SAVE20"
                maxLength={20}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono uppercase"
              />
            </div>

            {/* Discount Type & Value */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type</label>
                <select
                  value={formDiscountType}
                  onChange={(e) => setFormDiscountType(e.target.value as DiscountType)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="percentage">Percentage Off (%)</option>
                  <option value="fixed">Fixed Amount Off (₱)</option>
                  <option value="free_delivery">Free Delivery</option>
                </select>
              </div>
              {formDiscountType !== 'free_delivery' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Value {formDiscountType === 'percentage' ? '(%)' : '(₱)'}
                  </label>
                  <input
                    type="number"
                    value={formDiscountValue}
                    onChange={(e) => setFormDiscountValue(e.target.value)}
                    placeholder={formDiscountType === 'percentage' ? 'e.g. 20' : 'e.g. 100'}
                    min="0"
                    max={formDiscountType === 'percentage' ? '100' : undefined}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              )}
            </div>

            {/* Maximum Spend (only for percentage discount) */}
            {formDiscountType === 'percentage' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Maximum Spend (₱)</label>
                <input
                  type="number"
                  value={formMaximumSpend}
                  onChange={(e) => setFormMaximumSpend(e.target.value)}
                  placeholder="e.g. 500 (optional)"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            )}

            {/* Min Spend & Max Uses */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min. Spend (₱)</label>
                <input
                  type="number"
                  value={formMinOrder}
                  onChange={(e) => setFormMinOrder(e.target.value)}
                  placeholder="0 = no minimum"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Uses</label>
                <input
                  type="number"
                  value={formMaxUses}
                  onChange={(e) => setFormMaxUses(e.target.value)}
                  placeholder="0 = unlimited"
                  min="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            {/* Validity Period - Start & End Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingVoucher ? 'Update' : 'Create'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Voucher Details Modal ── */}
      <Dialog open={!!detailVoucher} onOpenChange={(open) => { if (!open) setDetailVoucher(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Voucher Details</DialogTitle>
            <DialogDescription className="sr-only">Detailed information about this voucher</DialogDescription>
          </DialogHeader>
          {detailVoucher && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 text-base">{detailVoucher.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-sm text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{detailVoucher.code}</span>
                    <button onClick={(e) => handleCopyCode(detailVoucher.code, e)} className="text-gray-400 hover:text-gray-600">
                      {copiedCode === detailVoucher.code ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                {statusBadge(detailVoucher)}
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500 text-xs mb-1">Discount</div>
                  <div className="font-medium text-gray-900">{discountDisplayValue(detailVoucher)}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500 text-xs mb-1">Min. Spend</div>
                  <div className="font-medium text-gray-900">
                    {detailVoucher.minimumOrderAmount > 0 ? `₱${detailVoucher.minimumOrderAmount.toLocaleString()}` : 'None'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500 text-xs mb-1">Usage</div>
                  <div className="font-medium text-gray-900">
                    {detailVoucher.usedCount} / {detailVoucher.maxUses > 0 ? detailVoucher.maxUses : '∞'}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500 text-xs mb-1">Scope</div>
                  <div className="font-medium text-gray-900 capitalize">{detailVoucher.scope === 'all' ? 'All Products' : 'Specific Products'}</div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <div className="text-gray-500 text-xs mb-1">Validity Period</div>
                <div className="font-medium text-gray-900">
                  {formatDate(detailVoucher.startDate)} — {formatDate(detailVoucher.endDate)}
                </div>
              </div>

              <div className="text-xs text-gray-400">
                Created {formatDate(detailVoucher.createdAt)}
                {detailVoucher.updatedAt !== detailVoucher.createdAt && ` · Updated ${formatDate(detailVoucher.updatedAt)}`}
                {(detailVoucher.createdByName || detailVoucher.createdBy) && (
                  <> · Added by <span className="text-gray-500 font-medium">{detailVoucher.createdByName || detailVoucher.createdBy}</span></>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => { setDetailVoucher(null); openEditModal(detailVoucher); }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
                <button
                  onClick={() => { handleClone(detailVoucher); setDetailVoucher(null); }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <CopyPlus className="w-4 h-4" /> Clone
                </button>
                {(deriveStatus(detailVoucher) === 'active' || deriveStatus(detailVoucher) === 'nearly_exhausted' || deriveStatus(detailVoucher) === 'upcoming') && (
                  <button
                    onClick={() => { handleEndEarly(detailVoucher); setDetailVoucher(null); }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                  >
                    <StopCircle className="w-4 h-4" /> End Early
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bulk Extend Expiry Modal ── */}
      <Dialog open={showBulkExtendModal} onOpenChange={setShowBulkExtendModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Extend Expiry</DialogTitle>
            <DialogDescription>
              Set a new end date for {selectedIds.size} selected voucher{selectedIds.size > 1 ? 's' : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">New End Date</label>
            <input
              type="date"
              value={bulkExtendDate}
              onChange={(e) => setBulkExtendDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setShowBulkExtendModal(false)}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkExtend}
              disabled={!bulkExtendDate || bulkLoading}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {bulkLoading ? 'Extending...' : 'Extend'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Delete Modal ── */}
      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Voucher</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this voucher? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmDeleteId(null)}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VoucherTab;
