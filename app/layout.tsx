import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DomainProvider } from "@/context/DomainContext";
import { getDomainConfig } from "@/lib/get-domain-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const domain = await getDomainConfig()
  return {
    title: `Skilloria 365 — La marketplace ${domain.ecosystemName} pilotée par l'IA`,
    description: `Trouvez les meilleurs experts ${domain.ecosystemName} certifiés. Zéro commission. Matching IA en 24h.`,
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const domainConfig = await getDomainConfig()

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
