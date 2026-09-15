// scripts/garde-ecriture.mjs — UN SCRIPT QUI ECRIT NE PART PAS TOUT SEUL.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON CORRIGE N'EST PAS DANS LES SCRIPTS, IL EST DANS LEUR NOM
//
//   Sur trente-trois `scripts/diag-*.mjs`, vingt-huit ne font que LIRE et
//   quatre commencent par un `delete`. Rien ne les distingue : meme prefixe,
//   meme forme, meme facon de se lancer. `node scripts/diag-lot3-messagerie`
//   ressemble a `node scripts/diag-admin-users` — et supprime tous les
//   messages d'une conversation.
//
//   Un worktree s'est fait prendre. Ce n'etait pas de l'etourderie : c'etait
//   une famille de commandes ou l'inoffensif et le destructeur ont le meme
//   visage.
//
// LA REGLE
//   1. Sans `--db` (ou `--live`), le script REFUSE et sort en code 2.
//   2. Il DIT ce qu'il ecrirait, table par table, avant de rien faire.
//   3. Avec le drapeau, il l'annonce quand meme, en clair, avant la premiere
//      ecriture. On ne decouvre pas apres coup ce qu'on vient de detruire.
//
// POURQUOI LE CODE 2, ET PAS 1
//   `1` veut dire « des controles ont echoue » — un ROUGE, qui appelle une
//   correction. Ici rien n'a echoue : le script N'A PAS TOURNE. Confondre les
//   deux ferait lire un refus prudent comme une regression, et pousserait
//   quelqu'un a « reparer » en passant le drapeau. Trois etats, trois codes :
//     0 = vert · 1 = rouge · 2 = n'a pas tourne
//
// ⚠️ CE FICHIER N'EST PAS UN DIAGNOSTIC. Il ne porte aucun controle et ne doit
//    pas etre lance seul — d'ou le nom sans prefixe `diag-`, qui le tient hors
//    de tout balayage `diag-*.mjs`.

/** Drapeaux acceptes. `--db` est celui que diag-suspension utilisait deja. */
const DRAPEAUX = ['--db', '--live']

/**
 * @param {object} o
 * @param {string} o.script     nom du script, pour le message
 * @param {string[]} o.ecrit    ce qui est ecrit, une ligne par effet
 * @param {string} [o.perte]    ce qui est DETRUIT sans retour, s'il y en a
 * @param {string} [o.drapeaux] les drapeaux REELS a repasser, si le script en
 *   exige d'autres que `--db`.
 *
 *   POURQUOI CE PARAMETRE. Le refus affiche la commande a retaper. Elle etait
 *   figee a `--db` — ce qui est juste pour un script dont c'est le seul
 *   drapeau, et FAUX pour un script qui en exige un second pour detruire
 *   (`--db --supprimer`). Le message aurait alors appris a l'operateur que
 *   `--db` suffit a supprimer : exactement la confusion que ce fichier existe
 *   pour empecher. Un garde-fou qui donne la mauvaise consigne est pire que
 *   pas de consigne.
 */
export function exigerAutorisationEcriture({ script, ecrit, perte, drapeaux }) {
  const autorise = DRAPEAUX.some((d) => process.argv.includes(d))

  const bandeau = (titre) => {
    console.log('')
    console.log(`  ${'─'.repeat(72)}`)
    console.log(`  ${titre}`)
    console.log(`  ${'─'.repeat(72)}`)
    for (const l of ecrit) console.log(`    · ${l}`)
    if (perte) {
      console.log('')
      console.log(`    IRREVERSIBLE : ${perte}`)
    }
    console.log('')
  }

  if (!autorise) {
    bandeau(`${script} ECRIT EN BASE — refus, aucun drapeau d'ecriture.`)
    console.log(`    Rien n'a ete lu ni ecrit. Pour l'executer volontairement :`)
    console.log(`      node --env-file=.env.local scripts/${script} ${drapeaux ?? '--db'}`)
    console.log('')
    // 2 = « n'a pas tourne ». Surtout pas 1, qui se lirait comme un echec de
    // controle et donnerait envie de « reparer » en passant le drapeau.
    process.exit(2)
  }

  bandeau(`${script} — ECRITURE AUTORISEE (${DRAPEAUX.find((d) => process.argv.includes(d))})`)
}
