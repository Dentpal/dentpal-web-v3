/**
 * BulkAddItems – Excel-style two-level table.
 * Product table on top; variations expand inline as a nested sub-table.
 * Saves everything as draft.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Save, ChevronDown, ChevronRight, ImageIcon, CheckCircle, XCircle, ClipboardPaste, Info, Download, Upload } from 'lucide-react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { ProductService } from '@/services/product';
import CategoryService from '@/services/category';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

/* ─── Constants ──────────────────────────────────────────────────── */

const DG_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'none', label: 'None' },
  { value: 'battery', label: 'Contains Battery' },
  { value: 'flammable', label: 'Flammable' },
  { value: 'liquid', label: 'Liquid' },
];
const WR_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'local_manufacturer', label: 'Local Manufacturer' },
  { value: 'international_manufacturer', label: 'Intl. Manufacturer' },
  { value: 'local_supplier', label: 'Local Supplier' },
  { value: 'local_supplier_refund', label: 'Supplier Refund' },
  { value: 'no_warranty', label: 'No Warranty' },
  { value: 'international_seller', label: 'Intl. Seller' },
];

/* ─── Types ───────────────────────────────────────────────────────── */

type Variation = {
  id: string;
  imgFile: File | null;
  imgPreview: string | null;
  name: string;
  sku: string;
  price: string;
  pcsPerBox: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  errors: Record<string, string>;
};

type Product = {
  id: string;
  brandImgFile: File | null;
  brandImgPreview: string | null;
  brand: string;
  prodImgFile: File | null;
  prodImgPreview: string | null;
  name: string;
  description: string;
  categoryID: string;
  subCategoryID: string;
  dangerousGoods: string;
  warrantyType: string;
  warrantyDuration: string;
  warrantyPolicy: string;
  variations: Variation[];
  expanded: boolean;
  saveStatus: null | { ok: boolean; msg: string };
  errors: Record<string, string>;
};

/* ─── Factories ──────────────────────────────────────────────────── */

const gid = () => Math.random().toString(36).slice(2, 10);

const emptyVar = (): Variation => ({
  id: gid(), imgFile: null, imgPreview: null,
  name: '', sku: '', price: '', pcsPerBox: '',
  weight: '', length: '', width: '', height: '',
  errors: {},
});

const emptyProduct = (): Product => ({
  id: gid(),
  brandImgFile: null, brandImgPreview: null, brand: '',
  prodImgFile: null, prodImgPreview: null,
  name: '', description: '',
  categoryID: '', subCategoryID: '',
  dangerousGoods: 'none', warrantyType: '', warrantyDuration: '', warrantyPolicy: '',
  variations: [emptyVar()],
  expanded: true,
  saveStatus: null,
  errors: {},
});

/* ─── Validation ──────────────────────────────────────────────────── */

const validateAll = (products: Product[]): Product[] =>
  products.map(p => {
    const pe: Record<string, string> = {};
    if (!p.brand.trim())           pe.brand = 'Required';
    if (!p.name.trim())            pe.name = 'Required';
    if (!p.description.trim())     pe.description = 'Required';
    if (!p.categoryID)             pe.categoryID = 'Required';
    if (!p.subCategoryID)          pe.subCategoryID = 'Required';
    if (!p.dangerousGoods)         pe.dangerousGoods = 'Required';
    if (!p.warrantyType)           pe.warrantyType = 'Required';
    if (!p.warrantyDuration.trim())pe.warrantyDuration = 'Required';
    if (!p.warrantyPolicy.trim())  pe.warrantyPolicy = 'Required';
    if (p.variations.length === 0) pe._noVar = 'At least 1 variation required';

    const skuSet = new Set<string>();
    const validatedVars = p.variations.map(v => {
      const ve: Record<string, string> = {};
      if (!v.name.trim())  ve.name = 'Required';
      if (!v.sku.trim())   ve.sku = 'Required';
      else {
        const key = v.sku.trim().toLowerCase();
        if (skuSet.has(key)) ve.sku = 'Duplicate';
        skuSet.add(key);
      }
      if (!v.price.trim() || isNaN(Number(v.price)) || Number(v.price) <= 0) ve.price = '> 0 required';
      if (!v.pcsPerBox.trim() || isNaN(Number(v.pcsPerBox))) ve.pcsPerBox = 'Number required';
      if (!v.weight.trim() || isNaN(Number(v.weight)))        ve.weight = 'Number required';
      if (!v.length.trim() || isNaN(Number(v.length)))        ve.length = 'Number required';
      if (!v.width.trim()  || isNaN(Number(v.width)))         ve.width = 'Number required';
      if (!v.height.trim() || isNaN(Number(v.height)))        ve.height = 'Number required';
      return { ...v, errors: ve };
    });

    const hasVarErr = validatedVars.some(v => Object.keys(v.errors).length > 0);
    const expanded = Object.keys(pe).length > 0 || hasVarErr ? true : p.expanded;
    return { ...p, errors: pe, variations: validatedVars, expanded };
  });

const hasErrors = (p: Product) =>
  Object.keys(p.errors).length > 0 || p.variations.some(v => Object.keys(v.errors).length > 0);

/* ─── Upload helper ──────────────────────────────────────────────── */

const uploadIfFile = async (file: File | null, path: string): Promise<string> => {
  if (!file) return '';
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
};

/* ─── Excel paste helpers ────────────────────────────────────────── */

/**
 * Parse clipboard TSV text into a 2-D string array.
 * Handles quoted cells (Excel wraps cells with commas/newlines in "…").
 */
const parseTSV = (text: string): string[][] => {
  return text
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(line => line.split('\t').map(c => c.trim()));
};

/**
 * PRODUCT paste column order (match your table left→right, skip image cols):
 * 0  Brand
 * 1  Product Name
 * 2  Description
 * 3  Category  (name, case-insensitive)
 * 4  Subcategory (name, case-insensitive)
 * 5  Dangerous Goods (none | battery | flammable | liquid)
 * 6  Warranty Type   (local_manufacturer | international_manufacturer | local_supplier | local_supplier_refund | no_warranty | international_seller)
 * 7  Warranty Duration (months, numeric)
 * 8  Warranty Policy
 */
