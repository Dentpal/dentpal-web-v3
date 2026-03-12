import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FolderTree, Plus, Pencil, Trash2, Search, Upload, X } from 'lucide-react';
import CategoryService, { Category, Subcategory } from '@/services/category';
import imageCompression from 'browser-image-compression';

const toTitle = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/(^|\s)\S/g, (t) => t.toUpperCase());

const CategoryManager: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // Subcategories for selected category
  const [subs, setSubs] = useState<Subcategory[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  // Dialogs
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [editCatOpen, setEditCatOpen] = useState<null | Category>(null);
  const [deleteCatOpen, setDeleteCatOpen] = useState<null | Category>(null);
  const [catName, setCatName] = useState('');
  const [catImageFile, setCatImageFile] = useState<File | null>(null);
  const [catImagePreview, setCatImagePreview] = useState<string>('');
  const catFileInputRef = useRef<HTMLInputElement>(null);

  const [addSubOpen, setAddSubOpen] = useState(false);
  const [editSubOpen, setEditSubOpen] = useState<null | Subcategory>(null);
  const [deleteSubOpen, setDeleteSubOpen] = useState<null | Subcategory>(null);
  const [subName, setSubName] = useState('');
  const [subImageFile, setSubImageFile] = useState<File | null>(null);
  const [subImagePreview, setSubImagePreview] = useState<string>('');
  const subFileInputRef = useRef<HTMLInputElement>(null);

  // Loading states
  const [addCatLoading, setAddCatLoading] = useState(false);
  const [editCatLoading, setEditCatLoading] = useState(false);
  const [addSubLoading, setAddSubLoading] = useState(false);
  const [editSubLoading, setEditSubLoading] = useState(false);

  useEffect(() => {
    const unsub = CategoryService.listenCategories((rows) => {
      setCategories(rows);
      setLoading(false);
      if (!selectedId && rows.length) setSelectedId(rows[0].id);
    }, (err) => {
      console.error('Failed to load categories', err);
      setLoading(false);
      toast({ title: 'Failed to load categories', description: 'Please check your Firestore rules and collection name "Category".', variant: 'destructive' });
    });
    return () => unsub();
  }, []);

  // Load subcategories when selection changes
  useEffect(() => {
    if (!selectedId) { setSubs([]); return; }
    setSubsLoading(true);
    const unsub = CategoryService.listenSubcategories(selectedId, (rows) => {
      setSubs(rows);
      setSubsLoading(false);
    }, (err) => {
      console.error('Failed to load subcategories', err);
      setSubs([]);
      setSubsLoading(false);
    });
    return () => unsub();
  }, [selectedId]);

  const filteredCategories = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(t));
  }, [categories, filter]);

  const openAddCategory = () => { setCatName(''); setCatImageFile(null); setCatImagePreview(''); setAddCatOpen(true); };
  const openEditCategory = (c: Category) => { 
    setCatName(c.name); 
    setCatImageFile(null);
    setCatImagePreview(c.imageURL || '');
    setEditCatOpen(c); 
  };
  const openDeleteCategory = (c: Category) => { setDeleteCatOpen(c); };

  const handleCatImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (catImagePreview && catImagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(catImagePreview);
      }
      setCatImageFile(file);
      setCatImagePreview(URL.createObjectURL(file));
    }
  };

  const removeCatImage = () => {
    if (catImagePreview && catImagePreview.startsWith('blob:')) {
      URL.revokeObjectURL(catImagePreview);
    }
    setCatImageFile(null);
    setCatImagePreview('');
    if (catFileInputRef.current) catFileInputRef.current.value = '';
  };

  const confirmAddCategory = async () => {
    const name = toTitle(catName);
    if (!name) {
      toast({ title: 'Validation Error', description: 'Category name is required.', variant: 'destructive' });
      return;
    }
    setAddCatLoading(true);
    try {
      let imageURL: string | undefined;
      if (catImageFile) {
        const compressed = await imageCompression(catImageFile, { 
          maxSizeMB: 0.3, 
          maxWidthOrHeight: 400, 
          useWebWorker: true,
          initialQuality: 0.8
        });
        const tempId = Date.now().toString();
        imageURL = await CategoryService.uploadCategoryImage(compressed, tempId);
      }
      await CategoryService.addCategory(name, imageURL);
      setAddCatOpen(false);
      toast({ title: 'Category added', description: `${name} created.` });
    } catch (e: any) {
      toast({ title: 'Failed to add category', description: e.message || 'Try again.', variant: 'destructive' });
    } finally {
      setAddCatLoading(false);
    }
  };

  const confirmEditCategory = async () => {
    const c = editCatOpen; if (!c) return;
    const name = toTitle(catName);
    if (!name) {
      toast({ title: 'Validation Error', description: 'Category name is required.', variant: 'destructive' });
      return;
    }
    setEditCatLoading(true);
    try {
      let imageURL: string | undefined = catImagePreview || undefined;
      if (catImageFile) {
        const compressed = await imageCompression(catImageFile, { 
          maxSizeMB: 0.3, 
          maxWidthOrHeight: 400, 
          useWebWorker: true,
          initialQuality: 0.8
        });
        imageURL = await CategoryService.uploadCategoryImage(compressed, c.id);
      }
      await CategoryService.updateCategory(c.id, name, imageURL);
      setEditCatOpen(null);
      toast({ title: 'Category updated', description: `${name} saved.` });
    } catch (e: any) {
      toast({ title: 'Failed to update category', description: e.message || 'Try again.', variant: 'destructive' });
    } finally {
      setEditCatLoading(false);
    }
  };

  const confirmDeleteCategory = async () => {
    const c = deleteCatOpen; if (!c) return;
    try {
      await CategoryService.deleteCategory(c.id);
      setDeleteCatOpen(null);
      if (selectedId === c.id) setSelectedId(null);
      toast({ title: 'Category deleted', description: `${c.name} removed.` });
    } catch (e: any) {
      toast({ title: 'Failed to delete category', description: e.message || 'Try again.', variant: 'destructive' });
    }
  };

  const openAddSub = () => { setSubName(''); setSubImageFile(null); setSubImagePreview(''); setAddSubOpen(true); };
  const openEditSub = (s: Subcategory) => { 
    setSubName(s.name); 
    setSubImageFile(null);
    setSubImagePreview(s.imageURL || '');
    setEditSubOpen(s); 
  };
  const openDeleteSub = (s: Subcategory) => { setDeleteSubOpen(s); };

  const handleSubImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSubImageFile(file);
      setSubImagePreview(URL.createObjectURL(file));
    }
  };

  const removeSubImage = () => {
    setSubImageFile(null);
    setSubImagePreview('');
    if (subFileInputRef.current) subFileInputRef.current.value = '';
  };

  const confirmAddSub = async () => {
    if (!selectedId) return;
    const name = toTitle(subName);
    if (!name) {
      toast({ title: 'Validation Error', description: 'Subcategory name is required.', variant: 'destructive' });
      return;
    }
    setAddSubLoading(true);
    try {
      let imageURL: string | undefined;
      if (subImageFile) {
        const compressed = await imageCompression(subImageFile, { 
          maxSizeMB: 0.3, 
          maxWidthOrHeight: 400, 
          useWebWorker: true,
          initialQuality: 0.8
        });
        const tempId = Date.now().toString();
        imageURL = await CategoryService.uploadSubcategoryImage(compressed, selectedId, tempId);
      }
      await CategoryService.addSubcategory(selectedId, name, imageURL);
      setAddSubOpen(false);
      toast({ title: 'Subcategory added', description: `${name} created.` });
    } catch (e: any) {
      toast({ title: 'Failed to add subcategory', description: e.message || 'Try again.', variant: 'destructive' });
    } finally {
      setAddSubLoading(false);
    }
  };

  const confirmEditSub = async () => {
    const s = editSubOpen; if (!s || !selectedId) return;
    const name = toTitle(subName);
    if (!name) {
      toast({ title: 'Validation Error', description: 'Subcategory name is required.', variant: 'destructive' });
      return;
    }
    setEditSubLoading(true);
    try {
      let imageURL: string | undefined = subImagePreview || undefined;
      if (subImageFile) {
        const compressed = await imageCompression(subImageFile, { 
          maxSizeMB: 0.3, 
          maxWidthOrHeight: 400, 
          useWebWorker: true,
          initialQuality: 0.8
        });
        imageURL = await CategoryService.uploadSubcategoryImage(compressed, selectedId, s.id);
      }
      await CategoryService.updateSubcategory(selectedId, s.id, name, imageURL);
      setEditSubOpen(null);
      toast({ title: 'Subcategory updated', description: `${name} saved.` });
    } catch (e: any) {
      toast({ title: 'Failed to update subcategory', description: e.message || 'Try again.', variant: 'destructive' });
    } finally {
      setEditSubLoading(false);
    }
  };

  const confirmDeleteSub = async () => {
    const s = deleteSubOpen; if (!s || !selectedId) return;
    try {
      await CategoryService.deleteSubcategory(selectedId, s.id);
      setDeleteSubOpen(null);
      toast({ title: 'Subcategory deleted', description: `${s.name} removed.` });
    } catch (e: any) {
      toast({ title: 'Failed to delete subcategory', description: e.message || 'Try again.', variant: 'destructive' });
    }
  };

  const selectedCategory = categories.find(c => c.id === selectedId) || null;

  return (
    <div className="space-y-6">
     

      {/* Main content: two tables */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Categories table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-0 overflow-hidden">
          <div className="p-4 border-b flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input value={filter} onChange={(e)=> setFilter(e.target.value)} placeholder="Search category..." className="pl-9" />
            </div>
            <Button
        onClick={openAddCategory}
        className="bg-green-600 hover:bg-green-700 text-white"> New Category
            </Button>

          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Icon</th>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                ) : filteredCategories.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">No categories found</td></tr>
                ) : (
                  filteredCategories.map((c) => (
                    <tr key={c.id} className={`hover:bg-gray-50 cursor-pointer ${selectedId===c.id? 'bg-gray-50' : ''}`}
                        onClick={()=> setSelectedId(c.id)}>
                      <td className="px-4 py-2">
                        {c.imageURL ? (
                          <img src={c.imageURL} alt={c.name} className="w-8 h-8 object-cover rounded" />
                        ) : (
                          <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-gray-400 text-xs">
                            <FolderTree className="w-4 h-4" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">{c.name}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={(e)=> { e.stopPropagation(); openEditCategory(c); }}><Pencil className="w-4 h-4"/></Button>
                          <Button variant="ghost" size="sm" onClick={(e)=> { e.stopPropagation(); openDeleteCategory(c); }} className="text-red-600 hover:text-red-800"><Trash2 className="w-4 h-4"/></Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Subcategories table */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-0 overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">{selectedCategory ? selectedCategory.name : 'Subcategories'}</div>
              <div className="text-xs text-gray-500">{selectedCategory ? 'Subcategories under this category' : 'Select a category to manage its subcategories'}</div>
            </div>
            <Button onClick={openAddSub} disabled={!selectedCategory} className="bg-green-600 hover:bg-green-700 text-white">New Subcategory</Button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Icon</th>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!selectedCategory ? (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-500">Select a category to manage its subcategories</td></tr>
                ) : subsLoading ? (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-500">Loading…</td></tr>
                ) : subs.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-500">No subcategories</td></tr>
                ) : (
                  subs.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2">
                        {s.imageURL ? (
                          <img src={s.imageURL} alt={s.name} className="w-8 h-8 object-cover rounded" />
                        ) : (
                          <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-gray-400 text-xs">
                            <FolderTree className="w-4 h-4" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">{s.name}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={()=> openEditSub(s)}><Pencil className="w-4 h-4"/></Button>
                          <Button variant="ghost" size="sm" onClick={()=> openDeleteSub(s)} className="text-red-600 hover:text-red-800"><Trash2 className="w-4 h-4"/></Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Category */}
      <Dialog open={addCatOpen} onOpenChange={setAddCatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Category</DialogTitle>
            <DialogDescription>Create a new top-level category</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Category Name</label>
              <Input autoFocus value={catName} onChange={(e)=> setCatName(e.target.value)} placeholder="e.g. Orthodontics" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Icon Image (Optional)</label>
              <input
                type="file"
                accept="image/*"
                ref={catFileInputRef}
                onChange={handleCatImageChange}
                className="hidden"
              />
              {catImagePreview ? (
                <div className="relative inline-block">
                  <img src={catImagePreview} alt="Preview" className="w-24 h-24 object-cover rounded border" />
                  <button
                    type="button"
                    onClick={removeCatImage}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => catFileInputRef.current?.click()}
                  className="w-full"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Icon
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setAddCatOpen(false)} disabled={addCatLoading}>Cancel</Button>
            <Button onClick={confirmAddCategory} className="bg-green-600 hover:bg-green-700 text-white" disabled={addCatLoading}>
              {addCatLoading ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Category */}
      <Dialog open={!!editCatOpen} onOpenChange={(o)=> !o && setEditCatOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription>Rename this category and update its icon</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Category Name</label>
              <Input autoFocus value={catName} onChange={(e)=> setCatName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Icon Image</label>
              <input
                type="file"
                accept="image/*"
                ref={catFileInputRef}
                onChange={handleCatImageChange}
                className="hidden"
              />
              {catImagePreview ? (
                <div className="relative inline-block">
                  <img src={catImagePreview} alt="Preview" className="w-24 h-24 object-cover rounded border" />
                  <button
                    type="button"
                    onClick={removeCatImage}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => catFileInputRef.current?.click()}
                  className="w-full"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Icon
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setEditCatOpen(null)} disabled={editCatLoading}>Cancel</Button>
            <Button onClick={confirmEditCategory} className="bg-green-600 hover:bg-green-700 text-white" disabled={editCatLoading}>
              {editCatLoading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category */}
      <Dialog open={!!deleteCatOpen} onOpenChange={(o)=> !o && setDeleteCatOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
            <DialogDescription>This will also delete all its subcategories. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setDeleteCatOpen(null)}>Cancel</Button>
            <Button onClick={confirmDeleteCategory} className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Subcategory */}
      <Dialog open={addSubOpen} onOpenChange={setAddSubOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Subcategory</DialogTitle>
            <DialogDescription>Add a subcategory under {selectedCategory?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Subcategory Name</label>
              <Input autoFocus value={subName} onChange={(e)=> setSubName(e.target.value)} placeholder="e.g. Brackets" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Icon Image (Optional)</label>
              <input
                type="file"
                accept="image/*"
                ref={subFileInputRef}
                onChange={handleSubImageChange}
                className="hidden"
              />
              {subImagePreview ? (
                <div className="relative inline-block">
                  <img src={subImagePreview} alt="Preview" className="w-24 h-24 object-cover rounded border" />
                  <button
                    type="button"
                    onClick={removeSubImage}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => subFileInputRef.current?.click()}
                  className="w-full"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Icon
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setAddSubOpen(false)} disabled={addSubLoading}>Cancel</Button>
            <Button onClick={confirmAddSub} className="bg-green-600 hover:bg-green-700 text-white" disabled={addSubLoading}>
              {addSubLoading ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Subcategory */}
      <Dialog open={!!editSubOpen} onOpenChange={(o)=> !o && setEditSubOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Subcategory</DialogTitle>
            <DialogDescription>Rename this subcategory and update its icon</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Subcategory Name</label>
              <Input autoFocus value={subName} onChange={(e)=> setSubName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Icon Image</label>
              <input
                type="file"
                accept="image/*"
                ref={subFileInputRef}
                onChange={handleSubImageChange}
                className="hidden"
              />
              {subImagePreview ? (
                <div className="relative inline-block">
                  <img src={subImagePreview} alt="Preview" className="w-24 h-24 object-cover rounded border" />
                  <button
                    type="button"
                    onClick={removeSubImage}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => subFileInputRef.current?.click()}
                  className="w-full"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Icon
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setEditSubOpen(null)} disabled={editSubLoading}>Cancel</Button>
            <Button onClick={confirmEditSub} className="bg-green-600 hover:bg-green-700 text-white" disabled={editSubLoading}>
              {editSubLoading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Subcategory */}
      <Dialog open={!!deleteSubOpen} onOpenChange={(o)=> !o && setDeleteSubOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Subcategory</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setDeleteSubOpen(null)}>Cancel</Button>
            <Button onClick={confirmDeleteSub} className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CategoryManager;
