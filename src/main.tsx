import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const AdminPortal = lazy(() => import('./admin/AdminPortal.tsx'));

function isAdminPortalRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const pathname = window.location.pathname.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    hostname.startsWith('admin.')
  );
}

const rootElement = document.getElementById('root')!;

if (isAdminPortalRoute()) {
  createRoot(rootElement).render(
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
} else {
  createRoot(rootElement).render(<App />);
}