const PRODUCT_PASTE_COLS = ['brand','name','description','_catName','_subcatName','dangerousGoods','warrantyType','warrantyDuration','warrantyPolicy'] as const;
type ProductPasteKey = typeof PRODUCT_PASTE_COLS[number];

/**
 * VARIATION paste column order:
 * 0  Variation Name
 * 1  SKU
 * 2  Price
 * 3  Pcs/Box
 * 4  Weight (g)
 * 5  Length (cm)
 * 6  Width  (cm)
 * 7  Height (cm)
 */
const VARIATION_PASTE_COLS = ['name','sku','price','pcsPerBox','weight','length','width','height'] as const;
type VariationPasteKey = typeof VARIATION_PASTE_COLS[number];

/* ─── Shared cell styles ─────────────────────────────────────────── */

const cellBase = 'border border-gray-300 text-[11px]';

const inputCls = (err?: string) =>
  `w-full bg-transparent border-0 outline-none text-[11px] px-1.5 h-7 focus:ring-1 focus:ring-inset focus:ring-teal-400 ${err ? 'ring-1 ring-inset ring-red-400 bg-red-50' : ''}`;

const selectCls = (err?: string) =>
  `w-full bg-transparent border-0 outline-none text-[11px] px-1 h-7 focus:ring-1 focus:ring-inset focus:ring-teal-400 ${err ? 'ring-1 ring-inset ring-red-400 bg-red-50' : ''}`;

/* ─── Image upload cell ──────────────────────────────────────────── */

