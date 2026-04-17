import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { DomainProvider } from "@/context/DomainContext";
import { defaultDomainConfig } from "@/lib/domain-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Skilloria 365 — La marketplace Microsoft pilotée par l'IA",
  description: "Trouvez les meilleurs experts Microsoft certifiés. Zéro commission. Matching IA en 24h.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers()
  const subdomain = headersList.get('x-subdomain') || 'microsoft'

  // Pour l'instant on utilise la config par défaut
  // Plus tard, on ira chercher la config en base selon le subdomain
  const domainConfig = {
    ...defaultDomainConfig,
    subdomain,
  }

  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-full flex flex-col`}>
        <DomainProvider config={domainConfig}>
          {children}
        </DomainProvider>
      </body>
    </html>
  );
}