import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { contexteDepuisAuth, type ContexteJournal } from '@/lib/journal/contexte'
import { ecosystemeModifie } from '@/lib/ecosystemes/journal-ecosysteme'
import { isValidEcosystemSlug } from '@/lib/ecosystem-url'
import {
  COLONNE_PAR_ROLE,
  ROLES_PALETTE,
  MINIMUM_LISIBILITE,
  resolvePalette,
  verifierContraste,
} from '@/lib/palette'
import {
  ecosystemeFaviconStoragePath,
  ecosystemeLogoStoragePath,
  urlPubliqueEcosysteme,
} from '@/lib/org-logo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/admin/ecosystemes/[id] — DÉTAIL ET ÉDITION D'UN ÉCOSYSTÈME.
 *
 * GET   → domains + domain_configs + traductions EN/ES/DE.
 * PATCH → met à jour l'un ou l'autre, et les traductions.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LE FRANÇAIS EST LA COLONNE. LES TROIS AUTRES SONT DES LIGNES.            ║
 * ║                                                                          ║
 * ║ Même modèle que la taxonomie (cf. admin/update-branch) : le FR vit dans  ║
 * ║ la colonne de la table, EN/ES/DE dans `public.translations`, résolus par ║
 * ║ `tBDD` avec repli FR automatique. Une chaîne VIDE pour une langue        ║
 * ║ SUPPRIME sa traduction — elle ne l'écrase pas par du vide, ce qui        ║
 * ║ afficherait un libellé blanc au lieu de retomber sur le français.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LE SOUS-DOMAINE (`slug`) EST UN RÉGLAGE — décision de Youssef, 29/09/2026 ║
 * ║                                                                          ║
 * ║ Il était « non modifiable ici » : il fallait le déclarer chez l'hébergeur║
 * ║ un par un. Depuis l'adresse générique (`*.<racine>`, mise-en-production  ║
 * ║ étape 6), il n'y a plus rien à déclarer, et l'identifiant technique      ║
 * ║ (`domains.id`) porte toutes les références : rien n'en dépend en base.   ║
 * ║                                                                          ║
 * ║ SON CHANGEMENT EST UN GESTE À PART : seul dans la requête (un nom et un  ║
 * ║ sous-domaine changés d'un même clic ne se relisent pas), confirmé à      ║
 * ║ l'écran, écrit à la condition que la valeur lue n'ait pas bougé, tracé   ║
 * ║ sous `ecosysteme_modifie` avec l'opération `sous_domaine`, avant/après.  ║
 * ║ La FORME et l'UNICITÉ sont tenues EN BASE (`domains_sous_domaine_forme`, ║
 * ║ `domains_slug_key`) : la route les nomme, elle ne les invente pas.       ║
 * ║                                                                          ║
 * ║ CE QUE LE CHANGEMENT DÉPLACE (docs/mise-en-production.md, étape 6) :     ║
 * ║ l'ancienne adresse ne sert plus l'écosystème — les liens des e-mails     ║
 * ║ déjà envoyés y mènent et tombent sur un écran neutre ; la session du     ║
 * ║ navigateur est tenue par adresse, on se reconnecte à la nouvelle.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const LOCALES = ['en', 'es', 'de'] as const

/** Champs traduisibles, par table. Source unique : le GET et le PATCH l'utilisent. */
export const TRANSLATABLE = {
  domains: ['name', 'ecosystem_name', 'tagline'],
  domain_configs: [
    'ecosystem_expert_label',
    'ecosystem_community_label',
    'ecosystem_speciality_label',
    'ecosystem_domain_search_label',
  ],
} as const

