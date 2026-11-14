import { BRAND_IMAGES, PREVIEW_PRODUCTS } from '../data/catalog';
import { SUPABASE_URL } from '../lib/supabase';
import type { Product } from '../types';

const DEFAULT_STORAGE_BUCKET = 'product-images';

/**
 * Map stable asset filename prefixes (from src/assets/images/*) to the current
 * Vite-bundled production URLs. This prevents broken images when Supabase rows
 * store a dev path (/src/assets/images/...) or a stale build hash (/assets/...-oldhash.jpg).
 */
const BUNDLED_ASSET_ENTRIES: Array<[string, string]> = [
  ['hero_apna_kapda_1794581606448', BRAND_IMAGES.hero],
  ['category_men_editorial_1794581605722', BRAND_IMAGES.categories.Men],
  ['category_women_editorial_1794581606930', BRAND_IMAGES.categories.Women],
  ['category_unisex_editorial_1794581606956', BRAND_IMAGES.categories.Unisex],
  ['story_atelier_craft_1794581608598', BRAND_IMAGES.story],
  ['prod_oversized_tee_1794581607511', PREVIEW_PRODUCTS[0].image_url],
  ['prod_linen_shirt_1794581608413', PREVIEW_PRODUCTS[1].image_url],
  ['prod_essential_top_1794581609142', PREVIEW_PRODUCTS[2].image_url],
  ['prod_relaxed_trousers_1794581608040', PREVIEW_PRODUCTS[3].image_url],
  ['prod_street_tee_1794581608749', PREVIEW_PRODUCTS[4].image_url],
  ['prod_urban_layer_1794581609820', PREVIEW_PRODUCTS[5].image_url],
  ['prod_signature_denim_1794581609709', PREVIEW_PRODUCTS[6].image_url],
  ['prod_daily_dress_1794581611345', PREVIEW_PRODUCTS[7].image_url],
];

const PREVIEW_IMAGE_BY_SLUG = new Map<string, string>(
  PREVIEW_PRODUCTS.map((p) => [p.slug, p.image_url])
);

function stripQuotesAndWhitespace(value?: string | null): string {
  return (value ?? '').trim().replace(/^['"]+|['"]+$/g, '').trim();
}

function matchBundledAsset(raw: string): string | null {
  for (const [prefix, bundledUrl] of BUNDLED_ASSET_ENTRIES) {
    if (raw.includes(prefix)) {
      return bundledUrl;
    }
  }
  return null;
}

function isLocalOrDevOrigin(raw: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?\//i.test(
    raw
  );
}

function isEphemeralPreviewOrigin(raw: string): boolean {
  return /^https?:\/\/ais-(dev|pre)-[^/]+\.run\.app\//i.test(raw);
}

/**
 * Resolves any stored product image reference into a valid, production-safe URL:
 * - Maps dev (/src/assets/...) and stale Vite-hashed (/assets/...-hash.jpg) paths to live bundled assets.
 * - Converts localhost / ephemeral AI Studio dev URLs referencing bundled assets or storage paths.
 * - Resolves relative Supabase Storage paths (e.g. "products/...", "product-images/...",
 *   "/storage/v1/object/public/...") against the active SUPABASE_URL.
 * - Normalizes "/storage/v1/object/authenticated/" to "/storage/v1/object/public/" for public buckets.
 * - Upgrades http:// Supabase Storage URLs to https:// to avoid mixed-content blocks on Vercel.
 */
export function resolveProductImageUrl(
  rawUrl?: string | null,
  slug?: string
): string {
  const cleaned = stripQuotesAndWhitespace(rawUrl);
  if (!cleaned) {
    return slug ? (PREVIEW_IMAGE_BY_SLUG.get(slug) ?? '') : '';
  }

  if (cleaned.startsWith('data:image/') || cleaned.startsWith('blob:')) {
    return cleaned;
  }

  // 1. Check if the reference corresponds to one of the known bundled editorial images
  //    (covers /src/assets/images/..., old /assets/*-hash.jpg, and http://localhost:3000/...).
  const bundledMatch = matchBundledAsset(cleaned);
  if (bundledMatch) {
    return bundledMatch;
  }

  // 2. If it's a localhost or ephemeral dev origin without a known filename prefix,
  //    extract its pathname so we can resolve storage paths or slug fallbacks cleanly.
  let candidate = cleaned;
  if (isLocalOrDevOrigin(candidate) || isEphemeralPreviewOrigin(candidate)) {
    try {
      const parsed = new URL(candidate);
      candidate = `${parsed.pathname}${parsed.search}`;
    } catch {
      // keep candidate
    }
  }

  // 3. Broken dev-only /src/... path that doesn't exist in Vercel's dist/ bundle
  if (candidate.startsWith('/src/') || candidate.startsWith('src/')) {
    if (slug && PREVIEW_IMAGE_BY_SLUG.has(slug)) {
      return PREVIEW_IMAGE_BY_SLUG.get(slug)!;
    }
  }

  // 4. Relative or full Supabase Storage paths
  if (candidate.startsWith('/storage/v1/')) {
    const publicPath = candidate.replace(
      '/storage/v1/object/authenticated/',
      '/storage/v1/object/public/'
    );
    return `${SUPABASE_URL}${publicPath}`;
  }

  if (candidate.startsWith('storage/v1/')) {
    const publicPath = candidate.replace(
      'storage/v1/object/authenticated/',
      'storage/v1/object/public/'
    );
    return `${SUPABASE_URL}/${publicPath}`;
  }

  // Bare bucket-prefixed path: "product-images/products/file.jpg"
  if (candidate.startsWith(`${DEFAULT_STORAGE_BUCKET}/`)) {
    return `${SUPABASE_URL}/storage/v1/object/public/${candidate}`;
  }

  // Bare object key stored from supabase.storage.upload(): "products/file.jpg"
  if (
    candidate.startsWith('products/') ||
    (!candidate.startsWith('/') && !/^https?:\/\//i.test(candidate))
  ) {
    return `${SUPABASE_URL}/storage/v1/object/public/${DEFAULT_STORAGE_BUCKET}/${candidate.replace(
      /^\/+/,
      ''
    )}`;
  }

  // 5. Full HTTP(S) URLs
  if (/^https?:\/\//i.test(candidate)) {
    let normalized = candidate;
    // Upgrade http:// supabase.co URLs to https:// to avoid mixed-content errors on Vercel
    if (normalized.startsWith('http://') && normalized.includes('supabase.co')) {
      normalized = `https://${normalized.slice('http://'.length)}`;
    }
    normalized = normalized.replace(
      '/storage/v1/object/authenticated/',
      '/storage/v1/object/public/'
    );
    return normalized;
  }

  return candidate;
}

/**
 * Normalizes a Product record's image_url and gallery_images non-destructively in memory.
 */
export function normalizeProductImages(product: Product): Product {
  const rawGallery = Array.isArray(product.gallery_images)
    ? product.gallery_images
    : [];
  const resolvedGallery = rawGallery
    .map((url) => resolveProductImageUrl(url, product.slug))
    .filter(Boolean);

  const resolvedPrimary =
    resolveProductImageUrl(product.image_url, product.slug) ||
    resolvedGallery[0] ||
    '';

  const mergedGallery =
    resolvedGallery.length > 0
      ? resolvedGallery
      : resolvedPrimary
        ? [resolvedPrimary]
        : [];

  return {
    ...product,
    image_url: resolvedPrimary,
    gallery_images: mergedGallery,
  };
}
