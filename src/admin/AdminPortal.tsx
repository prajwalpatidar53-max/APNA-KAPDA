import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Landmark,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Tag,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Order, Product, UserProfile } from '../types';
import { AdminAnalytics } from './AdminAnalytics';
import { AdminBulkShipping } from './AdminBulkShipping';
import { AdminCustomers } from './AdminCustomers';
import { AdminFinance } from './AdminFinance';
import { AdminLogin } from './AdminLogin';
import { ADMIN_EASE, ADMIN_PAGE_VARIANTS } from './AdminMotion';
import { AdminOffers } from './AdminOffers';
import { AdminOrders } from './AdminOrders';
import { AdminProducts } from './AdminProducts';
import {
  type AdminSessionState,
  fetchAdminCustomers,
  fetchAdminOrders,
  fetchAdminProducts,
  signOutAdmin,
  verifyAdminSession,
} from './adminService';
import { computeShippingStats } from './shipping/shippingUtils';

export type AdminTab =
  | 'overview'
  | 'finance'
  | 'products'
  | 'orders'
  | 'bulk-shipping'
  | 'offers'
  | 'customers'
  | 'setup';

interface NavGroup {
  label: string;
  items: {
    id: AdminTab;
    label: string;
    icon: typeof BarChart3;
    count?: number;
  }[];
}

const ADMIN_MIGRATION_SQL = `-- Run in Supabase SQL Editor (non-destructive)
alter table public.products
  add column if not exists colors text[] not null default array[]::text[];

alter table public.products
  add column if not exists gallery_images text[] not null default array[]::text[];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880;

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
  on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_admin());`;

