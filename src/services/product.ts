import { db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp, onSnapshot, query, where, updateDoc, doc, getDocs, getDoc, orderBy, increment, collectionGroup, limit, startAfter, endBefore } from 'firebase/firestore';

export type CreateProductInput = {
  sellerId: string;
  brand?: string;
  name: string;
  description?: string;
  imageURL?: string;
  thumbnailURL?: string | null;
  images?: string[];
  imageVersion?: string | null;
  categoryID?: string | null;
  subCategoryID?: string | null;
  isActive?: boolean;
  clickCounter?: number;
  lowestPrice?: number | null;
  variationImageVersions?: Record<string, string> | null;
  // New: optional status override for creation (e.g., 'draft')
  status?: 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'deleted' | 'archive';
  // New: suggested threshold for low-stock alerts
  suggestedThreshold?: number | null;
  // Updated: warranty & compliance
  dangerousGoods?: 'none' | 'dangerous';
  warrantyType?: string | null;
  warrantyDuration?: string | null;
  warrantyPolicy?: string;
  // New: inquiry flag
  allowInquiry?: boolean;
  // New: insurance & evaluation flag
  insuranceAndEvaluation?: boolean;
  // Brand image URL
  brandImage?: string | null;
};

const PRODUCT_COLLECTION = 'Product';

