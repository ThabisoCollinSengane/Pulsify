// Server-rendered, crawlable pages: /durban, /durban/:slug, /e/:id, /sitemap.xml.
// Routed from api/index.js; vercel.json rewrites these paths to /api.
// No client JS — everything a crawler needs is in the HTML.

const SITE  = 'https://pulsefy.co.za';
const CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';
const KZN_CITIES = ['Durban', 'Pietermaritzburg', 'Umhlanga'];
// Durban metro + nearby coast, matched against venue city (single words: used in PostgREST or()).
// Ambiguous names (berea, phoenix, glenwood) left out — they match other cities' suburbs.
const DURBAN_AREAS = ['durban', 'umhlanga', 'umlazi', 'kwamashu', 'pinetown', 'westville', 'ballito',
  'amanzimtoti', 'morningside', 'chatsworth', 'inanda', 'ethekwini'];
const EV_COLS = 'id,name,date_local,time_local,venue_name,venue_city,venue_address,venue_province,price_min,is_free,image_url,genre,description,external_url,source,status,organiser_name,updated_at';

/* ─── escaping / text ─────────────────────────────────── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ld  = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')}</script>`;
const safeUrl = u => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');
// Strip HTML to plain text paragraphs.
function paras(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split(/\n+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const plain = html => paras(html).join(' ');

/* ─── dates (SAST = UTC+2, no DST) ────────────────────── */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sastNow = () => new Date(Date.now() + 2 * 3600e3);   // read with getUTC*
const ymd = d => d.toISOString().slice(0, 10);
const sastToday = () => ymd(sastNow());

