import type { SupabaseClient } from '@supabase/supabase-js'
import { estObjetIntrouvable } from '@/lib/avatar'

/**
 * lib/org-logo.ts — LE LOGO, ET LA SEULE FACON DE LE NOMMER.
 *
 * ┌─ LE DEFAUT QUE CE MODULE FERME ─────────────────────────────────────────┐
 * │ `organizations.logo_url` etait une SAISIE LIBRE servie telle quelle a    │
 * │ `<img src>` sur neuf surfaces, sans CSP nulle part dans le depot. Un     │
 * │ admin d'organisation posait donc un MOUCHARD dans le navigateur de       │
 * │ chaque personne voyant sa fiche — experts en casting compris, et         │
 * │ administrateurs plateforme sur /admin/organisations.                     │
 * │                                                                          │
 * │ ⚠️ LA CONFUSION A NE PAS REFAIRE : `profiles.photo_url` avait L'AIR du   │
 * │    meme probleme et n'en etait pas un. C'est un DRAPEAU INERTE — jamais  │
 * │    lu comme une adresse, le chemin etant REDERIVE depuis l'identifiant   │
 * │    du compte. Une valeur falsifiee n'y donne acces a rien.               │
 * │    Ce module donne a `logo_url` exactement cette propriete.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * CONTRAT, en trois phrases :
 *   1. Le chemin est DERIVE de l'identifiant. Il n'est jamais lu en base.
 *   2. La lecture passe par une URL SIGNEE COURTE vers NOTRE stockage.
 *   3. L'ecriture verifie ce que le fichier CONTIENT, pas ce qu'il declare.
 *
 * MODELE D'ACCES RETENU, et pourquoi il emprunte aux DEUX buckets existants :
 *   - ECRITURE facon `cv` : tout serveur, service-role. Le modele `avatars`
 *     ecrit en client-direct — les octets ne passent jamais par nous, et la
 *     verification de contenu (ci-dessous) serait alors IMPOSSIBLE. C'est ce
 *     point, et lui seul, qui a exclu le client-direct.
 *   - LECTURE facon `avatars` : URL signee 300 s. C'est elle qui ferme le
 *     mouchard — le navigateur ne recoit plus qu'une adresse de notre domaine.
 */

/** Bucket PRIVE des logos d'organisation (migration 20260916300000). */
export const BUCKET_LOGOS_ORG = 'org-logos'

/**
 * Bucket PUBLIC des visuels d'ecosysteme (logo + favicon).
 *
 * PUBLIC ET C'EST VOULU : ces images vivent sur des pages publiques et cachees
 * (Navbar, Footer, pages legales, contact), vues par des visiteurs anonymes.
 * Une URL signee y expirerait au bout de 300 s et laisserait une image cassee
 * dans toute page servie depuis un cache. Le mouchard n'est pas ferme ici par
 * la confidentialite mais par la DERIVATION : l'adresse vient de `domain_id`,
 * elle n'est plus saisie par personne.
 */
export const BUCKET_ECOSYSTEME = 'ecosysteme'

/** Aligne sur le bucket `avatars`, deja le bucket d'images de ce produit. */
export const LOGO_TAILLE_MAX_OCTETS = 2 * 1024 * 1024

/** Types acceptes. SVG volontairement ABSENT — voir `typeImageReel`. */
export const LOGO_TYPES_ACCEPTES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type TypeImage = (typeof LOGO_TYPES_ACCEPTES)[number]

// ─── Les chemins, source unique ──────────────────────────────────────────────
//
// Meme role que `avatarStoragePath` : personne d'autre ne fabrique un chemin.
// Sans extension, DELIBEREMENT — le type reel vit dans les metadonnees Storage,
// et c'est lui qui est servi. Un chemin sans extension garantit UN SEUL fichier
// par organisation : changer de format n'abandonne pas un orphelin derriere soi.

/** Chemin du logo d'une organisation. Source unique. */
export function orgLogoStoragePath(organizationId: string): string {
  return `${organizationId}/logo`
}

/** Chemin du logo d'un ecosysteme. Source unique. */
export function ecosystemeLogoStoragePath(domainId: string): string {
  return `${domainId}/logo`
}

/** Chemin du favicon d'un ecosysteme. Source unique. */
export function ecosystemeFaviconStoragePath(domainId: string): string {
  return `${domainId}/favicon`
}

// ─── Ce que le fichier CONTIENT ──────────────────────────────────────────────

