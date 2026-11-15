import interRegularUrl from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url';
import interBoldUrl from '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf?url';
import type { PdfFontBundle } from './shippingPdf';

let cachedFontsPromise: Promise<PdfFontBundle | undefined> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchFontBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF font asset (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

export async function loadBrowserPdfFonts(): Promise<PdfFontBundle | undefined> {
  if (!cachedFontsPromise) {
    cachedFontsPromise = (async () => {
      try {
        const [regularBase64, boldBase64] = await Promise.all([
          fetchFontBase64(interRegularUrl),
          fetchFontBase64(interBoldUrl),
        ]);
        return { regularBase64, boldBase64 };
      } catch (err) {
        console.warn('[APNA KAPDA PDF] Falling back to standard PDF font:', err);
        return undefined;
      }
    })();
  }
  return cachedFontsPromise;
}
