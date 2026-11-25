import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import {
  getAvailableStockForSize,
  getConfiguredSizes,
  getFirstAvailableSize,
  getTotalAvailableStock,
} from '../utils/inventory';
import type { Product } from '../types';
import { ResilientImage } from './ResilientImage';
import { SizeGuideModal } from './SizeGuideModal';
import { STORE_EASE } from './StoreMotion';

interface ProductDetailPageProps {
  product: Product;
  relatedProducts: Product[];
  onBack: () => void;
  onAddToCart: (product: Product, size: string, qty: number) => void;
  onBuyNow?: (product: Product, size: string, qty: number) => void;
  onSelectProduct: (product: Product) => void;
}

export function ProductDetailPage({
  product,
  relatedProducts,
  onBack,
  onAddToCart,
  onBuyNow,
  onSelectProduct,
}: ProductDetailPageProps) {
  const availableSizes = getConfiguredSizes(product);
  const [selectedSize, setSelectedSize] = useState<string>(() =>
    getFirstAvailableSize(product)
  );
  const [qty, setQty] = useState(1);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [addedFeedback, setAddedFeedback] = useState(false);

  const gallery = useMemo(() => {
    const urls = [
      product.image_url,
      ...(Array.isArray(product.gallery_images) ? product.gallery_images : []),
    ]
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean);
    return Array.from(new Set(urls));
  }, [product.image_url, product.gallery_images]);

  const [activeImageIdx, setActiveImageIdx] = useState(0);

  useEffect(() => {
    setSelectedSize(getFirstAvailableSize(product));
    setQty(1);
    setAddedFeedback(false);
    setActiveImageIdx(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [product]);

  const selectedSizeStock = getAvailableStockForSize(product, selectedSize);
  const overallAvailableStock = getTotalAvailableStock(product);

  useEffect(() => {
    if (selectedSizeStock > 0 && qty > selectedSizeStock) {
      setQty(selectedSizeStock);
    } else if (selectedSizeStock <= 0 && qty !== 1) {
      setQty(1);
    }
  }, [selectedSizeStock, qty]);

  const discountPercent =
    product.compare_at_price_inr && product.compare_at_price_inr > product.price_inr
      ? Math.round(
          ((product.compare_at_price_inr - product.price_inr) /
            product.compare_at_price_inr) *
            100
        )
      : 0;

  const isBottoms =
    product.garment_type.toLowerCase().includes('bottom') ||
    product.garment_type.toLowerCase().includes('denim') ||
    product.garment_type.toLowerCase().includes('trouser');

  const canPurchase =
    selectedSizeStock > 0 && availableSizes.length > 0 && Boolean(selectedSize);

  const handleAdd = () => {
    if (!canPurchase) return;
    onAddToCart(product, selectedSize, qty);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1800);
  };

  const handleBuyNowClick = () => {
    if (!canPurchase) return;
    if (onBuyNow) {
      onBuyNow(product, selectedSize, qty);
    } else {
      onAddToCart(product, selectedSize, qty);
    }
  };

  const activeImage = gallery[activeImageIdx] || product.image_url;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-[5%] lg:px-[6%] py-8 lg:py-12">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center justify-between gap-4 pb-5 mb-8 border-b border-[#e8e1d5]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-full border border-[#dfd6c7] bg-[#fffdf9] px-4 py-2 text-[11px] font-medium tracking-[0.12em] uppercase text-[#1f1d1a] hover:border-[#1f1d1a] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Shop</span>
        </button>

        <div className="text-[11px] text-[#7c756b] truncate hidden sm:block">
          <span>Shop</span>
          <span className="mx-2">/</span>
          <span>{product.category}</span>
          <span className="mx-2">/</span>
          <span className="text-[#1f1d1a] font-medium">{product.name}</span>
        </div>
      </div>

      {/* Main Split: Gallery Left + Sticky Purchase Module Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        <div className="lg:col-span-7 lg:sticky lg:top-24 space-y-3.5">
          <div className="relative aspect-[3/4] max-h-[760px] w-full rounded-[28px] overflow-hidden bg-[#eae3d6] border border-[#e8e1d5] shadow-[0_18px_48px_-28px_rgba(31,29,26,0.28)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeImage}
                initial={{ opacity: 0.35, scale: 1.015 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0.35 }}
                transition={{ duration: 0.28, ease: STORE_EASE }}
                className="w-full h-full"
              >
                <ResilientImage
                  src={activeImage}
                  alt={product.name}
                  loading="eager"
                  className="w-full h-full object-cover"
                />
              </motion.div>
            </AnimatePresence>

            <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-2 pointer-events-none">
              {product.tag ? (
                <span className="rounded-full bg-[#fffdf9]/95 text-[#1f1d1a] px-3.5 py-1.5 text-[10px] tracking-[0.16em] uppercase font-semibold shadow-xs">
                  {product.tag}
                </span>
              ) : (
                <span />
              )}

              {discountPercent > 0 && (
                <span className="rounded-full bg-[#8d5b3c] text-white px-3 py-1 text-[10px] font-semibold tabular-nums shadow-xs">
                  Save {discountPercent}%
                </span>
              )}
            </div>
          </div>

          {gallery.length > 1 && (
            <div className="flex items-center gap-3 overflow-x-auto pb-1">
              {gallery.map((imgUrl, idx) => (
                <button
                  key={`${imgUrl}-${idx}`}
                  type="button"
                  onClick={() => setActiveImageIdx(idx)}
                  aria-label={`View image ${idx + 1} of ${product.name}`}
                  className={`relative w-20 h-24 rounded-2xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                    activeImageIdx === idx
                      ? 'border-[#1f1d1a] ring-2 ring-[#8d5b3c]/25'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <ResilientImage
                    src={imgUrl}
                    alt={`${product.name} view ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sticky Purchase Card */}
        <div className="lg:col-span-5 lg:sticky lg:top-24 rounded-[28px] bg-[#fffdf9] border border-[#e8e1d5] p-6 sm:p-8 shadow-[0_14px_40px_-24px_rgba(31,29,26,0.14)]">
          <p className="text-[11px] tracking-[0.18em] uppercase text-[#8d5b3c] font-semibold">
            {product.category} &middot; {product.garment_type}
          </p>

          <h1 className="font-serif-display text-3xl sm:text-[38px] leading-[1.12] font-medium text-[#1f1d1a] mt-2 text-balance">
            {product.name}
          </h1>

          {/* Price & Availability */}
          <div className="flex flex-wrap items-baseline gap-3 mt-4 pb-5 border-b border-[#ece5d9] tabular-nums">
            <span className="text-2xl sm:text-[26px] font-bold text-[#1f1d1a]">
              {formatINR(product.price_inr)}
            </span>
            {product.compare_at_price_inr &&
              product.compare_at_price_inr > product.price_inr && (
                <>
                  <span className="text-sm text-[#a69e90] line-through">
                    {formatINR(product.compare_at_price_inr)}
                  </span>
                  <span className="text-xs font-semibold text-[#8d5b3c]">
                    {discountPercent}% off
                  </span>
                </>
              )}
            <span
              className={`ml-auto text-[11px] font-medium ${
                selectedSizeStock > 0 ? 'text-[#2b6345]' : 'text-[#9a3b26]'
              }`}
            >
              {selectedSizeStock > 0
                ? `${selectedSizeStock} available`
                : overallAvailableStock > 0
                  ? 'Selected size out of stock'
                  : 'Currently sold out'}
            </span>
          </div>

          <p className="text-xs sm:text-[13.5px] text-[#5b544b] leading-[1.85] mt-5">
            {product.description}
          </p>

          {/* Optional Colour Notes */}
          {product.colors && product.colors.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[#7a7368] mr-1">
                Shades:
              </span>
              {product.colors.map((color) => (
                <span
                  key={color}
                  className="rounded-full bg-[#f5efe4] border border-[#e5dccd] px-2.5 py-1 text-[11px] text-[#3f3a33]"
                >
                  {color}
                </span>
              ))}
            </div>
          )}

          {/* Size Selection + Size Guide */}
          <div className="mt-7">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] tracking-[0.16em] uppercase font-semibold text-[#1f1d1a]">
                Select Size: <span className="text-[#8d5b3c]">{selectedSize}</span>
              </span>
              <button
                type="button"
                onClick={() => setSizeGuideOpen(true)}
                className="inline-flex items-center gap-1.5 text-[11px] text-[#8d5b3c] hover:text-[#1f1d1a] underline underline-offset-4 transition-colors cursor-pointer"
              >
                <Ruler className="w-3.5 h-3.5" />
                <span>Size Guide</span>
              </button>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
              {availableSizes.map((size) => {
                const sizeStock = getAvailableStockForSize(product, size);
                const sizeSoldOut = sizeStock <= 0;
                const active = selectedSize === size;
                return (
                  <motion.button
                    key={size}
                    type="button"
                    whileTap={sizeSoldOut ? undefined : { scale: 0.95 }}
                    disabled={sizeSoldOut}
                    onClick={() => setSelectedSize(size)}
                    className={`py-2.5 rounded-xl text-xs font-semibold border transition-colors min-h-[42px] ${
                      sizeSoldOut
                        ? 'bg-[#f8f4ed] text-[#a69f92] border-[#eae2d5] opacity-55 line-through cursor-not-allowed'
                        : active
                          ? 'bg-[#1f1d1a] text-white border-[#1f1d1a] shadow-xs cursor-pointer'
                          : 'bg-[#faf7f2] text-[#1f1d1a] border-[#dfd6c7] hover:border-[#1f1d1a] cursor-pointer'
                    }`}
                  >
                    {size}
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Quantity + Add to Bag + Buy Now */}
          <div className="mt-6 space-y-3">
            <div className="flex items-stretch gap-3">
              <div className="flex items-center rounded-full border border-[#dfd6c7] bg-[#faf7f2] px-1">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                  className="w-9 h-11 rounded-full flex items-center justify-center text-sm text-[#1f1d1a] hover:bg-[#ece4d7] transition-colors cursor-pointer"
                >
                  −
                </button>
                <span className="w-8 text-center text-xs font-semibold tabular-nums">
                  {qty}
                </span>
                <button
                  type="button"
                  disabled={selectedSizeStock <= 0 || qty >= selectedSizeStock}
                  onClick={() =>
                    setQty((q) => Math.min(Math.max(1, selectedSizeStock), q + 1))
                  }
                  aria-label="Increase quantity"
                  className="w-9 h-11 rounded-full flex items-center justify-center text-sm text-[#1f1d1a] hover:bg-[#ece4d7] transition-colors disabled:opacity-40 cursor-pointer"
                >
                  +
                </button>
              </div>

              <motion.button
                type="button"
                whileTap={canPurchase ? { scale: 0.98 } : undefined}
                disabled={!canPurchase}
                onClick={handleAdd}
                className={`flex-1 rounded-full px-5 py-3.5 text-[11px] tracking-[0.16em] uppercase font-semibold transition-colors disabled:opacity-45 inline-flex items-center justify-center gap-2 cursor-pointer min-h-[48px] ${
                  addedFeedback
                    ? 'bg-[#2b6345] text-white'
                    : 'bg-[#1f1d1a] text-white hover:bg-[#8d5b3c]'
                }`}
              >
                {addedFeedback ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Added to Bag</span>
                  </>
                ) : availableSizes.length === 0 ? (
                  <span>Size Unavailable</span>
                ) : selectedSizeStock > 0 ? (
                  <>
                    <ShoppingBag className="w-4 h-4" />
                    <span className="tabular-nums">
                      Add to Bag &mdash; {formatINR(product.price_inr * qty)}
                    </span>
                  </>
                ) : (
                  <span>Out of Stock</span>
                )}
              </motion.button>
            </div>

            {onBuyNow && canPurchase && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.99 }}
                onClick={handleBuyNowClick}
                className="w-full rounded-full border border-[#1f1d1a] bg-transparent text-[#1f1d1a] hover:bg-[#1f1d1a] hover:text-white py-3.5 px-6 text-[11px] tracking-[0.16em] uppercase font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer min-h-[46px]"
              >
                <span>Buy Now</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            )}
          </div>

          {/* Craftsmanship & Shipping Trust Details */}
          <div className="mt-7 pt-6 border-t border-[#ece5d9] space-y-3.5 text-xs text-[#5d564c]">
            <div className="rounded-2xl bg-[#f8f4ed] border border-[#ebe3d6] p-4">
              <p className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[#1f1d1a] mb-1 inline-flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#8d5b3c]" />
                <span>Fabric &amp; Care</span>
              </p>
              <p className="leading-relaxed">{product.fabric_care}</p>
            </div>

            <div className="flex items-start gap-2.5 px-1">
              <Truck className="w-4 h-4 text-[#8d5b3c] shrink-0 mt-0.5" />
              <span>
                Complimentary shipping across India on orders of ₹1,499 or above (₹99
                standard below ₹1,499).
              </span>
            </div>
            <div className="flex items-start gap-2.5 px-1">
              <ShieldCheck className="w-4 h-4 text-[#8d5b3c] shrink-0 mt-0.5" />
              <span>
                Cash on Delivery (COD) and transparent order tracking in your account.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Related Pieces */}
      {relatedProducts.length > 0 && (
        <section className="mt-20 pt-12 border-t border-[#e8e1d5]">
          <div className="flex items-baseline justify-between mb-8">
            <h2 className="font-serif-display text-2xl sm:text-3xl text-[#1f1d1a]">
              Complete the look
            </h2>
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[#8d5b3c] hover:text-[#1f1d1a] cursor-pointer"
            >
              View All &rarr;
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {relatedProducts.map((item) => (
              <motion.button
                key={item.id}
                type="button"
                whileHover={{ y: -3 }}
                onClick={() => onSelectProduct(item)}
                className="group text-left rounded-2xl bg-[#fffdf9] border border-[#ece5d9] hover:border-[#d5c6b0] p-2.5 sm:p-3 transition-shadow hover:shadow-[0_14px_30px_-18px_rgba(31,29,26,0.2)] cursor-pointer"
              >
                <div className="aspect-[3/4] rounded-xl overflow-hidden bg-[#eae3d6]">
                  <ResilientImage
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <p className="text-xs sm:text-sm font-semibold text-[#1f1d1a] mt-3 px-1 group-hover:text-[#8d5b3c] transition-colors line-clamp-1">
                  {item.name}
                </p>
                <p className="text-[11px] text-[#7c756b] mt-0.5 px-1">
                  {item.category} &middot; {item.garment_type}
                </p>
                <p className="text-xs sm:text-sm font-bold text-[#1f1d1a] mt-1.5 px-1 tabular-nums">
                  {formatINR(item.price_inr)}
                </p>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      <SizeGuideModal
        open={sizeGuideOpen}
        onClose={() => setSizeGuideOpen(false)}
        defaultTab={isBottoms ? 'bottoms' : 'tops'}
      />
    </div>
  );
}
