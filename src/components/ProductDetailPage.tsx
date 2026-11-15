import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Ruler, ShieldCheck, Truck } from 'lucide-react';
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

interface ProductDetailPageProps {
  product: Product;
  relatedProducts: Product[];
  onBack: () => void;
  onAddToCart: (product: Product, size: string, qty: number) => void;
  onSelectProduct: (product: Product) => void;
}

export function ProductDetailPage({
  product,
  relatedProducts,
  onBack,
  onAddToCart,
  onSelectProduct,
}: ProductDetailPageProps) {
  const availableSizes = getConfiguredSizes(product);
  const [selectedSize, setSelectedSize] = useState<string>(() =>
    getFirstAvailableSize(product)
  );
  const [qty, setQty] = useState(1);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [addedFeedback, setAddedFeedback] = useState(false);

  useEffect(() => {
    setSelectedSize(getFirstAvailableSize(product));
    setQty(1);
    setAddedFeedback(false);
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

  const handleAdd = () => {
    if (!selectedSize || availableSizes.length === 0 || selectedSizeStock <= 0) return;
    onAddToCart(product, selectedSize, qty);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1800);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-8 lg:py-12">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center justify-between gap-4 pb-6 mb-8 border-b border-[#e5dfd3]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs tracking-[0.14em] uppercase text-[#211f1b] hover:text-[#9a6746] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Shop</span>
        </button>

        <div className="text-[11px] text-[#817b70] truncate">
          <span>Shop</span>
          <span className="mx-2">/</span>
          <span>{product.category}</span>
          <span className="mx-2">/</span>
          <span className="text-[#211f1b] font-medium">{product.name}</span>
        </div>
      </div>

      {/* Main Split: Sticky Gallery Left + Contiguous Purchase Module Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
        <div className="lg:col-span-7 lg:sticky lg:top-28">
          <div className="relative aspect-[3/4] max-h-[760px] w-full overflow-hidden bg-[#e9e3d8]">
            <ResilientImage
              src={product.image_url}
              alt={product.name}
              loading="eager"
              className="w-full h-full object-cover"
            />
            {product.tag && (
              <span className="absolute top-4 left-4 bg-[#fffdf8]/95 text-[#211f1b] px-3 py-1.5 text-[10px] tracking-[0.16em] uppercase font-medium">
                {product.tag}
              </span>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 lg:sticky lg:top-28 bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8">
          <p className="text-[11px] tracking-[0.16em] uppercase text-[#817b70]">
            {product.category} &middot; {product.garment_type}
          </p>

          <h1 className="font-serif-display text-3xl sm:text-4xl font-medium text-[#211f1b] mt-2 text-balance">
            {product.name}
          </h1>

          {/* Tabular Price & Availability */}
          <div className="flex flex-wrap items-baseline gap-3 mt-4 pb-5 border-b border-[#e5dfd3] tabular-nums">
            <span className="text-2xl font-bold text-[#211f1b]">
              {formatINR(product.price_inr)}
            </span>
            {product.compare_at_price_inr &&
              product.compare_at_price_inr > product.price_inr && (
                <>
                  <span className="text-sm text-[#a6a095] line-through">
                    {formatINR(product.compare_at_price_inr)}
                  </span>
                  <span className="text-xs font-medium text-[#9a6746]">
                    Save {discountPercent}%
                  </span>
                </>
              )}
            <span className="ml-auto text-[11px] text-[#5f594f]">
              {selectedSizeStock > 0
                ? `${selectedSizeStock} in stock`
                : overallAvailableStock > 0
                  ? 'Selected size out of stock'
                  : 'Currently sold out'}
            </span>
          </div>

          <p className="text-xs sm:text-[13px] text-[#5f594f] leading-[1.85] mt-5">
            {product.description}
          </p>

          {/* Size Selection + Size Guide Trigger */}
          <div className="mt-7">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] tracking-[0.16em] uppercase font-semibold text-[#211f1b]">
                Select Size: <span className="text-[#9a6746]">{selectedSize}</span>
              </span>
              <button
                type="button"
                onClick={() => setSizeGuideOpen(true)}
                className="inline-flex items-center gap-1.5 text-[11px] text-[#9a6746] hover:text-[#211f1b] underline underline-offset-4 transition-colors"
              >
                <Ruler className="w-3.5 h-3.5" />
                <span>Size Guide</span>
              </button>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {availableSizes.map((size) => {
                const sizeStock = getAvailableStockForSize(product, size);
                const sizeSoldOut = sizeStock <= 0;
                return (
                  <button
                    key={size}
                    type="button"
                    disabled={sizeSoldOut}
                    onClick={() => setSelectedSize(size)}
                    className={`py-2.5 text-xs font-medium border transition-colors ${
                      sizeSoldOut
                        ? 'bg-transparent text-[#a6a095] border-[#e5dfd3] opacity-50 line-through cursor-not-allowed'
                        : selectedSize === size
                          ? 'bg-[#24231f] text-white border-[#24231f]'
                          : 'bg-transparent text-[#211f1b] border-[#e5dfd3] hover:border-[#24231f]'
                    }`}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantity + Primary Buy CTA */}
          <div className="mt-6 flex items-stretch gap-3">
            <div className="flex items-center border border-[#e5dfd3] bg-[#f5f2eb]/40">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                className="w-10 h-12 flex items-center justify-center text-sm text-[#211f1b] hover:bg-[#e5dfd3]/50"
              >
                −
              </button>
              <span className="w-9 text-center text-xs font-semibold tabular-nums">
                {qty}
              </span>
              <button
                type="button"
                disabled={selectedSizeStock <= 0 || qty >= selectedSizeStock}
                onClick={() =>
                  setQty((q) => Math.min(Math.max(1, selectedSizeStock), q + 1))
                }
                aria-label="Increase quantity"
                className="w-10 h-12 flex items-center justify-center text-sm text-[#211f1b] hover:bg-[#e5dfd3]/50 disabled:opacity-40"
              >
                +
              </button>
            </div>

            <button
              type="button"
              disabled={selectedSizeStock <= 0 || availableSizes.length === 0 || !selectedSize}
              onClick={handleAdd}
              className="flex-1 bg-[#24231f] text-white border border-[#24231f] px-6 py-3.5 text-[11px] tracking-[0.18em] uppercase font-medium hover:bg-[#9a6746] hover:border-[#9a6746] transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              {addedFeedback ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Added to Bag</span>
                </>
              ) : availableSizes.length === 0 ? (
                <span>Size Unavailable</span>
              ) : selectedSizeStock > 0 ? (
                <span>Add to Bag &mdash; {formatINR(product.price_inr * qty)}</span>
              ) : (
                <span>Out of Stock</span>
              )}
            </button>
          </div>

          {/* Craftsmanship & Shipping Trust Details */}
          <div className="mt-7 pt-6 border-t border-[#e5dfd3] space-y-3.5 text-xs text-[#5f594f]">
            <div>
              <p className="text-[10px] tracking-[0.16em] uppercase font-semibold text-[#211f1b] mb-1">
                Fabric &amp; Care
              </p>
              <p>{product.fabric_care}</p>
            </div>
            <div className="flex items-start gap-2.5 pt-2">
              <Truck className="w-4 h-4 text-[#9a6746] shrink-0 mt-0.5" />
              <span>
                Complimentary shipping across India on orders above ₹1,499.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#9a6746] shrink-0 mt-0.5" />
              <span>
                Cash on Delivery (COD) and verified order tracking supported.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Related Pieces */}
      {relatedProducts.length > 0 && (
        <section className="mt-20 pt-12 border-t border-[#e5dfd3]">
          <div className="flex items-baseline justify-between mb-8">
            <h2 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b]">
              Complete the look
            </h2>
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] tracking-[0.14em] uppercase text-[#9a6746] hover:text-[#211f1b]"
            >
              View All &rarr;
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {relatedProducts.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectProduct(item)}
                className="group text-left"
              >
                <div className="aspect-[3/4] overflow-hidden bg-[#e9e3d8]">
                  <ResilientImage
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <p className="text-xs sm:text-sm font-semibold text-[#211f1b] mt-3 group-hover:text-[#9a6746] transition-colors">
                  {item.name}
                </p>
                <p className="text-[11px] text-[#817b70] mt-0.5">
                  {item.category} &middot; {item.garment_type}
                </p>
                <p className="text-xs sm:text-sm font-bold text-[#211f1b] mt-1.5 tabular-nums">
                  {formatINR(item.price_inr)}
                </p>
              </button>
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
