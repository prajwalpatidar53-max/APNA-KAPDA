import type { Product } from '../types';

export function getConfiguredSizes(product: Pick<Product, 'sizes'>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of product.sizes ?? []) {
    const clean = typeof raw === 'string' ? raw.trim() : '';
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }

  return result;
}

export function hasSizeStockMap(product: Pick<Product, 'size_stock'>): boolean {
  return Boolean(
    product.size_stock &&
      typeof product.size_stock === 'object' &&
      !Array.isArray(product.size_stock) &&
      Object.keys(product.size_stock).length > 0
  );
}

export function getAvailableStockForSize(
  product: Pick<Product, 'sizes' | 'stock_count' | 'size_stock'>,
  size?: string | null
): number {
  const totalStock = Math.max(0, Math.floor(Number(product.stock_count) || 0));
  if (totalStock <= 0) return 0;

  const configuredSizes = getConfiguredSizes(product);
  const cleanSize = size?.trim() ?? '';
  if (!cleanSize || configuredSizes.length === 0) return 0;

  const isConfigured = configuredSizes.some(
    (s) => s.toLowerCase() === cleanSize.toLowerCase()
  );
  if (!isConfigured) return 0;

  if (hasSizeStockMap(product)) {
    const entries = Object.entries(product.size_stock ?? {});
    const match = entries.find(
      ([k]) => k.trim().toLowerCase() === cleanSize.toLowerCase()
    );
    if (!match) return 0;
    const sizeQty = Number(match[1]);
    if (!Number.isFinite(sizeQty) || sizeQty <= 0) return 0;
    return Math.min(totalStock, Math.floor(sizeQty));
  }

  return totalStock;
}

export function getFirstAvailableSize(
  product: Pick<Product, 'sizes' | 'stock_count' | 'size_stock'>
): string {
  const configured = getConfiguredSizes(product);
  if (configured.length === 0) return '';

  const preferredOrder = ['M', ...configured.filter((s) => s.toLowerCase() !== 'm')];
  for (const candidate of preferredOrder) {
    const matched = configured.find(
      (s) => s.toLowerCase() === candidate.toLowerCase()
    );
    if (matched && getAvailableStockForSize(product, matched) > 0) {
      return matched;
    }
  }

  return configured.find((s) => s.toLowerCase() === 'm') ?? configured[0];
}

export function getTotalAvailableStock(
  product: Pick<Product, 'sizes' | 'stock_count' | 'size_stock'>
): number {
  const totalStock = Math.max(0, Math.floor(Number(product.stock_count) || 0));
  if (totalStock <= 0) return 0;

  const configured = getConfiguredSizes(product);
  if (configured.length === 0) return 0;

  if (hasSizeStockMap(product)) {
    const hasAnySizeStock = configured.some(
      (s) => getAvailableStockForSize(product, s) > 0
    );
    return hasAnySizeStock ? totalStock : 0;
  }

  return totalStock;
}
