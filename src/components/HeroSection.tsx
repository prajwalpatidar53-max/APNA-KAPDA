import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { BRAND_IMAGES } from '../data/catalog';
import { ResilientImage } from './ResilientImage';

interface HeroSectionProps {
  onExploreClick: () => void;
}

export function HeroSection({ onExploreClick }: HeroSectionProps) {
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, scale: 1 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.innerWidth < 768) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({
      rotateX: -y * 7,
      rotateY: x * 7,
      scale: 1.015,
    });
  };

  const handleMouseLeave = () => {
    setTilt({ rotateX: 0, rotateY: 0, scale: 1 });
  };

  return (
    <section
      id="home"
      className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center"
    >
      <div className="animate-rise py-2 lg:py-8">
        <p className="text-[10px] tracking-[0.34em] uppercase text-[#9a6746] font-bold">
          A New Indian Fashion Label
        </p>
        <h1 className="font-serif-display text-[48px] sm:text-[66px] lg:text-[84px] leading-[1.03] font-medium text-[#211f1b] mt-5 mb-6 text-balance">
          Apna Style.
          <br />
          <em className="text-[#9a6746] font-medium italic">Apna Andaaz.</em>
        </h1>
        <p className="text-[#817b70] text-sm sm:text-[15px] leading-[1.85] max-w-[420px]">
          Not just clothes. It&apos;s your identity. Discover everyday essentials,
          statement pieces and timeless styles made for everyone.
        </p>
        <button
          type="button"
          onClick={onExploreClick}
          className="mt-8 bg-[#24231f] text-white border border-[#24231f] px-6 py-4 text-[11px] tracking-[0.2em] uppercase inline-flex items-center gap-4 hover:bg-[#9a6746] hover:border-[#9a6746] hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
        >
          <span>Explore Collection</span>
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>

      <div
        className="relative h-[420px] sm:h-[500px] lg:h-[550px] ml-4 sm:ml-6 lg:ml-0"
        style={{ perspective: '1000px' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="w-full h-full overflow-hidden rounded-[3px] shadow-[20px_25px_60px_rgba(48,39,28,0.14)] transition-transform duration-300 ease-out"
          style={{
            transform: `rotateY(${tilt.rotateY}deg) rotateX(${tilt.rotateX}deg) scale(${tilt.scale})`,
          }}
        >
          <ResilientImage
            src={BRAND_IMAGES.hero}
            alt="APNA KAPDA contemporary Indian fashion collection"
            loading="eager"
            className="w-full h-full object-cover object-center"
          />
        </div>

        <div className="absolute bottom-6 -left-4 sm:-left-6 bg-[#fffdf8] px-5 py-4 shadow-[0_10px_35px_rgba(0,0,0,0.08)] border border-[#e5dfd3]">
          <p className="font-serif-display text-[17px] text-[#211f1b]">
            Wear your identity.
          </p>
          <span className="block text-[9px] tracking-[0.2em] uppercase text-[#817b70] mt-1.5">
            APNA KAPDA — EST. 2026
          </span>
        </div>
      </div>
    </section>
  );
}
