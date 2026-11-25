import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#0B0E14',
};

export const metadata: Metadata = {
  title: 'Zip Upgrader',
  description:
    'Browser-first software project archive inspector, safety verifier, secret scanner, and controlled upgrade pipeline.',
  openGraph: {
    title: 'Zip Upgrader',
    description:
      'Browser-first software project archive inspector, safety verifier, secret scanner, and controlled upgrade pipeline.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Zip Upgrader',
    description:
      'Browser-first software project archive inspector, safety verifier, secret scanner, and controlled upgrade pipeline.',
  },
};

const isDev = process.env.NODE_ENV !== 'production';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
