// components/home/demo/engine.ts
//
// Moteur des démonstrations animées de la page d'accueil.
//
// Les deux démos (parcours expert, parcours entreprise) ne sont PAS deux
// composants dupliqués : ce sont deux scénarios écrits sur les mêmes primitives
// — moveTo, clickEl, typeIn, fadeTransition, activateStep, setBar. Ajouter un
// troisième parcours ne demandera qu'un scénario de plus.
//
// Contraintes tenues ici :
//   - aucune bibliothèque d'animation, aucune ressource externe : DOM impératif
//     et keyframes CSS injectées, comme la démo d'origine ;
//   - tout est porté par la couleur d'accent du domaine courant, rien en dur ;
//   - `prefers-reduced-motion` coupe la boucle et les déplacements : le scénario
//     se joue une seule fois, instantanément, et s'arrête sur son état final ;
//   - démontage propre : chaque timer et chaque intervalle est suivi puis
//     annulé, et tout est scopé à la racine (deux démos peuvent coexister le
//     temps d'une bascule d'onglet sans se marcher dessus).

import { theme } from '../theme'

export type DemoContext = {
  /** Panneau de gauche : la scène où chaque phase se dessine. */
  panel: HTMLElement
  accent: string
  accentSoft: string
  /** Vrai dès que le composant est démonté : à tester avant tout effet long. */
  cancelled: () => boolean
  reduced: boolean
  sleep: (ms: number) => Promise<void>
  moveTo: (target: HTMLElement | null, duration?: number) => Promise<void>
  clickEl: (target: HTMLElement | null, duration?: number) => Promise<void>
  typeIn: (target: HTMLElement, text: string, speed?: number) => Promise<void>
  fadeTransition: () => Promise<void>
  activateStep: (index: number) => void
  setBar: (percent: number, duration: number) => void
  /** Crée un élément détaché depuis du HTML (les valeurs i18n passent par `esc`). */
  make: (html: string, css?: string) => HTMLElement
  /** Pastille d'initiales — remplace les avatars distants, aucune requête tierce. */
  avatar: (initials: string, size?: number) => string
}

export type DemoScenario = (ctx: DemoContext) => Promise<void>

export type DemoOptions = {
  steps: string[]
  progressLabel: string
  accent: string
  accentSoft: string
  reduced: boolean
  scenario: DemoScenario
}

