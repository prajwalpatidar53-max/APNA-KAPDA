import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { BRAND_IMAGES } from '../data/catalog';
import { subscribeNewsletter } from '../services/storeService';
import { ResilientImage } from './ResilientImage';

interface StoryAndNewsletterProps {
  onDiscoverClick: () => void;
}

export function StoryAndNewsletter({ onDiscoverClick }: StoryAndNewsletterProps) {
  const [email, setEmail] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    const res = await subscribeNewsletter(email);
    setStatusMessage({ text: res.message, isError: res.isError });
    setSubmitting(false);
    if (!res.isError) {
      setEmail('');
    }
  };

  return (
    <>
      <section id="story" className="bg-[#e9e2d6]">
        <div className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="h-[340px] sm:h-[440px] lg:h-[490px] overflow-hidden">
            <ResilientImage
              src={BRAND_IMAGES.story}
              alt="APNA KAPDA textile craftsmanship and handloom atelier"
              className="w-full h-full object-cover"
            />
          </div>

          <div>
            <p className="text-[10px] tracking-[0.34em] uppercase text-[#9a6746] font-bold">
              Our Philosophy
            </p>
            <h2 className="font-serif-display text-3xl sm:text-4xl lg:text-[48px] leading-[1.1] font-medium text-[#211f1b] my-5 text-balance">
              Not made to fit in. Made to be you.
            </h2>
            <p className="text-sm text-[#69645b] leading-[1.95] max-w-[460px]">
              APNA KAPDA is built around a simple thought — style should feel like
              you. Inspired by the spirit of India and designed for today&apos;s
              world, we bring together breathable Indian textiles, everyday comfort,
              individual expression, and timeless tailoring.
            </p>
            <button
              type="button"
              onClick={onDiscoverClick}
              className="mt-8 bg-[#24231f] text-white border border-[#24231f] px-6 py-4 text-[11px] tracking-[0.2em] uppercase inline-flex items-center gap-4 hover:bg-[#9a6746] hover:border-[#9a6746] transition-colors cursor-pointer"
            >
              <span>Discover Our World</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      <section className="bg-[#24231f] text-white py-16 lg:py-20 px-[5%] lg:px-[6%] text-center">
        <div className="max-w-xl mx-auto">
          <p className="text-[10px] tracking-[0.34em] uppercase text-[#e5d6c1] font-bold">
            Stay in the Loop
          </p>
          <h2 className="font-serif-display text-3xl sm:text-[38px] font-medium mt-3.5 text-balance">
            A little style in your inbox.
          </h2>
          <p className="text-[#bdb5a8] text-xs sm:text-[13px] mt-3 mb-7">
            Get updates on new drops, collections and exclusive seasonal offers.
          </p>

          <form onSubmit={handleSubscribe} className="flex max-w-[440px] mx-auto">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              required
              aria-label="Email address for newsletter"
              className="flex-1 min-w-0 px-4 py-3.5 border border-[#625e55] bg-transparent text-white placeholder:text-[#9c968a] text-xs outline-none focus:border-[#e5d6c1]"
            />
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#e5d6c1] text-[#24231f] px-5 text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {submitting ? 'Joining...' : 'Subscribe ↗'}
            </button>
          </form>

          {statusMessage && (
            <p
              className={`text-xs mt-4 ${
                statusMessage.isError ? 'text-[#e5d6c1]' : 'text-[#e5d6c1]'
              }`}
            >
              {statusMessage.text}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