const HEX = /^#[0-9a-fA-F]{6}$/

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return json({ error: 'Invalid id', code: 'invalid_id' }, 400)

  const { data, error } = await auth.supabaseAdmin
    .from('domains')
    .select('id, slug, name, tagline, description, active, launch_date, domain_configs(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[admin:ecosysteme] read failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!data) return json({ error: 'Not found', code: 'not_found' }, 404)

  const row = data as unknown as Record<string, unknown> & {
    domain_configs: Record<string, unknown> | Record<string, unknown>[] | null
  }
  const cfg = (Array.isArray(row.domain_configs) ? row.domain_configs[0] : row.domain_configs) ?? null

  // Traductions des DEUX tables en une lecture.
  const rowIds = [id, ...(cfg?.id ? [cfg.id as string] : [])]
  const { data: trRows } = await auth.supabaseAdmin
    .from('translations')
    .select('table_name, row_id, field, locale, value')
    .in('table_name', ['domains', 'domain_configs'])
    .in('row_id', rowIds)

  const translations: Record<string, Record<string, string>> = {}
  for (const t of (trRows ?? []) as {
    table_name: string
    field: string
    locale: string
    value: string
  }[]) {
    const key = `${t.table_name}.${t.field}`
    ;(translations[key] ??= {})[t.locale] = t.value
  }

  // Sans branche, l'écosystème n'accepte ni inscription ni annonce.
  // ⚠️ `null` = ON NE SAIT PAS, jamais 0. Le commentaire ci-dessus dit ce
  //    que zéro DÉCLENCHE : « sans branche, l’écosystème n’accepte ni
  //    inscription ni annonce ». Une panne de lecture affirmait donc cette
  //    phrase d’un écosystème parfaitement pourvu (§E.22 ⑨).
  const { count: branches, error: branchesErr } = await auth.supabaseAdmin
    .from('branches')
    .select('id', { count: 'exact', head: true })
    .eq('domain_id', id)
  if (branchesErr) {
    console.error('[admin:ecosysteme] comptage des branches illisible', branchesErr.message)
  }
  const branchesConnues = branchesErr ? null : (branches ?? 0)

  return json(
    {
      ecosystem: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        tagline: row.tagline,
        description: row.description,
        active: row.active,
        launch_date: row.launch_date,
      },
      // `logo_url` / `favicon_url` sont des CHEMINS en base. L'écran a besoin
      // d'une adresse affichable : on lui sert l'adresse publique DÉRIVÉE de
      // `domain_id`. L'ordre des clés compte — `...cfg` d'abord, les adresses
      // ensuite. Un écran ne fabrique jamais une adresse de stockage lui-même.
      config: cfg
        ? {
            ...cfg,
            logo_url: urlPubliqueEcosysteme(
              auth.supabaseAdmin,
              ecosystemeLogoStoragePath(id),
              (cfg as { logo_url?: string | null }).logo_url,
            ),
            favicon_url: urlPubliqueEcosysteme(
              auth.supabaseAdmin,
              ecosystemeFaviconStoragePath(id),
              (cfg as { favicon_url?: string | null }).favicon_url,
            ),
          }
        : cfg,
      translations,
      translatable: TRANSLATABLE,
      branches_count: branches ?? 0,
      // `null` = on ne sait pas si l'ecosysteme est pret. L'ecran doit le
      // distinguer de « pas pret » : le premier se recharge, le second se
      // corrige en creant une branche.
      ready: branchesConnues === null ? null : branchesConnues > 0,
    },
    200,
  )
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  // La pièce du geste naît à son entrée, avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return json({ error: 'Invalid id', code: 'invalid_id' }, 400)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return json({ error: 'Invalid body', code: 'invalid_body' }, 400)
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  // ── LE SOUS-DOMAINE : un geste à part (cf. l'en-tête) ─────────────────────
  if (has('slug')) return changerSousDomaine(auth, journal, id, body, request)

  // `slug` n'est PAS dans cette liste : il a son propre chemin, ci-dessus.
  const domainUpdates: Record<string, unknown> = {}
  for (const k of ['name', 'tagline', 'description'] as const) {
    if (has(k)) {
      const v = body[k]
      if (typeof v !== 'string') continue
      domainUpdates[k] = k === 'name' ? v.trim() : v.trim() || null
    }
  }
  if (has('active') && typeof body.active === 'boolean') domainUpdates.active = body.active
  if (has('launch_date')) {
    const v = body.launch_date
    domainUpdates.launch_date = typeof v === 'string' && v.trim() ? v.trim() : null
  }
  if (domainUpdates.name === '') {
    return json({ error: 'Name required', code: 'name_required' }, 400)
  }

  const configUpdates: Record<string, unknown> = {}

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║ LA PALETTE DE L'ÉCOSYSTÈME — huit rôles, et une garde qui REFUSE.      ║
  // ║                                                                        ║
  // ║ `secondary_color` A QUITTÉ CETTE LISTE, et ce n'est pas un oubli : la  ║
  // ║ colonne ne gouverne plus rien depuis le lot palette (architecture      ║
  // ║ §B.2 ⑪). Accepter une écriture sur une valeur inerte, c'est inviter    ║
  // ║ quelqu'un à croire qu'elle décide de quelque chose (§D.11).            ║
  // ╚════════════════════════════════════════════════════════════════════════╝
  const COLONNES_PALETTE = ROLES_PALETTE.map((r) => COLONNE_PAR_ROLE[r])
  for (const k of COLONNES_PALETTE) {
    if (!has(k)) continue
    const v = body[k]
    // `accent_color` est la seule qui accepte `null`, et son `null` a un sens
    // PLEIN : « dérive la couleur depuis la marque ». Ce n'est pas une absence.
    if (v === null && k === 'accent_color') { configUpdates[k] = null; continue }
    if (typeof v !== 'string' || !HEX.test(v)) {
      return json({ error: 'Invalid color', code: 'couleur_invalide', champ: k }, 400)
    }
    configUpdates[k] = v.toUpperCase()
  }
  // ⚠️ `logo_url` ET `favicon_url` NE SONT PLUS ÉDITABLES ICI, et ce n'est pas
  //    un oubli. C'étaient des SAISIES D'URL LIBRES — `typeof === 'string'`,
  //    `.trim()`, rien d'autre — servies telles quelles à `<img src>` dans la
  //    Navbar, le Footer, les pages légales et contact, donc à TOUT VISITEUR,
  //    y compris non connecté, et sans aucune CSP dans le dépôt.
  //
  //    Elles passent désormais par POST /api/admin/ecosystemes/[id]/visuel, qui
  //    téléverse un FICHIER et n'écrit qu'un chemin dérivé de `domain_id`.
  //    Les deux chemins NE COEXISTENT PAS. Un CHECK en base
  //    (`domain_configs_logo_url_chemin_check`) refuse de toute façon toute
  //    adresse : une réintroduction ici échouerait en 23514, pas en silence.
  for (const k of TRANSLATABLE.domain_configs) {
    if (has(k) && typeof body[k] === 'string' && (body[k] as string).trim()) {
      configUpdates[k] = (body[k] as string).trim().slice(0, 100)
    }
  }
  if (has('tags') && Array.isArray(body.tags)) {
    configUpdates.tags = (body.tags as unknown[])
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim().slice(0, 60))
  }

  // ── La ligne de configuration, lue AVANT toute écriture ────────────────────
  let configId: string | null = null
  let configActuelle: Record<string, unknown> | null = null
  if (Object.keys(configUpdates).length > 0 || has('translations')) {
    const { data: cfgRow, error: cfgErr } = await auth.supabaseAdmin
      .from('domain_configs')
      .select('*')
      .eq('domain_id', id)
      .maybeSingle()
    // ⚠️ UNE LECTURE EN PANNE N'EST PAS UNE LIGNE ABSENTE (§E.22). Les confondre
    //    rendrait ici un 409 « cet écosystème n'a pas de configuration », dit
    //    d'un écosystème qui en a une — et la garde de contraste ci-dessous
    //    s'appliquerait à une palette vide, donc à la référence, donc elle
    //    passerait. Une garde qui s'ouvre sur une panne est le pire des cas.
    if (cfgErr) {
      console.error('[admin:ecosysteme] lecture de la configuration en panne', cfgErr.message)
      return json({ error: 'Read failed', code: 'lecture_indisponible' }, 503)
    }
    configActuelle = (cfgRow as Record<string, unknown> | null) ?? null
    configId = (configActuelle?.id as string | undefined) ?? null
  }

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║ LA GARDE DE CONTRASTE — ELLE REFUSE, ELLE N'AVERTIT PAS.               ║
  // ║                                                                        ║
  // ║ Elle s'applique à la palette TELLE QU'ELLE SERA : l'existant fusionné  ║
  // ║ avec ce que l'écran envoie, dérivations comprises. Vérifier les seules ║
  // ║ valeurs reçues laisserait HORS DE LA GARDE le rôle « boutons » quand   ║
  // ║ il est dérivé — précisément celui que personne ne choisit, donc celui  ║
  // ║ que personne ne regarde.                                               ║
  // ║                                                                        ║
  // ║ Et elle est ICI, au serveur, parce que c'est ici que ça compte :       ║
  // ║ l'écran calcule le même verdict pour le dire tout de suite, mais un    ║
  // ║ aperçu n'a jamais refusé personne (§E.15).                             ║
  // ║                                                                        ║
  // ║ Le refus NOMME la paire fautive, son ratio et le minimum. Un refus qui ║
  // ║ ne nomme rien envoie chercher au hasard.                                ║
  // ╚════════════════════════════════════════════════════════════════════════╝
  const toucheLaPalette = COLONNES_PALETTE.some((k) => k in configUpdates)
  if (toucheLaPalette) {
    const verdict = verifierContraste(resolvePalette({ ...(configActuelle ?? {}), ...configUpdates }))
    if (!verdict.valide) {
      return json(
        {
          error: 'Contrast too low',
          code: 'contraste_insuffisant',
          minimum: MINIMUM_LISIBILITE,
          echecs: verdict.echecs,
        },
        400,
      )
    }
  }

  // ── Écritures ──────────────────────────────────────────────────────────────
  if (Object.keys(domainUpdates).length > 0) {
    const { error } = await auth.supabaseAdmin.from('domains').update(domainUpdates).eq('id', id)
    if (error) {
      console.error('[admin:ecosysteme] domain update failed', error.message)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }
  if (Object.keys(configUpdates).length > 0) {
    if (!configId) {
      return json({ error: 'Missing config row', code: 'config_missing' }, 409)
    }
    const { error } = await auth.supabaseAdmin
      .from('domain_configs')
      .update(configUpdates)
      .eq('id', configId)
    if (error) {
      console.error('[admin:ecosysteme] config update failed', error.message)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }

  // ── Traductions : upsert (valeur) ou SUPPRESSION (vide) ───────────────────
  // Reçues sous la forme { "domains.name": { en, es, de }, ... }.
  const now = new Date().toISOString()
  const toUpsert: {
    table_name: string
    row_id: string
    field: string
    locale: string
    value: string
    updated_at: string
  }[] = []
  const toDelete: { table_name: string; row_id: string; field: string; locale: string }[] = []

  if (has('translations') && body.translations && typeof body.translations === 'object') {
    for (const [key, byLocale] of Object.entries(body.translations as Record<string, unknown>)) {
      const [table, field] = key.split('.')
      const allowed =
        (table === 'domains' && (TRANSLATABLE.domains as readonly string[]).includes(field)) ||
        (table === 'domain_configs' &&
          (TRANSLATABLE.domain_configs as readonly string[]).includes(field))
      // Champ non déclaré traduisible → IGNORÉ. Sans ce filtre, le corps de la
      // requête choisirait lui-même quelles colonnes de quelle table peuplent
      // `translations` : une table de traduction ouverte à l'écriture libre.
      if (!allowed) continue
      const rowId = table === 'domains' ? id : configId
      if (!rowId) continue
      if (!byLocale || typeof byLocale !== 'object') continue
      for (const loc of LOCALES) {
        const v = (byLocale as Record<string, unknown>)[loc]
        if (typeof v !== 'string') continue
        if (v.trim()) {
          toUpsert.push({
            table_name: table,
            row_id: rowId,
            field,
            locale: loc,
            value: v.trim(),
            updated_at: now,
          })
        } else {
          toDelete.push({ table_name: table, row_id: rowId, field, locale: loc })
        }
      }
    }
  }

  if (toUpsert.length > 0) {
    const { error } = await auth.supabaseAdmin
      .from('translations')
      .upsert(toUpsert, { onConflict: 'table_name,row_id,field,locale' })
    if (error) console.error('[admin:ecosysteme] translations upsert failed', error.message)
  }
  for (const d of toDelete) {
    const { error } = await auth.supabaseAdmin
      .from('translations')
      .delete()
      .eq('table_name', d.table_name)
      .eq('row_id', d.row_id)
      .eq('field', d.field)
      .eq('locale', d.locale)
    if (error) console.error('[admin:ecosysteme] translation delete failed', error.message)
  }

  // Le grand livre (§D.26, phase B) : l'activation est une OPÉRATION à part, comme dans l'audit.
  const ligne = await ecosystemeModifie(auth.supabaseAdmin, journal, {
    id,
    operation: has('active') && typeof body.active === 'boolean'
      ? (body.active ? 'activation' : 'desactivation')
      : 'modification',
    champs: [...Object.keys(domainUpdates), ...Object.keys(configUpdates)],
    traductions: [...toUpsert, ...toDelete].map((t) => `${t.table_name}.${t.field}.${t.locale}`),
  })
  if (!ligne.ok) {
    console.error('[admin:ecosysteme] grand livre en échec après écriture', { id: id, message: ligne.message })
    return json({ error: 'Journal failed', code: 'journal_error', id: id }, 500)
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    // L'ACTIVATION EST UNE DÉCISION, pas une modification parmi d'autres : elle
    // ouvre ou ferme l'écosystème aux organisations. Elle mérite son propre
    // verbe dans le journal, sans quoi elle se noierait dans « mis à jour ».
    action: has('active')
      ? body.active === true
        ? 'ecosystem_activated'
        : 'ecosystem_deactivated'
      : 'ecosystem_updated',
    entity_type: 'domain',
    entity_id: id,
    detail: {
      domain_fields: Object.keys(domainUpdates),
      config_fields: Object.keys(configUpdates),
      translations_set: toUpsert.map((t) => `${t.table_name}.${t.field}.${t.locale}`),
      translations_cleared: toDelete.map((t) => `${t.table_name}.${t.field}.${t.locale}`),
    },
    request,
  })

  return json({ ok: true }, 200)
}

