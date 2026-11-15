import heroEditorialImg from '../assets/images/hero_apna_kapda_1794581606448.jpg';
import categoryMenImg from '../assets/images/category_men_editorial_1794581605722.jpg';
import categoryWomenImg from '../assets/images/category_women_editorial_1794581606930.jpg';
import categoryUnisexImg from '../assets/images/category_unisex_editorial_1794581606956.jpg';
import storyAtelierImg from '../assets/images/story_atelier_craft_1794581608598.jpg';

import prodOversizedTeeImg from '../assets/images/prod_oversized_tee_1794581607511.jpg';
import prodLinenShirtImg from '../assets/images/prod_linen_shirt_1794581608413.jpg';
import prodEssentialTopImg from '../assets/images/prod_essential_top_1794581609142.jpg';
import prodRelaxedTrousersImg from '../assets/images/prod_relaxed_trousers_1794581608040.jpg';
import prodStreetTeeImg from '../assets/images/prod_street_tee_1794581608749.jpg';
import prodUrbanLayerImg from '../assets/images/prod_urban_layer_1794581609820.jpg';
import prodSignatureDenimImg from '../assets/images/prod_signature_denim_1794581609709.jpg';
import prodDailyDressImg from '../assets/images/prod_daily_dress_1794581611345.jpg';

import type { Product, ProductCategory } from '../types';

export const BRAND_IMAGES = {
  hero: heroEditorialImg,
  story: storyAtelierImg,
  categories: {
    Men: categoryMenImg,
    Women: categoryWomenImg,
    Unisex: categoryUnisexImg,
  } as Record<ProductCategory, string>,
};

const DEMO_PREVIEW_PRODUCT_SEED: Product[] = [
  {
    id: 'ak-classic-oversized-tee',
    name: 'Classic Oversized Tee',
    slug: 'classic-oversized-tee',
    description:
      'Cut from 240 GSM combed Indian organic cotton in a relaxed drop-shoulder silhouette. Soft enzyme wash gives it a lived-in drape tailored for warm afternoons and layered evenings.',
    category: 'Unisex',
    garment_type: 'T-Shirts',
    price_inr: 799,
    compare_at_price_inr: 999,
    tag: 'BESTSELLER',
    fabric_care: '100% Combed Organic Cotton (240 GSM) · Machine wash cold, dry in shade',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    stock_count: 42,
    image_url: prodOversizedTeeImg,
    is_active: true,
    is_demo: true,
  },
  {
    id: 'ak-everyday-linen-shirt',
    name: 'Everyday Linen Shirt',
    slug: 'everyday-linen-shirt',
    description:
      'Woven from breathable long-staple European & Indian flax blend in warm terracotta earth. Tailored with mother-of-pearl buttons and a clean curved hem for effortless day-to-evening dressing.',
    category: 'Men',
    garment_type: 'Shirts',
    price_inr: 1299,
    compare_at_price_inr: 1599,
    tag: 'NEW DROP',
    fabric_care: '70% Linen, 30% Combed Cotton · Gentle cold wash, steam press while damp',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    stock_count: 28,
    image_url: prodLinenShirtImg,
    is_active: true,
    is_demo: true,
  },
  {
    id: 'ak-modern-essential-top',
    name: 'Modern Essential Top',
    slug: 'modern-essential-top',
    description:
      'A sculpted ribbed knit tank spun from soft breathable cotton yarn. Holds its structure without clinging, designed to pair effortlessly under overshirts or with high-waisted trousers.',
    category: 'Women',
    garment_type: 'Tops',
    price_inr: 899,
    compare_at_price_inr: 1199,
    tag: 'POPULAR',
    fabric_care: '95% Supima Cotton, 5% Elastane · Hand wash cold, lay flat to dry',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    stock_count: 34,
    image_url: prodEssentialTopImg,
    is_active: true,
    is_demo: true,
  },
  {
    id: 'ak-relaxed-fit-trousers',
    name: 'Relaxed Fit Trousers',
    slug: 'relaxed-fit-trousers',
    description:
      'Double-pleated tailored cotton twill trousers featuring a comfortable mid-rise waist, deep side pockets, and a clean tapered fall from hip to ankle.',
    category: 'Men',
    garment_type: 'Bottomwear',
    price_inr: 1499,
    compare_at_price_inr: 1799,
    tag: 'LIMITED',
    fabric_care: '100% Peached Cotton Twill · Machine wash gentle, warm iron',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    stock_count: 19,
    image_url: prodRelaxedTrousersImg,
    is_active: true,
    is_demo: true,
  },
  {
    id: 'ak-everyday-street-tee',
    name: 'Everyday Street Tee',
    slug: 'everyday-street-tee',
    description:
      'Boxy contemporary fit dyed in earthy olive-sand with reinforced collar ribbing and clean double-needle stitching. Built for movement and everyday ease.',
    category: 'Women',
    garment_type: 'T-Shirts',
    price_inr: 749,
    compare_at_price_inr: 999,
    tag: 'TRENDING',
    fabric_care: '100% Bio-Washed Cotton (210 GSM) · Cold gentle cycle',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    stock_count: 39,
    image_url: prodStreetTeeImg,
    is_active: true,
    is_demo: true,
  },
  {
    id: 'ak-urban-layer-shirt',
    name: 'Urban Layer Shirt',
    slug: 'urban-layer-shirt',
    description:
      'Structured waffle-textured handloom cotton overshirt with dual utility patch pockets. Designed as an all-season third piece over tees or light knits.',
    category: 'Unisex',
    garment_type: 'Shirts',
    price_inr: 1199,
    compare_at_price_inr: 1499,
    tag: 'NEW',
    fabric_care: '100% Handloom Slub Cotton · Cold wash separately, line dry',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    stock_count: 24,
    image_url: prodUrbanLayerImg,
    is_active: true,
    is_demo: true,
  },
  {
    id: 'ak-signature-denim',
    name: 'Signature Denim',
    slug: 'signature-denim',
    description:
      '13 oz charcoal-indigo raw selvedge cotton denim cut in a timeless straight leg. Finished with antique brass hardware and reinforced seams that mould to you over time.',
    category: 'Men',
    garment_type: 'Denim',
    price_inr: 1799,
    compare_at_price_inr: 2199,
    tag: 'BESTSELLER',
    fabric_care: '100% Raw Selvedge Cotton Denim · Wash sparingly inside out in cold water',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    stock_count: 16,
    image_url: prodSignatureDenimImg,
    is_active: true,
    is_demo: true,
  },
  {
    id: 'ak-minimal-daily-dress',
    name: 'Minimal Daily Dress',
    slug: 'minimal-daily-dress',
    description:
      'An airy A-line midi silhouette in warm desert sand linen-cotton with discreet side-seam pockets and three-quarter sleeves tailored for effortless grace.',
    category: 'Women',
    garment_type: 'Dresses',
    price_inr: 1599,
    compare_at_price_inr: 1999,
    tag: 'NEW DROP',
    fabric_care: '60% Cotton, 40% Linen · Gentle cold wash, steam press',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    stock_count: 21,
    image_url: prodDailyDressImg,
    is_active: true,
    is_demo: true,
  },
];

