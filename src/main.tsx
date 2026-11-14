import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const AdminPortal = lazy(() => import('./admin/AdminPortal.tsx'));

function isAdminPortalRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const normalizedPath =
    window.location.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  const hostname = window.location.hostname.toLowerCase();
  return (
    normalizedPath === '/admin' ||
    normalizedPath.startsWith('/admin/') ||
    hostname.startsWith('admin.')
  );
}

function RootRouter() {
  const [isAdmin, setIsAdmin] = useState<boolean>(() => isAdminPortalRoute());

  useEffect(() => {
    const syncRoute = () => setIsAdmin(isAdminPortalRoute());
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  if (isAdmin) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#151412] text-[#f5f2eb] flex items-center justify-center text-xs tracking-[0.2em] uppercase">
            Loading Admin Portal...
          </div>
        }
      >
        <AdminPortal />
      </Suspense>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(<RootRouter />);
