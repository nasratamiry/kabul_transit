"""
Kabul Cargo brand constants. These are the only source of brand colors and fonts.

Fetched 2026-10-21 from the live site (not guessed):
- Logo: https://kabulcargo.com/images/logo/logo.svg  (copy in static/brand/logo.svg)
        fills: rgb(10,68,63) teal, rgb(254,127,23) orange, rgb(255,255,255) white
- CSS:  https://kabulcargo.com/_next/static/css/dcd701940abe245c.css  (Tailwind theme)
        .bg-primary rgb(12 81 76), .bg-accent rgb(249 115 22)
- Header: <header class="sticky top-0 z-50 bg-white shadow-card">
          active nav link text-[rgb(12,81,76)], inactive text-neutral-600, hover text-accent
"""

# --- Core tokens ------------------------------------------------------------
PRIMARY = '#0C514C'    # site .bg-primary / .text-primary, active nav link, primary buttons
# The site CSS defines no "secondary" token. SECONDARY is the logo's dark teal,
# the second brand color actually used in the logo artwork.
SECONDARY = '#0A443F'
ACCENT = '#F97316'     # site .bg-accent, nav hover underline, card top borders
INK = '#111827'        # site .text-neutral-900 (headings / main text)
BG = '#FFFFFF'         # header and page background (bg-white)

# --- Extra shades used on the site ------------------------------------------
PRIMARY_50 = '#E6F0EF'
PRIMARY_100 = '#CCE1DF'
PRIMARY_400 = '#33877F'
PRIMARY_600 = '#0A413D'
PRIMARY_700 = '#08312E'
PRIMARY_800 = '#05201E'
ACCENT_50 = '#FFF7ED'
ACCENT_300 = '#FDBA74'
LOGO_ORANGE = '#FE7F17'   # orange as drawn in the logo (slightly different from ACCENT)
INK_MUTED = '#4B5563'     # site .text-neutral-600 (inactive nav links)
BG_SOFT = '#F9FAFB'       # site .bg-neutral-50 (soft section background)

# --- Fonts (same as the website: next/font Vazirmatn + Inter) ---------------
FONT_FA_PS = 'Vazirmatn'  # Dari / Pashto
FONT_EN = 'Inter'         # English

# --- Names & assets ---------------------------------------------------------
COMPANY_NAME_FA = 'کابل کارگو'
COMPANY_NAME_EN = 'Kabul Cargo'
WEBSITE = 'https://kabulcargo.com'
LOGO_STATIC_PATH = 'brand/logo.svg'
