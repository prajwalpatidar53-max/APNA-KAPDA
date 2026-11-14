import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { AccountView } from './components/AccountView';
import { AuthModal } from './components/AuthModal';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutView } from './components/CheckoutView';
import { CollectionsSection } from './components/CollectionsSection';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { Navbar } from './components/Navbar';
import { ProductDetailPage } from './components/ProductDetailPage';
import { ProductGrid } from './components/ProductGrid';
import { StoryAndNewsletter } from './components/StoryAndNewsletter';
import { PREVIEW_PRODUCTS } from './data/catalog';
import { isSupabaseConfigured, supabase, SUPABASE_URL } from './lib/supabase';
import { fetchActiveProducts, fetchUserProfile } from './services/storeService';
import type {
  AppView,
  AuthMode,
  CartItem,
  CategoryFilter,
  Product,
  UserProfile,
} from './types';

const CART_STORAGE_KEY = 'apnaKapdaCart';

export default function App() {
  const [products, setProducts] = useState<Product[]>(PREVIEW_PRODUCTS);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [activeView, setActiveView] = useState<AppView>('storefront');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false);

  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authNotice, setAuthNotice] = useState('');

  const loadCatalog = useCallback(async () => {
    setLoadingProducts(true);
    const res = await fetchActiveProducts();
    setProducts(res.products);
    setLoadingProducts(false);
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const res = await fetchUserProfile(userId);
    if (res.profile) {
      setProfile(res.profile);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[APNA KAPDA Auth Session Error]', {
          operation: 'auth.getSession',
          baseUrl: SUPABASE_URL,
          message: error.message,
        });
      }
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) {
        loadProfile(sessionUser.id);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);

      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('recovery');
        setAuthNotice('');
        setAuthModalOpen(true);
      }

      if (sessionUser) {
        loadProfile(sessionUser.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCartOpen(false);
        setAuthModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty, 0),
    [cart]
  );

  const navigateView = (view: AppView, sectionId?: string) => {
    setActiveView(view);
    if (view === 'storefront' && sectionId) {
      setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSelectCategory = (category: CategoryFilter) => {
    setSelectedCategory(category);
    navigateView('storefront', 'shop');
  };

  const handleOpenProduct = (product: Product) => {
    setSelectedProduct(product);
    setActiveView('product');
  };

  const handleAddToCart = (product: Product, size?: string, qty = 1) => {
    const chosenSize =
      size || (product.sizes.includes('M') ? 'M' : product.sizes[0] || 'M');
    setCart((prev) => {
      const existing = prev.find(
        (item) => item.productId === product.id && item.size === chosenSize
      );
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id && item.size === chosenSize
            ? { ...item, qty: item.qty + qty }
            : item
        );
      }
      return [...prev, { productId: product.id, size: chosenSize, qty }];
    });
    setCartOpen(true);
  };

  const handleChangeCartQty = (productId: string, size: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId && item.size === size
            ? { ...item, qty: item.qty + delta }
            : item
        )
        .filter((item) => item.qty > 0)
    );
  };

  const handleRemoveCartItem = (productId: string, size: string) => {
    setCart((prev) =>
      prev.filter((item) => !(item.productId === productId && item.size === size))
    );
  };

  const handleOpenAuth = (mode: AuthMode = 'login', notice = '') => {
    setCartOpen(false);
    setAuthMode(mode);
    setAuthNotice(notice);
    setAuthModalOpen(true);
  };

  const handleProceedToCheckout = () => {
    setCartOpen(false);
    if (!user) {
      handleOpenAuth('login', 'Please sign in before completing checkout.');
      setActiveView('checkout');
      return;
    }
    navigateView('checkout');
  };

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setProfile(null);
    if (activeView === 'account') {
      setActiveView('storefront');
    }
  };

  const relatedProducts = useMemo(() => {
    if (!selectedProduct) return [];
    return products
      .filter((p) => p.id !== selectedProduct.id)
      .sort((a, b) =>
        a.category === selectedProduct.category && b.category !== selectedProduct.category
          ? -1
          : 1
      )
      .slice(0, 4);
  }, [products, selectedProduct]);

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f2eb] text-[#211f1b]">
      <Navbar
        activeView={activeView}
        onNavigateView={navigateView}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
        onOpenAuth={() => handleOpenAuth('login')}
        user={user}
        profile={profile}
      />

      <main className="flex-1">
        {activeView === 'storefront' && (
          <>
            <HeroSection onExploreClick={() => navigateView('storefront', 'shop')} />
            <CollectionsSection onSelectCategory={handleSelectCategory} />
            <ProductGrid
              products={products}
              loading={loadingProducts}
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              onOpenProduct={handleOpenProduct}
              onQuickAdd={(product) => handleAddToCart(product)}
            />
            <StoryAndNewsletter onDiscoverClick={() => navigateView('storefront', 'shop')} />
          </>
        )}

        {activeView === 'product' && selectedProduct && (
          <ProductDetailPage
            product={selectedProduct}
            relatedProducts={relatedProducts}
            onBack={() => navigateView('storefront', 'shop')}
            onAddToCart={(prod, size, qty) => handleAddToCart(prod, size, qty)}
            onSelectProduct={handleOpenProduct}
          />
        )}

        {activeView === 'checkout' && (
          <CheckoutView
            user={user}
            profile={profile}
            cart={cart}
            products={products}
            onBack={() => navigateView('storefront', 'shop')}
            onRequireAuth={() =>
              handleOpenAuth('login', 'Sign in or create an account to place your order.')
            }
            onOrderCreated={() => setCart([])}
            onViewOrders={() => navigateView('account')}
          />
        )}

        {activeView === 'account' && (
          <AccountView
            user={user}
            profile={profile}
            onBack={() => navigateView('storefront', 'shop')}
            onProfileUpdated={() => user && loadProfile(user.id)}
            onLogout={handleLogout}
          />
        )}
      </main>

      <Footer onNavigateView={navigateView} />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        products={products}
        onChangeQty={handleChangeCartQty}
        onRemoveItem={handleRemoveCartItem}
        onProceedToCheckout={handleProceedToCheckout}
      />

      <AuthModal
        open={authModalOpen}
        initialMode={authMode}
        notice={authNotice}
        onClose={() => setAuthModalOpen(false)}
        onAuthSuccess={() => {
          if (supabase && isSupabaseConfigured) {
            supabase.auth.getUser().then(({ data, error }) => {
              if (error) {
                console.error('[APNA KAPDA Auth User Error]', {
                  operation: 'auth.getUser',
                  endpoint: `${SUPABASE_URL}/auth/v1/user`,
                  message: error.message,
                });
                return;
              }
              if (data.user) {
                setUser(data.user);
                loadProfile(data.user.id);
              }
            });
          }
        }}
      />
    </div>
  );
}
