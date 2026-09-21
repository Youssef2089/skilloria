import type { Metadata } from "next";
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { DomainProvider } from "@/context/DomainContext";
import NavHistoryProvider from "@/components/shell/NavHistoryProvider";
import { getDomainConfig } from "@/lib/get-domain-config";
import { stylePalette } from "@/lib/palette";
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

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║ LA PALETTE EST POSÉE ICI, SUR `<html>`, ET NULLE PART AILLEURS.        ║
  // ║                                                                        ║
  // ║ C'est `:root` lui-même : tous les jetons `--sk-*` du produit naissent   ║
  // ║ de cette ligne, résolus au serveur pour l'écosystème servi.            ║
  // ║                                                                        ║
  // ║ Pourquoi un style EN LIGNE plutôt qu'une feuille :                      ║
  // ║  · il l'emporte sur toute feuille, donc il n'existe aucun second        ║
  // ║    endroit où une couleur pourrait vivre ;                              ║
  // ║  · il arrive dans le HTML initial, donc la page n'est jamais peinte     ║
  // ║    sans sa palette ;                                                    ║
  // ║  · et surtout il ferme par CONSTRUCTION le défaut mesuré le 21/09/2026 : ║
  // ║    `globals.css` dérivait deux jetons par `color-mix()` sur `:root`,    ║
  // ║    et une propriété personnalisée est substituée LÀ OÙ ELLE EST         ║
  // ║    DÉCLARÉE. Les dérivés se figeaient donc sur la valeur de secours et  ║
  // ║    ignoraient la surcharge posée plus bas par le shell — le menu actif  ║
  // ║    sortait en indigo pendant que le logo était en bleu ciel. Ici, tout  ║
  // ║    est déjà calculé : il n'y a plus rien à dériver au navigateur.       ║
  // ╚════════════════════════════════════════════════════════════════════════╝
  return (
    <html lang={locale} style={stylePalette(domainConfig.palette)}>
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
