// components/home/demo/scenarios.ts
//
// Les deux parcours démontrés sur la page d'accueil, écrits sur les primitives
// de `engine.ts`. Aucun texte n'est écrit ici : tout arrive via `labels`,
// pré-résolu depuis next-intl et depuis la configuration de domaine (les noms de
// produits affichés dans les données fictives viennent de `featuredProducts`,
// donc la démo se rhabille toute seule sur un autre écosystème).

import { esc, type DemoContext, type DemoScenario } from './engine'
import { theme } from '../theme'

export type DemoPerson = {
  initials: string
  name: string
  specShort: string
  specLong: string
  tjm: string
  availability: string
  /** Déjà formaté par next-intl : la démo n'invente aucun format de nombre. */
  score: string
  verified: boolean
}

export type CompanyDemoLabels = {
  recruiter: { initials: string; name: string; postingLine: string; selectingLine: string }
  mission: {
    titleLabel: string
    titleValue: string
    tjmLabel: string
    tjmValue: string
    durationLabel: string
    durationValue: string
    durationShort: string
    descriptionLabel: string
    descriptionValue: string
    publishButton: string
  }
  tags: string[]
  matching: { title: string; status: string; criteria: string; notifiedBadge: string }
  candidates: DemoPerson[]
  candidatesTitle: string
  matchLabel: string
  selectionConfirmed: string
  chat: {
    title: string
    onlineLabel: string
    sharedMissionLabel: string
    scoreLabel: string
    messageFromCompany: string
    messageFromExpert: string
  }
}

export type ExpertDemoLabels = {
  profile: {
    initials: string
    name: string
    headline: string
    checkingLabel: string
    verifiedBadge: string
    skills: string[]
    availabilityLabel: string
  }
  mission: {
    detectedLabel: string
    title: string
    company: string
    score: string
    scoreLabel: string
    tjmLabel: string
    tjmValue: string
    locationLabel: string
    locationValue: string
    matchExplanation: string
    applyButton: string
  }
  apply: { sendingLabel: string; sentTitle: string; sentBody: string; anonymityNote: string }
  chat: {
    title: string
    recruiterInitials: string
    recruiterName: string
    recruiterRole: string
    onlineLabel: string
    message: string
    internalNote: string
    replyPlaceholder: string
  }
}

const sectionHeader = (ctx: DemoContext, avatarHtml: string, title: string, subtitle: string, subtitleColor: string) =>
  ctx.make(
    `${avatarHtml}
     <div style="min-width:0">
       <div style="font-size:13px;font-weight:600;color:${theme.ink}">${esc(title)}</div>
       <div style="font-size:11px;font-weight:500;color:${subtitleColor}">${esc(subtitle)}</div>
     </div>`,
    'display:flex;align-items:center;gap:10px;margin-bottom:13px',
  )