export const PREVIEW_PRODUCTS: Product[] = DEMO_PREVIEW_PRODUCT_SEED;

export function isDemoProductId(productId?: string | null): boolean {
  return typeof productId === 'string' && productId.trim().startsWith('ak-');
}

export function isDemoProduct(
  product?: Pick<Product, 'id' | 'is_demo'> | null
): boolean {
  if (!product) return false;
  return Boolean(product.is_demo) || isDemoProductId(product.id);
}

export const FREE_SHIPPING_THRESHOLD_INR = 1499;
export const STANDARD_SHIPPING_FEE_INR = 99;

export function formatINR(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

export interface SizeChartRow {
  size: string;
  chestIn: number;
  waistIn: number;
  shoulderIn: number;
  lengthIn: number;
}

export const TOPS_SIZE_CHART: SizeChartRow[] = [
  { size: 'XS', chestIn: 36, waistIn: 30, shoulderIn: 16.5, lengthIn: 26.5 },
  { size: 'S', chestIn: 38, waistIn: 32, shoulderIn: 17.5, lengthIn: 27.5 },
  { size: 'M', chestIn: 40, waistIn: 34, shoulderIn: 18.5, lengthIn: 28.5 },
  { size: 'L', chestIn: 42, waistIn: 36, shoulderIn: 19.5, lengthIn: 29.5 },
  { size: 'XL', chestIn: 44, waistIn: 38, shoulderIn: 20.5, lengthIn: 30.5 },
  { size: 'XXL', chestIn: 46, waistIn: 40, shoulderIn: 21.5, lengthIn: 31.5 },
];

export interface BottomsSizeChartRow {
  size: string;
  indianWaist: string;
  waistIn: number;
  hipIn: number;
  inseamIn: number;
}

export const BOTTOMS_SIZE_CHART: BottomsSizeChartRow[] = [
  { size: 'XS', indianWaist: '28', waistIn: 28.5, hipIn: 36, inseamIn: 29.5 },
  { size: 'S', indianWaist: '30', waistIn: 30.5, hipIn: 38, inseamIn: 30.0 },
  { size: 'M', indianWaist: '32', waistIn: 32.5, hipIn: 40, inseamIn: 30.5 },
  { size: 'L', indianWaist: '34', waistIn: 34.5, hipIn: 42, inseamIn: 31.0 },
  { size: 'XL', indianWaist: '36', waistIn: 36.5, hipIn: 44, inseamIn: 31.5 },
  { size: 'XXL', indianWaist: '38', waistIn: 38.5, hipIn: 46, inseamIn: 32.0 },
];