export const ProductService = {
    // Add a log entry to the Logs subcollection for a product
    async addProductLog(productId: string, log: {
      action: 'adjust_stock' | 'adjust_price';
      userId: string;
      userName?: string;
      detail: string;
      before?: any;
      after?: any;
      at?: number;
      sellerId: string;
      productName: string;
    }) {
      try {
        const col = collection(db, PRODUCT_COLLECTION, productId, 'Logs');
        await addDoc(col, {
          ...log,
          productId,
          at: log.at ?? Date.now(),
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.error('addProductLog failed', e);
      }
    },

  // Fetch logs for a specific product
  async getProductLogs(productId: string) {
    try {
      const col = collection(db, PRODUCT_COLLECTION, productId, 'Logs');
      const q = query(col, orderBy('at', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error('getProductLogs failed', e);
      return [];
    }
  },

  // Listen to logs for a seller (across all products)
  listenProductLogsBySeller(
    sellerId: string, 
    cb: (logs: any[], pagination?: { hasNextPage: boolean; hasPrevPage: boolean; lastDoc: any; firstDoc: any }) => void, 
    options?: { 
      startDate?: Date | null; 
      endDate?: Date | null;
      pageSize?: number;
      direction?: 'next' | 'prev';
      startAfterDoc?: any;
      endBeforeDoc?: any;
    }
  ) {
    try {
      const pageSize = options?.pageSize || 50;

      // Use provided date range or default to last 30 days
      let cutoffStart: number;
      let cutoffEnd: number;
      if (options?.startDate) {
        cutoffStart = options.startDate.getTime();
        cutoffEnd = options?.endDate ? options.endDate.getTime() : Date.now();
      } else {
        const now = Date.now();
        cutoffStart = now - 30 * 24 * 60 * 60 * 1000; // 30 days ago
        cutoffEnd = now;
      }

      const logsQueryBase: any[] = [
        collectionGroup(db, 'Logs'),
        where('sellerId', '==', sellerId),
        where('at', '>=', cutoffStart),
        where('at', '<=', cutoffEnd),
        orderBy('at', 'desc'),
      ];

      // Pagination: next/prev
      if (options?.direction === 'next' && options?.startAfterDoc) {
        logsQueryBase.push(startAfter(options.startAfterDoc));
      } else if (options?.direction === 'prev' && options?.endBeforeDoc) {
        logsQueryBase.push(endBefore(options.endBeforeDoc));
      }
      logsQueryBase.push(limit(pageSize));

      const logsQuery = query(logsQueryBase[0], ...logsQueryBase.slice(1));

      const unsub = onSnapshot(logsQuery, (snap) => {
        const docs = snap.docs;
        const logs = docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        const hasNextPage = docs.length === pageSize;
        const hasPrevPage = !!options?.startAfterDoc || !!options?.endBeforeDoc;
        const lastDoc = docs.length > 0 ? docs[docs.length - 1] : null;
        const firstDoc = docs.length > 0 ? docs[0] : null;
        cb(logs, { hasNextPage, hasPrevPage, lastDoc, firstDoc });
      },
      (error) => {
        console.error('[listenProductLogsBySeller] Error:', error);
        if (error.message.includes('index')) {
          console.error('[listenProductLogsBySeller] INDEX REQUIRED! Check console for Firebase index creation link.');
        }
        cb([], { hasNextPage: false, hasPrevPage: false, lastDoc: null, firstDoc: null });
      });
      return unsub;
    } catch (e) {
      console.error('listenProductLogsBySeller failed', e);
      return () => {};
    }
  },

  async createProduct(input: CreateProductInput) {
    const initialStatus = input.status ?? 'pending_qc';
    const payload = {
      sellerId: input.sellerId,
      brand: input.brand ?? null,
      name: input.name,
      description: input.description ?? '',
      imageURL: input.imageURL ?? '',
      thumbnailURL: input.thumbnailURL ?? null,
      images: Array.isArray(input.images) ? input.images : (input.imageURL ? [input.imageURL] : []),
      imageVersion: input.imageVersion ?? null,
      categoryID: input.categoryID ?? null,
      // Write both spellings to satisfy consumers and requested schema
      subCategoryID: input.subCategoryID ?? null,
      subcategoryID: input.subCategoryID ?? null,
      // QC-first: new products are pending review by default unless overridden
      isActive: false,
      status: initialStatus,
      // Explicit approval flag
      IsApproved: false,
      clickCounter: input.clickCounter ?? 0,
      lowestPrice: input.lowestPrice ?? null,
      variationImageVersions: input.variationImageVersions ?? null,
      // product-level pricing fields
      price: null,
      specialPrice: null,
      promoStart: null,
      promoEnd: null,
      // New: low-stock threshold (optional)
      suggestedThreshold: input.suggestedThreshold ?? null,
      // Updated: warranty & compliance
      dangerousGoods: input.dangerousGoods ?? 'none',
      warrantyType: input.warrantyType ?? null,
      warrantyDuration: input.warrantyDuration ?? null,
      warrantyPolicy: input.warrantyPolicy ?? '',
      // Persist inquiry flag
      allowInquiry: input.allowInquiry ?? false,
      // Persist insurance & evaluation flag
      insuranceAndEvaluation: input.insuranceAndEvaluation ?? false,
      // Brand image
      brandImage: input.brandImage ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as const;

    const ref = await addDoc(collection(db, PRODUCT_COLLECTION), payload as any);
    return { id: ref.id };
  },

  async addVariations(productId: string, variations: Array<{
    sku?: string;
    price?: number;
    stock?: number;
    weight?: number;
    // New: units
    weightUnit?: string;
    dimensionsUnit?: string;
    dimensions?: { length?: number; width?: number; height?: number } | null;
    imageURL?: string | null;
    thumbnailURL?: string | null;
    name?: string;
    pcsPerBox?: number | null;
    isFragile?: boolean;
  }>) {
    const col = collection(db, PRODUCT_COLLECTION, productId, 'Variation');
    const tasks = variations.map(v => {
      const dim = v.dimensions || null;
      return addDoc(col, {
        // Required fields per request
        SKU: v.sku ?? null,
        // Also keep lowercase for compatibility
        sku: v.sku ?? null,
        price: v.price != null ? Number(v.price) : null,
        stock: v.stock != null ? Number(v.stock) : 0,
        weight: v.weight != null ? Number(v.weight) : null,
        // New: store units
        weightUnit: v.weightUnit ?? null,
        dimensionsUnit: v.dimensionsUnit ?? null,
        // New: singular `dimension` object with height, width, weight
        dimension: {
          height: dim?.height ?? null,
          width: dim?.width ?? null,
          // Note: request included weight inside dimension as well
          weight: v.weight != null ? Number(v.weight) : null,
        },
        // Keep legacy `dimensions` for backward compatibility
        dimensions: dim ?? null,
        imageURL: v.imageURL ?? null,
        thumbnailURL: v.thumbnailURL ?? null,
        name: v.name ?? null,
        pcsPerBox: v.pcsPerBox ?? null,
        isFragile: v.isFragile ?? false,
        productId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await Promise.all(tasks);
  },

  // Admin QC: approve -> active
  async approveProduct(productId: string) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, {
      status: 'active',
      isActive: true,
      // Mark as approved
      IsApproved: true,
      qcReviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  // Admin QC: reject -> violation (keep inactive)
  async rejectProduct(productId: string, reason: string) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, {
      status: 'violation',
      isActive: false,
      // Keep unapproved
      IsApproved: false,
      qcRejectedAt: serverTimestamp(),
      qcReason: reason ?? '',
      violationMessage: reason ?? '',
      updatedAt: serverTimestamp(),
    });
  },

  // Record a QC audit entry with a snapshot of product at action time
  async addQCAudit(productId: string, entry: { action: 'approve' | 'reject' | 'violation'; at?: number; reason?: string; adminId?: string | null; }) {
    try {
      const pRef = doc(db, PRODUCT_COLLECTION, productId);
      const snap = await getDoc(pRef);
      const productSnapshot = snap.exists() ? snap.data() : null;
      const payload = {
        productId,
        action: entry.action,
        reason: entry.reason ?? '',
        adminId: entry.adminId ?? null,
        at: entry.at ?? Date.now(),
        createdAt: serverTimestamp(),
        // store a lightweight copy of product for audit purposes
        productSnapshot,
        productSnapshotId: productId,
      } as const;
      await addDoc(collection(db, 'Product_QC_Audit'), payload as any);
    } catch (e) {
      console.error('addQCAudit failed', e);
    }
  },

  // Admin QC: listen to products needing QC (pending or not approved yet)
  listenPendingQC(cb: (rows: Array<{ id: string; data: any }>) => void) {
    // Broad query; filter client-side so older items (without the flag) are included
    const qRef = query(collection(db, PRODUCT_COLLECTION));
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter(({ data }) => {
          const status = data.status || 'inactive';
          // Backward compatibility: treat QCProduct true as approved as well
          const approved = data.IsApproved === true || data.QCProduct === true;
          const excluded = status === 'deleted' || status === 'violation' || status === 'draft';
          return !excluded && !approved; // include anything not approved yet
        })
        .sort((a, b) => {
          const aTs = a.data.createdAt?.toMillis?.() ? Number(a.data.createdAt.toMillis()) : 0;
          const bTs = b.data.createdAt?.toMillis?.() ? Number(b.data.createdAt.toMillis()) : 0;
          return bTs - aTs;
        });
      cb(rows);
    });
    return unsub;
  },

  // Admin QC: listen to approved products
  listenApproved(cb: (rows: Array<{ id: string; data: any }>) => void) {
    const qRef = query(collection(db, PRODUCT_COLLECTION), where('IsApproved', '==', true));
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .sort((a, b) => {
          const aTs = a.data.updatedAt?.toMillis?.() ? Number(a.data.updatedAt.toMillis()) : 0;
          const bTs = b.data.updatedAt?.toMillis?.() ? Number(b.data.updatedAt.toMillis()) : 0;
          return bTs - aTs;
        });
      cb(rows);
    });
    return unsub;
  },

  // Admin QC: listen to violation products
  listenViolation(cb: (rows: Array<{ id: string; data: any }>) => void) {
    const qRef = query(collection(db, PRODUCT_COLLECTION), where('status', '==', 'violation'));
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .sort((a, b) => {
          const aTs = a.data.updatedAt?.toMillis?.() ? Number(a.data.updatedAt.toMillis()) : 0;
          const bTs = b.data.updatedAt?.toMillis?.() ? Number(b.data.updatedAt.toMillis()) : 0;
          return bTs - aTs;
        });
      cb(rows);
    });
    return unsub;
  },

  // New: Toggle product active flag
  async toggleActive(productId: string, nextActive: boolean) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { isActive: !!nextActive, status: nextActive ? 'active' : 'inactive', updatedAt: serverTimestamp() });
  },

  // New: Listen to products by seller and aggregate basic inventory fields
  listenBySeller(
    sellerId: string,
    cb: (rows: Array<{
      id: string;
      name: string;
      brand?: string;
      description?: string;
      imageUrl?: string;
      price?: number;
      specialPrice?: number;
      inStock: number;
      status: 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'deleted' | 'archive';
      updatedAt: number;
      createdAt: number;
      sku?: string;
      category?: string;
      categoryID?: string;
      subcategory?: string;
      subCategoryID?: string;
      qcReason?: string;
      violationmessage?: string;
      // New: expose threshold
      suggestedThreshold?: number | null;
      variationCount?: number;
      // Warranty & compliance
      warrantyType?: string;
      warrantyDuration?: string;
      warrantyPolicy?: string;
      dangerousGoods?: string;
      allowInquiry?: boolean;
      insuranceAndEvaluation?: boolean;
      brandImage?: string;
      images?: string[];
      clickCounter?: number;
    }>) => void
  ) {
    const qRef = query(collection(db, PRODUCT_COLLECTION), where('sellerId', '==', sellerId));
    const unsub = onSnapshot(qRef, async (snap) => {
      const products = await Promise.all(snap.docs.map(async (d) => {
        const pd: any = d.data();
        // Sum variation stocks
        let totalStock = 0;
        let variationCount = 0;
        try {
          const varSnap = await getDocs(collection(db, PRODUCT_COLLECTION, d.id, 'Variation'));
          const vars = varSnap.docs.map(vd => vd.data() as any);
          variationCount = vars.length;
          totalStock = vars.reduce((sum, v) => sum + (Number(v.stock ?? 0)), 0);
        } catch {}
        // Effective special price: only expose when within schedule or long-term
        let effectiveSpecial: number | undefined = undefined;
        const now = Date.now();
        const hasLongTerm = pd.specialPrice != null && (pd.promoStart == null && pd.promoEnd == null);
        const inWindow = pd.specialPrice != null && pd.promoStart != null && pd.promoEnd != null && now >= Number(pd.promoStart) && now <= Number(pd.promoEnd);
        if (hasLongTerm || inWindow) {
          effectiveSpecial = Number(pd.specialPrice);
        }
        // Prefer explicit status if present, else derive from isActive
        const s = (pd.status ?? (pd.isActive === false ? 'inactive' : 'active')) as 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'deleted' | 'archive';
        return {
          id: String(d.id),
          name: String(pd.name ?? ''),
          brand: typeof pd.brand === 'string' ? pd.brand : undefined,
          description: typeof pd.description === 'string' ? pd.description : '',
          imageUrl: pd.imageURL ? String(pd.imageURL) : undefined,
          price: pd.price != null ? Number(pd.price) : undefined,
          specialPrice: effectiveSpecial,
          inStock: Number(totalStock || 0),
          status: s,
          updatedAt: pd.updatedAt?.toMillis?.() ? Number(pd.updatedAt.toMillis()) : Date.now(),
          createdAt: pd.createdAt?.toMillis?.() ? Number(pd.createdAt.toMillis()) : (typeof pd.createdAt === 'number' ? pd.createdAt : 0),
          sku: undefined as string | undefined,
          category: typeof pd.categoryID === 'string' ? pd.categoryID : undefined,
          categoryID: typeof pd.categoryID === 'string' ? pd.categoryID : undefined,
          subcategory: typeof pd.subCategoryID === 'string' ? pd.subCategoryID : undefined,
          subCategoryID: typeof pd.subCategoryID === 'string' ? pd.subCategoryID : undefined,
          qcReason: typeof pd.qcReason === 'string' ? pd.qcReason : undefined,
          violationmessage: typeof pd.violationmessage === 'string' ? pd.violationmessage : undefined,
          suggestedThreshold: pd.suggestedThreshold != null ? Number(pd.suggestedThreshold) : null,
          variationCount: variationCount,
          warrantyType: typeof pd.warrantyType === 'string' ? pd.warrantyType : undefined,
          warrantyDuration: typeof pd.warrantyDuration === 'string' ? pd.warrantyDuration : undefined,
          warrantyPolicy: typeof pd.warrantyPolicy === 'string' ? pd.warrantyPolicy : undefined,
          dangerousGoods: typeof pd.dangerousGoods === 'string' ? pd.dangerousGoods : undefined,
          allowInquiry: typeof pd.allowInquiry === 'boolean' ? pd.allowInquiry : undefined,
          insuranceAndEvaluation: typeof pd.insuranceAndEvaluation === 'boolean' ? pd.insuranceAndEvaluation : undefined,
          brandImage: typeof pd.brandImage === 'string' ? pd.brandImage : undefined,
          images: Array.isArray(pd.images) ? pd.images.map((u: any) => String(u)).filter((u: string) => !!u) : undefined,
          clickCounter: typeof pd.clickCounter === 'number' ? pd.clickCounter : 0,
        };
      }));
      // sort name asc like before
      products.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      cb(products);
    });
    return unsub;
  },

  // New: Adjust stock for a specific variation
  async adjustVariationStock(productId: string, variationId: string, delta: number, userId?: string, userName?: string) {
    const vRef = doc(db, PRODUCT_COLLECTION, productId, 'Variation', variationId);
    
    // Get current stock and variation name before adjustment
    const vSnap = await getDoc(vRef);
    const currentStock = vSnap.exists() ? (vSnap.data().stock || 0) : 0;
    const variationName = vSnap.exists() ? (vSnap.data().name || 'Unknown') : 'Unknown';
    const newStock = currentStock + Number(delta);
    
    await updateDoc(vRef, { stock: increment(Number(delta) || 0), updatedAt: serverTimestamp() });
    
    // Log the adjustment
    if (userId) {
      // Get product details for logging
      const pRef = doc(db, PRODUCT_COLLECTION, productId);
      const pSnap = await getDoc(pRef);
      const productData = pSnap.exists() ? pSnap.data() : {};
      const productName = productData.name || 'Unknown Product';
      const sellerId = productData.sellerId || '';
      
      await this.addProductLog(productId, {
        action: 'adjust_stock',
        userId,
        userName,
        detail: `Stock adjusted by ${delta} for variation "${variationName}"`,
        before: { stock: currentStock, variationId, variationName },
        after: { stock: newStock, variationId, variationName },
        sellerId,
        productName,
      });
    }
    
    // Nudge parent product so product snapshot listeners refresh totals
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { updatedAt: serverTimestamp() });
  },

  // Listen to variations for a specific product
  listenVariations(productId: string, callback: (variations: Array<any>) => void) {
    const col = collection(db, PRODUCT_COLLECTION, productId, 'Variation');
    const unsub = onSnapshot(col, snapshot => {
      const variations = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      callback(variations);
    });
    return unsub;
  },

  // Update a variation
  async updateVariation(productId: string, variationId: string, updates: {
    name?: string;
    SKU?: string;
    price?: number;
    stock?: number;
    weight?: number;
    weightUnit?: string;
    dimensions?: { length?: number; width?: number; height?: number };
    dimensionsUnit?: string;
    imageURL?: string;
    thumbnailURL?: string;
    isFragile?: boolean;
    pcsPerBox?: number;
  }) {
    const vRef = doc(db, PRODUCT_COLLECTION, productId, 'Variation', variationId);
    const updateData: any = {
      updatedAt: serverTimestamp(),
    };
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.SKU !== undefined) {
      updateData.SKU = updates.SKU;
      updateData.sku = updates.SKU; // Keep both for compatibility
    }
    if (updates.price !== undefined) updateData.price = Number(updates.price);
    if (updates.stock !== undefined) updateData.stock = Number(updates.stock);
    if (updates.weight !== undefined) updateData.weight = Number(updates.weight);
    if (updates.weightUnit !== undefined) updateData.weightUnit = updates.weightUnit;
    if (updates.dimensionsUnit !== undefined) updateData.dimensionsUnit = updates.dimensionsUnit;
    if (updates.imageURL !== undefined) updateData.imageURL = updates.imageURL;
    if (updates.thumbnailURL !== undefined) updateData.thumbnailURL = updates.thumbnailURL;
    if (updates.isFragile !== undefined) updateData.isFragile = updates.isFragile;
    if (updates.pcsPerBox !== undefined) updateData.pcsPerBox = Number(updates.pcsPerBox);
    
    if (updates.dimensions) {
      updateData.dimensions = updates.dimensions;
      updateData.dimension = {
        height: updates.dimensions.height ?? null,
        width: updates.dimensions.width ?? null,
        weight: updates.weight ?? null,
      };
    }
    
    await updateDoc(vRef, updateData);
    
    // Nudge parent product to trigger listeners
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { updatedAt: serverTimestamp() });
  },

  // Delete a variation
  async deleteVariation(productId: string, variationId: string) {
    const vRef = doc(db, PRODUCT_COLLECTION, productId, 'Variation', variationId);
    await updateDoc(vRef, {
      isDeleted: true,
      updatedAt: serverTimestamp()
    });
    
    // Nudge parent product
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { updatedAt: serverTimestamp() });
  },

  // New: Adjust overall product stock (fallback when no variationId)
  async adjustProductStock(productId: string, delta: number) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { inStock: increment(Number(delta) || 0), updatedAt: serverTimestamp() });
  },

  async updateProduct(productId: string, updates: Partial<{
    name: string;
    brand: string;
    description: string;
    imageURL: string;
    thumbnailURL: string | null;
    images: string[];
    brandImage: string | null;
    categoryID: string | null;
    subCategoryID: string | null;
    isActive: boolean;
    price: number | null;
    status: 'active' | 'inactive' | 'draft' | 'pending_qc' | 'violation' | 'deleted' | 'archive';
    suggestedThreshold: number | null;
    // Updated: warranty & compliance
    dangerousGoods: 'none' | 'dangerous';
    warrantyType: string | null;
    warrantyDuration: string | null;
    warrantyPolicy: string;
    allowInquiry: boolean; // new
    insuranceAndEvaluation: boolean; // new
  }>) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    const payload: any = {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.brand !== undefined ? { brand: updates.brand } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.imageURL !== undefined ? { imageURL: updates.imageURL } : {}),
      ...(updates.thumbnailURL !== undefined ? { thumbnailURL: updates.thumbnailURL } : {}),
      ...(updates.images !== undefined ? { images: Array.isArray(updates.images) ? updates.images : [] } : {}),
      ...(updates.brandImage !== undefined ? { brandImage: updates.brandImage } : {}),
      ...(updates.categoryID !== undefined ? { categoryID: updates.categoryID } : {}),
      ...(updates.subCategoryID !== undefined ? { subCategoryID: updates.subCategoryID, subcategoryID: updates.subCategoryID } : {}),
      ...(updates.isActive !== undefined ? { isActive: !!updates.isActive } : {}),
      ...(updates.price !== undefined ? { price: updates.price } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.suggestedThreshold !== undefined ? { suggestedThreshold: updates.suggestedThreshold } : {}),
      ...(updates.dangerousGoods !== undefined ? { dangerousGoods: updates.dangerousGoods } : {}),
      ...(updates.warrantyType !== undefined ? { warrantyType: updates.warrantyType } : {}),
      ...(updates.warrantyDuration !== undefined ? { warrantyDuration: updates.warrantyDuration } : {}),
      ...(updates.warrantyPolicy !== undefined ? { warrantyPolicy: updates.warrantyPolicy } : {}),
      ...(updates.allowInquiry !== undefined ? { allowInquiry: !!updates.allowInquiry } : {}),
      ...(updates.insuranceAndEvaluation !== undefined ? { insuranceAndEvaluation: !!updates.insuranceAndEvaluation } : {}),
      updatedAt: serverTimestamp(),
    };
    await updateDoc(pRef, payload);
  },

  // New helper: update product-level price, special price and promo window
  async updatePriceAndPromo(productId: string, payload: { price: number | null; specialPrice: number | null; promoStart: number | null; promoEnd: number | null; }, userId?: string, userName?: string) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    
    // Get current prices before adjustment
    const pSnap = await getDoc(pRef);
    const currentData = pSnap.exists() ? pSnap.data() : {};
    const before = {
      price: currentData.price || null,
      specialPrice: currentData.specialPrice || null,
      promoStart: currentData.promoStart || null,
      promoEnd: currentData.promoEnd || null,
    };
    
    // Get product details for logging
    const productName = currentData.name || 'Unknown Product';
    const sellerId = currentData.sellerId || '';
    
    await updateDoc(pRef, {
      price: payload.price ?? null,
      specialPrice: payload.specialPrice ?? null,
      promoStart: payload.promoStart ?? null,
      promoEnd: payload.promoEnd ?? null,
      updatedAt: serverTimestamp(),
    });
    
    // Log the price adjustment
    if (userId) {
      await this.addProductLog(productId, {
        action: 'adjust_price',
        userId,
        userName,
        detail: `Price updated: ${before.price} → ${payload.price}, Special: ${before.specialPrice} → ${payload.specialPrice}`,
        before,
        after: payload,
        sellerId,
        productName,
      });
    }
  },

  // New: Soft delete a product (move to Deleted tab)
  async markDeleted(productId: string) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { status: 'deleted', isActive: false, updatedAt: serverTimestamp() });
  },

  // New: Restore a deleted product (return as inactive by default)
  async restore(productId: string) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { status: 'inactive', isActive: false, updatedAt: serverTimestamp() });
  },

  async getProductById(productId: string) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    const snap = await getDoc(pRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as any) };
  },

  // Fetch variations for a product
  async getVariations(productId: string) {
    const varSnap = await getDocs(collection(db, PRODUCT_COLLECTION, productId, 'Variation'));
    return varSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  },

  // Convenience: fetch product with variations
  async getProductDetail(productId: string) {
    const prod = await this.getProductById(productId);
    if (!prod) return null;
    const vars = await this.getVariations(productId);
    return { product: prod, variations: vars };
  },

  // New: Ensure a default variation exists for a product, create one if missing
  async ensureDefaultVariation(productId: string) {
    // Reuse getVariations to check existing
    const existing = await this.getVariations(productId);
    if (existing.length > 0) return existing[0].id;

    const vCol = collection(db, PRODUCT_COLLECTION, productId, 'Variation');
    const ref = await addDoc(vCol, {
      SKU: null,
      sku: null,
      name: 'default',
      price: null,
      stock: 0,
      weight: null,
      dimension: { height: null, width: null, weight: null },
      dimensions: null,
      imageURL: null,
      productId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as any);
    // Touch parent product so listeners recalc totals
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { updatedAt: serverTimestamp() });
    return ref.id;
  },

  // Delete a product (for draft and archive items only)
  async deleteProduct(productId: string) {
    const pRef = doc(db, PRODUCT_COLLECTION, productId);
    await updateDoc(pRef, { 
      status: 'deleted',
      updatedAt: serverTimestamp() 
    });
  },
};

export default ProductService;
