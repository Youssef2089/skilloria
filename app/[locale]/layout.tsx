import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { DomainProvider } from "@/context/DomainContext";
import { getDomainConfig } from "@/lib/get-domain-config";
import { routing } from "@/i18n/routing";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const domain = await getDomainConfig();
  return {
    title: `Skilloria 365 — La marketplace ${domain.ecosystemName} pilotée par l'IA`,
    description: `Trouvez les meilleurs experts ${domain.ecosystemName} certifiés. Zéro commission. Matching IA en 24h.`,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const [domainConfig, messages] = await Promise.all([
    getDomainConfig(),
    getMessages(),
  ]);

  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-full flex flex-col`}>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <DomainProvider config={domainConfig}>
            <div style={{ position: "fixed", top: 12, right: 12, zIndex: 100 }}>
              <LanguageSwitcher />
            </div>
            {children}
          </DomainProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
