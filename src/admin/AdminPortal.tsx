import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Check,
  Copy,
  Database,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  ShoppingBag,
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

type AdminTab =
  | 'overview'
  | 'products'
  | 'orders'
  | 'bulk-shipping'
  | 'customers'
  | 'setup';

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

export default function AdminPortal() {
  const [sessionState, setSessionState] = useState<AdminSessionState>({
    status: 'loading',
  });
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
    document.title = 'APNA KAPDA — Private Admin Portal';
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
      <div className="min-h-screen bg-[#151412] text-[#f5f2eb] flex items-center justify-center">
        <div className="text-center">
          <p className="font-serif-display text-2xl tracking-[0.06em]">
            APNA KAPDA
          </p>
          <p className="text-[11px] tracking-[0.22em] uppercase text-[#a6a095] mt-2">
            Verifying Administrator Credentials...
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

  const navItems: { id: AdminTab; label: string; icon: typeof BarChart3; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'products', label: 'Products', icon: Package, count: products.length },
    { id: 'orders', label: 'Orders', icon: ShoppingBag, count: orders.length },
    { id: 'bulk-shipping', label: 'Bulk Shipping', icon: Truck, count: readyToShipCount },
    { id: 'customers', label: 'Customers', icon: Users, count: customers.length },
    { id: 'setup', label: 'SQL & Deploy', icon: Database },
  ];

  const activeLabel =
    navItems.find((item) => item.id === activeTab)?.label ?? 'Overview';

  const SidebarContent = (
    <div className="flex flex-col h-full bg-[#151412] text-[#f5f2eb]">
      <div className="px-6 py-6 border-b border-[#2b2924]">
        <p className="font-serif-display text-xl tracking-[0.05em] text-[#fffdf8]">
          APNA KAPDA
        </p>
        <p className="text-[10px] tracking-[0.24em] uppercase text-[#9a6746] font-semibold mt-1">
          Admin Operations
        </p>
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs tracking-[0.06em] transition-colors cursor-pointer ${
                active
                  ? 'bg-[#2a2722] text-[#fffdf8] font-semibold'
                  : 'text-[#b9b2a5] hover:text-[#fffdf8] hover:bg-[#1f1d19]'
              }`}
            >
              <span className="inline-flex items-center gap-3">
                <Icon className="w-4 h-4 text-[#9a6746]" />
                <span>{item.label}</span>
              </span>
              {typeof item.count === 'number' && (
                <span className="text-[11px] text-[#8e877b] tabular-nums">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[#2b2924] space-y-3">
        <div className="px-2">
          <p className="text-xs font-medium text-[#fffdf8] truncate">
            {sessionState.profile.full_name || 'Administrator'}
          </p>
          <p className="text-[11px] text-[#8e877b] truncate">
            {sessionState.profile.email || sessionState.user.email}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-[#322f29] text-[10px] tracking-[0.18em] uppercase font-semibold text-[#e5dfd3] hover:bg-[#24221d] transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f5f2eb] text-[#211f1b] flex">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-[#2b2924]">
        <div className="sticky top-0 h-screen">{SidebarContent}</div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 lg:hidden flex"
          onClick={() => setMobileNavOpen(false)}
        >
          <aside
            className="w-64 h-full relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="absolute top-4 right-4 text-[#b9b2a5] hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-[#fffdf8] border-b border-[#e5dfd3] px-5 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 -ml-2 text-[#211f1b] cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="text-xs text-[#817b70]">
              <span>APNA KAPDA Admin</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-[#211f1b]">{activeLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={loadAllAdminData}
            disabled={loadingData}
            className="inline-flex items-center gap-2 px-3.5 py-2 border border-[#e5dfd3] bg-[#f5f2eb]/60 hover:border-[#24231f] text-[10px] tracking-[0.16em] uppercase font-semibold text-[#211f1b] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </button>
        </header>

        <main className="flex-1 p-5 sm:p-8 max-w-[1400px] w-full mx-auto">
          {dataError && (
            <div className="mb-5 p-4 bg-[#fef2f2] border border-[#fecaca] text-xs text-[#b91c1c]">
              <strong>Database Notice:</strong> {dataError}
            </div>
          )}

          {activeTab === 'overview' && (
            <AdminAnalytics
              orders={orders}
              products={products}
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
              <section className="bg-[#fffdf8] border border-[#e5dfd3] p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#e5dfd3]">
                  <div>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                      Non-Destructive Migration
                    </p>
                    <h2 className="font-serif-display text-2xl text-[#211f1b] mt-1">
                      Product Media Bucket &amp; Colours Schema
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer"
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

                <p className="text-xs text-[#5f594f] mt-4 leading-relaxed">
                  Run <code className="bg-[#f5f2eb] px-1.5 py-0.5">supabase/admin_migration.sql</code>{' '}
                  in your Supabase SQL Editor to add{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">colors</code> and{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">gallery_images</code>{' '}
                  columns to <code className="bg-[#f5f2eb] px-1.5 py-0.5">public.products</code>{' '}
                  and create the <code className="bg-[#f5f2eb] px-1.5 py-0.5">product-images</code>{' '}
                  Storage bucket with admin-only RLS write policies.
                </p>

                <pre className="mt-4 p-4 bg-[#151412] text-[#e5dfd3] text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {ADMIN_MIGRATION_SQL}
                </pre>
              </section>

              <section className="bg-[#fffdf8] border border-[#e5dfd3] p-6">
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                  Independent Subdomain Deployment
                </p>
                <h2 className="font-serif-display text-2xl text-[#211f1b] mt-1">
                  Deploying at admin.apnakapda.com
                </h2>
                <p className="text-xs text-[#5f594f] mt-3 leading-relaxed">
                  The entire admin application lives inside{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">src/admin/</code> and
                  mounts automatically whenever the browser visits{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">/admin</code> or any{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">admin.*</code>{' '}
                  hostname (such as{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">admin.apnakapda.com</code>).
                  When you are ready to host the admin panel as its own standalone
                  deployment, point the subdomain to the build output with{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">VITE_SUPABASE_URL</code>{' '}
                  and{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>{' '}
                  configured, and optionally add{' '}
                  <code className="bg-[#f5f2eb] px-1.5 py-0.5">https://admin.apnakapda.com</code>{' '}
                  to Supabase Authentication &rarr; URL Configuration &rarr; Redirect URLs.
                </p>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
