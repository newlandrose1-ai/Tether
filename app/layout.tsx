import type { Metadata, Viewport } from 'next';
import './globals.css'; // Global styles

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#0B0D0E',
};

export const metadata: Metadata = {
  title: 'Tether',
  description: 'A minimal, local-first block workspace where documents, extracted files, and editable code are connected by visible logic tethers.',
  openGraph: {
    title: 'Tether',
    description: 'A minimal, local-first block workspace where documents, extracted files, and editable code are connected by visible logic tethers.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tether',
    description: 'A minimal, local-first block workspace where documents, extracted files, and editable code are connected by visible logic tethers.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
