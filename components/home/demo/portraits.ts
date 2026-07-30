// components/home/demo/portraits.ts
//
// Portraits des personnes fictives des démonstrations.
//
// POURQUOI DU SVG PLUTÔT QUE DES PHOTOS :
// les anciens avatars pointaient vers randomuser.me, un service tiers à qui chaque
// visiteur transmettait son adresse IP. Des photos déposées dans public/ auraient
// réglé ce point mais pas le suivant : une photo de banque d'images montre une
// PERSONNE RÉELLE, ce que la contrainte « aucun visage identifiable » exclut. Un
// portrait dessiné n'a pas ce problème, ne pèse rien (~1 ko inline, aucune requête)
// et se recolorise avec le reste de la page.
//
// Chaque portrait est déterministe : un index donne toujours le même visage, donc
// une même personne fictive garde son visage d'une démonstration à l'autre.

import { portraitInk, portraitPresets } from '../theme'

// Les identifiants de clipPath doivent être uniques dans le document : plusieurs
// portraits coexistent, et deux démos peuvent se croiser lors d'une bascule d'onglet.
let sequence = 0

export function portrait(index: number, size = 34): string {
  const preset = portraitPresets[index % portraitPresets.length]
  sequence += 1
  const clipId = `skh-portrait-${sequence}`

  const backHair =
    preset.hairStyle === 'long'
      ? `<path d="M16 30c0-11 7-18 16-18s16 7 16 18v20h-6.5V31H22.5v19H16z" fill="${preset.hair}"/>`
      : preset.hairStyle === 'bun'
        ? `<circle cx="32" cy="9" r="5.2" fill="${preset.hair}"/>`
        : ''

  const beard = preset.beard
    ? `<path d="M19.5 30c0 10.5 5.6 15.5 12.5 15.5S44.5 40.5 44.5 30c-1.6 6.2-5.9 8.8-12.5 8.8S21.1 36.2 19.5 30z" fill="${preset.hair}" opacity=".9"/>`
    : ''

  const glasses = preset.glasses
    ? `<g fill="none" stroke="${portraitInk.frame}" stroke-width="1.3">
         <circle cx="26.5" cy="28.5" r="4.8"/><circle cx="37.5" cy="28.5" r="4.8"/>
         <path d="M31.3 28.5h1.4"/><path d="M21.7 27.8l-2.6-.9"/><path d="M42.3 27.8l2.6-.9"/>
       </g>`
    : ''

  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" style="display:block;flex-shrink:0;border-radius:50%">
    <defs><clipPath id="${clipId}"><circle cx="32" cy="32" r="32"/></clipPath></defs>
    <g clip-path="url(#${clipId})">
      <rect width="64" height="64" fill="${preset.bg}"/>
      <path d="M4 64c0-13 12.5-20 28-20s28 7 28 20z" fill="${preset.cloth}"/>
      <path d="M27 34h10v11a5 5 0 0 1-10 0z" fill="${preset.shade}"/>
      ${backHair}
      <ellipse cx="32" cy="24" rx="16" ry="16" fill="${preset.hair}"/>
      <ellipse cx="32" cy="29" rx="13" ry="14" fill="${preset.skin}"/>
      <circle cx="19.6" cy="30" r="2.4" fill="${preset.skin}"/>
      <circle cx="44.4" cy="30" r="2.4" fill="${preset.skin}"/>
      <path d="M19.5 25c1.6-6.2 6.6-9.4 12.5-9.4S43 18.8 44.5 25c-3-3.6-7.5-5.2-12.5-5.2S22.5 21.4 19.5 25z" fill="${preset.hair}"/>
      ${beard}
      <path d="M23.6 24.2q2.9-1.8 5.8 0" fill="none" stroke="${preset.hair}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M34.6 24.2q2.9-1.8 5.8 0" fill="none" stroke="${preset.hair}" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="26.5" cy="28.5" r="1.7" fill="${portraitInk.eye}"/>
      <circle cx="37.5" cy="28.5" r="1.7" fill="${portraitInk.eye}"/>
      ${glasses}
      <path d="M28.6 35q3.4 2.6 6.8 0" fill="none" stroke="${portraitInk.mouth}" stroke-width="1.5" stroke-linecap="round"/>
    </g>
  </svg>`
}
