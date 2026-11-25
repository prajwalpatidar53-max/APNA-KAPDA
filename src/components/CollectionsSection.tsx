import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { BRAND_IMAGES, formatINR } from '../data/catalog';
import type { CategoryFilter, Product } from '../types';
import { ResilientImage } from './ResilientImage';
import { RevealSection, STORE_EASE } from './StoreMotion';

interface CollectionsSectionProps {
  onSelectCategory: (category: CategoryFilter) => void;
  products?: Product[];
  onOpenProduct?: (product: Product) => void;
}

const COLLECTION_CARDS: {
  category: Exclude<CategoryFilter, 'All'>;
  title: string;
  subtitle: string;
  image: string;
}[] = [
  {
    category: 'Men',
    title: 'Men',
    subtitle: 'Relaxed linen shirts, heavy cotton tees & tailored everyday bottoms',
    image: BRAND_IMAGES.categories.Men,
  },
  {
    category: 'Women',
    title: 'Women',
    subtitle: 'Fluid drapes, breathable co-ords & structured silhouettes',
    image: BRAND_IMAGES.categories.Women,
  },
  {
    category: 'Unisex',
    title: 'Unisex',
    subtitle: 'Shared fits & oversized essentials crafted for effortless layering',
    image: BRAND_IMAGES.categories.Unisex,
  },
];

type HighlightTab = 'new' | 'trending' | 'bestsellers';

