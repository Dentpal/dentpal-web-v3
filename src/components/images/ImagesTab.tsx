import { useState, useRef, useEffect } from "react";
import { 
  Image as ImageIcon, 
  Upload, 
  Search, 
  Filter, 
  Download, 
  Edit3, 
  Trash2, 
  Eye, 
  Plus,
  X,
  FileImage,
  Folder,
  Grid,
  List,
  MoreVertical,
  Copy,
  Share2,
  Star,
  GripVertical
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
// Storage integration for BannerImages uploads
import { storage, database } from "@/lib/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { ref as dbRef, push, set, onValue, remove, update } from "firebase/database";

// Helper: load image and compress to WebP/JPEG using Canvas
const loadImageFromFile = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), type, quality);
  });
};

const replaceExt = (name: string, newExt: string) => name.replace(/\.[^/.]+$/, '') + '.' + newExt;

async function compressImage(
  file: File,
  opts: { maxWidth?: number; maxHeight?: number; quality?: number; thresholdKB?: number; targetSizeKB?: number } = {}
): Promise<{ blob: Blob; width: number; height: number; mime: string; ext: 'webp' | 'jpeg'; name: string }> {
  const { maxWidth = 1200, maxHeight = 1200, quality = 0.8, thresholdKB = 200, targetSizeKB = 500 } = opts;

  // Skip compression for GIFs
  if (file.type.includes('gif')) {
    return { blob: file, width: 0, height: 0, mime: file.type || 'image/jpeg', ext: 'jpeg', name: file.name };
  }

  const img = await loadImageFromFile(file);
  // Compute target size preserving aspect ratio
  let { width, height } = img;
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  const targetW = Math.max(1, Math.round(width * ratio));
  const targetH = Math.max(1, Math.round(height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  let ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Prefer WebP for better compression, fallback to JPEG
  let mime = 'image/webp';
  let ext: 'webp' | 'jpeg' = 'webp';
  let q = quality;
  let blob = await canvasToBlob(canvas, mime, q).catch(async () => {
    mime = 'image/jpeg';
    ext = 'jpeg';
    return canvasToBlob(canvas, mime, q);
  });

  // Iteratively reduce quality until target size is reached
  const targetSize = targetSizeKB * 1024;
  let attempts = 0;
  const maxAttempts = 8;
  
  while (blob.size > targetSize && q > 0.1 && attempts < maxAttempts) {
    q = Math.max(0.1, q - 0.1);
    blob = await canvasToBlob(canvas, mime, q);
    attempts++;
  }

  // If still too large, reduce dimensions further
  if (blob.size > targetSize) {
    const minW = 600;
    const minH = 400;
    let scale = 0.85;
    while (blob.size > targetSize && (canvas.width > minW || canvas.height > minH)) {
      canvas.width = Math.max(minW, Math.round(canvas.width * scale));
      canvas.height = Math.max(minH, Math.round(canvas.height * scale));
      ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D not available');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      blob = await canvasToBlob(canvas, mime, q);
      // Small nudge on quality as we scale down
      q = Math.max(0.2, q - 0.05);
    }
  }

  return { blob, width: canvas.width, height: canvas.height, mime, ext, name: replaceExt(file.name, ext) };
}

interface ImageAsset {
  id: string;
  name: string;
  category: 'login-popup' | 'banners' | 'cart-popup' | 'home-popup' | 'general';
  type: 'image' | 'video' | 'gif';
  size: number;
  dimensions: { width: number; height: number };
  format: string;
  url: string;
  thumbnail: string;
  uploadDate: string;
  lastModified: string;
  uploadedBy: string;
  tags: string[];
  isActive: boolean;
  usageCount: number;
  path?: string; // storage path for delete/management
  duration?: { startTime: string; endTime: string };
  order?: number;
  imageURL?: string; // original uploaded image URL (separate from target click URL)
}

interface ImagesTabProps {
  loading?: boolean;
  error?: string | null;
  setError?: (error: string | null) => void;
  onTabChange?: (tab: string) => void;
}

const ImagesTab = ({ loading = false, error, setError, onTabChange }: ImagesTabProps) => {
  const [images, setImages] = useState<ImageAsset[]>([]); // start empty, fetch from storage
  // NEW: loading & dimension tracking state
  const [bannerLoading, setBannerLoading] = useState<boolean>(false);
  const [dimensionProgress, setDimensionProgress] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  const [activeCategory, setActiveCategory] = useState<string>("banners");
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showActiveModal, setShowActiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [activeRange, setActiveRange] = useState<{ start: Date | null; end: Date | null }>({ start: new Date(), end: new Date(Date.now() + 7*86400000) });
  const [activeCalendarMonth, setActiveCalendarMonth] = useState<Date>(new Date());
  const [dragActive, setDragActive] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload states
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadCategory, setUploadCategory] = useState<string>("general");
  const [uploadTags, setUploadTags] = useState<string>("");
  const [bannerName, setBannerName] = useState<string>("");
  const [bannerURL, setBannerURL] = useState<string>("");

  // Edit modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editURL, setEditURL] = useState<string>("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // Only show Banners category
  const categories = [
    { id: "banners", name: "Banners", count: images.length },
  ];

  const filteredImages = images.filter(image => {
    const matchesCategory = image.category === "banners"; 
    const matchesSearch = image.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         image.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'login-popup': return '🚪';
      case 'banners': return '🎯';
      case 'cart-popup': return '🛒';
      case 'home-popup': return '🏠';
      default: return '📁';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'login-popup': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'banners': return 'bg-green-100 text-green-800 border-green-200';
      case 'cart-popup': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'home-popup': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Ignore during card reorder drag (card drag has text/plain, no Files)
    if (e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes('Files')) return;
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    setUploadFiles(imageFiles);
    setShowUploadModal(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadFiles(files.filter(f => f.type.startsWith('image/')));
   
  };

  
  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const { width, height } = img as HTMLImageElement;
        URL.revokeObjectURL(url);
        resolve({ width, height });
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  };

  const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9_.-]/g, '_');

  // Load all banner images from Firebase Realtime Database
  const loadBanners = () => {
    setBannerLoading(true);
    const bannersRef = dbRef(database, 'Banner');
    
    onValue(bannersRef, (snapshot) => {
      try {
        const data = snapshot.val();
        if (!data) {
          setImages([]);
          setBannerLoading(false);
          return;
        }

        const bannerArray: ImageAsset[] = Object.entries(data).map(([key, value]: [string, any], idx) => {
          return {
            id: key,
            name: value.name || 'Untitled',
            category: 'banners' as const,
            type: value.type || 'image' as const,
            size: value.size || 0,
            dimensions: value.dimensions || { width: 0, height: 0 },
            format: value.format || 'WEBP',
            url: value.url || value.imageURL || '',
            thumbnail: value.thumbnail || value.url || value.imageURL || '',
            uploadDate: value.uploadDate || value.timestamp || new Date().toISOString(),
            lastModified: value.lastModified || value.timestamp || new Date().toISOString(),
            uploadedBy: 'admin',
            tags: [],
            isActive: value.isActive !== undefined ? value.isActive : true,
            usageCount: value.usageCount || 0,
            path: value.storagePath || value.path || '',
            duration: value.duration || undefined,
            order: value.order !== undefined ? value.order : idx,
            imageURL: value.imageURL || value.url || '',
          };
        });

        // Sort by order
        bannerArray.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        // Backfill order into Firebase for any banner missing the field
        const missingOrder = bannerArray.filter(b => {
          const raw = (data as any)[b.id];
          return raw?.order === undefined;
        });
        if (missingOrder.length > 0) {
          missingOrder.forEach(b => {
            const bannerRef = dbRef(database, `Banner/${b.id}`);
            update(bannerRef, { order: b.order }).catch(() => {});
          });
        }

        // Auto-expire: set isActive=false for banners whose end date has passed
        const now = new Date();
        const expiredIds: string[] = [];
        bannerArray.forEach(b => {
          if (b.isActive && b.duration?.endTime && new Date(b.duration.endTime) < now) {
            expiredIds.push(b.id);
            const expiredRef = dbRef(database, `Banner/${b.id}`);
            update(expiredRef, { isActive: false, lastModified: now.toISOString() }).catch(() => {});
          }
        });

        const finalArray = expiredIds.length > 0
          ? bannerArray.map(b => expiredIds.includes(b.id) ? { ...b, isActive: false } : b)
          : bannerArray;

        setImages(finalArray);
        setBannerLoading(false);
      } catch (err) {
        console.error('Failed to load banner images', err);
        setError?.('Failed to fetch banner images');
        setBannerLoading(false);
      }
    });
  };

  // Fetch on mount
  useEffect(() => { loadBanners(); }, []);

  // Periodically auto-expire banners whose end time has passed
  useEffect(() => {
    const interval = setInterval(() => {
      setImages(prev => {
        const now = new Date();
        const expiredIds: string[] = [];
        prev.forEach(b => {
          if (b.isActive && b.duration?.endTime && new Date(b.duration.endTime) < now) {
            expiredIds.push(b.id);
            const expiredRef = dbRef(database, `Banner/${b.id}`);
            update(expiredRef, { isActive: false, lastModified: now.toISOString() }).catch(() => {});
          }
        });
        if (expiredIds.length === 0) return prev;
        return prev.map(b => expiredIds.includes(b.id) ? { ...b, isActive: false } : b);
      });
    }, 60000); // Check every 60 seconds
    return () => clearInterval(interval);
  }, []);

  const handleUpload = async () => {
    // Prevent multiple uploads
    if (bannerLoading) return;
    
    if (uploadFiles.length === 0) return;
    if (!bannerName.trim()) {
      setError?.("Please enter a banner name");
      return;
    }

    setBannerLoading(true);
    setError?.(null);
    try {
      for (const file of uploadFiles) {
        console.log('Original file size:', file.size, 'bytes');
        
        // Compress image before upload with aggressive settings for banners
        let processed = await compressImage(file, {
          maxWidth: 1280,
          maxHeight: 720,
          quality: 0.6,
          thresholdKB: 0, 
          targetSizeKB: 200 
        });

        console.log('Compressed size:', processed.blob.size, 'bytes');
        console.log('Compression ratio:', ((1 - processed.blob.size / file.size) * 100).toFixed(1) + '%');
        console.log('Final size:', (processed.blob.size / 1024).toFixed(1) + ' KB');

        let width = 0, height = 0;
        if (processed.width && processed.height) {
          width = processed.width; height = processed.height;
        } else {
          try { const dims = await getImageDimensions(file); width = dims.width; height = dims.height; } catch {}
        }

        const clean = safeFileName(processed.name);
        const path = `BannerImages/${Date.now()}_${clean}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, processed.blob, { contentType: processed.mime });
        const url = await getDownloadURL(ref);

        const format = processed.ext.toUpperCase();

        // Save to Realtime Database
        const bannersRef = dbRef(database, 'Banner');
        const newBannerRef = push(bannersRef);
        
        const bannerData = {
          name: bannerName,
          url: bannerURL || url,
          imageURL: url,
          storagePath: path,
          type: 'image',
          format: format,
          size: processed.blob.size,
          dimensions: { width, height },
          thumbnail: url,
          timestamp: new Date().toISOString(),
          uploadDate: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          isActive: true,
          clicks: 0,
          impressions: 0,
          usageCount: 0,
          priority: 1,
          targetScreen: 'home',
          order: images.length,
        };

        await set(newBannerRef, bannerData);
      }

      setShowUploadModal(false);
      setUploadFiles([]);
      setUploadTags("");
      setBannerName("");
      setBannerURL("");
      loadBanners(); // Reload banners to show the new upload
    } catch (err) {
      console.error(err);
      setError?.("Failed to upload images. Please try again.");
    } finally {
      setBannerLoading(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    setDeleteTargetId(imageId);
    setShowDeleteModal(true);
  };

  const handleEditImage = (imageId: string) => {
    const img = images.find(i => i.id === imageId);
    if (!img) return;
    setEditTargetId(imageId);
    setEditName(img.name || "");
    // Show target URL only if it differs from the underlying image URL
    setEditURL(img.url && img.imageURL && img.url !== img.imageURL ? img.url : "");
    setEditFile(null);
    setShowEditModal(true);
  };

  const confirmEditImage = async () => {
    if (editLoading || !editTargetId) return;
    const current = images.find(i => i.id === editTargetId);
    if (!current) return;
    if (!editName.trim()) {
      setError?.("Please enter a banner name");
      return;
    }

    setEditLoading(true);
    setError?.(null);
    try {
      const updates: Record<string, any> = {
        name: editName.trim(),
        lastModified: new Date().toISOString(),
      };

      // If a replacement file was selected, re-upload it and refresh image fields
      let nextImageURL = current.imageURL || current.url;
      if (editFile) {
        const processed = await compressImage(editFile, {
          maxWidth: 1280,
          maxHeight: 720,
          quality: 0.6,
          thresholdKB: 0,
          targetSizeKB: 200,
        });

        let width = 0, height = 0;
        if (processed.width && processed.height) {
          width = processed.width; height = processed.height;
        } else {
          try { const dims = await getImageDimensions(editFile); width = dims.width; height = dims.height; } catch {}
        }

        const clean = safeFileName(processed.name);
        const path = `BannerImages/${Date.now()}_${clean}`;
        const sref = storageRef(storage, path);
        await uploadBytes(sref, processed.blob, { contentType: processed.mime });
        nextImageURL = await getDownloadURL(sref);

        // Best-effort cleanup of the previous storage file
        if (current.path) {
          try { await deleteObject(storageRef(storage, current.path)); } catch {}
        }

        updates.imageURL = nextImageURL;
        updates.thumbnail = nextImageURL;
        updates.storagePath = path;
        updates.format = processed.ext.toUpperCase();
        updates.size = processed.blob.size;
        updates.dimensions = { width, height };
      }

      // Target URL mirrors upload behaviour: fall back to the image URL when empty
      const targetURL = editURL.trim();
      updates.url = targetURL || nextImageURL;

      const bannerRef = dbRef(database, `Banner/${editTargetId}`);
      await update(bannerRef, updates);

      setShowEditModal(false);
      setEditTargetId(null);
      setEditName("");
      setEditURL("");
      setEditFile(null);
    } catch (e) {
      console.error(e);
      setError?.("Failed to update banner. Please try again.");
    } finally {
      setEditLoading(false);
    }
  };

  const confirmDeleteImage = async () => {
    if (!deleteTargetId) return;
    const img = images.find(i => i.id === deleteTargetId);
    if (!img) return;
    
    try {
      if (img.path) {
        await deleteObject(storageRef(storage, img.path));
      }
      const bannerRef = dbRef(database, `Banner/${deleteTargetId}`);
      await remove(bannerRef);
      setSelectedImages(prev => prev.filter(id => id !== deleteTargetId));
      setShowDeleteModal(false);
      setDeleteTargetId(null);
    } catch (e) {
      setError?.('Failed to delete image');
    }
  };

  const toggleImageStatus = async (imageId: string) => {
    const target = images.find(i => i.id === imageId);
    if (!target) return;
    if (!target.isActive) {
      setActiveTargetId(imageId);
      setActiveRange({ start: new Date(), end: new Date(Date.now() + 7*86400000) });
      setActiveCalendarMonth(new Date());
      setShowActiveModal(true);
      return;
    }

    try {
      const bannerRef = dbRef(database, `Banner/${imageId}`);
      await update(bannerRef, {
        isActive: false,
        duration: null,
        lastModified: new Date().toISOString()
      });
    } catch (e) {
      setError?.('Failed to update banner status');
    }

    setImages(prev => prev.map(img => (
      img.id === imageId ? { ...img, isActive: false, duration: undefined } : img
    )));
  };

  // Helper functions for custom date picker
  const toISO = (d: Date | null) => {
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const daysInMonth = (month: Date) => new Date(month.getFullYear(), month.getMonth()+1, 0).getDate();
  const firstWeekday = (month: Date) => new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  
  const isInActiveRange = (day: Date) => {
    const { start, end } = activeRange;
    if (!start) return false;
    if (start && !end) return day.getTime() === start.getTime();
    if (start && end) return day >= start && day <= end;
    return false;
  };

  const handleActiveDayClick = (day: Date) => {
    setActiveRange(prev => {
      if (!prev.start || (prev.start && prev.end)) return { start: day, end: null };
      if (day < prev.start) return { start: day, end: prev.start };
      return { start: prev.start, end: day };
    });
  };

  const confirmActivate = async () => {
    if (!activeTargetId) return;
    const start = activeRange.start; 
    const end = activeRange.end || activeRange.start;
    if (!start || !end) {
      setError?.('Please select a start and end date');
      return;
    }
    const now = new Date();
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    if (endDate < startDate) {
      setError?.('End date must be after start date');
      return;
    }
    if (endDate < now) {
      setError?.('End date must be in the future');
      return;
    }
    const startTime = startDate.toISOString();
    const endTime = endDate.toISOString();

    try {
      const bannerRef = dbRef(database, `Banner/${activeTargetId}`);
      await update(bannerRef, {
        isActive: true,
        duration: { startTime, endTime },
        lastModified: new Date().toISOString()
      });
      setImages(prev => prev.map(img => (
        img.id === activeTargetId ? { ...img, isActive: true, duration: { startTime, endTime } } : img
      )));
      setShowActiveModal(false);
      setActiveTargetId(null);
      setActiveRange({ start: null, end: null });
    } catch (e) {
      setError?.('Failed to set active duration');
    }
  };

  const activeBanner = images.find(i => i.isActive);

  // Selection helpers
  const toggleImageSelection = (imageId: string) => {
    setSelectedImages(prev =>
      prev.includes(imageId)
        ? prev.filter(id => id !== imageId)
        : [...prev, imageId]
    );
  };

  // --- Drag-to-reorder handlers ---
  const handleCardDragStart = (e: React.DragEvent, imageId: string) => {
    e.stopPropagation();
    setDraggingId(imageId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', imageId);
  };

  const handleCardDragOver = (e: React.DragEvent, imageId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (imageId !== draggingId) setDragOverId(imageId);
  };

  const handleCardDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    setImages(prev => {
      const fromIndex = prev.findIndex(i => i.id === draggingId);
      const toIndex = prev.findIndex(i => i.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const reordered = [...prev];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      const withOrder = reordered.map((img, idx) => ({ ...img, order: idx }));
      // Persist new order to Firebase
      Promise.all(withOrder.map(img => {
        const bannerRef = dbRef(database, `Banner/${img.id}`);
        return update(bannerRef, { order: img.order });
      })).catch(() => {});
      return withOrder;
    });
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleCardDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const selectAllImages = () => {
    if (selectedImages.length === filteredImages.length) {
      setSelectedImages([]);
    } else {
      setSelectedImages(filteredImages.map(img => img.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedImages.length === 0) return;
    setShowBulkDeleteModal(true);
  };

  const confirmBulkDelete = async () => {
    if (selectedImages.length === 0) return;
    
    try {
      await Promise.all(
        selectedImages.map(async id => {
          const img = images.find(i => i.id === id);
          if (img?.path) {
            await deleteObject(storageRef(storage, img.path)).catch(() => {});
          }
          const bannerRef = dbRef(database, `Banner/${id}`);
          await remove(bannerRef).catch(() => {});
        })
      );
      setSelectedImages([]);
      setShowBulkDeleteModal(false);
    } catch (e) {
      setError?.('Failed to delete some images');
    }
  };

  const handleClearAll = async () => {
    if (images.length === 0) return;
    if (window.confirm("Are you sure you want to clear all images? This action cannot be undone.")) {
      await Promise.all(
        images.map(async img => {
          if (img.path) {
            await deleteObject(storageRef(storage, img.path)).catch(() => {});
          }
          const bannerRef = dbRef(database, `Banner/${img.id}`);
          await remove(bannerRef).catch(() => {});
        })
      );
      setImages([]);
      setSelectedImages([]);
    }
  };

  const formatCountdown = (startISO: string, endISO: string) => {
    const now = new Date().getTime();
    const start = new Date(startISO).getTime();
    const end = new Date(endISO).getTime();
    if (now < start) return 'Not started';
    if (now > end) return 'Ended';
    const diff = Math.max(0, end - now);
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h left`;
    if (h > 0) return `${h}h ${m}m left`;
    return `${m}m left`;
  };

  const renderImageCard = (image: ImageAsset, index?: number) => (
    <div 
      key={image.id}
      draggable
      onDragStart={(e) => handleCardDragStart(e, image.id)}
      onDragOver={(e) => handleCardDragOver(e, image.id)}
      onDrop={(e) => handleCardDrop(e, image.id)}
      onDragEnd={handleCardDragEnd}
      className={`group relative bg-white rounded-xl border-2 transition-all duration-200 hover:shadow-lg select-none ${
        draggingId === image.id
          ? 'opacity-40 scale-95 border-dashed border-gray-400'
          : dragOverId === image.id
            ? 'border-teal-400 shadow-xl scale-[1.02]'
            : image.isActive
              ? 'border-green-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]'
              : selectedImages.includes(image.id)
                ? 'border-teal-500 shadow-md'
                : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        <GripVertical className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing opacity-60 group-hover:opacity-100 transition-opacity" />
        <input
          type="checkbox"
          checked={selectedImages.includes(image.id)}
          onChange={() => toggleImageSelection(image.id)}
          className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
        <Button
          variant="secondary"
            size="sm"
            onClick={() => toggleImageStatus(image.id)}
            className={`text-xs px-2 py-1 rounded-full border ${image.isActive ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'}`}
          >
          <span className="flex items-center gap-1">
            <Star className={`w-3 h-3 ${image.isActive ? 'text-green-600 fill-green-600' : 'text-gray-500'}`} />
            {image.isActive ? 'Active' : 'Set Active'}
          </span>
        </Button>
        {image.isActive && image.duration?.startTime && image.duration?.endTime && (() => {
          const countdown = formatCountdown(image.duration.startTime, image.duration.endTime);
          const style = countdown === 'Ended'
            ? 'bg-red-50 border-red-300 text-red-700'
            : countdown === 'Not started'
              ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
              : 'bg-white/90 border-green-200 text-green-700';
          return (
            <div className={`text-[11px] rounded px-2 py-0.5 border shadow-sm ${style}`}>
              {countdown}
            </div>
          );
        })()}
      </div>

      <div className="aspect-video bg-gray-100 rounded-t-xl overflow-hidden relative">
        {image.type === 'video' ? (
          <video 
            src={image.url} 
            className="w-full h-full object-cover"
            muted
          />
        ) : (
          <img 
            src={image.thumbnail || image.url} 
            alt={image.name}
            className="w-full h-full object-cover"
          />
        )}
        
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex space-x-2">
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/90 text-gray-900 hover:bg-white"
              onClick={() => window.open(image.url, '_blank')}
            >
              <Eye className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/90 text-teal-700 hover:bg-white"
              onClick={() => handleEditImage(image.id)}
            >
              <Edit3 className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/90 text-red-600 hover:bg-white"
              onClick={() => handleDeleteImage(image.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="absolute bottom-2 left-2">
          <Badge variant="secondary" className="bg-black/70 text-white text-xs">
            {image.type.toUpperCase()}
          </Badge>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
            {index !== undefined && (
              <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold">
                {index + 1}
              </span>
            )}
            <h4 className="font-medium text-gray-900 truncate">
              {image.name}
            </h4>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleImageStatus(image.id)}
            className="p-1"
          >
            <MoreVertical className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-2">
          

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{formatFileSize(image.size)}</span>
            <span>{image.dimensions.width > 0 ? `${image.dimensions.width} × ${image.dimensions.height}` : 'Loading…'}</span>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Used {image.usageCount} times</span>
            <span>{formatDate(image.uploadDate)}</span>
          </div>

          {image.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {image.tags.slice(0, 3).map(tag => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {image.tags.length > 3 && (
                <Badge variant="outline" className="text-xs">
                  +{image.tags.length - 3}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderListView = (image: ImageAsset) => (
    <tr key={image.id} className={`hover:bg-gray-50 ${image.isActive ? 'bg-green-50/50' : ''}`}>
      <td className="px-6 py-4 whitespace-nowrap">
        <input
          type="checkbox"
          checked={selectedImages.includes(image.id)}
          onChange={() => toggleImageSelection(image.id)}
          className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
        />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center">
          <img 
            src={image.thumbnail || image.url} 
            alt={image.name}
            className="w-12 h-12 object-cover rounded-lg mr-4"
          />
          <div>
            <div className="text-sm font-medium text-gray-900">{image.name}</div>
            <div className="text-sm text-gray-500">{image.format}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <Badge className={`${getCategoryColor(image.category)} text-xs border`}>
          <span className="mr-1">{getCategoryIcon(image.category)}</span>
          {categories.find(cat => cat.id === image.category)?.name || image.category}
        </Badge>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {formatFileSize(image.size)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {image.dimensions.width > 0 ? `${image.dimensions.width} × ${image.dimensions.height}` : 'Loading…'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
        <Badge 
          className={`${image.isActive 
            ? 'bg-green-100 text-green-800 border-green-200' 
            : 'bg-gray-100 text-gray-800 border-gray-200'
          } text-xs border flex items-center gap-1`}
        >
          <Star className={`w-3 h-3 ${image.isActive ? 'text-green-600 fill-green-600' : 'text-gray-400'}`} />
          {image.isActive ? 'Active' : 'Inactive'}
        </Badge>
        {image.isActive && image.duration?.startTime && image.duration?.endTime && (
          <span className="text-[11px] text-green-700">{formatCountdown(image.duration.startTime, image.duration.endTime)}</span>
        )}
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {formatDate(image.uploadDate)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(image.url, '_blank')}
            className="text-teal-600 hover:text-teal-800"
          >
            <Eye className="w-4 h-4" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleImageStatus(image.id)}
            className={image.isActive ? 'text-green-600 hover:text-green-800' : 'text-gray-600 hover:text-gray-800'}
            title={image.isActive ? 'Unset Active' : 'Set Active'}
          >
            <Star className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDeleteImage(image.id)}
            className="text-red-600 hover:text-red-800"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-8" onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag}>
      {bannerLoading && images.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center gap-3 text-sm text-gray-600 shadow-sm">
          <span className="animate-pulse inline-flex w-4 h-4 rounded-full bg-teal-500" /> Loading banner images…
        </div>
      )}
      {!bannerLoading && dimensionProgress.total > 0 && dimensionProgress.done < dimensionProgress.total && (
        <div className="bg-white border border-teal-200 rounded-xl px-4 py-2 text-xs text-teal-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-teal-500 animate-ping" /> Resolving dimensions {dimensionProgress.done}/{dimensionProgress.total}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center space-x-3">
          <X className="w-5 h-5 text-red-500" />
          <span className="text-red-700">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError?.(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            ✕
          </Button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {categories.map(category => (
            <Button
              key={category.id}
              variant={activeCategory === category.id ? 'default' : 'ghost'}
              className={`${activeCategory === category.id 
                ? 'bg-teal-600 text-white shadow-md' 
                : 'text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setActiveCategory(category.id)}
            >
              <Folder className="w-4 h-4 mr-2" />
              {category.name}
              <Badge variant="secondary" className="ml-2 bg-gray-100 text-gray-700">
                {category.count}
              </Badge>
            </Button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder="Search images by name or tags..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              >
                {viewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
              </Button>
              
              {selectedImages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllImages}
                >
                  {selectedImages.length === filteredImages.length ? 'Deselect All' : 'Select All'}
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              onClick={() => setShowUploadModal(true)}
              className="bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload
            </Button>
            
            {selectedImages.length > 0 && (
              <Button
                variant="outline"
                onClick={handleBulkDelete}
                className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete ({selectedImages.length})
              </Button>
            )}
            
            <Button
              variant="outline"
              onClick={handleClearAll}
              className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
            >
              Clear All
            </Button>
            
            <Button
              variant="outline"
              className="flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </Button>
          </div>
        </div>
      </div>

      {filteredImages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="max-w-md mx-auto">
            <ImageIcon className="w-16 h-16 text-gray-400 mx-auto mb-6" />
            <h3 className="text-2xl font-semibold text-gray-900 mb-4">No Images Found</h3>
            <p className="text-gray-500 mb-8">
              {searchTerm ? `No images match your search for "${searchTerm}".` : 'Upload your first images to get started.'}
            </p>
            <Button
              onClick={() => setShowUploadModal(true)}
              className="bg-teal-600 hover:bg-teal-700 text-white px-8 py-3"
            >
              <Upload className="w-5 h-5 mr-2" />
              Upload Images
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {viewMode === 'grid' ? (
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredImages.map((image, index) => renderImageCard(image, index))}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={selectedImages.length === filteredImages.length && filteredImages.length > 0}
                        onChange={selectAllImages}
                        className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Image
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Dimensions
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Upload Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredImages.map(renderListView)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {dragActive && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onDrop={handleDrop}
        >
          <div className="bg-white rounded-2xl p-12 text-center max-w-md mx-4">
            <Upload className="w-16 h-16 text-teal-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">Drop Images Here</h3>
            <p className="text-gray-500">Release to upload your images</p>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold">Upload Banner Images</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUploadModal(false)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Banner Name <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="Enter banner name"
                  value={bannerName}
                  onChange={(e) => setBannerName(e.target.value)}
                  required
                />
              </div>

              {/* Banner URL  */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target URL (optional)
                </label>
                <Input
                  placeholder="https://example.com"
                  value={bannerURL}
                  onChange={(e) => setBannerURL(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">URL to navigate when banner is clicked</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Image <span className="text-red-500">*</span>
                </label>
                {uploadFiles.length === 0 ? (
                  <div 
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-teal-500 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-sm text-gray-600">Click to select an image</p>
                    <p className="text-xs text-gray-400 mt-1">PNG, JPG, WEBP up to 10MB</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {uploadFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <FileImage className="w-5 h-5 text-gray-400" />
                          <span className="text-sm">{file.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {formatFileSize(file.size)}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setUploadFiles([])}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full"
                    >
                      Change Image
                    </Button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {/* Fixed category for Banners */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <div className="text-sm text-gray-700">Banners</div>
                <p className="text-xs text-gray-500 mt-1">Uploads save to Firebase Storage and metadata to Realtime Database.</p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
              <div className="text-sm text-gray-500">
                {uploadFiles.length} file(s) ready to upload
              </div>
              <div className="flex items-center space-x-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowUploadModal(false);
                    setBannerName("");
                    setBannerURL("");
                    setUploadFiles([]);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={bannerLoading || uploadFiles.length === 0 || !bannerName.trim()}
                  className="bg-teal-600 hover:bg-teal-700 text-white"
                >
                  {bannerLoading ? "Uploading..." : "Upload Banner"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Banner Modal */}
      {showEditModal && (() => {
        const current = images.find(i => i.id === editTargetId);
        const previewURL = editFile ? URL.createObjectURL(editFile) : (current?.imageURL || current?.url || '');
        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold">Edit Banner</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowEditModal(false);
                  setEditTargetId(null);
                  setEditName("");
                  setEditURL("");
                  setEditFile(null);
                }}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Banner Name <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="Enter banner name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target URL (optional)
                </label>
                <Input
                  placeholder="https://example.com"
                  value={editURL}
                  onChange={(e) => setEditURL(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">URL to navigate when banner is clicked</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Banner Image</label>
                {previewURL && (
                  <div className="mb-3 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                    <img src={previewURL} alt={editName || 'banner'} className="w-full max-h-64 object-contain" />
                  </div>
                )}
                {!editFile ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => editFileInputRef.current?.click()}
                    className="w-full"
                  >
                    <Upload className="w-4 h-4 mr-2" /> Replace Image
                  </Button>
                ) : (
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <FileImage className="w-5 h-5 text-gray-400" />
                      <span className="text-sm">{editFile.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {formatFileSize(editFile.size)}
                      </Badge>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setEditFile(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                <input
                  ref={editFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setEditFile(f);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <p className="text-xs text-gray-500 mt-1">Leave empty to keep the current image.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <div className="text-sm text-gray-700">Banners</div>
              </div>
            </div>

            <div className="flex items-center justify-end mt-8 pt-6 border-t border-gray-200 space-x-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditModal(false);
                  setEditTargetId(null);
                  setEditName("");
                  setEditURL("");
                  setEditFile(null);
                }}
                disabled={editLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmEditImage}
                disabled={editLoading || !editName.trim()}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {editLoading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Activate Duration Modal */}
      {showActiveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-[340px] mx-4 shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Set Active Duration</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowActiveModal(false)} className="h-6 w-6 p-0">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-600 mb-3">Choose a start and end date for when this banner should be active.</p>
            
            {/* Calendar header */}
            <div className="flex items-center justify-between mb-2">
              <button 
                type="button" 
                onClick={() => setActiveCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))} 
                className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100"
              >
                ◀
              </button>
              <div className="text-xs font-medium text-gray-700">
                {activeCalendarMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
              </div>
              <button 
                type="button" 
                onClick={() => setActiveCalendarMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))} 
                className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-100"
              >
                ▶
              </button>
            </div>
            
            {/* Weekday labels */}
            <div className="grid grid-cols-7 text-[10px] font-medium text-gray-500 mb-1">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
            </div>
            
            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1 text-xs mb-3">
              {Array.from({ length: firstWeekday(activeCalendarMonth) }).map((_,i) => <div key={'spacer'+i} />)}
              {Array.from({ length: daysInMonth(activeCalendarMonth) }).map((_,i) => {
                const day = new Date(activeCalendarMonth.getFullYear(), activeCalendarMonth.getMonth(), i+1);
                const selectedStart = activeRange.start && day.getTime() === activeRange.start.getTime();
                const selectedEnd = activeRange.end && day.getTime() === activeRange.end.getTime();
                const inRange = isInActiveRange(day);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleActiveDayClick(day)}
                    className={`h-7 rounded-md flex items-center justify-center transition border text-gray-700 ${
                      selectedStart || selectedEnd 
                        ? 'bg-teal-600 text-white border-teal-600 font-semibold' 
                        : inRange 
                          ? 'bg-teal-100 border-teal-200' 
                          : 'bg-white border-gray-200 hover:bg-gray-100'
                    }`}
                    title={toISO(day)}
                  >
                    {i+1}
                  </button>
                );
              })}
            </div>
            
            {/* Display selected range */}
            {activeRange.start && (
              <div className="text-xs text-gray-600 mb-3 text-center">
                {toISO(activeRange.start)} → {activeRange.end ? toISO(activeRange.end) : '...'}
              </div>
            )}
            
            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t">
              <button 
                type="button" 
                onClick={() => setActiveRange({ start: null, end: null })} 
                className="text-[11px] px-2 py-1 rounded-md border bg-white hover:bg-gray-100"
              >
                Clear
              </button>
              <div className="flex gap-2">
                <button 
                  type="button" 
                  onClick={confirmActivate} 
                  disabled={!activeRange.start} 
                  className="text-xs px-3 py-1.5 rounded-md bg-teal-600 text-white disabled:opacity-40 hover:bg-teal-700"
                >
                  Apply
                </button>
                <button 
                  type="button" 
                  onClick={() => setShowActiveModal(false)} 
                  className="text-xs px-3 py-1.5 rounded-md border bg-white hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Single) */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 shadow-xl p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Banner</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to delete this banner? This action cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowDeleteModal(false);
                      setDeleteTargetId(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={confirmDeleteImage}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md mx-4 shadow-xl p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Multiple Banners</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to delete {selectedImages.length} selected banner{selectedImages.length > 1 ? 's' : ''}? This action cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowBulkDeleteModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={confirmBulkDelete}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    Delete {selectedImages.length} Banner{selectedImages.length > 1 ? 's' : ''}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImagesTab;
