// Test isolé du recalibrage gate IA publication — Option A.
// Appelle verifyAiPublicationQuality sur 2 cas pour valider :
//  (a) annonce légitime + champs optionnels vides → score ≥ 7 attendu
//  (b) annonce avec coordonnées personnelles → flag bloquant attendu
//
// Charge .env.local pour ANTHROPIC_API_KEY puis import dynamique du module compilé.
// Usage : node scripts/diag-gate-recalibrage.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Charge .env.local
const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

// Import dynamique du module TS via tsx
const { verifyAiPublicationQuality } = await import('../lib/verification/ai-publication-quality.ts')

const inputA = {
  type: 'mission',
  title: 'Consultant D365 supply chain',
  description:
    "Mission de 6 mois pour un grand groupe industriel : refonte du module supply chain " +
    'sur Microsoft Dynamics 365 Finance & Operations. Vous interviendrez sur l\'analyse ' +
    'des processus métier, la configuration fonctionnelle (achats, stocks, planification, ' +
    "expéditions), la conduite d'ateliers utilisateurs, et l'accompagnement à la recette. " +
    "Environnement multi-sites européens, équipe projet de 12 personnes côté client, " +
    "intégrateur déjà mobilisé. Démarrage rapide souhaité.",
  skills_required: ['Dynamics 365 F&O', 'Supply Chain Management', 'Configuration fonctionnelle'],
  seniority: null,
  work_mode: null,
  location: null,
  duration: null,
  budget_min: 700,
  budget_max: 950,
  locale: 'fr',
}

const inputB = {
  type: 'mission',
  title: 'Consultant Power BI senior',
  description:
    "Mission Power BI pour reprise de tableaux de bord finance. " +
    "Contactez-moi directement à mon adresse perso : recruteur.toto@gmail.com " +
    "ou au 06 12 34 56 78 pour discuter du brief avant Skilloria.",
  skills_required: ['Power BI', 'DAX', 'Modélisation'],
  seniority: 'senior',
  work_mode: 'hybrid',
  location: 'Paris',
  duration: '4 mois',
  budget_min: 600,
  budget_max: 800,
  locale: 'fr',
}

console.log('=== CAS (a) — annonce légitime + champs optionnels vides ===\n')
console.log('Input.type     :', inputA.type)
console.log('Input.title    :', inputA.title)
console.log('Input.seniority:', inputA.seniority)
console.log('Input.budget   :', inputA.budget_min, '–', inputA.budget_max, '(dérivé →', inputA.type === 'mission' ? '€/jour' : '€/an', ')')
console.log()
const t0 = Date.now()
const outA = await verifyAiPublicationQuality(inputA)
console.log('→ result :', outA.result)
console.log('→ score  :', outA.score, '(seuil =', 7, ')')
console.log('→ flags  :', JSON.stringify(outA.flags))
console.log('→ notes  :', outA.notes)
console.log('→ verdict applicatif :', outA.score >= 7 && !outA.flags.some(f => ['contact_info','discriminatory','illegal'].includes(f))
  ? 'PUBLIÉ ✓' : 'pending_review ✗')
console.log('→ durée  :', Date.now() - t0, 'ms\n')

console.log('=== CAS (b) — annonce avec coordonnées perso ===\n')
console.log('Input.title    :', inputB.title)
console.log('Input.description contient email + téléphone')
console.log()
const t1 = Date.now()
const outB = await verifyAiPublicationQuality(inputB)
console.log('→ result :', outB.result)
console.log('→ score  :', outB.score)
console.log('→ flags  :', JSON.stringify(outB.flags))
console.log('→ notes  :', outB.notes)
console.log('→ verdict applicatif :', outB.score >= 7 && !outB.flags.some(f => ['contact_info','discriminatory','illegal'].includes(f))
  ? 'PUBLIÉ (problème — sécurité affaiblie)' : 'pending_review / bloqué ✓')
console.log('→ durée  :', Date.now() - t1, 'ms')
