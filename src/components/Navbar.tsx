import { useState } from 'react';
import { Menu, ShoppingBag, User, X } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { AppView, StorefrontBanner, UserProfile } from '../types';

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
}: NavbarProps) {
  const [showBanner, setShowBanner] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (view: AppView, sectionId?: string) => {
    setMobileMenuOpen(false);
    onNavigateView(view, sectionId);
  };

  return (
    <div className="sticky top-0 z-50">
      {showBanner && (
        <div className="bg-[#24231f] text-[#eee6d8] h-8 px-4 flex items-center justify-center relative text-[10px] tracking-[0.18em] uppercase">
          {activeBanner ? (
            <div className="truncate pr-6 flex items-center gap-2">
              {activeBanner.offer_title && (
                <span className="text-[#d6b38d] font-bold">
                  {activeBanner.offer_title} &middot;
                </span>
              )}
              <span className="truncate">{activeBanner.banner_text}</span>
              {activeBanner.cta_text && (
                <button
                  type="button"
                  onClick={() => onBannerCtaClick?.(activeBanner)}
                  className="underline underline-offset-4 text-[#fffdf8] hover:text-[#d6b38d] font-semibold shrink-0 cursor-pointer"
                >
                  {activeBanner.cta_text}
                </button>
              )}
            </div>
          ) : (
            <span className="truncate pr-6">
              Free shipping on orders above ₹1,499 &nbsp;·&nbsp; Made for every you
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowBanner(false)}
            aria-label="Dismiss announcement"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#bdb5a8] hover:text-white transition-colors p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <header className="h-[68px] px-[5%] lg:px-[6%] flex items-center justify-between gap-6 bg-[#f5f2eb]/95 backdrop-blur-md border-b border-[#e5dfd3]">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleLinkClick('storefront', 'home')}
          className="text-xl sm:text-2xl font-bold tracking-[0.2em] text-[#211f1b] whitespace-nowrap shrink-0 cursor-pointer"
        >
          APNA<span className="text-[#9a6746]">.</span>KAPDA
        </button>

        {/* Zone 2: Concise Single-Line Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-[11px] font-medium tracking-[0.12em] uppercase text-[#211f1b]">
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'home')}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-[#9a6746] ${
              activeView === 'storefront' ? 'text-[#211f1b]' : 'text-[#817b70]'
            }`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'collections')}
            className="whitespace-nowrap shrink-0 text-[#211f1b] hover:text-[#9a6746] transition-colors"
          >
            Collections
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'shop')}
            className="whitespace-nowrap shrink-0 text-[#211f1b] hover:text-[#9a6746] transition-colors"
          >
            Shop
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'story')}
            className="whitespace-nowrap shrink-0 text-[#211f1b] hover:text-[#9a6746] transition-colors"
          >
            Our Story
          </button>
        </nav>

        {/* Zone 3: Account & Bag Controls */}
        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => handleLinkClick('account')}
              className={`inline-flex items-center gap-2 border px-3 sm:px-4 py-2 text-[11px] tracking-[0.1em] uppercase whitespace-nowrap shrink-0 transition-colors ${
                activeView === 'account'
                  ? 'bg-[#211f1b] text-white border-[#211f1b]'
                  : 'border-[#211f1b] text-[#211f1b] hover:bg-[#211f1b] hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span className="max-w-[90px] sm:max-w-[120px] truncate">
                {profile?.full_name?.split(' ')[0] || 'Account'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="border border-[#211f1b] px-3.5 sm:px-4 py-2 text-[11px] tracking-[0.12em] uppercase text-[#211f1b] hover:bg-[#211f1b] hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          )}

          <button
            type="button"
            onClick={onOpenCart}
            aria-label="Open shopping bag"
            className="relative p-2 text-[#211f1b] hover:text-[#9a6746] transition-colors shrink-0"
          >
            <ShoppingBag className="w-5 h-5 stroke-[1.75]" />
            <span className="absolute top-0.5 right-0 bg-[#9a6746] text-white text-[9px] font-semibold w-4 h-4 rounded-full flex items-center justify-center tabular-nums">
              {cartCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="md:hidden p-2 text-[#211f1b] shrink-0"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Dropdown Navigation */}
      {mobileMenuOpen && (
        <nav className="md:hidden bg-[#fffdf8] border-b border-[#e5dfd3] px-6 py-5 flex flex-col gap-4 text-xs tracking-[0.14em] uppercase">
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'home')}
            className="text-left py-1 text-[#211f1b] hover:text-[#9a6746]"
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'collections')}
            className="text-left py-1 text-[#211f1b] hover:text-[#9a6746]"
          >
            Collections
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'shop')}
            className="text-left py-1 text-[#211f1b] hover:text-[#9a6746]"
          >
            Shop
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('storefront', 'story')}
            className="text-left py-1 text-[#211f1b] hover:text-[#9a6746]"
          >
            Our Story
          </button>
        </nav>
      )}
    </div>
  );
}
