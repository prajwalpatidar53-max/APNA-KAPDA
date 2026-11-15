import type { Order, OrderStatus, PaymentStatus } from '../../types';

export type ShippingLayout = 'a4' | '4x6';

export interface AdminSenderConfig {
  senderName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
}

export interface ShippingFiltersState {
  dateFrom: string;
  dateTo: string;
  orderStatus: 'default_dispatch' | 'all' | OrderStatus;
  includeCancelled: boolean;
  includeDelivered: boolean;
  paymentMethod: 'all' | 'cod' | 'online_pending';
  paymentStatus: 'all' | PaymentStatus;
  orderIdQuery: string;
  customerQuery: string;
  cityQuery: string;
  pincodeQuery: string;
}

export interface OrderValidationResult {
  valid: boolean;
  issues: string[];
}

export interface SenderValidationResult {
  valid: boolean;
  issues: string[];
}

export interface ShippingStats {
  totalOrders: number;
  readyToShipOrders: number;
  shippedOrders: number;
  incompleteAddressOrders: number;
}

export const SENDER_CONFIG_STORAGE_KEY = 'apnakapda_admin_sender_config_v1';

export const DEFAULT_SENDER_CONFIG: AdminSenderConfig = {
  senderName: 'APNA KAPDA',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
};

export const DEFAULT_SHIPPING_FILTERS: ShippingFiltersState = {
  dateFrom: '',
  dateTo: '',
  orderStatus: 'default_dispatch',
  includeCancelled: false,
  includeDelivered: false,
  paymentMethod: 'all',
  paymentStatus: 'all',
  orderIdQuery: '',
  customerQuery: '',
  cityQuery: '',
  pincodeQuery: '',
};

export const READY_TO_SHIP_STATUSES: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
];

export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return null;
}

export function isValidIndianPincode(raw: string | null | undefined): boolean {
  return /^\d{6}$/.test(String(raw ?? '').trim());
}

export function loadAdminSenderConfig(): AdminSenderConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_SENDER_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(SENDER_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SENDER_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AdminSenderConfig> | null;
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_SENDER_CONFIG };
    }
    return {
      senderName:
        typeof parsed.senderName === 'string' && parsed.senderName.trim()
          ? parsed.senderName.trim()
          : DEFAULT_SENDER_CONFIG.senderName,
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
      addressLine1: typeof parsed.addressLine1 === 'string' ? parsed.addressLine1 : '',
      addressLine2: typeof parsed.addressLine2 === 'string' ? parsed.addressLine2 : '',
      city: typeof parsed.city === 'string' ? parsed.city : '',
      state: typeof parsed.state === 'string' ? parsed.state : '',
      pincode: typeof parsed.pincode === 'string' ? parsed.pincode : '',
    };
  } catch {
    return { ...DEFAULT_SENDER_CONFIG };
  }
}

export function saveAdminSenderConfig(config: AdminSenderConfig): AdminSenderConfig {
  const normalized: AdminSenderConfig = {
    senderName: config.senderName.trim() || 'APNA KAPDA',
    phone: config.phone.trim(),
    addressLine1: config.addressLine1.trim(),
    addressLine2: config.addressLine2.trim(),
    city: config.city.trim(),
    state: config.state.trim(),
    pincode: config.pincode.trim(),
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(
        SENDER_CONFIG_STORAGE_KEY,
        JSON.stringify(normalized)
      );
    } catch {
      // Ignore storage quota / privacy mode errors cleanly
    }
  }

  return normalized;
}