export function CollectionsSection({
  onSelectCategory,
  products = [],
  onOpenProduct,
}: CollectionsSectionProps) {
  const [highlightTab, setHighlightTab] = useState<HighlightTab>('new');

  const categoryCounts = useMemo(() => {
    return {
      Men: products.filter((p) => p.category === 'Men').length,
      Women: products.filter((p) => p.category === 'Women').length,
      Unisex: products.filter((p) => p.category === 'Unisex').length,
    };
  }, [products]);

  const curatedHighlights = useMemo(() => {
    if (products.length === 0) return [];
    const byNewest = [...products].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    if (highlightTab === 'new') {
      const taggedNew = byNewest.filter((p) =>
        p.tag?.toLowerCase().includes('new')
      );
      return (taggedNew.length >= 2 ? taggedNew : byNewest).slice(0, 4);
    }

    if (highlightTab === 'trending') {
      const taggedTrending = byNewest.filter((p) =>
        /trend|drop|limited|edit|popular/i.test(p.tag || '')
      );
      return (taggedTrending.length >= 2 ? taggedTrending : byNewest).slice(0, 4);
    }

    const taggedBest = byNewest.filter((p) =>
      /best|signature|essential|classic/i.test(p.tag || '')
    );
    return (taggedBest.length >= 2 ? taggedBest : byNewest).slice(0, 4);
  }, [products, highlightTab]);

  return (
    <section
      id="collections"
      className="max-w-[1440px] mx-auto px-4 sm:px-[5%] lg:px-[6%] py-16 lg:py-24 space-y-20"
    >
      {/* Featured Collections Grid */}
      <RevealSection>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <p className="text-[11px] tracking-[0.28em] uppercase text-[#8d5b3c] font-semibold mb-2">
              Curated Departments
            </p>
            <h2 className="font-serif-display text-3xl sm:text-4xl lg:text-[44px] font-medium text-[#1f1d1a] tracking-[-0.015em]">
              Shop by collection.
            </h2>
          </div>
          <p className="text-xs sm:text-[13px] text-[#6d665c] max-w-sm">
            Thoughtfully proportioned cuts across Men, Women, and Unisex wardrobes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-7">
          {COLLECTION_CARDS.map((card, index) => {
            const count = categoryCounts[card.category];
            return (
              <motion.button
                key={card.category}
                type="button"
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.45, delay: index * 0.08, ease: STORE_EASE }}
                whileHover={{ y: -4 }}
                onClick={() => onSelectCategory(card.category)}
                className="group relative aspect-[3/3.9] overflow-hidden rounded-[26px] bg-[#e5ddd0] text-left cursor-pointer shadow-[0_18px_40px_-24px_rgba(31,29,26,0.38)]"
              >
                <ResilientImage
                  src={card.image}
                  alt={`${card.title} collection`}
                  className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#191613]/82 via-[#191613]/20 to-transparent" />

                <div className="absolute inset-x-6 bottom-6 text-white">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-serif-display text-3xl sm:text-[32px] font-medium">
                      {card.title}
                    </h3>
                    <span className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm border border-white/25 flex items-center justify-center transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:bg-white group-hover:text-[#1f1d1a]">
                      <ArrowUpRight className="w-4 h-4" />
                    </span>
                  </div>
                  <p className="text-xs text-white/80 mt-2 leading-relaxed line-clamp-2">
                    {card.subtitle}
                  </p>
                  <div className="mt-4 inline-flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase text-[#e6c9a8] font-semibold">
                    <span>
                      Explore {card.title}
                      {count > 0 ? ` (${count})` : ''}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </RevealSection>

      {/* Curated Live Highlights: New Arrivals / Trending / Bestsellers */}
      {curatedHighlights.length > 0 && onOpenProduct && (
        <RevealSection delay={0.05}>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-[11px] tracking-[0.28em] uppercase text-[#8d5b3c] font-semibold mb-2">
                Spotlight
              </p>
              <h2 className="font-serif-display text-2xl sm:text-3xl lg:text-4xl font-medium text-[#1f1d1a]">
                In the wardrobe right now.
              </h2>
            </div>

            <div className="inline-flex items-center p-1 rounded-full bg-[#ede6da] border border-[#e2d8c7] self-start sm:self-auto">
              {(
                [
                  { id: 'new', label: 'New Arrivals' },
                  { id: 'trending', label: 'Trending' },
                  { id: 'bestsellers', label: 'Bestsellers' },
                ] as const
              ).map((tab) => {
                const active = highlightTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setHighlightTab(tab.id)}
                    className={`relative px-4 py-2 rounded-full text-[11px] font-medium tracking-[0.06em] transition-colors cursor-pointer whitespace-nowrap ${
                      active ? 'text-white' : 'text-[#575148] hover:text-[#1f1d1a]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="store-highlight-pill"
                        transition={{ duration: 0.24, ease: STORE_EASE }}
                        className="absolute inset-0 rounded-full bg-[#1f1d1a]"
                      />
                    )}
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {curatedHighlights.map((product) => (
              <motion.button
                key={`${highlightTab}-${product.id}`}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: STORE_EASE }}
                whileHover={{ y: -3 }}
                onClick={() => onOpenProduct(product)}
                className="group text-left rounded-2xl bg-[#fffdf9] border border-[#eae3d6] hover:border-[#d5c7b2] p-2.5 sm:p-3 transition-shadow hover:shadow-[0_14px_30px_-18px_rgba(31,29,26,0.22)] cursor-pointer"
              >
                <div className="relative aspect-[3/3.7] rounded-xl overflow-hidden bg-[#eae3d6]">
                  <ResilientImage
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  {product.tag && (
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-[#fffdf9]/95 px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] uppercase text-[#1f1d1a] shadow-xs">
                      {product.tag}
                    </span>
                  )}
                </div>
                <div className="pt-3 px-1">
                  <p className="text-xs sm:text-sm font-semibold text-[#1f1d1a] group-hover:text-[#8d5b3c] transition-colors line-clamp-1">
                    {product.name}
                  </p>
                  <p className="text-[11px] text-[#7a7368] mt-0.5">
                    {product.category} &middot; {product.garment_type}
                  </p>
                  <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                    <span className="text-xs sm:text-sm font-bold text-[#1f1d1a]">
                      {formatINR(product.price_inr)}
                    </span>
                    {product.compare_at_price_inr &&
                      product.compare_at_price_inr > product.price_inr && (
                        <span className="text-[11px] text-[#a39b8e] line-through">
                          {formatINR(product.compare_at_price_inr)}
                        </span>
                      )}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </RevealSection>
      )}
    </section>
  );
}
