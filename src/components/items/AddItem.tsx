/**
 * AddItem - Add new product with variations
 * 
 * Allows sellers to add new products with:
 * - Basic information
 * - Category & classification
 * - Pricing
 * - Product variations
 */

import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { ProductService } from '@/services/product';
import CategoryService from '@/services/category';
import { Package, X, Plus, FolderTree, Boxes, Trash2, ImageIcon, AlertTriangle, Save, Shield } from 'lucide-react';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// Helper: convert weight to grams
const toGrams = (weight: any, unit: string) => {
  let num = parseFloat(weight);
  if (isNaN(num)) return null;
  switch (unit) {
    case 'kg': return num * 1000;
    case 'g': return num;
    case 'lb': return num * 453.59237;
    case 'oz': return num * 28.3495231;
    default: return num;
  }
};

// Helper: convert dimension to cm
const toCm = (val: any, unit: string) => {
  let num = parseFloat(val);
  if (isNaN(num)) return null;
  switch (unit) {
    case 'cm': return num;
    case 'm': return num * 100;
    case 'in': return num * 2.54;
    case 'ft': return num * 30.48;
    default: return num;
  }
};

const makeBlankVariation = () => ({
  name: '',
  SKU: '',
  price: 0,
  imageURL: '',
  imageFile: null as File | null,
  imagePreview: null as string | null,
  weight: '' as number | '',
  weightUnit: 'g',
  dimensions: { length: '' as number | '', width: '' as number | '', height: '' as number | '' },
  dimensionsUnit: 'cm',
  pcsPerBox: '' as number | '',
  isFragile: false,
  isNew: true,
});

// Factory function for initial form state
const getInitialFormState = () => ({
  brand: '',
  brandImageFile: null as File | null,
  brandImageURL: '',
  brandImagePreview: null as string | null,
  name: '',
  description: '',
  categoryID: '',
  subCategoryID: '',
  price: 0,
  specialPrice: '' as number | '',
  lowestPrice: '' as number | '',
  imageURL: '',
  imageFile: null as File | null,
  imagePreview: null as string | null,
  dangerousGoods: 'none' as '' | 'none' | 'battery' | 'flammable' | 'liquid',
  warrantyType: '',
  warrantyDuration: '',
  warrantyPolicy: '',
  allowInquiry: false,
  variations: [makeBlankVariation()] as Array<{
    name: string;
    SKU: string;
    price: number;
    imageURL: string;
    imageFile?: File | null;
    imagePreview?: string | null;
    weight: number | '';
    weightUnit: string;
    dimensions: { length: number | ''; width: number | ''; height: number | '' };
    dimensionsUnit: string;
    pcsPerBox: number | '';
    isFragile?: boolean;
    isNew?: boolean;
  }>,
});

