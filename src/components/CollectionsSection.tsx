import { ArrowUpRight } from 'lucide-react';
import { BRAND_IMAGES } from '../data/catalog';
import type { CategoryFilter, ProductCategory } from '../types';
import { ResilientImage } from './ResilientImage';

interface CollectionsSectionProps {
  onSelectCategory: (category: CategoryFilter) => void;
}

const COLLECTION_CARDS: { category: ProductCategory; subtitle: string }[] = [
  { category: 'Men', subtitle: 'Tailored linens & modern silhouettes' },
  { category: 'Women', subtitle: 'Effortless drapes & sculpted essentials' },
  { category: 'Unisex', subtitle: 'Relaxed heavyweight everyday staples' },
];

export function CollectionsSection({ onSelectCategory }: CollectionsSectionProps) {
  return (
    <section
      id="collections"
      className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-16 lg:py-20"
    >
      <div className="text-center mb-10 lg:mb-12">
        <p className="text-[10px] tracking-[0.34em] uppercase text-[#9a6746] font-bold mb-3">
          Find Your Style
        </p>
        <h2 className="font-serif-display text-3xl sm:text-4xl lg:text-[46px] font-medium text-[#211f1b] text-balance">
          Made for every version of you.
        </h2>
        <p className="text-xs sm:text-[13px] text-[#817b70] mt-3">
          One label. Every style. Every mood.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
        {COLLECTION_CARDS.map(({ category, subtitle }) => (
          <button
            key={category}
            type="button"
            onClick={() => onSelectCategory(category)}
            className="group relative h-[380px] sm:h-[410px] overflow-hidden text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#9a6746]"
          >
            <ResilientImage
              src={BRAND_IMAGES.categories[category]}
              alt={`${category} fashion collection`}
              className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
            <div className="absolute bottom-6 left-6 right-6 text-white z-10">
              <h3 className="font-serif-display text-3xl font-medium">{category}</h3>
              <p className="text-xs text-white/80 mt-1 mb-2.5">{subtitle}</p>
              <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-[#eee6d8] group-hover:text-white">
                <span>Explore Collection</span>
                <ArrowUpRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
