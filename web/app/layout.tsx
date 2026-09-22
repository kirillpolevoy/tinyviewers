import type { Metadata, Viewport } from 'next';
import { Baloo_2 } from 'next/font/google';
import './globals.css';

// Self-hosted by next/font, so the display face is in the first paint and the headline does not
// reflow when the webfont lands.
const baloo = Baloo_2({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-baloo',
  // Georgia is the body face; its metrics are the fallback for the display face too.
  fallback: ['Arial Rounded MT Bold', 'Futura', 'Trebuchet MS', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Tiny Viewers — scene guides for kids’ movies',
  description:
    'Look up a kids’ movie and see every scary or sad scene: exactly when it happens and what’s in it.',
};

export const viewport: Viewport = {
  themeColor: '#F7F1E6',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={baloo.variable}>
      <body>{children}</body>
    </html>
  );
}