const AddItem: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [categoriesList, setCategoriesList] = useState<Array<{ id: string; name: string }>>([]);
  const [subcategoryOptions, setSubcategoryOptions] = useState<Array<{ id: string; name: string }>>([]);

  const { uid, isSeller, isSubAccount, parentId } = useAuth();
  const { toast } = useToast();
  const effectiveSellerId = isSeller ? (isSubAccount ? (parentId || uid) : uid) : null;

  const productImageInputRef = useRef<HTMLInputElement>(null);
  const brandImageInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [form, setForm] = useState(getInitialFormState());

  const isEquipmentCategory = categoriesList.find(c => c.id === form.categoryID)?.name === 'Equipments';

  // Load categories
  useEffect(() => {
    const unsub = CategoryService.listenCategories((categories) => {
      const list = categories.map(cat => ({ id: cat.id, name: cat.name })).sort((a, b) => a.name.localeCompare(b.name));
      setCategoriesList(list);
    });
    return () => unsub();
  }, []);

  // Load subcategories when category changes
  useEffect(() => {
    if (form.categoryID) {
      const unsub = CategoryService.listenSubcategories(form.categoryID, setSubcategoryOptions);
      return () => unsub();
    } else {
      setSubcategoryOptions([]);
    }
  }, [form.categoryID]);

  const handleSave = async () => {
                    // Require at least one product variation
                    if (form.variations.length === 0) {
                      toast({ title: 'Error', description: 'At least one product variation is required', variant: 'destructive' });
                      return;
                    }
                    // Require warranty duration and policy if dangerous goods is not 'none' or empty
                    if (form.dangerousGoods && form.dangerousGoods !== 'none') {
                      if (!form.warrantyDuration || isNaN(Number(form.warrantyDuration.split(' ')[0])) || Number(form.warrantyDuration.split(' ')[0]) <= 0) {
                        toast({ title: 'Error', description: 'Warranty duration is required for dangerous goods', variant: 'destructive' });
                        return;
                      }
                      if (!form.warrantyPolicy || !form.warrantyPolicy.trim()) {
                        toast({ title: 'Error', description: 'Warranty policy is required for dangerous goods', variant: 'destructive' });
                        return;
                      }
                    }
                // Require variation image if variations exist
                if (form.variations.length > 0) {
                  for (let i = 0; i < form.variations.length; i++) {
                    const variation = form.variations[i];
                    if (!variation.imageFile && !variation.imageURL) {
                      toast({ title: 'Error', description: `Variation ${i + 1} image is required`, variant: 'destructive' });
                      return;
                    }
                    if (!isEquipmentCategory && (!variation.price || isNaN(Number(variation.price)) || Number(variation.price) <= 0)) {
                      toast({ title: 'Error', description: `Variation ${i + 1} price is required`, variant: 'destructive' });
                      return;
                    }
                    if (!variation.weight || isNaN(Number(variation.weight)) || Number(variation.weight) <= 0) {
                      toast({ title: 'Error', description: `Variation ${i + 1} weight is required`, variant: 'destructive' });
                      return;
                    }
                    if (!variation.dimensions.length || isNaN(Number(variation.dimensions.length)) || Number(variation.dimensions.length) <= 0) {
                      toast({ title: 'Error', description: `Variation ${i + 1} length is required`, variant: 'destructive' });
                      return;
                    }
                    if (!variation.dimensions.width || isNaN(Number(variation.dimensions.width)) || Number(variation.dimensions.width) <= 0) {
                      toast({ title: 'Error', description: `Variation ${i + 1} width is required`, variant: 'destructive' });
                      return;
                    }
                    if (!variation.dimensions.height || isNaN(Number(variation.dimensions.height)) || Number(variation.dimensions.height) <= 0) {
                      toast({ title: 'Error', description: `Variation ${i + 1} height is required`, variant: 'destructive' });
                      return;
                    }
                  }
                }

    if (!effectiveSellerId) {
      toast({ title: 'Error', description: 'No seller ID found', variant: 'destructive' });
      return;
    }

    if (!form.brand.trim()) {
      toast({ title: 'Error', description: 'Brand is required', variant: 'destructive' });
      return;
    }

    if (!form.brandImageFile && !form.brandImageURL) {
      toast({ title: 'Error', description: 'Brand image is required', variant: 'destructive' });
      return;
    }

    if (!form.name.trim()) {
      toast({ title: 'Error', description: 'Product name is required', variant: 'destructive' });
      return;
    }


    if (!form.description.trim()) {
      toast({ title: 'Error', description: 'Description is required', variant: 'destructive' });
      return;
    }

    if (!form.imageFile && !form.imageURL) {
      toast({ title: 'Error', description: 'Product image is required', variant: 'destructive' });
      return;
    }


    if (!form.categoryID) {
      toast({ title: 'Error', description: 'Category is required', variant: 'destructive' });
      return;
    }

    if (!form.subCategoryID) {
      toast({ title: 'Error', description: 'Subcategory is required', variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    try {
      // Upload main product image if exists
      let imageURL = form.imageURL;
      if (form.imageFile) {
        const imgRef = storageRef(storage, `products/${effectiveSellerId}/${Date.now()}_${form.imageFile.name}`);
        await uploadBytes(imgRef, form.imageFile);
        imageURL = await getDownloadURL(imgRef);
      }

      // Upload brand image if provided
      let brandImageURL = form.brandImageURL;
      if (form.brandImageFile) {
        const brandImgRef = storageRef(storage, `products/${effectiveSellerId}/brand/${Date.now()}_${form.brandImageFile.name}`);
        await uploadBytes(brandImgRef, form.brandImageFile);
        brandImageURL = await getDownloadURL(brandImgRef);
      }

      // Create product - Always set to pending_qc for admin approval
      const productData = {
        sellerId: effectiveSellerId,
        brand: form.brand,
        brandImage: brandImageURL || null,
        name: form.name,
        description: form.description,
        categoryID: form.categoryID,
        subCategoryID: form.subCategoryID || '',
        imageURL: imageURL,
        status: 'pending_qc' as const, // Always pending QC first
        price: form.price || 0,
        specialPrice: form.specialPrice || null,
        lowestPrice: form.lowestPrice || form.price || null,
        // Map dangerousGoods: battery/flammable/liquid -> 'dangerous', otherwise 'none'
        dangerousGoods: (form.dangerousGoods && form.dangerousGoods !== 'none') ? 'dangerous' as const : 'none' as const,
        warrantyType: form.warrantyType || null,
        warrantyDuration: form.warrantyDuration || null,
        warrantyPolicy: form.warrantyPolicy || null,
        allowInquiry: form.allowInquiry,
      };

      const result = await ProductService.createProduct(productData);
      const productId = result.id;

      // Add variations if any
      if (form.variations.length > 0) {
        const variationsData = await Promise.all(
          form.variations.map(async (variation) => {
            if (!variation.name || !variation.SKU) return null;

            let varImageURL = variation.imageURL;
            if (variation.imageFile) {
              const varImgRef = storageRef(storage, `products/${effectiveSellerId}/variations/${Date.now()}_${variation.imageFile.name}`);
              await uploadBytes(varImgRef, variation.imageFile);
              varImageURL = await getDownloadURL(varImgRef);
            }

            // Convert weight and dimensions to base units
            const weightInGrams = toGrams(variation.weight, variation.weightUnit);
            const lengthInCm = toCm(variation.dimensions.length, variation.dimensionsUnit);
            const widthInCm = toCm(variation.dimensions.width, variation.dimensionsUnit);
            const heightInCm = toCm(variation.dimensions.height, variation.dimensionsUnit);

            return {
              name: variation.name,
              sku: variation.SKU,
              price: variation.price !== undefined ? Number(variation.price) : 0,
              imageURL: varImageURL,
              weight: weightInGrams,
              weightUnit: 'g',
              dimensions: {
                length: lengthInCm,
                width: widthInCm,
                height: heightInCm,
              },
              dimensionsUnit: 'cm',
              pcsPerBox: variation.pcsPerBox ? Number(variation.pcsPerBox) : null,
              isFragile: variation.isFragile || false,
            };
          })
        );

        const validVariations = variationsData.filter(v => v !== null);
        if (validVariations.length > 0) {
          await ProductService.addVariations(productId, validVariations);
        }
      }

      toast({ 
        title: 'Success', 
        description: 'Product submitted for admin approval. It will appear in Pending QC.' 
      });
      
      // Call success callback if provided
      if (onSuccess) {
        setTimeout(() => onSuccess(), 1000);
      }
      
      // Reset form
      setForm(getInitialFormState());
    } catch (error: any) {
      console.error('Error adding product:', error);
      toast({ title: 'Error', description: error.message || 'Failed to add product', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!effectiveSellerId) {
      toast({ title: 'Error', description: 'No seller ID found', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    setShowDraftDialog(false);

    try {
      // Upload main product image if exists
      let imageURL = form.imageURL;
      if (form.imageFile) {
        const imgRef = storageRef(storage, `products/${effectiveSellerId}/${Date.now()}_${form.imageFile.name}`);
        await uploadBytes(imgRef, form.imageFile);
        imageURL = await getDownloadURL(imgRef);
      }

      // Upload brand image if provided
      let brandImageURLDraft = form.brandImageURL;
      if (form.brandImageFile) {
        const brandImgRef = storageRef(storage, `products/${effectiveSellerId}/brand/${Date.now()}_${form.brandImageFile.name}`);
        await uploadBytes(brandImgRef, form.brandImageFile);
        brandImageURLDraft = await getDownloadURL(brandImgRef);
      }

      // Create product as draft - no validation required
      const productData = {
        sellerId: effectiveSellerId,
        brand: form.brand || '',
        brandImage: brandImageURLDraft || null,
        name: form.name || 'Untitled Product',
        description: form.description || '',
        categoryID: form.categoryID || '',
        subCategoryID: form.subCategoryID || '',
        imageURL: imageURL || '',
        status: 'draft' as const,
        price: form.price || 0,
        specialPrice: form.specialPrice || null,
        lowestPrice: form.lowestPrice || form.price || null,
        // Map dangerousGoods: battery/flammable/liquid -> 'dangerous', otherwise 'none'
        dangerousGoods: (form.dangerousGoods && form.dangerousGoods !== 'none') ? 'dangerous' as const : 'none' as const,
        warrantyType: form.warrantyType || null,
        warrantyDuration: form.warrantyDuration || null,
        warrantyPolicy: form.warrantyPolicy || null,
        allowInquiry: form.allowInquiry,
      };

      const result = await ProductService.createProduct(productData);
      const productId = result.id;

      // Add variations if any
      if (form.variations.length > 0) {
        const variationsData = await Promise.all(
          form.variations.map(async (variation) => {
            let varImageURL = variation.imageURL;
            if (variation.imageFile) {
              const varImgRef = storageRef(storage, `products/${effectiveSellerId}/variations/${Date.now()}_${variation.imageFile.name}`);
              await uploadBytes(varImgRef, variation.imageFile);
              varImageURL = await getDownloadURL(varImgRef);
            }

            const weightInGrams = toGrams(variation.weight, variation.weightUnit);
            const lengthInCm = toCm(variation.dimensions.length, variation.dimensionsUnit);
            const widthInCm = toCm(variation.dimensions.width, variation.dimensionsUnit);
            const heightInCm = toCm(variation.dimensions.height, variation.dimensionsUnit);

            return {
              name: variation.name || '',
              sku: variation.SKU || '',
              price: variation.price !== undefined ? Number(variation.price) : 0,
              imageURL: varImageURL,
              weight: weightInGrams,
              weightUnit: 'g',
              dimensions: {
                length: lengthInCm,
                width: widthInCm,
                height: heightInCm,
              },
              dimensionsUnit: 'cm',
              pcsPerBox: variation.pcsPerBox ? Number(variation.pcsPerBox) : null,
              isFragile: variation.isFragile || false,
            };
          })
        );

        const validVariations = variationsData.filter(v => v !== null);
        if (validVariations.length > 0) {
          await ProductService.addVariations(productId, validVariations);
        }
      }

      toast({ 
        title: 'Saved as Draft', 
        description: 'Product saved to drafts. You can complete it later.' 
      });
      
      // Call success callback if provided
      if (onSuccess) {
        setTimeout(() => onSuccess(), 1000);
      }
      
      // Reset form
      setForm(getInitialFormState());
    } catch (error: any) {
      console.error('Error saving draft:', error);
      toast({ title: 'Error', description: error.message || 'Failed to save draft', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">

        <input
          ref={productImageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const preview = URL.createObjectURL(file);
              setForm(prev => ({
                ...prev,
                imageFile: file,
                imagePreview: preview
              }));
            }
          }}
        />

        {/* Body */}
        <div className="space-y-6">
          {/* Basic Information Section */}
          <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Package className="w-5 h-5 text-teal-600" />
                  Basic Information
                </h3>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Brand <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.brand}
                  onChange={(e) => setForm({...form, brand: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="Enter your brand name"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Brand Image <span className="text-red-500">*</span></label>
                <div className="flex items-center gap-4">
                  {(form.brandImagePreview || form.brandImageURL) && (
                    <img
                      src={form.brandImagePreview || form.brandImageURL}
                      alt="Brand"
                      className="w-16 h-16 rounded-lg object-cover border-2 border-gray-200"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => brandImageInputRef.current?.click()}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                  >
                    {form.brandImageURL || form.brandImagePreview ? 'Change Image' : 'Upload Brand Image'}
                  </button>
                  <input
                    ref={brandImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const preview = URL.createObjectURL(file);
                      setForm({...form, brandImageFile: file, brandImagePreview: preview});
                    }}
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Product Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({...form, name: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="Enter product name"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Description <span className="text-red-500">*</span></label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({...form, description: e.target.value})}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="Enter product description"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Thumbnail Image <span className="text-red-500">*</span></label>
                <div className="flex items-center gap-4">
                  {(form.imagePreview || form.imageURL) && (
                    <img
                      src={form.imagePreview || form.imageURL}
                      alt="Product"
                      className="w-24 h-24 rounded-lg object-cover border-2 border-gray-200"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => productImageInputRef.current?.click()}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                  >
                    {form.imageURL ? 'Change Image' : 'Upload Image'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Category & Classification Section */}
          <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-teal-600" />
              Category & Classification
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category <span className="text-red-500">*</span></label>
                <select
                  value={form.categoryID}
                  onChange={(e) => {
                    const selectedCat = categoriesList.find(c => c.id === e.target.value);
                    const isEquip = selectedCat?.name === 'Equipments';
                    setForm({...form, categoryID: e.target.value, subCategoryID: '', allowInquiry: isEquip});
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="">Select category</option>
                  {categoriesList.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Subcategory <span className="text-red-500">*</span></label>
                <select
                  value={form.subCategoryID}
                  onChange={(e) => setForm({...form, subCategoryID: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  disabled={!form.categoryID}
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
                <span className="text-red-500 ml-1">*</span>
                <span className="ml-2 px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                  {form.variations.length}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => {
                  setForm({
                    ...form,
                    variations: [...form.variations, makeBlankVariation()]
                  });
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium flex items-center gap-2 shadow-md"
              >
                <Plus className="w-4 h-4" />
                Add Variation
              </button>
            </div>

            {form.variations.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Boxes className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No variations added yet. Click "Add Variation" to create one.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {form.variations.map((variation, index) => (
                  <div key={index} className="bg-white rounded-xl p-5 border-2 border-gray-200 shadow-sm hover:shadow-md transition">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                          {index + 1}
                        </div>
                        <span className="font-medium text-gray-700">Variation {index + 1}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const updatedVariations = [...form.variations];
                          updatedVariations.splice(index, 1);
                          setForm({ ...form, variations: updatedVariations });
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Variation Image */}
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Variation Image <span className="text-red-500">*</span></label>
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
                                const updatedVariations = [...form.variations];
                                updatedVariations[index] = {
                                  ...variation,
                                  imageFile: file,
                                  imagePreview: preview
                                };
                                setForm({ ...form, variations: updatedVariations });
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
                        <label className="block text-sm font-medium text-gray-700 mb-2">Variation Name <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={variation.name}
                          onChange={(e) => {
                            const updatedVariations = [...form.variations];
                            updatedVariations[index] = { ...variation, name: e.target.value };
                            setForm({ ...form, variations: updatedVariations });
                          }}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="e.g., Small, Medium, Large"
                        />
                      </div>

                      {/* SKU */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">SKU <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={variation.SKU}
                          onChange={(e) => {
                            const updatedVariations = [...form.variations];
                            updatedVariations[index] = { ...variation, SKU: e.target.value };
                            setForm({ ...form, variations: updatedVariations });
                          }}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="e.g., PROD-VAR-001"
                        />
                      </div>

                      {/* Price — hidden for Equipment category */}
                      {!isEquipmentCategory && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Price (₱) <span className="text-red-500">*</span>
                            <span className="ml-2 px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs font-semibold align-middle">include VAT</span>
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9.]*"
                            value={variation.price}
                            onChange={(e) => {
                              let val = e.target.value.replace(/[^0-9.]/g, '');
                              const parts = val.split('.');
                              if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = { ...variation, price: val ? parseFloat(val) : 0 };
                              setForm({ ...form, variations: updatedVariations });
                            }}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="0.00"
                          />
                        </div>
                      )}

                      {/* Pcs per Box */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Pcs per Box <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={variation.pcsPerBox}
                          onChange={(e) => {
                            let val = e.target.value.replace(/[^0-9]/g, '');
                            const updatedVariations = [...form.variations];
                            updatedVariations[index] = { ...variation, pcsPerBox: val ? parseInt(val) : '' };
                            setForm({ ...form, variations: updatedVariations });
                          }}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="e.g., 12"
                        />
                      </div>

                      {/* Weight */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Weight <span className="text-red-500">*</span></label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9.]*"
                            value={variation.weight}
                            onChange={(e) => {
                              let val = e.target.value.replace(/[^0-9.]/g, '');
                              const parts = val.split('.');
                              if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = { ...variation, weight: val as number | '' };
                              setForm({ ...form, variations: updatedVariations });
                            }}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="0.00"
                          />
                          <select
                            value={variation.weightUnit}
                            onChange={(e) => {
                              const prevUnit = variation.weightUnit;
                              const newUnit = e.target.value;
                              let weight = parseFloat(variation.weight as any);
                              if (!isNaN(weight)) {
                                // Convert current value to grams first
                                let weightInGrams = weight;
                                switch (prevUnit) {
                                  case 'kg': weightInGrams = weight * 1000; break;
                                  case 'g': weightInGrams = weight; break;
                                  case 'lb': weightInGrams = weight * 453.59237; break;
                                  case 'oz': weightInGrams = weight * 28.3495231; break;
                                }
                                // Convert grams to new unit
                                switch (newUnit) {
                                  case 'kg': weight = (weightInGrams / 1000); break;
                                  case 'g': weight = weightInGrams; break;
                                  case 'lb': weight = (weightInGrams / 453.59237); break;
                                  case 'oz': weight = (weightInGrams / 28.3495231); break;
                                }
                                // Round to 3 decimals for display
                                weight = Math.round(weight * 1000) / 1000;
                              } else {
                                weight = '' as any;
                              }
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = { ...variation, weight: weight as number | '', weightUnit: newUnit };
                              setForm({ ...form, variations: updatedVariations });
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
                        <label className="block text-sm font-medium text-gray-700 mb-2">Dimensions (L × W × H) <span className="text-red-500">*</span></label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9.]*"
                            value={variation.dimensions.length}
                            onChange={(e) => {
                              let val = e.target.value.replace(/[^0-9.]/g, '');
                              const parts = val.split('.');
                              if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = {
                                ...variation,
                                dimensions: { ...variation.dimensions, length: val as number | '' }
                              };
                              setForm({ ...form, variations: updatedVariations });
                            }}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Length"
                          />
                          <span className="text-gray-400 flex items-center">×</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9.]*"
                            value={variation.dimensions.width}
                            onChange={(e) => {
                              let val = e.target.value.replace(/[^0-9.]/g, '');
                              const parts = val.split('.');
                              if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = {
                                ...variation,
                                dimensions: { ...variation.dimensions, width: val as number | '' }
                              };
                              setForm({ ...form, variations: updatedVariations });
                            }}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Width"
                          />
                          <span className="text-gray-400 flex items-center">×</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9.]*"
                            value={variation.dimensions.height}
                            onChange={(e) => {
                              let val = e.target.value.replace(/[^0-9.]/g, '');
                              const parts = val.split('.');
                              if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = {
                                ...variation,
                                dimensions: { ...variation.dimensions, height: val as number | '' }
                              };
                              setForm({ ...form, variations: updatedVariations });
                            }}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Height"
                          />
                          <select
                            value={variation.dimensionsUnit}
                            onChange={(e) => {
                              const prevUnit = variation.dimensionsUnit;
                              const newUnit = e.target.value;
                              const convert = (val: any) => {
                                let num = parseFloat(val);
                                if (isNaN(num)) return '';
                                // Convert to cm first
                                let cm = num;
                                switch (prevUnit) {
                                  case 'cm': cm = num; break;
                                  case 'm': cm = num * 100; break;
                                  case 'in': cm = num * 2.54; break;
                                  case 'ft': cm = num * 30.48; break;
                                }
                                // Convert cm to new unit
                                switch (newUnit) {
                                  case 'cm': return Math.round(cm * 1000) / 1000;
                                  case 'm': return Math.round((cm / 100) * 1000) / 1000;
                                  case 'in': return Math.round((cm / 2.54) * 1000) / 1000;
                                  case 'ft': return Math.round((cm / 30.48) * 1000) / 1000;
                                }
                                return '';
                              };
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = {
                                ...variation,
                                dimensionsUnit: newUnit,
                                dimensions: {
                                  length: convert(variation.dimensions.length) as number | '',
                                  width: convert(variation.dimensions.width) as number | '',
                                  height: convert(variation.dimensions.height) as number | '',
                                }
                              };
                              setForm({ ...form, variations: updatedVariations });
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
                              const updatedVariations = [...form.variations];
                              updatedVariations[index] = { ...variation, isFragile: e.target.checked };
                              setForm({ ...form, variations: updatedVariations });
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
                ))}
                {form.variations.length >= 2 && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setForm({
                          ...form,
                          variations: [...form.variations, makeBlankVariation()]
                        });
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium flex items-center gap-2 shadow-md"
                    >
                      <Plus className="w-4 h-4" />
                      Add Variation
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Warranty & Compliance Section */}
          <div className="bg-amber-50 rounded-xl p-5 border-2 border-amber-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-amber-600" />
              Warranty & Compliance
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Dangerous Goods */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Dangerous Goods</label>
                <select
                  value={form.dangerousGoods}
                  onChange={(e) => setForm({...form, dangerousGoods: e.target.value as any})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                >
                  <option value="">Select dangerous goods type</option>
                  <option value="none">None</option>
                  <option value="battery">Contains Battery</option>
                  <option value="flammable">Flammable</option>
                  <option value="liquid">Liquid</option>
                </select>
              </div>

              {/* Warranty Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Warranty Type</label>
                <select
                  value={form.warrantyType}
                  onChange={(e) => setForm({...form, warrantyType: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                >
                  <option value="">Select warranty type</option>
                  <option value="local_manufacturer">Local Manufacturer Warranty</option>
                  <option value="international_manufacturer">International Manufacturer Warranty</option>
                  <option value="local_supplier">Local Supplier Warranty</option>
                  <option value="local_supplier_refund">Local Supplier Refund Warranty</option>
                  <option value="no_warranty">No Warranty</option>
                  <option value="international_seller">International Seller Warranty</option>
                </select>
              </div>

              {/* Warranty Duration */}
                 <div className="md:col-span-2">
                   <label className="block text-sm font-medium text-gray-700 mb-2">Warranty Duration <span className="text-red-500">*</span></label>
                   <div className="flex gap-2">
                     <input
                       type="text"
                       inputMode="decimal"
                       pattern="[0-9.]*"
                       value={form.warrantyDuration.split(' ')[0] || ''}
                       onChange={(e) => {
                         let value = e.target.value.replace(/[^0-9.]/g, '');
                         const parts = value.split('.');
                         if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
                         const unit = form.warrantyDuration.split(' ')[1] || 'month';
                         setForm({...form, warrantyDuration: value ? `${value} ${unit}` : ''});
                       }}
                       className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                       placeholder="Enter duration"
                     />
                     <select
                       value={form.warrantyDuration.split(' ')[1] || 'month'}
                       onChange={(e) => {
                         let value = form.warrantyDuration.split(' ')[0] || '';
                         const prevUnit = form.warrantyDuration.split(' ')[1] || 'month';
                         const newUnit = e.target.value;
                         let num = parseFloat(value);
                         if (!isNaN(num) && value !== '') {
                           // Convert previous value to months first
                           let months = num;
                           switch (prevUnit) {
                             case 'week': months = num / 4.34524; break;
                             case 'month': months = num; break;
                             case 'year': months = num * 12; break;
                           }
                           // Convert months to new unit
                           switch (newUnit) {
                             case 'week': num = Math.round(months * 4.34524 * 100) / 100; break;
                             case 'month': num = Math.round(months * 100) / 100; break;
                             case 'year': num = Math.round((months / 12) * 100) / 100; break;
                           }
                           value = num.toString();
                         }
                         setForm({...form, warrantyDuration: value ? `${value} ${newUnit}` : ''});
                       }}
                       className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                     >
                       <option value="week">Week(s)</option>
                       <option value="month">Month(s)</option>
                       <option value="year">Year(s)</option>
                     </select>
                   </div>

                   {/* Warranty Policy Field */}
                   <label className="block text-sm font-medium text-gray-700 mb-2 mt-4">Warranty Policy <span className="text-red-500">*</span></label>
                   <textarea
                     value={form.warrantyPolicy}
                     onChange={(e) => setForm({...form, warrantyPolicy: e.target.value})}
                     rows={3}
                     className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                     placeholder="Enter warranty policy details"
                   />
                 </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white px-6 py-4 rounded-xl border border-gray-200 flex items-center justify-end gap-3 sticky bottom-0">
          <button
            onClick={() => setForm(getInitialFormState())}
            disabled={submitting}
            className="px-5 py-2.5 border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition disabled:opacity-50"
          >
            Reset
          </button>
          <button
            onClick={() => setShowDraftDialog(true)}
            disabled={submitting}
            className="px-5 py-2.5 border-2 border-orange-400 bg-orange-50 text-orange-700 font-medium rounded-lg hover:bg-orange-100 transition disabled:opacity-50 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save as Draft
          </button>
          <button
            onClick={handleSave}
            disabled={submitting || !form.name || !form.categoryID}
            className="px-5 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting ? (
              <span>Saving...</span>
            ) : (
              'Save Item'
            )}
          </button>
        </div>

        {/* Draft Confirmation Dialog */}
        {showDraftDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border-2 border-orange-400">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-orange-100 rounded-full">
                  <AlertTriangle className="w-6 h-6 text-orange-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">Save as Draft</h3>
                  <p className="text-sm text-gray-600">
                    This product listing will be saved as a draft. You can complete or edit it later from the Draft tab.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowDraftDialog(false)}
                  disabled={submitting}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDraft}
                  disabled={submitting}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? 'Saving...' : 'Save as Draft'}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default AddItem;
