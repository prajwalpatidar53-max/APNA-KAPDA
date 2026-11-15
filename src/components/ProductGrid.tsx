import { useMemo, useState } from 'react';
import { ArrowUpRight, Search, SlidersHorizontal } from 'lucide-react';
import { formatINR } from '../data/catalog';
import { getTotalAvailableStock } from '../utils/inventory';
import type { CategoryFilter, Product } from '../types';
import { ResilientImage } from './ResilientImage';

interface ProductGridProps {
  products: Product[];
  loading: boolean;
  selectedCategory: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  onOpenProduct: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
}

const CATEGORIES: CategoryFilter[] = ['All', 'Men', 'Women', 'Unisex'];

export function ProductGrid({
  products,
  loading,
  selectedCategory,
  onCategoryChange,
  onOpenProduct,
  onQuickAdd,
}: ProductGridProps) {
  const [selectedType, setSelectedType] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc'>('featured');

  const garmentTypes = useMemo(() => {
    const types = Array.from(new Set(products.map((p) => p.garment_type))).sort();
    return ['All', ...types];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchType = selectedType === 'All' || p.garment_type === selectedType;
      const matchQuery =
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.garment_type.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query);
      return matchCat && matchType && matchQuery;
    });

    if (sortBy === 'price-asc') {
      return [...list].sort((a, b) => a.price_inr - b.price_inr);
    }
    if (sortBy === 'price-desc') {
      return [...list].sort((a, b) => b.price_inr - a.price_inr);
    }
    return list;
  }, [products, selectedCategory, selectedType, searchQuery, sortBy]);

  return (
    <section id="shop" className="bg-[#fffdf8] border-y border-[#e5dfd3]">
      <div className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-16 lg:py-20">
        <div className="text-center mb-10">
          <p className="text-[10px] tracking-[0.34em] uppercase text-[#9a6746] font-bold mb-3">
            The Apna Edit
          </p>
          <h2 className="font-serif-display text-3xl sm:text-4xl lg:text-[46px] font-medium text-[#211f1b] text-balance">
            Our favourites.
          </h2>
          <p className="text-xs sm:text-[13px] text-[#817b70] mt-3">
            Pieces you&apos;ll keep coming back to. Select any piece for sizing and fabric details.
          </p>
        </div>

        {/* Interactive Filter & Search Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-9 pb-6 border-b border-[#e5dfd3]">
          <div className="flex flex-wrap items-center gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => onCategoryChange(cat)}
                className={`px-4 py-2.5 text-[10px] tracking-[0.14em] uppercase border transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-[#24231f] text-white border-[#24231f]'
                    : 'bg-transparent text-[#211f1b] border-[#e5dfd3] hover:border-[#24231f]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 sm:flex-none sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#817b70] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search garments..."
                aria-label="Search garments"
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
              />
            </div>

            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#817b70] hidden sm:block" />
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                aria-label="Filter by garment type"
                className="px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
              >
                {garmentTypes.map((t) => (
                  <option key={t} value={t}>
                    {t === 'All' ? 'All Garments' : t}
                  </option>
                ))}
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'featured' | 'price-asc' | 'price-desc')}
                aria-label="Sort products"
                className="px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
            </div>
          </div>
        </div>

        {/* Loading Skeleton */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="animate-pulse">
                <div className="aspect-[3/4] bg-[#ebe5d8]" />
                <div className="h-4 bg-[#ebe5d8] mt-4 w-3/4" />
                <div className="h-3 bg-[#ebe5d8] mt-2 w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-[#e5dfd3] bg-[#f5f2eb]/40">
            <p className="font-serif-display text-2xl text-[#211f1b]">
              {products.length === 0
                ? 'No products published yet.'
                : 'No pieces match your filter.'}
            </p>
            <p className="text-xs text-[#817b70] mt-2">
              {products.length === 0
                ? 'Add or publish products in the Admin Portal to display your live collection.'
                : 'Try clearing your search or switching back to all collections.'}
            </p>
            {products.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onCategoryChange('All');
                  setSelectedType('All');
                  setSearchQuery('');
                }}
                className="mt-5 px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {filteredProducts.map((product) => {
              const availableStock = getTotalAvailableStock(product);
              return (
              <article
                key={product.id}
                className="group min-w-0 flex flex-col transition-transform duration-200 hover:-translate-y-0.5"
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-[#e9e3d8]">
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

                  {product.tag && (
                    <span className="absolute top-3 left-3 bg-[#fffdf8]/95 text-[#211f1b] px-2.5 py-1 text-[9px] tracking-[0.14em] uppercase font-medium pointer-events-none">
                      {product.tag}
                    </span>
                  )}

                  <div className="absolute inset-x-3 bottom-3 flex flex-col sm:flex-row gap-1.5 sm:opacity-0 sm:translate-y-3 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
                    <button
                      type="button"
                      onClick={() => onQuickAdd(product)}
                      disabled={availableStock <= 0}
                      className="flex-1 bg-[#fffdf8] text-[#211f1b] hover:bg-[#24231f] hover:text-white py-2.5 px-3 text-[10px] tracking-[0.14em] uppercase font-medium transition-colors disabled:opacity-50"
                    >
                      {availableStock > 0 ? 'Add to Bag +' : 'Out of Stock'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenProduct(product)}
                      aria-label={`Inspect ${product.name}`}
                      className="hidden sm:inline-flex items-center justify-center bg-[#fffdf8] text-[#211f1b] hover:bg-[#9a6746] hover:text-white px-2.5 transition-colors"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="pt-3.5 pb-1 flex-1 flex flex-col justify-between">
                  <div>
                    <button
                      type="button"
                      onClick={() => onOpenProduct(product)}
                      className="text-left text-[13px] sm:text-sm font-semibold text-[#211f1b] hover:text-[#9a6746] transition-colors line-clamp-1"
                    >
                      {product.name}
                    </button>
                    <p className="text-[11px] text-[#817b70] mt-1">
                      {product.category} &middot; {product.garment_type}
                    </p>
                  </div>

                  <div className="mt-2.5 flex items-baseline gap-2 tabular-nums">
                    <span className="text-[13px] sm:text-sm font-bold text-[#211f1b]">
                      {formatINR(product.price_inr)}
                    </span>
                    {product.compare_at_price_inr &&
                      product.compare_at_price_inr > product.price_inr && (
                        <span className="text-xs text-[#a6a095] line-through font-normal">
                          {formatINR(product.compare_at_price_inr)}
                        </span>
                      )}
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