// { date:'YYYY-MM-DD', time:'HH:MM'|null } in SAST, or null.
function evStart(ev) {
  const raw = String(ev.date_local || '');
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw.slice(10))) {        // has a timezone → convert
    const d = new Date(raw);
    if (!isNaN(d)) { const s = new Date(d.getTime() + 2 * 3600e3).toISOString(); return { date: s.slice(0, 10), time: s.slice(11, 16) }; }
  }
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) return null;
  const t = ev.time_local ? String(ev.time_local).slice(0, 5) : m[2];
  return { date: m[1], time: t && t !== '00:00' ? t : null };
}
const startKey = ev => { const s = evStart(ev); return s ? `${s.date}T${s.time || '00:00'}` : '9999'; };
const isoDT = (date, time) => (time ? `${date}T${time}:00+02:00` : date);
function fmtDate(st, year) {
  const d = new Date(st.date + 'T12:00:00Z');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ' ' + d.getUTCFullYear() : ''}${st.time ? ' · ' + st.time : ''}`;
}
// Fri–Sun of the current weekend (if today is Fri/Sat/Sun) or the next one.
function weekendRange() {
  const n = sastNow(), d = n.getUTCDay();
  const off = d === 0 ? -2 : d === 6 ? -1 : 5 - d;
  const fri = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + off));
  const sun = new Date(fri.getTime() + 2 * 86400e3);
  const label = fri.getUTCMonth() === sun.getUTCMonth()
    ? `${fri.getUTCDate()}–${sun.getUTCDate()} ${MONTHS[sun.getUTCMonth()]}`
    : `${fri.getUTCDate()} ${MONTHS[fri.getUTCMonth()]} – ${sun.getUTCDate()} ${MONTHS[sun.getUTCMonth()]}`;
  return { from: ymd(fri), to: ymd(sun), label };
}

/* ─── data ────────────────────────────────────────────── */
const isDurbanArea = ev => {
  const prov = String(ev.venue_province || '').toLowerCase();
  if (prov && !/kzn|kwazulu/.test(prov)) return false;           // e.g. Durbanville, Western Cape
  const words = String(ev.venue_city || '').toLowerCase().split(/[^a-z]+/);
  return DURBAN_AREAS.some(a => words.includes(a));             // whole words only: 'durbanville' ≠ 'durban'
};
const areaOr = col => DURBAN_AREAS.map(a => `${col}.ilike.%${a}%`).join(',');
const priceText = ev => { const p = Number(ev.price_min); return ev.price_known === false ? 'See ticket prices' : ev.is_free ? 'Free' : p > 0 ? `From R${Number.isInteger(p) ? p : p.toFixed(2)}` : 'See ticket prices'; };
const evText = ev => `${ev.name || ''} ${plain(ev.description)}`;
const fingerprint = ev => `${String(ev.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${evStart(ev)?.date}`;

// Cache non-empty results 10 min; an empty/failed fetch only 30s (a Quicket blip
// must not turn every qkt_ page into a cached 404). Concurrent callers share one fetch.
let _qCache = { t: 0, ttl: 0, events: [] }, _qInflight = null;
async function quicketKzn(deps) {
  if (Date.now() - _qCache.t < _qCache.ttl) return _qCache.events;
  if (!_qInflight) {
    _qInflight = deps.fetchQuicketEvents(KZN_CITIES).catch(() => []).then(events => {
      _qCache = { t: Date.now(), ttl: events.length ? 600e3 : 30e3, events };
      _qInflight = null;
      return events;
    });
  }
  return _qInflight;
}

// Upcoming Durban-area events: DB first, then Quicket; deduped by name+date; sorted by start.
async function durbanEvents(deps) {
  const today = sastToday();
  const [{ data: dbEvs, error }, qEvs] = await Promise.all([
    deps.sb().from('events').select(EV_COLS)
      .eq('is_active', true).gte('date_local', today)
      .not('status', 'in', '(cancelled,postponed,draft)')
      .or(areaOr('venue_city'))
      .order('date_local', { ascending: true }).limit(300),
    quicketKzn(deps),
  ]);
  if (error) console.warn('[seo] events query:', error.message);
  const seen = new Set(), out = [];
  for (const ev of [...(dbEvs || []), ...qEvs].filter(isDurbanArea)) {
    const st = evStart(ev);
    if (!st || st.date < today) continue;
    const fp = fingerprint(ev);
    if (seen.has(fp) || seen.has(ev.id)) continue;
    seen.add(fp); seen.add(ev.id);
    out.push(ev);
  }
  return out.sort((a, b) => (startKey(a) < startKey(b) ? -1 : startKey(a) > startKey(b) ? 1 : 0));
}

async function durbanBusinesses(deps, categories) {
  const { data, error } = await deps.sb().from('businesses')
    .select('id,name,category,suburb,city,tagline')
    .eq('is_active', true).in('category', categories).or(areaOr('city'))
    .order('is_frontline', { ascending: false })
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(24);
  if (error) console.warn('[seo] businesses query:', error.message);
  return data || [];
}

/* ─── page definitions ────────────────────────────────── */
const genreHas = (ev, ...g) => g.some(x => String(ev.genre || '').toLowerCase().includes(x));
const NIGHT_GENRES = ['nightlife', 'amapiano', 'gqom', 'house', 'afrohouse', 'hiphop', 'kwaito', 'afrobeats', 'rnb'];

const PAGES = {
  '': {
    label: 'Durban', nav: 'Durban guide',
    title: 'Durban Events, Nightlife & Things to Do | Pulsefy',
    desc: "What's on in Durban: gqom and amapiano parties, nightlife, shisanyama spots and weekend events. Dates, venues and tickets, updated daily.",
    h1: 'Durban events, nightlife & things to do',
    cta: '/?city=Durban', ctaText: 'See all Durban events in the app',
    filter: () => true, max: 24,
    intro: [
      "Durban moves to its own rhythm. This is the city where gqom was born, where Sunday afternoons mean shisanyama smoke and a DJ on the decks, and where the beachfront stays busy long after the sun goes down.",
      "Pulsefy keeps a live list of what's happening across eThekwini, from club nights in the Durban CBD and bars along Florida Road, to lounges in Umhlanga, township sessions in uMlazi and KwaMashu, and family days out in Durban North. Every listing comes from organisers and ticketing partners and refreshes through the day, so you can see dates, venues and prices before you make plans.",
      "Pick a guide below to narrow things down: gqom and amapiano nights, the best of Durban nightlife, shisanyama spots, or simply what's on this weekend. Found something you like? Tap through for the full details and tickets, or open the Pulsefy app to save events, see who's going and get directions.",
    ],
    faq: [
      ['What is there to do in Durban this weekend?', "Our Durban this-weekend guide lists every event we have from Friday to Sunday, with start times, venues and prices. Popular options include club nights in the Durban CBD, bars on Florida Road, the beachfront and Sunday shisanyama sessions."],
      ['Where are the main nightlife areas in Durban?', 'Florida Road in Morningside, the Durban CBD, Umhlanga and the beachfront are the best-known areas for bars, clubs and lounges. Townships such as uMlazi and KwaMashu have their own busy venue and shisanyama scene.'],
      ['How do I buy tickets for Durban events?', "Open any event on Pulsefy and tap Get tickets. You'll go to the official ticket seller for that event, or buy in the Pulsefy app when the organiser sells tickets through Pulsefy."],
      ['Are there free events in Durban?', 'Yes. Markets, community events and some day parties are free to attend. Free events are marked Free on every Pulsefy listing.'],
      ['Is Pulsefy free to use?', 'Yes. Browsing events, venues and shisanyama spots on Pulsefy is free. You only pay for tickets you choose to buy.'],
    ],
  },
  events: {
    label: 'Events', nav: 'All events',
    title: 'Events in Durban: Tickets, Shows & Parties | Pulsefy',
    desc: 'Upcoming events in Durban in date order: concerts, parties, comedy, markets and festivals. See venues and prices, then get tickets.',
    h1: 'Upcoming events in Durban',
    cta: '/?city=Durban', ctaText: 'Browse Durban events in the app',
    filter: () => true, max: 40,
    intro: [
      "Looking for something to do in Durban? This page lists upcoming events across the city in date order: concerts, club nights, comedy, markets, festivals, food events and more.",
      "Durban's warm weather keeps the calendar busy most of the year. The beachfront and the Durban CBD host big shows and outdoor events, Florida Road and Morningside are popular for bars and live music, Umhlanga has upmarket restaurants and lounges, and areas like uMlazi, KwaMashu and Durban North have their own local scenes.",
      "Each event shows the date, start time, venue and the lowest ticket price we know of, with free events clearly marked. Tap Get tickets to see the full event page, with the address, line-up and a link to the official ticket seller. Plans change, so double-check times with the organiser before you head out. Want more? The Pulsefy app lets you filter by genre, save events and get reminders.",
    ],
    faq: [
      ['How do I find events in Durban this week?', 'This page lists upcoming Durban events in date order. For Friday to Sunday only, see the this-weekend guide, or open the Pulsefy app to filter by date and genre.'],
      ['Where can I buy tickets for Durban events?', "Tap Get tickets on any event. You'll see the full event details and a link to the official ticket seller, or you can buy in the Pulsefy app when the organiser sells through Pulsefy."],
      ['Are there free events in Durban?', 'Yes. Free events are marked Free in the list, and Durban regularly has free markets, community events and day parties.'],
      ['How often is this list updated?', 'Listings come from organisers and ticketing partners and the page refreshes throughout the day.'],
    ],
  },
  nightlife: {
    label: 'Nightlife', nav: 'Nightlife',
    title: 'Nightlife in Durban: Clubs, Parties & Bars | Pulsefy',
    desc: "Durban nightlife guide: upcoming club nights, parties and DJ sets, plus bars, clubs and venues from Florida Road to Umhlanga and uMlazi.",
    h1: 'Durban nightlife: clubs, parties and bars',
    cta: '/?city=Durban&genre=nightlife', ctaText: 'Open Durban nightlife in the app',
    biz: ['bar', 'club', 'venue'], bizTitle: 'Bars, clubs and venues in Durban',
    filter: ev => genreHas(ev, ...NIGHT_GENRES) || /\b(club|nightlife|party|dj|lounge|rave|gqom|amapiano)\b/i.test(ev.name || ''),
    max: 40,
    intro: [
      "Durban nightlife is loud, warm and proudly local. On a big weekend you can move from after-work drinks on Florida Road to a club night in the Durban CBD, catch a lounge session in Umhlanga, or head to a township venue in uMlazi or KwaMashu where the sound is pure Durban.",
      "Gqom, the hard-hitting electronic sound that grew out of the city's townships, sits alongside amapiano, house, afro-tech and hip hop on most line-ups. This page brings together upcoming parties, club nights and DJ sets in and around Durban, plus bars, clubs and venues listed on Pulsefy.",
      "Check each listing for the age restriction, dress code and start time, as many venues are 18+ and get busy late. Plan your ride home before you go out, using a registered e-hailing service or a designated driver, and keep an eye on your drink and belongings.",
    ],
    faq: [
      ['Where is the best nightlife in Durban?', 'Florida Road in Morningside is known for bars and restaurants, the Durban CBD for club nights, Umhlanga for lounges, and townships such as uMlazi and KwaMashu for local venues and shisanyama parties.'],
      ['What music will I hear at Durban parties?', "Gqom, Durban's own sound, plus amapiano, house, afro-tech, hip hop and R&B. Check the line-up on each event page."],
      ['What is the age limit for Durban clubs?', 'The legal drinking age in South Africa is 18, and most clubs and bars are 18+. Some events set a higher age limit, so check the event page and bring ID.'],
      ['How do I get home safely after a night out in Durban?', 'Plan your ride before you go out: use a registered e-hailing app or arrange a designated driver, and wait indoors for your ride. Keep your phone and drinks with you.'],
    ],
  },
  gqom: {
    label: 'Gqom', nav: 'Gqom',
    title: 'Gqom Events in Durban This Week | Pulsefy',
    desc: 'Upcoming gqom events in Durban, the home of gqom: club nights, township parties and festivals with dates, venues and ticket prices.',
    h1: 'Gqom events in Durban',
    cta: '/?city=Durban&genre=gqom', ctaText: 'Find gqom events in the app',
    filter: ev => genreHas(ev, 'gqom') || /gqom/i.test(evText(ev)),
    max: 40,
    intro: [
      "Durban is the home of gqom. The raw, bass-heavy sound took shape in the early 2010s in the city's townships, with young producers in places like uMlazi and KwaMashu making tracks on laptops and sharing them through phones, taxis and parties, before it spread across South Africa and onto international stages.",
      "Today you can hear gqom at club nights in the Durban CBD, at township events and pop-ups, at shisanyama sessions and at bigger festivals along the coast. This page lists upcoming gqom events in and around Durban that we have found through organisers and ticketing partners, with dates, venues and ticket prices.",
      "Line-ups and start times can change, so check the full event page before you go. Gqom often shares the bill with amapiano and house, so if the list below is short, browse Durban nightlife or what's on this weekend too, or open the Pulsefy app to see everything near you.",
    ],
    faq: [
      ['Where can I find gqom events in Durban this weekend?', 'The list on this page shows upcoming gqom events in and around Durban with dates and venues. For everything from Friday to Sunday, see the Durban this-weekend guide.'],
      ['Is gqom from Durban?', "Yes. Gqom developed in Durban's townships in the early 2010s and is widely seen as the city's own sound, before it spread across South Africa and overseas."],
      ['What is the difference between gqom and amapiano?', 'Gqom is darker and more percussive, built on heavy kicks and broken rhythms. Amapiano is slower and smoother, with log-drum basslines and jazzy keys. Many Durban parties play both.'],
      ['How much are tickets to gqom events in Durban?', 'Prices vary by event. Each listing shows the lowest known ticket price, and free events are marked Free.'],
    ],
  },
  amapiano: {
    label: 'Amapiano', nav: 'Amapiano',
    title: 'Amapiano Events in Durban This Week | Pulsefy',
    desc: 'Upcoming amapiano events in Durban: club nights, lounge sessions and Sunday shisanyama parties, with dates, venues and ticket prices.',
    h1: 'Amapiano events in Durban',
    cta: '/?city=Durban&genre=amapiano', ctaText: 'Find amapiano events in the app',
    filter: ev => genreHas(ev, 'amapiano') || /ama-?piano/i.test(evText(ev)),
    max: 40,
    intro: [
      "Amapiano grew out of Gauteng's townships in the mid-2010s and quickly became one of South Africa's biggest sounds, with its log-drum bass, jazzy keys and long, rolling mixes. Durban has taken it to heart.",
      "You'll find amapiano on the line-up at clubs in the Durban CBD, lounges in Umhlanga, bars around Florida Road, township venues in uMlazi and KwaMashu, and at Sunday shisanyama sessions where the music runs all afternoon. Many Durban parties mix amapiano with the city's own gqom sound, so one night can cover both.",
      "This page lists upcoming amapiano events in and around Durban, collected from organisers and ticketing partners, with the date, start time, venue and lowest known ticket price. Check the event page for the full line-up and any age or dress-code rules, and buy from the official ticket link. Nothing here for your date yet? Try the Durban nightlife guide or open the Pulsefy app.",
    ],
    faq: [
      ['Where can I find amapiano events in Durban this weekend?', 'The list on this page shows upcoming amapiano events in and around Durban. For everything from Friday to Sunday, see the Durban this-weekend guide.'],
      ['Is amapiano from Durban?', "Amapiano started in Gauteng's townships in the mid-2010s, but it is hugely popular in Durban, where it is often played alongside the city's own gqom sound."],
      ['What should I wear to an amapiano party in Durban?', 'It depends on the venue. Lounges and Umhlanga spots often have a smart-casual dress code, while township and outdoor events are usually more relaxed. Check the dress code on the event page.'],
      ['How much are tickets to amapiano events in Durban?', 'Prices vary by event. Each listing shows the lowest known ticket price, and free events are marked Free.'],
    ],
  },
  shisanyama: {
    label: 'Shisanyama', nav: 'Shisanyama',
    title: 'Shisanyama in Durban: Spots & Events | Pulsefy',
    desc: 'Shisanyama spots in Durban and upcoming shisanyama and braai events, from uMlazi and KwaMashu to the CBD and Durban North.',
    h1: 'Shisanyama in Durban',
    cta: '/?city=Durban&genre=shisanyama', ctaText: 'Find shisanyama in the app',
    biz: ['shisanyama'], bizTitle: 'Shisanyama spots in Durban',
    filter: ev => genreHas(ev, 'shisanyama') || /shisa ?nyama|chisa ?nyama|braai/i.test(evText(ev)),
    max: 40,
    intro: [
      "Shisanyama is a South African institution: you choose your meat at the butchery counter, it goes onto the braai, and you eat it with pap, chakalaka and friends, usually with a DJ or a speaker not far away.",
      "In Durban, shisanyama spots are where a lot of weekend plans start, especially on Sundays, when sessions in uMlazi, KwaMashu and other townships can run from lunch into the evening. You'll also find braai and grill spots closer to town, around the Durban CBD, Durban North and the beachfront.",
      "This page lists shisanyama spots in Durban that are on Pulsefy, along with any upcoming shisanyama and braai events we know of. Opening hours, prices and music vary from place to place, so check the details in the app before you go, and plan safe transport home if you're drinking. Run a shisanyama? You can add it to Pulsefy through Pulsefy for Business.",
    ],
    faq: [
      ['What is a shisanyama?', 'A shisanyama is a braai spot, often next to a butchery, where you choose raw meat and it is grilled for you on site. It is usually served with pap and sides, and many spots have music and a social, party atmosphere.'],
      ['Where can I find shisanyama in Durban?', "Townships such as uMlazi and KwaMashu are known for busy shisanyama spots, and you'll also find braai and grill places around the Durban CBD and Durban North. The list on this page shows spots on Pulsefy."],
      ['When is the best time to go to a shisanyama?', 'Weekends, especially Sunday afternoons, are the busiest, with DJs and a party crowd. Go earlier in the day for a quieter meal.'],
      ['Do shisanyama spots in Durban host events?', 'Many host DJ sessions and day parties. Upcoming shisanyama and braai events we know of are listed on this page.'],
    ],
  },
  'this-weekend': {
    label: 'This weekend', nav: 'This weekend',
    title: 'Things to Do in Durban This Weekend | Pulsefy',
    desc: "What's on in Durban this weekend, Friday to Sunday: parties, gigs, markets, shisanyama sessions and free events, with times and tickets.",
    h1: 'Things to do in Durban this weekend',
    cta: '/?city=Durban', ctaText: "See what's on in the app",
    weekend: true, max: 40,
    intro: [
      "Wondering what to do in Durban this weekend? Here is everything we have listed from Friday to Sunday, in date order, so you can plan the whole weekend in one go.",
      "Friday nights are usually about after-work drinks and club nights in the Durban CBD, on Florida Road and in Umhlanga. Saturdays bring markets, sport, festivals, comedy and big parties, and Durban's warm weather means plenty happens outdoors and along the beachfront. Sundays are for long lunches, shisanyama sessions in uMlazi and KwaMashu, and chilled day parties.",
      "Each listing shows the start time, venue, area and the lowest known ticket price, with free events marked so you can plan on any budget. Organisers add events through the week, so check back on Friday for late additions. Tap any event for the full details and the official ticket link, or open the Pulsefy app to save events and see what's trending.",
    ],
    faq: [
      ["What's happening in Durban this weekend?", 'This page lists the events we have in and around Durban from Friday to Sunday, in date order, with venues, start times and prices.'],
      ['Are there free things to do in Durban this weekend?', "Free events are marked Free in the list. Durban's beachfront promenade, parks and many markets are also free to visit."],
      ['When does this list update?', 'Organisers add events throughout the week and this page refreshes several times a day, so check again on Friday for late additions.'],
      ["What's on in Durban on Sunday?", 'Sunday events appear at the end of the list. Sundays in Durban are known for shisanyama sessions, day parties and family outings.'],
    ],
  },
};
const SLUG_ORDER = ['events', 'this-weekend', 'nightlife', 'gqom', 'amapiano', 'shisanyama'];
const pagePath = slug => (slug ? `/durban/${slug}` : '/durban');

/* ─── HTML ────────────────────────────────────────────── */
const CSS = `*{box-sizing:border-box}body{margin:0;background:#160C32;color:#F3EFFF;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:#FF9A57}.w{max-width:960px;margin:0 auto;padding:0 16px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid #3A2A6B}
.logo{display:flex;align-items:center;gap:8px;min-height:44px;color:#fff;text-decoration:none;font-weight:800;font-size:1.15rem}
.logo img{border-radius:10px}
h1{font-size:1.75rem;line-height:1.2;margin:20px 0 12px}h2{font-size:1.25rem;line-height:1.3;margin:32px 0 12px}h3{font-size:1rem;line-height:1.35;margin:0}
.intro p{color:#DCD5F2;margin:0 0 12px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 20px;border-radius:999px;background:#FF5C00;color:#160C32;font-weight:800;text-decoration:none;border:2px solid #FF5C00}
.btn.alt{background:transparent;color:#F3EFFF;border-color:#B026FF}.btn.sm{min-height:44px;padding:8px 16px;font-size:.9rem}
.row{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:16px 0}
.chips a{display:inline-flex;align-items:center;min-height:44px;padding:8px 16px;border-radius:999px;background:#241650;border:1px solid #4A3590;color:#F3EFFF;text-decoration:none;font-weight:600}
.chips a[aria-current]{background:#6A1BB8;border-color:#B026FF}
.list{list-style:none;padding:0;margin:0;display:grid;gap:12px}@media(min-width:720px){.list{grid-template-columns:1fr 1fr}}
.card{display:flex;gap:12px;background:#21134A;border:1px solid #3A2A6B;border-radius:16px;padding:12px}
.card img,.ph{width:96px;height:96px;border-radius:12px;object-fit:cover;flex:none;background:#2E1D63}
.cb{min-width:0;flex:1}.card h3 a{display:block;min-height:44px;padding:11px 0;color:#fff;text-decoration:none}.card .btn{margin-top:8px}
.meta{margin:2px 0;color:#C9C1E6;font-size:.9rem}.date{margin:0;color:#FFB27A;font-weight:700;font-size:.8rem;text-transform:uppercase;letter-spacing:.03em}
.empty{background:#21134A;border:1px dashed #4A3590;border-radius:16px;padding:20px}
.faq h3{margin-top:16px}.faq p{margin:4px 0 0;color:#DCD5F2}
.hero{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:16px;background:#2E1D63}
.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:16px 0}.facts dt{color:#C9C1E6;font-weight:700}.facts dd{margin:0}
.note{background:#3A1430;border:1px solid #FF5C00;border-radius:12px;padding:12px 14px}
.crumbs{font-size:.875rem;color:#C9C1E6;margin-top:12px}.crumbs a{display:inline-block;min-height:44px;padding:11px 0}
footer{margin-top:48px;padding:24px 16px;border-top:1px solid #3A2A6B;color:#C9C1E6;font-size:.9rem}footer a{display:inline-block;min-height:44px;padding:11px 6px 11px 0}`;

function shell({ title, desc, path, body, lds = [], noindex = false, image }) {
  const canon = SITE + path;
  const img = safeUrl(image) || `${SITE}/og-image.png`;
  return `<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
${noindex ? '<meta name="robots" content="noindex"/>\n' : ''}<link rel="canonical" href="${esc(canon)}"/>
<meta name="theme-color" content="#160C32"/>
<link rel="icon" href="/favicon.png"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Pulsefy"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(canon)}"/>
<meta property="og:image" content="${esc(img)}"/>
<meta property="og:locale" content="en_ZA"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(img)}"/>
<style>${CSS}</style>
${lds.map(ld).join('\n')}
</head>
<body>
<header class="top"><a class="logo" href="/"><img src="/logo.png" width="36" height="36" alt=""/>Pulsefy</a><a class="btn sm" href="/">Open app</a></header>
<main class="w">
${body}
</main>
<footer><div class="w">
<nav aria-label="Durban guides">${[''].concat(SLUG_ORDER).map(s => `<a href="${pagePath(s)}">${esc(s ? 'Durban ' + PAGES[s].nav.toLowerCase() : 'Durban guide')}</a>`).join(' · ')}</nav>
<nav aria-label="Pulsefy"><a href="/">Home</a> · <a href="/feeds">Feeds</a> · <a href="/partners">Partners</a> · <a href="/terms">Terms</a></nav>
<p>© ${sastNow().getUTCFullYear()} Pulsefy. Event details come from organisers and ticketing partners; check with the organiser before you go.</p>
</div></footer>
</body>
</html>`;
}

const evUrl = ev => `/e/${encodeURIComponent(ev.id)}`;
function card(ev) {
  const st = evStart(ev), img = safeUrl(ev.image_url);
  const where = [ev.venue_name, ev.venue_city].filter(Boolean).join(' · ');
  return `<li class="card">${img ? `<img src="${esc(img)}" width="96" height="96" loading="lazy" alt="${esc(ev.name)}"/>` : '<div class="ph" aria-hidden="true"></div>'}
<div class="cb"><p class="date">${esc(st ? fmtDate(st) : '')}</p><h3><a href="${evUrl(ev)}">${esc(ev.name)}</a></h3>
${where ? `<p class="meta">${esc(where)}</p>` : ''}<p class="meta">${esc(priceText(ev))}</p>
<a class="btn sm" href="${evUrl(ev)}" aria-label="Get tickets: ${esc(ev.name)}">Get tickets</a></div></li>`;
}

const chips = current => `<nav aria-label="Durban guides"><ul class="chips">${[''].concat(SLUG_ORDER).map(s =>
  `<li><a href="${pagePath(s)}"${s === current ? ' aria-current="page"' : ''}>${esc(PAGES[s].nav)}</a></li>`).join('')}</ul></nav>`;

const crumbsLd = items => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + path })),
});
const crumbsHtml = items => `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([name, path], i) =>
  i === items.length - 1 ? `<span aria-current="page">${esc(name)}</span>` : `<a href="${path}">${esc(name)}</a>`).join(' › ')}</nav>`;

/* ─── /durban, /durban/:slug ──────────────────────────── */
async function renderDurban(slug, deps) {
  const p = PAGES[slug];
  let events = await durbanEvents(deps);
  let h1 = p.h1;
  if (p.weekend) {
    const w = weekendRange();
    events = events.filter(ev => { const d = evStart(ev).date; return d >= w.from && d <= w.to; });
    h1 = `${p.h1} (${w.label})`;
  } else {
    events = events.filter(p.filter);
  }
  events = events.slice(0, p.max);
  const biz = p.biz ? await durbanBusinesses(deps, p.biz) : [];
  const path = pagePath(slug);
  const crumbs = [['Pulsefy', '/'], ['Durban', '/durban']].concat(slug ? [[p.label, path]] : []);

  const list = events.length
    ? `<ul class="list">${events.map(card).join('\n')}</ul>`
    : `<div class="empty"><p><strong>No listings right now — check the app.</strong></p><p>We haven't got ${slug && !p.weekend ? esc(p.label.toLowerCase()) + ' ' : ''}events listed for this ${p.weekend ? 'weekend' : 'page'} yet. New events are added all the time; open Pulsefy to see everything near you, or try another Durban guide below.</p><a class="btn" href="${esc(p.cta)}">${esc(p.ctaText)}</a></div>`;

  const bizHtml = p.biz ? `<h2>${esc(p.bizTitle)}</h2>${biz.length
    ? `<ul class="list">${biz.map(b => `<li class="card"><div class="cb"><h3><a href="/?bid=${encodeURIComponent(b.id)}">${esc(b.name)}</a></h3><p class="meta">${esc([b.suburb, b.city].filter(Boolean).join(', '))}</p>${b.tagline ? `<p class="meta">${esc(b.tagline)}</p>` : ''}</div></li>`).join('\n')}</ul>`
    : `<p>No spots listed here yet. <a href="${esc(p.cta)}">Browse places in the app</a>.</p>`}` : '';

  const explore = slug ? '' : `<h2>Durban guides</h2><ul class="list">${SLUG_ORDER.map(s =>
    `<li class="card"><div class="cb"><h3><a href="${pagePath(s)}">${esc(PAGES[s].h1)}</a></h3><p class="meta">${esc(PAGES[s].desc)}</p></div></li>`).join('\n')}</ul>`;

  const body = `${crumbsHtml(crumbs)}
<h1>${esc(h1)}</h1>
<div class="intro">${p.intro.map(t => `<p>${esc(t)}</p>`).join('')}</div>
<div class="row"><a class="btn" href="${esc(p.cta)}">${esc(p.ctaText)}</a></div>
${chips(slug)}
<h2>${slug ? 'Upcoming listings' : 'Coming up in Durban'}</h2>
${list}
${bizHtml}
${explore}
<section class="faq"><h2>Frequently asked questions</h2>${p.faq.map(([qq, a]) => `<h3>${esc(qq)}</h3><p>${esc(a)}</p>`).join('')}</section>
<h2>More from Pulsefy</h2>${chips(slug)}
<div class="row"><a class="btn" href="${esc(p.cta)}">${esc(p.ctaText)}</a><a class="btn alt" href="/">Pulsefy home</a></div>`;

  const lds = [
    crumbsLd(crumbs),
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: p.faq.map(([qq, a]) => ({ '@type': 'Question', name: qq, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
  if (events.length) lds.push({
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: events.map((ev, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + evUrl(ev), name: ev.name })),
  });
  return shell({ title: p.title, desc: p.desc, path, body, lds });
}

/* ─── /e/:id ──────────────────────────────────────────── */
const EV_STATUS = { cancelled: 'EventCancelled', postponed: 'EventPostponed' };
const REGION = { kzn: 'KwaZulu-Natal', gp: 'Gauteng', wc: 'Western Cape', ec: 'Eastern Cape' };

async function findEvent(id, deps) {
  const { data: ev, error } = await deps.sb().from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('event lookup failed');
  if (ev) {
    if (ev.status === 'draft') return null;
    // The cleanup cron switches off events the day after they happen. Anything
    // inactive that isn't a just-finished event was hidden on purpose → 404.
    const st = evStart(ev);
    if (ev.is_active === false) {
      const ended = st && st.date < sastToday();
      const recent = st && (Date.parse(sastToday()) - Date.parse(st.date)) <= 3 * 86400e3;
      if (!ended || !recent) return null;
    }
    return ev;
  }
  if (/^qkt_\d+$/.test(id)) return (await quicketKzn(deps)).find(e => e.id === id) || null;
  return null;
}

function lineupNames(lineup) {
  let l = lineup;
  if (typeof l === 'string') { try { l = JSON.parse(l); } catch { l = l.split(','); } }
  return (Array.isArray(l) ? l : []).map(x => String((x && typeof x === 'object') ? (x.name || '') : x).trim()).filter(Boolean).slice(0, 30);
}

function renderEvent(ev, related) {
  const st = evStart(ev);
  const today = sastToday();
  const past = st.date < today;
  const old  = st.date < ymd(new Date(sastNow().getTime() - 30 * 86400e3));
  const city = ev.venue_city || '';
  const venue = ev.venue_name || '';
  const durban = isDurbanArea(ev);
  const path = evUrl(ev);
  const lineup = lineupNames(ev.lineup);
  const descParas = paras(ev.description).slice(0, 20);
  const descText = descParas.join(' ');
  const ext = safeUrl(ev.external_url);
  const ticketHref = ext || `/?ev=${encodeURIComponent(ev.id)}&buy=1`;
  const img = safeUrl(ev.image_url);
  const when = fmtDate(st, true);

  const suffix = ' | Pulsefy';
  let title = `${ev.name} — ${[venue, city].filter(Boolean).join(', ')}`.replace(/ — $/, '') + suffix;
  if (title.length > 60) title = `${ev.name}${city ? ' — ' + city : ''}${suffix}`;
  if (title.length > 60) title = clip(String(ev.name), 60 - suffix.length) + suffix;
  const desc = clip([`${when}${venue ? ' at ' + venue : ''}${city ? ', ' + city : ''}.`, priceText(ev) + '.', descText].filter(Boolean).join(' '), 155);

  const endSt = ev.end_date_local ? { date: String(ev.end_date_local).slice(0, 10), time: ev.end_time_local ? String(ev.end_time_local).slice(0, 5) : null } : null;
  const postal = String(ev.venue_address || '').match(/(?:^|[\s,])(\d{4})\s*$/)?.[1];
  const region = REGION[String(ev.venue_province || '').toLowerCase()] || ev.venue_province || (durban ? 'KwaZulu-Natal' : undefined);
  const evLd = {
    '@context': 'https://schema.org', '@type': 'Event',
    name: ev.name,
    startDate: isoDT(st.date, st.time),
    endDate: endSt ? isoDT(endSt.date, endSt.time) : undefined,
    eventStatus: `https://schema.org/${EV_STATUS[ev.status] || 'EventScheduled'}`,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place', name: venue || city || 'Durban',
      address: { '@type': 'PostalAddress', streetAddress: ev.venue_address || undefined, addressLocality: city || undefined, addressRegion: region, postalCode: postal, addressCountry: 'ZA' },
    },
    image: [img || `${SITE}/og-image.png`],
    description: descText ? clip(descText, 500) : desc,
    offers: past ? undefined : {
      '@type': 'Offer', url: ext || SITE + ticketHref, priceCurrency: 'ZAR',
      price: ev.price_known === false ? undefined : ev.is_free ? 0 : (Number(ev.price_min) > 0 ? Number(ev.price_min) : undefined),
      availability: `https://schema.org/${ev.status === 'sold_out' ? 'SoldOut' : 'InStock'}`,
    },
    organizer: ev.organiser_name ? { '@type': 'Organization', name: ev.organiser_name } : undefined,
    performer: lineup.length ? lineup.map(name => ({ '@type': 'PerformingGroup', name })) : undefined,
  };
  const crumbs = durban ? [['Pulsefy', '/'], ['Durban', '/durban'], [ev.name, path]] : [['Pulsefy', '/'], [ev.name, path]];

  const body = `${crumbsHtml(crumbs)}
<h1>${esc(ev.name)}</h1>
${past ? `<p class="note">This event has ended. <a href="/durban/events">See upcoming events in Durban</a>.</p>` : ''}
${EV_STATUS[ev.status] ? `<p class="note">This event is marked as ${esc(ev.status)}. Check with the organiser for updates.</p>` : ''}
${img ? `<img class="hero" src="${esc(img)}" width="800" height="450" alt="${esc(ev.name)}" fetchpriority="high"/>` : ''}
<dl class="facts"><dt>When</dt><dd>${esc(when)}${endSt ? ' – ' + esc(fmtDate(endSt, true)) : ''}</dd>
<dt>Where</dt><dd>${esc([venue, ev.venue_address, city].filter(Boolean).join(', ') || 'Venue to be confirmed')}</dd>
<dt>Price</dt><dd>${esc(priceText(ev))}</dd>${ev.organiser_name ? `<dt>Organiser</dt><dd>${esc(ev.organiser_name)}</dd>` : ''}</dl>
<div class="row">${past ? '' : `<a class="btn" href="${esc(ticketHref)}"${ext ? ' rel="nofollow sponsored noopener" target="_blank"' : ''}>Get tickets</a>`}<a class="btn alt" href="/?ev=${encodeURIComponent(ev.id)}">Open in Pulsefy app</a></div>
${descParas.length ? `<h2>About this event</h2>${descParas.map(t => `<p>${esc(t)}</p>`).join('')}` : ''}
${lineup.length ? `<h2>Line-up</h2><ul>${lineup.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
${related.length ? `<h2>More events in Durban</h2><ul class="list">${related.map(card).join('\n')}</ul>` : ''}
<h2>Explore Durban</h2>${chips(null)}`;

  return shell({ title, desc, path, body, image: img, noindex: past && old, lds: [crumbsLd(crumbs), evLd] });
}

function notFound(msg) {
  return shell({
    title: 'Not found | Pulsefy', desc: 'This page could not be found on Pulsefy.', path: '/durban', noindex: true,
    body: `<h1>Not found</h1><p>${esc(msg)}</p><div class="row"><a class="btn" href="/durban">Durban events</a><a class="btn alt" href="/">Pulsefy home</a></div>${chips(null)}`,
  });
}

/* ─── /sitemap.xml ────────────────────────────────────── */
async function renderSitemap(deps) {
  const today = sastToday();
  const [{ data: dbEvs, error }, qEvs] = await Promise.all([
    deps.sb().from('events').select('id,name,date_local,updated_at').eq('is_active', true).gte('date_local', today)
      .not('status', 'in', '(cancelled,postponed,draft)').order('date_local', { ascending: true }).limit(1000),
    quicketKzn(deps),
  ]);
  if (error) console.warn('[seo] sitemap query:', error.message);
  const dbFps = new Set((dbEvs || []).map(fingerprint));   // skip Quicket copies of DB events
  const urls = [
    { loc: '/' }, { loc: '/feeds' }, { loc: '/terms' },
    ...[''].concat(SLUG_ORDER).map(s => ({ loc: pagePath(s) })),
    ...(dbEvs || []).map(e => ({ loc: evUrl(e), lastmod: e.updated_at ? String(e.updated_at).slice(0, 10) : undefined })),
    ...qEvs.filter(e => (evStart(e)?.date || '') >= today && !dbFps.has(fingerprint(e))).map(e => ({ loc: evUrl(e) })),
  ];
  const seen = new Set();
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.filter(u => !seen.has(u.loc) && seen.add(u.loc)).map(u => `<url><loc>${esc(SITE + u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
}

/* ─── entry ───────────────────────────────────────────── */
// deps: { sb: () => supabaseClient, fetchQuicketEvents: (cities) => Promise<event[]> }
async function seoPages(url, res, deps) {
  const send = (status, type, body) => {
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', status === 200 ? CACHE : 'no-store');
    return res.status(status).send(body);
  };
  const html = 'text/html; charset=utf-8';

  if (url === '/sitemap.xml') return send(200, 'application/xml; charset=utf-8', await renderSitemap(deps));

  const dm = url.match(/^\/durban(?:\/([^/]*))?\/?$/);
  if (dm) {
    const slug = dm[1] || '';
    if (!Object.prototype.hasOwnProperty.call(PAGES, slug)) return send(404, html, notFound("We don't have that Durban guide."));
    return send(200, html, await renderDurban(slug, deps));
  }

  const em = url.match(/^\/e\/([^/]+)\/?$/);
  let id = '';
  try { id = em ? decodeURIComponent(em[1]) : ''; } catch { id = ''; }
  if (!/^[\w-]{1,100}$/.test(id)) return send(404, html, notFound("We couldn't find that event."));
  const ev = await findEvent(id, deps);
  if (!ev || !evStart(ev)) return send(404, html, notFound("We couldn't find that event. It may have been removed."));
  const related = (await durbanEvents(deps)).filter(e => e.id !== ev.id)
    .sort((a, b) => (genreHas(b, ev.genre || '-') ? 1 : 0) - (genreHas(a, ev.genre || '-') ? 1 : 0))
    .slice(0, 6);
  return send(200, html, renderEvent(ev, related));
}

module.exports = { seoPages };
