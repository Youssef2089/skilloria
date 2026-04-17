'use client'

import { useEffect, useRef } from 'react'

interface HeroAnimationProps {
  primaryColor: string
  domainName: string
}

export default function HeroAnimation({ primaryColor, domainName }: HeroAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''

    const style = document.createElement('style')
    style.textContent = `
      @keyframes sk-fadeInUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
      @keyframes sk-fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes sk-notifSlide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
      @keyframes sk-checkDraw{from{stroke-dashoffset:22}to{stroke-dashoffset:0}}
      @keyframes sk-blink{50%{opacity:0}}
      @keyframes sk-ripple{from{transform:scale(0);opacity:0.5}to{transform:scale(3);opacity:0}}
      @keyframes sk-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
      @keyframes sk-msgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
      @keyframes sk-typingDot{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}
      @keyframes sk-pulseGreen{0%,100%{opacity:1}50%{opacity:0.4}}
      @keyframes sk-popIn{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}
      .sk-step{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;transition:all 0.4s ease;margin-bottom:3px;cursor:default}
      .sk-step.active{box-shadow:0 2px 12px rgba(0,0,0,0.07);transform:scale(1.04)}
      .sk-snum{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;transition:all 0.4s}
      .sk-slbl{font-size:12px;font-weight:500;transition:all 0.3s;line-height:1.3;flex:1}
      .sk-tag{display:inline-flex;align-items:center;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600}
      .sk-cand{display:flex;align-items:center;gap:10px;padding:10px 13px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;margin-bottom:8px;animation:sk-fadeInUp 0.3s ease both;transition:all 0.2s;cursor:pointer}
      .sk-cand.sel{border-color:#15803d;background:#f0fdf4;box-shadow:0 0 0 3px rgba(21,128,61,0.12)}
      .sk-msg{animation:sk-msgIn 0.3s ease both;margin-bottom:7px}
      .sk-td{width:5px;height:5px;border-radius:50%;background:#9ca3af;animation:sk-typingDot 1.2s infinite}
      .sk-inp{background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-size:13px;color:#111827;transition:border-color 0.2s;min-height:34px;white-space:pre-wrap;word-break:break-word}
      .sk-desc{background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-size:13px;color:#374151;transition:border-color 0.2s;height:68px;overflow:hidden;line-height:1.55;white-space:pre-wrap;word-break:break-word}
      @keyframes sk-robotBlink{0%,45%,55%,100%{transform:scaleY(1)}50%{transform:scaleY(0.1)}}
      @keyframes sk-robotScan{0%,100%{top:20%}50%{top:70%}}
    `
    container.appendChild(style)

    const cur = document.createElement('div')
    cur.style.cssText = `position:absolute;width:20px;height:20px;pointer-events:none;z-index:999;left:200px;top:200px;transition:left 0.38s cubic-bezier(.25,.1,.25,1),top 0.38s cubic-bezier(.25,.1,.25,1);filter:drop-shadow(0 1px 3px rgba(0,0,0,0.25))`
    cur.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 2L3 15.5L6.8 11.5L9.5 17L11.2 16.1L8.5 10.5L13.5 10.5Z" fill="#111827" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`
    container.appendChild(cur)

    const layout = document.createElement('div')
    layout.style.cssText = 'display:flex;gap:12px;padding:14px;height:calc(100% - 22px)'

    const lpWrap = document.createElement('div')
    lpWrap.style.cssText = 'flex:1;min-width:0'
    const lp = document.createElement('div')
    lp.style.cssText = 'background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:14px;height:100%;overflow:hidden;transition:opacity 0.3s ease'
    lpWrap.appendChild(lp)
    layout.appendChild(lpWrap)

    const rpWrap = document.createElement('div')
    rpWrap.style.cssText = 'width:178px;flex-shrink:0'
    const rp = document.createElement('div')
    rp.style.cssText = 'background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:12px'
    rp.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:10px">Progression</div>
      <div>
        <div class="sk-step" id="sk-s1"><div class="sk-snum" id="sk-n1" style="background:#f3f4f6;color:#d1d5db">1</div><div class="sk-slbl" id="sk-l1" style="color:#d1d5db">Publier la mission</div></div>
        <div class="sk-step" id="sk-s2"><div class="sk-snum" id="sk-n2" style="background:#f3f4f6;color:#d1d5db">2</div><div class="sk-slbl" id="sk-l2" style="color:#d1d5db">IA notifie experts</div></div>
        <div class="sk-step" id="sk-s3"><div class="sk-snum" id="sk-n3" style="background:#f3f4f6;color:#d1d5db">3</div><div class="sk-slbl" id="sk-l3" style="color:#d1d5db">L'expert postule</div></div>
        <div class="sk-step" id="sk-s4"><div class="sk-snum" id="sk-n4" style="background:#f3f4f6;color:#d1d5db">4</div><div class="sk-slbl" id="sk-l4" style="color:#d1d5db">Recruteur choisit</div></div>
        <div class="sk-step" id="sk-s5"><div class="sk-snum" id="sk-n5" style="background:#f3f4f6;color:#d1d5db">5</div><div class="sk-slbl" id="sk-l5" style="color:#d1d5db">Chat ouvert</div></div>
      </div>`
    rpWrap.appendChild(rp)
    layout.appendChild(rpWrap)
    container.appendChild(layout)

    const barWrap = document.createElement('div')
    barWrap.style.cssText = 'padding:0 14px 12px'
    barWrap.innerHTML = `<div style="height:3px;background:#e5e7eb;border-radius:10px;overflow:hidden"><div id="sk-gb" style="height:100%;background:${primaryColor};width:0;border-radius:10px;transition:width linear"></div></div>`
    container.appendChild(barWrap)

    const stepDefs = [
      { snumBg:'#dbeafe', snumColor:'#1d4ed8', stepBg:'#eff6ff', titleColor:'#1d4ed8' },
      { snumBg:'#ede9fe', snumColor:'#6d28d9', stepBg:'#f5f3ff', titleColor:'#6d28d9' },
      { snumBg:'#dcfce7', snumColor:'#15803d', stepBg:'#f0fdf4', titleColor:'#15803d' },
      { snumBg:'#fef9c3', snumColor:'#92400e', stepBg:'#fefce8', titleColor:'#92400e' },
      { snumBg:'#fce7f3', snumColor:'#9d174d', stepBg:'#fdf2f8', titleColor:'#9d174d' },
    ]

    const el = container
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    function getC(target: HTMLElement) {
      const rr = el.getBoundingClientRect()
      const er = target.getBoundingClientRect()
      return { x: er.left - rr.left + er.width / 2, y: er.top - rr.top + er.height / 2 }
    }
    function moveTo(target: HTMLElement, d = 300): Promise<void> {
      return new Promise(r => {
        const p = getC(target)
        cur.style.left = (p.x - 10) + 'px'
        cur.style.top = (p.y - 10) + 'px'
        setTimeout(r, d)
      })
    }
    function clickEl(target: HTMLElement, d = 150): Promise<void> {
      return new Promise(r => {
        const p = getC(target)
        const rp = document.createElement('div')
        rp.style.cssText = `position:absolute;left:${p.x - 10}px;top:${p.y - 10}px;width:20px;height:20px;border-radius:50%;background:${primaryColor}40;transform:scale(0);animation:sk-ripple 0.35s ease-out forwards;pointer-events:none;z-index:998`
        el.appendChild(rp)
        target.style.transform = 'scale(0.97)'
        setTimeout(() => { target.style.transform = ''; rp.remove(); r() }, d)
      })
    }
    function typeIn(target: HTMLElement, text: string, speed = 28): Promise<void> {
      return new Promise(r => {
        let i = 0
        const tn = document.createTextNode('')
        const c = document.createElement('span')
        c.style.cssText = `border-right:2px solid ${primaryColor};animation:sk-blink 0.8s infinite;display:inline-block;width:1px;height:1.1em;vertical-align:text-bottom;margin-left:1px`
        target.innerHTML = ''
        target.appendChild(tn)
        target.appendChild(c)
        const iv = setInterval(() => {
          if (i < text.length) { tn.textContent += text[i]; i++ }
          else { clearInterval(iv); c.remove(); r() }
        }, speed)
      })
    }
    function setBar(pct: number, dur: number) {
      const b = document.getElementById('sk-gb') as HTMLElement
      if (!b) return
      b.style.transition = 'none'; b.style.width = '0%'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        b.style.transition = `width ${dur}ms linear`
        b.style.width = pct + '%'
      }))
    }
    function activateStep(n: number) {
      for (let i = 1; i <= 5; i++) {
        const s = document.getElementById(`sk-s${i}`) as HTMLElement
        const nu = document.getElementById(`sk-n${i}`) as HTMLElement
        const lb = document.getElementById(`sk-l${i}`) as HTMLElement
        const sd = stepDefs[i - 1]
        if (!s || !nu || !lb) continue
        if (i < n) {
          s.className = 'sk-step'; s.style.background = 'transparent'; s.style.transform = 'scale(1)'
          nu.style.background = sd.snumBg; nu.style.color = sd.snumColor
          nu.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="${sd.snumColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          lb.style.color = '#9ca3af'; lb.style.fontWeight = '400'
        } else if (i === n) {
          s.className = 'sk-step active'; s.style.background = sd.stepBg
          nu.style.background = sd.snumBg; nu.style.color = sd.snumColor; nu.textContent = String(i)
          lb.style.color = sd.titleColor; lb.style.fontWeight = '700'
        } else {
          s.className = 'sk-step'; s.style.background = 'transparent'; s.style.transform = 'scale(1)'
          nu.style.background = '#f3f4f6'; nu.style.color = '#d1d5db'; nu.textContent = String(i)
          lb.style.color = '#d1d5db'; lb.style.fontWeight = '500'
        }
      }
    }
    function resetAll() {
      lp.innerHTML = ''
      for (let i = 1; i <= 5; i++) {
        const s = document.getElementById(`sk-s${i}`) as HTMLElement
        const nu = document.getElementById(`sk-n${i}`) as HTMLElement
        const lb = document.getElementById(`sk-l${i}`) as HTMLElement
        if (!s || !nu || !lb) continue
        s.className = 'sk-step'; s.style.background = 'transparent'; s.style.transform = 'scale(1)'
        nu.style.background = '#f3f4f6'; nu.style.color = '#d1d5db'; nu.textContent = String(i)
        lb.style.color = '#d1d5db'; lb.style.fontWeight = '500'
      }
    }

    // Transition fade douce
    async function fadeTransition() {
      lp.style.opacity = '0'
      await sleep(300)
      lp.innerHTML = ''
      lp.style.opacity = '1'
    }

    async function phase1() {
      await fadeTransition(); activateStep(1); setBar(20, 6500)
      const header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;animation:sk-fadeIn 0.3s ease both'
      header.innerHTML = `
        <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:2px solid #bae6fd;flex-shrink:0">
          <img src="https://randomuser.me/api/portraits/women/44.jpg" style="width:100%;height:100%;object-fit:cover" alt="Stéphanie M."/>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:#111827">Stéphanie M.</div>
          <div style="font-size:11px;color:#1d4ed8;font-weight:500">Responsable recrutement · Publie une mission</div>
        </div>`
      lp.appendChild(header)

      const sf = [
        { label: 'Titre', id: 'sk-f1', text: 'Expert D365 Finance & Ops' },
        { label: 'TJM', id: 'sk-f2', text: '850€ — 1000€ / jour' },
        { label: 'Durée & lieu', id: 'sk-f3', text: '6 mois · Paris · Remote' },
      ]
      for (const f of sf) {
        const w = document.createElement('div'); w.style.cssText = 'margin-bottom:10px'
        w.innerHTML = `<div style="font-size:11px;color:#9ca3af;margin-bottom:3px">${f.label}</div>`
        const inp = document.createElement('div'); inp.id = f.id; inp.className = 'sk-inp'
        w.appendChild(inp); lp.appendChild(w)
      }
      const dw = document.createElement('div'); dw.style.cssText = 'margin-bottom:10px'
      dw.innerHTML = '<div style="font-size:11px;color:#9ca3af;margin-bottom:3px">Description</div>'
      const di = document.createElement('div'); di.id = 'sk-fdesc'; di.className = 'sk-desc'
      dw.appendChild(di); lp.appendChild(dw)
      const tw = document.createElement('div'); tw.id = 'sk-tw'
      tw.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;min-height:24px'
      lp.appendChild(tw)
      const btn = document.createElement('div'); btn.id = 'sk-pbtn'
      btn.style.cssText = `padding:10px;background:#1d4ed8;color:#fff;border-radius:9px;font-size:13px;font-weight:600;text-align:center;cursor:pointer;opacity:0.3;transition:opacity 0.3s`
      btn.textContent = 'Publier la mission →'; lp.appendChild(btn)

      await sleep(200)
      for (const f of sf) {
        const target = document.getElementById(f.id) as HTMLElement
        await moveTo(target, 260); target.style.borderColor = '#1d4ed8'; target.style.background = '#fff'
        await clickEl(target, 120); await typeIn(target, f.text, 28)
        target.style.borderColor = '#e5e7eb'; target.style.background = '#f9fafb'; await sleep(70)
      }
      const desc = document.getElementById('sk-fdesc') as HTMLElement
      await moveTo(desc, 260); desc.style.borderColor = '#1d4ed8'; desc.style.background = '#fff'
      await clickEl(desc, 120)
      await typeIn(desc, 'Migration D365 Finance — paramétrage comptabilité, clôtures mensuelles et formation des utilisateurs.', 26)
      desc.style.borderColor = '#e5e7eb'; desc.style.background = '#f9fafb'; await sleep(80)

      const tagDefs = [
        { t: 'D365', bg: '#dbeafe', tc: '#1d4ed8' },
        { t: 'Finance', bg: '#dcfce7', tc: '#15803d' },
        { t: 'Remote OK', bg: '#ede9fe', tc: '#6d28d9' },
      ]
      for (let i = 0; i < tagDefs.length; i++) {
        await sleep(120)
        const tp = document.createElement('span'); tp.className = 'sk-tag'
        tp.style.cssText = `background:${tagDefs[i].bg};color:${tagDefs[i].tc}`
        tp.textContent = tagDefs[i].t
        document.getElementById('sk-tw')?.appendChild(tp)
      }
      await sleep(200)
      const btnEl = document.getElementById('sk-pbtn') as HTMLElement
      btnEl.style.opacity = '1'
      await moveTo(btnEl, 320); await clickEl(btnEl, 170)
      btnEl.style.background = '#1e40af'; await sleep(180)
    }

    async function phase2() {
      await fadeTransition(); activateStep(2); setBar(40, 3500)

      // Header avec ROBOT SVG au lieu de photo
      const header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;animation:sk-fadeIn 0.3s ease both'
      header.innerHTML = `
        <div style="width:40px;height:40px;border-radius:10px;background:${primaryColor}15;border:2px solid ${primaryColor}40;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;overflow:hidden">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <line x1="12" y1="2" x2="12" y2="5" stroke="${primaryColor}" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="12" cy="2" r="1.2" fill="${primaryColor}"/>
            <rect x="5" y="5" width="14" height="13" rx="3" fill="none" stroke="${primaryColor}" stroke-width="1.8"/>
            <circle cx="9" cy="11" r="1.5" fill="${primaryColor}" style="animation:sk-robotBlink 3s infinite;transform-origin:9px 11px"/>
            <circle cx="15" cy="11" r="1.5" fill="${primaryColor}" style="animation:sk-robotBlink 3s infinite;transform-origin:15px 11px"/>
            <line x1="9" y1="15" x2="15" y2="15" stroke="${primaryColor}" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="5" y1="10" x2="3.5" y2="10" stroke="${primaryColor}" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="19" y1="10" x2="20.5" y2="10" stroke="${primaryColor}" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;left:0;right:0;height:1.5px;background:${primaryColor};opacity:0.5;animation:sk-robotScan 2s ease-in-out infinite"></div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:#4c1d95">Skilloria AI</div>
          <div style="font-size:11px;color:${primaryColor};font-weight:500">Matching en cours · 847 profils analysés</div>
        </div>`
      lp.appendChild(header)

      const card = document.createElement('div')
      card.style.cssText = 'padding:12px;background:#faf5ff;border-radius:10px;border:1px solid #ede9fe;margin-bottom:12px'
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="animation:sk-spin 1.2s linear infinite;flex-shrink:0">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="#6d28d9" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div style="font-size:12px;font-weight:600;color:#4c1d95">Analyse des 40+ critères</div>
        </div>
        <div style="height:5px;background:#e9d5ff;border-radius:10px;overflow:hidden">
          <div id="sk-ib" style="height:100%;background:#6d28d9;width:0;border-radius:10px;transition:width 0.3s ease"></div>
        </div>`
      lp.appendChild(card)

      const na = document.createElement('div'); na.style.cssText = 'display:flex;flex-direction:column;gap:7px'
      lp.appendChild(na)
      const notifs = [
        { img: 'https://randomuser.me/api/portraits/men/32.jpg', name: 'Thomas B.', spec: 'D365 Finance · 7 ans', score: 97 },
        { img: 'https://randomuser.me/api/portraits/women/28.jpg', name: 'Camille R.', spec: 'Finance · 5 ans', score: 91 },
        { img: 'https://randomuser.me/api/portraits/men/55.jpg', name: 'Mehdi A.', spec: 'SCM · 6 ans', score: 86 },
      ]
      for (let i = 0; i < notifs.length; i++) {
        await sleep(500)
        const ib = document.getElementById('sk-ib') as HTMLElement
        if (ib) ib.style.width = ((i + 1) / notifs.length * 100) + '%'
        const n = notifs[i]
        const row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 11px;background:#fff;border-radius:9px;border:1px solid #e5e7eb;animation:sk-notifSlide 0.3s ease both'
        row.innerHTML = `<div style="width:30px;height:30px;border-radius:50%;overflow:hidden;border:2px solid #e5e7eb;flex-shrink:0"><img src="${n.img}" style="width:100%;height:100%;object-fit:cover" alt="${n.name}"/></div><div style="flex:1"><div style="font-size:12px;font-weight:600;color:#111827">${n.name}</div><div style="font-size:11px;color:#6b7280">${n.spec}</div></div><div style="font-size:13px;font-weight:700;color:#6d28d9;margin-right:4px">${n.score}%</div><div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:20px;padding:2px 8px;font-size:11px;color:#6d28d9;font-weight:600;white-space:nowrap">Notifié</div>`
        na.appendChild(row)
      }
      await sleep(280)
    }

    async function phase3(): Promise<HTMLElement[]> {
      await fadeTransition(); activateStep(3); setBar(60, 4000)
      const header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;animation:sk-fadeIn 0.3s ease both'
      header.innerHTML = `
        <div style="font-size:13px;font-weight:600;color:#111827">Candidatures reçues</div>
        <div style="display:flex">
          <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;border:2px solid #fff"><img src="https://randomuser.me/api/portraits/men/32.jpg" style="width:100%;height:100%;object-fit:cover" alt=""/></div>
          <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;border:2px solid #fff;margin-left:-8px"><img src="https://randomuser.me/api/portraits/women/28.jpg" style="width:100%;height:100%;object-fit:cover" alt=""/></div>
          <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;border:2px solid #fff;margin-left:-8px"><img src="https://randomuser.me/api/portraits/men/55.jpg" style="width:100%;height:100%;object-fit:cover" alt=""/></div>
        </div>`
      lp.appendChild(header)

      const candidates = [
        { img: 'https://randomuser.me/api/portraits/men/32.jpg', name: 'Thomas B.', spec: 'D365 Finance · 7 ans · Paris', tjm: '920€/j', dispo: 'Immédiate', score: 97, feat: true },
        { img: 'https://randomuser.me/api/portraits/women/28.jpg', name: 'Camille R.', spec: 'Finance · 5 ans · Remote', tjm: '850€/j', dispo: '15 mai', score: 91, feat: false },
        { img: 'https://randomuser.me/api/portraits/men/55.jpg', name: 'Mehdi A.', spec: 'SCM · 6 ans · Paris', tjm: '880€/j', dispo: '1er mai', score: 86, feat: false },
      ]
      const cards: HTMLElement[] = []
      for (let i = 0; i < candidates.length; i++) {
        await sleep(240)
        const c = candidates[i]
        const card = document.createElement('div'); card.className = 'sk-cand'
        card.innerHTML = `
          <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;border:2px solid #e5e7eb;flex-shrink:0">
            <img src="${c.img}" style="width:100%;height:100%;object-fit:cover" alt="${c.name}"/>
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
              <span style="font-size:13px;font-weight:600;color:#111827">${c.name}</span>
              ${c.feat ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#15803d"/><path d="M8 12l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
            </div>
            <div style="font-size:11px;color:#6b7280">${c.spec}</div>
            <div style="display:flex;gap:9px;margin-top:2px">
              <span style="font-size:11px;font-weight:500;color:#374151">${c.tjm}</span>
              <span style="font-size:11px;color:#6b7280">Dispo : ${c.dispo}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:15px;font-weight:700;color:#15803d">${c.score}%</div>
            <div style="font-size:10px;color:#9ca3af">match IA</div>
          </div>`
        lp.appendChild(card); cards.push(card)
      }
      await sleep(450); return cards
    }

    async function phase4(cards: HTMLElement[]) {
      activateStep(4); setBar(80, 2800)
      const header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;animation:sk-fadeIn 0.3s ease both'
      header.innerHTML = `
        <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;border:2px solid #fde68a;flex-shrink:0">
          <img src="https://randomuser.me/api/portraits/women/44.jpg" style="width:100%;height:100%;object-fit:cover" alt="Stéphanie M."/>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:#111827">Stéphanie M.</div>
          <div style="font-size:11px;color:#92400e;font-weight:500">Sélectionne le meilleur profil</div>
        </div>`
      lp.insertBefore(header, lp.firstChild)
      await sleep(240)
      await moveTo(cards[0], 440); cards[0].classList.add('sel')
      await clickEl(cards[0], 200); await sleep(120)
      const badge = document.createElement('div')
      badge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 13px;background:#fef9c3;border:1px solid #fde68a;border-radius:9px;margin-top:11px;animation:sk-fadeInUp 0.3s ease both'
      badge.innerHTML = `
        <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid #fde68a">
          <img src="https://randomuser.me/api/portraits/men/32.jpg" style="width:100%;height:100%;object-fit:cover" alt="Thomas B."/>
        </div>
        <span style="font-size:13px;font-weight:600;color:#92400e">Thomas B. choisi · Chat en cours d'ouverture…</span>`
      lp.appendChild(badge); await sleep(380)
    }

    async function phase5() {
      await fadeTransition(); activateStep(5); setBar(100, 5000)
      const h = document.createElement('div')
      h.style.cssText = 'font-size:11px;color:#9d174d;font-weight:600;margin-bottom:9px;text-transform:uppercase;letter-spacing:.04em'
      h.textContent = 'Chat · Stéphanie ↔ Thomas B.'; lp.appendChild(h)
      const cw = document.createElement('div')
      cw.style.cssText = 'background:#f8fafc;border-radius:11px;border:1px solid #e5e7eb;overflow:hidden;animation:sk-popIn 0.3s ease both'
      cw.innerHTML = `
        <div style="background:#fff;border-bottom:1px solid #e5e7eb;padding:10px 13px;display:flex;align-items:center;gap:9px">
          <div style="width:32px;height:32px;border-radius:50%;overflow:hidden;border:2px solid #fbcfe8;flex-shrink:0">
            <img src="https://randomuser.me/api/portraits/men/32.jpg" style="width:100%;height:100%;object-fit:cover" alt="Thomas B."/>
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;color:#111827">Thomas B.</div>
            <div style="display:flex;align-items:center;gap:4px">
              <div style="width:7px;height:7px;border-radius:50%;background:#22c55e;animation:sk-pulseGreen 2s infinite;flex-shrink:0"></div>
              <span style="font-size:11px;color:#6b7280">En ligne · Expert D365 Finance</span>
            </div>
          </div>
          <div style="background:#fce7f3;border:1px solid #fbcfe8;border-radius:6px;padding:3px 9px;font-size:11px;color:#9d174d;font-weight:600">Match 97%</div>
        </div>
        <div style="margin:9px 11px;background:#fff;border-radius:9px;border:1px solid #e5e7eb;padding:10px 12px">
          <div style="font-size:11px;color:#9d174d;font-weight:600;margin-bottom:4px">Mission partagée</div>
          <div style="font-size:12px;font-weight:600;color:#111827;margin-bottom:3px">Expert D365 Finance & Ops · 6 mois · Paris</div>
          <div style="font-size:11px;color:#6b7280;line-height:1.5;margin-bottom:5px">Migration D365 Finance — paramétrage comptabilité, clôtures mensuelles, formation utilisateurs.</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <span class="sk-tag" style="background:#dbeafe;color:#1d4ed8">D365</span>
            <span class="sk-tag" style="background:#dcfce7;color:#15803d">Finance</span>
            <span class="sk-tag" style="background:#f3f4f6;color:#374151">850€—1000€/j</span>
          </div>
        </div>`
      const ma = document.createElement('div'); ma.id = 'sk-ma'
      ma.style.cssText = 'padding:4px 11px;display:flex;flex-direction:column'; cw.appendChild(ma)
      const ir = document.createElement('div')
      ir.style.cssText = 'padding:9px 11px;border-top:1px solid #e5e7eb;display:flex;align-items:center;gap:8px;background:#fff'
      ir.innerHTML = `
        <div style="width:26px;height:26px;border-radius:50%;overflow:hidden;flex-shrink:0">
          <img src="https://randomuser.me/api/portraits/women/44.jpg" style="width:100%;height:100%;object-fit:cover" alt="Stéphanie M."/>
        </div>
        <div id="sk-ci" style="flex:1;background:#f9fafb;border:1px solid #e5e7eb;border-radius:20px;padding:7px 12px;font-size:12px;color:#111827;min-height:30px;transition:border-color 0.2s;white-space:pre-wrap;word-break:break-word"></div>
        <div id="sk-sb" style="width:28px;height:28px;border-radius:50%;background:#9d174d;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;opacity:0.35;transition:opacity 0.3s">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>`
      cw.appendChild(ir); lp.appendChild(cw)
      await sleep(280)
      const ci = document.getElementById('sk-ci') as HTMLElement
      const sb = document.getElementById('sk-sb') as HTMLElement
      await moveTo(ci, 300); ci.style.borderColor = '#9d174d'
      await clickEl(ci, 120)
      await typeIn(ci, 'Bonjour Thomas, disponible dès le 1er mai ? TJM 950€ confirmé.', 30)
      await sleep(130); sb.style.opacity = '1'
      await moveTo(sb, 250); await clickEl(sb, 150)
      ci.innerHTML = ''; ci.style.borderColor = '#e5e7eb'; sb.style.opacity = '0.35'
      const m1 = document.createElement('div'); m1.className = 'sk-msg'
      m1.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:7px'
      m1.innerHTML = `<div style="max-width:82%;padding:9px 11px;border-radius:11px 11px 2px 11px;background:#9d174d;color:#fff;font-size:12px;line-height:1.55">Bonjour Thomas, disponible dès le 1er mai ? TJM 950€ confirmé.</div>`
      ma.appendChild(m1); await sleep(250)
      const tw = document.createElement('div'); tw.style.cssText = 'display:flex;justify-content:flex-start;margin-bottom:7px'
      const tb = document.createElement('div'); tb.style.cssText = 'display:flex;align-items:center;gap:3px;padding:7px 11px;background:#f3f4f6;border-radius:11px 11px 11px 2px'
      for (let d = 0; d < 3; d++) { const dot = document.createElement('div'); dot.className = 'sk-td'; dot.style.animationDelay = (d * 0.15) + 's'; tb.appendChild(dot) }
      tw.appendChild(tb); ma.appendChild(tw); await sleep(800); tw.remove()
      const m2 = document.createElement('div'); m2.className = 'sk-msg'
      m2.style.cssText = 'display:flex;justify-content:flex-start;margin-bottom:7px'
      m2.innerHTML = `<div style="max-width:82%;padding:9px 11px;border-radius:11px 11px 11px 2px;background:#f3f4f6;color:#374151;font-size:12px;line-height:1.55">Confirmé pour le 1er mai, 950€/j. J'envoie CV et références ce soir !</div>`
      ma.appendChild(m2); await sleep(350)
    }

    let running = true
    async function loop() {
      while (running) {
        resetAll()
        await phase1(); await sleep(180)
        await phase2(); await sleep(180)
        const cards = await phase3(); await sleep(180)
        await phase4(cards); await sleep(300)
        await phase5(); await sleep(600)
      }
    }
    loop()
    return () => { running = false; container.innerHTML = '' }
  }, [primaryColor, domainName])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 540,
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.06)',
        border: '1px solid #e5e7eb',
        background: '#f8fafc',
        position: 'relative',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    />
  )
}
