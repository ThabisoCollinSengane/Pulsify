/* Lumi for partners — the dashboard assistant for organizers and businesses.
 * Shared by /organizer and /business. Talks to POST /api/siza/partner-chat.
 *
 *   LumiPartner.init({ role: 'organizer' | 'business', getToken: async () => jwt, userId })
 *
 * The conversation lives in localStorage per user (7 days), so closing the sheet or
 * reloading the dashboard keeps it. Styling follows the landing-page Lumi sheet and
 * the dashboards' CSS variables. */
(function () {
  'use strict';
  if (window.LumiPartner) return;

  const KEEP_MS = 7 * 24 * 3600 * 1000;
  const SPARK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="pointer-events:none"><path d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8Z" fill="white"/></svg>';
  const SUGGEST = {
    organizer: ['How are my ticket sales?', 'How do I scan tickets at the door?', 'Tips to sell out my next event', 'When do I get paid?'],
    business: ['How do pickup orders work?', 'Ideas for a Squad Deal', 'How do I add menu items?', 'When do I get paid?'],
  };

  let cfg = null, msgs = [], busy = false, storeKey = 'lumi_partner';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function format(text) {
    const t = String(text || '')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '• ')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2');
    let h = esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*+/g, '');
    h = h.replace(/(https?:\/\/[^\s<>"]+)/g, m => {
      const raw = m.replace(/&amp;/g, '&');
      const url = raw.replace(/[.,!?;:)]+$/, '');
      const trail = raw.slice(url.length);
      let u; try { u = new URL(url); } catch (e) { return m; }
      const label = /(^|\.)pulsefy\.co\.za$/.test(u.hostname) && u.searchParams.get('ev') ? '🎟 View event →' : esc(url);
      return `<a href="${esc(url)}" target="_blank" rel="noopener" class="lp-link">${label}</a>${esc(trail)}`;
    });
    return h.replace(/\n/g, '<br>');
  }

  function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(msgs.slice(-40)));
      localStorage.setItem(storeKey + '_ts', String(Date.now()));
    } catch (e) {}
  }
  function load() {
    try {
      const ts = +localStorage.getItem(storeKey + '_ts') || 0;
      if (Date.now() - ts > KEEP_MS) return [];
      const m = JSON.parse(localStorage.getItem(storeKey) || '[]');
      return Array.isArray(m) ? m.filter(x => x && typeof x.text === 'string') : [];
    } catch (e) { return []; }
  }

  function injectStyles() {
    const css = `
.lp-fab{position:fixed;right:14px;bottom:calc(var(--bh,70px) + 14px + env(safe-area-inset-bottom,0px));z-index:850;width:46px;height:46px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#FF5C00,#FF2D78);box-shadow:0 6px 22px rgba(255,92,0,.45);display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;transition:opacity .2s,transform .2s}
.lp-fab.lp-hide{opacity:0;transform:scale(.6);pointer-events:none}
/* Room at the end of each scroll area so the last row/button can scroll clear of the Lumi button */
html.lp-on-business .panel{padding-bottom:72px}
html.lp-on-organizer body{padding-bottom:calc(var(--bh,70px) + env(safe-area-inset-bottom,0px) + 88px)!important}
.lp-fab:focus-visible{outline:2px solid #fff;outline-offset:3px}
.lp-fab svg{width:20px;height:20px}
.lp-sheet{position:fixed;top:0;left:0;right:0;bottom:0;z-index:4500;display:none;flex-direction:column;background:var(--bg,#160C32);color:var(--tx,#F4EDFF);font-family:'DM Sans',sans-serif;transition:transform .3s ease;transform:translateY(100%)}
@media (min-width:760px){.lp-sheet{left:auto;width:420px;border-left:1px solid var(--border,rgba(168,108,255,.16));box-shadow:-12px 0 40px rgba(0,0,0,.35)}}
.lp-head{display:flex;align-items:center;gap:12px;padding:calc(14px + env(safe-area-inset-top,0px)) 18px 12px;border-bottom:1px solid var(--border,rgba(168,108,255,.16));flex-shrink:0}
.lp-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#FF5C00,#FF2D78);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.lp-title{font-family:'Syne',sans-serif;font-weight:700;font-size:.92rem}
.lp-sub{font-size:.72rem;color:var(--mu,#8575AE)}
.lp-new{background:none;border:1px solid var(--border,rgba(168,108,255,.16));color:var(--mu2,#B09CC8);font-size:.7rem;border-radius:14px;cursor:pointer;padding:5px 11px;font-family:'Syne',sans-serif;font-weight:700}
.lp-x{background:none;border:none;color:var(--mu2,#B09CC8);font-size:1.3rem;cursor:pointer;padding:4px 6px;line-height:1}
.lp-msgs{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.lp-row{display:flex}
.lp-row.in{justify-content:flex-end}
.lp-b{max-width:84%;padding:11px 14px;font-size:.86rem;line-height:1.5;overflow-wrap:anywhere}
.lp-row.out .lp-b{background:var(--surf,#241652);border-radius:4px 18px 18px 18px}
.lp-row.in .lp-b{background:var(--or,#FF6B00);color:#fff;border-radius:18px 4px 18px 18px}
.lp-link{color:var(--or,#FF6B00);font-weight:600;text-decoration:none}
.lp-row.in .lp-link{color:#fff;text-decoration:underline}
.lp-typing{display:inline-flex;gap:4px;align-items:center}
.lp-typing i{width:6px;height:6px;border-radius:50%;background:var(--mu2,#B09CC8);animation:lpdot 1.2s infinite ease-in-out}
.lp-typing i:nth-child(2){animation-delay:.15s}.lp-typing i:nth-child(3){animation-delay:.3s}
@keyframes lpdot{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.lp-chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 18px 10px}
.lp-chip{background:rgba(255,92,0,.08);border:1px solid rgba(255,92,0,.25);color:var(--tx,#F4EDFF);font-size:.76rem;border-radius:50px;padding:7px 12px;cursor:pointer;font-family:'DM Sans',sans-serif}
.lp-inrow{padding:12px 14px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--border,rgba(168,108,255,.16));display:flex;gap:8px;flex-shrink:0}
.lp-in{flex:1;min-width:0;padding:11px 14px;border-radius:24px;border:1px solid var(--border,rgba(168,108,255,.16));background:var(--surf,#241652);color:var(--tx,#F4EDFF);font-size:16px;outline:none;font-family:'DM Sans',sans-serif}
.lp-in:focus{border-color:var(--or,#FF6B00)}
.lp-send{width:42px;height:42px;border-radius:50%;background:var(--or,#FF6B00);border:none;color:#fff;font-size:1.05rem;cursor:pointer;flex-shrink:0}
.lp-send:disabled{opacity:.5;cursor:default}
@media (prefers-reduced-motion:reduce){.lp-sheet,.lp-fab{transition:none}.lp-typing i{animation:none}}`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function el(id) { return document.getElementById(id); }

  function render() {
    const box = el('lp-msgs');
    if (!box) return;
    box.innerHTML = msgs.map(m => `<div class="lp-row ${m.dir === 'in' ? 'in' : 'out'}"><div class="lp-b">${format(m.text)}</div></div>`).join('')
      + (busy ? '<div class="lp-row out"><div class="lp-b"><span class="lp-typing" aria-label="Lumi is typing"><i></i><i></i><i></i></span></div></div>' : '');
    box.scrollTop = box.scrollHeight;
    const chips = el('lp-chips');
    if (chips) chips.style.display = msgs.length <= 1 && !busy ? 'flex' : 'none';
  }

  function greeting() {
    return cfg.role === 'business'
      ? "Lumi here 👋 I can help you run your spot on Pulsify — orders, menu, deals, promos and payouts. What do you need?"
      : "Lumi here 👋 I can help with your events — sales, check-in, promotion and payouts. What do you need?";
  }

  function build() {
    const fab = document.createElement('button');
    fab.className = 'lp-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Ask Lumi');
    fab.innerHTML = SPARK;
    fab.onclick = open;
    document.body.appendChild(fab);
    document.documentElement.classList.add('lp-on-' + cfg.role);
    // Tuck the button away while a form field outside Lumi is focused (keyboard up, button would cover inputs)
    const isField = t => t && t.matches && t.matches('input,textarea,select') && !t.closest('.lp-sheet');
    document.addEventListener('focusin', e => { if (isField(e.target)) fab.classList.add('lp-hide'); });
    document.addEventListener('focusout', e => { if (isField(e.target)) fab.classList.remove('lp-hide'); });

    const sheet = document.createElement('div');
    sheet.className = 'lp-sheet';
    sheet.id = 'lp-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Lumi assistant');
    sheet.innerHTML = `
      <div class="lp-head">
        <div class="lp-av">${SPARK}</div>
        <div style="flex:1;min-width:0"><div class="lp-title">Lumi</div><div class="lp-sub">Your ${cfg.role === 'business' ? 'business' : 'organizer'} assistant</div></div>
        <button type="button" class="lp-new" id="lp-new">New chat</button>
        <button type="button" class="lp-x" id="lp-x" aria-label="Close Lumi">✕</button>
      </div>
      <div class="lp-msgs" id="lp-msgs" aria-live="polite"></div>
      <div class="lp-chips" id="lp-chips">${(SUGGEST[cfg.role] || SUGGEST.organizer).map(q => `<button type="button" class="lp-chip">${esc(q)}</button>`).join('')}</div>
      <div class="lp-inrow">
        <input id="lp-in" class="lp-in" maxlength="1000" placeholder="Ask about your ${cfg.role === 'business' ? 'business' : 'events'}…" autocomplete="off"/>
        <button type="button" class="lp-send" id="lp-send" aria-label="Send">↑</button>
      </div>`;
    document.body.appendChild(sheet);

    el('lp-x').onclick = close;
    el('lp-new').onclick = () => { msgs = [{ dir: 'out', text: greeting() }]; save(); render(); };
    el('lp-send').onclick = () => send();
    el('lp-in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    sheet.querySelectorAll('.lp-chip').forEach(b => { b.onclick = () => send(b.textContent); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.style.display === 'flex') close(); });
  }

  function open() {
    const sheet = el('lp-sheet');
    if (!msgs.length) { msgs = load(); if (!msgs.length) msgs = [{ dir: 'out', text: greeting() }]; }
    sheet.style.display = 'flex';
    requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });
    render();
    setTimeout(() => { const i = el('lp-in'); if (i && window.matchMedia('(min-width:760px)').matches) i.focus(); }, 320);
  }
  function close() {
    const sheet = el('lp-sheet');
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => { sheet.style.display = 'none'; }, 300);
  }

  async function send(preset) {
    const input = el('lp-in');
    const text = String(preset || input.value || '').trim();
    if (!text || busy) return;
    input.value = '';
    const history = msgs.slice(-8);
    msgs.push({ dir: 'in', text });
    busy = true; el('lp-send').disabled = true;
    save(); render();
    let reply;
    try {
      const token = await cfg.getToken();
      const r = await fetch('/api/siza/partner-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ message: text, history }),
      });
      const j = await r.json().catch(() => ({}));
      reply = j.reply || j.error || "Something went wrong — try again in a moment.";
    } catch (e) {
      reply = "I can't connect right now — check your connection and try again.";
    }
    busy = false; el('lp-send').disabled = false;
    msgs.push({ dir: 'out', text: reply });
    save(); render();
  }

  window.LumiPartner = {
    init(options) {
      if (cfg || !options || typeof options.getToken !== 'function') return;
      cfg = { role: options.role === 'business' ? 'business' : 'organizer', getToken: options.getToken };
      storeKey = 'lumi_partner_' + (options.userId || 'me');
      injectStyles();
      build();
    },
    open() { if (cfg) open(); },
  };
})();
