import type { AppView } from '../types';

interface FooterProps {
  onNavigateView: (view: AppView, sectionId?: string) => void;
}

export function Footer({ onNavigateView }: FooterProps) {
  return (
    <footer className="bg-[#1b1a17] text-[#eee8dc] py-12 px-[5%] lg:px-[6%]">
      <div className="max-w-[1440px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div>
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'home')}
              className="text-xl font-bold tracking-[0.2em] text-[#eee8dc] cursor-pointer"
            >
              APNA<span className="text-[#9a6746]">.</span>KAPDA
            </button>
            <p className="text-xs text-[#aaa396] mt-3 leading-relaxed">
              Apna Style. Apna Andaaz.
              <br />
              Contemporary Indian fashion, made for everyone.
            </p>
          </div>

          <div className="flex flex-wrap gap-6 text-xs text-[#c9c1b5]">
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'shop')}
              className="hover:text-white transition-colors"
            >
              Shop
            </button>
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'collections')}
              className="hover:text-white transition-colors"
            >
              Collections
            </button>
            <button
              type="button"
              onClick={() => onNavigateView('storefront', 'story')}
              className="hover:text-white transition-colors"
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

        <div className="border-t border-[#403d36] mt-9 pt-5 text-[10px] tracking-[0.14em] uppercase text-[#9c968a] flex flex-wrap items-center justify-between gap-4">
          <span>&copy; 2026 APNA KAPDA. All rights reserved.</span>
          <span>Made with style in India</span>
        </div>
      </div>
    </footer>
  );
}
