import { useMemo, useRef, useState } from 'react';
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
      sizes: product.sizes.length ? product.sizes : ['S', 'M', 'L', 'XL'],
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
      <div className="bg-[#fffdf8] border border-[#e5dfd3] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#817b70] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, type, slug..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as 'All' | ProductCategory)
            }
            aria-label="Filter by category"
            className="px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
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
            className="px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
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
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#e5dfd3] bg-[#f5f2eb] text-[#211f1b] text-[10px] tracking-[0.16em] uppercase font-semibold hover:border-[#24231f] transition-colors cursor-pointer disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{seeding ? 'Syncing...' : 'Seed Starter Catalog'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.18em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 text-xs border ${
            feedback.type === 'err'
              ? 'bg-[#fef2f2] border-[#fecaca] text-[#b91c1c]'
              : feedback.type === 'warn'
                ? 'bg-[#fffbeb] border-[#fde68a] text-[#92400e]'
                : 'bg-[#ecfdf5] border-[#a7f3d0] text-[#2b6345]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Product Inventory Table */}
      <div className="bg-[#fffdf8] border border-[#e5dfd3] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-[#817b70]">
            Loading catalog from Supabase...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-serif-display text-2xl text-[#211f1b]">
              No products in view
            </p>
            <p className="text-xs text-[#817b70] mt-1.5">
              Add a new piece or seed the starter catalog to populate your
              Supabase products table.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e5dfd3] bg-[#f5f2eb]/50 text-[10px] tracking-[0.16em] uppercase text-[#817b70]">
                  <th className="py-3.5 px-4 font-semibold">Product</th>
                  <th className="py-3.5 px-3 font-semibold">Category</th>
                  <th className="py-3.5 px-3 font-semibold">Sizes &amp; Colours</th>
                  <th className="py-3.5 px-3 font-semibold text-right">Price</th>
                  <th className="py-3.5 px-3 font-semibold text-right">Stock</th>
                  <th className="py-3.5 px-3 font-semibold">Status</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5dfd3] text-xs">
                {filteredProducts.map((product) => {
                  const galleryCount = product.gallery_images?.length || 1;
                  return (
                    <tr
                      key={product.id}
                      className="hover:bg-[#f5f2eb]/40 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          <div className="w-11 h-14 bg-[#e9e3d8] overflow-hidden shrink-0">
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-[#211f1b] truncate">
                              {product.name}
                            </p>
                            <p className="text-[11px] text-[#817b70] mt-0.5">
                              {galleryCount}{' '}
                              {galleryCount === 1 ? 'image' : 'images'} &middot;{' '}
                              {product.tag}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <p className="font-medium text-[#211f1b]">
                          {product.category}
                        </p>
                        <p className="text-[11px] text-[#817b70]">
                          {product.garment_type}
                        </p>
                      </td>

                      <td className="py-3.5 px-3">
                        <p className="text-[11px] text-[#211f1b]">
                          {product.sizes.join(', ')}
                        </p>
                        <p className="text-[11px] text-[#817b70] mt-0.5">
                          {product.colors && product.colors.length > 0
                            ? product.colors.join(', ')
                            : 'Default colour'}
                        </p>
                      </td>

                      <td className="py-3.5 px-3 text-right whitespace-nowrap tabular-nums">
                        <p className="font-semibold text-[#211f1b]">
                          {formatINR(product.price_inr)}
                        </p>
                        {product.compare_at_price_inr &&
                          product.compare_at_price_inr > product.price_inr && (
                            <p className="text-[10px] text-[#817b70] line-through">
                              {formatINR(product.compare_at_price_inr)}
                            </p>
                          )}
                      </td>

                      <td className="py-3.5 px-3 text-right whitespace-nowrap tabular-nums">
                        <span
                          className={`font-semibold ${
                            product.stock_count === 0
                              ? 'text-[#b91c1c]'
                              : product.stock_count <= 5
                                ? 'text-[#9a6746]'
                                : 'text-[#211f1b]'
                          }`}
                        >
                          {product.stock_count}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(product)}
                          className={`px-2.5 py-1 text-[10px] tracking-[0.12em] uppercase font-semibold border cursor-pointer transition-colors ${
                            product.is_active
                              ? 'border-[#2b6345] text-[#2b6345] bg-[#ecfdf5]'
                              : 'border-[#d6cfc2] text-[#817b70] bg-[#f5f2eb]'
                          }`}
                        >
                          {product.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(product)}
                            aria-label={`Edit ${product.name}`}
                            className="p-2 border border-[#e5dfd3] text-[#211f1b] hover:border-[#24231f] hover:bg-[#f5f2eb] transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === product.id}
                            onClick={() => handleDelete(product)}
                            aria-label={`Delete ${product.name}`}
                            className="p-2 border border-[#e5dfd3] text-[#817b70] hover:text-[#b91c1c] hover:border-[#fecaca] hover:bg-[#fef2f2] transition-colors cursor-pointer disabled:opacity-40"
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
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-[#fffdf8] border border-[#e5dfd3] w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-[#fffdf8] px-6 py-4 border-b border-[#e5dfd3] flex items-center justify-between">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                  {form.id ? 'Edit Inventory Item' : 'New Catalog Piece'}
                </p>
                <h2 className="font-serif-display text-2xl text-[#211f1b]">
                  {form.id ? form.name || 'Update Product' : 'Add Product'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-2 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-6">
              {/* Basic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
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
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
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
                    className="w-full px-3.5 py-2.5 text-sm bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                  >
                    <option value="Men">Men</option>
                    <option value="Women">Women</option>
                    <option value="Unisex">Unisex</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
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
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                  />
                  <datalist id="apna-garment-types">
                    {GARMENT_TYPES.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
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
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b] tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
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
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b] tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
                    Stock Quantity *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={form.stock_count}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, stock_count: e.target.value }))
                    }
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b] tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
                    Collection Tag
                  </label>
                  <input
                    type="text"
                    value={form.tag}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, tag: e.target.value }))
                    }
                    placeholder="BESTSELLER / NEW DROP"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                  />
                </div>
              </div>

              {/* Sizes */}
              <div className="pt-4 border-t border-[#e5dfd3]">
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-2.5">
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
                          className={`px-3 py-1.5 text-xs font-medium border cursor-pointer transition-colors ${
                            active
                              ? 'bg-[#24231f] text-white border-[#24231f]'
                              : 'bg-transparent text-[#211f1b] border-[#e5dfd3] hover:border-[#24231f]'
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
                    className="flex-1 px-3 py-1.5 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] outline-none"
                  />
                  <button
                    type="button"
                    onClick={addCustomSize}
                    className="px-3 py-1.5 border border-[#24231f] text-[10px] tracking-[0.14em] uppercase font-semibold cursor-pointer hover:bg-[#24231f] hover:text-white transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Colours */}
              <div className="pt-4 border-t border-[#e5dfd3]">
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-2.5">
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
                        className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs border cursor-pointer transition-colors ${
                          active
                            ? 'bg-[#24231f] text-white border-[#24231f]'
                            : 'bg-[#fffdf8] text-[#211f1b] border-[#e5dfd3] hover:border-[#24231f]'
                        }`}
                      >
                        <span
                          style={{ backgroundColor: preset.hex }}
                          className="w-3 h-3 border border-black/15 shrink-0"
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
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#24231f] text-white border border-[#24231f] cursor-pointer"
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
                    className="flex-1 px-3 py-1.5 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] outline-none"
                  />
                  <button
                    type="button"
                    onClick={addCustomColor}
                    className="px-3 py-1.5 border border-[#24231f] text-[10px] tracking-[0.14em] uppercase font-semibold cursor-pointer hover:bg-[#24231f] hover:text-white transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Multi-Image Storage Uploader & Gallery */}
              <div className="pt-4 border-t border-[#e5dfd3]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <label className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f]">
                    Product Images (First image is the storefront cover) *
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImages}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#f5f2eb] border border-[#24231f] text-[10px] tracking-[0.14em] uppercase font-semibold text-[#211f1b] hover:bg-[#24231f] hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
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
                        className="border border-[#e5dfd3] bg-[#f5f2eb]/50 p-2 flex flex-col gap-2"
                      >
                        <div className="aspect-[3/4] bg-[#e9e3d8] overflow-hidden relative">
                          <img
                            src={url}
                            alt={`Product preview ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {idx === 0 && (
                            <span className="absolute top-1.5 left-1.5 bg-[#24231f] text-white px-2 py-0.5 text-[9px] tracking-[0.14em] uppercase font-semibold">
                              Cover
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => setAsCoverImage(idx)}
                            disabled={idx === 0}
                            className="inline-flex items-center gap-1 text-[10px] text-[#5f594f] hover:text-[#211f1b] disabled:opacity-40 cursor-pointer"
                          >
                            <Star className="w-3 h-3" />
                            <span>{idx === 0 ? 'Primary' : 'Make Cover'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeGalleryImage(idx)}
                            aria-label="Remove image"
                            className="text-[10px] text-[#b91c1c] hover:underline cursor-pointer"
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
                    className="border border-dashed border-[#c8bfae] bg-[#f5f2eb]/40 py-8 px-4 text-center cursor-pointer hover:border-[#9a6746] transition-colors mb-3"
                  >
                    <ImagePlus className="w-6 h-6 text-[#9a6746] mx-auto mb-2" />
                    <p className="text-xs font-medium text-[#211f1b]">
                      Click to upload multiple product images
                    </p>
                    <p className="text-[11px] text-[#817b70] mt-1">
                      JPG, PNG, WebP, or AVIF up to 5 MB each (stored in Supabase
                      Storage bucket &ldquo;product-images&rdquo;)
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    placeholder="Or paste an image URL / asset path..."
                    className="flex-1 px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] outline-none text-[#211f1b]"
                  />
                  <button
                    type="button"
                    onClick={handleAddImageUrl}
                    className="px-3.5 py-2 border border-[#24231f] text-[10px] tracking-[0.14em] uppercase font-semibold cursor-pointer hover:bg-[#24231f] hover:text-white transition-colors"
                  >
                    Add URL
                  </button>
                </div>
              </div>

              {/* Fabric & Description */}
              <div className="grid grid-cols-1 gap-4 pt-4 border-t border-[#e5dfd3]">
                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
                    Fabric &amp; Care
                  </label>
                  <input
                    type="text"
                    value={form.fabric_care}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, fabric_care: e.target.value }))
                    }
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
                    Editorial Description
                  </label>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="Describe silhouette, drape, weave, and styling notes..."
                    className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                  />
                </div>

                <label className="inline-flex items-center gap-2.5 text-xs text-[#211f1b] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, is_active: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#24231f]"
                  />
                  <span>Active and visible on the APNA KAPDA storefront</span>
                </label>
              </div>

              {feedback && modalOpen && feedback.type === 'err' && (
                <p className="text-xs text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] p-3">
                  {feedback.text}
                </p>
              )}

              <div className="pt-4 border-t border-[#e5dfd3] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-5 py-2.5 border border-[#e5dfd3] text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] hover:text-[#211f1b] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingImages}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.18em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer disabled:opacity-50"
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
          </div>
        </div>
      )}
    </div>
  );
}
