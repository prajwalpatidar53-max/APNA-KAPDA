import type { AppView } from '../types';

interface FooterProps {
  onNavigateView: (view: AppView, sectionId?: string) => void;
}

export function Footer({ onNavigateView }: FooterProps) {
  return (
    <footer className="bg-[#181613] text-[#efe8dc] py-14 px-4 sm:px-[5%] lg:px-[6%] border-t border-white/[0.06]">
      <div className="max-w-[1440px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="max-w-sm">
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'home')}
              className="text-xl font-bold tracking-[0.22em] text-[#efe8dc] cursor-pointer"
            >
              APNA<span className="text-[#c58e64]">.</span>KAPDA
            </button>
            <p className="text-xs text-[#aba396] mt-3 leading-relaxed">
              Apna Style. Apna Andaaz.
              <br />
              Contemporary Indian fashion crafted for everyday ease and individual
              expression.
            </p>
          </div>

          <div className="flex flex-wrap gap-7 text-xs text-[#cdc5b8]">
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'shop')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Shop
            </button>
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'collections')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Collections
            </button>
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'story')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Our Story
            </button>
            <a
              href="mailto:hello@apnakapda.com"
              className="hover:text-white transition-colors"
            >
              Contact
            </a>
          </div>
        </div>

        <div className="border-t border-white/[0.08] mt-10 pt-6 text-[10px] tracking-[0.14em] uppercase text-[#9c9487] flex flex-wrap items-center justify-between gap-4">
          <span>&copy; 2026 APNA KAPDA. All rights reserved.</span>
          <span>Made with care in India</span>
        </div>
      </div>
    </footer>
  );
}
