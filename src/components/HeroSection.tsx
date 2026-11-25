import { motion } from 'motion/react';
import { ArrowRight, ShieldCheck, Sparkles, Truck } from 'lucide-react';
import { BRAND_IMAGES } from '../data/catalog';
import type { CategoryFilter } from '../types';
import { ResilientImage } from './ResilientImage';
import { STORE_EASE } from './StoreMotion';

interface HeroSectionProps {
  onExploreClick: () => void;
  onSelectCategory?: (category: CategoryFilter) => void;
}

export function HeroSection({
  onExploreClick,
  onSelectCategory,
}: HeroSectionProps) {
  return (
    <section
      id="home"
      className="relative overflow-hidden bg-gradient-to-b from-[#faf7f2] via-[#f6f1e8] to-[#f3ede2] border-b border-[#e8e1d5]"
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-[5%] lg:px-[6%] py-10 sm:py-14 lg:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Editorial Copy & CTAs */}
          <div className="lg:col-span-6 space-y-6 order-2 lg:order-1">
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, ease: STORE_EASE }}
              className="text-[11px] tracking-[0.28em] uppercase text-[#8d5b3c] font-semibold"
            >
              Contemporary Indian Apparel &middot; Everyday Luxury
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.06, ease: STORE_EASE }}
              className="font-serif-display text-[42px] sm:text-6xl xl:text-[68px] leading-[1.03] font-medium tracking-[-0.02em] text-[#1f1d1a] text-balance"
            >
              Apna Style.
              <br />
              <em className="italic font-normal text-[#8d5b3c]">Apna Andaaz.</em>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.12, ease: STORE_EASE }}
              className="text-sm sm:text-[15px] text-[#575148] leading-[1.85] max-w-[490px]"
            >
              Breathable natural fabrics, relaxed tailoring, and quiet confidence
              crafted for Indian seasons. Wardrobe essentials for Men, Women, and
              Unisex fits designed to move effortlessly from morning to evening.
            </motion.p>

            {/* Primary CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.18, ease: STORE_EASE }}
              className="flex flex-wrap items-center gap-3 pt-1"
            >
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() =>
                  onSelectCategory ? onSelectCategory('Men') : onExploreClick()
                }
                className="inline-flex items-center gap-2.5 rounded-full bg-[#1f1d1a] text-[#fffdf9] px-7 py-3.5 text-[11px] font-semibold tracking-[0.16em] uppercase hover:bg-[#8d5b3c] transition-colors shadow-[0_12px_28px_-14px_rgba(31,29,26,0.65)] cursor-pointer min-h-[46px]"
              >
                <span>Shop Men</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() =>
                  onSelectCategory ? onSelectCategory('Women') : onExploreClick()
                }
                className="inline-flex items-center gap-2.5 rounded-full bg-[#fffdf9] text-[#1f1d1a] border border-[#d6ccbc] px-7 py-3.5 text-[11px] font-semibold tracking-[0.16em] uppercase hover:border-[#1f1d1a] hover:bg-[#1f1d1a] hover:text-white transition-colors cursor-pointer min-h-[46px]"
              >
                <span>Shop Women</span>
              </motion.button>

              <button
                type="button"
                onClick={onExploreClick}
                className="px-3 py-2 text-[11px] font-semibold tracking-[0.16em] uppercase text-[#8d5b3c] hover:text-[#1f1d1a] underline underline-offset-4 transition-colors cursor-pointer"
              >
                Explore All
              </button>
            </motion.div>

            {/* Clean Editorial Trust Strip */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.26, ease: STORE_EASE }}
              className="pt-6 mt-4 border-t border-[#e5ddd0] grid grid-cols-1 sm:grid-cols-3 gap-3.5 text-xs text-[#5d564c]"
            >
              <div className="flex items-center gap-2.5">
                <Truck className="w-4 h-4 text-[#8d5b3c] shrink-0" />
                <span>Free Shipping ₹1,499+</span>
              </div>
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#8d5b3c] shrink-0" />
                <span>Cash on Delivery</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-[#8d5b3c] shrink-0" />
                <span>Small-Batch Tailoring</span>
              </div>
            </motion.div>
          </div>

          {/* Rounded Editorial Campaign Portrait */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.62, delay: 0.08, ease: STORE_EASE }}
            className="lg:col-span-6 order-1 lg:order-2"
          >
            <div className="relative rounded-[28px] overflow-hidden bg-[#e7dfd1] aspect-[4/4.6] sm:aspect-[4/4.3] lg:aspect-[4/4.8] max-h-[640px] w-full shadow-[0_24px_60px_-28px_rgba(31,29,26,0.34)] border border-white/70">
              <ResilientImage
                src={BRAND_IMAGES.hero}
                alt="APNA KAPDA contemporary Indian fashion campaign"
                loading="eager"
                className="w-full h-full object-cover object-center transition-transform duration-1000 hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#1a1714]/55 via-transparent to-transparent pointer-events-none" />

              <div className="absolute left-5 right-5 bottom-5 sm:left-6 sm:right-6 sm:bottom-6 flex items-end justify-between gap-4">
                <div className="text-white">
                  <p className="text-[10px] tracking-[0.22em] uppercase text-white/80">
                    Season Edit
                  </p>
                  <p className="font-serif-display text-xl sm:text-2xl mt-0.5">
                    Handpicked Everyday Silhouettes
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onExploreClick}
                  className="shrink-0 rounded-full bg-white/92 backdrop-blur-sm text-[#1f1d1a] hover:bg-white px-4 py-2 text-[10px] font-semibold tracking-[0.14em] uppercase transition-colors cursor-pointer"
                >
                  Shop Edit
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
