/* Pulse, the Pulsefy mascot. Inline SVG + CSS, no deps, ASCII-only source.
   PulseMascot.mount(el, {size, mood, message, side}) -> {say, react, setMood}
   PulseMascot.scan(root)      mounts [data-pulse-mascot="<mood>"] (+ data-size, data-msg)
   PulseMascot.celebrate(msg)  non-blocking cheer pop-up, gone after ~2.5s
   Moods: idle | party | sleepy | cheer. side: top | left | bottom (speech bubble) */
(function () {
  'use strict';
  if (window.PulseMascot) return;
  var mq = function (q) { return window.matchMedia ? matchMedia(q) : {}; };
  var RM = mq('(prefers-reduced-motion: reduce)'), FINE = mq('(hover:hover) and (pointer:fine)');
  var uid = 0, live = [], cssDone = 0, ptrOn = 0;
  var REACT = [['dance', 'Dance with me! \uD83D\uDC83'], ['party', 'Party mode \uD83D\uDE0E'], ['wave', 'High five! \u270B'], ['spin', 'Wheee! \uD83C\uDF00']];
  var COLS = ['#FF6B00', '#FF2D88', '#00EEFF', '#6EFF47', '#CC44FF', '#FFD84D'];
  var K = '@keyframes pm';

  var CSS =
'.pm-w{position:relative;display:inline-flex;flex-direction:column;align-items:center;gap:8px;vertical-align:middle}.pm-left{flex-direction:row}.pm-bottom{flex-direction:column-reverse}' +
'.pm{position:relative;display:block;flex-shrink:0;width:var(--s);height:calc(var(--s)*1.067);min-width:44px;min-height:44px;padding:0;margin:0;border:0;background:none;cursor:pointer;perspective:520px;touch-action:manipulation;-webkit-tap-highlight-color:transparent;border-radius:40%}' +
'.pm:focus-visible{outline:2px solid #00EEFF;outline-offset:4px}' +
'.pm-t,.pm-sp,.pm-br,.pm-j,.pm svg{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:visible}.pm-t,.pm-sp{transform-style:preserve-3d}.pm-t{transition:transform .3s ease-out}' +
'.pm-br,.pm-j,.pm-sp{transform-origin:50% 92%}.pm-br{animation:pmBr 3s ease-in-out infinite alternate}' +
'.pm-sh,.pm-ring,.pm-z{position:absolute;display:block}' +
'.pm-sh{left:18%;right:18%;bottom:0;height:12%;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.6),transparent),radial-gradient(closest-side,rgba(204,68,255,.45),transparent);animation:pmSh 3s ease-in-out infinite alternate}' +
'.pm-ring{left:8%;top:17%;width:84%;height:79%;border-radius:50%;border:3px solid #00EEFF;box-shadow:0 0 14px #00EEFF;opacity:0}.pm-ring+.pm-ring{border-color:#FF2D88;box-shadow:0 0 14px #FF2D88}' +
'.pm svg g{transform-box:view-box}.pm-al{transform-origin:30px 68px}.pm-ar{transform-origin:90px 68px}.pm-al,.pm-ar{transition:transform .3s}' +
'.pm-eo{transform-origin:60px 58px}.pm.bl .pm-eo{transform:scaleY(.1)}.pm-wv{transform-origin:60px 93px}' +
'.pm-sg{opacity:0;transform:translateY(-34px);transition:transform .4s cubic-bezier(.3,1.6,.5,1),opacity .2s}.pm.sg .pm-sg{opacity:1;transform:none}' +
'.pm-eh,.pm-ez,.pm-m2,.pm-m3,.pm-z,.pm[data-mood=cheer] .pm-eo,.pm[data-mood=sleepy]:not(.on) .pm-eo,.pm.on .pm-m1,.pm[data-mood=cheer] .pm-m1,.pm[data-mood=party] .pm-m1,.pm[data-mood=sleepy] .pm-m1{display:none}' +
'.pm[data-mood=cheer] .pm-eh,.pm[data-mood=sleepy]:not(.on) .pm-ez,.pm.on .pm-m2,.pm[data-mood=cheer] .pm-m2,.pm[data-mood=party] .pm-m2,.pm[data-mood=sleepy]:not(.on) .pm-m3{display:inline}' +
'.pm[data-mood=cheer] .pm-al{transform:rotate(118deg)}.pm[data-mood=cheer] .pm-ar{transform:rotate(-118deg)}.pm.r-wave .pm-ar{transform:rotate(-125deg)}' +
'.pm[data-mood=party] .pm-br{animation-duration:.46s}.pm[data-mood=sleepy] .pm-br{animation-duration:4.6s}' +
'.pm.on .pm-wl{stroke:#E9FF8A}.pm.on .pm-wg{stroke:#6EFF47}' +
'.pm[data-mood=sleepy]:not(.on) .pm-z{display:block;right:2%;top:4%;font:800 calc(var(--s)*.16)/1 Syne,sans-serif;color:#B9A6FF;opacity:0;animation:pmZ 2.8s ease-out infinite}' +
'.pm-z+.pm-z{right:-10%!important;top:-8%!important;font-size:calc(var(--s)*.12)!important;animation-delay:1.4s!important}' +
'.pm.on .pm-j,.pm.on .pm-sh{animation:pmJ .75s cubic-bezier(.3,.7,.4,1)}.pm.on .pm-sh{animation-name:pmShJ}' +
'.pm.on .pm-ring{animation:pmRing .7s ease-out}.pm.on .pm-ring+.pm-ring{animation-delay:.12s}.pm.on .pm-wv{animation:pmSpk .5s ease-out 2}' +
'.pm.r-dance .pm-sp{animation:pmDn .85s ease-in-out}.pm.r-dance .pm-al{animation:pmAL .85s ease-in-out}.pm.r-dance .pm-ar{animation:pmAR .85s ease-in-out}' +
'.pm.r-spin .pm-sp{animation:pmSp .8s cubic-bezier(.5,0,.3,1)}.pm.r-wave .pm-ar{animation:pmWv 1s ease-in-out}' +
'.pm-p{position:absolute;left:50%;top:44%;pointer-events:none;font:800 15px/1 Syne,sans-serif;animation:pmP .95s cubic-bezier(.15,.7,.35,1) forwards}.pm-p.c{width:6px;height:10px;border-radius:2px}' +
'.pm-say{position:relative;z-index:2;max-width:190px;padding:7px 12px;border-radius:14px;background:#F4EDFF;color:#1A0933;font:700 .72rem/1.3 Syne,sans-serif;text-align:center;box-shadow:0 6px 18px rgba(10,0,30,.45);animation:pmSay .3s cubic-bezier(.3,1.5,.5,1)}' +
'.pm-say::after{content:"";position:absolute;left:50%;bottom:-5px;width:10px;height:10px;margin-left:-5px;background:inherit;transform:rotate(45deg);border-radius:2px}' +
'.pm-left .pm-say::after{left:auto;right:-5px;bottom:50%;margin:0 0 -5px}.pm-bottom .pm-say::after{bottom:auto;top:-5px}' +
'.pm-cel{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 110px);z-index:4500;opacity:0;transform:translate(-50%,-14px) scale(.6);transition:transform .4s cubic-bezier(.3,1.5,.5,1),opacity .25s}' +
'.pm-cel,.pm-cel *{pointer-events:none!important}.pm-cel.in{opacity:1;transform:translate(-50%,0)}.pm-cel.out{opacity:0;transform:translate(-50%,-10px) scale(.92)}' +
'.pm-cel::before{content:"";position:absolute;left:50%;top:0;width:200px;height:200px;margin-left:-100px;background:radial-gradient(closest-side,rgba(176,38,255,.4),transparent)}' +
K + 'Br{from{transform:scale(1.02,.975)}to{transform:translateY(-3%) scale(.985,1.02)}}' +
K + 'Sh{from{transform:scale(1.04)}to{transform:scale(.9);opacity:.8}}' +
K + 'J{14%{transform:scale(1.16,.8)}40%{transform:translateY(-30%) scale(.9,1.12)}58%{transform:translateY(-32%)}80%{transform:scale(1.12,.86)}92%{transform:scale(.97,1.03)}}' +
K + 'ShJ{14%{transform:scale(1.15)}40%,58%{transform:scale(.5);opacity:.35}80%{transform:scale(1.1)}}' +
K + 'Ring{0%{opacity:.9;transform:scale(.7)}to{opacity:0;transform:scale(1.75)}}' +
K + 'Spk{40%{transform:scale(1.06,1.9)}}' +
K + 'Dn{20%{transform:rotate(-13deg) translateX(-4%)}45%{transform:rotate(12deg) translateX(4%)}70%{transform:rotate(-9deg)}88%{transform:rotate(5deg)}}' +
K + 'AL{20%,70%{transform:rotate(118deg)}45%,88%{transform:rotate(15deg)}}' +
K + 'AR{20%,70%{transform:rotate(-15deg)}45%,88%{transform:rotate(-118deg)}}' +
K + 'Sp{to{transform:rotateY(360deg)}}' +
K + 'Wv{0%{transform:none}25%,75%{transform:rotate(-140deg)}50%,to{transform:rotate(-108deg)}}' +
K + 'P{0%{opacity:1;transform:translate(-50%,-50%) scale(.3)}65%{opacity:1;transform:translate(calc(var(--x) - 50%),calc(var(--y) - 50%)) rotate(var(--r))}to{opacity:0;transform:translate(calc(var(--x)*1.15 - 50%),calc(var(--y) - 50% + 26px)) rotate(var(--r)) scale(.9)}}' +
K + 'Z{30%{opacity:1}to{opacity:0;transform:translate(40%,-120%)}}' +
K + 'Say{from{opacity:0;transform:scale(.7)}}' +
'@media (prefers-reduced-motion:reduce){.pm *,.pm-say,.pm-cel{animation:none!important;transition:none!important}.pm[data-mood=sleepy]:not(.on) .pm-z{opacity:1}}';

  // "P" ids get a per-instance prefix so gradient refs never resolve into a hidden copy.
  var D = '#1A0933';
  // Gradients: id|r(adial) or l(inear)|attrs|stops "offset colour [opacity]"
  var GR = ['b|r|cx=".38" cy=".3" r=".8"|0 #F7E2FF,.16 #DB88FF,.48 #A321F2,.82 #5A0FAE,1 #2A0960',
    'o|r|cx=".9" cy=".86" r=".55"|0 #FF7A1A .95,.55 #FF2D88 .35,1 #FF2D88 0', 'c|r|cx=".05" cy=".72" r=".45"|0 #00EEFF .85,1 #00EEFF 0',
    'h|l|x2="0" y2="1"|0 #fff .95,1 #fff 0', 'k|r|cy=".3" r=".75"|0 #341266,1 #0E0424', 'e|l|x2="0" y2="1"|0 #FFC27A,.45 #FF6B00,1 #B83A00',
    'f|l|x2="0" y2="1"|0 #9A3BF0,1 #2E0A66', 'g|l|x2="1" y2="1"|0 #FF2D88 .9,.4 #16052A,.8 #0B0418,1 #00C8E0', 'w|r|cx=".42" cy=".35" r=".7"|0 #fff,1 #DCCFF5'
  ].map(function (g) {
    g = g.split('|');
    var t = (g[1] === 'r' ? 'radial' : 'linear') + 'Gradient';
    return '<' + t + ' id="P' + g[0] + '" ' + g[2] + '>' + g[3].split(',').map(function (s) {
      s = s.split(' ');
      return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] ? ' stop-opacity="' + s[2] + '"' : '') + '/>';
    }).join('') + '</' + t + '>';
  }).join('');
  var SVG =
