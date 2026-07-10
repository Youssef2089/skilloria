// Gating d'environnement. VERCEL_ENV vaut 'production' | 'preview' | 'development' sur Vercel,
// et est undefined en local. On considere "production" UNIQUEMENT l'env de prod Vercel,
// pour que le staging (preview) et le local conservent les facilites de test.
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}
