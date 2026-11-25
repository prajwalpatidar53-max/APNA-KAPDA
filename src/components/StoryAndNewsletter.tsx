import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { BRAND_IMAGES } from '../data/catalog';
import { subscribeNewsletter } from '../services/storeService';
import { ResilientImage } from './ResilientImage';
import { RevealSection } from './StoreMotion';

interface StoryAndNewsletterProps {
  onDiscoverClick: () => void;
}

export function StoryAndNewsletter({ onDiscoverClick }: StoryAndNewsletterProps) {
  const [email, setEmail] = useState('');
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);
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
      <section id="story" className="bg-[#f1eadf] border-b border-[#e5dccd]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-[5%] lg:px-[6%] py-16 lg:py-24">
          <RevealSection className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="h-[340px] sm:h-[440px] lg:h-[500px] rounded-[28px] overflow-hidden shadow-[0_20px_50px_-26px_rgba(31,29,26,0.3)] border border-white/60">
              <ResilientImage
                src={BRAND_IMAGES.story}
                alt="APNA KAPDA textile craftsmanship and handloom atelier"
                className="w-full h-full object-cover transition-transform duration-700 hover:scale-[1.03]"
              />
            </div>

            <div>
              <p className="text-[11px] tracking-[0.28em] uppercase text-[#8d5b3c] font-semibold">
                Our Philosophy
              </p>
              <h2 className="font-serif-display text-3xl sm:text-4xl lg:text-[48px] leading-[1.08] font-medium text-[#1f1d1a] my-5 text-balance">
                Not made to fit in. Made to be you.
              </h2>
              <p className="text-sm text-[#5d564c] leading-[1.9] max-w-[470px]">
                APNA KAPDA is built around a simple thought — style should feel like
                you. Inspired by the spirit of India and designed for today&apos;s
                world, we bring together breathable Indian textiles, everyday
                comfort, individual expression, and timeless tailoring.
              </p>
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={onDiscoverClick}
                className="mt-8 rounded-full bg-[#1f1d1a] text-white px-7 py-4 text-[11px] font-semibold tracking-[0.18em] uppercase inline-flex items-center gap-3 hover:bg-[#8d5b3c] transition-colors cursor-pointer shadow-sm"
              >
                <span>Discover Our World</span>
                <ArrowUpRight className="w-4 h-4" />
              </motion.button>
            </div>
          </RevealSection>
        </div>
      </section>

      <section className="bg-[#1e1b18] text-white py-16 lg:py-20 px-4 sm:px-[5%] lg:px-[6%] text-center">
        <RevealSection className="max-w-xl mx-auto">
          <p className="text-[11px] tracking-[0.3em] uppercase text-[#ddb68b] font-semibold">
            Stay in the Loop
          </p>
          <h2 className="font-serif-display text-3xl sm:text-[40px] font-medium mt-3 text-balance">
            A little style in your inbox.
          </h2>
          <p className="text-[#beb5a7] text-xs sm:text-sm mt-3 mb-8">
            Get updates on new drops, seasonal collections, and member-only offers.
          </p>

          <form
            onSubmit={handleSubscribe}
            className="flex flex-col sm:flex-row gap-2.5 max-w-[460px] mx-auto"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              required
              aria-label="Email address for newsletter"
              className="flex-1 min-w-0 px-5 py-3.5 rounded-full border border-white/20 bg-white/[0.05] text-white placeholder:text-[#a39b8e] text-xs outline-none focus:border-[#ddb68b] transition-colors"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-[#e6d5bd] text-[#1e1b18] px-6 py-3.5 text-[11px] tracking-[0.14em] uppercase font-semibold hover:bg-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Joining...' : 'Subscribe ↗'}
            </button>
          </form>

          {statusMessage && (
            <p className="text-xs mt-4 text-[#e6d5bd]">{statusMessage.text}</p>
          )}
        </RevealSection>
      </section>
    </>
  );
}
