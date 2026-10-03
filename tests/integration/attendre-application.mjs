#!/usr/bin/env node
// tests/integration/attendre-application.mjs — L'APPLICATION DÉMARRÉE RÉPOND-ELLE ? (au plus 90 secondes)
//
// On attend une RÉPONSE, quelle qu'elle soit : un 401 d'une route privée dit que le serveur tourne. Un serveur
// qui ne répond pas en 90 s n'a rien à faire vérifier — le banc des routes ne tournera pas (code 2).

import { requete, nAPasTourne } from './outils.mjs'

const hote = `ci-attente.${process.env.NEXT_PUBLIC_DOMAINE_RACINE ?? 'skilloria.test'}`
const fin = Date.now() + 90_000
let derniere = ''
let pret = false
while (Date.now() < fin) {
  const r = await requete({ chemin: '/api/auth/check-session', hote })
  if (r.statut > 0) { pret = true; console.log(`Application prête (HTTP ${r.statut} sur /api/auth/check-session).`); break }
  derniere = r.texte
  await new Promise((s) => setTimeout(s, 1500))
}
if (!pret) nAPasTourne('Démarrage de l’application', `aucune réponse en 90 s (${derniere})`)
