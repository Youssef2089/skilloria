import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Les pages légales lisent docs/legal/*.md via fs au runtime (lib/legal-docs).
  // Next ne trace pas ces fichiers automatiquement (pas d'import statique) → on
  // les force dans le bundle serverless Vercel, sinon 500 "file not found" en prod.
  outputFileTracingIncludes: {
    '/[locale]/mentions-legales': ['./docs/legal/*.md'],
    '/[locale]/politique-de-confidentialite': ['./docs/legal/*.md'],
    '/[locale]/cgu': ['./docs/legal/*.md'],
  },
};

export default withNextIntl(nextConfig);