/**
 * Le type REEL d'une image, lu dans ses premiers octets.
 *
 * POURQUOI CETTE FONCTION EXISTE : une extension et un `Content-Type` sont des
 * DECLARATIONS DU CLIENT, donc falsifiables. `allowed_mime_types` cote Storage
 * ne verifie que la declaration : c'est une seconde ligne, jamais la premiere.
 * Ce qui protege, c'est ce que le fichier contient.
 *
 * ⚠️ SVG EST REFUSE, ET CE N'EST PAS UN OUBLI. Un SVG est un document XML qui
 *    peut porter `<script>` et `<foreignObject>` : une image active, pas une
 *    image. Il n'a aucune signature binaire, donc il tombe deja dans le `null`
 *    ci-dessous — on le nomme pour que personne ne le rouvre en croyant rendre
 *    service.
 *
 * ⚠️ CE QUE CETTE FONCTION NE FAIT PAS, et il faut le savoir : elle ne NETTOIE
 *    pas. Un polyglotte — un JPEG valide qui est aussi autre chose — passe la
 *    signature. La parade complete serait de REENCODER (decoder puis re-ecrire),
 *    ce qui exige une bibliotheque image absente du projet. Le risque residuel
 *    est tenu par trois faits : le bucket est prive, servi depuis le domaine de
 *    Supabase — donc une ORIGINE DIFFERENTE de l'application — et sous le
 *    `Content-Type` que NOUS fixons depuis cette fonction. Un contenu
 *    malveillant n'a ni origine ni type pour s'executer.
 */
export function typeImageReel(octets: Uint8Array): TypeImage | null {
  // JPEG : FF D8 FF
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) {
    return 'image/jpeg'
  }

  // PNG : 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (octets.length >= 8 && PNG.every((b, i) => octets[i] === b)) {
    return 'image/png'
  }

  // WebP : 'RIFF' aux octets 0-3 ET 'WEBP' aux octets 8-11. Les deux sont
  // exiges : 'RIFF' seul designe aussi un WAV ou un AVI.
  const RIFF = [0x52, 0x49, 0x46, 0x46]
  const WEBP = [0x57, 0x45, 0x42, 0x50]
  if (
    octets.length >= 12 &&
    RIFF.every((b, i) => octets[i] === b) &&
    WEBP.every((b, i) => octets[8 + i] === b)
  ) {
    return 'image/webp'
  }

  return null
}

/** Les raisons de refus, une par cause. Jamais « une erreur est survenue ». */
export type RefusLogo =
  | 'logo_absent'
  | 'logo_trop_volumineux'
  | 'logo_format_refuse'
  | 'logo_contenu_non_conforme'
  | 'logo_type_incoherent'

export type VerdictLogo =
  | { ok: true; octets: Uint8Array; type: TypeImage }
  | { ok: false; code: RefusLogo }

/**
 * Le seul point de decision sur un fichier de logo. Les routes n'en refont
 * aucun bout : une seconde implementation du meme controle finirait par
 * diverger de la premiere.
 *
 * L'ordre des refus n'est pas indifferent — il va du moins cher au plus cher,
 * et surtout du plus explicable au plus subtil : « votre fichier est trop
 * lourd » avant « votre fichier n'est pas ce qu'il pretend etre ».
 */
export function verifierFichierLogo(
  octets: Uint8Array,
  typeDeclare: string | null | undefined,
): VerdictLogo {
  if (octets.length === 0) return { ok: false, code: 'logo_absent' }

  // Mesure sur les OCTETS RECUS, jamais sur `Content-Length` : l'en-tete est
  // une declaration de plus.
  if (octets.length > LOGO_TAILLE_MAX_OCTETS) {
    return { ok: false, code: 'logo_trop_volumineux' }
  }

  const declare = (typeDeclare ?? '').split(';')[0].trim().toLowerCase()
  if (!(LOGO_TYPES_ACCEPTES as readonly string[]).includes(declare)) {
    return { ok: false, code: 'logo_format_refuse' }
  }

  const reel = typeImageReel(octets)
  if (reel === null) return { ok: false, code: 'logo_contenu_non_conforme' }

  // Le fichier est une image, mais pas celle qu'il annonce. On refuse plutot
  // que de corriger en silence : un ecart entre la declaration et le contenu
  // est un signal, pas une coquille a rattraper.
  if (reel !== declare) return { ok: false, code: 'logo_type_incoherent' }

  // C'est le type REEL qui sort d'ici, et c'est lui qui sera ecrit dans
  // Storage. Le client ne choisit plus sous quel type sa ressource est servie.
  return { ok: true, octets, type: reel }
}

// ─── La lecture ──────────────────────────────────────────────────────────────

