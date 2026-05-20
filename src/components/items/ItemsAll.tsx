/**
 * ItemsAll - Shows all items for the seller
 * 
 * Displays a comprehensive list of all products with filtering and status tabs.
 * This view does NOT include the Active toggle column.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { ProductService } from '@/services/product';
import CategoryService from '@/services/category';
import { Package, Download } from 'lucide-react';

interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  category?: string;
  categoryID?: string;
  categoryName?: string;
  subcategory?: string;
  subCategoryID?: string;
  price?: number;
  specialPrice?: number;
  inStock: number;
  suggestedThreshold?: number;
  status?: string;
  isActive?: boolean;
  updatedAt?: number;
  variationCount?: number;
}

const ItemsAll: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  const { uid, isSeller, isAdmin, isSubAccount, parentId } = useAuth();
  const effectiveSellerId = isSeller ? (isSubAccount ? (parentId || uid) : uid) : null;

  // Filter states
  const [filterName, setFilterName] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'price_asc' | 'price_desc' | 'updatedAt'>('name');

  const categoriesList = useMemo(() => {
    return Object.entries(categoryMap)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categoryMap]);
  const [catalogTab, setCatalogTab] = useState<'all' | 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'deleted'>('all');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Export function
  const handleExport = () => {
    const csvData = filteredItems.map(item => ({
      'Product Name': item.name || '',
      'Category': item.categoryName || 'N/A',
      'Price': item.price != null ? `₱${item.price}` : '',
      'Special Price': item.specialPrice != null && item.specialPrice > 0 ? `₱${item.specialPrice}` : '',
      'Status': item.status || 'active',
    }));

    const headers = Object.keys(csvData[0] || {});
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => headers.map(h => `"${row[h as keyof typeof row]}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `items_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Load categories
  useEffect(() => {
    const unsub = CategoryService.listenCategories((categories) => {
      const map: Record<string, string> = {};
      categories.forEach(cat => {
        map[cat.id] = cat.name;
      });
      setCategoryMap(map);
    });
    return () => unsub();
  }, []);

  // Load products
  useEffect(() => {
    if (!effectiveSellerId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = ProductService.listenBySeller(effectiveSellerId, (rows) => {
      const mapped = rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        suggestedThreshold: r.suggestedThreshold != null ? Number(r.suggestedThreshold) : 5,
        inStock: r.inStock,
        updatedAt: r.updatedAt,
        description: r.description || '',
        imageUrl: r.imageUrl,
        category: r.category || r.categoryID,
        categoryID: r.categoryID,
        subcategory: r.subcategory || r.subCategoryID,
        subCategoryID: r.subCategoryID,
        price: r.price,
        specialPrice: r.specialPrice,
        status: r.status,
        isActive: r.isActive != null ? !!r.isActive : (r.status === 'active'),
        variationCount: r.variationCount || 0,
      }));
      setItems(mapped as any);
      setLoading(false);
    });
    return () => unsub();
  }, [effectiveSellerId]);

  // Enrich items with category names
  const enrichedItems = useMemo(() => {
    return items.map(item => ({
      ...item,
      isActive: item.isActive != null ? !!item.isActive : ((item.status as any) === 'active'),
      categoryName: categoryMap[item.category as string] || item.category || 'N/A',
    }));
  }, [items, categoryMap]);

  // Status counts
  const statusCounts = useMemo(() => {
    const acc = { active: 0, inactive: 0, draft: 0, pending_qc: 0, violation: 0, deleted: 0 };
    items.forEach((i) => {
      const s = (i.status ?? 'active') as keyof typeof acc;
      if (s in acc) acc[s] += 1;
    });
    return acc;
  }, [items]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    const nameQuery = (filterName || '').trim().toLowerCase();
    return enrichedItems
      .filter(i => {
        const status = (i.status ?? 'active');
        if (catalogTab === 'all') return true;
        if (catalogTab === 'pending_qc') return status === 'pending_qc';
        return status === catalogTab;
      })
      .filter(i => {
        if (!nameQuery) return true;
        const n = (i.name || '').toLowerCase();
        return n.includes(nameQuery);
      })
      .filter(i => {
        if (!filterCategory) return true;
        return i.categoryName === filterCategory;
      })
      .sort((a, b) => {
        if (sortBy === 'stock') {
          const diff = (Number(b.inStock || 0) - Number(a.inStock || 0));
          if (diff !== 0) return diff;
          return (a.name || '').localeCompare(b.name || '');
        }
        if (sortBy === 'price_asc') {
          const diff = Number(a.price || 0) - Number(b.price || 0);
          if (diff !== 0) return diff;
          return (a.name || '').localeCompare(b.name || '');
        }
        if (sortBy === 'price_desc') {
          const diff = Number(b.price || 0) - Number(a.price || 0);
          if (diff !== 0) return diff;
          return (a.name || '').localeCompare(b.name || '');
        }
        if (sortBy === 'updatedAt') {
          const diff = (Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
          if (diff !== 0) return diff;
          return (a.name || '').localeCompare(b.name || '');
        }
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [enrichedItems, catalogTab, filterName, filterCategory, sortBy]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  useEffect(() => { setPage(1); }, [filteredItems, catalogTab]);
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-teal-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {[
          { key: 'all', label: 'All' },
          { key: 'active', label: 'Active' },
          { key: 'inactive', label: 'Inactive' },
          { key: 'draft', label: 'Draft' },
          { key: 'pending_qc', label: 'Pending QC' },
          { key: 'violation', label: 'Violation' },
          { key: 'deleted', label: 'Archive' },
        ].map(t => (
          <button
            key={t.key}
            className={`relative px-3 py-1.5 text-sm font-medium rounded ${catalogTab === t.key ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'text-gray-600 hover:bg-gray-50 border border-transparent'}`}
            onClick={() => setCatalogTab(t.key as any)}
          >
            {t.label}
            {t.key === 'active' && statusCounts.active > 0 && (
              <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-teal-600 text-white text-[10px] leading-none shadow ring-2 ring-white">
                {statusCounts.active}
              </span>
            )}
            {t.key === 'inactive' && statusCounts.inactive > 0 && (
              <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-gray-500 text-white text-[10px] leading-none shadow ring-2 ring-white">
                {statusCounts.inactive}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="Filter by product name"
            className="w-64 max-w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="w-56 max-w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="">All categories</option>
            {categoriesList.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 font-medium">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-52 max-w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              <option value="name">Name (A–Z)</option>
              <option value="price_asc">Price (low → high)</option>
              <option value="price_desc">Price (high → low)</option>
              <option value="stock">Stock (high → low)</option>
              <option value="updatedAt">Recently updated</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={filteredItems.length === 0}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-medium flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Table - NO Active column */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">PRODUCT</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide hidden sm:table-cell">PRICE</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide hidden md:table-cell">CATEGORY</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((item) => {
              const showSale = item.specialPrice != null && Number(item.specialPrice) > 0 && Number(item.specialPrice) < Number(item.price ?? Infinity);
              return (
                <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="h-10 w-10 rounded object-cover bg-gray-100" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center">
                          <Package className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-gray-900">{item.name}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {item.categoryName || 'Uncategorized'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 hidden sm:table-cell">
                    {item.price != null ? (
                      showSale ? (
                        <>
                          <span className="font-semibold text-teal-700">₱{Number(item.specialPrice).toLocaleString()}</span>
                          <span className="line-through text-gray-400 ml-1">₱{Number(item.price).toLocaleString()}</span>
                        </>
                      ) : (
                        <span>₱{Number(item.price).toLocaleString()}</span>
                      )
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell">{item.categoryName || 'N/A'}</td>
                </tr>
              );
            })}
            {pagedItems.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-xs text-gray-500">No products found.</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t bg-white text-xs text-gray-600">
          <div>
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
            <button className="px-2 py-1 border rounded disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemsAll;
