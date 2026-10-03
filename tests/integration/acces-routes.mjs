#!/usr/bin/env node
// tests/integration/acces-routes.mjs — LES ACCÈS CROISÉS PAR LES ROUTES (lot DevOps CI, 03/10/2026).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL PROUVE, contre l'application CONSTRUITE et DÉMARRÉE sur la base jetable du runner :
//   R1. LE VISITEUR CONTRE TOUTE ROUTE PRIVÉE — DÉRIVÉ : chaque `app/api/**/route.ts`, chaque méthode exportée,
//       sans jeton → 401 avec un `code`. Seules les routes publiques DÉCLARÉES ci-dessous (avec leur raison)
//       échappent ; une route nouvelle sans garde, non déclarée, rougit. Une entrée déclarée qui n'existe plus
//       rougit aussi (§G.8 : une exemption sans objet ment).
//   R2. TOUT RÔLE CONTRE L'ADMINISTRATION — DÉRIVÉ : chaque route sous `/api/admin`, chaque méthode, avec le jeton
//       d'un expert freelance, d'un expert CDI, d'un client, d'un cabinet, d'une ESN → 403 `forbidden`. Et
//       l'administrateur, lui, passe la garde de chaque lecture (`GET`).
//   R3. CE QUE CHAQUE RÔLE PEUT LIRE (200), et le refus NOMMÉ de ce qui n'est pas à lui (statut + code).
//   R4. A CONTRE B — l'identifiant de l'autre, sur les routes à identifiant ; puis la base, relue : RIEN n'a changé.
//   R5. Les gardes transverses : un jeton d'un autre compte que celui affiché (403 `compte_different`, §D.29),
//       une adresse d'écosystème inconnue (403 `unknown_domain`).
//
// CE QU'IL NE VOIT PAS, ET LE DIT : la messagerie entre A et B (une conversation n'existe qu'après un dévoilement
//   payant — elle n'est sondée que par un identifiant inexistant) ; les routes publiques au-delà de leur
//   déclaration (les parcours de S1 les éprouvent) ; ce qu'un écran affiche.
//
// Les comptes : tests/integration/semences-acces.sql (par l'inscription, avec leur preuve). La base n'est jamais
// celle de staging ni de la production : `environnementLocal()` refuse une adresse qui n'est pas locale.
//
//   node tests/integration/acces-routes.mjs      (après supabase start, env-supabase-local, build, next start)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from 'node:crypto'
import { Banc, RACINE, environnementLocal, executerSql, lireJson, nAPasTourne, requete, seConnecter } from './outils.mjs'
import { PUBLIQUES, routesDuDepot } from './routes-publiques.mjs'

const MOT_DE_PASSE = 'ci-motdepasse-factice-0001'

const banc = new Banc('Accès croisés par les routes')

// ── Les routes, dérivées du dépôt (une seule dérivation : routes-publiques.mjs, avec la liste des publiques) ──
const routes = () => routesDuDepot(RACINE)
/** `admin/get-user/[id]` → `/api/admin/get-user/<uuid aléatoire>` : un identifiant qui n'existe pas. */
const url = (chemin, remplacements = {}) =>
  '/api/' + chemin.replace(/\[([^\]]+)\]/g, (_, nom) => remplacements[nom] ?? randomUUID())

/** Exécute des requêtes par petits paquets : l'application démarrée est seule, le banc ne l'inonde pas. */
async function parPaquets(items, taille, f) {
  const sorties = []
  for (let i = 0; i < items.length; i += taille) sorties.push(...(await Promise.all(items.slice(i, i + taille).map(f))))
  return sorties
}

const code = (r) => (r.json && typeof r.json.code === 'string' ? r.json.code : null)
const decrire = (r) => `HTTP ${r.statut} ${code(r) ?? '(sans code)'} ${r.json ? '' : r.texte}`.trim()

