# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER

W, H = A4
OUT = "/home/user/Pulsify/Pulsify_Handover.pdf"

doc = SimpleDocTemplate(OUT, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)

OR  = colors.HexColor("#FF5C00")
PU  = colors.HexColor("#B026FF")
DK  = colors.HexColor("#05080F")
MU  = colors.HexColor("#888888")
GR  = colors.HexColor("#C6FF4A")
RD  = colors.HexColor("#FF2D78")

styles = getSampleStyleSheet()

def sty(name, **kw):
    return ParagraphStyle(name, **kw)

TITLE   = sty("T",  fontSize=26, textColor=OR,  fontName="Helvetica-Bold", spaceAfter=4)
SUB     = sty("S",  fontSize=11, textColor=MU,  fontName="Helvetica", spaceAfter=14)
H1      = sty("H1", fontSize=13, textColor=PU,  fontName="Helvetica-Bold", spaceBefore=14, spaceAfter=6)
H2      = sty("H2", fontSize=10, textColor=OR,  fontName="Helvetica-Bold", spaceBefore=8,  spaceAfter=4)
BODY    = sty("B",  fontSize=9,  textColor=colors.black, fontName="Helvetica", spaceAfter=3, leading=14)
BULLET  = sty("BU", fontSize=9,  textColor=colors.black, fontName="Helvetica", spaceAfter=2, leading=13, leftIndent=12, bulletIndent=0)
CODE    = sty("C",  fontSize=8,  textColor=colors.HexColor("#1a1a2e"), fontName="Courier",
              backColor=colors.HexColor("#f4f4f8"), borderPadding=4, spaceAfter=6, leading=12)
DONE    = sty("D",  fontSize=9,  textColor=colors.HexColor("#2d6a2d"), fontName="Helvetica", spaceAfter=2, leading=13, leftIndent=12)
TODO    = sty("TD", fontSize=9,  textColor=colors.HexColor("#8b3a00"), fontName="Helvetica", spaceAfter=2, leading=13, leftIndent=12)
WARN    = sty("W",  fontSize=9,  textColor=RD,  fontName="Helvetica-Bold", spaceAfter=4, spaceBefore=4)

def hr(): return HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#dddddd"), spaceAfter=6, spaceBefore=6)
def b(t): return Paragraph(f"&#x2022;  {t}", BULLET)
def done(t): return Paragraph(f"&#x2713;  {t}", DONE)
def todo(t): return Paragraph(f"&#x25CB;  {t}", TODO)
def h1(t): return Paragraph(t, H1)
def h2(t): return Paragraph(t, H2)
def p(t): return Paragraph(t, BODY)
def warn(t): return Paragraph(t, WARN)
def sp(n=6): return Spacer(1, n)

story = []

# ── HEADER ──────────────────────────────────────────────────────────────────
story += [
    Paragraph("PULSIFY", TITLE),
    Paragraph("Development Handover Document  ·  May 2026", SUB),
    hr(),
    sp(4),
]

# ── PROJECT OVERVIEW ────────────────────────────────────────────────────────
story += [
    h1("1. Project Overview"),
    p("Pulsify is a South African events and nightlife discovery platform. It serves four user types — general users (landing page), businesses (shisanyamas, restaurants, nightclubs), event organisers, and admins. All apps are static HTML/JS files deployed on Vercel, backed by Supabase (Postgres + Auth + Storage) and a single serverless API entry point at <b>api/index.js</b>."),
    sp(),
    p("<b>Live URL:</b> https://pulsify-blue.vercel.app"),
    p("<b>Branch:</b> claude/notifications-and-leads-api-97zbp"),
    p("<b>Repo:</b> ThabisoCollinSengane/Pulsify"),
    sp(4),
]

# ── APPS ────────────────────────────────────────────────────────────────────
story += [
    h1("2. App Structure"),
    hr(),
]