function getInitials(name?: string | null, email?: string | null): string {
  const src = (name || email || 'AK').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

export default function AdminPortal() {
  const [sessionState, setSessionState] = useState<AdminSessionState>({
    status: 'loading',
  });
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<UserProfile[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState('');
  const [inspectOrderId, setInspectOrderId] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const loadAllAdminData = useCallback(async () => {
    setLoadingData(true);
    setDataError('');

    const [prodRes, orderRes, custRes] = await Promise.all([
      fetchAdminProducts(),
      fetchAdminOrders(),
      fetchAdminCustomers(),
    ]);

    setProducts(prodRes.products);
    setOrders(orderRes.orders);
    setCustomers(custRes.customers);

    const errors = [prodRes.error, orderRes.error, custRes.error].filter(Boolean);
    if (errors.length > 0) {
      setDataError(errors.join(' · '));
    }

    setLoadingData(false);
  }, []);

  const checkSession = useCallback(async () => {
    const state = await verifyAdminSession();
    setSessionState(state);
    if (state.status === 'authorized') {
      await loadAllAdminData();
    }
  }, [loadAllAdminData]);

  useEffect(() => {
    document.title = 'APNA KAPDA — Admin Dashboard V2';
    checkSession();

    if (!supabase) return;
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      } else if (event === 'SIGNED_OUT') {
        setSessionState({ status: 'unauthenticated' });
        setProducts([]);
        setOrders([]);
        setCustomers([]);
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [checkSession]);

  const handleAuthorized = async (nextState: AdminSessionState) => {
    setSessionState(nextState);
    if (nextState.status === 'authorized') {
      await loadAllAdminData();
    }
  };

  const handleSignOut = async () => {
    await signOutAdmin();
    setSessionState({ status: 'unauthenticated' });
  };

  const handleInspectOrder = (order: Order) => {
    setInspectOrderId(order.id);
    setActiveTab('orders');
    setQuickSearch('');
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(ADMIN_MIGRATION_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      // Clipboard fallback not needed
    }
  };

  const quickResults = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    if (q.length < 2) return null;
    const matchedOrders = orders
      .filter(
        (o) =>
          o.order_number.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q) ||
          o.customer_phone.toLowerCase().includes(q)
      )
      .slice(0, 4);
    const matchedProducts = products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
      )
      .slice(0, 3);
    return { matchedOrders, matchedProducts };
  }, [quickSearch, orders, products]);

  if (sessionState.status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a2533] via-[#154c5e] to-[#0a202d] text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="font-serif-display text-2xl tracking-[0.06em] text-white">
            APNA KAPDA
          </p>
          <div className="w-32 h-1 rounded-full bg-white/15 overflow-hidden mx-auto">
            <div className="w-1/2 h-full bg-cyan-300 rounded-full animate-pulse" />
          </div>
          <p className="text-xs text-cyan-100/75">
            Verifying administrator credentials...
          </p>
        </div>
      </div>
    );
  }

  if (sessionState.status !== 'authorized' || isRecoveryMode) {
    return (
      <AdminLogin
        sessionState={sessionState}
        isRecoveryMode={isRecoveryMode}
        onAuthorized={handleAuthorized}
        onRecoveryComplete={() => {
          setIsRecoveryMode(false);
          checkSession();
        }}
      />
    );
  }

  const readyToShipCount = computeShippingStats(orders).readyToShipOrders;
  const liveOrderCount = orders.filter((o) => !o.is_test_order).length;

  const navGroups: NavGroup[] = [
    {
      label: 'Dashboard',
      items: [
        { id: 'overview', label: 'Overview', icon: BarChart3 },
        { id: 'finance', label: 'Finance', icon: Landmark },
      ],
    },
    {
      label: 'Commerce',
      items: [
        { id: 'orders', label: 'Orders', icon: ShoppingBag, count: liveOrderCount },
        { id: 'products', label: 'Products', icon: Package, count: products.length },
        { id: 'customers', label: 'Customers', icon: Users, count: customers.length },
      ],
    },
    {
      label: 'Operations',
      items: [
        {
          id: 'bulk-shipping',
          label: 'Shipping Center',
          icon: Truck,
          count: readyToShipCount,
        },
        { id: 'offers', label: 'Offers & Banners', icon: Tag },
      ],
    },
    {
      label: 'System',
      items: [{ id: 'setup', label: 'SQL & Deploy', icon: Database }],
    },
  ];

  const allNavItems = navGroups.flatMap((g) => g.items);
  const activeLabel =
    allNavItems.find((item) => item.id === activeTab)?.label ?? 'Overview';

  const adminName = sessionState.profile.full_name || 'Administrator';
  const adminEmail = sessionState.profile.email || sessionState.user.email || '';
  const adminInitials = getInitials(adminName, adminEmail);

  const renderSidebarBody = (isMobile: boolean) => {
    const compact = !isMobile && sidebarCollapsed;

    return (
      <div className="flex flex-col h-full bg-[#071c27]/85 backdrop-blur-xl border-r border-white/10 text-slate-200 select-none">
        {/* Brand Header */}
        <div
          className={`flex items-center border-b border-white/10 h-16 shrink-0 ${
            compact ? 'justify-center px-2' : 'justify-between px-5'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400/25 via-teal-400/15 to-white/10 border border-cyan-300/30 flex items-center justify-center shrink-0">
              <span className="font-serif-display text-sm font-semibold text-cyan-200 tracking-wide">
                AK
              </span>
            </div>
            {!compact && (
              <div className="min-w-0">
                <p className="font-serif-display text-base font-semibold tracking-[0.04em] text-white truncate">
                  APNA KAPDA
                </p>
                <p className="text-[11px] text-cyan-100/60 truncate">
                  Control Center
                </p>
              </div>
            )}
          </div>

          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!compact && (
                <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={compact ? item.label : undefined}
                      onClick={() => {
                        setActiveTab(item.id);
                        if (isMobile) setMobileNavOpen(false);
                      }}
                      className={`relative w-full flex items-center rounded-xl transition-colors duration-150 cursor-pointer min-h-[42px] ${
                        compact
                          ? 'justify-center px-2 py-2.5'
                          : 'justify-between px-3 py-2.5'
                      } ${
                        active
                          ? 'text-white'
                          : 'text-slate-300/80 hover:text-white hover:bg-white/[0.06]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId={
                            isMobile ? 'admin-nav-active-mobile' : 'admin-nav-active'
                          }
                          transition={{ duration: 0.24, ease: ADMIN_EASE }}
                          className="absolute inset-0 rounded-xl bg-white/[0.14] border border-white/20 shadow-sm"
                        />
                      )}

                      <span className="relative z-10 inline-flex items-center gap-3 min-w-0">
                        <Icon
                          className={`w-[17px] h-[17px] shrink-0 transition-colors ${
                            active ? 'text-cyan-300' : 'text-cyan-100/60'
                          }`}
                        />
                        {!compact && (
                          <span className="text-[13px] font-medium truncate whitespace-nowrap">
                            {item.label}
                          </span>
                        )}
                      </span>

                      {!compact && typeof item.count === 'number' && (
                        <span
                          className={`relative z-10 text-[11px] px-2 py-0.5 rounded-full tabular-nums shrink-0 ${
                            active
                              ? 'bg-cyan-300/20 text-cyan-200 font-semibold'
                              : 'bg-white/[0.06] text-cyan-100/65'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer Profile & Sign Out */}
        <div className="p-3 border-t border-white/10 space-y-2 shrink-0">
          {!compact && (
            <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl bg-white/[0.06] border border-white/10">
              <div className="w-8 h-8 rounded-full bg-cyan-400/20 border border-cyan-300/30 flex items-center justify-center text-xs font-semibold text-cyan-100 shrink-0">
                {adminInitials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate">
                  {adminName}
                </p>
                <p className="text-[11px] text-cyan-100/60 truncate">
                  {adminEmail}
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            title={compact ? 'Sign Out' : undefined}
            className={`w-full flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] hover:bg-rose-500/20 hover:border-rose-400/40 hover:text-rose-100 text-slate-200 text-xs font-medium transition-colors cursor-pointer min-h-[40px] ${
              compact ? 'px-2' : 'px-3'
            }`}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!compact && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0b2634] via-[#165062] to-[#0a212e] text-slate-100 flex overflow-x-clip">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? 'w-[78px]' : 'w-[248px]'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarBody(false)}</div>
      </aside>

      {/* Mobile Animated Sidebar Drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px] lg:hidden flex"
            onClick={() => setMobileNavOpen(false)}
          >
            <motion.aside
              initial={{ x: -272 }}
              animate={{ x: 0 }}
              exit={{ x: -272 }}
              transition={{ duration: 0.25, ease: ADMIN_EASE }}
              className="w-[264px] max-w-[84vw] h-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {renderSidebarBody(true)}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Workspace Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Translucent Teal Header Bar (mirrors reference screenshot) */}
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 lg:px-7 flex items-center justify-between gap-4 bg-[#0d3141]/60 backdrop-blur-md border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1 rounded-xl text-white/85 hover:text-white hover:bg-white/10 transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/15 bg-white/[0.06] text-cyan-100 hover:text-white hover:bg-white/15 transition-colors cursor-pointer shrink-0"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>

            {/* Global Quick Search Input */}
            <div className="relative flex-1 max-w-md hidden sm:block">
              <Search className="w-4 h-4 text-cyan-100/60 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder="Search orders, customers, products..."
                aria-label="Quick search admin records"
                className="w-full pl-10 pr-8 py-2 rounded-full text-xs bg-white/10 border border-white/15 focus:bg-white/15 focus:border-cyan-300/50 outline-none text-white placeholder:text-cyan-100/55 transition-colors"
              />
              {quickSearch && (
                <button
                  type="button"
                  onClick={() => setQuickSearch('')}
                  aria-label="Clear quick search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-100/70 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {quickResults && (
                <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl bg-white text-[#0f2430] border border-slate-200 shadow-2xl overflow-hidden z-50">
                  {quickResults.matchedOrders.length === 0 &&
                  quickResults.matchedProducts.length === 0 ? (
                    <p className="p-4 text-xs text-[#647d89]">
                      No orders or products match &ldquo;{quickSearch}&rdquo;.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                      {quickResults.matchedOrders.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => handleInspectOrder(o)}
                          className="w-full px-4 py-2.5 text-left hover:bg-[#eef6f8] flex items-center justify-between gap-2 text-xs cursor-pointer"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-[#0f2430] truncate">
                              {o.order_number} &middot; {o.customer_name}
                            </p>
                            <p className="text-[11px] text-[#647d89]">
                              {o.order_status} &middot; {o.shipping_address.city}
                            </p>
                          </div>
                          <span className="text-[10px] uppercase font-semibold text-[#0e7490] shrink-0">
                            Order
                          </span>
                        </button>
                      ))}
                      {quickResults.matchedProducts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setActiveTab('products');
                            setQuickSearch('');
                          }}
                          className="w-full px-4 py-2.5 text-left hover:bg-[#eef6f8] flex items-center justify-between gap-2 text-xs cursor-pointer"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-[#0f2430] truncate">
                              {p.name}
                            </p>
                            <p className="text-[11px] text-[#647d89]">
                              {p.category} &middot; Stock {p.stock_count}
                            </p>
                          </div>
                          <span className="text-[10px] uppercase font-semibold text-emerald-700 shrink-0">
                            Product
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <span className="sm:hidden text-sm font-semibold text-white truncate">
              {activeLabel}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={loadAllAdminData}
              disabled={loadingData}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-white/15 bg-white/10 hover:bg-white/18 text-xs font-medium text-white transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap min-h-[36px]"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-cyan-200 ${
                  loadingData ? 'animate-spin' : ''
                }`}
              />
              <span>{loadingData ? 'Syncing' : 'Refresh'}</span>
            </button>

            <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-white/15">
              <div className="w-8 h-8 rounded-full bg-white/90 text-[#0e394a] flex items-center justify-center text-xs font-bold shadow-xs">
                {adminInitials}
              </div>
              <div className="leading-tight">
                <p className="text-xs font-semibold text-white max-w-[140px] truncate">
                  {adminName}
                </p>
                <p className="text-[11px] text-cyan-100/70">Admin</p>
              </div>
            </div>
          </div>
        </header>

        {/* Light Frosted-Glass Main Workspace Container (exact reference aesthetic) */}
        <main className="flex-1 p-3 sm:p-5 lg:p-6 max-w-[1480px] w-full mx-auto">
          <div className="rounded-[26px] bg-[#edf4f6]/94 backdrop-blur-md border border-white/80 shadow-[0_24px_60px_-20px_rgba(4,18,28,0.45)] text-[#0f2430] p-4 sm:p-6 lg:p-7 min-h-[calc(100vh-112px)]">
            {dataError && (
              <div className="mb-5 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                <strong className="font-semibold">Database Notice:</strong>{' '}
                {dataError}
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                variants={ADMIN_PAGE_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                {activeTab === 'overview' && (
                  <AdminAnalytics
                    orders={orders}
                    products={products}
                    customers={customers}
                    loading={loadingData}
                    onNavigateTab={(tab) => setActiveTab(tab)}
                    onInspectOrder={handleInspectOrder}
                  />
                )}

                {activeTab === 'finance' && (
                  <AdminFinance
                    orders={orders}
                    loading={loadingData}
                    onInspectOrder={handleInspectOrder}
                  />
                )}

                {activeTab === 'products' && (
                  <AdminProducts
                    products={products}
                    loading={loadingData}
                    onRefresh={loadAllAdminData}
                  />
                )}

                {activeTab === 'orders' && (
                  <AdminOrders
                    orders={orders}
                    products={products}
                    loading={loadingData}
                    initialOrderId={inspectOrderId}
                    onClearInitialOrder={() => setInspectOrderId(null)}
                    onRefresh={loadAllAdminData}
                  />
                )}

                {activeTab === 'bulk-shipping' && (
                  <AdminBulkShipping
                    orders={orders}
                    loading={loadingData}
                    onRefresh={loadAllAdminData}
                    onInspectOrder={handleInspectOrder}
                  />
                )}

                {activeTab === 'offers' && (
                  <AdminOffers
                    products={products}
                    onDataChanged={loadAllAdminData}
                  />
                )}

                {activeTab === 'customers' && (
                  <AdminCustomers
                    customers={customers}
                    orders={orders}
                    loading={loadingData}
                    onInspectOrder={handleInspectOrder}
                  />
                )}

                {activeTab === 'setup' && (
                  <div className="space-y-5">
                    <section className="rounded-[22px] bg-white/90 border border-white p-6 shadow-xs">
                      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100">
                        <div>
                          <p className="text-xs font-semibold text-[#0e7490]">
                            Non-Destructive Migration
                          </p>
                          <h2 className="font-sans text-xl font-semibold text-[#0f2430] mt-1">
                            Product Media Bucket &amp; Colours Schema
                          </h2>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopySql}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0f2430] text-white text-xs font-semibold hover:bg-[#0e7490] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {copiedSql ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Copied SQL</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy SQL</span>
                            </>
                          )}
                        </button>
                      </div>

                      <p className="text-xs text-[#546e7a] mt-4 leading-relaxed">
                        Run{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          supabase/admin_migration.sql
                        </code>{' '}
                        in your Supabase SQL Editor to add{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          colors
                        </code>{' '}
                        and{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          gallery_images
                        </code>{' '}
                        columns to{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          public.products
                        </code>{' '}
                        and create the{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          product-images
                        </code>{' '}
                        Storage bucket with admin-only RLS write policies.
                      </p>

                      <pre className="mt-4 p-4 rounded-2xl bg-[#0c2330] text-cyan-50 text-xs font-mono overflow-x-auto leading-relaxed">
                        {ADMIN_MIGRATION_SQL}
                      </pre>
                    </section>

                    <section className="rounded-[22px] bg-white/90 border border-white p-6 shadow-xs">
                      <p className="text-xs font-semibold text-[#0e7490]">
                        Independent Subdomain Deployment
                      </p>
                      <h2 className="font-sans text-xl font-semibold text-[#0f2430] mt-1">
                        Deploying at admin.apnakapda.com
                      </h2>
                      <p className="text-xs text-[#546e7a] mt-3 leading-relaxed">
                        The entire admin application lives inside{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          src/admin/
                        </code>{' '}
                        and mounts automatically whenever the browser visits{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          /admin
                        </code>{' '}
                        or any{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          admin.*
                        </code>{' '}
                        hostname (such as{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          admin.apnakapda.com
                        </code>
                        ). Point the subdomain to the build output with{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          VITE_SUPABASE_URL
                        </code>{' '}
                        and{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          VITE_SUPABASE_ANON_KEY
                        </code>{' '}
                        configured, and add{' '}
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[#0f2430]">
                          https://admin.apnakapda.com
                        </code>{' '}
                        to Supabase Authentication &rarr; URL Configuration &rarr;
                        Redirect URLs.
                      </p>
                    </section>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
