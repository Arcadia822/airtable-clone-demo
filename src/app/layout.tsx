import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { Providers } from "@/components/providers"
import { HydrationMarker } from "@/components/hydration-marker"
import { BRAND } from "@/lib/brand"

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: `${BRAND.name} — Realtime work, beautifully organized`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} min-h-dvh bg-background font-sans text-foreground antialiased`}
      >
        <Providers>
          <HydrationMarker />
          {children}
        </Providers>
      </body>
    </html>
  );
}
