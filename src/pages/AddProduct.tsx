import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import ProductService from '@/services/product';
import { getWebUsers } from '@/services/webUserService';
import { storage, db } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, getDocs } from 'firebase/firestore';
import ComplianceService, { COMPLIANCE_DEFAULTS, type Option } from '@/services/compliance';
import imageCompression from 'browser-image-compression';

type ItemStatus = 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'deleted';

const AddProduct: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { uid, isSeller, isAdmin } = useAuth();
  const { isSubAccount, parentId } = useAuth();

  // Admin seller picker
  const [sellers, setSellers] = useState<Array<{ uid: string; name?: string; email: string }>>([]);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const effectiveSellerId = isSeller ? (isSubAccount ? (parentId || uid) : uid) : selectedSellerId;

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isAdmin) return;
      try {
        const rows = await getWebUsers(['seller' as any]);
        if (!mounted) return;
        const mapped = rows.map((u: any) => ({ uid: u.uid, name: u.name, email: u.email }));
        setSellers(mapped);
        if (!selectedSellerId && mapped.length > 0) setSelectedSellerId(mapped[0].uid);
      } catch (e) {
        console.error('Failed to load sellers', e);
        toast({ title: 'Failed to load sellers', description: 'Please try again later.' });
      }
    })();
    return () => { mounted = false; };
  }, [isAdmin]);

  // Dynamic Categories/Subcategories from Firestore
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [subcategories, setSubcategories] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string>('');

  // Image compression utility
  const compressImage = async (file: File): Promise<File> => {
    const options = {
      maxSizeMB: 1, // Maximum file size in MB
      maxWidthOrHeight: 1200, // Maximum width or height
      useWebWorker: true, // Use web worker for better performance
      fileType: file.type, // Maintain original file type
      initialQuality: 0.85, // Quality level (85%)
    };
    try {
      const compressedFile = await imageCompression(file, options);
      console.log(`Compressed ${file.name}: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
      return compressedFile;
    } catch (error) {
      console.error('Image compression failed, using original file:', error);
      return file; // Fallback to original file if compression fails
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'Category'));
        const rows = snap.docs.map(d => {
          const data: any = d.data();
          const name = String(
            data?.categoryName || data?.CategoryName ||
            data?.name || data?.category || data?.Category || data?.title || data?.displayName || data?.label || d.id
          ).trim();
          return { id: d.id, name };
        }).sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setCategories(rows);
      } catch (e) {
        if (!cancelled) setCategories([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCategoryId) { setSubcategories([]); return; }
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'Category', selectedCategoryId, 'subCategory'));
        const rows = snap.docs.map(d => {
          const data: any = d.data();
          const name = String(
            data?.subCategoryName || data?.subcategoryName ||
            data?.name || data?.title || data?.displayName || data?.label || d.id
          ).trim();
          return { id: d.id, name };
        }).filter(r => !!r.name).sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setSubcategories(rows);
      } catch (e) {
        if (!cancelled) setSubcategories([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCategoryId]);

  // Compliance options state
  const [complianceOpts, setComplianceOpts] = useState({
    dangerousGoods: COMPLIANCE_DEFAULTS.dangerousGoods,
    warrantyTypes: COMPLIANCE_DEFAULTS.warrantyTypes,
    durations: COMPLIANCE_DEFAULTS.durations,
  });

  useEffect(() => {
    const unsub = ComplianceService.listen((opts) => setComplianceOpts(opts));
    return () => unsub();
  }, []);

  // Form state
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [available, setAvailable] = useState<boolean>(true);
  const [preOrder, setPreOrder] = useState<boolean>(false);
  const [showErrors, setShowErrors] = useState(false);

  const [newItem, setNewItem] = useState<{
    name: string;
    description: string;
    imageUrl: string;
    imageFile?: File | null;
    imagePreview?: string | null;
    category: string; // display name
    subcategory: string; // display name
    price: number;
    specialPrice: number;
    sku: string;
    weight: number;
    dimensions: { length: number; width: number; height: number };
    // New: units for weight and dimensions
    weightUnit: 'g' | 'kg' | '';
    dimensionUnit: 'mm' | 'cm' | 'in' | '';
    suggestedThreshold: number;
    unit: string;
    inStock: number;
    simpleVariantName?: string;
    // Updated: dangerous goods simplified to two states
    dangerousGoods?: 'none' | 'dangerous';
    warrantyType?: string;
    warrantyDuration?: string;
    // New boolean: allow inquiry toggle
    allowInquiry: boolean;
    // New boolean: insurance and evaluation required
    insuranceAndEvaluation: boolean;
  }>({
    name: '',
    description: '',
    imageUrl: '',
    imageFile: null,
    imagePreview: null,
    category: '',
    subcategory: '',
    price: 0,
    specialPrice: 0,
    sku: '',
    weight: 0,
    dimensions: { length: 0, width: 0, height: 0 },
    // New defaults: kg and cm
    weightUnit: 'kg',
    dimensionUnit: 'cm',
    suggestedThreshold: 0,
    unit: '',
    inStock: 0,
    simpleVariantName: '',
    // Defaults for warranty/compliance
    dangerousGoods: 'none',
    warrantyType: 'No warranty',
    warrantyDuration: '',
    allowInquiry: false,
    insuranceAndEvaluation: false,
  });

  const resetNewItem = () => setNewItem({
    name: '', description: '', imageUrl: '', imageFile: null, imagePreview: null, category: '', subcategory: '', price: 0, specialPrice: 0, sku: '', weight: 0,
    dimensions: { length: 0, width: 0, height: 0 }, weightUnit: 'kg', dimensionUnit: 'cm', suggestedThreshold: 0, unit: '', inStock: 0, simpleVariantName: '',
    dangerousGoods: 'none', warrantyType: 'No warranty', warrantyDuration: '', allowInquiry: false, insuranceAndEvaluation: false,
  });

  const variantFileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingVariantPick, setPendingVariantPick] = useState<string | null>(null);
  const [variants, setVariants] = useState<Array<{ key: string; options: Record<string, string>; price: number; stock: number; sku?: string; specialPrice?: number; available?: boolean; isFragile?: boolean; imageUrl?: string; imageFile?: File | null; imagePreview?: string | null; name?: string }>>([]);

  const triggerVariantFilePick = (key: string) => {
    if (!variantFileInputs.current[key]) return;
    variantFileInputs.current[key]!.click();
  };

  useEffect(() => {
    if (!pendingVariantPick) return;
    const el = variantFileInputs.current[pendingVariantPick];
    if (el) {
      el.click();
      setPendingVariantPick(null);
    }
  }, [variants, pendingVariantPick]);

  const handleVariantFileChange = async (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Compress the variant image before creating preview
    const compressedFile = await compressImage(file);
    const preview = URL.createObjectURL(compressedFile);
    
    setVariants((list) => list.map(v => {
      if (v.key !== key) return v;
      if (v.imagePreview) URL.revokeObjectURL(v.imagePreview);
      return { ...v, imageFile: compressedFile, imagePreview: preview };
    }));
    if (variantFileInputs.current[key]) variantFileInputs.current[key]!.value = '';
  };

  const addBlankVariant = () => {
    const key = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setVariants((prev) => [...prev, { key, options: {}, price: 0, stock: 0, sku: undefined, specialPrice: 0, available: true, isFragile: false, imageUrl: undefined, imageFile: null, imagePreview: null, name: '' }]);
    setPendingVariantPick(key);
  };

  const handlePickImage = () => fileInputRef.current?.click();

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Compress the image before creating preview
    const compressedFile = await compressImage(file);
    const preview = URL.createObjectURL(compressedFile);
    
    setNewItem((s) => {
      if (s.imagePreview) URL.revokeObjectURL(s.imagePreview);
      return { ...s, imageFile: compressedFile, imagePreview: preview };
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Validation: require all fields for Create action
  const validation = useMemo(() => {
    const errors: Record<string, string> = {};
    // Seller (admin only)
    if (isAdmin && !selectedSellerId) errors.seller = 'Select a seller';

    // Product-level required fields
    if (!newItem.name?.trim()) errors.name = 'Product name is required';
    if (!newItem.sku?.trim() && (variants.length === 0)) errors.sku = 'SKU is required';
    if (!newItem.description?.trim()) errors.description = 'Description is required';
    if (!(newItem.imagePreview || newItem.imageUrl || newItem.imageFile)) errors.image = 'Product image is required';
    if (!selectedCategoryId) errors.category = 'Category is required';
    if (!selectedSubcategoryId) errors.subcategory = 'Subcategory is required';

    // Numbers must be present and > 0 (or >=0 for stock)
    if (!(Number.isFinite(newItem.price) && newItem.price > 0) && variants.length === 0) errors.price = 'Price must be greater than 0';
    if (!(Number.isFinite(newItem.weight) && newItem.weight > 0)) errors.weight = 'Weight must be greater than 0';
    if (!newItem.weightUnit) errors.weightUnit = 'Weight unit is required';
    if (!newItem.unit?.trim()) errors.unit = 'Unit is required';
    if (!(Number.isFinite(newItem.dimensions.length) && newItem.dimensions.length > 0)) errors.length = 'Length must be greater than 0';
    if (!(Number.isFinite(newItem.dimensions.width) && newItem.dimensions.width > 0)) errors.width = 'Width must be greater than 0';
    if (!(Number.isFinite(newItem.dimensions.height) && newItem.dimensions.height > 0)) errors.height = 'Height must be greater than 0';
    if (!newItem.dimensionUnit) errors.dimensionUnit = 'Dimension unit is required';
    // Suggested threshold validation - Temporarily disabled
    // if (!(Number.isFinite(newItem.suggestedThreshold) && newItem.suggestedThreshold >= 0)) errors.threshold = 'Suggested threshold is required';

    if (variants.length === 0) {
      if (!(Number.isFinite(newItem.inStock) && newItem.inStock >= 0)) errors.inStock = 'Initial stock is required';
    } else {
      variants.forEach((v, i) => {
        if (!v.name?.trim()) errors[`variants.${i}.name`] = `Variant ${i + 1}: name is required`;
        if (!(Number.isFinite(v.price) && v.price > 0)) errors[`variants.${i}.price`] = `Variant ${i + 1}: price must be > 0`;
        if (!(Number.isFinite(v.stock) && v.stock >= 0)) errors[`variants.${i}.stock`] = `Variant ${i + 1}: stock must be ≥ 0`;
        if (!v.sku?.trim()) errors[`variants.${i}.sku`] = `Variant ${i + 1}: SKU is required`;
      });
    }

    return { errors, isValid: Object.keys(errors).length === 0 };
  }, [isAdmin, selectedSellerId, newItem, variants, selectedCategoryId, selectedSubcategoryId]);

  const handleCreateClick = () => {
    if (!validation.isValid) {
      setShowErrors(true);
      const messages = Object.values(validation.errors);
      const summary = messages.slice(0, 5).join(' • ');
      toast({ title: 'Please complete all required fields', description: summary || 'Missing required information' });
      return;
    }
    handleCreateItem();
  };

  const [showSubmittedDialog, setShowSubmittedDialog] = useState(false);
  const [submittedProductName, setSubmittedProductName] = useState<string>('');

  const handleCreateItem = useCallback(async (createStatus?: ItemStatus) => {
    if (!effectiveSellerId) {
      toast({ title: 'Select a seller first', description: 'Choose a seller to create items under.' });
      return;
    }
    if (!newItem.name.trim()) {
      toast({ title: 'Name is required' });
      return;
    }
    try {
      setSubmitting(true);

      // Upload product image if selected
      let productImageUrl: string | undefined = newItem.imageUrl?.trim() || undefined;
      let imageVersion: string | null = null;
      if (newItem.imageFile) {
        const ts = Date.now().toString();
        const safeName = encodeURIComponent(newItem.imageFile.name);
        const p = `ProductImages/${ts}/${safeName}`;
        const r = storageRef(storage, p);
        await uploadBytes(r, newItem.imageFile);
        productImageUrl = await getDownloadURL(r);
        imageVersion = ts;
      }

      // Prepare variants and upload any new variant images
      const variationImageVersions: Record<string, string> = {};
      const variantsToSave: Array<{ key: string; options: Record<string, string>; price: number; stock: number; sku?: string; specialPrice?: number; available?: boolean; isFragile?: boolean; imageUrl?: string; name?: string }>=[];
      for (let idx = 0; idx < variants.length; idx++) {
        const v = variants[idx];
        let vUrl = v.imageUrl;
        if (v.imageFile) {
          const ts = Date.now().toString();
          const safeV = encodeURIComponent(v.imageFile.name);
          const path = `ProductImages/${effectiveSellerId}/variants/${ts}_${safeV}`;
          const ref = storageRef(storage, path);
          await uploadBytes(ref, v.imageFile);
          vUrl = await getDownloadURL(ref);
          variationImageVersions[String(idx)] = ts;
        }
        variantsToSave.push({ key: v.key, options: v.options, price: Number(v.price) || 0, stock: Number(v.stock) || 0, sku: v.sku, specialPrice: v.specialPrice, available: v.available, isFragile: v.isFragile, imageUrl: vUrl, name: (v.name || '').trim() || undefined });
      }

      // Compute lowestPrice
      const lowestPrice = variantsToSave.length > 0
        ? Math.min(...variantsToSave.map(v => (v.specialPrice != null && v.specialPrice > 0 ? Number(v.specialPrice) : Number(v.price)) || 0))
        : (newItem.specialPrice && newItem.specialPrice > 0 ? Number(newItem.specialPrice) : Number(newItem.price) || 0);

      // Create Product
      const productRef = await ProductService.createProduct({
        sellerId: effectiveSellerId!,
        name: newItem.name.trim(),
        description: newItem.description.trim(),
        imageURL: productImageUrl || '',
        imageVersion,
        categoryID: selectedCategoryId || null,
        subCategoryID: selectedSubcategoryId || null,
        isActive: createStatus === 'draft' ? false : true,
        status: createStatus === 'draft' ? 'draft' : undefined,
        clickCounter: 0,
        lowestPrice,
        variationImageVersions,
        suggestedThreshold: newItem.suggestedThreshold > 0 ? newItem.suggestedThreshold : null,
        // Updated warranty/compliance field
        dangerousGoods: newItem.dangerousGoods || 'none',
        warrantyType: (newItem.warrantyType || '').trim() || null,
        warrantyDuration: (newItem.warrantyDuration || '').trim() || null,
        // New inquiry flag
        allowInquiry: newItem.allowInquiry,
        // New insurance & evaluation flag
        insuranceAndEvaluation: newItem.insuranceAndEvaluation,
      } as any);

      // Add variations (at least one)
      const variationsForProduct = (variantsToSave.length > 0)
        ? variantsToSave.map((v, i) => ({
            sku: v.sku,
            price: v.specialPrice != null && v.specialPrice > 0 ? Number(v.specialPrice) : Number(v.price),
            stock: v.stock,
            // Persist weight and dimensions with units
            weight: newItem.weight || undefined,
            weightUnit: newItem.weightUnit || undefined,
            dimensions: newItem.dimensions || undefined,
            dimensionsUnit: newItem.dimensionUnit || undefined,
            imageURL: v.imageUrl || null,
            name: v.name?.trim() || `batch${i}`,
            isFragile: v.isFragile ?? false,
          }))
        : [{
            sku: newItem.sku || undefined,
            price: (newItem.specialPrice && newItem.specialPrice > 0 ? Number(newItem.specialPrice) : Number(newItem.price) || 0),
            stock: Number(newItem.inStock) || 0,
            // Persist weight and dimensions with units
            weight: newItem.weight || undefined,
            weightUnit: newItem.weightUnit || undefined,
            dimensions: newItem.dimensions || undefined,
            dimensionsUnit: newItem.dimensionUnit || undefined,
            imageURL: productImageUrl || null,
            name: (newItem.simpleVariantName || '').trim() || 'default',
            isFragile: false,
          }];

      await ProductService.addVariations(productRef.id, variationsForProduct);

      // Cleanup previews
      if (newItem.imagePreview) URL.revokeObjectURL(newItem.imagePreview);
      variants.forEach(v => { if (v.imagePreview) URL.revokeObjectURL(v.imagePreview); });

      const createdName = newItem.name?.trim() || '';
      resetNewItem();
      setVariants([]);
      setSelectedCategoryId('');
      setSelectedSubcategoryId('');

      if (createStatus === 'draft') {
        toast({ title: 'Draft saved', description: `${createdName || 'Product'} has been saved as a draft.` });
        navigate('/?tab=inventory');
      } else {
        // Show centered confirmation dialog instead of immediate navigation
        setSubmittedProductName(createdName);
        setShowSubmittedDialog(true);
      }
    } catch (e) {
      console.error('Create item failed', e);
      toast({ title: 'Failed to create product', description: 'Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }, [effectiveSellerId, newItem, variants, selectedCategoryId, selectedSubcategoryId]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full max-w-none px-6 py-6 lg:px-8">{/* expanded from max-w-5xl to full width */}


        {/* Admin seller picker */}
        {isAdmin && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Seller</label>
            <select
              value={selectedSellerId || ''}
              onChange={(e) => setSelectedSellerId(e.target.value || null)}
              className="w-full max-w-md text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              {sellers.map(s => (
                <option key={s.uid} value={s.uid}>{s.name || s.email} ({s.uid})</option>
              ))}
            </select>
          </div>
        )}

        {/* Form card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6">{/* increased padding */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              {/* Inquiry toggle moved here above Product Name */}
              {/* <div className="flex items-center mb-2">
                <label className="text-xs font-medium text-gray-600 mr-2">Inquiry</label>
                <button
                  type="button"
                  onClick={() => setNewItem(s => ({...s, allowInquiry: !s.allowInquiry}))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${newItem.allowInquiry ? 'bg-teal-600' : 'bg-gray-300'}`}
                  role="switch"
                  aria-checked={newItem.allowInquiry}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${newItem.allowInquiry ? 'translate-x-5' : 'translate-x-1'}`}></span>
                </button>
              <p className="mt-1 text-[11px] text-gray-500">. Allow Inquiry: <span className={newItem.allowInquiry ? 'text-teal-600 font-medium' : 'text-gray-600'}>{newItem.allowInquiry ? 'Enabled' : 'Disabled'}</span></p>

              </div> */}
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Product Name {!newItem.name.trim() && <span className="text-red-500">*</span>}
              </label>
              <input value={newItem.name} onChange={(e)=> setNewItem(s=> ({...s, name: e.target.value}))} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="e.g. Alginate Powder" />
            </div>
            <div>
              {/* SKU on the right */}
              <label className="block text-xs font-medium text-gray-600 mb-1">
                SKU {variants.length === 0 && !newItem.sku.trim() && <span className="text-red-500">*</span>}
              </label>
              <input value={newItem.sku} onChange={(e)=> setNewItem(s=> ({...s, sku: e.target.value}))} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="e.g. SKU-ALG-001" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Description {!newItem.description.trim() && <span className="text-red-500">*</span>}
            </label>
            <textarea value={newItem.description} onChange={(e)=> setNewItem(s=> ({...s, description: e.target.value}))} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" rows={3} placeholder="Short product description" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Product Image {!(newItem.imagePreview || newItem.imageUrl || newItem.imageFile) && <span className="text-red-500">*</span>}
              </label>
              <p className="text-[11px] text-gray-500 mb-1">Main product thumbnail (used when no variants, or as fallback)</p>
              <div className="flex items-center gap-3">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                <button type="button" onClick={handlePickImage} className="px-3 py-2 text-sm font-medium bg-gray-100 rounded-lg hover:bg-gray-300" disabled={!effectiveSellerId}>
                  {(newItem.imagePreview || newItem.imageUrl) ? 'Replace Image' : 'Add Image'}
                </button>
                {(newItem.imagePreview || newItem.imageUrl) && (
                  <img src={newItem.imagePreview || newItem.imageUrl} alt="preview" className="h-10 w-10 rounded object-cover border" />
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Category {!selectedCategoryId && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={selectedCategoryId}
                  onChange={(e)=> {
                    const id = e.target.value;
                    setSelectedCategoryId(id);
                    const cat = categories.find(c => c.id === id);
                    setNewItem(s=> ({...s, category: cat?.name || '', subcategory: ''}));
                    setSelectedSubcategoryId('');
                  }}
                  className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="">Select category...</option>
                  {categories.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Subcategory {!selectedSubcategoryId && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={selectedSubcategoryId}
                  onChange={(e)=> {
                    const id = e.target.value;
                    setSelectedSubcategoryId(id);
                    const sub = subcategories.find(sc => sc.id === id);
                    setNewItem(s=> ({...s, subcategory: sub?.name || ''}));
                  }}
                  className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  disabled={!selectedCategoryId || subcategories.length === 0}
                >
                  <option value="">Select subcategory...</option>
                  {subcategories.map(sc => (<option key={sc.id} value={sc.id}>{sc.name}</option>))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Price {variants.length === 0 && !(Number.isFinite(newItem.price) && newItem.price > 0) && <span className="text-red-500">*</span>}
              </label>
              <input type="text" inputMode="decimal" value={newItem.price === 0 ? '' : newItem.price} onChange={(e)=> {
                const val = e.target.value;
                if (val === '' || /^\d*\.?\d*$/.test(val)) setNewItem(s=> ({...s, price: val === '' ? 0 : parseFloat(val) || 0}));
              }} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Weight {!(Number.isFinite(newItem.weight) && newItem.weight > 0) && <span className="text-red-500">*</span>}
              </label>
              <div className="flex gap-2">
                <input type="text" inputMode="decimal" value={newItem.weight === 0 ? '' : newItem.weight} onChange={(e)=> {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) setNewItem(s=> ({...s, weight: val === '' ? 0 : parseFloat(val) || 0}));
                }} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="0" />
                <select value={newItem.weightUnit} onChange={(e)=> {
                  const newUnit = e.target.value as 'kg' | 'g';
                  const oldUnit = newItem.weightUnit;
                  let convertedWeight = newItem.weight;
                  
                  if (oldUnit === 'kg' && newUnit === 'g') {
                    convertedWeight = newItem.weight * 1000;
                  } else if (oldUnit === 'g' && newUnit === 'kg') {
                    convertedWeight = newItem.weight / 1000;
                  }
                  
                  setNewItem(s=> ({...s, weight: convertedWeight, weightUnit: newUnit}));
                }} className="min-w-[88px] text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent">
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Unit {!newItem.unit.trim() && <span className="text-red-500">*</span>}
              </label>
              <input value={newItem.unit} onChange={(e)=> setNewItem(s=> ({...s, unit: e.target.value}))} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="pcs, box" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Length {!(Number.isFinite(newItem.dimensions.length) && newItem.dimensions.length > 0) && <span className="text-red-500">*</span>}
              </label>
              <div className="flex gap-2">
                <input type="text" inputMode="decimal" value={newItem.dimensions.length === 0 ? '' : newItem.dimensions.length} onChange={(e)=> {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) setNewItem(s=> ({ ...s, dimensions: { ...s.dimensions, length: val === '' ? 0 : parseFloat(val) || 0 }}));
                }} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="0" />
                <select value={newItem.dimensionUnit} onChange={(e)=> {
                  const newUnit = e.target.value as 'cm' | 'mm' | 'in';
                  const oldUnit = newItem.dimensionUnit;
                  
                  const convert = (value: number, from: string, to: string): number => {
                    if (from === to) return value;
                    
                    let inCm = value;
                    if (from === 'mm') inCm = value / 10;
                    else if (from === 'in') inCm = value * 2.54;
                    
                    if (to === 'mm') return inCm * 10;
                    else if (to === 'in') return inCm / 2.54;
                    return inCm;
                  };
                  
                  setNewItem(s=> ({
                    ...s,
                    dimensions: {
                      length: convert(s.dimensions.length, oldUnit, newUnit),
                      width: convert(s.dimensions.width, oldUnit, newUnit),
                      height: convert(s.dimensions.height, oldUnit, newUnit),
                    },
                    dimensionUnit: newUnit
                  }));
                }} className="min-w-[88px] text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent">
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                  <option value="in">in</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Width {!(Number.isFinite(newItem.dimensions.width) && newItem.dimensions.width > 0) && <span className="text-red-500">*</span>}
              </label>
              <div className="flex gap-2">
                <input type="text" inputMode="decimal" value={newItem.dimensions.width === 0 ? '' : newItem.dimensions.width} onChange={(e)=> {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) setNewItem(s=> ({ ...s, dimensions: { ...s.dimensions, width: val === '' ? 0 : parseFloat(val) || 0 }}));
                }} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="0" />
                <select value={newItem.dimensionUnit} onChange={(e)=> {
                  const newUnit = e.target.value as 'cm' | 'mm' | 'in';
                  const oldUnit = newItem.dimensionUnit;
                  
                  const convert = (value: number, from: string, to: string): number => {
                    if (from === to) return value;
                    
                    let inCm = value;
                    if (from === 'mm') inCm = value / 10;
                    else if (from === 'in') inCm = value * 2.54;
                    
                    if (to === 'mm') return inCm * 10;
                    else if (to === 'in') return inCm / 2.54;
                    return inCm;
                  };
                  
                  setNewItem(s=> ({
                    ...s,
                    dimensions: {
                      length: convert(s.dimensions.length, oldUnit, newUnit),
                      width: convert(s.dimensions.width, oldUnit, newUnit),
                      height: convert(s.dimensions.height, oldUnit, newUnit),
                    },
                    dimensionUnit: newUnit
                  }));
                }} className="min-w-[88px] text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent">
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                  <option value="in">in</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Height {!(Number.isFinite(newItem.dimensions.height) && newItem.dimensions.height > 0) && <span className="text-red-500">*</span>}
              </label>
              <div className="flex gap-2">
                <input type="text" inputMode="decimal" value={newItem.dimensions.height === 0 ? '' : newItem.dimensions.height} onChange={(e)=> {
                  const val = e.target.value;
                  if (val === '' || /^\d*\.?\d*$/.test(val)) setNewItem(s=> ({ ...s, dimensions: { ...s.dimensions, height: val === '' ? 0 : parseFloat(val) || 0 }}));
                }} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="0" />
                <select value={newItem.dimensionUnit} onChange={(e)=> {
                  const newUnit = e.target.value as 'cm' | 'mm' | 'in';
                  const oldUnit = newItem.dimensionUnit;
                  
                  const convert = (value: number, from: string, to: string): number => {
                    if (from === to) return value;
                    
                    let inCm = value;
                    if (from === 'mm') inCm = value / 10;
                    else if (from === 'in') inCm = value * 2.54;
                    
                    if (to === 'mm') return inCm * 10;
                    else if (to === 'in') return inCm / 2.54;
                    return inCm;
                  };
                  
                  setNewItem(s=> ({
                    ...s,
                    dimensions: {
                      length: convert(s.dimensions.length, oldUnit, newUnit),
                      width: convert(s.dimensions.width, oldUnit, newUnit),
                      height: convert(s.dimensions.height, oldUnit, newUnit),
                    },
                    dimensionUnit: newUnit
                  }));
                }} className="min-w-[88px] text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent">
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                  <option value="in">in</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Suggested Threshold - Temporarily disabled */}
            {/* <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Suggested Threshold</label>
              <input type="number" value={newItem.suggestedThreshold} onChange={(e)=> setNewItem(s=> ({...s, suggestedThreshold: Number(e.target.value)}))} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="0" />
            </div> */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Initial Stock {variants.length === 0 && !(Number.isFinite(newItem.inStock) && newItem.inStock >= 0) && <span className="text-red-500">*</span>}
              </label>
              <input type="number" value={newItem.inStock} onChange={(e)=> setNewItem(s=> ({...s, inStock: Number(e.target.value)}))} className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="0" />
            </div>
            <div className="hidden md:block" />
          </div>

          {/* Price, Stock & Variants */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Price, Stock & Variants</h4>
                <p className="text-xs text-gray-500">Add variant rows to set per-variant price and stock. Each variant can have its own image (optional).</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50" onClick={addBlankVariant}>
                  + Add Variant
                </button>
              </div>
            </div>

            {/* Simple product row when no variants */}
            {variants.length === 0 && (
              <div className="border rounded overflow-hidden">
                <div className="grid grid-cols-8 text-xs bg-gray-50">
                  <div className="p-2 font-medium text-gray-600">Image</div>
                  <div className="p-2 font-medium text-gray-600">Name</div>
                  <div className="p-2 font-medium text-gray-600">Price</div>
                  <div className="p-2 font-medium text-gray-600">Special Price</div>
                  <div className="p-2 font-medium text-gray-600">Stock</div>
                  <div className="p-2 font-medium text-gray-600">SellerSKU</div>
                  <div className="p-2 font-medium text-gray-600">Availability</div>
                  <div className="p-2 font-medium text-gray-600">Fragile</div>
                </div>
                <div className="grid grid-cols-8 items-center text-xs">
                  <div className="p-2">
                    <button type="button" className="text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50" onClick={handlePickImage} title="Choose product image" disabled={!effectiveSellerId}>
                      {(newItem.imagePreview || newItem.imageUrl) ? 'Replace Image' : 'Add Image'}
                    </button>
                    {(newItem.imagePreview || newItem.imageUrl) && (
                      <img src={newItem.imagePreview || newItem.imageUrl} alt="preview" className="inline-block ml-2 h-8 w-8 rounded object-cover border" />
                    )}
                  </div>
                  <div className="p-2"><input value={newItem.simpleVariantName || ''} onChange={(e)=> setNewItem(s=> ({...s, simpleVariantName: e.target.value}))} className="w-full p-1 border rounded" placeholder="e.g. default" /></div>
                  <div className="p-2"><input type="number" value={newItem.price} onChange={(e)=> setNewItem(s=> ({...s, price: Number(e.target.value)}))} className="w-full p-1 border rounded" /></div>
                  <div className="p-2"><input type="number" value={newItem.specialPrice} onChange={(e)=> setNewItem(s=> ({...s, specialPrice: Number(e.target.value)}))} className="w-full p-1 border rounded" /></div>
                  <div className="p-2"><input type="number" value={newItem.inStock} onChange={(e)=> setNewItem(s=> ({...s, inStock: Number(e.target.value)}))} className="w-full p-1 border rounded" /></div>
                  <div className="p-2"><input value={newItem.sku} onChange={(e)=> setNewItem(s=> ({...s, sku: e.target.value}))} className="w-full p-1 border rounded" /></div>
                  <div className="p-2"><input type="checkbox" className="accent-teal-600" checked={available} onChange={(e)=> setAvailable(e.target.checked)} /></div>
                  <div className="p-2"><input type="checkbox" className="accent-teal-600" checked={false} disabled /></div>
                </div>
              </div>
            )}

            {/* Variants grid */}
            {variants.length > 0 && (
              <div className="mt-4 overflow-auto border rounded">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 font-medium text-gray-600">Remove</th>
                      <th className="text-left p-2 font-medium text-gray-600">Image</th>
                      <th className="text-left p-2 font-medium text-gray-600">
                        Name <span className="text-red-500">*</span>
                      </th>
                      <th className="text-left p-2 font-medium text-gray-600">
                        Price <span className="text-red-500">*</span>
                      </th>
                      <th className="text-left p-2 font-medium text-gray-600">Special Price</th>
                      <th className="text-left p-2 font-medium text-gray-600">
                        Stock <span className="text-red-500">*</span>
                      </th>
                      <th className="text-left p-2 font-medium text-gray-600">
                        SellerSKU <span className="text-red-500">*</span>
                      </th>
                      <th className="text-left p-2 font-medium text-gray-600">Availability</th>
                      <th className="text-left p-2 font-medium text-gray-600">Fragile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v, idx) => (
                      <tr key={v.key} className={idx % 2 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="p-2">
                          <button 
                            type="button" 
                            className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200"
                            onClick={() => {
                              if (v.imagePreview) URL.revokeObjectURL(v.imagePreview);
                              setVariants((list) => list.filter(x => x.key !== v.key));
                            }}
                            title="Remove variant"
                          >
                            ✕
                          </button>
                        </td>
                        <td className="p-2">
                          <input type="file" accept="image/*" ref={(el) => { variantFileInputs.current[v.key] = el; }} className="hidden" onChange={(e) => handleVariantFileChange(v.key, e)} />
                          <button type="button" className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200" onClick={() => triggerVariantFilePick(v.key)} disabled={!effectiveSellerId}>
                            {v.imagePreview || v.imageUrl ? 'Replace' : 'Add'}
                          </button>
                          {(v.imagePreview || v.imageUrl) && (
                            <img src={v.imagePreview || v.imageUrl} alt="preview" className="inline-block ml-2 h-8 w-8 rounded object-cover border" />
                          )}
                        </td>
                        <td className="p-2">
                          <input 
                            value={v.name || ''} 
                            onChange={(e)=> setVariants((list)=> list.map(x=> x.key===v.key?{...x, name: e.target.value}:x))} 
                            className={`w-full p-1 border rounded ${!v.name?.trim() ? 'border-red-300' : ''}`}
                            placeholder={`Variant ${idx+1}`} 
                          />
                        </td>
                        <td className="p-2">
                          <input 
                            type="number" 
                            value={v.price} 
                            onChange={(e)=> setVariants((list)=> list.map(x=> x.key===v.key?{...x, price: Number(e.target.value)}:x))} 
                            className={`w-24 p-1 border rounded ${!(Number.isFinite(v.price) && v.price > 0) ? 'border-red-300' : ''}`}
                          />
                        </td>
                        <td className="p-2"><input type="number" value={(v as any).specialPrice || 0} onChange={(e)=> setVariants((list)=> list.map((x)=> x.key===v.key?{...x, specialPrice: Number(e.target.value)}:x))} className="w-24 p-1 border rounded" /></td>
                        <td className="p-2">
                          <input 
                            type="number" 
                            value={v.stock} 
                            onChange={(e)=> setVariants((list)=> list.map(x=> x.key===v.key?{...x, stock: Number(e.target.value)}:x))} 
                            className={`w-20 p-1 border rounded ${!(Number.isFinite(v.stock) && v.stock >= 0) ? 'border-red-300' : ''}`}
                          />
                        </td>
                        <td className="p-2">
                          <input 
                            value={v.sku || ''} 
                            onChange={(e)=> setVariants((list)=> list.map(x=> x.key===v.key?{...x, sku: e.target.value}:x))} 
                            className={`w-32 p-1 border rounded ${!v.sku?.trim() ? 'border-red-300' : ''}`}
                          />
                        </td>
                        <td className="p-2"><input type="checkbox" className="accent-teal-600" checked={(v as any).available ?? true} onChange={(e)=> setVariants((list)=> list.map(x=> x.key===v.key?{...x, available: e.target.checked}:x))} /></td>
                        <td className="p-2"><input type="checkbox" className="accent-teal-600" checked={(v as any).isFragile ?? false} onChange={(e)=> setVariants((list)=> list.map(x=> x.key===v.key?{...x, isFragile: e.target.checked}:x))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Warranty & Compliance */}
          <div className="mt-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Warranty & Compliance</h4>
            <label className="flex items-center gap-2 mb-3 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-teal-600 h-4 w-4"
                checked={newItem.insuranceAndEvaluation}
                onChange={(e) => setNewItem(s => ({ ...s, insuranceAndEvaluation: e.target.checked }))}
              />
              <span>Insurance and Evaluation</span>
              <span className="relative group inline-flex">
                <span
                  tabIndex={0}
                  aria-label="What is Insurance and Evaluation?"
                  className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-gray-400 text-gray-500 text-[10px] font-semibold leading-none cursor-help focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  ?
                </span>
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus-within:block bg-gray-900 text-white text-xs rounded-md px-2 py-1 w-64 z-10 shadow-lg">
                  Check if this item requires insurance coverage or a separate evaluation before shipping or use.
                </span>
              </span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Dangerous Goods</label>
                <select
                  value={newItem.dangerousGoods || 'none'}
                  onChange={(e)=> setNewItem(s=> ({...s, dangerousGoods: e.target.value as 'none' | 'dangerous'}))}
                  className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  {complianceOpts.dangerousGoods.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Warranty Type {(!newItem.warrantyType || newItem.warrantyType === '') && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={newItem.warrantyType || ''}
                  onChange={(e)=> setNewItem(s=> ({...s, warrantyType: e.target.value}))}
                  className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="">Select warranty type...</option>
                  {complianceOpts.warrantyTypes.map(o => (
                    <option key={o.value} value={o.label}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Warranty Duration {newItem.warrantyType && newItem.warrantyType !== 'No warranty' && (!newItem.warrantyDuration || newItem.warrantyDuration === '') && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={newItem.warrantyDuration || ''}
                  onChange={(e)=> setNewItem(s=> ({...s, warrantyDuration: e.target.value}))}
                  className="w-full text-sm p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="">Select duration...</option>
                  {complianceOpts.durations.map(o => (
                    <option key={o.value} value={o.label}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end gap-3">
            <button className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800" onClick={() => navigate('/?tab=inventory')} disabled={submitting}>Cancel</button>
            <button className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40" onClick={() => handleCreateItem('draft')} disabled={submitting || !newItem.name.trim()} title="Save this product as a draft">
              {submitting ? 'Saving...' : 'Save as Draft'}
            </button>
            <button className="px-3 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40" onClick={handleCreateClick} disabled={submitting || !validation.isValid}>
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>

      {/* Submitted dialog */}
      {showSubmittedDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSubmittedDialog(false)} />
          <div className="relative z-10 w-[92vw] max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-6">
            <div className="text-center">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-green-100 flex items-center justify-center text-green-600">✓</div>
              <h3 className="text-lg font-semibold text-gray-900">Product submitted</h3>
              <p className="mt-1 text-sm text-gray-600">
                {submittedProductName ? (<><span className="font-medium">{submittedProductName}</span> has been submitted.</>) : 'Your product has been submitted.'}
                {' '}Please wait for the approval of the product.
              </p>
            </div>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
                onClick={() => setShowSubmittedDialog(false)}
              >
                Add another
              </button>
              <button
                className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                onClick={() => { setShowSubmittedDialog(false); navigate('/?tab=inventory'); }}
              >
                Go to Inventory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddProduct;