const verifiedMark = (size = 13) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${theme.success}"/><path d="M8 12l3 3 5-5" stroke="${theme.white}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const aiGlyph = (accent: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
     <line x1="12" y1="2" x2="12" y2="5" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>
     <circle cx="12" cy="2" r="1.2" fill="${accent}"/>
     <rect x="5" y="5" width="14" height="13" rx="3" fill="none" stroke="${accent}" stroke-width="1.8"/>
     <circle cx="9" cy="11" r="1.4" fill="${accent}"/><circle cx="15" cy="11" r="1.4" fill="${accent}"/>
     <line x1="9" y1="15" x2="15" y2="15" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>
     <line x1="5" y1="10" x2="3.5" y2="10" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>
     <line x1="19" y1="10" x2="20.5" y2="10" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/>
   </svg>`

const sendGlyph = () =>
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="${theme.white}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/* ------------------------------------------------------------------ */
/* Parcours ENTREPRISE — publier, l'IA notifie, scorer, choisir, échanger */
/* ------------------------------------------------------------------ */

export function companyScenario(labels: CompanyDemoLabels): DemoScenario {
  return async ctx => {
    const { panel, accent } = ctx

    /* 1 — publier le besoin */
    await ctx.fadeTransition()
    if (ctx.cancelled()) return
    ctx.activateStep(1)
    ctx.setBar(20, 6500)

    panel.appendChild(
      sectionHeader(ctx, ctx.avatar(labels.recruiter.initials, 34), labels.recruiter.name, labels.recruiter.postingLine, accent),
    )

    const fields = [
      { label: labels.mission.titleLabel, value: labels.mission.titleValue },
      { label: labels.mission.tjmLabel, value: labels.mission.tjmValue },
      { label: labels.mission.durationLabel, value: labels.mission.durationValue },
    ]
    const fieldNodes: HTMLElement[] = []
    for (const field of fields) {
      const wrap = ctx.make(
        `<div style="font-size:11px;color:${theme.faint};margin-bottom:3px">${esc(field.label)}</div>`,
        'margin-bottom:9px',
      )
      const input = document.createElement('div')
      input.className = 'skh-field'
      wrap.appendChild(input)
      panel.appendChild(wrap)
      fieldNodes.push(input)
    }

    const descWrap = ctx.make(
      `<div style="font-size:11px;color:${theme.faint};margin-bottom:3px">${esc(labels.mission.descriptionLabel)}</div>`,
      'margin-bottom:9px',
    )
    const descInput = document.createElement('div')
    descInput.className = 'skh-field skh-area'
    descWrap.appendChild(descInput)
    panel.appendChild(descWrap)

    const tagRow = ctx.make('', 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;min-height:22px')
    panel.appendChild(tagRow)

    const publish = ctx.make(esc(labels.mission.publishButton), `padding:10px;background:${accent};color:${theme.white};border-radius:9px;font-size:13px;font-weight:600;text-align:center;opacity:.35;transition:opacity .3s`)
    panel.appendChild(publish)

    await ctx.sleep(200)
    for (let i = 0; i < fieldNodes.length; i += 1) {
      if (ctx.cancelled()) return
      const node = fieldNodes[i]
      await ctx.moveTo(node, 250)
      node.classList.add('is-focus')
      await ctx.clickEl(node, 120)
      await ctx.typeIn(node, fields[i].value, 26)
      node.classList.remove('is-focus')
      await ctx.sleep(70)
    }
    if (ctx.cancelled()) return
    await ctx.moveTo(descInput, 250)
    descInput.classList.add('is-focus')
    await ctx.clickEl(descInput, 120)
    await ctx.typeIn(descInput, labels.mission.descriptionValue, 24)
    descInput.classList.remove('is-focus')

    for (const tag of labels.tags) {
      if (ctx.cancelled()) return
      await ctx.sleep(120)
      const chip = document.createElement('span')
      chip.className = 'skh-tag skh-in'
      chip.textContent = tag
      tagRow.appendChild(chip)
    }

    await ctx.sleep(180)
    publish.style.opacity = '1'
    await ctx.moveTo(publish, 300)
    await ctx.clickEl(publish, 170)
    await ctx.sleep(160)

    /* 2 — l'IA cherche et notifie */
    await ctx.fadeTransition()
    if (ctx.cancelled()) return
    ctx.activateStep(2)
    ctx.setBar(40, 3500)

    panel.appendChild(
      sectionHeader(
        ctx,
        `<span class="skh-avatar" style="width:36px;height:36px;border-radius:10px" aria-hidden="true">${aiGlyph(accent)}</span>`,
        labels.matching.title,
        labels.matching.status,
        accent,
      ),
    )

    const scanCard = ctx.make(
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">
         <svg class="skh-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="${accent}" stroke-width="2" stroke-linecap="round"/></svg>
         <div style="font-size:12px;font-weight:600;color:${theme.ink}">${esc(labels.matching.criteria)}</div>
       </div>
       <div style="height:5px;background:${theme.border};border-radius:10px;overflow:hidden"><i style="display:block;height:100%;width:0;background:${accent};border-radius:10px;transition:width .3s ease"></i></div>`,
      `padding:11px;background:${ctx.accentSoft};border:1px solid ${theme.borderSoft};border-radius:10px;margin-bottom:11px`,
    )
    panel.appendChild(scanCard)
    const scanFill = scanCard.querySelector<HTMLElement>('i')!

    const notifyList = ctx.make('', 'display:flex;flex-direction:column;gap:7px')
    panel.appendChild(notifyList)

    for (let i = 0; i < labels.candidates.length; i += 1) {
      if (ctx.cancelled()) return
      await ctx.sleep(480)
      scanFill.style.width = `${((i + 1) / labels.candidates.length) * 100}%`
      const person = labels.candidates[i]
      const row = ctx.make(
        `${ctx.avatar(person.initials, 28)}
         <div style="flex:1;min-width:0">
           <div style="font-size:12px;font-weight:600;color:${theme.ink}">${esc(person.name)}</div>
           <div style="font-size:11px;color:${theme.muted}">${esc(person.specShort)}</div>
         </div>
         <div style="font-size:13px;font-weight:700;color:${accent}">${esc(person.score)}</div>
         <span class="skh-tag" style="white-space:nowrap">${esc(labels.matching.notifiedBadge)}</span>`,
      )
      row.className = 'skh-row skh-slide'
      notifyList.appendChild(row)
    }
    await ctx.sleep(260)

    /* 3 — les candidatures arrivent, scorées */
    await ctx.fadeTransition()
    if (ctx.cancelled()) return
    ctx.activateStep(3)
    ctx.setBar(60, 4000)

    panel.appendChild(
      ctx.make(
        `<div style="font-size:13px;font-weight:600;color:${theme.ink}">${esc(labels.candidatesTitle)}</div>`,
        'margin-bottom:11px',
      ),
    )

    const cards: HTMLElement[] = []
    for (const person of labels.candidates) {
      if (ctx.cancelled()) return
      await ctx.sleep(220)
      const card = ctx.make(
        `${ctx.avatar(person.initials, 38)}
         <div style="flex:1;min-width:0">
           <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
             <span style="font-size:13px;font-weight:600;color:${theme.ink}">${esc(person.name)}</span>
             ${person.verified ? verifiedMark(13) : ''}
           </div>
           <div style="font-size:11px;color:${theme.muted}">${esc(person.specLong)}</div>
           <div style="display:flex;gap:9px;margin-top:2px">
             <span style="font-size:11px;font-weight:500;color:${theme.ink}">${esc(person.tjm)}</span>
             <span style="font-size:11px;color:${theme.faint}">${esc(person.availability)}</span>
           </div>
         </div>
         <div style="text-align:right;flex-shrink:0">
           <div style="font-size:15px;font-weight:700;color:${theme.success}">${esc(person.score)}</div>
           <div style="font-size:10px;color:${theme.faint}">${esc(labels.matchLabel)}</div>
         </div>`,
      )
      card.className = 'skh-row skh-in-up'
      card.style.marginBottom = '8px'
      panel.appendChild(card)
      cards.push(card)
    }
    await ctx.sleep(400)

    /* 4 — l'entreprise choisit */
    if (ctx.cancelled()) return
    ctx.activateStep(4)
    ctx.setBar(80, 2800)
    panel.insertBefore(
      sectionHeader(ctx, ctx.avatar(labels.recruiter.initials, 32), labels.recruiter.name, labels.recruiter.selectingLine, theme.warn),
      panel.firstChild,
    )
    await ctx.sleep(220)
    await ctx.moveTo(cards[0], 420)
    cards[0].classList.add('is-sel')
    await ctx.clickEl(cards[0], 200)
    await ctx.sleep(120)
    panel.appendChild(
      ctx.make(
        `${verifiedMark(16)}<span style="font-size:13px;font-weight:600;color:${theme.success}">${esc(labels.selectionConfirmed)}</span>`,
        `display:flex;align-items:center;gap:8px;padding:10px 12px;background:${theme.successSoft};border:1px solid ${theme.success}33;border-radius:9px;margin-top:10px`,
      ),
    ).classList.add('skh-in-up')
    await ctx.sleep(360)

    /* 5 — l'échange s'ouvre */
    await ctx.fadeTransition()
    if (ctx.cancelled()) return
    ctx.activateStep(5)
    ctx.setBar(100, 5000)

    const chosen = labels.candidates[0]
    panel.appendChild(
      ctx.make(
        esc(labels.chat.title),
        `font-size:11px;font-weight:600;color:${theme.faint};letter-spacing:.05em;text-transform:uppercase;margin-bottom:9px`,
      ),
    )

    const chat = ctx.make(
      `<div style="background:${theme.white};border-bottom:1px solid ${theme.borderSoft};padding:10px 12px;display:flex;align-items:center;gap:9px">
         ${ctx.avatar(chosen.initials, 30)}
         <div style="flex:1;min-width:0">
           <div style="font-size:13px;font-weight:600;color:${theme.ink}">${esc(chosen.name)}</div>
           <div style="display:flex;align-items:center;gap:5px">
             <span class="skh-live"></span>
             <span style="font-size:11px;color:${theme.muted}">${esc(labels.chat.onlineLabel)}</span>
           </div>
         </div>
         <span class="skh-tag">${esc(labels.chat.scoreLabel)}</span>
       </div>
       <div style="margin:9px 10px;background:${theme.white};border:1px solid ${theme.borderSoft};border-radius:9px;padding:10px 11px">
         <div style="font-size:11px;font-weight:600;color:${theme.faint};margin-bottom:4px">${esc(labels.chat.sharedMissionLabel)}</div>
         <div style="font-size:12px;font-weight:600;color:${theme.ink};margin-bottom:3px">${esc(labels.mission.titleValue)} · ${esc(labels.mission.durationShort)}</div>
         <div style="display:flex;gap:5px;flex-wrap:wrap">${labels.tags.map(t => `<span class="skh-tag">${esc(t)}</span>`).join('')}</div>
       </div>`,
      `background:${theme.cream};border:1px solid ${theme.borderSoft};border-radius:11px;overflow:hidden`,
    )
    chat.classList.add('skh-pop')

    const thread = ctx.make('', 'padding:4px 10px;display:flex;flex-direction:column')
    chat.appendChild(thread)

    const composer = ctx.make(
      `${ctx.avatar(labels.recruiter.initials, 26)}
       <div class="skh-composer" style="flex:1;background:${theme.white};border:1px solid ${theme.border};border-radius:20px;padding:7px 12px;font-size:12px;color:${theme.ink};min-height:30px;white-space:pre-wrap;word-break:break-word"></div>
       <div class="skh-send" style="width:28px;height:28px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;opacity:.35;transition:opacity .3s">${sendGlyph()}</div>`,
      `padding:9px 10px;border-top:1px solid ${theme.borderSoft};display:flex;align-items:center;gap:8px;background:${theme.white}`,
    )
    chat.appendChild(composer)
    panel.appendChild(chat)

    const input = composer.querySelector<HTMLElement>('.skh-composer')!
    const send = composer.querySelector<HTMLElement>('.skh-send')!

    await ctx.sleep(260)
    await ctx.moveTo(input, 280)
    input.style.borderColor = accent
    await ctx.clickEl(input, 120)
    await ctx.typeIn(input, labels.chat.messageFromCompany, 28)
    await ctx.sleep(120)
    send.style.opacity = '1'
    await ctx.moveTo(send, 240)
    await ctx.clickEl(send, 150)
    if (ctx.cancelled()) return
    input.innerHTML = ''
    input.style.borderColor = theme.border
    send.style.opacity = '.35'

    const outgoing = ctx.make(
      `<div style="max-width:82%;padding:9px 11px;border-radius:11px 11px 2px 11px;background:${accent};color:${theme.white};font-size:12px;line-height:1.55">${esc(labels.chat.messageFromCompany)}</div>`,
      'display:flex;justify-content:flex-end;margin-bottom:7px',
    )
    outgoing.classList.add('skh-in-up')
    thread.appendChild(outgoing)
    await ctx.sleep(240)

    const typing = ctx.make(
      `<div style="display:flex;align-items:center;gap:3px;padding:7px 11px;background:${theme.cream};border:1px solid ${theme.borderSoft};border-radius:11px 11px 11px 2px"><span class="skh-dot"></span><span class="skh-dot" style="animation-delay:.15s"></span><span class="skh-dot" style="animation-delay:.3s"></span></div>`,
      'display:flex;justify-content:flex-start;margin-bottom:7px',
    )
    thread.appendChild(typing)
    await ctx.sleep(750)
    typing.remove()

    const incoming = ctx.make(
      `<div style="max-width:82%;padding:9px 11px;border-radius:11px 11px 11px 2px;background:${theme.cream};border:1px solid ${theme.borderSoft};color:${theme.ink};font-size:12px;line-height:1.55">${esc(labels.chat.messageFromExpert)}</div>`,
      'display:flex;justify-content:flex-start;margin-bottom:7px',
    )
    incoming.classList.add('skh-in-up')
    thread.appendChild(incoming)
    await ctx.sleep(320)
  }
}