apps = [
    ["/",                "apps/landing-page/index.html", "Discovery feed, map, bookings, squad"],
    ["/business",        "apps/business/index.html",     "Business dashboard (posts, menu, orders, profile)"],
    ["/organizer",       "apps/organizer/index.html",    "Organiser dashboard (posts, events, settings)"],
    ["/admin",           "apps/admin/index.html",        "Admin panel (users, businesses, verifications)"],
    ["/leads",           "apps/leads/index.html",        "Leads dashboard (scraped contacts)"],
    ["/map",             "apps/map/index.html",          "Standalone satellite map"],
    ["/api/*",           "api/index.js",                 "Single serverless function — all API routes"],
]

tbl = Table(
    [["Route", "File", "Purpose"]] + apps,
    colWidths=[3.5*cm, 6*cm, 7*cm]
)
tbl.setStyle(TableStyle([
    ("BACKGROUND",  (0,0), (-1,0), PU),
    ("TEXTCOLOR",   (0,0), (-1,0), colors.white),
    ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",    (0,0), (-1,-1), 8),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f9f9fb")]),
    ("GRID",        (0,0), (-1,-1), 0.3, colors.HexColor("#dddddd")),
    ("PADDING",     (0,0), (-1,-1), 5),
    ("VALIGN",      (0,0), (-1,-1), "TOP"),
]))
story += [tbl, sp(8)]

# ── WHAT WAS BUILT ──────────────────────────────────────────────────────────
story += [
    h1("3. What Was Built / Fixed This Session"),
    hr(),

    h2("Auth & Routing"),
    done("Business/organiser login no longer redirects to 404 — all paths use absolute routes (/business, /organiser, /signin)"),
    done("Business dashboard: bridges Supabase session into biz_session localStorage; falls back to p_user.role if RLS blocks profile read"),
    done("Organiser dashboard: role check with localStorage fallback so RLS doesn't kick users out"),
    done("Admin panel: Google OAuth wired with visible error messages"),
    sp(4),

    h2("Leads Dashboard"),
    done("Auth gate now requires a live Supabase session (not stale localStorage token)"),
    done("All queries (load, status update, notes) routed through /api/leads which uses the service key — bypasses RLS"),
    sp(4),

    h2("Map — Full Revamp"),
    done("Switched to satellite-streets-v12 style — vibrant satellite imagery"),
    done("Flickering icons fixed: pulse animation moved to a child div with pointer-events:none"),
    done("Ocean markers fixed: strict validation rejects lat=0, lon=0, NaN; filters also applied at DB query level"),
    done("Gradient orange-purple header, loading overlay, geolocate button"),
    sp(4),

    h2("Multi-Photo Upload"),
    done("Business posts: up to 5 photos with grid preview and per-image remove"),
    done("Business menu items: up to 10 photos uploaded to Supabase Storage (post-images bucket)"),
    done("Organiser posts: up to 5 photos with grid preview"),
    done("Multiple images stored as JSON array in image_url; feed shows first image + photo count badge"),
    sp(4),

    h2("Verify Profile"),
    done("Business & organiser dashboards: full verification form (registered/informal toggle, registration number, entity type, contact, SA ID, address)"),
    done("1–3 business day notice shown to user"),
    done("Submission hits POST /api/verify-request — stores verif_status=pending in profiles table"),
    done("Admin panel: new Verifications tab lists all requests; Approve / Reject buttons call PATCH /api/admin/verifications/:id"),
    done("Approving sets is_verified=true on the profile"),
    sp(4),

    h2("Payment Method"),
    done("Business & organiser: SA bank selector (Absa, Capitec, FNB, Nedbank, Standard Bank, etc.), account details form"),
    done("Saved to localStorage (payout processing integration is a future task)"),
    sp(4),

    h2("FAQ & Support"),
    done("Accordion FAQ added to business profile tab (7 questions) and organiser settings tab (6 questions)"),
    done("Contact Support link: support@pulsify.co.za"),
    sp(4),

    h2("Post Preview"),
    done("Business posts: Preview button opens a preview sheet showing photo grid + caption before publishing"),
    done("Organiser posts: same preview flow"),
    sp(4),

    h2("Saved Places (Bookmarks Fix)"),
    done("renderSaved() was showing only a count — now async, fetches real event/business records from Supabase"),
    done("Displays actual cards (image, name, city, price/rating) with unsave button"),
    sp(4),

    h2("Admin Permissions Fix"),
    done("loadUsers() now calls /api/admin/users (service key) instead of anon client — fixes RLS permission denied error"),
    sp(4),

    h2("Quicket Events Integration"),
    done("GET /api/quicket-events endpoint added — fetches SA events from Quicket API"),
    done("Feed loads Quicket events after first page render"),
    warn("Requires: QUICKET_API_KEY env var in Vercel + domain whitelisted in Quicket developer portal"),
    sp(4),

    h2("Scraper Fixes"),
    done("Inline .env loader added — script no longer crashes with 'supabaseUrl is required'"),
    done("Actor IDs corrected: instagram-scraper, tiktok-scraper, facebook-pages-scraper"),
    sp(8),
]

