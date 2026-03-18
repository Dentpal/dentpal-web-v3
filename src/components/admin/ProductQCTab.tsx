import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ProductService } from '@/services/product';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Eye, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

interface Row {
  id: string;
  sellerId?: string;
  name: string;
  description?: string;
  imageURL?: string;
  createdAt?: any;
  qcReason?: string;
}

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 });

const ProductQCTab: React.FC = () => {
  const [tab, setTab] = useState<'pending' | 'approved' | 'violation'>('pending');
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [qcTime, setQcTime] = useState<string>('');
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [approvingProduct, setApprovingProduct] = useState<{ id: string; sellerName: string } | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const [previewDetail, setPreviewDetail] = useState<null | { product: any; variations: any[] }>(null);
  const [sellerNames, setSellerNames] = useState<Record<string, string>>({});
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [priceMap, setPriceMap] = useState<Record<string, number | undefined>>({});
  const [stockMap, setStockMap] = useState<Record<string, number | undefined>>({});
  const fetchedCategoriesRef = useRef<Set<string>>(new Set());
  const { toast } = useToast();
  const { uid } = useAuth();

  // Subscribe per-tab
  useEffect(() => {
    let unsubscribe: any = null;
    if (tab === 'pending') {
      unsubscribe = ProductService.listenPendingQC((items) => {
        const mapped = items.map(({ id, data }) => ({
          id,
          sellerId: String(data.sellerId || ''),
          name: String(data.name || ''),
          description: String(data.description || ''),
          imageURL: data.imageURL || '',
          createdAt: data.createdAt,
        }));
        setRows(mapped);
      });
    } else if (tab === 'approved') {
      unsubscribe = ProductService.listenApproved((items) => {
        const mapped = items.map(({ id, data }) => ({
          id,
          sellerId: String(data.sellerId || ''),
          name: String(data.name || ''),
          description: String(data.description || ''),
          imageURL: data.imageURL || '',
          createdAt: data.createdAt,
        }));
        setRows(mapped);
      });
    } else if (tab === 'violation') {
      unsubscribe = ProductService.listenViolation((items) => {
        const mapped = items.map(({ id, data }) => ({
          id,
          sellerId: String(data.sellerId || ''),
          name: String(data.name || ''),
          description: String(data.description || ''),
          imageURL: data.imageURL || '',
          qcReason: String(data.qcReason || ''),
          createdAt: data.createdAt,
        }));
        setRows(mapped);
      });
    }
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [tab]);

  // Resolve seller names
  useEffect(() => {
    const ids = Array.from(new Set(rows.map(r => r.sellerId).filter((v): v is string => !!v)));
    const missing = ids.filter(id => !(id in sellerNames));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(missing.map(async (id) => {
        try {
          // Try Seller collection first (new schema)
          let snap = await getDoc(doc(db, 'Seller', id));
          if (snap.exists()) {
            const d: any = snap.data();
            const name = d.name || d.displayName || d.fullName || d.vendor?.company?.name || d.vendor?.contacts?.name || d.email || id;
            updates[id] = String(name);
          } else {
            // Fallback to web_users collection (legacy)
            snap = await getDoc(doc(db, 'web_users', id));
            if (snap.exists()) {
              const d: any = snap.data();
              const name = d.name || d.displayName || d.fullName || d.email || id;
              updates[id] = String(name);
            } else {
              updates[id] = id;
            }
          }
        } catch {
          updates[id] = id;
        }
      }));
      if (!cancelled) setSellerNames(prev => ({ ...prev, ...updates }));
    })();

    return () => { cancelled = true; };
  }, [rows, sellerNames]);

  // Derive product price and total stock for list view (especially Pending QC)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const targets = rows.filter(r => priceMap[r.id] === undefined || stockMap[r.id] === undefined);
      if (targets.length === 0) return;
      const updatesPrice: Record<string, number | undefined> = {};
      const updatesStock: Record<string, number | undefined> = {};
      await Promise.all(targets.map(async (r) => {
        try {
          const detail = await ProductService.getProductDetail(r.id);
          if (!detail) { updatesPrice[r.id] = undefined; updatesStock[r.id] = undefined; return; }
          const p: any = detail.product;
          const vars: any[] = Array.isArray(detail.variations) ? detail.variations : [];
          // price: prefer product.lowestPrice, else min variation price
          const varPrices = vars.map(v => Number(v.price ?? 0)).filter(n => Number.isFinite(n) && n > 0);
          const minVar = varPrices.length ? Math.min(...varPrices) : undefined;
          const price = p?.lowestPrice != null ? Number(p.lowestPrice) : (p?.price != null ? Number(p.price) : minVar);
          const totalStock = vars.reduce((s, v) => s + (Number(v.stock ?? 0) || 0), 0);
          updatesPrice[r.id] = price;
          updatesStock[r.id] = totalStock;
        } catch {
          updatesPrice[r.id] = undefined;
          updatesStock[r.id] = undefined;
        }
      }));
      if (!cancelled && (Object.keys(updatesPrice).length || Object.keys(updatesStock).length)) {
        setPriceMap(prev => ({ ...prev, ...updatesPrice }));
        setStockMap(prev => ({ ...prev, ...updatesStock }));
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(q) || r.sellerId?.toLowerCase().includes(q));
  }, [rows, search]);

  const approve = async (id: string) => {
    try {
      await ProductService.approveProduct(id);
      const at = qcTime ? new Date(qcTime).getTime() : Date.now();
      await ProductService.addQCAudit(id, { action: 'approve', at, adminId: uid || null });
      toast({ title: 'Approved', description: 'Product moved to Active.' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to approve', description: 'Please try again.' });
    }
  };

  const reject = async () => {
    if (!rejectId) return;
    try {
      await ProductService.rejectProduct(rejectId, reason);
      const at = qcTime ? new Date(qcTime).getTime() : Date.now();
      await ProductService.addQCAudit(rejectId, { action: 'reject', at, reason, adminId: uid || null });
      toast({ title: 'Rejected', description: 'Product moved to Violation.' });
      setRejectId(null);
      setReason('');
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to reject', description: 'Please try again.' });
    }
  };

  // Load preview details when preview row set
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!preview) { setPreviewDetail(null); return; }
      try {
        const detail = await ProductService.getProductDetail(preview.id);
        if (!cancelled) {
          setPreviewDetail(detail);
          // Fetch category and subcategory names
          if (detail?.product) {
            const catId = detail.product.categoryID;
            const subCatId = detail.product.subCategoryID;
            
            // Fetch category name from Category collection
            if (catId && !fetchedCategoriesRef.current.has(catId)) {
              try {
                const catSnap = await getDoc(doc(db, 'Category', catId));
                if (catSnap.exists()) {
                  fetchedCategoriesRef.current.add(catId);
                  setCategoryNames(prev => ({ ...prev, [catId]: catSnap.data()?.categoryName || catId }));
                }
              } catch {}
            }
            
            // Fetch subcategory name from Category/{categoryId}/subCategory/{subCategoryId}
            if (catId && subCatId && !fetchedCategoriesRef.current.has(subCatId)) {
              try {
                const subCatSnap = await getDoc(doc(db, 'Category', catId, 'subCategory', subCatId));
                if (subCatSnap.exists()) {
                  fetchedCategoriesRef.current.add(subCatId);
                  setCategoryNames(prev => ({ ...prev, [subCatId]: subCatSnap.data()?.subCategoryName || subCatId }));
                }
              } catch {}
            }
          }
        }
      } catch {
        if (!cancelled) setPreviewDetail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [preview]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by seller or product name"
            className="w-64 max-w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Inner Tabs */}
      <div className="flex gap-2">
        {[
          { key: 'pending', label: 'Pending' },
          { key: 'approved', label: 'Approved' },
          { key: 'violation', label: 'Violation' },
        ].map(t => (
          <button
            key={t.key}
            className={`px-3 py-1.5 text-sm font-medium rounded ${tab === t.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            onClick={() => setTab(t.key as any)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table: columns -> Seller, Product Name, Price, Image, Action (Violation shows extra Reason) */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-[11px] font-semibold text-gray-600 tracking-wide">
              <th className="px-4 py-2">SELLER</th>
              <th className="px-4 py-2">PRODUCT NAME</th>
              <th className="px-4 py-2">PRODUCT PRICE</th>
              <th className="px-4 py-2">IMAGE</th>
              {tab === 'violation' && <th className="px-4 py-2">REASON</th>}
              <th className="px-4 py-2 w-48">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700">
                  <div className="text-sm font-medium">{(r.sellerId && sellerNames[r.sellerId]) || r.sellerId || '—'}</div>
                </td>
                <td className="px-4 py-3 text-gray-900">{r.name || '—'}</td>
                <td className="px-4 py-3 text-gray-900 font-medium">
                  {priceMap[r.id] != null ? (
                    <span>{currency.format(Number(priceMap[r.id]))}</span>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.imageURL ? (
                    <img src={r.imageURL} alt={r.name} className="h-12 w-12 rounded object-cover bg-gray-100 border" />
                  ) : (
                    <div className="h-12 w-12 rounded bg-gray-100 border flex items-center justify-center text-gray-400">No image</div>
                  )}
                </td>
                {tab === 'violation' && (
                  <td className="px-4 py-3 text-gray-600 max-w-[420px]"><div className="line-clamp-2">{r.qcReason || '—'}</div></td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-gray-300 hover:bg-gray-50 shadow-sm"
                      onClick={() => setPreview(r)}
                      title="Preview"
                    >
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={tab === 'violation' ? 6 : 5} className="px-4 py-8 text-center text-xs text-gray-500">No products.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Preview Dialog: detailed high-UX card with product and variations */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreview(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
              <h2 className="text-2xl font-bold text-gray-900">{preview.name}</h2>
              <p className="text-sm text-gray-500 mt-1">Product Details & Quality Control</p>
            </div>

            <div className="p-6 space-y-6">
              {/* Basic Information Section */}
              <div className="bg-gradient-to-br from-teal-50 to-blue-50 rounded-xl p-5 border border-teal-100">
                <h3 className="text-sm font-semibold text-teal-900 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Basic Information
                </h3>
                <div className="grid md:grid-cols-3 gap-6">
                  <div>
                    {preview.imageURL ? (
                      <img src={preview.imageURL} alt={preview.name} className="w-full aspect-square object-cover rounded-lg border-2 border-white shadow-lg" />
                    ) : (
                      <div className="w-full aspect-square rounded-lg bg-gray-100 border-2 border-white shadow-lg flex items-center justify-center text-gray-400">
                        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-2 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Product Name</div>
                        <div className="text-sm font-semibold text-gray-900">{preview.name}</div>
                      </div>
                      <div className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Brand</div>
                        <div className="text-sm font-semibold text-gray-900">{previewDetail?.product?.brand || '—'}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white rounded-lg p-4 shadow-sm col-span-2">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Seller</div>
                        <div className="text-sm font-semibold text-gray-900">{(preview.sellerId && sellerNames[preview.sellerId]) || preview.sellerId || '—'}</div>
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Description</div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap break-words max-h-32 overflow-auto">
                        {preview.description || 'No description provided'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category & Classification Section */}
              {previewDetail?.product && (
                <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-5 border border-purple-100">
                  <h3 className="text-sm font-semibold text-purple-900 mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    Category & Classification
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Category</div>
                      <div className="text-sm font-medium text-gray-900">
                        {previewDetail.product.categoryID ? (categoryNames[previewDetail.product.categoryID] || previewDetail.product.categoryID) : '—'}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Subcategory</div>
                      <div className="text-sm font-medium text-gray-900">
                        {previewDetail.product.subCategoryID ? (categoryNames[previewDetail.product.subCategoryID] || previewDetail.product.subCategoryID) : '—'}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Stock</div>
                      <div className="text-sm font-semibold text-blue-600">
                        {stockMap[preview.id] != null ? Number(stockMap[preview.id]).toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Warranty & Compliance Section */}
              {previewDetail?.product && (previewDetail.product.warrantyType || previewDetail.product.dangerousGoods) && (
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-5 border border-amber-100">
                  <h3 className="text-sm font-semibold text-amber-900 mb-4 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Warranty & Compliance
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Warranty Type</div>
                      <div className="text-sm font-medium text-gray-900">{previewDetail.product.warrantyType || '—'}</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Duration</div>
                      <div className="text-sm font-medium text-gray-900">{previewDetail.product.warrantyDuration || '—'}</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Dangerous Goods</div>
                      <div className="text-sm font-medium text-gray-900">
                        {previewDetail.product.dangerousGoods === 'dangerous' ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Yes</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">No</span>
                        )}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Allow Inquiry</div>
                      <div className="text-sm font-medium text-gray-900">
                        {previewDetail.product.allowInquiry ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Yes</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">No</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {previewDetail.product.warrantyPolicy && (
                    <div className="mt-4 bg-white rounded-lg p-4 shadow-sm">
                      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Warranty Policy</div>
                      <div className="text-sm text-gray-700">{previewDetail.product.warrantyPolicy}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Product Variations Section */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
                <h3 className="text-sm font-semibold text-blue-900 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  Product Variations
                  <span className="ml-auto bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded-full">
                    {previewDetail?.variations?.length || 0}
                  </span>
                </h3>
                
                {previewDetail?.variations?.length ? (
                  <div className="space-y-4">
                    {previewDetail.variations.map((v: any, idx: number) => {
                      // Firebase has two dimension objects: dimension and dimensions
                      // dimensions (map) has: height, length, width - this is the primary one
                      // dimension (map) has: height, weight, width - legacy/backup
                      const dimensions = v.dimensions || {};
                      const dimension = v.dimension || {};
                      
                      // Get dimensions - prefer 'dimensions' map, fallback to 'dimension' map
                      const h = Number(dimensions.height ?? dimension.height ?? 0) || undefined;
                      const w = Number(dimensions.width ?? dimension.width ?? 0) || undefined;
                      const l = Number(dimensions.length ?? dimension.length ?? 0) || undefined;
                      
                      // Weight and units are at root level of variation
                      const weight = Number(v.weight ?? 0) || undefined;
                      const weightUnit = v.weightUnit || 'g';
                      const dimensionUnit = v.dimensionsUnit || v.dimensionUnit || 'cm';
                      
                      return (
                        <div key={v.id} className="bg-white rounded-lg p-5 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                          <div className="flex items-start gap-4">
                            {/* Variation Image */}
                            <div className="flex-shrink-0">
                              {v.imageURL ? (
                                <img src={v.imageURL} alt={v.name} className="w-24 h-24 object-cover rounded-lg border-2 border-gray-200" />
                              ) : (
                                <div className="w-24 h-24 rounded-lg bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
                                  <span className="text-2xl font-bold text-gray-400">{idx + 1}</span>
                                </div>
                              )}
                            </div>
                            
                            {/* Variation Details */}
                            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div>
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Variation Name</div>
                                <div className="text-sm font-semibold text-gray-900">{v.name || '—'}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">SKU</div>
                                <div className="text-sm font-mono text-gray-900">{v.SKU || v.sku || '—'}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Price (₱)</div>
                                <div className="text-sm font-semibold text-teal-600">
                                  {v.price != null ? currency.format(Number(v.price)) : '—'}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Pcs per Box</div>
                                <div className="text-sm font-semibold text-gray-900">
                                  {v.pcsPerBox != null ? Number(v.pcsPerBox).toLocaleString() : '—'}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Stock</div>
                                <div className="text-sm font-semibold text-blue-600">
                                  {v.stock != null ? Number(v.stock).toLocaleString() : '—'}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Weight</div>
                                <div className="text-sm text-gray-900">
                                  {weight ? `${weight} ${weightUnit}` : '—'}
                                </div>
                              </div>
                              <div className="md:col-span-2">
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Dimensions (L × W × H)</div>
                                <div className="text-sm text-gray-900">
                                  {l || w || h ? (
                                    <span>{[l || '—', w || '—', h || '—'].join(' × ')} {dimensionUnit}</span>
                                  ) : '—'}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Fragile</div>
                                <div className="text-sm text-gray-900">
                                  {v.isFragile || v.fragile ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                      </svg>
                                      Yes
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">No</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-white rounded-lg p-8 text-center">
                    <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="text-sm text-gray-500">No variations found for this product</p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-2xl flex justify-end gap-3">
              <button 
                className="px-5 py-2.5 text-sm font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-all" 
                onClick={() => setPreview(null)}
              >
                Close
              </button>
              {tab === 'pending' && (
                <>
                  <button
                    className="px-5 py-2.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-sm flex items-center gap-2 transition-all"
                    onClick={() => {
                      setRejectId(preview.id);
                      setPreview(null);
                    }}
                  >
                    <AlertTriangle className="w-4 h-4" /> Mark as Violation
                  </button>
                  <button
                    className="px-5 py-2.5 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 shadow-sm flex items-center gap-2 transition-all"
                    onClick={() => {
                      const sellerName = (preview.sellerId && sellerNames[preview.sellerId]) || preview.sellerId || 'Unknown Seller';
                      setApprovingProduct({ id: preview.id, sellerName });
                      setShowApprovalConfirm(true);
                      setPreview(null);
                    }}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve Product
                  </button>
                </>
              )}
              {tab === 'approved' && (
                <button
                  className="px-5 py-2.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-sm flex items-center gap-2 transition-all"
                  onClick={() => {
                    setRejectId(preview.id);
                    setPreview(null);
                  }}
                >
                  <AlertTriangle className="w-4 h-4" /> Mark as Violation
                </button>
              )}
              {tab === 'violation' && (
                <button
                  className="px-5 py-2.5 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 shadow-sm flex items-center gap-2 transition-all"
                  onClick={() => {
                    const sellerName = (preview.sellerId && sellerNames[preview.sellerId]) || preview.sellerId || 'Unknown Seller';
                    setApprovingProduct({ id: preview.id, sellerName });
                    setShowApprovalConfirm(true);
                    setPreview(null);
                  }}
                >
                  <CheckCircle2 className="w-4 h-4" /> Approve Product
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Approval Confirmation Dialog */}
      {showApprovalConfirm && approvingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowApprovalConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 bg-teal-100 rounded-full">
                <CheckCircle2 className="w-6 h-6 text-teal-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Approve Product</h3>
                <p className="text-sm text-gray-600">
                  This product of <span className="font-semibold">{approvingProduct.sellerName}</span> will be approved and activated.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                onClick={() => {
                  setShowApprovalConfirm(false);
                  setApprovingProduct(null);
                }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition flex items-center gap-2"
                onClick={async () => {
                  try {
                    await approve(approvingProduct.id);
                    // Only close dialog on success
                    setShowApprovalConfirm(false);
                    setApprovingProduct(null);
                  } catch (error) {
                    // Keep dialog open on failure so user retains context
                    console.error('Approval failed:', error);
                  }
                }}
              >
                <CheckCircle2 className="w-4 h-4" />
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Dialog */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRejectId(null)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Mark as Violation</h3>
            <p className="text-xs text-gray-500 mb-4">Provide a reason so the seller can correct the product details.</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              rows={4}
              placeholder="Reason for violation (e.g. misleading image, incorrect category)"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800" onClick={() => setRejectId(null)}>Cancel</button>
              <button className="px-3 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40" onClick={reject} disabled={!reason.trim()}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductQCTab;
