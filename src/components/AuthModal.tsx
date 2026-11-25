import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, X } from 'lucide-react';
import { isSupabaseConfigured, supabase, SUPABASE_URL } from '../lib/supabase';
import type { AuthMode } from '../types';
import { STORE_EASE } from './StoreMotion';

interface AuthModalProps {
  open: boolean;
  initialMode?: AuthMode;
  notice?: string;
  onClose: () => void;
  onAuthSuccess: () => void;
}

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-xl border border-[#dfd6c7] bg-[#faf7f2]/65 focus:bg-[#fffdf9] text-xs outline-none focus:border-[#8d5b3c] text-[#1f1d1a] placeholder:text-[#9c9487] transition-colors';

export function AuthModal({
  open,
  initialMode = 'login',
  notice,
  onClose,
  onAuthSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string>('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (notice) {
      setMessage(notice);
      setIsError(false);
    }
  }, [notice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setIsError(false);

    if (!supabase || !isSupabaseConfigured) {
      setIsError(true);
      setMessage(
        'Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file to enable real authentication.'
      );
      return;
    }

    if (mode === 'recovery') {
      if (newPassword.length < 6) {
        setIsError(true);
        setMessage('New password must be at least 6 characters.');
        return;
      }
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      setLoading(false);
      if (error) {
        console.error('[APNA KAPDA Auth Error]', {
          operation: 'auth.updateUser',
          endpoint: `${SUPABASE_URL}/auth/v1/user`,
          status: error.status,
          message: error.message,
        });
        setIsError(true);
        setMessage(error.message);
        return;
      }
      setMessage('Password updated successfully. You are now signed in.');
      onAuthSuccess();
      setTimeout(onClose, 1000);
      return;
    }

    if (!email.trim() || !password) {
      setIsError(true);
      setMessage('Please enter both your email address and password.');
      return;
    }

    if (password.length < 6) {
      setIsError(true);
      setMessage('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    if (mode === 'signup') {
      if (!fullName.trim()) {
        setLoading(false);
        setIsError(true);
        setMessage('Please enter your full name.');
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: window.location.origin,
        },
      });
      setLoading(false);
      if (error) {
        console.error('[APNA KAPDA Auth Error]', {
          operation: 'auth.signUp',
          endpoint: `${SUPABASE_URL}/auth/v1/signup`,
          status: error.status,
          message: error.message,
        });
        setIsError(true);
        setMessage(error.message);
        return;
      }
      if (!data.session) {
        setMessage(
          'Account created. Check your email inbox to confirm your APNA KAPDA account.'
        );
        return;
      }
      setMessage('Welcome to APNA KAPDA.');
      onAuthSuccess();
      setTimeout(onClose, 800);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (error) {
      console.error('[APNA KAPDA Auth Error]', {
        operation: 'auth.signInWithPassword',
        endpoint: `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        status: error.status,
        message: error.message,
      });
      setIsError(true);
      setMessage(error.message);
      return;
    }

    setMessage('Welcome back to APNA KAPDA.');
    onAuthSuccess();
    setTimeout(onClose, 700);
  };

  const handleForgotPassword = async () => {
    setMessage('');
    setIsError(false);

    if (!email.trim()) {
      setIsError(true);
      setMessage('Enter your registered email address first.');
      return;
    }

    if (!supabase || !isSupabaseConfigured) {
      setIsError(true);
      setMessage('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setLoading(false);

    if (error) {
      console.error('[APNA KAPDA Auth Error]', {
        operation: 'auth.resetPasswordForEmail',
        endpoint: `${SUPABASE_URL}/auth/v1/recover`,
        status: error.status,
        message: error.message,
      });
      setIsError(true);
      setMessage(error.message);
      return;
    }

    setMessage(
      'If an account exists for this email, a password reset link has been sent.'
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Account authentication"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.24, ease: STORE_EASE }}
            className="relative w-full max-w-[430px] rounded-[28px] bg-[#fffdf9] border border-[#e8e1d5] p-7 sm:p-9 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close authentication modal"
              className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center text-[#7c756b] hover:text-[#1f1d1a] hover:bg-[#f2ece0] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <p className="text-[10px] tracking-[0.26em] uppercase text-[#8d5b3c] font-bold">
              Welcome to APNA KAPDA
            </p>

            <h2 className="font-serif-display text-3xl text-[#1f1d1a] mt-2 mb-1.5">
              {mode === 'signup'
                ? 'Create your account.'
                : mode === 'recovery'
                  ? 'Reset password.'
                  : 'Welcome back.'}
            </h2>
            <p className="text-xs text-[#7c756b] mb-6">
              {mode === 'signup'
                ? 'Join APNA KAPDA to save your address and track orders.'
                : mode === 'recovery'
                  ? 'Choose a new password for your APNA KAPDA account.'
                  : 'Sign in with your email and password.'}
            </p>

            {!isSupabaseConfigured && (
              <div className="mb-4 p-3.5 rounded-xl bg-[#f8f4ed] border border-[#e5ddd0] text-[11px] text-[#69645b] leading-relaxed">
                Supabase environment variables are not connected yet. Add{' '}
                <code className="font-mono text-[#1f1d1a]">VITE_SUPABASE_URL</code>{' '}
                and{' '}
                <code className="font-mono text-[#1f1d1a]">
                  VITE_SUPABASE_ANON_KEY
                </code>{' '}
                to activate live authentication.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === 'signup' && (
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  required
                  className={INPUT_CLASS}
                />
              )}

              {mode !== 'recovery' ? (
                <>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    required
                    className={INPUT_CLASS}
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (min. 6 characters)"
                    required
                    className={INPUT_CLASS}
                  />
                </>
              ) : (
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 6 characters)"
                  required
                  className={INPUT_CLASS}
                />
              )}

              {mode === 'login' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-[11px] text-[#8d5b3c] hover:text-[#1f1d1a] underline underline-offset-2 cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 rounded-full bg-[#1f1d1a] text-white py-3.5 px-5 text-[11px] tracking-[0.16em] uppercase font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#8d5b3c] transition-colors disabled:opacity-50 cursor-pointer"
              >
                <span>
                  {loading
                    ? 'Please wait...'
                    : mode === 'signup'
                      ? 'Create Account'
                      : mode === 'recovery'
                        ? 'Update Password'
                        : 'Sign In'}
                </span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </form>

            {message && (
              <p
                className={`text-xs mt-4 leading-relaxed ${
                  isError ? 'text-[#9a3b26]' : 'text-[#8d5b3c]'
                }`}
              >
                {message}
              </p>
            )}

            {mode !== 'recovery' && (
              <p className="text-center text-xs text-[#7c756b] mt-6">
                {mode === 'signup' ? (
                  <>
                    Already a member?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setMessage('');
                      }}
                      className="text-[#8d5b3c] font-semibold underline underline-offset-2 cursor-pointer"
                    >
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    New here?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('signup');
                        setMessage('');
                      }}
                      className="text-[#8d5b3c] font-semibold underline underline-offset-2 cursor-pointer"
                    >
                      Create an account
                    </button>
                  </>
                )}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
