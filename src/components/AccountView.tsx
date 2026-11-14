import { useEffect, useState } from 'react';
import { ArrowLeft, LogOut, Package, Save, UserCheck } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { formatINR } from '../data/catalog';
import { fetchCustomerOrders, updateUserProfile } from '../services/storeService';
import type { Order, ShippingAddress, UserProfile } from '../types';

interface AccountViewProps {
  user: SupabaseUser | null;
  profile: UserProfile | null;
  onBack: () => void;
  onProfileUpdated: () => void;
  onLogout: () => void;
}

export function AccountView({
  user,
  profile,
  onBack,
  onProfileUpdated,
  onLogout,
}: AccountViewProps) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [address, setAddress] = useState<ShippingAddress>({
    line1: profile?.default_address?.line1 || '',
    line2: profile?.default_address?.line2 || '',
    city: profile?.default_address?.city || '',
    state: profile?.default_address?.state || '',
    pincode: profile?.default_address?.pincode || '',
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
      setAddress({
        line1: profile.default_address?.line1 || '',
        line2: profile.default_address?.line2 || '',
        city: profile.default_address?.city || '',
        state: profile.default_address?.state || '',
        pincode: profile.default_address?.pincode || '',
      });
    }
  }, [profile]);

  useEffect(() => {
    if (!user) return;
    setLoadingOrders(true);
    fetchCustomerOrders(user.id).then((res) => {
      setOrders(res.orders);
      setLoadingOrders(false);
    });
  }, [user]);

  if (!user) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setSaveMessage('');
    const res = await updateUserProfile(user.id, {
      full_name: fullName,
      phone,
      default_address: address,
    });
    setSavingProfile(false);
    if (res.error) {
      setSaveMessage(res.error);
      return;
    }
    setSaveMessage('Profile saved.');
    onProfileUpdated();
  };

  return (
    <div className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-10 lg:py-14">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 mb-8 border-b border-[#e5dfd3]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs tracking-[0.14em] uppercase text-[#211f1b] hover:text-[#9a6746]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Shop</span>
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 border border-[#211f1b] px-4 py-2 text-[10px] tracking-[0.16em] uppercase text-[#211f1b] hover:bg-[#211f1b] hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Customer Profile Form */}
        <section className="lg:col-span-5 bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.26em] uppercase text-[#9a6746] font-bold">
            <UserCheck className="w-3.5 h-3.5" />
            <span>Customer Profile</span>
          </div>
          <h1 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b] mt-2">
            {profile?.full_name || user.email}
          </h1>
          <p className="text-xs text-[#817b70] mt-1 mb-6">
            {user.email} &middot; Role: {profile?.role || 'customer'}
          </p>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1">
                Mobile Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746] tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1">
                Street Address
              </label>
              <input
                type="text"
                value={address.line1}
                onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <input
                type="text"
                placeholder="City"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
                className="px-3 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
              <input
                type="text"
                placeholder="State"
                value={address.state}
                onChange={(e) => setAddress({ ...address, state: e.target.value })}
                className="px-3 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
              <input
                type="text"
                placeholder="PIN"
                maxLength={6}
                value={address.pincode}
                onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                className="px-3 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746] tabular-nums"
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="w-full bg-[#24231f] text-white py-3 px-4 text-[11px] tracking-[0.16em] uppercase inline-flex items-center justify-center gap-2 hover:bg-[#9a6746] transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingProfile ? 'Saving...' : 'Save Details'}</span>
            </button>

            {saveMessage && (
              <p className="text-xs text-[#9a6746] mt-2">{saveMessage}</p>
            )}
          </form>
        </section>

        {/* Order History */}
        <section className="lg:col-span-7 bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.26em] uppercase text-[#9a6746] font-bold">
            <Package className="w-3.5 h-3.5" />
            <span>Your Orders</span>
          </div>
          <h2 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b] mt-2 mb-6">
            Order History
          </h2>

          {loadingOrders ? (
            <p className="text-xs text-[#817b70]">Loading your orders...</p>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-[#e5dfd3] bg-[#f5f2eb]/40">
              <p className="font-serif-display text-xl text-[#211f1b]">
                No orders placed yet.
              </p>
              <p className="text-xs text-[#817b70] mt-1.5">
                When you place a COD or reserved order, it will appear here.
              </p>
              <button
                type="button"
                onClick={onBack}
                className="mt-4 px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase"
              >
                Explore Collection
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="border border-[#e5dfd3] p-5 bg-[#f5f2eb]/30"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e5dfd3]">
                    <div>
                      <span className="text-xs font-bold text-[#211f1b] tabular-nums">
                        {order.order_number}
                      </span>
                      <span className="mx-2 text-[#817b70]">&middot;</span>
                      <span className="text-[11px] text-[#817b70] tabular-nums">
                        {new Date(order.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>

                    <div className="text-[11px] uppercase tracking-wider font-semibold text-[#9a6746]">
                      {order.order_status} &middot;{' '}
                      {order.payment_status.replace('_', ' ')}
                    </div>
                  </div>

                  <div className="py-3 space-y-2 text-xs">
                    {order.order_items?.map((item, i) => (
                      <div
                        key={item.id || i}
                        className="flex items-center justify-between text-[#5f594f] tabular-nums"
                      >
                        <span>
                          {item.product_name} (Size {item.selected_size}) &times;{' '}
                          {item.quantity}
                        </span>
                        <span className="font-medium text-[#211f1b]">
                          {formatINR(item.unit_price_inr * item.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-[#e5dfd3] flex items-center justify-between text-xs tabular-nums">
                    <span className="text-[#817b70]">
                      Deliver to: {order.shipping_address.city},{' '}
                      {order.shipping_address.pincode}
                    </span>
                    <span className="font-bold text-[#211f1b]">
                      Total: {formatINR(order.total_inr)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
