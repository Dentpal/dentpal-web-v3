/**
 * useCategoryResolution
 * Builds two maps used by the dashboard to display real category names:
 *   - productCategoryMap: productId  -> categoryID (lazily fetched per product)
 *   - categoryNameMap:    categoryID -> name      (live snapshot of Category collection)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Order } from '@/types/order';
import CategoryService from '@/services/category';
import ProductService from '@/services/product';

export const useCategoryResolution = (orders: Order[]) => {
  const [categoryNameMap, setCategoryNameMap] = useState<Map<string, string>>(new Map());
  const [productMapVersion, setProductMapVersion] = useState(0);

  const productCategoryRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  // 1. Live category names
  useEffect(() => {
    const unsub = CategoryService.listenCategories(
      (rows) => {
        const next = new Map<string, string>();
        rows.forEach((c) => next.set(c.id, c.name));
        setCategoryNameMap(next);
      },
      (err) => console.error('Failed to load categories:', err),
    );
    return () => { try { unsub?.(); } catch { /* noop */ } };
  }, []);

  // 2. Lazy product → categoryID resolution for productIds seen in orders
  const productIds = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      (o.items || []).forEach((it) => {
        if (it.productId) set.add(it.productId);
      });
    });
    return Array.from(set);
  }, [orders]);

  useEffect(() => {
    const cache = productCategoryRef.current;
    const inFlight = inFlightRef.current;
    const missing = productIds.filter((id) => !cache.has(id) && !inFlight.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    missing.forEach((id) => inFlight.add(id));

    Promise.all(
      missing.map(async (id) => {
        try {
          const prod = await ProductService.getProductById(id) as
            | (Record<string, unknown> & { categoryID?: string; categoryId?: string })
            | null;
          const categoryId = (prod?.categoryID || prod?.categoryId || '') as string;
          if (categoryId) cache.set(id, categoryId);
        } catch (err) {
          console.error(`Failed to load product ${id} for category resolution:`, err);
        } finally {
          inFlight.delete(id);
        }
      }),
    ).then(() => {
      if (!cancelled) setProductMapVersion((v) => v + 1);
    });

    return () => { cancelled = true; };
  }, [productIds]);

  // Bump dependency on productMapVersion so memos downstream re-run after fetches resolve
  const productCategoryMap = useMemo(
    () => new Map(productCategoryRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productMapVersion],
  );

  return { productCategoryMap, categoryNameMap };
};

export default useCategoryResolution;
