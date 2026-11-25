import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Check,
  Eye,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import {
  getAvailableStockForSize,
  getConfiguredSizes,
  getFirstAvailableSize,
  getTotalAvailableStock,
} from '../utils/inventory';
import type { CategoryFilter, Product } from '../types';
import { ResilientImage } from './ResilientImage';
import { RevealSection, STORE_EASE } from './StoreMotion';

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  selectedCategory: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  onOpenProduct: (product: Product) => void;
  onQuickAdd: (product: Product, size?: string) => void;
  externalSearchQuery?: string;
  onExternalSearchChange?: (query: string) => void;
}

const CATEGORIES: CategoryFilter[] = ['All', 'Men', 'Women', 'Unisex'];

type PriceRange = 'all' | 'under-1000' | '1000-1500' | 'above-1500';
type SortOption = 'featured' | 'newest' | 'price-asc' | 'price-desc';

export function ProductGrid({
  products,
  loading,
  selectedCategory,
  onCategoryChange,
  onOpenProduct,
  onQuickAdd,
  externalSearchQuery,
  onExternalSearchChange,
}: ProductGridProps) {
  const [selectedType, setSelectedType] = useState<string>('All');
  const [internalSearch, setInternalSearch] = useState('');
  const [priceRange, setPriceRange] = useState<PriceRange>('all');
  const [sortBy, setSortBy] = useState<SortOption>('featured');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [quickViewSize, setQuickViewSize] = useState<string>('');

  const searchQuery =
    externalSearchQuery !== undefined ? externalSearchQuery : internalSearch;
  const setSearchQuery = (val: string) => {
    if (onExternalSearchChange) {
      onExternalSearchChange(val);
    } else {
      setInternalSearch(val);
    }
  };

  const garmentTypes = useMemo(() => {
    const types = Array.from(new Set(products.map((p) => p.garment_type))).sort();
    return ['All', ...types];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchType = selectedType === 'All' || p.garment_type === selectedType;
      const matchPrice =
        priceRange === 'all' ||
        (priceRange === 'under-1000' && p.price_inr < 1000) ||
        (priceRange === '1000-1500' && p.price_inr >= 1000 && p.price_inr <= 1500) ||
        (priceRange === 'above-1500' && p.price_inr > 1500);
      const matchQuery =
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.garment_type.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        (p.description || '').toLowerCase().includes(query);
      return matchCat && matchType && matchPrice && matchQuery;
    });

    if (sortBy === 'price-asc') {
      return [...list].sort((a, b) => a.price_inr - b.price_inr);
    }
    if (sortBy === 'price-desc') {
      return [...list].sort((a, b) => b.price_inr - a.price_inr);
    }
    if (sortBy === 'newest') {
      return [...list].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
    }
    return list;
  }, [products, selectedCategory, selectedType, priceRange, searchQuery, sortBy]);

  const handleCardQuickAdd = (product: Product, size?: string) => {
    onQuickAdd(product, size);
    setJustAddedId(product.id);
    setTimeout(() => {
      setJustAddedId((curr) => (curr === product.id ? null : curr));
    }, 1500);
  };

  const openQuickView = (product: Product) => {
    setQuickViewProduct(product);
    setQuickViewSize(getFirstAvailableSize(product));
  };

  const hasActiveFilters =
    selectedCategory !== 'All' ||
    selectedType !== 'All' ||
    priceRange !== 'all' ||
    searchQuery.trim().length > 0;

  return (
    <section
      id="shop"
      className="bg-[#fffdf9] border-y border-[#e8e1d5] scroll-mt-20"
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-[5%] lg:px-[6%] py-16 lg:py-24">
        <RevealSection className="text-center mb-11">
          <p className="text-[11px] tracking-[0.3em] uppercase text-[#8d5b3c] font-semibold mb-2.5">
            The Apna Edit
          </p>
          <h2 className="font-serif-display text-3xl sm:text-4xl lg:text-[46px] font-medium text-[#1f1d1a] text-balance">
            Our complete collection.
          </h2>
          <p className="text-xs sm:text-sm text-[#6f685e] mt-3 max-w-lg mx-auto">
            Every garment shown below is live from our catalog. Filter by fit,
            garment type, or price range to find your piece.
          </p>
        </RevealSection>

        {/* Rounded Filter & Search Toolbar */}
        <div className="rounded-3xl bg-[#f8f4ed] border border-[#e7dfd2] p-4 sm:p-5 mb-10 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Category Pill Selector */}
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORIES.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => onCategoryChange(cat)}
                    className={`relative px-4 py-2 rounded-full text-[11px] tracking-[0.12em] uppercase font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[38px] ${
                      active
                        ? 'text-white'
                        : 'text-[#4e483f] hover:text-[#1f1d1a] bg-[#fffdf9]/70 border border-[#e5ddd0]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="shop-category-pill"
                        transition={{ duration: 0.24, ease: STORE_EASE }}
                        className="absolute inset-0 rounded-full bg-[#1f1d1a]"
                      />
                    )}
                    <span className="relative z-10">{cat}</span>
                  </button>
                );
              })}
            </div>

            {/* Search + Selects */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[190px] sm:flex-none sm:w-60">
                <Search className="w-3.5 h-3.5 text-[#7e776c] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search garments..."
                  aria-label="Search garments"
                  className="w-full pl-9 pr-8 py-2.5 rounded-full text-xs bg-[#fffdf9] border border-[#dfd7c9] focus:border-[#8d5b3c] outline-none text-[#1f1d1a] placeholder:text-[#9c9487]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#817b70] hover:text-[#1f1d1a] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#7e776c] hidden sm:block" />
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  aria-label="Filter by garment type"
                  className="px-3.5 py-2.5 rounded-full text-xs bg-[#fffdf9] border border-[#dfd7c9] focus:border-[#8d5b3c] outline-none text-[#1f1d1a] cursor-pointer"
                >
                  {garmentTypes.map((t) => (
                    <option key={t} value={t}>
                      {t === 'All' ? 'All Garments' : t}
                    </option>
                  ))}
                </select>

                <select
                  value={priceRange}
                  onChange={(e) => setPriceRange(e.target.value as PriceRange)}
                  aria-label="Filter by price range"
                  className="px-3.5 py-2.5 rounded-full text-xs bg-[#fffdf9] border border-[#dfd7c9] focus:border-[#8d5b3c] outline-none text-[#1f1d1a] cursor-pointer"
                >
                  <option value="all">All Prices</option>
                  <option value="under-1000">Under ₹1,000</option>
                  <option value="1000-1500">₹1,000 – ₹1,500</option>
                  <option value="above-1500">Above ₹1,500</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  aria-label="Sort products"
                  className="px-3.5 py-2.5 rounded-full text-xs bg-[#fffdf9] border border-[#dfd7c9] focus:border-[#8d5b3c] outline-none text-[#1f1d1a] cursor-pointer"
                >
                  <option value="featured">Featured</option>
                  <option value="newest">Newest First</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                </select>
              </div>
            </div>
          </div>

          {/* Active Results Count & Reset */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#e8e0d3] text-[11px] text-[#756e64]">
            <span className="tabular-nums">
              Showing <strong className="text-[#1f1d1a]">{filteredProducts.length}</strong>{' '}
              {filteredProducts.length === 1 ? 'piece' : 'pieces'}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  onCategoryChange('All');
                  setSelectedType('All');
                  setPriceRange('all');
                  setSearchQuery('');
                }}
                className="text-[#8d5b3c] hover:text-[#1f1d1a] font-medium underline underline-offset-4 cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>
        </div>

        {/* Loading Skeleton */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-2xl bg-[#f8f4ed] border border-[#ebe3d6] p-3 animate-pulse"
              >
                <div className="aspect-[3/4] rounded-xl bg-[#e9e2d5]" />
                <div className="h-4 rounded bg-[#e9e2d5] mt-4 w-3/4" />
                <div className="h-3 rounded bg-[#e9e2d5] mt-2 w-1/2" />
                <div className="h-4 rounded bg-[#e9e2d5] mt-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20 px-6 rounded-3xl border border-dashed border-[#dfd6c6] bg-[#faf7f2]">
            <p className="font-serif-display text-2xl sm:text-3xl text-[#1f1d1a]">
              {products.length === 0
                ? 'No products published yet.'
                : 'No pieces match your filter.'}
            </p>
            <p className="text-xs sm:text-sm text-[#787167] mt-2 max-w-md mx-auto">
              {products.length === 0
                ? 'Add or publish products in the Admin Portal to display your live collection.'
                : 'Try adjusting your price range, clearing search keywords, or exploring all categories.'}
            </p>
            {products.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onCategoryChange('All');
                  setSelectedType('All');
                  setPriceRange('all');
                  setSearchQuery('');
                }}
                className="mt-6 px-6 py-3 rounded-full bg-[#1f1d1a] text-white text-[11px] font-semibold tracking-[0.14em] uppercase hover:bg-[#8d5b3c] transition-colors cursor-pointer"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {filteredProducts.map((product, index) => {
              const availableStock = getTotalAvailableStock(product);
              const isAdded = justAddedId === product.id;
              const discountPct =
                product.compare_at_price_inr &&
                product.compare_at_price_inr > product.price_inr
                  ? Math.round(
                      ((product.compare_at_price_inr - product.price_inr) /
                        product.compare_at_price_inr) *
                        100
                    )
                  : 0;

              return (
                <motion.article
                  key={product.id}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.08 }}
                  transition={{
                    duration: 0.36,
                    delay: Math.min((index % 4) * 0.05, 0.2),
                    ease: STORE_EASE,
                  }}
                  className="group min-w-0 flex flex-col rounded-2xl bg-[#fffdf9] border border-[#ece5d9] hover:border-[#d5c6b0] p-2.5 sm:p-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_36px_-20px_rgba(31,29,26,0.22)]"
                >
                  <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[#eae3d6]">
                    <button
                      type="button"
                      onClick={() => onOpenProduct(product)}
                      className="w-full h-full block cursor-pointer text-left"
                      aria-label={`View details for ${product.name}`}
                    >
                      <ResilientImage
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                      />
                    </button>

                    {/* Top Badges */}
                    <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between gap-2 pointer-events-none">
                      {product.tag ? (
                        <span className="rounded-full bg-[#fffdf9]/95 text-[#1f1d1a] px-2.5 py-1 text-[9px] tracking-[0.12em] uppercase font-semibold shadow-xs">
                          {product.tag}
                        </span>
                      ) : (
                        <span />
                      )}

                      {discountPct > 0 && (
                        <span className="rounded-full bg-[#8d5b3c] text-white px-2 py-0.5 text-[9px] font-semibold tabular-nums shadow-xs">
                          -{discountPct}%
                        </span>
                      )}
                    </div>

                    {/* Hover / Touch Action Dock */}
                    <div className="absolute inset-x-2.5 bottom-2.5 flex items-center gap-1.5 sm:opacity-0 sm:translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
                      <button
                        type="button"
                        onClick={() => handleCardQuickAdd(product)}
                        disabled={availableStock <= 0}
                        className={`flex-1 rounded-full py-2.5 px-3 text-[10px] tracking-[0.12em] uppercase font-semibold transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-sm ${
                          isAdded
                            ? 'bg-[#2b6345] text-white'
                            : 'bg-[#fffdf9]/95 text-[#1f1d1a] hover:bg-[#1f1d1a] hover:text-white'
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Added</span>
                          </>
                        ) : availableStock > 0 ? (
                          <>
                            <ShoppingBag className="w-3 h-3 hidden sm:inline" />
                            <span>Add to Bag</span>
                          </>
                        ) : (
                          <span>Sold Out</span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => openQuickView(product)}
                        aria-label={`Quick view ${product.name}`}
                        title="Quick View"
                        className="hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#fffdf9]/95 text-[#1f1d1a] hover:bg-[#8d5b3c] hover:text-white transition-colors cursor-pointer shadow-sm shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="pt-3.5 px-1 pb-1 flex-1 flex flex-col justify-between">
                    <div>
                      <button
                        type="button"
                        onClick={() => onOpenProduct(product)}
                        className="text-left text-[13px] sm:text-sm font-semibold text-[#1f1d1a] hover:text-[#8d5b3c] transition-colors line-clamp-1 cursor-pointer"
                      >
                        {product.name}
                      </button>
                      <p className="text-[11px] text-[#7c756b] mt-1">
                        {product.category} &middot; {product.garment_type}
                      </p>
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between gap-2 tabular-nums">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] sm:text-[15px] font-bold text-[#1f1d1a]">
                          {formatINR(product.price_inr)}
                        </span>
                        {product.compare_at_price_inr &&
                          product.compare_at_price_inr > product.price_inr && (
                            <span className="text-xs text-[#a59d90] line-through font-normal">
                              {formatINR(product.compare_at_price_inr)}
                            </span>
                          )}
                      </div>
                      {availableStock > 0 && availableStock <= 5 && (
                        <span className="text-[10px] font-medium text-[#9a6746]">
                          Few left
                        </span>
                      )}
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick View Modal */}
      <AnimatePresence>
        {quickViewProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setQuickViewProduct(null)}
            className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.24, ease: STORE_EASE }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl rounded-3xl bg-[#fffdf9] border border-[#e5ddd0] overflow-hidden shadow-2xl grid grid-cols-1 sm:grid-cols-2"
            >
              <div className="aspect-[3/4] sm:aspect-auto sm:h-full bg-[#ebe3d6] relative">
                <ResilientImage
                  src={quickViewProduct.image_url}
                  alt={quickViewProduct.name}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[10px] tracking-[0.18em] uppercase text-[#8d5b3c] font-semibold">
                      {quickViewProduct.category} &middot; {quickViewProduct.garment_type}
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuickViewProduct(null)}
                      aria-label="Close quick view"
                      className="p-1 rounded-full text-[#7c756b] hover:text-[#1f1d1a] hover:bg-[#f2ece0] cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <h3 className="font-serif-display text-2xl font-medium text-[#1f1d1a] mt-1.5">
                    {quickViewProduct.name}
                  </h3>

                  <div className="flex items-baseline gap-2.5 mt-3 tabular-nums">
                    <span className="text-xl font-bold text-[#1f1d1a]">
                      {formatINR(quickViewProduct.price_inr)}
                    </span>
                    {quickViewProduct.compare_at_price_inr &&
                      quickViewProduct.compare_at_price_inr >
                        quickViewProduct.price_inr && (
                        <span className="text-xs text-[#a39b8e] line-through">
                          {formatINR(quickViewProduct.compare_at_price_inr)}
                        </span>
                      )}
                  </div>

                  <p className="text-xs text-[#645d53] leading-relaxed mt-3 line-clamp-3">
                    {quickViewProduct.description}
                  </p>

                  {/* Size selector */}
                  <div className="mt-5">
                    <p className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[#1f1d1a] mb-2">
                      Select Size
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {getConfiguredSizes(quickViewProduct).map((size) => {
                        const stock = getAvailableStockForSize(quickViewProduct, size);
                        const soldOut = stock <= 0;
                        return (
                          <button
                            key={size}
                            type="button"
                            disabled={soldOut}
                            onClick={() => setQuickViewSize(size)}
                            className={`min-w-[42px] px-3 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                              soldOut
                                ? 'opacity-40 line-through border-[#e5ddd0] text-[#9b9386] cursor-not-allowed'
                                : quickViewSize === size
                                  ? 'bg-[#1f1d1a] text-white border-[#1f1d1a]'
                                  : 'bg-[#faf7f2] text-[#1f1d1a] border-[#dfd6c6] hover:border-[#1f1d1a]'
                            }`}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-2.5">
                  <button
                    type="button"
                    disabled={
                      !quickViewSize ||
                      getAvailableStockForSize(quickViewProduct, quickViewSize) <= 0
                    }
                    onClick={() => {
                      handleCardQuickAdd(quickViewProduct, quickViewSize);
                      setQuickViewProduct(null);
                    }}
                    className="w-full rounded-full bg-[#1f1d1a] text-white py-3.5 px-5 text-[11px] font-semibold tracking-[0.16em] uppercase hover:bg-[#8d5b3c] transition-colors disabled:opacity-45 cursor-pointer"
                  >
                    Add to Bag
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = quickViewProduct;
                      setQuickViewProduct(null);
                      onOpenProduct(target);
                    }}
                    className="w-full rounded-full border border-[#d8cfc0] text-[#1f1d1a] py-3 px-5 text-[11px] font-semibold tracking-[0.14em] uppercase hover:border-[#1f1d1a] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>View Full Details</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