const ImgUpload: React.FC<{ preview: string | null; onFile: (f: File) => void; size?: number }> = ({
  preview, onFile, size = 38,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center justify-center py-0.5">
      <button type="button" onClick={() => ref.current?.click()}
        style={{ width: size, height: size }}
        className="rounded border border-dashed border-gray-300 bg-gray-50 hover:bg-teal-50 flex items-center justify-center overflow-hidden flex-shrink-0 transition"
        title="Click to upload image">
        {preview
          ? <img src={preview} alt="" className="w-full h-full object-cover" />
          : <ImageIcon className="text-gray-400" style={{ width: size * 0.44, height: size * 0.44 }} />}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
};

/* ─── Req asterisk ───────────────────────────────────────────────── */
const R = () => <span className="text-red-400 ml-px">*</span>;

/* ─── Main component ─────────────────────────────────────────────── */

const PRODUCT_COL_COUNT = 15; // total cols in product table (including meta + actions)

const BulkAddItems: React.FC = () => {
  const { uid: userId, isSeller, isSubAccount, parentId } = useAuth();
  const { toast } = useToast();
  const sellerId = isSeller ? (isSubAccount ? (parentId || userId) : userId) : null;

  const [products, setProducts]         = useState<Product[]>([emptyProduct(), emptyProduct(), emptyProduct()]);
  const [saving, setSaving]             = useState(false);
  const [categories, setCategories]     = useState<Array<{ id: string; name: string }>>([]);
  const [subcatsByCat, setSubcatsByCat] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const [showGuide, setShowGuide]       = useState(false);
  const containerRef                    = useRef<HTMLDivElement>(null);
  const xlsxInputRef                    = useRef<HTMLInputElement>(null);

  /* live category data */
  useEffect(() => {
    const unsub = CategoryService.listenCategories((cats: any[]) =>
      setCategories(cats.map((c: any) => ({ id: c.id, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name)))
    );
    return () => unsub();
  }, []);

  /* ── Excel paste handler ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePaste = (e: ClipboardEvent) => {
      // Only intercept if focus is inside our container
      if (!el.contains(document.activeElement)) return;

      const raw = e.clipboardData?.getData('text/plain') ?? '';
      if (!raw.trim()) return;

      const rows = parseTSV(raw);
      if (rows.length === 0) return;

      // ── Detect zone via data attributes on focused element ──
      const focused = document.activeElement as HTMLElement | null;
      const zoneEl  = focused?.closest<HTMLElement>('[data-paste-zone]');
      const zone    = zoneEl?.dataset.pasteZone ?? 'product';
      const pIdxStr = zoneEl?.dataset.productIdx;
      const vIdxStr = zoneEl?.dataset.variationIdx;
      const startP  = pIdxStr !== undefined ? parseInt(pIdxStr, 10) : 0;
      const startV  = vIdxStr !== undefined ? parseInt(vIdxStr, 10) : 0;

      if (zone === 'variation') {
        // Fill variations starting at startV for product startP
        e.preventDefault();
        setProducts(prev => {
          const next = [...prev];
          const product = { ...next[startP], variations: [...next[startP].variations] };
          rows.forEach((cols, ri) => {
            const vIdx = startV + ri;
            const patch: Partial<Variation> = {};
            (VARIATION_PASTE_COLS as readonly VariationPasteKey[]).forEach((key, ci) => {
              const val = cols[ci] ?? '';
              (patch as any)[key] = val;
            });
            if (vIdx < product.variations.length) {
              product.variations[vIdx] = { ...product.variations[vIdx], ...patch, errors: {} };
            } else {
              product.variations.push({ ...emptyVar(), ...patch });
            }
          });
          product.expanded = true;
          next[startP] = product;
          return next;
        });
        toast({ title: `Pasted ${rows.length} variation${rows.length > 1 ? 's' : ''}`, description: 'Review the filled rows below.' });
      } else {
        // Fill products starting at startP
        e.preventDefault();
        setProducts(prev => {
          const next = [...prev];
          rows.forEach((cols, ri) => {
            const pIdx = startP + ri;
            const catName    = cols[PRODUCT_PASTE_COLS.indexOf('_catName' as any)]    ?? '';
            const subcatName = cols[PRODUCT_PASTE_COLS.indexOf('_subcatName' as any)] ?? '';

            // Resolve category ID by name
            const catMatch = categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
            const catID    = catMatch?.id ?? '';

            // Build product patch for plain string fields
            const patch: Partial<Product> = {};
            (PRODUCT_PASTE_COLS as readonly ProductPasteKey[]).forEach((key, ci) => {
              if (key === '_catName' || key === '_subcatName') return;
              (patch as any)[key] = cols[ci] ?? '';
            });
            patch.categoryID    = catID;
            patch.subCategoryID = ''; // resolved after subcats load

            // Store raw subcat name in a temp field we resolve below
            const resolvedSubcat = catID
              ? (subcatsByCat[catID] ?? []).find(s => s.name.toLowerCase() === subcatName.toLowerCase())?.id ?? ''
              : '';
            patch.subCategoryID = resolvedSubcat;

            if (pIdx < next.length) {
              next[pIdx] = { ...next[pIdx], ...patch, saveStatus: null, errors: {} };
            } else {
              next.push({ ...emptyProduct(), ...patch });
            }
          });
          return next;
        });
        toast({ title: `Pasted ${rows.length} product${rows.length > 1 ? 's' : ''}`, description: 'Review and add variation details.' });
      }
    };

    el.addEventListener('paste', handlePaste);
    return () => el.removeEventListener('paste', handlePaste);
  }, [categories, subcatsByCat, toast]);

  /* lazy-load subcategories */
  useEffect(() => {
    const needed = new Set(products.map(p => p.categoryID).filter(Boolean));
    const unsubs: Array<() => void> = [];
    needed.forEach(catId => {
      if (!subcatsByCat[catId]) {
        const unsub = CategoryService.listenSubcategories(catId, (subs: any[]) =>
          setSubcatsByCat(prev => ({ ...prev, [catId]: subs.map((s: any) => ({ id: s.id, name: s.name })) }))
        );
        unsubs.push(unsub);
      }
    });
    return () => unsubs.forEach(u => u());
  }, [products, subcatsByCat]);

  /* mutations */
  const updP = (i: number, patch: Partial<Product>) =>
    setProducts(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch, saveStatus: null } : p));

  const updV = (pIdx: number, vIdx: number, patch: Partial<Variation>) =>
    setProducts(prev => prev.map((p, i) =>
      i !== pIdx ? p : { ...p, saveStatus: null, variations: p.variations.map((v, j) => j === vIdx ? { ...v, ...patch } : v) }
    ));

  const addProduct     = () => setProducts(prev => [...prev, emptyProduct()]);
  const removeProduct  = (i: number) => setProducts(prev => prev.filter((_, idx) => idx !== i));
  const addVariation   = (pIdx: number) =>
    setProducts(prev => prev.map((p, i) =>
      i === pIdx ? { ...p, expanded: true, variations: [...p.variations, emptyVar()] } : p
    ));
  const removeVariation = (pIdx: number, vIdx: number) =>
    setProducts(prev => prev.map((p, i) =>
      i !== pIdx ? p : { ...p, variations: p.variations.filter((_, j) => j !== vIdx) }
    ));
  const toggleExpand   = (i: number) =>
    setProducts(prev => prev.map((p, idx) => idx === i ? { ...p, expanded: !p.expanded } : p));

  /* save all as draft */
  const saveAllAsDraft = async () => {
    if (!sellerId) { toast({ title: 'Error', description: 'No seller ID', variant: 'destructive' }); return; }
    const validated = validateAll(products);
    if (validated.some(hasErrors)) {
      setProducts(validated);
      toast({ title: 'Validation failed', description: 'Fix fields highlighted in red', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const updated = [...validated];
    for (let i = 0; i < updated.length; i++) {
      const p = updated[i];
      try {
        const now = Date.now();
        const brandImageURL   = await uploadIfFile(p.brandImgFile, `products/${sellerId}/brand/${now}_${p.brandImgFile?.name || 'brand'}`);
        const productImageURL = await uploadIfFile(p.prodImgFile,  `products/${sellerId}/${now}_${p.prodImgFile?.name || 'product'}`);
        const { id: productId } = await ProductService.createProduct({
          sellerId, brand: p.brand, brandImage: brandImageURL || null,
          name: p.name, description: p.description,
          categoryID: p.categoryID, subCategoryID: p.subCategoryID || '',
          imageURL: productImageURL || '', status: 'draft',
          dangerousGoods: (p.dangerousGoods && p.dangerousGoods !== 'none') ? 'dangerous' : 'none',
          warrantyType: p.warrantyType || null,
          warrantyDuration: p.warrantyDuration ? `${p.warrantyDuration} month` : null,
          warrantyPolicy: p.warrantyPolicy || null,
        } as any);
        const vars = await Promise.all(p.variations.map(async v => {
          const varImgURL = await uploadIfFile(v.imgFile, `products/${sellerId}/variations/${Date.now()}_${v.imgFile?.name || 'var'}`);
          return {
            name: v.name, sku: v.sku, price: Number(v.price) || 0, imageURL: varImgURL || null,
            weight: v.weight ? Number(v.weight) : null, weightUnit: 'g',
            dimensions: { length: v.length ? Number(v.length) : null, width: v.width ? Number(v.width) : null, height: v.height ? Number(v.height) : null },
            dimensionsUnit: 'cm', pcsPerBox: v.pcsPerBox ? Number(v.pcsPerBox) : null,
          };
        }));
        if (vars.length) await ProductService.addVariations(productId, vars);
        updated[i] = { ...p, saveStatus: { ok: true, msg: `Saved (${productId.slice(0, 6)}…)` } };
      } catch (e: any) {
        updated[i] = { ...p, saveStatus: { ok: false, msg: e?.message || 'Save failed' }, expanded: true };
      }
      setProducts([...updated]);
    }
    setSaving(false);
    const ok  = updated.filter(p => p.saveStatus?.ok).length;
    const bad = updated.filter(p => p.saveStatus && !p.saveStatus.ok).length;
    toast({ title: 'Done', description: `${ok} saved as draft${bad ? `, ${bad} failed` : ''}` });
  };

  const goBack = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'items-list');
    window.history.pushState({}, '', url.pathname + url.search);
    window.dispatchEvent(new Event('popstate'));
  };

  /* ── Shared helper: fetch subcats for a list of category IDs not yet in state ── */
  const fetchMissingSubcats = (catIds: string[]): Promise<Record<string, Array<{ id: string; name: string }>>> =>
    new Promise(resolve => {
      const missing = catIds.filter(id => !subcatsByCat[id]);
      if (missing.length === 0) { resolve({}); return; }
      const result: Record<string, Array<{ id: string; name: string }>> = {};
      let done = 0;
      missing.forEach(catId => {
        const unsub = CategoryService.listenSubcategories(catId, subs => {
          result[catId] = subs.map(s => ({ id: s.id, name: s.name }));
          unsub();
          if (++done === missing.length) resolve(result);
        });
      });
    });

  /* ── Download Excel Template ── */
  const downloadTemplate = async () => {
    // Pre-fetch all subcategories so we can put them in the dropdown lists
    const fetched = await fetchMissingSubcats(categories.map(c => c.id));
    const allSubcats: Record<string, Array<{ id: string; name: string }>> = { ...subcatsByCat, ...fetched };
    if (Object.keys(fetched).length) setSubcatsByCat(prev => ({ ...prev, ...fetched }));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');

    const tealFill: ExcelJS.Fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    const indigoFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    const whiteFg = { argb: 'FFFFFFFF' };

    const colDefs = [
      { header: 'Brand *',                     key: 'brand',            width: 16, fill: tealFill },
      { header: 'Product Name *',              key: 'name',             width: 22, fill: tealFill },
      { header: 'Description',                key: 'description',      width: 28, fill: tealFill },
      { header: 'Category *',                 key: 'category',         width: 18, fill: tealFill },
      { header: 'Subcategory *',              key: 'subcategory',      width: 18, fill: tealFill },
      { header: 'Dangerous Goods',            key: 'dangerousGoods',   width: 18, fill: tealFill },
      { header: 'Warranty Type *',            key: 'warrantyType',     width: 24, fill: tealFill },
      { header: 'Warranty Duration (months)', key: 'warrantyDuration', width: 24, fill: tealFill },
      { header: 'Warranty Policy',            key: 'warrantyPolicy',   width: 22, fill: tealFill },
      { header: 'Variation Name *',           key: 'varName',          width: 18, fill: indigoFill },
      { header: 'SKU *',                      key: 'sku',              width: 14, fill: indigoFill },
      { header: 'Price *',                    key: 'price',            width: 10, fill: indigoFill },
      { header: 'Pcs/Box *',                  key: 'pcsPerBox',        width: 10, fill: indigoFill },
      { header: 'Weight (g) *',               key: 'weight',           width: 12, fill: indigoFill },
      { header: 'Length (cm) *',              key: 'length',           width: 12, fill: indigoFill },
      { header: 'Width (cm) *',               key: 'width',            width: 12, fill: indigoFill },
      { header: 'Height (cm) *',              key: 'height',           width: 12, fill: indigoFill },
    ];

    ws.columns = colDefs.map(c => ({ header: c.header, key: c.key, width: c.width }));
    const hRow = ws.getRow(1);
    hRow.height = 22;
    colDefs.forEach((c, i) => {
      const cell = hRow.getCell(i + 1);
      cell.fill = c.fill;
      cell.font = { bold: true, color: whiteFg, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

    // Example row (update with a real category from the live list if possible)
    const exCat    = categories[0]?.name ?? 'Consumables';
    const exSubcat = (allSubcats[categories[0]?.id] ?? [])[0]?.name ?? 'Bonding Agents';
    ws.addRow({
      brand: 'DentalCo', name: 'Dental Mirror', description: 'High quality stainless steel mirror',
      category: exCat, subcategory: exSubcat, dangerousGoods: 'none',
      warrantyType: 'local_manufacturer', warrantyDuration: 12, warrantyPolicy: '1-year warranty',
      varName: 'Standard', sku: 'SKU-001', price: 250, pcsPerBox: 10,
      weight: 150, length: 20, width: 10, height: 5,
    });

    /* ── _Lists hidden sheet for dropdown data ── */
    const wsList = wb.addWorksheet('_Lists');
    wsList.state = 'veryHidden';

    // Column A: category names
    categories.forEach((c, i) => { wsList.getCell(i + 1, 1).value = c.name; });
    const catCount = categories.length || 1;

    // Column B: all subcategory names (flat, de-duped, sorted)
    const allSubcatNames = [...new Set(
      categories.flatMap(c => (allSubcats[c.id] ?? []).map(s => s.name))
    )].sort((a, b) => a.localeCompare(b));
    allSubcatNames.forEach((name, i) => { wsList.getCell(i + 1, 2).value = name; });
    const subcatCount = allSubcatNames.length || 1;

    // Columns C+: per-category subcategory lists (for per-category grouping reference)
    categories.forEach((c, ci) => {
      const subs = allSubcats[c.id] ?? [];
      wsList.getCell(1, ci + 3).value = c.name; // header
      subs.forEach((s, si) => { wsList.getCell(si + 2, ci + 3).value = s.name; });
    });

    /* ── Data Validations ── */
    const MAX_ROWS = 500;

    // Column D → Category dropdown
    ws.dataValidations.add(`D2:D${MAX_ROWS}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`_Lists!$A$1:$A$${catCount}`],
      showErrorMessage: true,
      errorTitle: 'Invalid category',
      error: 'Please select a category from the dropdown list.',
    });

    // Column E → Subcategory dropdown (all subcats flat list)
    if (subcatCount > 0) {
      ws.dataValidations.add(`E2:E${MAX_ROWS}`, {
        type: 'list',
        allowBlank: true,
        formulae: [`_Lists!$B$1:$B$${subcatCount}`],
        showErrorMessage: false,
      });
    }

    // Column F → Dangerous Goods dropdown
    ws.dataValidations.add(`F2:F${MAX_ROWS}`, {
      type: 'list',
      allowBlank: true,
      formulae: ['"none,battery,flammable,liquid"'],
    });

    // Column G → Warranty Type dropdown
    ws.dataValidations.add(`G2:G${MAX_ROWS}`, {
      type: 'list',
      allowBlank: true,
      formulae: ['"local_manufacturer,international_manufacturer,local_supplier,local_supplier_refund,no_warranty,international_seller"'],
    });

    /* ── Valid Values reference sheet ── */
    const ws2 = wb.addWorksheet('Valid Values');
    ws2.columns = [
      { header: 'Field', key: 'field', width: 28 },
      { header: 'Valid Values', key: 'values', width: 60 },
    ];
    ws2.getRow(1).eachCell(cell => { cell.font = { bold: true }; });
    [
      ['Dangerous Goods', 'none | battery | flammable | liquid'],
      ['Warranty Type', 'local_manufacturer | international_manufacturer | local_supplier | local_supplier_refund | no_warranty | international_seller'],
      ['', ''],
      ['Note', 'Each row = 1 product with 1 variation. To add more variations to the same product, upload first then click "+ Add Variation" in the table.'],
    ].forEach(([field, values]) => ws2.addRow({ field, values }));

    // Also list categories + subcategories for reference
    ws2.addRow({});
    ws2.addRow({ field: 'CATEGORIES & SUBCATEGORIES', values: '' });
    const catLabelRow = ws2.lastRow;
    if (catLabelRow) catLabelRow.getCell(1).font = { bold: true };
    categories.forEach(c => {
      const subs = (allSubcats[c.id] ?? []).map(s => s.name).join(' | ') || '(no subcategories)';
      ws2.addRow({ field: c.name, values: subs });
    });

    const buf = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      'dentpal_bulk_items_template.xlsx',
    );
  };

  /* ── Upload Excel ── */
  const handleExcelUpload = async (file: File) => {
    try {
      const arrayBuf = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(arrayBuf as unknown as Buffer);
      const ws = wb.getWorksheet('Products') || wb.worksheets[0];
      if (!ws) {
        toast({ title: 'Error', description: 'Could not find a Products sheet in the file.', variant: 'destructive' });
        return;
      }

      const cv = (row: ExcelJS.Row, col: number): string => {
        const cell = row.getCell(col);
        const v = cell.value;
        if (v === null || v === undefined) return '';
        if (typeof v === 'object' && 'richText' in (v as any))
          return (v as any).richText.map((r: any) => r.text).join('');
        return String(v).trim();
      };

      // ── Pass 1: collect raw row data & resolve category IDs ──
      type RawRow = { rowNum: number; cols: string[]; catID: string; catName: string; subcatName: string };
      const rawRows: RawRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const cols = Array.from({ length: 17 }, (_, i) => cv(row, i + 1));
        const [brandVal, nameVal] = [cols[0], cols[1]];
        if (!brandVal && !nameVal) return;
        const catName  = cols[3];
        const catMatch = categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
        rawRows.push({ rowNum, cols, catID: catMatch?.id ?? '', catName, subcatName: cols[4] });
      });

      if (rawRows.length === 0) {
        toast({ title: 'No data', description: 'No product rows found in the file.', variant: 'destructive' });
        return;
      }

      // ── Pre-fetch subcategories for any category IDs not yet in state ──
      const uniqueCatIds = [...new Set(rawRows.map(r => r.catID).filter(Boolean))];
      const freshSubcats = await fetchMissingSubcats(uniqueCatIds);
      const resolvedSubcats: Record<string, Array<{ id: string; name: string }>> = {
        ...subcatsByCat,
        ...freshSubcats,
      };
      if (Object.keys(freshSubcats).length)
        setSubcatsByCat(prev => ({ ...prev, ...freshSubcats }));

      // ── Pass 2: build Product objects now that subcats are loaded ──
      const imported: Product[] = rawRows.map(({ cols, catID, catName, subcatName }) => {
        const subcatID = catID
          ? (resolvedSubcats[catID] ?? []).find(s => s.name.toLowerCase() === subcatName.toLowerCase())?.id ?? ''
          : '';

        const rowErrors: Record<string, string> = {
          ...(catID    ? {} : catName    ? { categoryID:    `Unknown category: "${catName}"` }    : {}),
          ...(subcatID ? {} : subcatName && catID
            ? { subCategoryID: `Unknown subcategory: "${subcatName}"` } : {}),
        };

        return {
          ...emptyProduct(),
          brand: cols[0], name: cols[1], description: cols[2],
          categoryID: catID, subCategoryID: subcatID,
          dangerousGoods: cols[5] || 'none',
          warrantyType: cols[6], warrantyDuration: cols[7], warrantyPolicy: cols[8],
          errors: rowErrors,
          variations: [{
            ...emptyVar(),
            name: cols[9], sku: cols[10], price: cols[11],
            pcsPerBox: cols[12], weight: cols[13],
            length: cols[14], width: cols[15], height: cols[16],
          }],
        };
      });

      setProducts(imported);
      toast({
        title: `Imported ${imported.length} product${imported.length !== 1 ? 's' : ''}`,
        description: 'Only 1 variation per product was imported. Add more variations directly in the table.',
      });
    } catch (e: any) {
      toast({ title: 'Import failed', description: e?.message || 'Could not parse the Excel file.', variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-col gap-3" ref={containerRef}>

      {/* Page header */}
      <div className="flex items-center justify-between">
        <button onClick={goBack}
          className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition">
          ← Back to Item List
        </button>
        <h2 className="text-base font-semibold text-gray-800">Items – Bulk Item</h2>
        <div className="w-36" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={addProduct}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition shadow-sm">
          <Plus className="w-3.5 h-3.5" /> Add Product
        </button>
        <button onClick={saveAllAsDraft} disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 disabled:opacity-50 transition shadow-sm">
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save All as Draft'}
        </button>
        <button onClick={() => setShowGuide(g => !g)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition border border-blue-200">
          <ClipboardPaste className="w-3.5 h-3.5" /> Paste from Excel
          <Info className="w-3 h-3 opacity-60" />
        </button>
        <button onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-semibold hover:bg-green-100 transition border border-green-200">
          <Download className="w-3.5 h-3.5" /> Download Template
        </button>
        <button onClick={() => xlsxInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-xs font-semibold hover:bg-purple-100 transition border border-purple-200">
          <Upload className="w-3.5 h-3.5" /> Upload Excel
        </button>
        <input
          ref={xlsxInputRef} type="file" accept=".xlsx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleExcelUpload(f); e.target.value = ''; }}
        />
      </div>

      {/* ── Excel paste guide panel ── */}
      {showGuide && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-bold text-sm flex items-center gap-2">
              <ClipboardPaste className="w-4 h-4" /> How to paste from Excel
            </p>
            <button onClick={() => setShowGuide(false)} className="text-blue-400 hover:text-blue-700 text-base leading-none">✕</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Product columns */}
            <div>
              <p className="font-semibold mb-1 text-teal-700">📋 Product rows — click any product cell, then paste</p>
              <table className="w-full border border-blue-200 rounded overflow-hidden text-[10px]">
                <thead className="bg-teal-700 text-white">
                  <tr>
                    <th className="px-2 py-1 text-left">Col</th>
                    <th className="px-2 py-1 text-left">Field</th>
                    <th className="px-2 py-1 text-left">Example</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['A','Brand','DentalCo'],
                    ['B','Product Name','Dental Mirror'],
                    ['C','Description','High quality…'],
                    ['D','Category','Consumables'],
                    ['E','Subcategory','Bonding Agents'],
                    ['F','Dangerous Goods','none'],
                    ['G','Warranty Type','local_manufacturer'],
                    ['H','Duration (months)','12'],
                    ['I','Warranty Policy','1-year warranty'],
                  ].map(([col, field, ex]) => (
                    <tr key={col} className="border-t border-blue-100 odd:bg-white even:bg-blue-50/60">
                      <td className="px-2 py-0.5 font-mono font-bold text-teal-700">{col}</td>
                      <td className="px-2 py-0.5">{field}</td>
                      <td className="px-2 py-0.5 text-gray-500 italic">{ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Variation columns */}
            <div>
              <p className="font-semibold mb-1 text-indigo-700">📋 Variation rows — click any variation cell, then paste</p>
              <table className="w-full border border-blue-200 rounded overflow-hidden text-[10px]">
                <thead className="bg-indigo-700 text-white">
                  <tr>
                    <th className="px-2 py-1 text-left">Col</th>
                    <th className="px-2 py-1 text-left">Field</th>
                    <th className="px-2 py-1 text-left">Example</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['A','Variation Name','Small / Blue'],
                    ['B','SKU','SKU-001'],
                    ['C','Price','250'],
                    ['D','Pcs/Box','10'],
                    ['E','Weight (g)','150'],
                    ['F','Length (cm)','20'],
                    ['G','Width (cm)','10'],
                    ['H','Height (cm)','5'],
                  ].map(([col, field, ex]) => (
                    <tr key={col} className="border-t border-blue-100 odd:bg-white even:bg-blue-50/60">
                      <td className="px-2 py-0.5 font-mono font-bold text-indigo-700">{col}</td>
                      <td className="px-2 py-0.5">{field}</td>
                      <td className="px-2 py-0.5 text-gray-500 italic">{ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-blue-200 rounded-lg p-2.5 text-[11px] space-y-1 text-gray-600">
            <p>💡 <strong>Tips:</strong></p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>Select and copy multiple rows in Excel — each row will fill one product or one variation.</li>
              <li>Click <strong>inside any text field</strong> in the product row before pasting to set the starting row.</li>
              <li>For variations: expand the product first, click inside a variation field, then paste.</li>
              <li>Category &amp; Subcategory must match existing names exactly (case-insensitive).</li>
              <li>Dangerous Goods values: <code className="bg-gray-100 px-1 rounded">none</code> · <code className="bg-gray-100 px-1 rounded">battery</code> · <code className="bg-gray-100 px-1 rounded">flammable</code> · <code className="bg-gray-100 px-1 rounded">liquid</code></li>
              <li>Warranty Type values: <code className="bg-gray-100 px-1 rounded">local_manufacturer</code> · <code className="bg-gray-100 px-1 rounded">no_warranty</code> · etc.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ═══════════════ PRODUCT TABLE ═══════════════ */}
      <div className="overflow-x-auto rounded-lg shadow-sm border border-gray-300">
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: 980 }} className="text-[11px]">

          <colgroup>
            <col style={{ width: 28 }} />   {/* # */}
            <col style={{ width: 26 }} />   {/* expand */}
            <col style={{ width: 50 }} />                    {/* brand img */}
            <col style={{ width: '9%', minWidth: 80 }} />   {/* brand */}
            <col style={{ width: 50 }} />                    {/* prod img */}
            <col style={{ width: '12%' }} />                 {/* name */}
            <col style={{ width: '16%' }} />{/* description */}
            <col style={{ width: '10%' }} />{/* category */}
            <col style={{ width: '10%' }} />{/* subcategory */}
            <col style={{ width: '9%' }} /> {/* dg */}
            <col style={{ width: '11%' }} />{/* warranty type */}
            <col style={{ width: 58 }} />   {/* duration */}
            <col style={{ width: '10%' }} />{/* policy */}
            <col style={{ width: 60 }} />   {/* actions */}
          </colgroup>

          {/* Zone banner */}
          <thead>
            <tr>
              <th colSpan={2} className="border border-gray-400 bg-gray-700 py-1" />
              <th colSpan={11} className="border border-gray-400 bg-teal-700 text-white text-center py-1 text-[10px] font-bold tracking-widest uppercase">
                Product Information
              </th>
              <th className="border border-gray-400 bg-gray-700 py-1" />
            </tr>
            {/* Column labels */}
            <tr className="bg-gray-100 text-gray-600 font-semibold">
              <th className={`${cellBase} py-1.5 px-1 text-center`}>#</th>
              <th className={`${cellBase} py-1.5 px-1`} />
              <th className={`${cellBase} py-1.5 px-1`}>Brand Img<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Brand<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Prod Img<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Product Name<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Description<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Category<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Subcategory<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Dangerous Goods<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Warranty Type<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Dur(mo)<R /></th>
              <th className={`${cellBase} py-1.5 px-1`}>Policy<R /></th>
              <th className={`${cellBase} py-1.5 px-1 text-center`}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={PRODUCT_COL_COUNT}
                  className="border border-gray-300 text-center text-gray-400 py-10 text-xs">
                  No products yet. Click "Add Product" to begin.
                </td>
              </tr>
            )}

            {products.map((p, pIdx) => {
              const subs = subcatsByCat[p.categoryID] || [];
              const pe   = p.errors;
              const rowBg = p.saveStatus?.ok
                ? 'bg-green-50'
                : Object.keys(pe).length > 0 ? 'bg-red-50/60' : 'bg-teal-50/50';

              return (
                <React.Fragment key={p.id}>

                  {/* ── PRODUCT ROW ── */}
                  <tr className={rowBg} data-paste-zone="product" data-product-idx={pIdx}>
                    <td className={`${cellBase} text-center text-gray-500 font-mono py-1 font-semibold`}>{pIdx + 1}</td>
                    <td className={`${cellBase} text-center py-1`}>
                      <button onClick={() => toggleExpand(pIdx)} title={p.expanded ? 'Collapse variations' : 'Expand variations'}
                        className="text-teal-600 hover:text-teal-800">
                        {p.expanded
                          ? <ChevronDown className="w-3.5 h-3.5 mx-auto" />
                          : <ChevronRight className="w-3.5 h-3.5 mx-auto" />}
                      </button>
                    </td>
                    <td className={`${cellBase} p-0.5 align-middle`}>
                      <ImgUpload preview={p.brandImgPreview} size={36}
                        onFile={f => updP(pIdx, { brandImgFile: f, brandImgPreview: URL.createObjectURL(f) })} />
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.brand ? 'border-red-400' : ''}`}>
                      <input value={p.brand} placeholder="Brand name"
                        onChange={e => updP(pIdx, { brand: e.target.value })}
                        className={inputCls(pe.brand)} />
                    </td>
                    <td className={`${cellBase} p-0.5 align-middle`}>
                      <ImgUpload preview={p.prodImgPreview} size={36}
                        onFile={f => updP(pIdx, { prodImgFile: f, prodImgPreview: URL.createObjectURL(f) })} />
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.name ? 'border-red-400' : ''}`}>
                      <input value={p.name} placeholder="Product name"
                        onChange={e => updP(pIdx, { name: e.target.value })}
                        className={inputCls(pe.name)} />
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.description ? 'border-red-400' : ''}`}>
                      <textarea value={p.description} placeholder="Description" rows={2}
                        onChange={e => updP(pIdx, { description: e.target.value })}
                        className={`w-full bg-transparent border-0 outline-none text-[11px] px-1.5 py-0.5 resize-none focus:ring-1 focus:ring-inset focus:ring-teal-400 ${pe.description ? 'ring-1 ring-inset ring-red-400 bg-red-50' : ''}`} />
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.categoryID ? 'border-red-400' : ''}`}>
                      <select value={p.categoryID} onChange={e => updP(pIdx, { categoryID: e.target.value, subCategoryID: '' })}
                        className={selectCls(pe.categoryID)}>
                        <option value="">Select…</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.subCategoryID ? 'border-red-400' : ''}`}>
                      <select value={p.subCategoryID} disabled={!p.categoryID}
                        onChange={e => updP(pIdx, { subCategoryID: e.target.value })}
                        className={selectCls(pe.subCategoryID)}>
                        <option value="">Select…</option>
                        {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.dangerousGoods ? 'border-red-400' : ''}`}>
                      <select value={p.dangerousGoods} onChange={e => updP(pIdx, { dangerousGoods: e.target.value })}
                        className={selectCls(pe.dangerousGoods)}>
                        {DG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.warrantyType ? 'border-red-400' : ''}`}>
                      <select value={p.warrantyType} onChange={e => updP(pIdx, { warrantyType: e.target.value })}
                        className={selectCls(pe.warrantyType)}>
                        {WR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.warrantyDuration ? 'border-red-400' : ''}`}>
                      <input type="number" value={p.warrantyDuration} placeholder="0"
                        onChange={e => updP(pIdx, { warrantyDuration: e.target.value })}
                        className={inputCls(pe.warrantyDuration)} />
                    </td>
                    <td className={`${cellBase} p-0 align-middle ${pe.warrantyPolicy ? 'border-red-400' : ''}`}>
                      <input value={p.warrantyPolicy} placeholder="Policy…"
                        onChange={e => updP(pIdx, { warrantyPolicy: e.target.value })}
                        className={inputCls(pe.warrantyPolicy)} />
                    </td>
                    <td className={`${cellBase} py-1 px-1 text-center align-middle`}>
                      <div className="flex items-center justify-center gap-1.5">
                        {p.saveStatus?.ok  && <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
                        {p.saveStatus?.ok === false && <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                        <button onClick={() => removeProduct(pIdx)} title="Delete product"
                          className="text-red-400 hover:text-red-600 flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {p.saveStatus && (
                        <div className={`text-[9px] mt-0.5 leading-tight ${p.saveStatus.ok ? 'text-green-600' : 'text-red-600'}`}>
                          {p.saveStatus.msg}
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* ── VARIATION PANEL (expanded inline) ── */}
                  {p.expanded && (
                    <tr>
                      <td colSpan={PRODUCT_COL_COUNT}
                        className="border-x border-b border-gray-300 bg-gray-50 p-0">

                        {/* Indent wrapper with left accent */}
                        <div className="border-l-4 border-indigo-400 ml-6 mr-2 my-2 rounded-md overflow-hidden shadow-sm">

                          {/* Variation sub-table */}
                          <table style={{ borderCollapse: 'collapse', width: '100%' }} className="text-[11px]">

                            {/* Variation zone banner */}
                            <thead>
                              <tr>
                                <th colSpan={11}
                                  className="border border-indigo-400 bg-indigo-700 text-white text-center py-1 text-[10px] font-bold tracking-widest uppercase">
                                  Variation Details — Product {pIdx + 1}: {p.name || '(unnamed)'}
                                </th>
                              </tr>
                              <tr className="bg-indigo-50 text-indigo-800 font-semibold">
                                <th className="border border-indigo-200 py-1.5 px-1 w-6 text-center">#</th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-10">Img<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1">Variation Name<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-20">SKU<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-16">Price<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-14">Pcs/Box<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-16">Wt (g)<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-14">L (cm)<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-14">W (cm)<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-14">H (cm)<R /></th>
                                <th className="border border-indigo-200 py-1.5 px-1 w-8 text-center"></th>
                              </tr>
                            </thead>

                            <tbody>
                              {p.variations.length === 0 && (
                                <tr>
                                  <td colSpan={11} className="border border-indigo-200 text-center text-gray-400 py-5 text-xs bg-white">
                                    No variations yet. Click <strong>"+ Add Variation"</strong> below.
                                  </td>
                                </tr>
                              )}

                              {p.variations.map((v, vIdx) => {
                                const ve = v.errors;
                                const vBg = Object.keys(ve).length > 0 ? 'bg-red-50/60' : vIdx % 2 === 0 ? 'bg-white' : 'bg-indigo-50/30';
                                return (
                                  <tr key={v.id} className={vBg} data-paste-zone="variation" data-product-idx={pIdx} data-variation-idx={vIdx}>
                                    <td className="border border-indigo-200 text-center text-gray-500 font-mono py-1 text-[10px] w-6">
                                      {vIdx + 1}
                                    </td>
                                    <td className="border border-indigo-200 p-0.5 align-middle w-10">
                                      <ImgUpload preview={v.imgPreview} size={32}
                                        onFile={f => updV(pIdx, vIdx, { imgFile: f, imgPreview: URL.createObjectURL(f) })} />
                                    </td>
                                                    <td className={`border p-0 align-middle ${ve.name ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input value={v.name} placeholder="e.g. Small / Blue"
                                        onChange={e => updV(pIdx, vIdx, { name: e.target.value })}
                                        className={inputCls(ve.name)} />
                                    </td>
                                    <td className={`border p-0 align-middle w-20 ${ve.sku ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input value={v.sku} placeholder="SKU-001"
                                        onChange={e => updV(pIdx, vIdx, { sku: e.target.value })}
                                        className={inputCls(ve.sku)} />
                                    </td>
                                    <td className={`border p-0 align-middle w-16 ${ve.price ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input type="number" value={v.price} placeholder="0.00"
                                        onChange={e => updV(pIdx, vIdx, { price: e.target.value })}
                                        className={inputCls(ve.price)} />
                                    </td>
                                    <td className={`border p-0 align-middle w-14 ${ve.pcsPerBox ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input type="number" value={v.pcsPerBox} placeholder="0"
                                        onChange={e => updV(pIdx, vIdx, { pcsPerBox: e.target.value })}
                                        className={inputCls(ve.pcsPerBox)} />
                                    </td>
                                    <td className={`border p-0 align-middle w-16 ${ve.weight ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input type="number" value={v.weight} placeholder="0"
                                        onChange={e => updV(pIdx, vIdx, { weight: e.target.value })}
                                        className={inputCls(ve.weight)} />
                                    </td>
                                    <td className={`border p-0 align-middle w-14 ${ve.length ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input type="number" value={v.length} placeholder="0"
                                        onChange={e => updV(pIdx, vIdx, { length: e.target.value })}
                                        className={inputCls(ve.length)} />
                                    </td>
                                    <td className={`border p-0 align-middle w-14 ${ve.width ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input type="number" value={v.width} placeholder="0"
                                        onChange={e => updV(pIdx, vIdx, { width: e.target.value })}
                                        className={inputCls(ve.width)} />
                                    </td>
                                    <td className={`border p-0 align-middle w-14 ${ve.height ? 'border-red-400' : 'border-indigo-200'}`}>
                                      <input type="number" value={v.height} placeholder="0"
                                        onChange={e => updV(pIdx, vIdx, { height: e.target.value })}
                                        className={inputCls(ve.height)} />
                                    </td>
                                    <td className="border border-indigo-200 py-1 px-1 text-center align-middle w-8">
                                      <button onClick={() => removeVariation(pIdx, vIdx)}
                                        className="text-red-400 hover:text-red-600" title="Remove variation">
                                        <Trash2 className="w-3.5 h-3.5 mx-auto" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>

                            {/* Add Variation footer row */}
                            <tfoot>
                              <tr>
                                <td colSpan={11} className="border border-dashed border-indigo-300 bg-indigo-50/60 py-1.5 px-3">
                                  <button onClick={() => addVariation(pIdx)}
                                    className="inline-flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900 text-[11px] font-semibold">
                                    <Plus className="w-3.5 h-3.5" />
                                    Add Variation
                                    {p.errors._noVar && (
                                      <span className="ml-2 text-red-500 font-normal">{p.errors._noVar}</span>
                                    )}
                                  </button>
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>

                      </td>
                    </tr>
                  )}

                  {/* Separator between products */}
                  <tr><td colSpan={PRODUCT_COL_COUNT} className="h-px bg-gray-300 p-0" /></tr>

                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed">
        All products saved from this page are stored as <strong>drafts</strong>.
        Complete and submit for admin QC review from the Draft tab.
      </p>
    </div>
  );
};

export default BulkAddItems;
