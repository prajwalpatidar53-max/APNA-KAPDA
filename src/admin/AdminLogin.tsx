import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import { ADMIN_EASE } from './AdminMotion';
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

const BACKDROP_STYLE =
  'min-h-screen bg-gradient-to-br from-[#0a2533] via-[#154c5e] to-[#0a202d] text-[#0f2430] flex items-center justify-center p-5 sm:p-8';

const CARD_STYLE =
  'rounded-[28px] bg-[#edf4f6]/95 backdrop-blur-md border border-white/85 shadow-[0_24px_64px_-20px_rgba(4,18,28,0.5)]';

const INPUT_STYLE =
  'w-full px-4 py-2.5 rounded-xl text-sm bg-white border border-slate-200 focus:border-[#0e7490] outline-none text-[#0f2430] placeholder:text-slate-400 transition-colors';

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
      <div className={BACKDROP_STYLE}>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: ADMIN_EASE }}
          className={`max-w-lg w-full p-8 ${CARD_STYLE}`}
        >
          <p className="text-xs font-semibold text-[#0e7490]">
            APNA KAPDA &middot; Admin Console
          </p>
          <h1 className="text-2xl font-semibold text-[#0f2430] tracking-tight mt-2">
            Supabase Environment Required
          </h1>
          <p className="text-sm text-[#546e7a] leading-relaxed mt-3">
            Configure{' '}
            <code className="rounded bg-white border border-slate-200 px-1.5 py-0.5 text-xs text-[#0f2430]">
              VITE_SUPABASE_URL
            </code>{' '}
            and{' '}
            <code className="rounded bg-white border border-slate-200 px-1.5 py-0.5 text-xs text-[#0f2430]">
              VITE_SUPABASE_ANON_KEY
            </code>{' '}
            in your environment to authenticate administrators. Never expose the
            service-role key in frontend variables.
          </p>
        </motion.div>
      </div>
    );
  }

  if (sessionState.status === 'forbidden') {
    const signedEmail =
      sessionState.profile?.email || sessionState.user.email || 'Unknown user';
    return (
      <div className={BACKDROP_STYLE}>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: ADMIN_EASE }}
          className={`max-w-lg w-full p-8 ${CARD_STYLE}`}
        >
          <div className="flex items-center gap-2.5 text-rose-700">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <p className="text-xs font-semibold tracking-wide">
              403 &middot; Access Restricted
            </p>
          </div>

          <h1 className="text-2xl font-semibold text-[#0f2430] tracking-tight mt-3">
            Administrator Privilege Required
          </h1>
          <p className="text-sm text-[#546e7a] leading-relaxed mt-3">
            Signed in as <strong className="text-[#0f2430]">{signedEmail}</strong>{' '}
            (role:{' '}
            <span className="font-mono text-[#0e7490] font-semibold">
              {sessionState.profile?.role ?? 'customer'}
            </span>
            ).{' '}
            {sessionState.reason ||
              'Only accounts explicitly authorized with role = admin can enter this portal.'}
          </p>

          <div className="mt-5 p-4 rounded-2xl bg-[#0c2330] text-cyan-50">
            <p className="text-xs font-medium text-cyan-300 mb-2">
              Authorize Your Account in Supabase SQL Editor
            </p>
            <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`update public.profiles
set role = 'admin'
where lower(email) = lower('${signedEmail}');`}
            </pre>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0f2430] text-white text-xs font-semibold hover:bg-[#0e7490] transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
            <span className="text-xs text-[#647d89]">
              Enforced by Supabase RLS
            </span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={BACKDROP_STYLE}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: ADMIN_EASE }}
        className={`w-full max-w-[430px] p-7 sm:p-9 ${CARD_STYLE}`}
      >
        <div className="pb-5 border-b border-slate-200/80 flex items-center justify-between">
          <div>
            <span className="font-serif-display text-2xl tracking-[0.04em] text-[#0f2430] font-semibold">
              APNA KAPDA
            </span>
            <p className="text-xs text-[#546e7a] mt-0.5">
              Admin Operations Console
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-[#dff0f4] border border-[#c5e4ec] flex items-center justify-center text-[#0e7490]">
            <Lock className="w-4 h-4" />
          </div>
        </div>

        {isRecoveryMode ? (
          <form onSubmit={handleUpdatePassword} className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 text-[#0f2430]">
              <KeyRound className="w-4 h-4 text-[#0e7490]" />
              <h1 className="text-xl font-semibold tracking-tight">
                Set New Password
              </h1>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3c5663] mb-1.5">
                New Administrator Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className={INPUT_STYLE}
              />
            </div>

            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                {error}
              </p>
            )}
            {successMsg && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                {successMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-full bg-[#0f2430] text-white text-xs font-semibold hover:bg-[#0e7490] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        ) : mode === 'login' ? (
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <h1 className="text-xl font-semibold text-[#0f2430] tracking-tight">
                Administrator Sign In
              </h1>
              <p className="text-xs text-[#546e7a] mt-1">
                Authorized personnel only. Public registration is disabled.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3c5663] mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@apnakapda.com"
                className={INPUT_STYLE}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-[#3c5663]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setSuccessMsg('');
                    setMode('forgot');
                  }}
                  className="text-xs text-[#0e7490] hover:text-[#0f2430] font-medium transition-colors cursor-pointer"
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
                  className={`${INPUT_STYLE} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0f2430] cursor-pointer"
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
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-full bg-[#0f2430] text-white text-xs font-semibold hover:bg-[#0e7490] transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2 shadow-sm"
            >
              <span>{submitting ? 'Verifying Role...' : 'Enter Admin Portal'}</span>
              {!submitting && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="mt-6 space-y-4">
            <div>
              <h1 className="text-xl font-semibold text-[#0f2430] tracking-tight">
                Reset Admin Password
              </h1>
              <p className="text-xs text-[#546e7a] mt-1">
                Receive a password recovery link for your authorized admin account.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3c5663] mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@apnakapda.com"
                className={INPUT_STYLE}
              />
            </div>

            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                {error}
              </p>
            )}
            {successMsg && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                {successMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-full bg-[#0f2430] text-white text-xs font-semibold hover:bg-[#0e7490] transition-colors disabled:opacity-50 cursor-pointer"
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
              className="w-full py-2 text-xs text-[#546e7a] hover:text-[#0f2430] transition-colors cursor-pointer"
            >
              &larr; Back to sign in
            </button>
          </form>
        )}

        <p className="mt-6 pt-5 border-t border-slate-200/80 text-xs text-[#647d89] leading-relaxed">
          Role enforcement is verified server-side via PostgreSQL Row Level Security (
          <code className="text-[#0f2430] font-medium">public.is_admin()</code>).
        </p>
      </motion.div>
    </div>
  );
}
