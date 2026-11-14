import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://acdokojqxqjmygzeimrx.supabase.co';

function stripSurroundingQuotes(value: string): string {
  return value.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

export function normalizeSupabaseUrl(rawUrl?: string): string {
  const cleaned = stripSurroundingQuotes(rawUrl ?? '');
  if (!cleaned || cleaned.includes('your-project-id')) {
    return DEFAULT_SUPABASE_URL;
  }

  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.pathname && parsed.pathname !== '/') {
      console.warn(
        `[APNA KAPDA] Stripped unexpected path "${parsed.pathname}" from VITE_SUPABASE_URL. Supabase client requires only the project origin (${parsed.origin}).`
      );
    }
    return parsed.origin;
  } catch {
    console.error(
      `[APNA KAPDA] Invalid VITE_SUPABASE_URL format; falling back to ${DEFAULT_SUPABASE_URL}.`
    );
    return DEFAULT_SUPABASE_URL;
  }
}

function sanitizeUrlForLogs(input: RequestInfo | URL): string {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  try {
    const parsed = new URL(raw);
    const sensitiveParams = ['apikey', 'token', 'access_token', 'refresh_token', 'code'];
    sensitiveParams.forEach((param) => {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    });
    return parsed.toString();
  } catch {
    return raw.split('?')[0];
  }
}

function createDiagnosticFetch(): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const safeUrl = sanitizeUrlForLogs(input);

    try {
      const response = await fetch(input, init);

      if (!response.ok) {
        let errorPayload: unknown = undefined;
        try {
          const cloned = response.clone();
          const contentType = cloned.headers.get('content-type') ?? '';
          errorPayload = contentType.includes('application/json')
            ? await cloned.json()
            : await cloned.text();
        } catch {
          errorPayload = undefined;
        }

        const errorCode =
          typeof errorPayload === 'object' &&
          errorPayload !== null &&
          'code' in errorPayload
            ? String((errorPayload as { code?: unknown }).code ?? '')
            : '';

        const isExpectedFallbackOrDuplicate =
          errorCode === 'PGRST205' || errorCode === '23505';

        if (isExpectedFallbackOrDuplicate) {
          console.warn('[APNA KAPDA Supabase Notice]', {
            method,
            url: safeUrl,
            status: response.status,
            code: errorCode,
          });
        } else {
          console.error('[APNA KAPDA Supabase HTTP Error]', {
            method,
            url: safeUrl,
            status: response.status,
            statusText: response.statusText,
            error: errorPayload,
          });
        }
      }

      return response;
    } catch (err) {
      console.error('[APNA KAPDA Supabase Network Error]', {
        method,
        url: safeUrl,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

export const SUPABASE_URL = normalizeSupabaseUrl(
  import.meta.env.VITE_SUPABASE_URL as string | undefined
);

const supabaseAnonKey = stripSurroundingQuotes(
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
);

export const isSupabaseConfigured =
  SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('your-project-id') &&
  supabaseAnonKey.length > 20 &&
  !supabaseAnonKey.includes('your-supabase-anon');

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: createDiagnosticFetch(),
      },
    })
  : null;
