// components/home/homeStyles.ts
//
// Feuille de style de la page d'accueil, injectée une seule fois par HomeView.
//
// Elle existe parce que le reste de la page est écrit en styles inline (usage du
// projet) et que les styles inline ne savent pas exprimer de media query. Or la
// page est conçue MOBILE D'ABORD : les règles ci-dessous décrivent le téléphone,
// et chaque `@media (min-width: …)` est un élargissement, jamais un rattrapage.

import { theme, gutter, tightTracking } from './theme'

export function homeStyles(accent: string, accentSoft: string, accentStrong: string): string {
  return `
    .skh-home{background:${theme.cream};color:${theme.ink}}
    .skh-home section{padding:44px ${gutter}}
    @media (min-width:900px){.skh-home section{padding:72px ${gutter}}}

    /* Onglets du héros ------------------------------------------------ */
    .skh-tabs{display:flex;gap:6px;padding:34px ${gutter} 0;background:${theme.cream};flex-wrap:wrap}
    @media (min-width:900px){.skh-tabs{padding-top:56px}}
    .skh-tab{appearance:none;font:inherit;cursor:pointer;border-radius:100px;padding:9px 18px;font-size:14px;font-weight:600;
      background:transparent;color:${theme.muted};border:1px solid ${theme.border};transition:background .2s,color .2s,border-color .2s}
    .skh-tab:hover{color:${theme.ink};border-color:${theme.faint}}
    .skh-tab[aria-selected="true"]{background:${accent};color:${theme.white};border-color:${accent}}
    .skh-tab:focus-visible{outline:2px solid ${accent};outline-offset:2px}

    /* Héros ------------------------------------------------------------ */
    .skh-hero{display:grid;grid-template-columns:1fr;gap:36px;align-items:center;padding-top:26px !important}
    @media (min-width:1040px){.skh-hero{grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:56px;padding-top:34px !important}}
    .skh-hero-copy{min-width:0}
    @media (min-width:1040px){.skh-hero-copy{min-height:330px;display:flex;flex-direction:column;justify-content:center}}
    .skh-h1{font-size:clamp(38px,8vw,60px);font-weight:800;line-height:1.04;letter-spacing:${tightTracking};margin:0 0 18px}
    .skh-lead{font-size:clamp(16px,2.4vw,18px);line-height:1.65;color:${theme.muted};margin:0 0 28px;max-width:34ch}
    .skh-proof{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:16px;font-size:13px;color:${theme.faint}}

    .skh-cta{appearance:none;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:10px;
      background:${accent};color:${theme.white};border:1px solid ${accent};border-radius:100px;
      padding:14px 26px;font-size:15px;font-weight:700;transition:background .2s,border-color .2s}
    .skh-cta:hover{background:${accentStrong};border-color:${accentStrong}}
    .skh-cta:focus-visible{outline:2px solid ${accent};outline-offset:3px}

    /* Bascule d'onglet : fondu court, aucune translation qui ferait sauter la page */
    .skh-swap{animation:skh-swap .28s ease both}
    @keyframes skh-swap{from{opacity:0}to{opacity:1}}

    /* Titres de section ------------------------------------------------ */
    .skh-eyebrow{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${accent};margin:0 0 12px}
    .skh-h2{font-size:clamp(28px,5vw,42px);font-weight:800;line-height:1.12;letter-spacing:${tightTracking};margin:0 0 14px;max-width:22ch}
    .skh-sub{font-size:clamp(15px,2vw,17px);line-height:1.6;color:${theme.muted};margin:0;max-width:52ch}

    /* Fonctionnalités --------------------------------------------------- */
    /* Fond + bordure portés par la CARTE, pas par la grille : avec 5 cartes
       (nombre premier) sur 2 ou 3 colonnes, une piste de grille reste toujours
       vide — si le fond venait de la grille (ancienne technique background+gap
       1px), cette piste affichait un rectangle beige. Ici une piste vide ne
       rend rien (fond de section). Robuste pour tout nombre de cartes. */
    .skh-grid{display:grid;grid-template-columns:1fr;gap:16px;margin-top:38px}
    @media (min-width:680px){.skh-grid{grid-template-columns:repeat(2,1fr)}}
    @media (min-width:1100px){.skh-grid{grid-template-columns:repeat(3,1fr)}}
    .skh-cell{background:${theme.white};border:1px solid ${theme.border};border-radius:14px;padding:26px 24px;display:flex;flex-direction:column;gap:9px}
    .skh-cell-icon{width:34px;height:34px;border-radius:9px;background:${accentSoft};display:flex;align-items:center;justify-content:center;margin-bottom:5px}
    .skh-cell-title{font-size:16px;font-weight:700;letter-spacing:-.01em;margin:0}
    .skh-cell-text{font-size:14px;line-height:1.6;color:${theme.muted};margin:0}

    /* Étapes ------------------------------------------------------------ */
    .skh-steps-grid{display:grid;grid-template-columns:1fr;gap:26px;margin-top:38px;counter-reset:none}
    @media (min-width:680px){.skh-steps-grid{grid-template-columns:repeat(2,1fr);gap:30px 32px}}
    @media (min-width:1100px){.skh-steps-grid{grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:34px}}
    .skh-step-item{border-top:2px solid ${accent};padding-top:16px}
    .skh-step-num{font-size:13px;font-weight:700;color:${accent};letter-spacing:.06em;margin:0 0 8px}
    .skh-step-title{font-size:16px;font-weight:700;letter-spacing:-.01em;margin:0 0 6px}
    .skh-step-text{font-size:14px;line-height:1.6;color:${theme.muted};margin:0}

    /* Domaines de l'écosystème ------------------------------------------ */
    .skh-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:30px}
    .skh-chip{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:100px;font-size:14px;font-weight:600}

    /* Pied de page ------------------------------------------------------ */
    .skh-footer{background:${theme.inkSurface};color:${theme.onInk};padding:52px ${gutter} 30px}
    .skh-footer-grid{display:grid;grid-template-columns:1fr;gap:32px}
    @media (min-width:760px){.skh-footer-grid{grid-template-columns:minmax(0,1.6fr) repeat(2,minmax(0,1fr));gap:40px}}
    .skh-footer h2{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${theme.onInkMuted};margin:0 0 14px}
    .skh-footer-link{display:block;font-size:14px;color:${theme.onInk};text-decoration:none;margin-bottom:10px;transition:opacity .2s}
    .skh-footer-link:hover{opacity:.65;text-decoration:underline;text-underline-offset:3px}
    .skh-footer-link:focus-visible{outline:2px solid ${theme.onInk};outline-offset:3px;border-radius:3px}
    .skh-footer-bottom{margin-top:38px;padding-top:18px;border-top:1px solid ${theme.onInkBorder};font-size:12px;color:${theme.onInkMuted}}

    /* Navigation --------------------------------------------------------- */
    .skh-nav{background:${theme.cream};border-bottom:1px solid ${theme.border};padding:0 ${gutter};display:flex;align-items:center;gap:18px;height:60px}
    .skh-nav-links{display:none;gap:4px;flex:1}
    @media (min-width:900px){.skh-nav-links{display:flex}}
    .skh-nav-link{appearance:none;background:none;border:none;font:inherit;cursor:pointer;padding:8px 12px;border-radius:8px;font-size:14px;font-weight:500;color:${theme.muted};text-decoration:none;transition:color .2s,background .2s}
    .skh-nav-link:hover{color:${theme.ink};background:${theme.borderSoft}}
    .skh-nav-link:focus-visible{outline:2px solid ${accent};outline-offset:2px}
    .skh-nav-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0}
    .skh-nav-signin{appearance:none;background:none;border:none;font:inherit;cursor:pointer;font-size:14px;font-weight:600;color:${theme.ink};padding:8px 10px;border-radius:8px}
    .skh-nav-signin:hover{background:${theme.borderSoft}}
    .skh-nav-signin:focus-visible{outline:2px solid ${accent};outline-offset:2px}
    .skh-nav-cta{appearance:none;font:inherit;cursor:pointer;background:${accent};color:${theme.white};border:1px solid ${accent};border-radius:100px;padding:9px 18px;font-size:14px;font-weight:700;white-space:nowrap;transition:background .2s}
    .skh-nav-cta:hover{background:${accentStrong}}
    .skh-nav-cta:focus-visible{outline:2px solid ${accent};outline-offset:3px}

    .skh-topbar{background:${theme.beige};border-bottom:1px solid ${theme.border};padding:7px ${gutter};display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:12px;color:${theme.muted}}

    @media (prefers-reduced-motion: reduce){
      .skh-home *,.skh-tabs *,.skh-nav *{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important}
    }
  `
}