/**
 * CHANGER LE SOUS-DOMAINE — refus nommés, jamais devinés :
 *   sous_domaine_seul        400 — d'autres champs accompagnent le changement ;
 *   sous_domaine_invalide    400 — pas une étiquette DNS (la base le refuse aussi : 23514) ;
 *   sous_domaine_inchange    400 — c'est déjà le sous-domaine de l'écosystème ;
 *   not_found                404 ;
 *   sous_domaine_pris        409 — un autre écosystème le porte (unicité en base : 23505) ;
 *   sous_domaine_concurrent  409 — il a changé entre la lecture et l'écriture ;
 *   lecture_indisponible     503 — la lecture est en panne : ce n'est pas « introuvable » (§E.22).
 */
async function changerSousDomaine(
  auth: Awaited<ReturnType<typeof requireAdmin>>,
  journal: ContexteJournal,
  id: string,
  body: Record<string, unknown>,
  request: NextRequest,
): Promise<Response> {
  const autres = Object.keys(body).filter((k) => k !== 'slug')
  if (autres.length > 0) {
    return json({ error: 'Subdomain change must be sent alone', code: 'sous_domaine_seul', champs: autres }, 400)
  }
  const apres = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  // La MÊME règle que la base, le résolveur et le sélecteur (diag-sous-domaine le prouve).
  if (!isValidEcosystemSlug(apres)) {
    return json({ error: 'Invalid subdomain', code: 'sous_domaine_invalide' }, 400)
  }

  const { data: actuel, error: lectureErr } = await auth.supabaseAdmin
    .from('domains')
    .select('slug')
    .eq('id', id)
    .maybeSingle()
  if (lectureErr) {
    console.error('[admin:ecosysteme] lecture du sous-domaine en panne', lectureErr.message)
    return json({ error: 'Read failed', code: 'lecture_indisponible' }, 503)
  }
  if (!actuel) return json({ error: 'Not found', code: 'not_found' }, 404)
  const avant = (actuel as { slug: string }).slug
  if (avant === apres) {
    return json({ error: 'Subdomain unchanged', code: 'sous_domaine_inchange' }, 400)
  }

  // Écrit À LA CONDITION que la valeur lue soit toujours là (lire puis écrire, §F) :
  // deux administrateurs qui renomment en même temps ne s'écrasent pas en silence.
  const { data: ecrit, error: ecritureErr } = await auth.supabaseAdmin
    .from('domains')
    .update({ slug: apres })
    .eq('id', id)
    .eq('slug', avant)
    .select('id')
  if (ecritureErr) {
    if (ecritureErr.code === '23505') {
      return json({ error: 'Subdomain already used', code: 'sous_domaine_pris' }, 409)
    }
    if (ecritureErr.code === '23514') {
      return json({ error: 'Invalid subdomain', code: 'sous_domaine_invalide' }, 400)
    }
    console.error('[admin:ecosysteme] changement du sous-domaine en échec', ecritureErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  if (!ecrit || ecrit.length === 0) {
    return json({ error: 'Subdomain changed meanwhile', code: 'sous_domaine_concurrent' }, 409)
  }

  const ligne = await ecosystemeModifie(auth.supabaseAdmin, journal, {
    id,
    operation: 'sous_domaine',
    champs: ['slug'],
    sousDomaine: { avant, apres },
  })
  if (!ligne.ok) {
    console.error('[admin:ecosysteme] grand livre en échec après écriture', { id, message: ligne.message })
    return json({ error: 'Journal failed', code: 'journal_error', id }, 500)
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'ecosystem_updated',
    entity_type: 'domain',
    entity_id: id,
    detail: { domain_fields: ['slug'], slug_avant: avant, slug_apres: apres },
    request,
  })

  return json({ ok: true, slug: apres }, 200)
}
