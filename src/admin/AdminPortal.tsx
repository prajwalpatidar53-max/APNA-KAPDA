import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  LogOut,
  Menu,
  Package,
  RefreshCw,
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
    document.title = 'APNA KAPDA — Admin Dashboard';
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

  if (sessionState.status === 'loading') {
    return (
      <div className="min-h-screen bg-[#080c12] bg-[radial-gradient(ellipse_at_top_left,_rgba(20,62,74,0.3),_transparent_52%)] text-slate-100 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="font-serif-display text-2xl tracking-[0.06em] text-white">
            APNA KAPDA
          </p>
          <div className="w-32 h-1 rounded-full bg-white/[0.08] overflow-hidden mx-auto">
            <div className="w-1/2 h-full bg-amber-400 rounded-full animate-pulse" />
          </div>
          <p className="text-xs text-slate-400">
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
      label: 'Overview',
      items: [{ id: 'overview', label: 'Dashboard', icon: BarChart3 }],
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
    allNavItems.find((item) => item.id === activeTab)?.label ?? 'Dashboard';

  const adminName = sessionState.profile.full_name || 'Administrator';
  const adminEmail = sessionState.profile.email || sessionState.user.email || '';
  const adminInitials = getInitials(adminName, adminEmail);

  const renderSidebarBody = (isMobile: boolean) => {
    const compact = !isMobile && sidebarCollapsed;

    return (
      <div className="flex flex-col h-full bg-[#0b1018]/95 border-r border-white/[0.07] text-slate-200 select-none">
        {/* Brand Header */}
        <div
          className={`flex items-center border-b border-white/[0.07] h-16 shrink-0 ${
            compact ? 'justify-center px-2' : 'justify-between px-5'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/25 via-amber-500/10 to-teal-500/15 border border-amber-400/30 flex items-center justify-center shrink-0">
              <span className="font-serif-display text-sm font-semibold text-amber-300 tracking-wide">
                AK
              </span>
            </div>
            {!compact && (
              <div className="min-w-0">
                <p className="font-serif-display text-base font-semibold tracking-[0.04em] text-white truncate">
                  APNA KAPDA
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Admin Console
                </p>
              </div>
            )}
          </div>

          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
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
                <p className="px-3 mb-2 text-[11px] font-medium text-slate-500 tracking-wide">
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
                          : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId={
                            isMobile ? 'admin-nav-active-mobile' : 'admin-nav-active'
                          }
                          transition={{ duration: 0.24, ease: ADMIN_EASE }}
                          className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-500/18 via-amber-500/8 to-teal-500/10 border border-amber-400/25"
                        />
                      )}

                      <span className="relative z-10 inline-flex items-center gap-3 min-w-0">
                        <Icon
                          className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                            active ? 'text-amber-400' : 'text-slate-400'
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
                          className={`relative z-10 text-xs tabular-nums shrink-0 ${
                            active ? 'text-amber-300 font-semibold' : 'text-slate-500'
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
        <div className="p-3 border-t border-white/[0.07] space-y-2 shrink-0">
          {!compact && (
            <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <div className="w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-400/25 flex items-center justify-center text-xs font-semibold text-teal-300 shrink-0">
                {adminInitials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-100 truncate">
                  {adminName}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {adminEmail}
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            title={compact ? 'Sign Out' : undefined}
            className={`w-full flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-rose-500/12 hover:border-rose-500/30 hover:text-rose-200 text-slate-300 text-xs font-medium transition-colors cursor-pointer min-h-[40px] ${
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
    <div className="min-h-screen bg-[#080c12] bg-[radial-gradient(ellipse_at_top_left,_rgba(18,58,70,0.34),_transparent_50%),radial-gradient(ellipse_at_top_right,_rgba(154,103,70,0.14),_transparent_42%)] text-slate-100 flex overflow-x-clip">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? 'w-[78px]' : 'w-[252px]'
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
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] lg:hidden flex"
            onClick={() => setMobileNavOpen(false)}
          >
            <motion.aside
              initial={{ x: -272 }}
              animate={{ x: 0 }}
              exit={{ x: -272 }}
              transition={{ duration: 0.25, ease: ADMIN_EASE }}
              className="w-[268px] max-w-[84vw] h-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {renderSidebarBody(true)}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 bg-[#0a0f17]/88 backdrop-blur-md border-b border-white/[0.07] px-4 sm:px-7 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1 rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-white hover:border-white/[0.18] transition-colors cursor-pointer shrink-0"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
                APNA KAPDA
              </span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-sans text-sm sm:text-base font-semibold text-white truncate">
                {activeLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={loadAllAdminData}
              disabled={loadingData}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] hover:border-amber-400/40 text-xs font-medium text-slate-100 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap min-h-[38px]"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-amber-400 ${
                  loadingData ? 'animate-spin' : ''
                }`}
              />
              <span>{loadingData ? 'Syncing' : 'Refresh'}</span>
            </button>

            <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-white/[0.08]">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500/25 to-amber-500/20 border border-white/[0.12] flex items-center justify-center text-xs font-semibold text-white">
                {adminInitials}
              </div>
              <div className="leading-tight">
                <p className="text-xs font-medium text-slate-100 max-w-[140px] truncate">
                  {adminName}
                </p>
                <p className="text-[11px] text-slate-400">Admin</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {dataError && (
            <div className="mb-5 p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-200">
              <strong className="text-rose-100">Database Notice:</strong> {dataError}
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
                <div className="space-y-6">
                  <section className="rounded-2xl bg-[#0e1520]/85 border border-white/[0.08] p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-white/[0.07]">
                      <div>
                        <p className="text-xs font-medium text-amber-400">
                          Non-Destructive Migration
                        </p>
                        <h2 className="font-sans text-xl font-semibold text-white mt-1">
                          Product Media Bucket &amp; Colours Schema
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopySql}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
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

                    <p className="text-xs text-slate-400 mt-4 leading-relaxed">
                      Run{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        supabase/admin_migration.sql
                      </code>{' '}
                      in your Supabase SQL Editor to add{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        colors
                      </code>{' '}
                      and{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        gallery_images
                      </code>{' '}
                      columns to{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        public.products
                      </code>{' '}
                      and create the{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        product-images
                      </code>{' '}
                      Storage bucket with admin-only RLS write policies.
                    </p>

                    <pre className="mt-4 p-4 rounded-xl bg-[#070b10] border border-white/[0.07] text-slate-300 text-xs font-mono overflow-x-auto leading-relaxed">
                      {ADMIN_MIGRATION_SQL}
                    </pre>
                  </section>

                  <section className="rounded-2xl bg-[#0e1520]/85 border border-white/[0.08] p-6">
                    <p className="text-xs font-medium text-teal-400">
                      Independent Subdomain Deployment
                    </p>
                    <h2 className="font-sans text-xl font-semibold text-white mt-1">
                      Deploying at admin.apnakapda.com
                    </h2>
                    <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                      The entire admin application lives inside{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        src/admin/
                      </code>{' '}
                      and mounts automatically whenever the browser visits{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        /admin
                      </code>{' '}
                      or any{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        admin.*
                      </code>{' '}
                      hostname (such as{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        admin.apnakapda.com
                      </code>
                      ). Point the subdomain to the build output with{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        VITE_SUPABASE_URL
                      </code>{' '}
                      and{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
                        VITE_SUPABASE_ANON_KEY
                      </code>{' '}
                      configured, and add{' '}
                      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-200">
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
        </main>
      </div>
    </div>
  );
}