/* ------------------------------------------------------------------ */
/* Parcours EXPERT — profil vérifié, mission détectée, candidature, échange */
/* ------------------------------------------------------------------ */

export function expertScenario(labels: ExpertDemoLabels): DemoScenario {
  return async ctx => {
    const { panel, accent } = ctx

    /* 1 — le profil est vérifié */
    await ctx.fadeTransition()
    if (ctx.cancelled()) return
    ctx.activateStep(1)
    ctx.setBar(25, 4200)

    const profile = ctx.make(
      `<div style="display:flex;align-items:center;gap:11px;margin-bottom:11px">
         ${ctx.avatar(labels.profile.initials, 44)}
         <div style="min-width:0">
           <div style="display:flex;align-items:center;gap:6px">
             <span style="font-size:14px;font-weight:700;color:${theme.ink}">${esc(labels.profile.name)}</span>
             <span class="skh-badge" style="display:inline-flex;opacity:0;transition:opacity .4s">${verifiedMark(15)}</span>
           </div>
           <div style="font-size:11px;color:${theme.muted}">${esc(labels.profile.headline)}</div>
         </div>
       </div>
       <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:11px">${labels.profile.skills.map(s => `<span class="skh-tag">${esc(s)}</span>`).join('')}</div>
       <div class="skh-state" style="display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:9px;background:${theme.cream};border:1px solid ${theme.borderSoft}">
         <svg class="skh-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="${accent}" stroke-width="2" stroke-linecap="round"/></svg>
         <span style="font-size:12px;font-weight:600;color:${theme.muted}">${esc(labels.profile.checkingLabel)}</span>
       </div>`,
      `padding:13px;border:1px solid ${theme.border};border-radius:12px;background:${theme.white}`,
    )
    profile.classList.add('skh-in-up')
    panel.appendChild(profile)

    await ctx.sleep(1150)
    if (ctx.cancelled()) return
    profile.querySelector<HTMLElement>('.skh-badge')!.style.opacity = '1'
    const state = profile.querySelector<HTMLElement>('.skh-state')!
    state.style.background = theme.successSoft
    state.style.borderColor = `${theme.success}33`
    state.innerHTML = `${verifiedMark(15)}<span style="font-size:12px;font-weight:600;color:${theme.success}">${esc(labels.profile.verifiedBadge)}</span>`
    await ctx.sleep(280)

    panel.appendChild(
      ctx.make(
        `<span class="skh-live"></span><span style="font-size:11px;color:${theme.muted}">${esc(labels.profile.availabilityLabel)}</span>`,
        'display:flex;align-items:center;gap:7px;margin-top:11px',
      ),
    ).classList.add('skh-in')
    await ctx.sleep(420)

    /* 2 — une mission est détectée */
    await ctx.fadeTransition()
    if (ctx.cancelled()) return
    ctx.activateStep(2)
    ctx.setBar(50, 4600)

    panel.appendChild(
      ctx.make(
        `<span class="skh-avatar" style="width:26px;height:26px;border-radius:8px" aria-hidden="true">${aiGlyph(accent)}</span>
         <span style="font-size:11px;font-weight:600;color:${accent};letter-spacing:.05em;text-transform:uppercase">${esc(labels.mission.detectedLabel)}</span>`,
        'display:flex;align-items:center;gap:8px;margin-bottom:11px',
      ),
    ).classList.add('skh-in')

    const mission = ctx.make(
      `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
         <div style="flex:1;min-width:0">
           <div style="font-size:14px;font-weight:700;color:${theme.ink};line-height:1.3;margin-bottom:3px">${esc(labels.mission.title)}</div>
           <div style="font-size:11px;color:${theme.muted}">${esc(labels.mission.company)}</div>
         </div>
         <div style="text-align:right;flex-shrink:0">
           <div style="font-size:18px;font-weight:700;color:${theme.success};line-height:1">${esc(labels.mission.score)}</div>
           <div style="font-size:10px;color:${theme.faint}">${esc(labels.mission.scoreLabel)}</div>
         </div>
       </div>
       <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">
         <div><div style="font-size:10px;color:${theme.faint}">${esc(labels.mission.tjmLabel)}</div><div style="font-size:12px;font-weight:600;color:${theme.ink}">${esc(labels.mission.tjmValue)}</div></div>
         <div><div style="font-size:10px;color:${theme.faint}">${esc(labels.mission.locationLabel)}</div><div style="font-size:12px;font-weight:600;color:${theme.ink}">${esc(labels.mission.locationValue)}</div></div>
       </div>
       <div style="display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-radius:9px;background:${ctx.accentSoft}">
         <span style="flex-shrink:0;margin-top:1px">${aiGlyph(accent, 14)}</span>
         <span style="font-size:11px;line-height:1.5;color:${theme.muted}">${esc(labels.mission.matchExplanation)}</span>
       </div>`,
      `padding:13px;border:1px solid ${theme.border};border-radius:12px;background:${theme.white}`,
    )
    mission.classList.add('skh-slide')
    panel.appendChild(mission)

    const apply = ctx.make(
      esc(labels.mission.applyButton),
      `margin-top:11px;padding:10px;background:${accent};color:${theme.white};border-radius:9px;font-size:13px;font-weight:600;text-align:center`,
    )
    panel.appendChild(apply)
    await ctx.sleep(760)

    /* 3 — l'expert candidate, son nom reste masqué */
    if (ctx.cancelled()) return
    ctx.activateStep(3)
    ctx.setBar(75, 3600)
    await ctx.moveTo(apply, 420)
    await ctx.clickEl(apply, 190)
    if (ctx.cancelled()) return
    apply.textContent = labels.apply.sendingLabel
    apply.style.opacity = '.6'
    await ctx.sleep(620)

    await ctx.fadeTransition()
    if (ctx.cancelled()) return

    const sent = ctx.make(
      `<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">
         ${verifiedMark(18)}
         <span style="font-size:14px;font-weight:700;color:${theme.ink}">${esc(labels.apply.sentTitle)}</span>
       </div>
       <div style="font-size:12px;line-height:1.55;color:${theme.muted}">${esc(labels.apply.sentBody)}</div>`,
      `padding:13px;border:1px solid ${theme.success}33;border-radius:12px;background:${theme.successSoft}`,
    )
    sent.classList.add('skh-pop')
    panel.appendChild(sent)

    await ctx.sleep(320)
    const anonymity = ctx.make(
      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="flex-shrink:0;margin-top:1px"><rect x="4" y="10" width="16" height="10" rx="2.5" stroke="${theme.warn}" stroke-width="1.9"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="${theme.warn}" stroke-width="1.9" stroke-linecap="round"/></svg>
       <span style="font-size:11px;line-height:1.55;color:${theme.warn}">${esc(labels.apply.anonymityNote)}</span>`,
      `display:flex;align-items:flex-start;gap:8px;margin-top:11px;padding:10px 11px;border-radius:9px;background:${theme.warnSoft};border:1px solid ${theme.warn}26`,
    )
    anonymity.classList.add('skh-in-up')
    panel.appendChild(anonymity)
    await ctx.sleep(520)

    /* 4 — l'échange s'ouvre */
    await ctx.fadeTransition()
    if (ctx.cancelled()) return
    ctx.activateStep(4)
    ctx.setBar(100, 4600)

    panel.appendChild(
      ctx.make(
        esc(labels.chat.title),
        `font-size:11px;font-weight:600;color:${theme.faint};letter-spacing:.05em;text-transform:uppercase;margin-bottom:9px`,
      ),
    )

    const conversation = ctx.make(
      `<div style="background:${theme.white};border-bottom:1px solid ${theme.borderSoft};padding:10px 12px;display:flex;align-items:center;gap:9px">
         ${ctx.avatar(labels.chat.recruiterInitials, 30)}
         <div style="flex:1;min-width:0">
           <div style="font-size:13px;font-weight:600;color:${theme.ink}">${esc(labels.chat.recruiterName)}</div>
           <div style="display:flex;align-items:center;gap:5px">
             <span class="skh-live"></span>
             <span style="font-size:11px;color:${theme.muted}">${esc(labels.chat.onlineLabel)} · ${esc(labels.chat.recruiterRole)}</span>
           </div>
         </div>
       </div>
       <div class="skh-thread" style="padding:11px 11px 4px;display:flex;flex-direction:column"></div>
       <div style="padding:9px 10px;border-top:1px solid ${theme.borderSoft};display:flex;align-items:center;gap:8px;background:${theme.white}">
         <div style="flex:1;background:${theme.cream};border:1px solid ${theme.border};border-radius:20px;padding:7px 12px;font-size:12px;color:${theme.faint}">${esc(labels.chat.replyPlaceholder)}</div>
         <div style="width:28px;height:28px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;opacity:.35">${sendGlyph()}</div>
       </div>`,
      `background:${theme.cream};border:1px solid ${theme.borderSoft};border-radius:11px;overflow:hidden`,
    )
    conversation.classList.add('skh-pop')
    panel.appendChild(conversation)

    const thread = conversation.querySelector<HTMLElement>('.skh-thread')!
    await ctx.sleep(340)

    const typing = ctx.make(
      `<div style="display:flex;align-items:center;gap:3px;padding:7px 11px;background:${theme.white};border:1px solid ${theme.borderSoft};border-radius:11px 11px 11px 2px"><span class="skh-dot"></span><span class="skh-dot" style="animation-delay:.15s"></span><span class="skh-dot" style="animation-delay:.3s"></span></div>`,
      'display:flex;justify-content:flex-start;margin-bottom:7px',
    )
    thread.appendChild(typing)
    await ctx.sleep(820)
    typing.remove()

    const incoming = ctx.make(
      `<div style="max-width:86%;padding:9px 11px;border-radius:11px 11px 11px 2px;background:${theme.white};border:1px solid ${theme.borderSoft};color:${theme.ink};font-size:12px;line-height:1.55">${esc(labels.chat.message)}</div>`,
      'display:flex;justify-content:flex-start;margin-bottom:9px',
    )
    incoming.classList.add('skh-in-up')
    thread.appendChild(incoming)
    await ctx.sleep(340)

    thread.appendChild(
      ctx.make(
        `<span style="font-size:11px;color:${theme.faint};line-height:1.5">${esc(labels.chat.internalNote)}</span>`,
        'display:flex;justify-content:center;text-align:center;padding:0 8px 4px',
      ),
    ).classList.add('skh-in')
    await ctx.sleep(360)
  }
}
