// scripts/_sql-lecture.mjs — LIRE LE CODE SQL, PAS LA PROSE QUI LE DECRIT.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QUE CE FICHIER CORRIGE, ET IL EST PASSE VERT
//
//   Les diagnostics de migrations retiraient les lignes commencant par `--`,
//   et s'arretaient la. Or dans ce depot, l'essentiel de la documentation d'une
//   migration ne vit PAS dans des `--` : elle vit dans des instructions
//
//       comment on function public.f(…) is $$ … $$;
//       comment on column  public.t.c    is ' … ';
//
//   Ce sont des CHAINES SQL, pas des commentaires lexicaux. Un scan qui ne
//   retire que les `--` les garde entierement — et se met a lire la prose.
//
//   MESURE, pas theorie : en mutant `for update skip locked` en `for update`
//   dans la selection des relances, le controle est reste VERT. Il trouvait la
//   chaine `for update skip locked` dans le TEXTE du `comment on` juste en
//   dessous, qui explique pourquoi la garde est la. Le code avait perdu sa
//   garde, la documentation disait encore qu'il l'avait, et le diagnostic
//   croyait la documentation.
//
//   C'est exactement la regle du projet — « le diagnostic doit lire LE CODE,
//   pas les commentaires qui le decrivent » — prise en defaut par sa propre
//   mise en oeuvre.
//
// ⚠️ NE PAS UTILISER DANS diag-sql-litteraux.mjs. Celui-la analyse justement la
//    FORME des chaines, `comment on` compris : c'est son sujet. Lui retirer ces
//    blocs l'aveuglerait sur la classe d'erreurs qu'il existe pour attraper.
//
// ⚠️ CE FICHIER N'EST PAS UN DIAGNOSTIC. Il ne porte aucun controle — d'ou le
//    nom sans prefixe `diag-`, qui le tient hors de tout balayage `diag-*.mjs`.

/**
 * Retire d'une source SQL tout ce qui n'est pas du code :
 *   1. les commentaires lexicaux `--` en debut de ligne ;
 *   2. les instructions `comment on … is <chaine>;`, quelle que soit la forme
 *      de la chaine — `$$…$$`, `$tag$…$tag$`, ou `'…'` avec quotes doublees.
 *
 * L'ordre compte : on retire les `comment on` AVANT les `--`, parce qu'un bloc
 * `$$…$$` peut contenir des lignes commencant par `--` qui ne sont pas des
 * commentaires. Les supprimer d'abord laisserait un `$$` orphelin.
 *
 * @param {string} src source SQL brute
 * @returns {string} le code seul
 */
export function sqlCodeSeul(src) {
  let s = src

  // ⚠️ LA CIBLE NE TRAVERSE JAMAIS UN `;` — `[^;]*?`, surtout pas `[\s\S]*?`.
  //    Premiere version ecrite avec `[\s\S]*?` : partant d'un `comment on table`
  //    a quotes simples, elle cherchait le prochain `$tag$` et le trouvait dans
  //    le corps d'une FONCTION cinquante lignes plus bas — avalant la fonction
  //    entiere. La migration passait de 5 208 a 372 octets, et TOUS les
  //    controles suivants devenaient verts faute de code a lire.
  //    Un extracteur qui mange le code ne fait pas echouer un diagnostic : il le
  //    rend aveugle. C'est pire.

  // `comment on <cible> is $tag$ … $tag$;` — le tag est capture et exige a la
  // fermeture, sinon un `$$` dans le texte couperait au mauvais endroit.
  s = s.replace(/comment\s+on\s+[^;]*?\bis\s+(\$[A-Za-z_]*\$)[\s\S]*?\1\s*;/gi, ' ')

  // `comment on <cible> is ' … ';` — quotes doublees admises a l'interieur,
  // et PLUSIEURS constantes concatenees par saut de ligne, forme tres repandue
  // dans ce depot :
  //     comment on column … is
  //       'premiere partie '
  //       'seconde partie';
  // Ne reconnaitre qu'UNE constante laissait la suite du texte dans le code —
  // et c'est justement cette prose qu'on veut retirer.
  //
  // Le prefixe `E` est admis : `comment on table … is E'…\n' '…';`. Une
  // constante d'echappement echappe par barre oblique inverse, d'ou `\\.` a
  // cote de `''`.
  const constante = "[Ee]?'(?:[^'\\\\]|''|\\\\[\\s\\S])*'"
  s = s.replace(
    new RegExp(`comment\\s+on\\s+[^;]*?\\bis\\s+${constante}(?:\\s*${constante})*\\s*;`, 'gi'),
    ' ',
  )

  // Enfin les commentaires lexicaux.
  s = s
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')

  // ── LE FILET : verifier qu'on n'a pas mange de code ─────────────────────
  //
  //  Les instructions structurantes ne vivent jamais dans un `comment on`.
  //  Leur nombre doit donc etre RIGOUREUSEMENT le meme avant et apres. S'il
  //  baisse, le decoupage a derape et tout controle en aval mentirait — on
  //  s'arrete brutalement plutot que de rendre un texte tronque.
  //
  //  On compte sur la source privee de ses seules lignes `--`, pour ne pas
  //  compter un mot-cle cite dans un commentaire lexical.
  const brut = src.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  for (const motif of [
    /\bcreate\s+(?:or\s+replace\s+)?function\b/gi,
    /\bcreate\s+(?:constraint\s+)?trigger\b/gi,
    /\bcreate\s+table\b/gi,
    /\bcreate\s+(?:unique\s+)?index\b/gi,
    /\balter\s+table\b/gi,
    /\bgrant\s+execute\b/gi,
  ]) {
    const avant = (brut.match(motif) ?? []).length
    const apres = (s.match(motif) ?? []).length
    if (apres !== avant) {
      throw new Error(
        `sqlCodeSeul : le decoupage a mange du code (${motif.source} : ${avant} → ${apres}). ` +
          'Aucun controle ne doit tourner sur un texte tronque — il passerait vert faute de code a lire.',
      )
    }
  }

  return s
}
