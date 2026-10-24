import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Atelier · Jewellery Try-On',
  icons: { icon: '/favicon.svg' },
  description:
    'Try your 3D jewellery on a photo. Private placement and local AI image editing.',
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
