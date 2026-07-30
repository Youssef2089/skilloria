import type { Metadata } from "next";
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { DomainProvider } from "@/context/DomainContext";
import NavHistoryProvider from "@/components/shell/NavHistoryProvider";
import { getDomainConfig } from "@/lib/get-domain-config";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Plus Jakarta Sans — police premium du shell dashboard (Lot refonte UX).
// next/font/google gère preload + display:swap par défaut → pas de FOIT,
// pas de layout shift à l'apparition de la police.
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params;
  // Nom de plateforme, nom d'écosystème et formulation : tous résolus depuis le
  // domaine servi et les traductions de la locale. Rien en dur.
  const [domain, t] = await Promise.all([
    getDomainConfig(locale),
    getTranslations({ locale, namespace: 'app.meta' }),
  ]);
  return {
    title: t('title', { name: domain.name, ecosystem: domain.ecosystemName }),
    description: t('description', { name: domain.name, ecosystem: domain.ecosystemName }),
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
    getDomainConfig(locale),
    getMessages(),
  ]);

  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} ${plusJakarta.variable} min-h-full flex flex-col`}>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <DomainProvider config={domainConfig}>
            <NavHistoryProvider>
              {children}
            </NavHistoryProvider>
          </DomainProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