async function principal() {
  const env = environnementLocal()
  if (env.erreur) return nAPasTourne(banc.titre, env.erreur)
  const racine = process.env.NEXT_PUBLIC_DOMAINE_RACINE
  if (!racine) return nAPasTourne(banc.titre, 'NEXT_PUBLIC_DOMAINE_RACINE absente : l’écosystème se lit dans l’adresse')

  // ── Les comptes et les données ──
  let refs
  try {
    refs = lireJson(executerSql('tests/integration/semences-acces.sql', { db: env.db, variables: { mdp: MOT_DE_PASSE } }), 'REFERENCES')
  } catch (e) {
    return nAPasTourne(banc.titre, `semences impossibles : ${e.message}`)
  }
  const hote = `${refs.slug}.${racine}`
  const ROLES = ['expert_a', 'expert_b', 'cdi', 'client_a', 'client_b', 'cabinet', 'esn', 'admin']
  const jetons = {}
  try {
    for (const r of ROLES) jetons[r] = await seConnecter(env, refs[`email_${r}`], MOT_DE_PASSE)
  } catch (e) {
    return nAPasTourne(banc.titre, `connexion par GoTrue impossible : ${e.message}`)
  }
  const appel = (role, methode, chemin, corps) =>
    requete({ methode, chemin, hote, jeton: role ? jetons[role] : null, compte: role ? refs[role] : null, corps })

  // L'application répond-elle vraiment sous cette adresse ? Un administrateur lit son propre compte.
  const sonde = await appel('admin', 'GET', '/api/auth/check-session')
  if (sonde.statut !== 200) return nAPasTourne(banc.titre, `l’application ne sert pas un compte valide (${decrire(sonde)}) — rien ne serait prouvé`)

  const toutes = routes()

  // ── R1. Le visiteur ──
  banc.section('R1. Le visiteur, sans jeton, contre chaque route privée (dérivé du dépôt)')
  const existantes = new Set(toutes.map((r) => r.chemin))
  const fantomes = [...PUBLIQUES.keys()].filter((c) => !existantes.has(c))
  banc.ok(fantomes.length === 0, `les ${PUBLIQUES.size} routes publiques déclarées existent toutes`, fantomes.join(', '))
  const privees = toutes.filter((r) => !PUBLIQUES.has(r.chemin))
  const visiteur = await parPaquets(privees, 8, async (r) => ({ r, rep: await appel(null, r.methode, url(r.chemin), r.methode === 'GET' ? undefined : {}) }))
  const ouvertes = visiteur.filter(({ rep }) => !(rep.statut === 401 && code(rep)))
  banc.ok(ouvertes.length === 0 && privees.length > 100,
    `visiteur : ${privees.length} couples route × méthode privés, chacun refusé en 401 avec un code (no_token, unauthorized)`,
    ouvertes.slice(0, 12).map(({ r, rep }) => `${r.methode} ${r.chemin} → ${decrire(rep)}`).join(' · '))
  const codesVisiteur = [...new Set(visiteur.map(({ rep }) => code(rep)).filter(Boolean))].sort()
  banc.ok(codesVisiteur.every((c) => ['no_token', 'unauthorized'].includes(c)), `visiteur : les refus ne portent que des codes connus (${codesVisiteur.join(', ')})`)

  // ── R2. L'administration ──
  banc.section('R2. Chaque rôle contre chaque route d’administration (dérivé du dépôt)')
  const admin = toutes.filter((r) => r.chemin.startsWith('admin/'))
  for (const role of ['expert_a', 'cdi', 'client_a', 'cabinet', 'esn']) {
    const reps = await parPaquets(admin, 8, async (r) => ({ r, rep: await appel(role, r.methode, url(r.chemin), r.methode === 'GET' ? undefined : {}) }))
    const passees = reps.filter(({ rep }) => !(rep.statut === 403 && code(rep) === 'forbidden'))
    banc.ok(passees.length === 0 && admin.length > 50,
      `${role} : ${admin.length} couples route × méthode d’administration, chacun refusé en 403 forbidden`,
      passees.slice(0, 10).map(({ r, rep }) => `${r.methode} ${r.chemin} → ${decrire(rep)}`).join(' · '))
  }
  const lecturesAdmin = admin.filter((r) => r.methode === 'GET')
  const repsAdmin = await parPaquets(lecturesAdmin, 8, async (r) => ({ r, rep: await appel('admin', 'GET', url(r.chemin)) }))
  const refuseesAdmin = repsAdmin.filter(({ rep }) => [0, 401, 403].includes(rep.statut))
  banc.ok(refuseesAdmin.length === 0, `administrateur : passe la garde des ${lecturesAdmin.length} lectures d’administration`,
    refuseesAdmin.map(({ r, rep }) => `GET ${r.chemin} → ${decrire(rep)}`).join(' · '))

  // ── R3. Ce que chaque rôle peut lire, et le refus nommé du reste ──
  banc.section('R3. Ce que chaque rôle peut lire — et le refus nommé du reste')
  const attendre = async (role, methode, chemin, attendu, libelle, corps) => {
    const rep = await appel(role, methode, chemin, corps)
    const okStatut = rep.statut === attendu.statut
    const okCode = attendu.codes === undefined || attendu.codes.includes(code(rep))
    banc.ok(okStatut && okCode, `${role} — ${libelle} : ${attendu.statut}${attendu.codes ? ` ${attendu.codes.join('|')}` : ''}`, decrire(rep))
    return rep
  }
  const OK = { statut: 200 }
  // L'expert : ses candidatures, ses notifications, la mission qui lui est proposée.
  for (const e of ['expert_a', 'expert_b', 'cdi']) {
    await attendre(e, 'GET', '/api/me/candidatures', OK, 'lit SES candidatures')
    await attendre(e, 'GET', '/api/me/notifications', OK, 'lit SES notifications')
    await attendre(e, 'GET', '/api/me/candidatures-org', { statut: 403, codes: ['org_required'] }, 'les candidatures d’une organisation lui sont refusées')
    await attendre(e, 'GET', `/api/publications/${refs.pub_a}`, { statut: 403, codes: ['org_required'] }, 'une annonce d’organisation lui est refusée')
  }
  await attendre('expert_a', 'GET', `/api/me/missions/${refs.pub_a}`, OK, 'lit la mission qui lui est proposée')
  // Les organisations : client, cabinet, ESN.
  for (const o of ['client_a', 'client_b', 'cabinet', 'esn']) {
    await attendre(o, 'GET', '/api/me/organisation', OK, 'lit SON organisation')
    await attendre(o, 'GET', '/api/me/organisation/members', OK, 'lit les membres de SON organisation')
    await attendre(o, 'GET', '/api/publications', OK, 'lit SES annonces')
    await attendre(o, 'GET', '/api/me/candidatures-org', OK, 'lit les candidatures reçues par SON organisation')
    await attendre(o, 'GET', `/api/me/missions/${refs.pub_a}`, { statut: 404, codes: ['not_found'] }, 'une mission d’expert lui est refusée (aucun profil)')
    await attendre(o, 'POST', '/api/candidatures', { statut: 404, codes: ['profile_missing'] }, 'postuler lui est refusé (aucun profil d’expert)', { publication_id: refs.pub_b })
  }
  await attendre('client_a', 'GET', `/api/publications/${refs.pub_a}`, OK, 'lit SON annonce')
  await attendre('client_a', 'GET', `/api/publications/${refs.pub_a}/candidatures`, OK, 'lit les candidatures de SON annonce')
  await attendre('admin', 'GET', '/api/admin/list-users', OK, 'lit la liste des comptes (administration)')

  // ── R4. A contre B ──
  banc.section('R4. A contre B : l’identifiant de l’autre, puis la base relue')
  const empreinte = () => lireJson(executerSql(`select 'EMPREINTE:' || json_build_object(
      'match_b', (select md5(row(m.*)::text) from public.matches m where m.id = '${refs.match_b}'),
      'notif_b', (select md5(row(n.*)::text) from public.notifications n where n.id = '${refs.notif_b}'),
      'pub_b',   (select md5(row(p.*)::text) from public.publications p where p.id = '${refs.pub_b}'),
      'cand_a',  (select md5(row(c.*)::text) from public.candidatures c where c.id = '${refs.cand_a}'),
      'cand_b',  (select md5(row(c.*)::text) from public.candidatures c where c.id = '${refs.cand_b}'),
      'membre_b', (select md5(row(m.*)::text) from public.organization_members m where m.id = '${refs.membre_client_b}'),
      'org_b',   (select md5(row(o.*)::text) from public.organizations o where o.id = '${refs.org_client_b}'))::text;`, { db: env.db }), 'EMPREINTE')
  const avant = empreinte()
  const REFUS_ID = { statut: 404, codes: ['not_found'] }
  // Une annonce d'une autre organisation : 403 `forbidden` sur certaines routes, 404 `not_found` sur d'autres
  // (relevé du lot DevOps CI) — deux refus NOMMÉS ; l'écart est signalé dans le rapport, pas tranché ici.
  const REFUS_ANNONCE = { statut: 403, codes: ['forbidden'] }
  await attendre('expert_a', 'GET', `/api/me/missions/${refs.pub_b}`, REFUS_ID, 'la mission proposée à B')
  await attendre('expert_a', 'POST', `/api/me/missions/${refs.pub_b}/dismiss`, REFUS_ID, 'écarter la mission de B')
  await attendre('expert_a', 'POST', `/api/me/candidatures/${refs.cand_b}/view`, REFUS_ID, 'marquer vue la candidature de B')
  const lu = await appel('expert_a', 'POST', `/api/me/notifications/${refs.notif_b}/read`)
  banc.ok(lu.statut === 200 || lu.statut === 404, 'expert_a — marquer lue la notification de B : sans effet (la base le dit plus bas)', decrire(lu))
  await attendre('client_a', 'GET', `/api/publications/${refs.pub_b}`, REFUS_ANNONCE, 'lire l’annonce du client B')
  await attendre('client_a', 'PATCH', `/api/publications/${refs.pub_b}`, REFUS_ANNONCE, 'modifier l’annonce du client B', { title: 'Annonce détournée par le client A' })
  await attendre('client_a', 'POST', `/api/publications/${refs.pub_b}/close`, REFUS_ANNONCE, 'clôturer l’annonce du client B')
  await attendre('client_a', 'GET', `/api/publications/${refs.pub_b}/candidatures`, REFUS_ID, 'lire les candidatures du client B')
  await attendre('client_a', 'POST', `/api/candidatures/${refs.cand_a}/select`, REFUS_ID, 'retenir une candidature reçue par B')
  await attendre('client_a', 'POST', `/api/candidatures/${refs.cand_a}/pitch`, REFUS_ID, 'demander l’argumentaire d’une candidature reçue par B')
  await attendre('client_a', 'DELETE', `/api/me/organisation/members/${refs.membre_client_b}`, REFUS_ID, 'retirer un membre de l’organisation B')
  await attendre('client_a', 'POST', `/api/me/candidatures/${refs.cand_a}/view`, REFUS_ID, 'marquer vue une candidature reçue par B')
  for (const o of ['cabinet', 'esn']) {
    await attendre(o, 'GET', `/api/publications/${refs.pub_a}`, REFUS_ANNONCE, 'lire l’annonce du client A')
    await attendre(o, 'GET', `/api/publications/${refs.pub_a}/candidatures`, REFUS_ID, 'lire les candidatures du client A')
  }
  await attendre('expert_a', 'GET', `/api/conversations/${randomUUID()}/messages`, REFUS_ID, 'une conversation qui n’est pas la sienne')
  const apres = empreinte()
  const changees = Object.keys(avant).filter((k) => avant[k] !== apres[k])
  banc.ok(changees.length === 0 && Object.values(avant).every(Boolean),
    'la base relue : le rapprochement, la notification, l’annonce, les candidatures, le membre et l’organisation de B sont intacts',
    changees.length ? `modifiés : ${changees.join(', ')}` : `lignes absentes : ${Object.keys(avant).filter((k) => !avant[k]).join(', ')}`)

  // ── R6. L'organisation non approuvée ──
  //  Le cabinet et l'ESN n'ont jamais été approuvés (ils n'ont rien publié) ; le client A l'a été (sa première annonce, par
  //  l'administration). La garde passe AVANT toute lecture de l'objet : n'importe quel identifiant suffit.
  banc.section('R6. Une organisation non approuvée ne crée, ne modifie, ne publie, ne retient, ne refuse, ne dévoile rien')
  const REFUS_APPROBATION = { statut: 403, codes: ['org_not_approved'] }
  const nouvelle = { type: 'mission', title: 'Annonce du banc des routes', description: 'Une annonce que le banc tente de créer pour une organisation non approuvée.' }
  for (const o of ['cabinet', 'esn']) {
    await attendre(o, 'POST', '/api/publications', REFUS_APPROBATION, 'créer une annonce', nouvelle)
    await attendre(o, 'PATCH', `/api/publications/${randomUUID()}`, REFUS_APPROBATION, 'modifier une annonce', { title: 'Titre modifié par le banc' })
    await attendre(o, 'POST', `/api/publications/${randomUUID()}/publish`, REFUS_APPROBATION, 'publier une annonce')
    await attendre(o, 'POST', `/api/candidatures/${refs.cand_b}/select`, REFUS_APPROBATION, 'retenir un candidat')
    await attendre(o, 'POST', `/api/candidatures/${refs.cand_b}/reject`, REFUS_APPROBATION, 'décliner un candidat', { reason: 'Motif du banc des routes.' })
    await attendre(o, 'POST', `/api/candidatures/${refs.cand_b}/unlock`, REFUS_APPROBATION, 'dévoiler un candidat')
    await attendre(o, 'POST', `/api/candidatures/${refs.cand_b}/pitch`, REFUS_APPROBATION, 'demander l’argumentaire d’un candidat')
    await attendre(o, 'GET', '/api/publications', OK, 'lit encore SES annonces (une lecture n’est pas réservée)')
  }
  //  Le client A est approuvé : la garde le laisse passer — il bute ensuite sur la propriété de l'annonce (R4), pas sur elle.
  await attendre('client_a', 'PATCH', `/api/publications/${refs.pub_b}`, REFUS_ANNONCE, 'approuvé : passe la garde, puis bute sur la propriété de l’annonce de B', { title: 'Annonce détournée par le client A' })
  const apresR6 = empreinte()
  banc.ok(Object.keys(avant).every((k) => avant[k] === apresR6[k]), 'la base relue après R6 : rien n’a changé')

  // ── R5. Les gardes transverses ──
  banc.section('R5. Le compte affiché, et l’écosystème de l’adresse')
  const autreCompte = await requete({ chemin: '/api/me/notifications', hote, jeton: jetons.expert_a, compte: refs.expert_b })
  banc.ok(autreCompte.statut === 403 && code(autreCompte) === 'compte_different',
    'un jeton d’un autre compte que celui affiché est refusé : 403 compte_different (§D.29)', decrire(autreCompte))
  const inconnu = await requete({ chemin: '/api/me/notifications', hote: `ecosysteme-inconnu-ci.${racine}`, jeton: jetons.expert_a, compte: refs.expert_a })
  banc.ok(inconnu.statut === 403 && code(inconnu) === 'unknown_domain',
    'une adresse d’écosystème inconnue est refusée : 403 unknown_domain', decrire(inconnu))

  banc.conclure()
}

await principal()
