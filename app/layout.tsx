import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Atelier · Jewellery Try-On',
  icons: { icon: '/favicon.svg' },
  description:
    'Try your 3D jewellery on a photo. Private, browser-based fitting and image export.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
