import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { AppView, StorefrontBanner, UserProfile } from '../types';
import { STORE_EASE } from './StoreMotion';

interface NavbarProps {
  activeView: AppView;
  onNavigateView: (view: AppView, sectionId?: string) => void;
  cartCount: number;
  onOpenCart: () => void;
  onOpenAuth: () => void;
  user: SupabaseUser | null;
  profile: UserProfile | null;
  activeBanner?: StorefrontBanner | null;
  onBannerCtaClick?: (banner: StorefrontBanner) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onSearchSubmit?: (query: string) => void;
}

export function Navbar({
  activeView,
  onNavigateView,
  cartCount,
  onOpenCart,
  onOpenAuth,
  user,
  profile,
  activeBanner,
  onBannerCtaClick,
  searchQuery = '',
  onSearchChange,
  onSearchSubmit,
}: NavbarProps) {
  const [showBanner, setShowBanner] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const handleLinkClick = (view: AppView, sectionId?: string) => {
    setMobileMenuOpen(false);
    onNavigateView(view, sectionId);
  };

  const handleSearchFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    onSearchSubmit?.(searchQuery);
  };

  const navItems: { label: string; sectionId: string }[] = [
    { label: 'Home', sectionId: 'home' },
    { label: 'Collections', sectionId: 'collections' },
    { label: 'Shop', sectionId: 'shop' },
    { label: 'Our Story', sectionId: 'story' },
  ];

  return (
    <div className="sticky top-0 z-50">
      <AnimatePresence initial={false}>
        {showBanner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: STORE_EASE }}
            className="overflow-hidden bg-[#1e1b18] text-[#efe8dc]"
          >
            <div className="min-h-[34px] py-1.5 px-8 flex items-center justify-center relative text-[10px] sm:text-[11px] tracking-[0.16em] uppercase">
              {activeBanner ? (
                <div className="truncate flex items-center gap-2">
                  {activeBanner.offer_title && (
                    <span className="text-[#ddb68b] font-semibold">
                      {activeBanner.offer_title} &middot;
                    </span>
                  )}
                  <span className="truncate">{activeBanner.banner_text}</span>
                  {activeBanner.cta_text && (
                    <button
                      type="button"
                      onClick={() => onBannerCtaClick?.(activeBanner)}
                      className="underline underline-offset-4 text-white hover:text-[#ddb68b] font-semibold shrink-0 cursor-pointer transition-colors"
                    >
                      {activeBanner.cta_text}
                    </button>
                  )}
                </div>
              ) : (
                <span className="truncate">
                  Complimentary shipping across India on orders above ₹1,499 &nbsp;&middot;&nbsp; Cash on Delivery available
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowBanner(false)}
                aria-label="Dismiss announcement"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#b9b0a1] hover:text-white transition-colors p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="h-[72px] px-4 sm:px-[5%] lg:px-[6%] flex items-center justify-between gap-4 bg-[#faf7f2]/92 backdrop-blur-md border-b border-[#e8e1d5] shadow-[0_6px_24px_-18px_rgba(33,31,27,0.18)]">
        {/* Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleLinkClick('storefront', 'home')}
          className="text-lg sm:text-[22px] font-bold tracking-[0.22em] text-[#1f1d1a] whitespace-nowrap shrink-0 cursor-pointer group"
        >
          APNA
          <span className="text-[#8d5b3c] group-hover:text-[#75492e] transition-colors">
            .
          </span>
          KAPDA
        </button>

        {/* Center Navigation Links */}
        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-7 lg:gap-8 text-[11px] font-medium tracking-[0.14em] uppercase text-[#464139]"
        >
          {navItems.map((item) => (
            <button
              key={item.sectionId}
              type="button"
              onClick={() => handleLinkClick('storefront', item.sectionId)}
              className={`relative py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer after:content-[''] after:absolute after:left-0 after:bottom-0 after:h-[1.5px] after:bg-[#8d5b3c] after:transition-all after:duration-200 ${
                activeView === 'storefront' && item.sectionId === 'home'
                  ? 'text-[#1f1d1a] after:w-full'
                  : 'hover:text-[#1f1d1a] after:w-0 hover:after:w-full'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Right Controls: Search + Account + Bag */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Desktop Expandable Search */}
          <div className="hidden lg:flex items-center">
            <AnimatePresence initial={false} mode="wait">
              {searchOpen ? (
                <motion.form
                  key="search-form"
                  initial={{ width: 40, opacity: 0 }}
                  animate={{ width: 220, opacity: 1 }}
                  exit={{ width: 40, opacity: 0 }}
                  transition={{ duration: 0.22, ease: STORE_EASE }}
                  onSubmit={handleSearchFormSubmit}
                  className="relative flex items-center overflow-hidden"
                >
                  <Search className="w-3.5 h-3.5 text-[#817b70] absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => onSearchChange?.(e.target.value)}
                    placeholder="Search shirts, linen..."
                    aria-label="Search store catalog"
                    className="w-full pl-8 pr-8 py-2 rounded-full text-xs bg-[#fffdf9] border border-[#dcd3c4] focus:border-[#8d5b3c] outline-none text-[#1f1d1a] placeholder:text-[#9c9487]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (searchQuery) {
                        onSearchChange?.('');
                      } else {
                        setSearchOpen(false);
                      }
                    }}
                    aria-label="Close search"
                    className="absolute right-2.5 text-[#817b70] hover:text-[#1f1d1a] p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.form>
              ) : (
                <motion.button
                  key="search-btn"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search products"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-[#1f1d1a] hover:bg-[#ede6da] transition-colors cursor-pointer"
                >
                  <Search className="w-[18px] h-[18px] stroke-[1.75]" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {user ? (
            <button
              type="button"
              onClick={() => handleLinkClick('account')}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 sm:px-4 py-2 text-[11px] tracking-[0.1em] uppercase whitespace-nowrap shrink-0 transition-all cursor-pointer min-h-[38px] ${
                activeView === 'account'
                  ? 'bg-[#1f1d1a] text-white border-[#1f1d1a] shadow-sm'
                  : 'bg-[#fffdf9] border-[#dcd3c4] text-[#1f1d1a] hover:border-[#1f1d1a]'
              }`}
            >
              <User className="w-3.5 h-3.5 shrink-0" />
              <span className="max-w-[82px] sm:max-w-[115px] truncate">
                {profile?.full_name?.split(' ')[0] || 'Account'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="rounded-full border border-[#1f1d1a] bg-transparent px-4 py-2 text-[11px] tracking-[0.12em] uppercase font-medium text-[#1f1d1a] hover:bg-[#1f1d1a] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer min-h-[38px]"
            >
              Sign In
            </button>
          )}

          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={onOpenCart}
            aria-label="Open shopping bag"
            className="relative w-10 h-10 rounded-full flex items-center justify-center text-[#1f1d1a] hover:bg-[#ede6da] transition-colors shrink-0 cursor-pointer"
          >
            <ShoppingBag className="w-[19px] h-[19px] stroke-[1.75]" />
            <AnimatePresence mode="popLayout">
              <motion.span
                key={cartCount}
                initial={{ scale: 0.65, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.22, ease: STORE_EASE }}
                className="absolute top-0.5 right-0.5 bg-[#8d5b3c] text-white text-[10px] font-semibold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center tabular-nums shadow-sm"
              >
                {cartCount}
              </motion.span>
            </AnimatePresence>
          </motion.button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="md:hidden w-10 h-10 rounded-full flex items-center justify-center text-[#1f1d1a] hover:bg-[#ede6da] transition-colors shrink-0 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Dropdown Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: STORE_EASE }}
            className="md:hidden bg-[#fffdf9] border-b border-[#e5dfd3] px-5 py-5 shadow-lg space-y-4"
          >
            <form onSubmit={handleSearchFormSubmit} className="relative">
              <Search className="w-4 h-4 text-[#817b70] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder="Search garments, linen, kurtas..."
                aria-label="Search store catalog"
                className="w-full pl-10 pr-4 py-2.5 rounded-full text-xs bg-[#f6f1e8] border border-[#e3dacb] focus:border-[#8d5b3c] outline-none text-[#1f1d1a]"
              />
            </form>

            <nav className="flex flex-col gap-1 text-xs font-medium tracking-[0.14em] uppercase">
              {navItems.map((item) => (
                <button
                  key={item.sectionId}
                  type="button"
                  onClick={() => handleLinkClick('storefront', item.sectionId)}
                  className="text-left px-3 py-2.5 rounded-xl text-[#1f1d1a] hover:bg-[#f5efe4] hover:text-[#8d5b3c] transition-colors cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