# ── PENDING ──────────────────────────────────────────────────────────────────
story += [
    h1("4. Still To Do / Pending"),
    hr(),

    h2("Quicket API"),
    todo("Whitelist pulsify-blue.vercel.app in your Quicket developer portal account"),
    todo("Add QUICKET_API_KEY to Vercel environment variables"),
    sp(4),

    h2("Supabase SQL (run once — required for verifications)"),
    Paragraph(
        "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verif_status TEXT DEFAULT 'none';<br/>"
        "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verif_request TEXT;",
        CODE
    ),
    sp(4),

    h2("Supabase RLS Policies"),
    todo("Add RLS policy so authenticated users can read their own profile row (currently blocked for some users)"),
    todo("Verify post-images storage bucket allows authenticated uploads"),
    sp(4),

    h2("Payout Processing"),
    todo("Payment method currently saved to localStorage only — wire to a real payout provider (Peach Payments, PayFast, etc.)"),
    sp(4),

    h2("Scraper Automation"),
    todo("Scrapers must be restarted manually after each deploy — consider a cron job or Vercel scheduled function"),
    sp(4),

    h2("Google Places API"),
    todo("Not connected (requires $10 activation) — map uses Supabase data only for now"),
    sp(8),
]

# ── DEPLOY ──────────────────────────────────────────────────────────────────
story += [
    h1("5. Deploy Procedure"),
    hr(),
    Paragraph("1.  git pull origin claude/notifications-and-leads-api-97zbp", CODE),
    Paragraph(
        "2.  export VT=$(grep VERCEL_TOKEN /workspaces/Pulsify/.env | cut -d= -f2)<br/>"
        "    &amp;&amp; npx vercel --prod --yes --token=$VT",
        CODE
    ),
    p("Always deploy from <b>claude/notifications-and-leads-api-97zbp</b>. Discard any changes on deploy-temp before pulling."),
    p("After deploy: hard-refresh in Firefox or open in Incognito to bypass Chrome cache."),
    sp(8),
]

# ── CREDENTIALS ─────────────────────────────────────────────────────────────
story += [
    h1("6. Key Services"),
    hr(),
    b("Supabase project: cjzewfvtdayjgjdpdmln.supabase.co"),
    b("Vercel: pulsify-blue.vercel.app"),
    b("Mapbox token: pk.eyJ1IjoidGhhY29sbGluMiIsImEiOiJjbW51Mm95cHEwYm8xMnJyMXEzaXgxMDBmIn0…"),
    b("Apify: social media scraper (Instagram, TikTok, Facebook)"),
    b("Quicket: SA events API — domain whitelist required"),
    sp(8),
]

# ── FOOTER ───────────────────────────────────────────────────────────────────
story += [
    hr(),
    Paragraph("Generated by Claude Code  ·  Pulsify  ·  May 2026", SUB),
]

doc.build(story)
print(f"PDF written to {OUT}")