export function validateSenderConfig(
  config: AdminSenderConfig
): SenderValidationResult {
  const issues: string[] = [];

  if (!config.senderName || config.senderName.trim().length < 2) {
    issues.push('Sender / brand name is required');
  }
  if (!normalizeIndianPhone(config.phone)) {
    issues.push('Valid 10-digit sender contact phone is required');
  }
  if (!config.addressLine1 || config.addressLine1.trim().length < 3) {
    issues.push('Sender street / warehouse address (Line 1) is required');
  }
  if (!config.city || config.city.trim().length < 2) {
    issues.push('Sender city is required');
  }
  if (!config.state || config.state.trim().length < 2) {
    issues.push('Sender state is required');
  }
  if (!isValidIndianPincode(config.pincode)) {
    issues.push('Valid 6-digit sender PIN code is required');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function validateOrderForShipping(order: Order): OrderValidationResult {
  const issues: string[] = [];

  if (!order.customer_name || order.customer_name.trim().length < 2) {
    issues.push('Missing customer name');
  }

  if (!normalizeIndianPhone(order.customer_phone)) {
    issues.push('Missing or invalid 10-digit phone number');
  }

  const addr = order.shipping_address;
  if (!addr || typeof addr !== 'object') {
    issues.push('Missing delivery address');
  } else {
    if (!addr.line1 || addr.line1.trim().length < 3) {
      issues.push('Missing street / house address (Line 1)');
    }
    if (!addr.city || addr.city.trim().length < 2) {
      issues.push('Missing city');
    }
    if (!addr.state || addr.state.trim().length < 2) {
      issues.push('Missing state');
    }
    if (!isValidIndianPincode(addr.pincode)) {
      issues.push('Missing or invalid 6-digit PIN code');
    }
  }

  if (!Array.isArray(order.order_items) || order.order_items.length === 0) {
    issues.push('No order items recorded');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function deduplicateOrders(orders: Order[]): Order[] {
  const seen = new Set<string>();
  const unique: Order[] = [];
  for (const order of orders) {
    if (!order || !order.id || seen.has(order.id)) continue;
    seen.add(order.id);
    unique.push(order);
  }
  return unique;
}

function toLocalDateKey(isoOrDate: string): string | null {
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return null;
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function filterShippingOrders(
  orders: Order[],
  filters: ShippingFiltersState
): Order[] {
  const uniqueOrders = deduplicateOrders(orders);
  const orderIdQ = filters.orderIdQuery.trim().toLowerCase();
  const customerQ = filters.customerQuery.trim().toLowerCase();
  const customerDigits = customerQ.replace(/\D/g, '');
  const cityQ = filters.cityQuery.trim().toLowerCase();
  const pincodeQ = filters.pincodeQuery.trim().toLowerCase();

  return uniqueOrders.filter((order) => {
    if (filters.orderStatus === 'default_dispatch') {
      if (order.order_status === 'cancelled' && !filters.includeCancelled) {
        return false;
      }
      if (order.order_status === 'delivered' && !filters.includeDelivered) {
        return false;
      }
    } else if (filters.orderStatus !== 'all') {
      if (order.order_status !== filters.orderStatus) {
        return false;
      }
    }

    if (
      filters.paymentMethod !== 'all' &&
      order.payment_method !== filters.paymentMethod
    ) {
      return false;
    }

    if (
      filters.paymentStatus !== 'all' &&
      order.payment_status !== filters.paymentStatus
    ) {
      return false;
    }

    if (filters.dateFrom || filters.dateTo) {
      const orderDateKey = toLocalDateKey(order.created_at);
      if (!orderDateKey) return false;
      if (filters.dateFrom && orderDateKey < filters.dateFrom) return false;
      if (filters.dateTo && orderDateKey > filters.dateTo) return false;
    }

    if (orderIdQ) {
      const numMatch = order.order_number.toLowerCase().includes(orderIdQ);
      const idMatch = order.id.toLowerCase().includes(orderIdQ);
      if (!numMatch && !idMatch) return false;
    }

    if (customerQ) {
      const nameMatch = (order.customer_name || '').toLowerCase().includes(customerQ);
      const rawPhone = (order.customer_phone || '').toLowerCase();
      const phoneMatch = rawPhone.includes(customerQ);
      const phoneDigitsMatch =
        customerDigits.length >= 3 &&
        rawPhone.replace(/\D/g, '').includes(customerDigits);
      if (!nameMatch && !phoneMatch && !phoneDigitsMatch) return false;
    }

    if (cityQ) {
      const city = (order.shipping_address?.city || '').toLowerCase();
      if (!city.includes(cityQ)) return false;
    }

    if (pincodeQ) {
      const pin = (order.shipping_address?.pincode || '').toLowerCase();
      if (!pin.includes(pincodeQ)) return false;
    }

    return true;
  });
}

export function computeShippingStats(orders: Order[]): ShippingStats {
  const uniqueOrders = deduplicateOrders(orders);
  let readyToShipOrders = 0;
  let shippedOrders = 0;
  let incompleteAddressOrders = 0;

  for (const order of uniqueOrders) {
    if (READY_TO_SHIP_STATUSES.includes(order.order_status)) {
      readyToShipOrders += 1;
    }
    if (order.order_status === 'shipped') {
      shippedOrders += 1;
    }
    if (
      order.order_status !== 'cancelled' &&
      order.order_status !== 'delivered' &&
      !validateOrderForShipping(order).valid
    ) {
      incompleteAddressOrders += 1;
    }
  }

  return {
    totalOrders: uniqueOrders.length,
    readyToShipOrders,
    shippedOrders,
    incompleteAddressOrders,
  };
}

export function partitionOrdersByValidation(orders: Order[]): {
  validOrders: Order[];
  invalidEntries: { order: Order; issues: string[] }[];
} {
  const validOrders: Order[] = [];
  const invalidEntries: { order: Order; issues: string[] }[] = [];

  for (const order of deduplicateOrders(orders)) {
    const result = validateOrderForShipping(order);
    if (result.valid) {
      validOrders.push(order);
    } else {
      invalidEntries.push({ order, issues: result.issues });
    }
  }

  return { validOrders, invalidEntries };
}

export function formatPdfCurrency(amount: number): string {
  const safeValue = Math.round(Number(amount || 0));
  return `₹${safeValue.toLocaleString('en-IN')}`;
}

export function formatOrderTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function getLabelPaymentInfo(order: Order): {
  mode: 'COD' | 'PREPAID';
  subLabel: string;
  codCollectAmountInr: number | null;
} {
  if (order.payment_method === 'cod' && order.payment_status !== 'paid') {
    return {
      mode: 'COD',
      subLabel: 'CASH ON DELIVERY',
      codCollectAmountInr: Math.max(0, Math.round(Number(order.total_inr || 0))),
    };
  }

  if (order.payment_status === 'paid') {
    return {
      mode: 'PREPAID',
      subLabel: 'PAID ONLINE',
      codCollectAmountInr: null,
    };
  }

  return {
    mode: 'PREPAID',
    subLabel: `ONLINE (${order.payment_status.replace('_', ' ').toUpperCase()})`,
    codCollectAmountInr: null,
  };
}

export function formatFullAddressLines(
  address: Order['shipping_address'] | undefined | null
): { streetLines: string[]; cityStatePin: string } {
  const line1 = (address?.line1 || '').trim();
  const line2 = (address?.line2 || '').trim();
  const streetLines = [line1, line2].filter(Boolean);
  const city = (address?.city || '').trim();
  const state = (address?.state || '').trim();
  const pincode = (address?.pincode || '').trim();
  const cityState = [city, state].filter(Boolean).join(', ');
  const cityStatePin = pincode
    ? cityState
      ? `${cityState} - ${pincode}`
      : `PIN: ${pincode}`
    : cityState;

  return { streetLines, cityStatePin };
}
