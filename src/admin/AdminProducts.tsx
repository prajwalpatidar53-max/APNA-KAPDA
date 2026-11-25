import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Database,
  Edit3,
  ImagePlus,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Product, ProductCategory } from '../types';
import { ADMIN_EASE, AdminTableSkeleton } from './AdminMotion';
import {
  deleteAdminProduct,
  saveAdminProduct,
  seedStarterCatalogAdmin,
  toggleProductActiveAdmin,
  uploadProductImages,
} from './adminService';

interface AdminProductsProps {
  products: Product[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}

const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', 'Free Size'];
const COLOR_PRESETS = [
  { name: 'Ivory', hex: '#f4efe6' },
  { name: 'Sand', hex: '#d8cbb8' },
  { name: 'Charcoal', hex: '#262420' },
  { name: 'Terracotta', hex: '#9a6746' },
  { name: 'Espresso', hex: '#4a3527' },
  { name: 'Indigo', hex: '#2c3e55' },
  { name: 'Olive', hex: '#5b6248' },
  { name: 'Ecru', hex: '#e8e0cf' },
  { name: 'Onyx', hex: '#141413' },
];
const GARMENT_TYPES = [
  'T-Shirts',
  'Shirts',
  'Tops',
  'Bottomwear',
  'Denim',
  'Dresses',
  'Kurtas',
  'Outerwear',
];

interface ProductFormState {
  id?: string;
  slug?: string;
  name: string;
  category: ProductCategory;
  garment_type: string;
  price_inr: string;
  compare_at_price_inr: string;
  tag: string;
  stock_count: string;
  sizes: string[];
  colors: string[];
  fabric_care: string;
  description: string;
  gallery_images: string[];
  is_active: boolean;
}

const EMPTY_FORM: ProductFormState = {
  name: '',
  category: 'Unisex',
  garment_type: 'T-Shirts',
  price_inr: '',
  compare_at_price_inr: '',
  tag: 'NEW DROP',
  stock_count: '20',
  sizes: ['S', 'M', 'L', 'XL'],
  colors: ['Ivory', 'Charcoal'],
  fabric_care: '100% Breathable Indian Cotton · Gentle Cold Wash',
  description: '',
  gallery_images: [],
  is_active: true,
};

export function AdminProducts({
  products,
  loading,
  onRefresh,
}: AdminProductsProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'All' | ProductCategory>('All');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [customSize, setCustomSize] = useState('');
  const [customColor, setCustomColor] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [uploadingImages, setUploadingImages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = categoryFilter === 'All' || p.category === categoryFilter;
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && p.is_active) ||
        (statusFilter === 'inactive' && !p.is_active);
      const matchQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.garment_type.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q);
      return matchCat && matchStatus && matchQuery;
    });
  }, [products, search, categoryFilter, statusFilter]);

  const openCreateModal = () => {
    setForm(EMPTY_FORM);
    setCustomSize('');
    setCustomColor('');
    setImageUrlInput('');
    setFeedback(null);
    setModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    const gallery =
      Array.isArray(product.gallery_images) && product.gallery_images.length > 0
        ? product.gallery_images
        : product.image_url
          ? [product.image_url]
          : [];

    setForm({
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      garment_type: product.garment_type,
      price_inr: String(product.price_inr),
      compare_at_price_inr: product.compare_at_price_inr
        ? String(product.compare_at_price_inr)
        : '',
      tag: product.tag || 'NEW DROP',
      stock_count: String(product.stock_count),
      sizes: Array.isArray(product.sizes) ? product.sizes.map((s) => s.trim()).filter(Boolean) : [],
      colors: Array.isArray(product.colors) ? product.colors : [],
      fabric_care: product.fabric_care || '',
      description: product.description || '',
      gallery_images: gallery,
      is_active: product.is_active,
    });
    setCustomSize('');
    setCustomColor('');
    setImageUrlInput('');
    setFeedback(null);
    setModalOpen(true);
  };

  const toggleSize = (size: string) => {
    setForm((prev) => ({
      ...prev,
      sizes: prev.sizes.includes(size)
        ? prev.sizes.filter((s) => s !== size)
        : [...prev.sizes, size],
    }));
  };

  const addCustomSize = () => {
    const clean = customSize.trim().toUpperCase();
    if (!clean) return;
    if (!form.sizes.includes(clean)) {
      setForm((prev) => ({ ...prev, sizes: [...prev.sizes, clean] }));
    }
    setCustomSize('');
  };

  const toggleColor = (colorName: string) => {
    setForm((prev) => ({
      ...prev,
      colors: prev.colors.includes(colorName)
        ? prev.colors.filter((c) => c !== colorName)
        : [...prev.colors, colorName],
    }));
  };

  const addCustomColor = () => {
    const clean = customColor.trim();
    if (!clean) return;
    if (!form.colors.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      setForm((prev) => ({ ...prev, colors: [...prev.colors, clean] }));
    }
    setCustomColor('');
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingImages(true);
    setFeedback(null);

    const res = await uploadProductImages(Array.from(files));
    setUploadingImages(false);

    if (res.urls.length > 0) {
      setForm((prev) => ({
        ...prev,
        gallery_images: [...prev.gallery_images, ...res.urls],
      }));
    }
    if (res.error) {
      setFeedback({ type: 'err', text: res.error });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAddImageUrl = () => {
    const clean = imageUrlInput.trim();
    if (!clean) return;
    if (!form.gallery_images.includes(clean)) {
      setForm((prev) => ({
        ...prev,
        gallery_images: [...prev.gallery_images, clean],
      }));
    }
    setImageUrlInput('');
  };

  const setAsCoverImage = (idx: number) => {
    if (idx === 0) return;
    setForm((prev) => {
      const next = [...prev.gallery_images];
      const [selected] = next.splice(idx, 1);
      return { ...prev, gallery_images: [selected, ...next] };
    });
  };

  const removeGalleryImage = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      gallery_images: prev.gallery_images.filter((_, i) => i !== idx),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const validSizes = form.sizes.map((s) => s.trim()).filter(Boolean);
    if (validSizes.length === 0) {
      setFeedback({
        type: 'err',
        text: 'Select at least one garment size before saving.',
      });
      return;
    }

    if (form.gallery_images.length === 0) {
      setFeedback({
        type: 'err',
        text: 'Upload at least one product image or add an image URL before saving.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const res = await saveAdminProduct({
      id: form.id,
      slug: form.slug,
      name: form.name,
      description: form.description,
      category: form.category,
      garment_type: form.garment_type,
      price_inr: Number(form.price_inr),
      compare_at_price_inr: form.compare_at_price_inr
        ? Number(form.compare_at_price_inr)
        : null,
      tag: form.tag,
      fabric_care: form.fabric_care,
      sizes: form.sizes,
      colors: form.colors,
      stock_count: Number(form.stock_count),
      gallery_images: form.gallery_images,
      is_active: form.is_active,
    });

    setSaving(false);

    if (res.error) {
      setFeedback({ type: 'err', text: res.error });
      return;
    }

    await onRefresh();
    setModalOpen(false);
    if (res.warning) {
      setFeedback({ type: 'warn', text: res.warning });
    } else {
      setFeedback({
        type: 'ok',
        text: form.id
          ? `Updated "${form.name}". Changes are live on the storefront.`
          : `Published "${form.name}" to the storefront catalog.`,
      });
    }
  };

  const handleToggleActive = async (product: Product) => {
    const res = await toggleProductActiveAdmin(product.id, !product.is_active);
    if (res.error) {
      setFeedback({ type: 'err', text: res.error });
      return;
    }
    await onRefresh();
  };

  const handleDelete = async (product: Product) => {
    setDeletingId(product.id);
    const res = await deleteAdminProduct(product.id);
    setDeletingId(null);

    if (res.error) {
      setFeedback({ type: 'err', text: res.error });
      return;
    }
    setFeedback({ type: 'ok', text: `Deleted "${product.name}".` });
    await onRefresh();
  };

  const handleSeedStarter = async () => {
    setSeeding(true);
    setFeedback(null);
    const res = await seedStarterCatalogAdmin();
    setSeeding(false);
    if (res.error) {
      setFeedback({ type: 'err', text: res.error });
      return;
    }
    setFeedback({
      type: 'ok',
      text: `Synced ${res.count ?? 0} APNA KAPDA starter garments into Supabase.`,
    });
    await onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, type, slug..."
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as 'All' | ProductCategory)
            }
            aria-label="Filter by category"
            className="px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100"
          >
            <option value="All">All Categories</option>
            <option value="Men">Men</option>
            <option value="Women">Women</option>
            <option value="Unisex">Unisex</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')
            }
            aria-label="Filter by active status"
            className="px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {products.length === 0 && (
            <button
              type="button"
              disabled={seeding}
              onClick={handleSeedStarter}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/[0.1] bg-white/[0.04] text-slate-200 text-xs font-medium hover:bg-white/[0.08] transition-colors cursor-pointer disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5 text-teal-400" />
              <span>{seeding ? 'Syncing...' : 'Seed Starter Catalog'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs border ${
            feedback.type === 'err'
              ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
              : feedback.type === 'warn'
                ? 'bg-amber-500/10 border-amber-400/25 text-amber-200'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Product Inventory Table */}
      <div className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] overflow-hidden">
        {loading ? (
          <AdminTableSkeleton rows={6} />
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-semibold text-white">
              No products in view
            </p>
            <p className="text-xs text-slate-400 mt-1.5">
              Add a new piece or seed the starter catalog to populate your
              Supabase products table.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.07] bg-white/[0.02] text-[11px] font-medium text-slate-400">
                  <th className="py-3.5 px-5">Product</th>
                  <th className="py-3.5 px-3">Category</th>
                  <th className="py-3.5 px-3">Sizes &amp; Colours</th>
                  <th className="py-3.5 px-3 text-right">Price</th>
                  <th className="py-3.5 px-3 text-right">Stock</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {filteredProducts.map((product) => {
                  const galleryCount = product.gallery_images?.length || 1;
                  return (
                    <tr
                      key={product.id}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          <div className="w-11 h-14 rounded-lg bg-[#16202e] border border-white/[0.07] overflow-hidden shrink-0">
                            <img
                              src={product.image_url}
                              alt={product.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-white truncate">
                              {product.name}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {galleryCount}{' '}
                              {galleryCount === 1 ? 'image' : 'images'} &middot;{' '}
                              {product.tag}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <p className="font-medium text-slate-200">
                          {product.category}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {product.garment_type}
                        </p>
                      </td>

                      <td className="py-3.5 px-3">
                        <p className="text-[11px] text-slate-200">
                          {product.sizes.join(', ')}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {product.colors && product.colors.length > 0
                            ? product.colors.join(', ')
                            : 'Default colour'}
                        </p>
                      </td>

                      <td className="py-3.5 px-3 text-right whitespace-nowrap tabular-nums">
                        <p className="font-semibold text-white">
                          {formatINR(product.price_inr)}
                        </p>
                        {product.compare_at_price_inr &&
                          product.compare_at_price_inr > product.price_inr && (
                            <p className="text-[11px] text-slate-500 line-through">
                              {formatINR(product.compare_at_price_inr)}
                            </p>
                          )}
                      </td>

                      <td className="py-3.5 px-3 text-right whitespace-nowrap tabular-nums">
                        <span
                          className={`font-semibold ${
                            product.stock_count === 0
                              ? 'text-rose-400'
                              : product.stock_count <= 5
                                ? 'text-amber-300'
                                : 'text-slate-100'
                          }`}
                        >
                          {product.stock_count}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(product)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-colors ${
                            product.is_active
                              ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/12'
                              : 'border-white/[0.1] text-slate-400 bg-white/[0.04]'
                          }`}
                        >
                          {product.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>

                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(product)}
                            aria-label={`Edit ${product.name}`}
                            className="p-2 rounded-lg border border-white/[0.09] text-slate-300 hover:text-white hover:border-amber-400/40 hover:bg-white/[0.06] transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === product.id}
                            onClick={() => handleDelete(product)}
                            aria-label={`Delete ${product.name}`}
                            className="p-2 rounded-lg border border-white/[0.09] text-slate-400 hover:text-rose-300 hover:border-rose-500/40 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Product Modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => setModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ duration: 0.24, ease: ADMIN_EASE }}
              className="rounded-2xl bg-[#0e1520] border border-white/[0.1] w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 bg-[#0e1520]/95 backdrop-blur-md px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-amber-400">
                    {form.id ? 'Edit Inventory Item' : 'New Catalog Piece'}
                  </p>
                  <h2 className="font-sans text-xl font-semibold text-white mt-0.5">
                    {form.id ? form.name || 'Update Product' : 'Add Product'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="Close modal"
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-6">
                {/* Basic Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Product Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="e.g. Handloom Linen Overshirt"
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white placeholder:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Category *
                    </label>
                    <select
                      value={form.category}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          category: e.target.value as ProductCategory,
                        }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white"
                    >
                      <option value="Men">Men</option>
                      <option value="Women">Women</option>
                      <option value="Unisex">Unisex</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Garment Type *
                    </label>
                    <input
                      type="text"
                      required
                      list="apna-garment-types"
                      value={form.garment_type}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, garment_type: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white"
                    />
                    <datalist id="apna-garment-types">
                      {GARMENT_TYPES.map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Selling Price (INR ₹) *
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={form.price_inr}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, price_inr: e.target.value }))
                      }
                      placeholder="1899"
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Compare-At Price (INR ₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={form.compare_at_price_inr}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          compare_at_price_inr: e.target.value,
                        }))
                      }
                      placeholder="Optional MRP"
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Stock Quantity (Manual) *
                    </label>
                    <input
                      type="number"
                      required
                      min={0}
                      value={form.stock_count}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, stock_count: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Collection Tag
                    </label>
                    <input
                      type="text"
                      value={form.tag}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, tag: e.target.value }))
                      }
                      placeholder="BESTSELLER / NEW DROP"
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white"
                    />
                  </div>
                </div>

                {/* Sizes */}
                <div className="pt-4 border-t border-white/[0.08]">
                  <label className="block text-xs font-medium text-slate-300 mb-2.5">
                    Available Sizes
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set([...SIZE_PRESETS, ...form.sizes])).map(
                      (size) => {
                        const active = form.sizes.includes(size);
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => toggleSize(size)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${
                              active
                                ? 'bg-amber-500 text-slate-950 border-amber-500'
                                : 'bg-white/[0.03] text-slate-300 border-white/[0.1] hover:border-white/[0.25]'
                            }`}
                          >
                            {size}
                          </button>
                        );
                      }
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 max-w-xs">
                    <input
                      type="text"
                      value={customSize}
                      onChange={(e) => setCustomSize(e.target.value)}
                      placeholder="Add custom size..."
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-[#080d14] border border-white/[0.1] text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={addCustomSize}
                      className="px-3.5 py-1.5 rounded-lg border border-white/[0.15] text-xs font-medium text-slate-200 hover:bg-white/[0.08] cursor-pointer transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Colours */}
                <div className="pt-4 border-t border-white/[0.08]">
                  <label className="block text-xs font-medium text-slate-300 mb-2.5">
                    Available Colours
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_PRESETS.map((preset) => {
                      const active = form.colors.includes(preset.name);
                      return (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() => toggleColor(preset.name)}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                            active
                              ? 'bg-amber-500 text-slate-950 border-amber-500 font-medium'
                              : 'bg-white/[0.03] text-slate-300 border-white/[0.1] hover:border-white/[0.25]'
                          }`}
                        >
                          <span
                            style={{ backgroundColor: preset.hex }}
                            className="w-3 h-3 rounded-sm border border-black/20 shrink-0"
                          />
                          <span>{preset.name}</span>
                        </button>
                      );
                    })}
                    {form.colors
                      .filter((c) => !COLOR_PRESETS.some((p) => p.name === c))
                      .map((custom) => (
                        <button
                          key={custom}
                          type="button"
                          onClick={() => toggleColor(custom)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-500 text-slate-950 border border-amber-500 font-medium cursor-pointer"
                        >
                          <span>{custom}</span>
                          <X className="w-3 h-3" />
                        </button>
                      ))}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 max-w-xs">
                    <input
                      type="text"
                      value={customColor}
                      onChange={(e) => setCustomColor(e.target.value)}
                      placeholder="Add custom colour (e.g. Haldi)..."
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-[#080d14] border border-white/[0.1] text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={addCustomColor}
                      className="px-3.5 py-1.5 rounded-lg border border-white/[0.15] text-xs font-medium text-slate-200 hover:bg-white/[0.08] cursor-pointer transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Multi-Image Storage Uploader & Gallery */}
                <div className="pt-4 border-t border-white/[0.08]">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <label className="text-xs font-medium text-slate-300">
                      Product Images (First image is the storefront cover) *
                    </label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImages}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/[0.12] text-xs font-medium text-slate-100 hover:bg-white/[0.1] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        {uploadingImages ? 'Uploading...' : 'Upload to Storage'}
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      multiple
                      onChange={(e) => handleFilesSelected(e.target.files)}
                      className="hidden"
                    />
                  </div>

                  {form.gallery_images.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      {form.gallery_images.map((url, idx) => (
                        <div
                          key={`${url}-${idx}`}
                          className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 flex flex-col gap-2"
                        >
                          <div className="aspect-[3/4] rounded-lg bg-[#16202e] overflow-hidden relative">
                            <img
                              src={url}
                              alt={`Product preview ${idx + 1}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            {idx === 0 && (
                              <span className="absolute top-1.5 left-1.5 rounded bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-semibold">
                                Cover
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <button
                              type="button"
                              onClick={() => setAsCoverImage(idx)}
                              disabled={idx === 0}
                              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-40 cursor-pointer"
                            >
                              <Star className="w-3 h-3" />
                              <span>{idx === 0 ? 'Primary' : 'Make Cover'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeGalleryImage(idx)}
                              aria-label="Remove image"
                              className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-xl border border-dashed border-white/[0.16] bg-white/[0.02] py-8 px-4 text-center cursor-pointer hover:border-amber-400/50 transition-colors mb-3"
                    >
                      <ImagePlus className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                      <p className="text-xs font-medium text-white">
                        Click to upload multiple product images
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        JPG, PNG, WebP, or AVIF up to 5 MB each (Supabase bucket
                        &ldquo;product-images&rdquo;)
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      placeholder="Or paste an image URL / asset path..."
                      className="flex-1 px-3 py-2 rounded-xl text-xs bg-[#080d14] border border-white/[0.1] outline-none text-white placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddImageUrl}
                      className="px-3.5 py-2 rounded-xl border border-white/[0.15] text-xs font-medium text-slate-200 hover:bg-white/[0.08] cursor-pointer transition-colors"
                    >
                      Add URL
                    </button>
                  </div>
                </div>

                {/* Fabric & Description */}
                <div className="grid grid-cols-1 gap-4 pt-4 border-t border-white/[0.08]">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Fabric &amp; Care
                    </label>
                    <input
                      type="text"
                      value={form.fabric_care}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, fabric_care: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Editorial Description
                    </label>
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      placeholder="Describe silhouette, drape, weave, and styling notes..."
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-[#080d14] border border-white/[0.1] focus:border-amber-400/60 outline-none text-white placeholder:text-slate-500"
                    />
                  </div>

                  <label className="inline-flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, is_active: e.target.checked }))
                      }
                      className="w-4 h-4 accent-amber-500"
                    />
                    <span>Active and visible on the APNA KAPDA storefront</span>
                  </label>
                </div>

                {feedback && modalOpen && feedback.type === 'err' && (
                  <p className="text-xs text-rose-200 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3">
                    {feedback.text}
                  </p>
                )}

                <div className="pt-4 border-t border-white/[0.08] flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl border border-white/[0.1] text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || uploadingImages}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      {saving
                        ? 'Saving...'
                        : form.id
                          ? 'Save Changes'
                          : 'Publish Product'}
                    </span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
