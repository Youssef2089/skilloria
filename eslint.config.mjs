import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // ARTEFACT DE BUILD VERCEL — ignoré par git, pas par eslint jusqu'ici.
    //
    //   `.vercel/output/**` contient le lanceur que Vercel GÉNÈRE, et il porte
    //   deux `require()` que la règle `no-require-imports` dénonce. Ce n'est pas
    //   notre code, on ne peut pas le corriger, et il n'est pas dans le dépôt.
    //
    //   L'effet était pire que ces deux erreurs : `npm run lint` rendait 89
    //   erreurs sur une machine qui avait lancé `vercel build`, et 87 partout
    //   ailleurs. Une base de référence qui dépend de ce qu'on a exécuté
    //   localement ne peut pas servir de base — c'est la famille §E.3, « vert
    //   chez son auteur et rouge partout ailleurs ».
    ".vercel/**",
  ]),
]);

export default eslintConfig;
