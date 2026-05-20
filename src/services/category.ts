import { db, storage } from '@/lib/firebase';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

export type Category = { id: string; name: string; imageURL?: string };
export type Subcategory = { id: string; name: string; imageURL?: string; isEquipment?: boolean };

const normalizeName = (raw: any, fallBackId: string) => {
  return String(
    raw?.name || raw?.categoryName || raw?.CategoryName || raw?.category || raw?.Category || raw?.title || raw?.displayName || raw?.label || fallBackId
  ).trim();
};

// Image upload validation constants
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

// Helper function to validate and sanitize image uploads
const validateAndSanitizeImage = (file: File): string => {
  // Validate MIME type
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Invalid file type. Only PNG, JPEG, and WebP images are allowed. Got: ${file.type}`);
  }
  
  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const maxMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
    throw new Error(`File size (${sizeMB}MB) exceeds maximum allowed size of ${maxMB}MB`);
  }
  
  // Sanitize filename: extract extension and create safe name
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'jpg';
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  
  return `${timestamp}_${randomStr}.${safeExt}`;
};

export const CategoryService = {
  listenCategories: (cb: (rows: Category[]) => void, onError?: (e: any) => void) => {
    const col = collection(db, 'Category');
    return onSnapshot(col, (snap) => {
      const rows = snap.docs
        .map(d => {
          const data = d.data();
          return { 
            id: d.id, 
            name: normalizeName(data, d.id),
            imageURL: data?.imageURL || data?.image || undefined
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      cb(rows);
    }, onError);
  },

  listenSubcategories: (categoryId: string, cb: (rows: Subcategory[]) => void, onError?: (e: any) => void) => {
    const col = collection(db, 'Category', categoryId, 'subCategory');
    return onSnapshot(col, (snap) => {
      const rows = snap.docs
        .map(d => {
          const data: any = d.data();
          const name = String(
            data?.subCategoryName || data?.subcategoryName || data?.name || data?.title || data?.displayName || data?.label || d.id
          ).trim();
          return {
            id: d.id,
            name,
            imageURL: data?.imageURL || data?.image || undefined,
            isEquipment: !!data?.isEquipment,
          } as Subcategory;
        })
        .filter(r => !!r.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      cb(rows);
    }, onError);
  },

  uploadCategoryImage: async (file: File, categoryId: string): Promise<string> => {
    // Validate and get sanitized filename
    const safeFilename = validateAndSanitizeImage(file);
    
    const storageRef = ref(storage, `categories/${categoryId}/${safeFilename}`);
    const snapshot = await uploadBytes(storageRef, file);
    return getDownloadURL(snapshot.ref);
  },

  uploadSubcategoryImage: async (file: File, categoryId: string, subId: string): Promise<string> => {
    // Validate and get sanitized filename
    const safeFilename = validateAndSanitizeImage(file);
    
    const storageRef = ref(storage, `categories/${categoryId}/subcategories/${subId}/${safeFilename}`);
    const snapshot = await uploadBytes(storageRef, file);
    return getDownloadURL(snapshot.ref);
  },

  addCategory: async (name: string, imageURL?: string) => {
    const v = name.trim();
    if (!v) throw new Error('Name is required');
    const data: any = { name: v, categoryName: v, createdAt: serverTimestamp() };
    if (imageURL) data.imageURL = imageURL;
    await addDoc(collection(db, 'Category'), data);
  },

  updateCategory: async (id: string, name: string, imageURL?: string) => {
    const v = name.trim();
    if (!v) throw new Error('Name is required');
    const data: any = { name: v, categoryName: v, updatedAt: serverTimestamp() };
    if (imageURL !== undefined) data.imageURL = imageURL;
    await updateDoc(doc(db, 'Category', id), data);
  },

  deleteCategory: async (id: string) => {
    const subs = await getDocs(collection(db, 'Category', id, 'subCategory'));
    await Promise.allSettled(subs.docs.map((d) => deleteDoc(doc(db, 'Category', id, 'subCategory', d.id))));
    await deleteDoc(doc(db, 'Category', id));
  },

  addSubcategory: async (categoryId: string, name: string, imageURL?: string, isEquipment?: boolean) => {
    const v = name.trim();
    if (!v) throw new Error('Name is required');
    const data: any = { name: v, subCategoryName: v, isEquipment: !!isEquipment, createdAt: serverTimestamp() };
    if (imageURL) data.imageURL = imageURL;
    await addDoc(collection(db, 'Category', categoryId, 'subCategory'), data);
  },

  updateSubcategory: async (categoryId: string, subId: string, name: string, imageURL?: string, isEquipment?: boolean) => {
    const v = name.trim();
    if (!v) throw new Error('Name is required');
    const data: any = { name: v, subCategoryName: v, updatedAt: serverTimestamp() };
    if (imageURL !== undefined) data.imageURL = imageURL;
    if (isEquipment !== undefined) data.isEquipment = !!isEquipment;
    await updateDoc(doc(db, 'Category', categoryId, 'subCategory', subId), data);
  },

  deleteSubcategory: async (categoryId: string, subId: string) => {
    await deleteDoc(doc(db, 'Category', categoryId, 'subCategory', subId));
  },
};

export default CategoryService;