/**
 * Signe l'URL du logo d'une organisation (TTL 300 s), en service-role.
 *
 * FAIL-SAFE, calque sur `signAvatarUrl` : rend `null` sur absence comme sur
 * erreur, sans jamais lever. Un logo non signable ⇒ `null` ⇒ l'ecran affiche
 * l'etat vide (les initiales), jamais une image cassee.
 *
 * La panne ne passe pas sous silence pour autant : `estObjetIntrouvable`
 * (reutilise de lib/avatar.ts) distingue « cette organisation n'a pas de
 * logo » — le cas normal, et de loin le plus frequent — d'un stockage tombe.
 * Sans cette distinction, une panne de stockage serait invisible pour
 * toujours : tous les logos deviendraient des initiales, ce qui a l'air normal.
 */
export async function signOrgLogoUrl(
  admin: SupabaseClient,
  organizationId: string | null | undefined,
  logoPresent: unknown,
): Promise<string | null> {
  if (!organizationId) return null
  // `logoPresent` est le DRAPEAU lu en base. On ne le suit pas, on ne le
  // concatene pas : on s'en sert uniquement pour eviter un aller-retour au
  // stockage quand on sait deja qu'il n'y a rien. Le chemin, lui, est
  // TOUJOURS recalcule ci-dessous.
  if (logoPresent == null || String(logoPresent).trim() === '') return null

  try {
    const { data, error } = await admin.storage
      .from(BUCKET_LOGOS_ORG)
      .createSignedUrl(orgLogoStoragePath(organizationId), 300)

    if (error) {
      if (!estObjetIntrouvable(error)) {
        console.error('[org-logo] signature impossible — stockage en défaut', {
          organizationId,
          message: error.message,
        })
      }
      return null
    }
    if (!data?.signedUrl) {
      console.error('[org-logo] réponse sans URL signée', { organizationId })
      return null
    }
    return data.signedUrl
  } catch (err) {
    console.error('[org-logo] exception pendant la signature', {
      organizationId,
      cause: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Signe les logos de PLUSIEURS organisations en un seul aller-retour.
 *
 * POURQUOI UN LOT : les cartes de casting et la messagerie affichent des
 * LISTES. Signer une URL par ligne ferait N appels au stockage pour un seul
 * ecran — la latence grandirait avec le nombre de resultats, c'est-a-dire
 * exactement quand l'utilisateur en a le plus.
 *
 * Rend une Map `organizationId → URL signee`. Une organisation absente de la
 * Map n'a pas de logo signable : l'appelant projette alors `null`, et l'ecran
 * montre l'etat vide. Meme posture fail-safe que l'unitaire.
 */
export async function signOrgLogoUrls(
  admin: SupabaseClient,
  organizationIds: readonly string[],
): Promise<Map<string, string>> {
  const resultat = new Map<string, string>()
  const ids = [...new Set(organizationIds.filter(Boolean))]
  if (ids.length === 0) return resultat

  try {
    const { data, error } = await admin.storage
      .from(BUCKET_LOGOS_ORG)
      .createSignedUrls(ids.map(orgLogoStoragePath), 300)

    if (error) {
      console.error('[org-logo] signature en lot impossible', {
        nb: ids.length,
        message: error.message,
      })
      return resultat
    }

    for (const entree of data ?? []) {
      // `createSignedUrls` rend une ligne PAR CHEMIN DEMANDE, avec `error`
      // renseigne pour les objets absents — le cas normal, la plupart des
      // organisations n'ayant pas de logo. On ne journalise donc pas ici :
      // ce serait du bruit a chaque ecran.
      if (!entree?.signedUrl || entree.error) continue
      const orgId = String(entree.path ?? '').split('/')[0]
      if (orgId) resultat.set(orgId, entree.signedUrl)
    }
  } catch (err) {
    console.error('[org-logo] exception pendant la signature en lot', {
      cause: err instanceof Error ? err.message : String(err),
    })
  }
  return resultat
}

/**
 * URL publique d'un visuel d'ecosysteme (logo ou favicon).
 *
 * Pas de signature ici — voir `BUCKET_ECOSYSTEME` : ces pages sont publiques et
 * cachees. La garantie tient a ce que le chemin est DERIVE de `domain_id`, donc
 * qu'il designe toujours notre propre fichier.
 *
 * Le drapeau en base sert a distinguer « pas de visuel » d'un visuel present :
 * `getPublicUrl` ne dit jamais si l'objet existe, il fabrique une adresse.
 */
export function urlPubliqueEcosysteme(
  admin: SupabaseClient,
  chemin: string,
  presentEnBase: unknown,
): string | null {
  if (presentEnBase == null || String(presentEnBase).trim() === '') return null
  const { data } = admin.storage.from(BUCKET_ECOSYSTEME).getPublicUrl(chemin)
  return data?.publicUrl ?? null
}
