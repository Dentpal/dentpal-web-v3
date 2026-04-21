/**
 * ItemsList - Shows items with Active toggle and Edit functionality
 * 
 * Displays a list of products with:
 * - Active column (toggle switch)
 * - Edit Item column with GREEN button
 */

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { ProductService } from '@/services/product';
import CategoryService from '@/services/category';
import { Package, Edit3, X, Plus, FolderTree, Boxes, Trash2, ImageIcon, AlertTriangle, Archive, RotateCcw, MessageCircle, Send } from 'lucide-react';
import { storage, db } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, getDocs } from 'firebase/firestore';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const CATEGORY_OPTIONS = ['Consumables', 'Dental Equipment', 'Disposables', 'Equipment'] as const;

interface InventoryItem {
  id: string;
  name: string;
  brand?: string;
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
  qcReason?: string;
  violationmessage?: string;
  warrantyType?: string;
  warrantyDuration?: string;
  warrantyPolicy?: string;
  dangerousGoods?: string;
  allowInquiry?: boolean;
  insuranceAndEvaluation?: boolean;
  clickCounter?: number;
}

interface ItemsListProps {
  onAddItemClick?: () => void;
}

const ItemsList: React.FC<ItemsListProps> = ({ onAddItemClick }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [variationPrices, setVariationPrices] = useState<Record<string, number>>({});
  const [variationStocks, setVariationStocks] = useState<Record<string, number>>({});
  // Map subCategoryID to parent categoryName
  const [subcategoryToCategory, setSubcategoryToCategory] = useState<Record<string, string>>({});

  const { uid, isSeller, isAdmin, isSubAccount, parentId } = useAuth();
  const { toast } = useToast();
  const effectiveSellerId = isSeller ? (isSubAccount ? (parentId || uid) : uid) : null;

  // Filter states
  const [filterName, setFilterName] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'updatedAt'>('name');
  const [catalogTab, setCatalogTab] = useState<'all' | 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'archive'>('all');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Edit Modal states
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    brand: string;
    description: string;
    categoryID: string;
    subCategoryID: string;
    price: number | string;
    specialPrice: number | '';
    inStock: number | string;
    suggestedThreshold: number;
    imageURL: string;
    imageFile?: File | null;
    imagePreview?: string | null;
    brandImageURL: string;
    brandImageFile?: File | null;
    brandImagePreview?: string | null;
    status: 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'archive';
    dangerousGoods: 'none' | 'dangerous';
    warrantyType: string;
    warrantyDuration: string;
    warrantyPolicy: string;
    promoStart: number | null;
    promoEnd: number | null;
    allowInquiry: boolean;
    insuranceAndEvaluation: boolean;
    variations: Array<{
      id?: string;
      name: string;
      SKU: string;
      price: number | string;
      stock: number | string;
      imageURL: string;
      imageFile?: File | null;
      imagePreview?: string | null;
      weight: number | string | '';
      weightUnit: string;
      dimensions: { length: number | string | ''; width: number | string | ''; height: number | string | '' };
      dimensionsUnit: string;
      pcsPerBox: number | '';
      isFragile?: boolean;
      isNew?: boolean;
      isDeleted?: boolean;
    }>;
  } | null>(null);
  const [subcategoryOptions, setSubcategoryOptions] = useState<Array<{ id: string; name: string }>>([]);
  const editImageInputRef = useRef<HTMLInputElement | null>(null);
  const editBrandImageInputRef = useRef<HTMLInputElement | null>(null);
  const variationImageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const currentSubcategoryUnsubscribeRef = useRef<(() => void) | null>(null);

  // Status dialog states
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    productName: string;
    status: 'archive' | 'violation' | 'pending_qc' | null;
    productId: string;
  }>({ open: false, productName: '', status: null, productId: '' });

  // Delete confirmation dialog states
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    productId: string;
    productName: string;
  }>({ open: false, productId: '', productName: '' });

  const categoriesList = useMemo(() => {
    return Object.entries(categoryMap)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categoryMap]);

  // Cleanup subcategory listener on unmount
  useEffect(() => {
    return () => {
      if (currentSubcategoryUnsubscribeRef.current) {
        currentSubcategoryUnsubscribeRef.current();
        currentSubcategoryUnsubscribeRef.current = null;
      }
    };
  }, []);

  // Load categories and subcategories mapping
  useEffect(() => {
    let unsubCategory: (() => void) | null = null;
    let unsubSubcategories: Record<string, (() => void)> = {};
    unsubCategory = CategoryService.listenCategories((categories) => {
      const map: Record<string, string> = {};
      const subToCat: Record<string, string> = {};
      categories.forEach(cat => {
        map[cat.id] = cat.name;
        // Listen to subcategories for each category
        if (!unsubSubcategories[cat.id]) {
          unsubSubcategories[cat.id] = CategoryService.listenSubcategories(cat.id, (subs) => {
            subs.forEach(sub => {
              subToCat[sub.id] = cat.name;
            });
            setSubcategoryToCategory(prev => ({ ...prev, ...subToCat }));
          });
        }
      });
      setCategoryMap(map);
    });
    return () => {
      if (unsubCategory) unsubCategory();
      Object.values(unsubSubcategories).forEach(unsub => unsub());
    };
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
        brand: r.brand || '',
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
        qcReason: r.qcReason || '',
        violationmessage: r.violationmessage || '',
        warrantyType: r.warrantyType || '',
        warrantyDuration: r.warrantyDuration || '',
        warrantyPolicy: r.warrantyPolicy || '',
        dangerousGoods: r.dangerousGoods || 'none',
        allowInquiry: r.allowInquiry || false,
        insuranceAndEvaluation: r.insuranceAndEvaluation || false,
        clickCounter: r.clickCounter ?? 0,
      }));
      setItems(mapped as any);
      setLoading(false);
    });
    return () => unsub();
  }, [effectiveSellerId]);

  // Stable array of unique item IDs derived from items
  const itemIds = useMemo(() => {
    return Array.from(new Set(items.map(item => item.id)));
  }, [items.map(item => item.id).join(',')]);

  // Load first variation prices and stocks for all items
  const fetchIdRef = useRef(0);
  useEffect(() => {
    if (!itemIds.length) return;
    
    // Increment fetch ID to invalidate previous fetches
    const currentFetchId = ++fetchIdRef.current;
    
    const loadVariationData = async () => {
      try {
        // Parallel fetch with individual error handling
        const results = await Promise.all(
          itemIds.map(async (id) => {
            try {
              const variations = await ProductService.getVariations(id);
              return {
                id,
                price: variations && variations.length > 0 ? variations[0].price || 0 : 0,
                stock: variations && variations.length > 0 ? variations[0].stock || 0 : 0,
              };
            } catch (error) {
              console.error(`Failed to load variations for ${id}:`, error);
              return { id, price: 0, stock: 0 };
            }
          })
        );
        
        // Only update state if this is still the current fetch
        if (currentFetchId === fetchIdRef.current) {
          const prices: Record<string, number> = {};
          const stocks: Record<string, number> = {};
          
          results.forEach(({ id, price, stock }) => {
            prices[id] = price;
            stocks[id] = stock;
          });
          
          setVariationPrices(prices);
          setVariationStocks(stocks);
        }
      } catch (error) {
        console.error('Failed to load variation data:', error);
      }
    };
    
    loadVariationData();
  }, [itemIds]);

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
    const acc = { active: 0, inactive: 0, draft: 0, pending_qc: 0, violation: 0, archive: 0 };
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
        // Hide deleted items from the "All" tab
        if (catalogTab === 'all') return status !== 'deleted';
        if (catalogTab === 'pending_qc') return status === 'pending_qc';
        if (catalogTab === 'archive') return status === 'archive';
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

  // Archive handler
  const handleArchiveItem = async (productId: string) => {
    try {
      setItems(prev => prev.map(i => i.id === productId ? ({...i, status: 'archive'}) : i));
      await ProductService.updateProduct(productId, { status: 'archive' });
      toast({ 
        title: 'Success', 
        description: 'Product archived successfully' 
      });
    } catch (error) {
      console.error('Failed to archive product:', error);
      setItems(prev => prev.map(i => i.id === productId ? ({...i, status: 'inactive'}) : i));
      toast({ 
        title: 'Error', 
        description: 'Failed to archive product', 
        variant: 'destructive' 
      });
    }
  };

  // Restore handler
  const handleRestoreItem = async (productId: string) => {
    try {
      setItems(prev => prev.map(i => i.id === productId ? ({...i, status: 'inactive'}) : i));
      await ProductService.updateProduct(productId, { status: 'inactive' });
      toast({ 
        title: 'Success', 
        description: 'Product restored to inactive successfully' 
      });
    } catch (error) {
      console.error('Failed to restore product:', error);
      setItems(prev => prev.map(i => i.id === productId ? ({...i, status: 'archive'}) : i));
      toast({ 
        title: 'Error', 
        description: 'Failed to restore product', 
        variant: 'destructive' 
      });
    }
  };

  // Submit draft for QC review
  const handleSubmitDraft = async (productId: string) => {
    try {
      setItems(prev => prev.map(i => i.id === productId ? ({ ...i, status: 'pending_qc' }) : i));
      await ProductService.updateProduct(productId, { status: 'pending_qc' });
      toast({ title: 'Success', description: 'Product submitted for review' });
    } catch (error) {
      console.error('Failed to submit draft:', error);
      setItems(prev => prev.map(i => i.id === productId ? ({ ...i, status: 'draft' }) : i));
      toast({ title: 'Error', description: 'Failed to submit product', variant: 'destructive' });
    }
  };

  // Delete handler
  const handleDeleteProduct = async () => {
    try {
      const { productId } = deleteDialog;
      // Remove from local state immediately
      setItems(prev => prev.filter(i => i.id !== productId));
      // Delete from database
      await ProductService.deleteProduct(productId);
      toast({ 
        title: 'Success', 
        description: 'Product deleted successfully' 
      });
      setDeleteDialog({ open: false, productId: '', productName: '' });
    } catch (error) {
      console.error('Failed to delete product:', error);
      toast({ 
        title: 'Error', 
        description: 'Failed to delete product', 
        variant: 'destructive' 
      });
    }
  };

  // Toggle active status
  const handleToggleActive = async (productId: string, nextActive: boolean) => {
    try {
      // Optimistic update
      setItems(prev => prev.map(i => i.id === productId ? ({
        ...i,
        isActive: nextActive,
        status: nextActive ? 'active' : (i.status === 'deleted' ? 'deleted' : 'inactive'),
      }) : i));

      await ProductService.toggleActive(productId, nextActive);
      toast({ 
        title: 'Success', 
        description: `Product ${nextActive ? 'activated' : 'deactivated'} successfully` 
      });
    } catch (error) {
      console.error('Failed to toggle active status:', error);
      // Revert on failure
      setItems(prev => prev.map(i => i.id === productId ? ({
        ...i,
        isActive: !nextActive,
        status: !nextActive ? 'active' : (i.status === 'deleted' ? 'deleted' : 'inactive'),
      }) : i));
      toast({ 
        title: 'Error', 
        description: 'Failed to update product status', 
        variant: 'destructive' 
      });
    }
  };

  // Handle dialog confirm for setting archived product to active
  const handleSetArchiveToActive = async () => {
    try {
      setStatusDialog({ open: false, productName: '', status: null, productId: '' });
      await ProductService.toggleActive(statusDialog.productId, true);
      setItems(prev => prev.map(i => i.id === statusDialog.productId ? ({
        ...i,
        isActive: true,
        status: 'active'
      }) : i));
      toast({ 
        title: 'Success', 
        description: `${statusDialog.productName} has been set to active` 
      });
    } catch (error) {
      console.error('Failed to activate product:', error);
      toast({ 
        title: 'Error', 
        description: 'Failed to activate product', 
        variant: 'destructive' 
      });
    }
  };

  // Handle Edit Item - Open Edit Modal
  const handleEditItem = async (product: any) => {
    setEditingItem(product.id);
    
    // Fetch variations for this product
    let variations: any[] = [];
    try {
      const vars = await ProductService.getVariations(product.id);
      variations = vars.map((v: any) => ({
        id: v.id,
        name: v.name || '',
        SKU: v.SKU || v.sku || '',
        price: v.price || 0,
        stock: v.stock || 0,
        imageURL: v.imageURL || '',
        weight: v.weight || '',
        weightUnit: v.weightUnit || 'kg',
        dimensions: {
          length: v.dimensions?.length || '',
          width: v.dimensions?.width || '',
          height: v.dimensions?.height || ''
        },
        dimensionsUnit: v.dimensionsUnit || 'cm',
        pcsPerBox: v.pcsPerBox || '',
        isFragile: v.isFragile ?? false,
        isNew: false,
        isDeleted: false,
        imageFile: null,
        imagePreview: null
      }));
    } catch (error) {
      console.error('Failed to load variations:', error);
    }
    
    setEditForm({
      name: product.name || '',
      brand: product.brand || '',
      description: product.description || '',
      categoryID: product.category || '',
      subCategoryID: product.subcategory || '',
      price: product.price || 0,
      specialPrice: product.specialPrice || '',
      inStock: product.inStock || 0,
      suggestedThreshold: product.suggestedThreshold || 5,
      imageURL: product.imageUrl || '',
      imageFile: null,
      imagePreview: null,
      brandImageURL: product.brandImage || '',
      brandImageFile: null,
      brandImagePreview: null,
      status: product.status || 'active',
      dangerousGoods: product.dangerousGoods || 'none',
      warrantyType: product.warrantyType || '',
      warrantyDuration: product.warrantyDuration || '',
      warrantyPolicy: product.warrantyPolicy || '',
      promoStart: product.promoStart || null,
      promoEnd: product.promoEnd || null,
      allowInquiry: categoryMap[product.category || ''] === 'Equipments',
      insuranceAndEvaluation: !!product.insuranceAndEvaluation,
      variations: variations,
    });

    // Load subcategories for the selected category
    if (product.category) {
      try {
        const col = collection(db, 'Category', product.category, 'subCategory');
        const snap = await getDocs(col);
        const subs = snap.docs
          .map(d => {
            const data: any = d.data();
            const name = String(
              data?.subCategoryName || data?.subcategoryName || data?.name || data?.title || data?.displayName || data?.label || d.id
            ).trim();
            return { id: d.id, name };
          })
          .filter(r => !!r.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setSubcategoryOptions(subs);
      } catch (error) {
        console.error('Failed to load subcategories:', error);
      }
    }

    setShowEditModal(true);
  };

  // Save Edited Item
  const handleItemSave = async () => {
    if (!editForm || !editingItem) return;

    setSubmitting(true);
    try {
      let imageUrl = editForm.imageURL;

      // Upload new image if selected
      if (editForm.imageFile) {
        const timestamp = Date.now();
        const path = `ProductImages/${timestamp}/${editForm.imageFile.name}`;
        const sRef = storageRef(storage, path);
        await uploadBytes(sRef, editForm.imageFile);
        imageUrl = await getDownloadURL(sRef);
      }

      let brandImageUrl = editForm.brandImageURL;
      if (editForm.brandImageFile) {
        const timestamp = Date.now();
        const bRef = storageRef(storage, `products/${editingItem}/brand/${timestamp}_${editForm.brandImageFile.name}`);
        await uploadBytes(bRef, editForm.brandImageFile);
        brandImageUrl = await getDownloadURL(bRef);
      }

      // If product is in violation, change status to pending_qc when saving
      // If product is archived, change status to inactive when saving
      const currentItem = items.find(item => item.id === editingItem);
      let newStatus = editForm.status;
      if (currentItem?.status === 'violation') {
        newStatus = 'pending_qc';
      } else if (currentItem?.status === 'archive') {
        newStatus = 'inactive';
      }

      // Update product details (price and lowestPrice are handled by updatePriceAndPromo)
      await ProductService.updateProduct(editingItem, {
        name: editForm.name,
        brand: editForm.brand,
        brandImage: brandImageUrl || null,
        description: editForm.description,
        imageURL: imageUrl,
        categoryID: editForm.categoryID || null,
        subCategoryID: editForm.subCategoryID || null,
        suggestedThreshold: editForm.suggestedThreshold,
        status: newStatus,
        dangerousGoods: editForm.dangerousGoods,
        warrantyType: editForm.warrantyType || null,
        warrantyDuration: editForm.warrantyDuration || null,
        warrantyPolicy: editForm.warrantyPolicy || '',
        allowInquiry: categoryMap[editForm.categoryID] === 'Equipments',
        insuranceAndEvaluation: editForm.insuranceAndEvaluation,
      } as any);

      // Update pricing
      await ProductService.updatePriceAndPromo(
        editingItem,
        {
          price: typeof editForm.price === 'string' ? (parseFloat(editForm.price) || 0) : editForm.price,
          specialPrice: editForm.specialPrice !== '' ? Number(editForm.specialPrice) : null,
          promoStart: editForm.promoStart,
          promoEnd: editForm.promoEnd,
        },
        uid,
        undefined
      );

      // Handle variations
      for (const variation of editForm.variations) {
        let variationImageUrl = variation.imageURL;
        
        // Upload variation image if new file selected
        if (variation.imageFile) {
          const timestamp = Date.now();
          const path = `ProductImages/variations/${timestamp}/${variation.imageFile.name}`;
          const sRef = storageRef(storage, path);
          await uploadBytes(sRef, variation.imageFile);
          variationImageUrl = await getDownloadURL(sRef);
        }
        
        if (variation.isDeleted && variation.id) {
          // Delete existing variation
          await ProductService.deleteVariation(editingItem, variation.id);
        } else if (variation.isNew) {
          // Add new variation
          await ProductService.addVariations(editingItem, [{
            name: variation.name,
            sku: variation.SKU,
            price: typeof variation.price === 'string' ? (parseFloat(variation.price) || 0) : variation.price,
            stock: typeof variation.stock === 'string' ? (parseInt(variation.stock) || 0) : variation.stock,
            weight: variation.weight !== '' ? Number(variation.weight) : undefined,
            weightUnit: variation.weightUnit,
            dimensions: {
              length: variation.dimensions.length !== '' ? Number(variation.dimensions.length) : undefined,
              width: variation.dimensions.width !== '' ? Number(variation.dimensions.width) : undefined,
              height: variation.dimensions.height !== '' ? Number(variation.dimensions.height) : undefined,
            },
            dimensionsUnit: variation.dimensionsUnit,
            pcsPerBox: variation.pcsPerBox !== '' ? Number(variation.pcsPerBox) : undefined,
            imageURL: variationImageUrl || null,
            isFragile: variation.isFragile ?? false,
          }]);
        } else if (variation.id) {
          // Update existing variation
          await ProductService.updateVariation(editingItem, variation.id, {
            name: variation.name,
            SKU: variation.SKU,
            price: typeof variation.price === 'string' ? (parseFloat(variation.price) || 0) : variation.price,
            stock: typeof variation.stock === 'string' ? (parseInt(variation.stock) || 0) : variation.stock,
            weight: variation.weight !== '' ? Number(variation.weight) : undefined,
            weightUnit: variation.weightUnit,
            dimensions: {
              length: variation.dimensions.length !== '' ? Number(variation.dimensions.length) : undefined,
              width: variation.dimensions.width !== '' ? Number(variation.dimensions.width) : undefined,
              height: variation.dimensions.height !== '' ? Number(variation.dimensions.height) : undefined,
            },
            dimensionsUnit: variation.dimensionsUnit,
            pcsPerBox: variation.pcsPerBox !== '' ? Number(variation.pcsPerBox) : undefined,
            imageURL: variationImageUrl,
            isFragile: variation.isFragile ?? false,
          });
        }
      }

      // Update local items state immediately to reflect changes
      setItems(prevItems => 
        prevItems.map(item => 
          item.id === editingItem 
            ? { 
                ...item, 
                name: editForm.name,
                description: editForm.description,
                imageUrl: imageUrl,
                categoryID: editForm.categoryID || '',
                category: editForm.categoryID || '',
                subCategoryID: editForm.subCategoryID || '',
                subcategory: editForm.subCategoryID || '',
                price: typeof editForm.price === 'string' ? (parseFloat(editForm.price) || 0) : editForm.price,
                specialPrice: editForm.specialPrice !== '' ? Number(editForm.specialPrice) : null,
                inStock: typeof editForm.inStock === 'string' ? (parseInt(editForm.inStock) || 0) : editForm.inStock,
                suggestedThreshold: editForm.suggestedThreshold,
                status: editForm.status,
                updatedAt: Date.now(),
              } 
            : item
        )
      );

      const wasViolation = currentItem?.status === 'violation';
      toast({ 
        title: 'Success', 
        description: wasViolation ? 'Product updated and resubmitted for review' : 'Product updated successfully' 
      });
      setShowEditModal(false);
      setEditingItem(null);
      setEditForm(null);
    } catch (error) {
      console.error('Failed to update product:', error);
      toast({ title: 'Error', description: 'Failed to update product. Please try again.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

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
          { key: 'archive', label: 'Archive' },
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
            {t.key === 'draft' && statusCounts.draft > 0 && (
              <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-[10px] leading-none shadow ring-2 ring-white">
                {statusCounts.draft}
              </span>
            )}
            {t.key === 'pending_qc' && statusCounts.pending_qc > 0 && (
              <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-yellow-500 text-white text-[10px] leading-none shadow ring-2 ring-white">
                {statusCounts.pending_qc}
              </span>
            )}
            {t.key === 'violation' && statusCounts.violation > 0 && (
              <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] leading-none shadow ring-2 ring-white">
                {statusCounts.violation}
              </span>
            )}
            {t.key === 'archive' && statusCounts.archive > 0 && (
              <span className="absolute -top-2 -right-2 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-orange-500 text-white text-[10px] leading-none shadow ring-2 ring-white">
                {statusCounts.archive}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        
          <button
          className="ml-2 px-4 py-2 rounded-lg bg-green-600 text-white font-semibold text-sm shadow hover:bg-green-700 transition"
          style={{ minWidth: 110 }}
          onClick={() => {
            if (onAddItemClick) {
              onAddItemClick();
            } else {
              const url = new URL(window.location.href);
              url.searchParams.set('tab', 'items-add');
              window.history.pushState({}, '', url.pathname + url.search);
              window.dispatchEvent(new Event('popstate'));
            }
          }}
        >
          Add Item
        </button>

        <input
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          placeholder="Filter by product name"
          className="w-64 max-w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="w-48 max-w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
   
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="w-48 max-w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          <option value="name">Sort by: Name</option>
          <option value="stock">Sort by: Stock (desc)</option>
          <option value="updatedAt">Sort by: Updated</option>
        </select>

      </div>


      {/* Table - Product name | Category | Price | Stock | Active */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide" style={{ width: '25%', maxWidth: 260 }}>PRODUCT NAME</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">CATEGORY</th>
              {catalogTab === 'violation' && (
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">REASON</th>
              )}
              {catalogTab !== 'archive' && catalogTab !== 'violation' && (
                <>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">PRICE</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">STOCK</th>
                </>
              )}
              {catalogTab !== 'archive' && catalogTab !== 'violation' && (
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-600 tracking-wide">CLICKS</th>
              )}
              {catalogTab === 'all' && (
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">STATUS</th>
              )}
              {catalogTab !== 'pending_qc' && catalogTab !== 'violation' && catalogTab !== 'archive' && catalogTab !== 'draft' && (
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-600 tracking-wide">ACTIVE</th>
              )}
              {catalogTab === 'inactive' && (
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">ARCHIVE</th>
              )}
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">{catalogTab === 'archive' ? 'RESTORE' : 'EDIT ITEM'}</th>
              {catalogTab === 'draft' && (
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">SUBMIT</th>
              )}
              {(catalogTab === 'draft' || catalogTab === 'archive') && (
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-600 tracking-wide">DELETE</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((item) => {
              const status = (item.status ?? 'active');
              const isActive = status === 'active';
              const isDeleted = status === 'deleted';
              const isArchived = status === 'archive';
              const isLockedInAllTab = catalogTab === 'all' && (status === 'archive' || status === 'violation' || status === 'pending_qc' || status === 'draft');
              // Get category name from subcategory mapping if available
              let displayCategory = item.categoryName || 'Uncategorized';
              if (item.subCategoryID && subcategoryToCategory[item.subCategoryID]) {
                displayCategory = subcategoryToCategory[item.subCategoryID];
              }
              return (
                <tr
                  key={item.id}
                  className="border-b last:border-0 hover:bg-gray-50 cursor-pointer group"
                  onClick={() => !isDeleted && !isArchived && handleEditItem(item)}
                >
                  {/* Product Name */}
                  <td className="px-4 py-3" style={{ maxWidth: 260 }}>
                    <div className="flex items-center gap-3 min-w-0">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="h-10 w-10 rounded object-cover bg-gray-100 flex-shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Package className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-gray-900 max-w-[180px]">{item.name}</div>
                      </div>
                    </div>
                  </td>
                  {/* Category */}
                  <td className="px-4 py-3 text-gray-700">{displayCategory}</td>
                  {/* Reason - shown only in violation tab */}
                  {catalogTab === 'violation' && (
                    <td className="px-4 py-3 text-sm text-red-600">
                      {item.violationmessage || item.qcReason || '—'}
                    </td>
                  )}
                  {/* Price - hidden in archive and violation tab */}
                  {catalogTab !== 'archive' && catalogTab !== 'violation' && (
                    <>
                      <td className="px-4 py-3 text-gray-700">
                        {variationPrices[item.id] != null ? (
                          <span>₱{Number(variationPrices[item.id]).toLocaleString()}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {variationStocks[item.id] != null ? (
                          <span>{Number(variationStocks[item.id]).toLocaleString()}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </>
                  )}
                  {/* Click Counter */}
                  {catalogTab !== 'archive' && catalogTab !== 'violation' && (
                    <td className="px-4 py-3 text-center text-gray-700">
                      {Number(item.clickCounter ?? 0)}
                    </td>
                  )}
                  {/* Status Badge - only in "all" tab */}
                  {catalogTab === 'all' && (
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize
                        ${status === 'active' ? 'bg-green-100 text-green-800' : ''}
                        ${status === 'inactive' ? 'bg-gray-100 text-gray-800' : ''}
                        ${status === 'draft' ? 'bg-blue-100 text-blue-800' : ''}
                        ${status === 'pending_qc' ? 'bg-yellow-100 text-yellow-800' : ''}
                        ${status === 'violation' ? 'bg-red-100 text-red-800' : ''}
                        ${status === 'archive' ? 'bg-orange-100 text-orange-800' : ''}
                      `}>
                        {status === 'pending_qc' ? 'Pending QC' : status}
                      </span>
                    </td>
                  )}
                  {/* Active Toggle */}
                  {catalogTab !== 'pending_qc' && catalogTab !== 'violation' && catalogTab !== 'archive' && catalogTab !== 'draft' && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <label className={`inline-flex items-center select-none ${isDeleted || isLockedInAllTab ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={isActive}
                          onChange={(e) => {
                            if (!isDeleted && !isLockedInAllTab) {
                              handleToggleActive(item.id, e.target.checked);
                            }
                          }}
                          disabled={isDeleted || isLockedInAllTab}
                        />
                        <div
                          className={`relative w-11 h-6 rounded-full ${isDeleted || isLockedInAllTab ? 'bg-gray-200' : 'bg-gray-300'} transition-colors duration-200 ease-in-out ${!isDeleted && !isLockedInAllTab ? 'peer-checked:bg-teal-600' : ''}
                                       after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:shadow
                                       after:transform after:transition-transform after:duration-200 after:ease-in-out ${!isDeleted && !isLockedInAllTab ? 'peer-checked:after:translate-x-5' : ''}`}
                        />
                      </label>
                    </td>
                  )}
                  {/* Archive Button - only in inactive tab */}
                  {catalogTab === 'inactive' && (
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); handleArchiveItem(item.id); }}>
                      <button
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg shadow-sm transition bg-orange-600 text-white hover:bg-orange-700"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        Archive
                      </button>
                    </td>
                  )}
                  {/* Edit Item, Under Review, or Restore Button */}
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); if (status !== 'pending_qc') { catalogTab === 'archive' ? handleRestoreItem(item.id) : handleEditItem(item); } }}>
                    {catalogTab === 'archive' || status === 'archive' ? (
                      <button
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg shadow-sm transition bg-blue-600 text-white hover:bg-blue-700"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore
                      </button>
                    ) : status === 'pending_qc' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 rounded-lg border border-yellow-200">
                        <MessageCircle className="w-3.5 h-3.5" />
                        Under Review
                      </span>
                    ) : (
                      <button
                        disabled={isDeleted}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg shadow-sm transition
                          ${isDeleted 
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                            : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit Item
                      </button>
                    )}
                  </td>
                  {/* Submit Button - only in draft tab */}
                  {catalogTab === 'draft' && (
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); handleSubmitDraft(item.id); }}>
                      <button
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg shadow-sm transition bg-teal-600 text-white hover:bg-teal-700"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Submit
                      </button>
                    </td>
                  )}
                  {/* Delete Button - only in draft and archive tabs */}
                  {(catalogTab === 'draft' || catalogTab === 'archive') && (
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); setDeleteDialog({ open: true, productId: item.id, productName: item.name }); }}>
                      <button
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg shadow-sm transition bg-red-600 text-white hover:bg-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {pagedItems.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-500">No products found.</td>
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

      {/* Edit Product Modal */}
      {showEditModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => !submitting && setShowEditModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-green-600 to-green-700 px-6 py-4 rounded-t-2xl z-10">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Edit Product</h2>
                <button
                  onClick={() => !submitting && setShowEditModal(false)}
                  className="text-white/80 hover:text-white transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <input
              ref={editImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const preview = URL.createObjectURL(file);
                  setEditForm(prev => prev ? {
                    ...prev,
                    imageFile: file,
                    imagePreview: preview
                  } : null);
                }
              }}
            />
            <input
              ref={editBrandImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const preview = URL.createObjectURL(file);
                  setEditForm(prev => prev ? {
                    ...prev,
                    brandImageFile: file,
                    brandImagePreview: preview
                  } : null);
                }
              }}
            />

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Basic Information Section */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Package className="w-5 h-5 text-green-600" />
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {categoryMap[editForm.categoryID] === 'Equipments' && (
                    <div className="md:col-span-2 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.allowInquiry}
                          onChange={(e) => setEditForm({...editForm, allowInquiry: e.target.checked})}
                          className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                        />
                        Allow Inquiry
                      </label>
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Brand *</label>
                    <input
                      type="text"
                      value={editForm.brand}
                      onChange={(e) => setEditForm({...editForm, brand: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Enter your brand name"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Brand Image</label>
                    <div className="flex items-center gap-4">
                      {(editForm.brandImagePreview || editForm.brandImageURL) && (
                        <img
                          src={editForm.brandImagePreview || editForm.brandImageURL}
                          alt="Brand"
                          className="w-20 h-20 rounded-lg object-contain border-2 border-gray-200 bg-white"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => editBrandImageInputRef.current?.click()}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                      >
                        {editForm.brandImageURL || editForm.brandImagePreview ? 'Change Brand Image' : 'Upload Brand Image'}
                      </button>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Product Name *</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Enter product name"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Enter product description"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Product Image</label>
                    <div className="flex items-center gap-4">
                      {(editForm.imagePreview || editForm.imageURL) && (
                        <img
                          src={editForm.imagePreview || editForm.imageURL}
                          alt="Product"
                          className="w-24 h-24 rounded-lg object-cover border-2 border-gray-200"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => editImageInputRef.current?.click()}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                      >
                        {editForm.imageURL ? 'Change Image' : 'Upload Image'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category & Classification Section */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <FolderTree className="w-5 h-5 text-green-600" />
                  Category & Classification
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Category *</label>
                    <select
                      value={editForm.categoryID}
                      onChange={(e) => {
                        setEditForm({...editForm, categoryID: e.target.value, subCategoryID: ''});
                        // Clean up previous listener
                        if (currentSubcategoryUnsubscribeRef.current) {
                          currentSubcategoryUnsubscribeRef.current();
                          currentSubcategoryUnsubscribeRef.current = null;
                        }
                        // Set up new listener
                        if (e.target.value) {
                          const unsub = CategoryService.listenSubcategories(e.target.value, setSubcategoryOptions);
                          currentSubcategoryUnsubscribeRef.current = unsub;
                        } else {
                          setSubcategoryOptions([]);
                        }
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="">Select category</option>
                      {categoriesList.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Subcategory</label>
                    <select
                      value={editForm.subCategoryID}
                      onChange={(e) => setEditForm({...editForm, subCategoryID: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={!editForm.categoryID}
                    >
                      <option value="">Select subcategory</option>
                      {subcategoryOptions.map((sub) => (
                        <option key={sub.id} value={sub.id}>{sub.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Product Variations Section */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border-2 border-blue-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Boxes className="w-5 h-5 text-blue-600" />
                    Product Variations
                    <span className="ml-2 px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                      {editForm.variations.filter(v => !v.isDeleted).length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setEditForm({
                        ...editForm,
                        variations: [
                          ...editForm.variations,
                          {
                            name: '',
                            SKU: '',
                            price: '',
                            stock: '',
                            imageURL: '',
                            imageFile: null,
                            imagePreview: null,
                            weight: '',
                            weightUnit: 'kg',
                            dimensions: { length: '', width: '', height: '' },
                            dimensionsUnit: 'cm',
                            pcsPerBox: '',
                            isFragile: false,
                            isNew: true
                          }
                        ]
                      });
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium flex items-center gap-2 shadow-md"
                  >
                    <Plus className="w-4 h-4" />
                    Add Variation
                  </button>
                </div>

                {editForm.variations.filter(v => !v.isDeleted).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Boxes className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No variations added yet. Click "Add Variation" to create one.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {editForm.variations.map((variation, index) => {
                      if (variation.isDeleted) return null;
                      
                      return (
                        <div key={index} className="bg-white rounded-xl p-5 border-2 border-gray-200 shadow-sm hover:shadow-md transition">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                {index + 1}
                              </div>
                              <span className="font-medium text-gray-700">Variation {index + 1}</span>
                              {variation.isNew && (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">NEW</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const updatedVariations = [...editForm.variations];
                                if (variation.isNew) {
                                  // Remove completely if it's new
                                  updatedVariations.splice(index, 1);
                                } else {
                                  // Mark for deletion if existing
                                  updatedVariations[index] = { ...variation, isDeleted: true };
                                }
                                setEditForm({ ...editForm, variations: updatedVariations });
                              }}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Variation Image */}
                            <div className="md:col-span-2">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Variation Image</label>
                              <div className="flex items-center gap-4">
                                {(variation.imagePreview || variation.imageURL) && (
                                  <div className="relative group">
                                    <img
                                      src={variation.imagePreview || variation.imageURL}
                                      alt={`Variation ${index + 1}`}
                                      className="w-20 h-20 rounded-lg object-cover border-2 border-gray-200"
                                    />
                                    <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                      <ImageIcon className="w-6 h-6 text-white" />
                                    </div>
                                  </div>
                                )}
                                <input
                                  type="file"
                                  accept="image/*"
                                  id={`variation-image-${index}`}
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const preview = URL.createObjectURL(file);
                                      const updatedVariations = [...editForm.variations];
                                      updatedVariations[index] = {
                                        ...variation,
                                        imageFile: file,
                                        imagePreview: preview
                                      };
                                      setEditForm({ ...editForm, variations: updatedVariations });
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => document.getElementById(`variation-image-${index}`)?.click()}
                                  className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium"
                                >
                                  {variation.imageURL ? 'Change Image' : 'Upload Image'}
                                </button>
                              </div>
                            </div>

                            {/* Variation Name */}
                            <div className="md:col-span-2">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Variation Name *</label>
                              <input
                                type="text"
                                value={variation.name}
                                onChange={(e) => {
                                  const updatedVariations = [...editForm.variations];
                                  updatedVariations[index] = { ...variation, name: e.target.value };
                                  setEditForm({ ...editForm, variations: updatedVariations });
                                }}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="e.g., Small, Medium, Large, Blue, Red"
                              />
                            </div>

                            {/* SKU */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">SKU *</label>
                              <input
                                type="text"
                                value={variation.SKU}
                                onChange={(e) => {
                                  const updatedVariations = [...editForm.variations];
                                  updatedVariations[index] = { ...variation, SKU: e.target.value };
                                  setEditForm({ ...editForm, variations: updatedVariations });
                                }}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="e.g., PROD-VAR-001"
                              />
                            </div>

                            {/* Price */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Price (₱) *</label>
                              <input
                                type="text"
                                value={variation.price}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // Allow empty or valid number
                                  if (value === '' || !isNaN(Number(value))) {
                                    const updatedVariations = [...editForm.variations];
                                    updatedVariations[index] = { ...variation, price: value };
                                    setEditForm({ ...editForm, variations: updatedVariations });
                                  }
                                }}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="0.00"
                              />
                            </div>

                            {/* Pcs per Box */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Pcs per Box *</label>
                              <input
                                type="text"
                                pattern="[0-9]*"
                                value={variation.pcsPerBox}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // Allow empty or valid integer only
                                  if (value === '' || /^\d+$/.test(value)) {
                                    const updatedVariations = [...editForm.variations];
                                    updatedVariations[index] = { ...variation, pcsPerBox: value === '' ? '' : Number(value) };
                                    setEditForm({ ...editForm, variations: updatedVariations });
                                  }
                                }}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="0"
                              />
                            </div>

                            {/* Stock - Hidden */}
                            {false && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Stock Quantity *</label>
                              <input
                                type="text"
                                value={variation.stock}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // Allow empty or valid integer
                                  if (value === '' || /^\d+$/.test(value)) {
                                    const updatedVariations = [...editForm.variations];
                                    updatedVariations[index] = { ...variation, stock: value };
                                    setEditForm({ ...editForm, variations: updatedVariations });
                                  }
                                }}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="0"
                              />
                            </div>
                            )}

                            {/* Weight */}
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Weight</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={variation.weight}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    // Allow empty or valid number
                                    if (value === '' || !isNaN(Number(value))) {
                                      const updatedVariations = [...editForm.variations];
                                      updatedVariations[index] = { ...variation, weight: value };
                                      setEditForm({ ...editForm, variations: updatedVariations });
                                    }
                                  }}
                                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="0.00"
                                />
                                <select
                                  value={variation.weightUnit}
                                  onChange={(e) => {
                                    const updatedVariations = [...editForm.variations];
                                    updatedVariations[index] = { ...variation, weightUnit: e.target.value };
                                    setEditForm({ ...editForm, variations: updatedVariations });
                                  }}
                                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                  <option value="kg">kg</option>
                                  <option value="g">g</option>
                                  <option value="lb">lb</option>
                                  <option value="oz">oz</option>
                                </select>
                              </div>
                            </div>

                            {/* Dimensions */}
                            <div className="md:col-span-2">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Dimensions (L × W × H)</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={variation.dimensions.length}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    // Allow empty or valid number
                                    if (value === '' || !isNaN(Number(value))) {
                                      const updatedVariations = [...editForm.variations];
                                      updatedVariations[index] = {
                                        ...variation,
                                        dimensions: { ...variation.dimensions, length: value }
                                      };
                                      setEditForm({ ...editForm, variations: updatedVariations });
                                    }
                                  }}
                                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="Length"
                                />
                                <span className="text-gray-400 flex items-center">×</span>
                                <input
                                  type="text"
                                  value={variation.dimensions.width}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    // Allow empty or valid number
                                    if (value === '' || !isNaN(Number(value))) {
                                      const updatedVariations = [...editForm.variations];
                                      updatedVariations[index] = {
                                        ...variation,
                                        dimensions: { ...variation.dimensions, width: value }
                                      };
                                      setEditForm({ ...editForm, variations: updatedVariations });
                                    }
                                  }}
                                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="Width"
                                />
                                <span className="text-gray-400 flex items-center">×</span>
                                <input
                                  type="text"
                                  value={variation.dimensions.height}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    // Allow empty or valid number
                                    if (value === '' || !isNaN(Number(value))) {
                                      const updatedVariations = [...editForm.variations];
                                      updatedVariations[index] = {
                                        ...variation,
                                        dimensions: { ...variation.dimensions, height: value }
                                      };
                                      setEditForm({ ...editForm, variations: updatedVariations });
                                    }
                                  }}
                                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="Height"
                                />
                                <select
                                  value={variation.dimensionsUnit}
                                  onChange={(e) => {
                                    const updatedVariations = [...editForm.variations];
                                    updatedVariations[index] = { ...variation, dimensionsUnit: e.target.value };
                                    setEditForm({ ...editForm, variations: updatedVariations });
                                  }}
                                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                  <option value="cm">cm</option>
                                  <option value="m">m</option>
                                  <option value="in">in</option>
                                  <option value="ft">ft</option>
                                </select>
                              </div>
                            </div>

                            {/* Fragile Checkbox */}
                            <div className="md:col-span-2">
                              <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={variation.isFragile || false}
                                  onChange={(e) => {
                                    const updatedVariations = [...editForm.variations];
                                    updatedVariations[index] = { ...variation, isFragile: e.target.checked };
                                    setEditForm({ ...editForm, variations: updatedVariations });
                                  }}
                                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                />
                                <AlertTriangle className={`w-4 h-4 ${variation.isFragile ? 'text-orange-500' : 'text-gray-400'}`} />
                                <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">
                                  Mark as fragile (requires special handling)
                                </span>
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Warranty & Compliance Section */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Warranty & Compliance</h3>
                <label className="flex items-center gap-2 mb-4 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="accent-green-600 h-4 w-4"
                    checked={editForm.insuranceAndEvaluation}
                    onChange={(e) => setEditForm({ ...editForm, insuranceAndEvaluation: e.target.checked })}
                  />
                  <span className="font-medium">Insurance and Evaluation</span>
                  <span className="relative group inline-flex">
                    <span
                      tabIndex={0}
                      aria-label="What is Insurance and Evaluation?"
                      className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-400 text-gray-500 text-[10px] font-semibold leading-none cursor-help focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      ?
                    </span>
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus-within:block bg-gray-900 text-white text-xs rounded-md px-2 py-1 w-64 z-10 shadow-lg">
                      Check if this item requires insurance coverage or a separate evaluation before shipping or use.
                    </span>
                  </span>
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Warranty Type</label>
                    <select
                      value={editForm.warrantyType}
                      onChange={(e) => setEditForm({...editForm, warrantyType: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="">No Warranty</option>
                      <option value="manufacturer">Manufacturer Warranty</option>
                      <option value="seller">Seller Warranty</option>
                      <option value="extended">Extended Warranty</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Warranty Duration</label>
                    <select
                      value={editForm.warrantyDuration}
                      onChange={(e) => setEditForm({...editForm, warrantyDuration: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={!editForm.warrantyType}
                    >
                      <option value="">Select Duration</option>
                      <option value="30-days">30 Days</option>
                      <option value="60-days">60 Days</option>
                      <option value="90-days">90 Days</option>
                      <option value="6-months">6 Months</option>
                      <option value="1-year">1 Year</option>
                      <option value="2-years">2 Years</option>
                      <option value="3-years">3 Years</option>
                      <option value="lifetime">Lifetime</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Warranty Policy</label>
                    <textarea
                      value={editForm.warrantyPolicy}
                      onChange={(e) => setEditForm({...editForm, warrantyPolicy: e.target.value})}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Describe your warranty policy and terms..."
                      disabled={!editForm.warrantyType}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 rounded-b-2xl border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => !submitting && setShowEditModal(false)}
                disabled={submitting}
                className="px-5 py-2.5 border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleItemSave}
                disabled={submitting || !editForm.name}
                className="px-5 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Dialog for Archive/Violation/Pending QC */}
      <Dialog open={statusDialog.open} onOpenChange={(open) => !open && setStatusDialog({ open: false, productName: '', status: null, productId: '' })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statusDialog.status === 'archive' ? 'Activate Archived Product' : 
               statusDialog.status === 'violation' ? 'Product Violation' : 
               'Product Under Review'}
            </DialogTitle>
            <DialogDescription>
              {statusDialog.status === 'archive' ? (
                <span>
                  <strong>{statusDialog.productName}</strong> is archived. Do you want to set it to active?
                </span>
              ) : statusDialog.status === 'violation' ? (
                <span>
                  Please edit your item to be sent again in Pending QC for review.
                </span>
              ) : (
                <span>
                  Your product is still under review. Please wait for the moment.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            {statusDialog.status === 'archive' ? (
              <>
                <Button 
                  variant="outline" 
                  onClick={() => setStatusDialog({ open: false, productName: '', status: null, productId: '' })}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSetArchiveToActive}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  Set to Active
                </Button>
              </>
            ) : (
              <Button 
                onClick={() => setStatusDialog({ open: false, productName: '', status: null, productId: '' })}
                className="w-full"
              >
                OK
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false, productId: '', productName: '' })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>
              Do you wish to delete <strong>{deleteDialog.productName}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button 
              variant="outline" 
              onClick={() => setDeleteDialog({ open: false, productId: '', productName: '' })}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleDeleteProduct}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ItemsList;