'<svg viewBox="0 0 120 128" aria-hidden="true" focusable="false"><defs>' + GR +
'<ellipse id="Pa" cx="60" cy="70" rx="44" ry="41"/><path id="Pn" d="M17 64C14 12 106 12 103 64"/><path id="Pv" d="M41 93h8l3-5 4 11 4-16 4 18 3-11 2 3h11"/></defs>' +
// headphone band, arms, feet (behind the body)
'<g fill="none" stroke-linecap="round"><use href="#Pn" stroke="#4B1C99" stroke-width="7"/><use href="#Pn" stroke="#B98CFF" stroke-width="1.8"/></g>' +
'<g class="pm-al"><ellipse cx="17" cy="91" rx="7.5" ry="11" transform="rotate(38 17 91)" fill="url(#Pb)"/></g>' +
'<g class="pm-ar"><ellipse cx="103" cy="91" rx="7.5" ry="11" transform="rotate(-38 103 91)" fill="url(#Pb)"/></g>' +
'<g fill="url(#Pf)"><ellipse cx="45" cy="111" rx="11" ry="7.5"/><ellipse cx="75" cy="111" rx="11" ry="7.5"/></g>' +
// glossy body: base shading + orange and cyan club-light rims + specular + disco glints
'<use href="#Pa" fill="url(#Pb)"/><use href="#Pa" fill="url(#Po)"/><use href="#Pa" fill="url(#Pc)"/>' +
'<ellipse cx="41" cy="41" rx="15" ry="8" transform="rotate(-28 41 41)" fill="url(#Ph)" opacity=".8"/><circle cx="28" cy="55" r="2.4" fill="#fff" opacity=".7"/>' +
'<path d="M91 39l1.2 3.3 3.3 1.2-3.3 1.2L91 48l-1.2-3.3-3.3-1.2 3.3-1.2zm4 45l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="#fff" opacity=".85"/>' +
// belly speaker with heartbeat wave
'<ellipse cx="60" cy="93" rx="22" ry="10.5" fill="url(#Pk)" stroke="#fff" stroke-opacity=".16"/>' +
'<g class="pm-wv" fill="none" stroke-linejoin="round" stroke-linecap="round"><use class="pm-wg" href="#Pv" stroke="#00EEFF" stroke-opacity=".35" stroke-width="4.5"/><use class="pm-wl" href="#Pv" stroke="#C8FCFF" stroke-width="1.7"/></g>' +
'<g fill="#FF2D88" opacity=".55"><ellipse cx="32" cy="73" rx="6" ry="3.4"/><ellipse cx="88" cy="73" rx="6" ry="3.4"/></g>' +
// face: open eyes (blink + pointer-tracking pupils), happy / sleepy eyes, three mouths
'<g class="pm-eo"><ellipse id="Pi" cx="46" cy="58" rx="10" ry="12" fill="url(#Pw)"/><use href="#Pi" x="28"/>' +
'<g class="pm-pu"><g id="Pq"><ellipse cx="47" cy="60" rx="6.8" ry="8.2" fill="' + D + '"/><circle cx="49.6" cy="56.2" r="2.7" fill="#fff"/><circle cx="45" cy="63.6" r="1.2" fill="#fff" opacity=".8"/></g><use href="#Pq" x="28"/></g></g>' +
'<g fill="none" stroke="' + D + '" stroke-width="3.4" stroke-linecap="round"><path class="pm-eh" d="M38 61q8-10 16 0m12 0q8-10 16 0"/><path class="pm-ez" d="M38 59q8 7 16 0m12 0q8 7 16 0"/><path class="pm-m1" d="M54 74q6 6 12 0" stroke-width="2.8"/></g>' +
'<g class="pm-m2"><path d="M52 72h16q-1.2 9.5-8 9.5t-8-9.5z" fill="' + D + '"/><ellipse cx="60" cy="79" rx="4" ry="2" fill="#FF4F8B"/></g><ellipse class="pm-m3" cx="60" cy="75" rx="2.6" ry="3" fill="' + D + '"/>' +
// ear cups
'<g id="Pu"><rect x="8" y="50" width="15" height="25" rx="7.5" fill="url(#Pe)"/><rect x="11" y="53" width="4" height="11" rx="2" fill="#fff" opacity=".55"/><circle cx="15.5" cy="69" r="1.7" fill="#00EEFF"/></g><use href="#Pu" x="89"/>' +
// party shades
'<g class="pm-sg"><path d="M23 56h10m54 0h10" stroke="#0B0418" stroke-width="2.4"/><rect id="Pl" x="32" y="49" width="26" height="18" rx="7" fill="url(#Pg)" stroke="#0B0418" stroke-width="2"/><use href="#Pl" x="30"/>' +
'<path d="M57 55q3-3 6 0" fill="none" stroke="#0B0418" stroke-width="2.4"/><path d="M37 62l7-9m-1 10l4-5m20 4l7-9m-1 10l4-5" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/></g></svg>';

  function css() {
    if (cssDone) return;
    cssDone = 1;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function burst(btn, count) {
    if (RM.matches) return;
    for (var i = 0; i < count; i++) {
      var p = document.createElement('span'), a = i / count * 6.283 + Math.random() * .5, d = 46 + Math.random() * 34;
      p.className = 'pm-p' + (i % 3 ? ' c' : '');
      if (i % 3) p.style.background = COLS[i % 6];
      else { p.textContent = i % 2 ? '\u266B' : '\u266A'; p.style.color = COLS[i % 6]; }
      p.style.setProperty('--x', (Math.cos(a) * d).toFixed(1) + 'px');
      p.style.setProperty('--y', (Math.sin(a) * d * .85 - 18).toFixed(1) + 'px');
      p.style.setProperty('--r', (Math.random() * 360 - 180).toFixed(0) + 'deg');
      btn.appendChild(p);
      setTimeout(p.remove.bind(p), 1000);
    }
  }

  function mount(el, o) {
    if (!el) return null;
    if (el._pm) return el._pm;
    live = live.filter(function (i) { return i.el.isConnected; }); // drop detached instances (blink prune is off under reduced motion)
    css();
    o = o || {};
    var ds = el.dataset || {}, P = 'pm' + (++uid), n = 0, tOn, tSay, tSg;
    var msg = o.message != null ? o.message : (ds.msg || '');
    el.textContent = '';
    var w = document.createElement('span');
    w.className = 'pm-w pm-' + (o.side || ds.side || 'top');
    w.innerHTML = '<span class="pm-say" hidden></span><button type="button" class="pm" aria-label="Pulse, the Pulsefy mascot \u2014 tap me">' +
      '<span class="pm-sh"></span><span class="pm-ring"></span><span class="pm-ring"></span><span class="pm-z">z</span><span class="pm-z">Z</span>' +
      '<span class="pm-t"><span class="pm-sp"><span class="pm-br"><span class="pm-j">' +
      SVG.replace(/(id="|#)P/g, '$1' + P) + '</span></span></span></span></button>';
    el.appendChild(w);
    var btn = w.lastChild, say = w.firstChild;
    btn.style.setProperty('--s', (+o.size || +ds.size || 96) + 'px');
    var inst = {
      el: w, btn: btn,
      setMood: function (m) {
        inst.mood = /^(party|sleepy|cheer)$/.test(m) ? m : 'idle';
        btn.dataset.mood = inst.mood;
        btn.classList.toggle('sg', inst.mood === 'party');
        return inst;
      },
      say: function (text, ms) {
        clearTimeout(tSay);
        say.hidden = !text;
        if (!text) return inst;
        say.textContent = text;
        say.style.animation = 'none'; void say.offsetWidth; say.style.animation = '';
        if (ms) tSay = setTimeout(function () { inst.say(msg); }, ms);
        return inst;
      },
      react: function (kind) {
        var r = kind ? [kind] : REACT[n++ % REACT.length];
        btn.className = 'pm' + (btn.classList.contains('sg') ? ' sg' : '');
        void btn.offsetWidth;
        btn.classList.add('on', 'r-' + r[0]);
        if (r[0] === 'party') {
          btn.classList.add('sg');
          clearTimeout(tSg);
          tSg = setTimeout(function () { if (inst.mood !== 'party') btn.classList.remove('sg'); }, 6000);
        }
        if (r[1]) inst.say(r[1], 1700);
        burst(btn, kind === 'burst' ? 16 : 10);
        clearTimeout(tOn);
        tOn = setTimeout(function () { btn.classList.remove('on', 'r-' + r[0]); }, 1050);
        return inst;
      }
    };
    btn.addEventListener('click', function () { inst.react(); });
    inst.setMood(o.mood || ds.pulseMascot);
    inst.say(msg);
    el._pm = inst;
    live.push(inst);
    blink(inst);
    if (FINE.matches && !RM.matches && !ptrOn) {
      ptrOn = 1;
      addEventListener('pointermove', onPtr, { passive: true });
    }
    return inst;
  }

  // Occasional blink via a class toggle, so idle never repaints the SVG every frame.
  function blink(inst) {
    if (RM.matches) return;
    setTimeout(function () {
      if (!inst.el.isConnected) { live.splice(live.indexOf(inst), 1); return; }
      if (!document.hidden && inst.mood !== 'sleepy') {
        inst.btn.classList.add('bl');
        setTimeout(function () { inst.btn.classList.remove('bl'); }, 140);
      }
      blink(inst);
    }, 2400 + Math.random() * 3600);
  }

  // Desktop only: tilt toward the pointer, pupils follow it.
  var raf = 0, px = 0, py = 0;
  function onPtr(e) { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(tilt); }
  function tilt() {
    raf = 0;
    live.forEach(function (inst) {
      var r = inst.btn.getBoundingClientRect();
      if (!r.width) return;
      var dx = Math.max(-1, Math.min(1, (px - r.left - r.width / 2) / 320));
      var dy = Math.max(-1, Math.min(1, (py - r.top - r.height / 2) / 320));
      inst.btn.querySelector('.pm-t').style.transform = 'rotateY(' + (dx * 18).toFixed(1) + 'deg) rotateX(' + (-dy * 12).toFixed(1) + 'deg)';
      inst.btn.querySelector('.pm-pu').style.transform = 'translate(' + (dx * 2.4).toFixed(2) + 'px,' + (dy * 2.2).toFixed(2) + 'px)';
    });
  }

  function scan(root) {
    var els = (root || document).querySelectorAll('[data-pulse-mascot]');
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }

  function celebrate(message) {
    css();
    var host = document.createElement('div');
    host.className = 'pm-cel';
    host.setAttribute('role', 'status');
    document.body.appendChild(host);
    var inst = mount(host, { size: 92, mood: 'cheer', message: message || 'Yebo! \uD83C\uDF89', side: 'bottom' });
    inst.btn.tabIndex = -1;
    inst.btn.setAttribute('aria-hidden', 'true');
    requestAnimationFrame(function () { requestAnimationFrame(function () { host.classList.add('in'); }); });
    setTimeout(function () { inst.react('burst'); }, 180);
    setTimeout(function () { host.classList.remove('in'); host.classList.add('out'); }, 2500);
    setTimeout(function () { host.remove(); }, 2900);
    return inst;
  }

  window.PulseMascot = { mount: mount, scan: scan, celebrate: celebrate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); });
  else scan();
})();