/** Échappe une valeur i18n avant insertion dans un template HTML. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildStyles(accent: string, accentSoft: string): string {
  return `
    .skh-demo{position:relative;height:560px;border-radius:18px;overflow:hidden;border:1px solid ${theme.border};background:${theme.cream};font-family:inherit}
    @media (min-width:760px){.skh-demo{height:520px}}

    .skh-demo *{box-sizing:border-box}
    .skh-layout{display:flex;flex-direction:column-reverse;gap:10px;padding:12px;height:calc(100% - 20px)}
    @media (min-width:760px){.skh-layout{flex-direction:row;gap:12px;padding:14px}}

    .skh-panelwrap{flex:1;min-width:0;min-height:0}
    .skh-panel{background:${theme.white};border:1px solid ${theme.borderSoft};border-radius:14px;padding:13px;height:100%;overflow:hidden;transition:opacity .3s ease}

    .skh-progress{background:${theme.white};border:1px solid ${theme.borderSoft};border-radius:14px;padding:10px 12px;flex-shrink:0}
    @media (min-width:760px){.skh-progress{width:186px;align-self:flex-start;padding:12px}}

    .skh-progress-title{font-size:11px;font-weight:600;color:${theme.faint};letter-spacing:.06em;text-transform:uppercase;margin-bottom:9px;display:none}
    @media (min-width:760px){.skh-progress-title{display:block}}

    .skh-steps{display:flex;flex-direction:row;gap:6px;overflow-x:auto;scrollbar-width:none}
    .skh-steps::-webkit-scrollbar{display:none}
    @media (min-width:760px){.skh-steps{flex-direction:column;gap:2px;overflow:visible}}

    .skh-step{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;transition:background .35s ease,color .35s ease;flex-shrink:0}
    .skh-snum{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;background:${theme.cream};color:${theme.faint};transition:background .35s ease,color .35s ease}
    .skh-slbl{font-size:12px;font-weight:500;line-height:1.3;color:${theme.faint};white-space:nowrap;transition:color .35s ease}
    @media (min-width:760px){.skh-slbl{white-space:normal}}
    .skh-step.is-active{background:${accentSoft}}
    .skh-step.is-active .skh-snum{background:${accent};color:${theme.white}}
    .skh-step.is-active .skh-slbl{color:${accent};font-weight:700}
    .skh-step.is-done .skh-snum{background:${theme.successSoft};color:${theme.success}}
    .skh-step.is-done .skh-slbl{color:${theme.muted};font-weight:500}

    .skh-barwrap{padding:0 12px 12px}
    .skh-bar{height:3px;background:${theme.border};border-radius:10px;overflow:hidden}
    .skh-bar>i{display:block;height:100%;width:0;background:${accent};border-radius:10px}

    .skh-cursor{position:absolute;width:18px;height:18px;pointer-events:none;z-index:20;left:50%;top:50%;transition:left .38s cubic-bezier(.25,.1,.25,1),top .38s cubic-bezier(.25,.1,.25,1)}

    .skh-card{background:${theme.white};border:1px solid ${theme.border};border-radius:11px}
    .skh-field{background:${theme.cream};border:1.5px solid ${theme.border};border-radius:9px;padding:8px 11px;font-size:13px;color:${theme.ink};min-height:34px;white-space:pre-wrap;word-break:break-word;transition:border-color .2s,background .2s}
    .skh-field.is-focus{border-color:${accent};background:${theme.white}}
    .skh-area{height:64px;overflow:hidden;line-height:1.5}
    .skh-tag{display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;background:${theme.cream};color:${theme.muted};border:1px solid ${theme.border}}
    .skh-avatar{border-radius:50%;background:${accentSoft};color:${accent};display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0}
    .skh-row{display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid ${theme.border};border-radius:10px;background:${theme.white};transition:border-color .25s,background .25s}
    .skh-row.is-sel{border-color:${theme.success};background:${theme.successSoft}}

    .skh-in-up{animation:skh-inUp .32s ease both}
    .skh-in{animation:skh-in .3s ease both}
    .skh-slide{animation:skh-slide .3s ease both}
    .skh-pop{animation:skh-pop .3s ease both}
    @keyframes skh-inUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes skh-in{from{opacity:0}to{opacity:1}}
    @keyframes skh-slide{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
    @keyframes skh-pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
    @keyframes skh-blink{50%{opacity:0}}
    @keyframes skh-ripple{from{transform:scale(0);opacity:.45}to{transform:scale(3);opacity:0}}
    @keyframes skh-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
    @keyframes skh-dot{0%,80%,100%{transform:scale(.6);opacity:.3}40%{transform:scale(1);opacity:1}}
    @keyframes skh-live{0%,100%{opacity:1}50%{opacity:.35}}
    .skh-spin{animation:skh-spin 1.2s linear infinite}
    .skh-dot{width:5px;height:5px;border-radius:50%;background:${theme.faint};animation:skh-dot 1.2s infinite}
    .skh-live{width:7px;height:7px;border-radius:50%;background:${theme.success};animation:skh-live 2s infinite;flex-shrink:0}

    /* Mouvement réduit : plus de boucle, plus de curseur, plus d'apparitions. */
    .skh-demo.is-static .skh-cursor{display:none}
    .skh-demo.is-static *{animation:none !important;transition:none !important}
  `
}

export function mountDemo(root: HTMLElement, options: DemoOptions): () => void {
  const { steps, progressLabel, accent, accentSoft, reduced, scenario } = options

  let cancelled = false
  const timeouts = new Set<ReturnType<typeof setTimeout>>()
  const intervals = new Set<ReturnType<typeof setInterval>>()

  root.innerHTML = ''
  root.className = reduced ? 'skh-demo is-static' : 'skh-demo'

  const style = document.createElement('style')
  style.textContent = buildStyles(accent, accentSoft)
  root.appendChild(style)

  const cursor = document.createElement('div')
  cursor.className = 'skh-cursor'
  cursor.innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 2L3 15.5L6.8 11.5L9.5 17L11.2 16.1L8.5 10.5L13.5 10.5Z" fill="${theme.ink}" stroke="${theme.white}" stroke-width="1.2" stroke-linejoin="round"/></svg>`
  root.appendChild(cursor)

  const layout = document.createElement('div')
  layout.className = 'skh-layout'

  const panelWrap = document.createElement('div')
  panelWrap.className = 'skh-panelwrap'
  const panel = document.createElement('div')
  panel.className = 'skh-panel'
  panelWrap.appendChild(panel)
  layout.appendChild(panelWrap)

  const progress = document.createElement('div')
  progress.className = 'skh-progress'
  progress.innerHTML =
    `<div class="skh-progress-title">${esc(progressLabel)}</div>` +
    `<div class="skh-steps">${steps
      .map(
        (label, i) =>
          `<div class="skh-step"><div class="skh-snum">${i + 1}</div><div class="skh-slbl">${esc(label)}</div></div>`,
      )
      .join('')}</div>`
  layout.appendChild(progress)
  root.appendChild(layout)

  const barWrap = document.createElement('div')
  barWrap.className = 'skh-barwrap'
  barWrap.innerHTML = '<div class="skh-bar"><i></i></div>'
  root.appendChild(barWrap)

  const stepsStrip = progress.querySelector<HTMLElement>('.skh-steps')!
  const stepNodes = Array.from(progress.querySelectorAll<HTMLElement>('.skh-step'))
  const stepNumbers = Array.from(progress.querySelectorAll<HTMLElement>('.skh-snum'))
  const barFill = barWrap.querySelector<HTMLElement>('i')!

  const checkMark = (color: string) =>
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`

  function sleep(ms: number): Promise<void> {
    if (cancelled || reduced) return Promise.resolve()
    return new Promise(resolve => {
      const id = setTimeout(() => {
        timeouts.delete(id)
        resolve()
      }, ms)
      timeouts.add(id)
    })
  }

  function centerOf(target: HTMLElement) {
    const rootBox = root.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    return {
      x: box.left - rootBox.left + box.width / 2,
      y: box.top - rootBox.top + box.height / 2,
    }
  }

  async function moveTo(target: HTMLElement | null, duration = 300): Promise<void> {
    if (!target || cancelled || reduced) return
    const point = centerOf(target)
    cursor.style.left = `${point.x - 9}px`
    cursor.style.top = `${point.y - 9}px`
    await sleep(duration)
  }

  async function clickEl(target: HTMLElement | null, duration = 150): Promise<void> {
    if (!target || cancelled || reduced) return
    const point = centerOf(target)
    const ripple = document.createElement('div')
    ripple.style.cssText = `position:absolute;left:${point.x - 10}px;top:${point.y - 10}px;width:20px;height:20px;border-radius:50%;background:${accentSoft};transform:scale(0);animation:skh-ripple .35s ease-out forwards;pointer-events:none;z-index:19`
    root.appendChild(ripple)
    target.style.transform = 'scale(.98)'
    await sleep(duration)
    target.style.transform = ''
    ripple.remove()
  }

  function typeIn(target: HTMLElement, text: string, speed = 26): Promise<void> {
    if (cancelled) return Promise.resolve()
    if (reduced) {
      target.textContent = text
      return Promise.resolve()
    }
    return new Promise(resolve => {
      const node = document.createTextNode('')
      const caret = document.createElement('span')
      caret.style.cssText = `border-right:2px solid ${accent};animation:skh-blink .8s infinite;display:inline-block;width:1px;height:1.1em;vertical-align:text-bottom;margin-left:1px`
      target.innerHTML = ''
      target.appendChild(node)
      target.appendChild(caret)
      let i = 0
      const id = setInterval(() => {
        if (cancelled) {
          clearInterval(id)
          intervals.delete(id)
          resolve()
          return
        }
        if (i < text.length) {
          node.textContent += text[i]
          i += 1
        } else {
          clearInterval(id)
          intervals.delete(id)
          caret.remove()
          resolve()
        }
      }, speed)
      intervals.add(id)
    })
  }

  async function fadeTransition(): Promise<void> {
    if (cancelled) return
    if (!reduced) {
      panel.style.opacity = '0'
      await sleep(280)
    }
    panel.innerHTML = ''
    panel.style.opacity = '1'
  }

  function activateStep(index: number) {
    stepNodes.forEach((node, i) => {
      const position = i + 1
      const number = stepNumbers[i]
      node.classList.toggle('is-active', position === index)
      node.classList.toggle('is-done', position < index)
      number.innerHTML = position < index ? checkMark(theme.success) : String(position)
    })
    // Sur mobile la colonne de progression devient une bande horizontale : on y
    // recentre l'étape courante. Le défilement est appliqué à la bande elle-même,
    // jamais via scrollIntoView — qui, sur desktop où la bande ne défile pas,
    // remonterait la PAGE à chaque changement de phase.
    const active = stepNodes[index - 1]
    if (!active || reduced) return
    if (stepsStrip.scrollWidth <= stepsStrip.clientWidth) return
    stepsStrip.scrollTo({
      left: active.offsetLeft - (stepsStrip.clientWidth - active.offsetWidth) / 2,
      behavior: 'smooth',
    })
  }

  function setBar(percent: number, duration: number) {
    if (reduced) {
      barFill.style.transition = 'none'
      barFill.style.width = `${percent}%`
      return
    }
    barFill.style.transition = 'none'
    barFill.style.width = '0%'
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (cancelled) return
        barFill.style.transition = `width ${duration}ms linear`
        barFill.style.width = `${percent}%`
      }),
    )
  }

  function make(html: string, css?: string): HTMLElement {
    const node = document.createElement('div')
    if (css) node.style.cssText = css
    node.innerHTML = html
    return node
  }

  function avatar(initials: string, size = 34): string {
    return `<span class="skh-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${esc(initials)}</span>`
  }

  const context: DemoContext = {
    panel,
    accent,
    accentSoft,
    cancelled: () => cancelled,
    reduced,
    sleep,
    moveTo,
    clickEl,
    typeIn,
    fadeTransition,
    activateStep,
    setBar,
    make,
    avatar,
  }

  function reset() {
    panel.innerHTML = ''
    stepNodes.forEach((node, i) => {
      node.classList.remove('is-active', 'is-done')
      stepNumbers[i].innerHTML = String(i + 1)
    })
    barFill.style.transition = 'none'
    barFill.style.width = '0%'
  }

  async function run() {
    // Mouvement réduit : une seule passe, sans temporisation, puis arrêt sur
    // l'état final. Le visiteur voit le parcours complet, jamais la boucle.
    do {
      reset()
      await scenario(context)
      if (cancelled || reduced) break
      await sleep(900)
    } while (!cancelled)
  }

  void run()

  return () => {
    cancelled = true
    timeouts.forEach(clearTimeout)
    timeouts.clear()
    intervals.forEach(clearInterval)
    intervals.clear()
    root.innerHTML = ''
  }
}
