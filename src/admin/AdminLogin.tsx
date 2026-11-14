import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, LogOut, ShieldAlert } from 'lucide-react';
import type { AdminSessionState } from './adminService';
import {
  sendAdminPasswordReset,
  signInAdmin,
  signOutAdmin,
  updateAdminPassword,
} from './adminService';

interface AdminLoginProps {
  sessionState: AdminSessionState;
  isRecoveryMode: boolean;
  onAuthorized: (state: AdminSessionState) => void;
  onRecoveryComplete: () => void;
}

export function AdminLogin({
  sessionState,
  isRecoveryMode,
  onAuthorized,
  onRecoveryComplete,
}: AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSubmitting(true);

    const nextState = await signInAdmin(email, password);
    setSubmitting(false);

    if (nextState.status === 'unauthenticated') {
      setError(nextState.error || 'Authentication failed.');
      return;
    }

    onAuthorized(nextState);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSubmitting(true);

    const res = await sendAdminPasswordReset(email);
    setSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      setSuccessMsg(
        'If this administrator email exists, a password reset link has been sent.'
      );
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (newPassword.length < 8) {
      setError('Administrator password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    const res = await updateAdminPassword(newPassword);
    setSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      setSuccessMsg('Password updated. Verifying admin session...');
      onRecoveryComplete();
    }
  };

  const handleSignOut = async () => {
    await signOutAdmin();
    onAuthorized({ status: 'unauthenticated' });
  };

  if (sessionState.status === 'unconfigured') {
    return (
      <div className="min-h-screen bg-[#151412] text-[#f5f2eb] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#fffdf8] text-[#211f1b] border border-[#e5dfd3] p-8">
          <p className="text-[10px] tracking-[0.26em] uppercase text-[#9a6746] font-bold">
            APNA KAPDA &middot; Admin Console
          </p>
          <h1 className="font-serif-display text-3xl mt-2">
            Supabase Environment Required
          </h1>
          <p className="text-xs text-[#5f594f] leading-relaxed mt-3">
            Configure <code className="bg-[#f5f2eb] px-1.5 py-0.5">VITE_SUPABASE_URL</code>{' '}
            and{' '}
            <code className="bg-[#f5f2eb] px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>{' '}
            in your environment to authenticate administrators. Never expose the
            service-role key in frontend variables.
          </p>
        </div>
      </div>
    );
  }

  if (sessionState.status === 'forbidden') {
    const signedEmail =
      sessionState.profile?.email || sessionState.user.email || 'Unknown user';
    return (
      <div className="min-h-screen bg-[#151412] text-[#f5f2eb] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#fffdf8] text-[#211f1b] border border-[#e5dfd3] p-8">
          <div className="flex items-center gap-3 text-[#b91c1c]">
            <ShieldAlert className="w-6 h-6 shrink-0" />
            <p className="text-[11px] tracking-[0.22em] uppercase font-bold">
              403 &middot; Access Restricted
            </p>
          </div>

          <h1 className="font-serif-display text-3xl mt-3">
            Administrator Privilege Required
          </h1>
          <p className="text-xs text-[#5f594f] leading-relaxed mt-3">
            Signed in as <strong className="text-[#211f1b]">{signedEmail}</strong> (role:{' '}
            <span className="font-mono">{sessionState.profile?.role ?? 'customer'}</span>).{' '}
            {sessionState.reason ||
              'Only accounts explicitly authorized with role = admin can enter this portal.'}
          </p>

          <div className="mt-5 p-4 bg-[#f5f2eb] border border-[#e5dfd3]">
            <p className="text-[10px] tracking-[0.18em] uppercase font-bold text-[#9a6746] mb-2">
              Authorize Your Account in Supabase SQL Editor
            </p>
            <pre className="text-[11px] font-mono text-[#211f1b] overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`update public.profiles
set role = 'admin'
where lower(email) = lower('${signedEmail}');`}
            </pre>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 px-5 py-3 bg-[#24231f] text-white text-[11px] tracking-[0.16em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
            <span className="text-[11px] text-[#817b70]">
              Enforced by Supabase RLS
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#151412] flex items-center justify-center p-5 sm:p-8">
      <div className="w-full max-w-[440px] bg-[#fffdf8] border border-[#e5dfd3] p-8 sm:p-10">
        <div className="pb-6 border-b border-[#e5dfd3]">
          <div className="flex items-center justify-between">
            <span className="font-serif-display text-2xl tracking-[0.04em] text-[#211f1b] font-semibold">
              APNA KAPDA
            </span>
            <Lock className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="text-[10px] tracking-[0.24em] uppercase text-[#817b70] mt-2 font-semibold">
            Private Operations Console
          </p>
        </div>

        {isRecoveryMode ? (
          <form onSubmit={handleUpdatePassword} className="mt-6 space-y-4">
            <div className="flex items-center gap-2 text-[#211f1b]">
              <KeyRound className="w-4 h-4 text-[#9a6746]" />
              <h1 className="font-serif-display text-2xl">Set New Password</h1>
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
                New Administrator Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
              />
            </div>

            {error && (
              <p className="text-xs text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] p-3">
                {error}
              </p>
            )}
            {successMsg && (
              <p className="text-xs text-[#2b6345] bg-[#ecfdf5] border border-[#a7f3d0] p-3">
                {successMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-[#24231f] text-white text-[11px] tracking-[0.18em] uppercase font-semibold hover:bg-[#9a6746] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        ) : mode === 'login' ? (
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <h1 className="font-serif-display text-2xl text-[#211f1b]">
                Administrator Sign In
              </h1>
              <p className="text-xs text-[#817b70] mt-1">
                Authorized personnel only. Public registration is disabled.
              </p>
            </div>

            <div>
              <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@apnakapda.com"
                className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setSuccessMsg('');
                    setMode('forgot');
                  }}
                  className="text-[11px] text-[#9a6746] hover:text-[#211f1b] transition-colors cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-3.5 py-2.5 pr-10 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] p-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-[#24231f] text-white text-[11px] tracking-[0.18em] uppercase font-semibold hover:bg-[#9a6746] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Verifying Role...' : 'Enter Admin Portal'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="mt-6 space-y-4">
            <div>
              <h1 className="font-serif-display text-2xl text-[#211f1b]">
                Reset Admin Password
              </h1>
              <p className="text-xs text-[#817b70] mt-1">
                Receive a password recovery link for your authorized admin account.
              </p>
            </div>

            <div>
              <label className="block text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@apnakapda.com"
                className="w-full px-3.5 py-2.5 text-sm bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
              />
            </div>

            {error && (
              <p className="text-xs text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] p-3">
                {error}
              </p>
            )}
            {successMsg && (
              <p className="text-xs text-[#2b6345] bg-[#ecfdf5] border border-[#a7f3d0] p-3">
                {successMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-[#24231f] text-white text-[11px] tracking-[0.18em] uppercase font-semibold hover:bg-[#9a6746] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Sending Link...' : 'Send Recovery Link'}
            </button>

            <button
              type="button"
              onClick={() => {
                setError('');
                setSuccessMsg('');
                setMode('login');
              }}
              className="w-full py-2 text-xs text-[#817b70] hover:text-[#211f1b] transition-colors cursor-pointer"
            >
              &larr; Back to sign in
            </button>
          </form>
        )}

        <p className="mt-6 pt-5 border-t border-[#e5dfd3] text-[11px] text-[#817b70] leading-relaxed">
          Role enforcement is verified server-side via PostgreSQL Row Level Security (
          <code className="text-[#211f1b]">public.is_admin()</code>).
        </p>
      </div>
    </div>
  );
}
