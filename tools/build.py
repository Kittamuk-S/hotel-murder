#!/usr/bin/env python3
"""Hotel Murder 1.0 - builds the print-and-play sheets (print/*.html) from data/*.csv.

Rules follow docs/RULEBOOK_TH.md (video rules): 6-9 players, floors = players, 3 rooms per floor, 3 corpse rooms at start,
locksmith locks one room, 4 days. data/*.csv are the source of truth and are NOT written here (edit them by hand).
The previous v0.4 generator lives in _archive_v0.4/tools/build.py.

Run:  python tools/build.py
Open print/*.html in a browser, print on A4 at 100% with background graphics ON.
"""
import csv
import html
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
PRINT = os.path.join(ROOT, 'print')
os.makedirs(PRINT, exist_ok=True)
E = html.escape
MAX_FLOORS, ROWS, DAYS = 9, 3, 4


def read_csv(name):
    with open(os.path.join(DATA, name), encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- data (single source: data/*.csv)
ROLE_ROWS = read_csv('roles.csv')
SETUP_ROWS = read_csv('setup_by_players.csv')
ROOM_ROWS = read_csv('rooms.csv')

ICON = {'locksmith': '🔒', 'housekeeper': '🧹', 'windowcleaner': '🪟', 'detective': '🔎', 'accomplice': '🗝️',
        'murderer': '🔪', 'witness': '👁️', 'guest': '🛎️'}
# step number shown on the card = position in the night script (murderer and accomplice share step 5; 0 = sleeps all night)
STEP = {'locksmith': 1, 'housekeeper': 2, 'windowcleaner': 3, 'detective': 4, 'accomplice': 5, 'murderer': 5, 'witness': 6, 'guest': 0}
# print order: innocents in night order, then the killer side, then guests
CARD_ORDER = ['locksmith', 'housekeeper', 'windowcleaner', 'detective', 'witness', 'accomplice', 'murderer', 'guest']

ROLES = []
for rid in CARD_ORDER:
    row = next(r for r in ROLE_ROWS if r['id'] == rid)
    ROLES.append((rid, row['name'], row['side'], STEP[rid], row['rule'].replace(' / ', '\n'), ICON[rid]))
ROLE = {r[0]: r for r in ROLES}

SETUP = {}
for row in SETUP_ROWS:
    n = int(row['players'])
    SETUP[n] = dict(floors=int(row['floors']), rooms=int(row['rooms']), corpses=int(row['corpse_rooms_at_start']),
                    roles={r: int(row[r]) for r in CARD_ORDER})
for n, s in SETUP.items():
    assert s['floors'] == n and s['rooms'] == n * ROWS, n
    assert sum(s['roles'].values()) == n and s['roles']['murderer'] == 1, n
    assert s['rooms'] - s['corpses'] >= n, n
assert len(ROOM_ROWS) == MAX_FLOORS * ROWS

GUEST_MAX = max(s['roles']['guest'] for s in SETUP.values())
CORPSES = SETUP[min(SETUP)]['corpses']
assert all(s['corpses'] == CORPSES for s in SETUP.values())

# ---------------------------------------------------------------- shared look
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'print.css'), encoding='utf-8') as f:
    CSS = f.read()
GOLD, GOLD_HI, NAVY = '#c9a24a', '#e9c46a', '#0b1020'
FONT = "font-family=\"'Noto Sans Thai', Tahoma, sans-serif\""


def page(title, body):
    return f'<!doctype html><html lang="th"><head><meta charset="utf-8"><title>{E(title)}</title><style>{CSS}</style></head><body>{body}</body></html>'


def write(name, content):
    with open(os.path.join(PRINT, name), 'w', encoding='utf-8') as f:
        f.write(content)


def sheets(cards, per=9):
    return ''.join('<div class="sheet">' + ''.join(cards[i:i + per]) + '</div>' for i in range(0, len(cards), per))


def single(inner):
    return '<div class="sheet" style="display:block">' + inner + '</div>'


# shorter wording for illustrated cards (the art leaves little room); full text stays in data/roles.csv and the rulebook
SHORT = {
    'locksmith': 'ทุกคืนเลือกล็อก 1 ห้อง ถ้าฆาตกรเลือกห้องนั้น การลงมือไร้ผล (ล็อกห้องตัวเองได้)\nห้ามซ้ำห้องของคืนก่อน',
    'housekeeper': 'ทุกคืนเลือก 1 ชั้น รู้จำนวนผู้ที่ “ยังมีชีวิต” ในชั้นนั้น (นับคุณด้วยถ้าอยู่ชั้นนั้น)',
    'windowcleaner': 'ทุกคืนเลือก 1 แถวแนวตั้ง (1-3) รู้จำนวนผู้ที่ยังมีชีวิตในแถวนั้น (ทุกชั้น)',
    'detective': 'ทุกคืนเลือกผู้เล่น 1 คน รู้ว่าเขาพักชั้นไหน (ไม่รู้แถว)',
    'witness': 'ทุกคืนเลือกเฝ้า 1 ชั้น ถ้าเป็นชั้นที่ฆาตกรเลือกห้อง รู้ว่าห้องฆาตกรสูงกว่า / ต่ำกว่า / ชั้นเดียวกัน',
    'accomplice': 'รู้ตัวและห้องของฆาตกร (ชูคีย์การ์ดให้เห็นกัน)\nทุกคืนเลือก 1 คน รู้ชั้นของเขา · กลางวันอ้างบทบาทอะไรก็ได้',
    'murderer': 'รู้ตัวและห้องของผู้ช่วย ทุกคืนเลือก 1 ห้องเพื่อฆาตกรรม (ไม่ใช่ห้องตัวเอง/ผู้ช่วย/ห้องที่ปิด)\nรอดครบ 4 วันคุณชนะ',
    'guest': 'ไม่มีสกิลกลางคืน แต่ทุกเสียงโหวตมีค่าเท่ากัน ใช้ข้อมูลและคำพูดให้เป็นประโยชน์',
}


def role_card(r):
    bad = ' bad' if r[2] == 'ฆาตกร' else ''
    if os.path.exists(os.path.join(ROOT, 'art', r[0] + '.png')):    # illustrated card: art/<role id>.png
        num = r[3] if r[3] else '·'
        return (f'<div class="card art{bad}"><img src="../art/{r[0]}.png" alt=""><div class="shade"></div><div class="frame"></div>'
                f'<span class="num">{num}</span><div class="txt"><h2>{E(r[1])}</h2><div class="side">ฝ่าย{E(r[2])}</div>'
                f'<div class="rule">{E(SHORT[r[0]])}</div></div></div>')
    order = f'ตื่นลำดับ {r[3]}' if r[3] else 'หลับตลอดคืน'
    return (f'<div class="card role{bad}"><span class="ord">{E(order)}</span><div class="ico">{r[5]}</div>'
            f'<h2>{E(r[1])}</h2><div class="side">ฝ่าย{E(r[2])}</div><div class="rule">{E(SHORT[r[0]])}</div></div>')


# one deck holds every role once, plus the most guests any table size needs
role_cards = []
for r in ROLES:
    role_cards += [role_card(r)] * (GUEST_MAX if r[0] == 'guest' else 1)

ROLE_TABLE = ' · '.join(f'{n} คน: ' + ' '.join(f'{ROLE[k][1]}{"×" + str(c) if c > 1 else ""}' for k, c in s['roles'].items() if c)
                        for n, s in SETUP.items())
write('1-role-cards.html', page(
    'Hotel Murder - การ์ดบทบาท',
    f'<h1 class="noprint">Hotel Murder — การ์ดบทบาท ({len(role_cards)} ใบ)</h1>'
    '<p class="note noprint">เลขในวงกลมคือลำดับที่โฮสต์เรียกให้ลืมตาตอนกลางคืน (ฆาตกรกับผู้ช่วยลืมตาพร้อมกันในลำดับ 5) แขกผู้พักไม่มีสกิลกลางคืน '
    f'แต่ละเกมหยิบบทบาทตามจำนวนผู้เล่น: {E(ROLE_TABLE)}</p>' + sheets(role_cards)))


# ---------------------------------------------------------------- card backs + double-sided sheets
KEYHOLE = ('<circle cx="315" cy="426" r="19" fill="#e9c46a"/>'
           '<path d="M306 436 L324 436 L337 484 L293 484 Z" fill="#e9c46a"/>')
DOOR = ('<path d="M285 490 V420 H295 V408 H307 V398 H323 V408 H335 V420 H345 V490 Z" fill="#e9c46a"/>'
        '<circle cx="334" cy="455" r="4" fill="#0b1020"/>')


def rays(cx, cy, r0, r1, n=36, opacity=.2):
    return ''.join(
        f'<line x1="{cx + r0 * math.cos(a):.1f}" y1="{cy + r0 * math.sin(a):.1f}" x2="{cx + r1 * math.cos(a):.1f}" '
        f'y2="{cy + r1 * math.sin(a):.1f}" stroke="{GOLD}" stroke-width="{2.4 if i % 2 == 0 else 1.2}" opacity="{opacity}"/>'
        for i, a in enumerate(math.radians(360 / n * k) for k in range(n)))


def back_svg(emblem=KEYHOLE):
    """Art Deco back (navy + gold sunburst + emblem). Same for every card of a deck so the back never reveals the card."""
    cx, cy = 315, 440
    spokes = ''.join(
        f'<line x1="{cx + 95 * math.cos(a):.1f}" y1="{cy + 95 * math.sin(a):.1f}" '
        f'x2="{cx + 470 * math.cos(a):.1f}" y2="{cy + 470 * math.sin(a):.1f}" '
        f'stroke="#c9a24a" stroke-width="{3 if i % 2 == 0 else 1.4}" opacity="{.55 if i % 2 == 0 else .3}"/>'
        for i, a in enumerate(math.radians(7.5 * k) for k in range(48)))
    rings = ''.join(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#c9a24a" stroke-width="{w}" opacity=".7"/>'
                    for r, w in ((110, 3), (150, 1.5), (230, 1.5)))
    corners = ''.join(
        f'<g transform="translate({x} {y}) scale({sx} {sy})">'
        + ''.join(f'<path d="M0 0 H{s} A{s} {s} 0 0 1 0 {s} Z" fill="none" stroke="#c9a24a" stroke-width="1.6" opacity=".8"/>' for s in (40, 70, 100))
        + '</g>'
        for x, y, sx, sy in ((46, 46, 1, 1), (584, 46, -1, 1), (46, 834, 1, -1), (584, 834, -1, -1)))
    return (f'<svg viewBox="0 0 630 880" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">'
            f'<rect width="630" height="880" fill="#0b1020"/>{spokes}{rings}{corners}'
            f'<circle cx="{cx}" cy="{cy}" r="88" fill="#0b1020" stroke="#c9a24a" stroke-width="4"/>'
            f'{emblem}'
            f'<rect x="20" y="20" width="590" height="840" rx="14" fill="none" stroke="#c9a24a" stroke-width="3.5"/>'
            f'<rect x="32" y="32" width="566" height="816" rx="9" fill="none" stroke="#c9a24a" stroke-width="1.4" opacity=".6"/>'
            f'</svg>')


BACK = f'<div class="card back">{back_svg()}</div>'
ROOM_BACK = f'<div class="card back">{back_svg(DOOR)}</div>'      # key-card deck: door emblem, so the two decks are told apart
EMPTY = '<div class="card" style="visibility:hidden;border:0"></div>'
DUPLEX_NOTE = ('พิมพ์ A4 ขนาด 100% เปิดพิมพ์พื้นหลัง เลือก <b>พิมพ์สองด้าน — พลิกตามขอบยาว (flip on long edge)</b> หน้าคี่คือด้านหน้า หน้าคู่คือหลังการ์ด '
               '(หลังการ์ดเหมือนกันทุกใบ ไม่เปิดเผยการ์ด) ถ้าเครื่องพิมพ์ไม่รองรับสองด้าน พิมพ์หน้าคี่ก่อน แล้วใส่กระดาษกลับ พิมพ์หน้าคู่')


def duplex_sheets(cards, per=9, cols=3, back=BACK):
    """Front sheet, then its back sheet. Print double-sided, flip on the LONG edge: each back sits in the mirrored column."""
    out = []
    for i in range(0, len(cards), per):
        chunk = cards[i:i + per]
        slots = [EMPTY] * per
        for k in range(len(chunk)):
            r, c = divmod(k, cols)
            slots[r * cols + (cols - 1 - c)] = back
        out.append('<div class="sheet">' + ''.join(chunk) + '</div>')
        out.append('<div class="sheet">' + ''.join(slots) + '</div>')
    return ''.join(out)


write('1-role-cards-duplex.html', page(
    'Hotel Murder - การ์ดบทบาท (พิมพ์สองด้าน)',
    f'<h1 class="noprint">Hotel Murder — การ์ดบทบาท พิมพ์สองด้าน</h1><p class="note noprint">{DUPLEX_NOTE}</p>' + duplex_sheets(role_cards)))


# ---------------------------------------------------------------- key cards (rooms)
def room_svg(fl, row):
    """Key card front: sunburst, big room number, Art Deco door with a strip of light under it."""
    num = f'{fl}0{row}'
    door = (f'<path d="M225 705 V478 H245 V448 H275 V422 H355 V448 H385 V478 H405 V705 Z" fill="#101a35" stroke="{GOLD}" stroke-width="4"/>'
            f'<rect x="248" y="500" width="62" height="86" fill="none" stroke="{GOLD}" stroke-width="2" opacity=".8"/>'
            f'<rect x="320" y="500" width="62" height="86" fill="none" stroke="{GOLD}" stroke-width="2" opacity=".8"/>'
            f'<rect x="248" y="606" width="134" height="76" fill="none" stroke="{GOLD}" stroke-width="2" opacity=".8"/>'
            f'<circle cx="352" cy="594" r="8" fill="{GOLD_HI}"/>'
            f'<rect x="227" y="700" width="176" height="6" fill="#ffd27a"/>'
            f'<path d="M227 706 H403 L450 790 H180 Z" fill="#ffd27a" opacity=".13"/>')
    return (f'<svg viewBox="0 0 630 880" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" {FONT}>'
            f'<rect width="630" height="880" fill="{NAVY}"/>{rays(315, 300, 120, 520)}'
            f'<circle cx="315" cy="300" r="150" fill="none" stroke="{GOLD}" stroke-width="2" opacity=".35"/>'
            f'<text x="315" y="120" text-anchor="middle" font-size="40" font-weight="700" fill="{GOLD_HI}" letter-spacing="1">ชั้น {fl} · แถว {row}</text>'
            f'<text x="315" y="340" text-anchor="middle" font-size="190" font-weight="800" fill="{GOLD_HI}" stroke="{NAVY}" stroke-width="6" paint-order="stroke">{num}</text>'
            f'{door}'
            f'<text x="315" y="800" text-anchor="middle" font-size="34" font-weight="700" fill="#f3e6bf">คีย์การ์ดห้องของคุณ</text>'
            f'<text x="315" y="840" text-anchor="middle" font-size="28" fill="#f3e6bf" opacity=".8">(ห้ามบอกใคร)</text>'
            f'<rect x="20" y="20" width="590" height="840" rx="14" fill="none" stroke="{GOLD}" stroke-width="3.5"/>'
            f'<rect x="32" y="32" width="566" height="816" rx="9" fill="none" stroke="{GOLD}" stroke-width="1.4" opacity=".6"/>'
            f'</svg>')


KEY_NOTE = (f'ใช้ชั้น 1 ถึงชั้นเท่าจำนวนผู้เล่น (6 คน = ชั้น 1-6, 9 คน = ชั้น 1-9) หยิบการ์ดของชั้นที่ใช้ออกมา สุ่มหยิบ {CORPSES} ใบหงายเป็นห้องที่พบศพ '
            'สับที่เหลือแจกคนละ 1 ใบคว่ำ ใบที่เหลือคือห้องว่าง ชั้นที่เกินจำนวนผู้เล่นเก็บการ์ดไว้ในกล่อง')
key_cards = [f'<div class="card back">{room_svg(fl, rw)}</div>' for fl in range(1, MAX_FLOORS + 1) for rw in range(1, ROWS + 1)]
write('2-room-cards.html', page(
    'Hotel Murder - คีย์การ์ดห้องพัก',
    f'<h1 class="noprint">Hotel Murder — คีย์การ์ดห้องพัก {len(key_cards)} ใบ (9 ชั้น × 3 แถว)</h1><p class="note noprint">{KEY_NOTE}</p>' + sheets(key_cards)))
write('2-room-cards-duplex.html', page(
    'Hotel Murder - คีย์การ์ดห้องพัก (พิมพ์สองด้าน)',
    f'<h1 class="noprint">Hotel Murder — คีย์การ์ดห้องพัก พิมพ์สองด้าน</h1><p class="note noprint">{DUPLEX_NOTE} {KEY_NOTE}</p>'
    + duplex_sheets(key_cards, back=ROOM_BACK)))


# ---------------------------------------------------------------- board + host sheet
def board_svg():
    """Board after the real game: vertical day track on the left, red floor cards, teal room windows (each holds a 29 x 19 mm token)."""
    cw, ch, fw, dw = 180, 82, 110, 170              # room pitch, floor pitch, floor-card width, day-track width
    x0, y0 = dw + fw + 20, 120                       # first room column, first floor row
    W = x0 + ROWS * cw + 30
    gy1 = y0 + MAX_FLOORS * ch
    H = gy1 + 120
    RED, RED_HI, TEAL, TEAL_HI = '#5a1226', '#7a1a30', '#0d3a40', '#14525a'
    p = [f'<svg class="board" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" {FONT}>',
         f'<rect width="{W}" height="{H}" fill="#101614"/>',
         f'<rect x="10" y="10" width="{W - 20}" height="{H - 20}" fill="none" stroke="{GOLD}" stroke-width="3"/>',
         f'<rect x="20" y="20" width="{W - 40}" height="{H - 40}" fill="none" stroke="{GOLD}" stroke-width="1.2" opacity=".6"/>',
         f'<text x="{W / 2}" y="62" text-anchor="middle" font-size="44" font-weight="800" fill="{GOLD_HI}" letter-spacing="4">HOTEL MURDER</text>',
         f'<text x="{W / 2}" y="92" text-anchor="middle" font-size="19" fill="#f3e6bf" opacity=".85">เช็กอินได้ แต่ไม่มีใครเช็กเอาต์</text>']
    # day track: 4 slots, one per day (marker coin sits on the current day)
    slot = (MAX_FLOORS * ch) / DAYS
    for d in range(DAYS):
        cy = y0 + slot * d + slot / 2
        roman = ('I', 'II', 'III', 'IV')[d]
        p.append(f'<circle cx="{dw / 2 + 20}" cy="{cy}" r="62" fill="#0b1210" stroke="{GOLD}" stroke-width="4"/>'
                 f'<circle cx="{dw / 2 + 20}" cy="{cy}" r="52" fill="none" stroke="{GOLD}" stroke-width="1.2" opacity=".6"/>'
                 f'<text x="{dw / 2 + 20}" y="{cy + 4}" text-anchor="middle" font-size="44" font-weight="800" fill="{GOLD_HI}">{roman}</text>'
                 f'<text x="{dw / 2 + 20}" y="{cy + 30}" text-anchor="middle" font-size="18" fill="#f3e6bf">วันที่</text>')
    for fl in range(MAX_FLOORS, 0, -1):
        y = y0 + (MAX_FLOORS - fl) * ch
        fx = dw + 10
        p.append(f'<rect x="{fx}" y="{y + 4}" width="{fw}" height="{ch - 8}" rx="6" fill="{RED}" stroke="{GOLD}" stroke-width="2.4"/>'
                 f'<rect x="{fx + 5}" y="{y + 9}" width="{fw - 10}" height="{ch - 18}" rx="3" fill="none" stroke="{GOLD}" stroke-width=".9" opacity=".5"/>'
                 f'<text x="{fx + fw / 2}" y="{y + 20}" text-anchor="middle" font-size="11" fill="{GOLD_HI}" opacity=".8" letter-spacing="2">FLOOR {fl}</text>'
                 f'<text x="{fx + fw / 2}" y="{y + 62}" text-anchor="middle" font-size="30" font-weight="800" fill="#f3e6bf">ชั้น{fl}</text>')
        for rw in range(ROWS):
            x = x0 + rw * cw
            p.append(f'<rect x="{x}" y="{y + 4}" width="{cw - 10}" height="{ch - 8}" rx="6" fill="{TEAL}" stroke="{GOLD}" stroke-width="2.4"/>'
                     f'<rect x="{x + 5}" y="{y + 9}" width="{cw - 20}" height="{ch - 18}" rx="3" fill="none" stroke="{GOLD}" stroke-width=".9" opacity=".5"/>'
                     f'<text x="{x + 14}" y="{y + 28}" font-size="15" fill="{GOLD_HI}" opacity=".85">ห้อง</text>'
                     f'<text x="{x + 14}" y="{y + 62}" font-size="32" font-weight="700" fill="#e9dcb4">{fl}0{rw + 1}</text>')
    notes = ['ใช้ชั้น 1 ถึงชั้นเท่าจำนวนผู้เล่น · ชั้นที่เกิน วางป้าย “ปรับปรุง”',
             'ป้ายพบศพ/ฆาตกรรม/ห้องว่าง/ประชาทัณฑ์ วางบนช่องห้อง · วางตัวบอกวันบนวันปัจจุบัน']
    for i, t in enumerate(notes):
        p.append(f'<text x="{W / 2}" y="{gy1 + 40 + i * 30}" text-anchor="middle" font-size="19" fill="#f3e6bf">{t}</text>')
    p.append('</svg>')
    return ''.join(p)


NIGHT_ORDER = [(1, 'ช่างกุญแจ', 'ล็อก 1 ห้อง'), (2, 'แม่บ้าน', 'นับคนในชั้น'), (3, 'ช่างเช็ดกระจก', 'นับคนในแถว'),
               (4, 'นักสืบ', 'รู้ชั้น 1 คน'), (5, 'ทีมฆาตกร', 'ผู้ช่วยรู้ชั้น · ฆาตกรเลือกห้อง'), (6, 'พยาน', 'เฝ้า 1 ชั้น')]
LOG_HEAD = ['วัน', 'ห้องที่ล็อก (ห้ามซ้ำคืนก่อน)', 'ฆาตกรเลือกห้อง', 'ผลเมื่อเช้า (ตาย / ว่าง / ล็อก)', 'ห้องที่เสนอ → โหวต', 'ผลการบุก']


def hhead(title, sub):
    return f'<div class="hh"><div class="t">{E(title)}</div><div class="s">{E(sub)}</div></div>'


def host_sheet():
    order = ''.join(f'<div class="step"><b>{n}</b><span>{E(a)}</span><i>{E(b)}</i><u></u></div>' for n, a, b in NIGHT_ORDER)
    order = order.replace('repeat(7', 'repeat(6')
    log = ('<table class="ht"><tr>' + ''.join(f'<th>{E(h)}</th>' for h in LOG_HEAD) + '</tr>'
           + ''.join(f'<tr style="height:15mm"><td class="day">{i}</td>' + '<td></td>' * (len(LOG_HEAD) - 1) + '</tr>' for i in range(1, DAYS + 1)) + '</table>')
    reg = ('<table class="ht"><tr>' + ''.join(f'<th>{h}</th>' for h in ['ผู้เล่น', 'ห้อง', 'บทบาท', 'สถานะ (ออกจากเกมวันไหน/คืนไหน)']) + '</tr>'
           + ''.join('<tr style="height:9mm">' + '<td></td>' * 4 + '</tr>' for _ in range(max(SETUP))) + '</table>')
    return ('<div class="host">' + hhead('HOTEL MURDER', 'ใบบันทึกของโฮสต์')
            + '<div class="track"><span>จำนวนผู้เล่น ____ (ชั้น 1-____)</span><span>ห้องที่พบศพตอนเริ่ม ____ ____ ____</span>'
              '<span>ห้องที่ล็อกคืนก่อน ____ (คืนนี้ห้ามซ้ำ)</span></div>'
            f'<h3>ลำดับกลางคืน (เรียกทุกบทแม้ตายแล้วหรือไม่มีในเกม เพื่อไม่ให้ใครรู้)</h3><div class="steps" style="grid-template-columns:repeat(6,1fr)">{order}</div>'
            f'<h3>บันทึกรายวัน (วัน 1-{DAYS} · วัน 1 ยังไม่มีคืนก่อน)</h3>{log}'
            f'<h3>ทะเบียนห้อง</h3>{reg}</div>')


write('3-board-and-host-sheet.html', page(
    'Hotel Murder - กระดานและใบบันทึกโฮสต์',
    single('<div style="text-align:center">' + board_svg() + '</div>') + single(host_sheet())))


# ---------------------------------------------------------------- post-game sheet
def postgame_sheet():
    def ck(t):
        return f'<span class="ck">☐ {E(t)}</span>'

    def ln(label, w=22):
        return f'<span class="fl">{E(label)} <i class="ln" style="min-width:{w}mm"></i></span>'

    def rate(label):
        return f'<div class="rt"><span>{E(label)}</span><b>① ② ③ ④ ⑤</b></div>'

    def box(label, h=17):
        return f'<div class="bl">{E(label)}</div><div class="bx" style="height:{h}mm"></div>'

    return ('<div class="host">' + hhead('HOTEL MURDER', 'ใบสรุปหลังเกม (1 ใบต่อ 1 เกม)')
            + f'<div class="row">{ln("เกมที่", 12)}{ln("วันที่เล่น", 26)}{ln("จำนวนผู้เล่น", 14)}{ln("โฮสต์", 30)}</div>'
            '<h3>ผลเกม</h3>'
            f'<div class="row"><b>ฝ่ายที่ชนะ</b>{ck("ฝ่ายบริสุทธิ์")}{ck("ฝ่ายฆาตกร")}</div>'
            f'<div class="row"><b>ชนะด้วย</b>{ck("บุกห้องฆาตกรสำเร็จ")}{ck("ฆาตกรรอดครบ 4 วัน")}{ck("ฝ่ายฆาตกรเท่ากับผู้บริสุทธิ์ที่เหลือ")}</div>'
            f'<div class="row">{ln("จบวันที่", 12)}{ln("เวลารวม (นาที)", 14)}{ln("บุกผิดห้องกี่ครั้ง", 12)}{ln("วันที่ไม่มีใครถูกบุก (เสียงไม่ถึงครึ่ง)", 12)}</div>'
            '<h3>เหตุการณ์ระหว่างเกม</h3>'
            f'<div class="row">{ln("ช่างกุญแจล็อกถูกห้องกี่คืน", 12)}{ln("ฆาตกรเลือกห้องว่างกี่คืน", 12)}{ln("ถามกติกาซ้ำกี่ครั้ง", 12)}</div>'
            f'<div class="row"><b>ผู้ช่วยสวมบทบาทแล้วฝ่ายดีเชื่อ</b>{ck("ใช่")}{ck("ไม่")}{ck("ไม่มีผู้ช่วยตายก่อน")}'
            f'<b>ผู้ช่วยตายก่อนฆาตกร</b>{ck("ใช่")}{ck("ไม่")}</div>'
            f'<div class="row"><b>ตายคืนแรกแล้วรู้สึกเสียเปรียบ</b>{ck("ใช่")}{ck("ไม่")}{ck("ไม่มีใครตายคืนแรก")}</div>'
            '<h3>สกิลที่ช่วยตัดสินการโหวตจริง</h3>'
            f'<div class="row">{ck("ช่างกุญแจ")}{ck("แม่บ้าน")}{ck("ช่างเช็ดกระจก")}{ck("นักสืบ")}{ck("พยาน")}{ck("ผู้ช่วย (บลัฟ)")}{ck("ไม่มีสกิลไหนช่วยเลย")}</div>'
            '<h3>คะแนน (วงกลมเลขเดียว: 1 = แย่ · 5 = ดีมาก)</h3>'
            + rate('ความสนุกโดยรวม') + rate('ความเข้าใจกติกา') + rate('ความตึงเครียด / อยากรู้ว่าใครเป็นฆาตกร')
            + rate('ความยุติธรรมของฝ่ายบริสุทธิ์') + rate('ความยุติธรรมของฝ่ายฆาตกร')
            + f'<div class="row"><b>ความเร็วของเกม</b>{ck("ช้าไป")}{ck("พอดี")}{ck("เร็วไป")}{ln("อยากเล่นอีก (กี่คน จากกี่คน)", 18)}</div>'
            + '<h3>ความรู้สึก</h3>'
            + box('ช่วงที่สนุกที่สุด') + box('ช่วงที่สับสน น่าเบื่อ หรือรู้สึกไม่แฟร์') + box('อยากปรับอะไร (เช่น ค่าที่คลิปไม่ได้บอก ดูตาราง B ใน docs/RULES_FROM_VIDEO_TH.md)', 19)
            + '</div>')


write('5-postgame-sheet.html', page('Hotel Murder - ใบสรุปหลังเกม', single(postgame_sheet())))


# ---------------------------------------------------------------- player guide (1 page)
def player_guide():
    flow = ''.join(f'<div><b>{E(a)}</b>{E(b)}</div>' for a, b in [
        ('1 กลางวัน', 'อภิปราย (โกหกได้) เสนอห้อง ยกมือโหวตพร้อมกัน 3-2-1'),
        ('2 บุกห้อง', 'ห้องที่ได้มากกว่าครึ่งถูกบุก ห้องว่างปิด คนในห้องออกจากเกม'),
        ('3 กลางคืน', 'ทุกคนหลับตา แต่ละบทลืมตาตามลำดับ ฆาตกรเลือกห้องลงมือ'),
        ('4 เช้า', 'โฮสต์ประกาศผลที่ห้องนั้น แล้วเริ่มกลางวันถัดไป')])
    role_rows = ''.join(
        f'<tr><td><b>{E(r[1])}</b></td><td>{E(r[2])}</td><td>{E(SHORT[r[0]].replace(chr(10), " "))}</td></tr>' for r in ROLES)
    return ('<div class="host">' + hhead('HOTEL MURDER', 'คู่มือผู้เล่น (อ่านจบใน 3 นาที)')
            + '<h3>เป้าหมาย</h3><div class="two">'
              f'<div class="box2"><b>ฝ่ายบริสุทธิ์ชนะ</b> เมื่อรุมบุกห้องของฆาตกรได้ภายใน {DAYS} วัน</div>'
              f'<div class="box2"><b>ฝ่ายฆาตกรชนะ</b> เมื่อฆาตกรรอดครบ {DAYS} วัน หรือเมื่อจำนวนฝ่ายฆาตกร (ฆาตกร + ผู้ช่วย) เท่ากับผู้บริสุทธิ์ที่เหลือ</div></div>'
            + f'<h3>1 รอบเกม</h3><div class="flow">{flow}</div>'
            + '<h3>โรงแรมและห้อง</h3><div class="two">'
              f'<div class="box2">โรงแรมมี 3 ห้องต่อชั้น (แถว 1-3) เลขห้อง = ชั้น + แถว เช่น 402 = ชั้น 4 แถว 2 ใช้กี่ชั้นเท่าจำนวนผู้เล่น '
              f'<b>คีย์การ์ดห้องของคุณเป็นความลับ</b> ตอนเริ่มมี {CORPSES} ห้องที่พบศพ ไม่มีใครพักห้องเหล่านั้น</div>'
              '<div class="box2"><b>ห้องที่ปิด</b> คือห้องที่พบศพ ห้องว่างที่ถูกฆาตกรบุกหรือถูกรุมบุก ห้องที่ถูกประชาทัณฑ์ และห้องของคนที่ออกจากเกม ห้องที่ปิดแล้วเสนอบุกหรือลงมือไม่ได้อีก</div></div>'
            + '<h3>การโหวตกลางวัน</h3><div class="two">'
              '<div class="box2">ทุกคนเสนอห้องได้ไม่เกินคนละ 1 ห้อง โฮสต์ไล่ห้องที่เสนอจากเลขน้อยไปมาก ทุกคนที่ยังอยู่ยกมือพร้อมกัน '
              '<b>ห้องแรกที่ได้มากกว่าครึ่งของคนที่ยังอยู่</b>ถูกบุก ถ้าไม่มีห้องไหนถึง วันนั้นไม่มีใครถูกบุก</div>'
              '<div class="box2"><b>เปิดห้องที่ถูกบุก</b> ห้องว่าง = ปิดห้อง · มีคนอยู่ = ประชาทัณฑ์ เจ้าของคืนคีย์การ์ดและออกจากเกม (ไม่เปิดบทบาท) · เป็นห้องฆาตกร = <b>ฝ่ายบริสุทธิ์ชนะทันที</b></div></div>'
            + '<h3>บทบาท</h3><table class="ht txt"><tr><th>บทบาท</th><th>ฝ่าย</th><th>สกิลกลางคืน</th></tr>' + role_rows + '</table>'
            + '<h3>ควรจำ</h3><div class="box2">'
              '• โกหกได้ทุกเรื่อง อ้างบทบาทและผลสกิลปลอมได้ บทบาทของคนที่ออกจากเกมไม่เปิดเผย ใครก็อ้างเป็นบทนั้นได้ '
              '• ผู้ช่วยฆาตกรสวมบทบาทอะไรก็ได้ถ้าไม่มีใครแย้ง ข้อมูลที่ขัดกันแปลว่ามีคนโกหกอย่างน้อยหนึ่งคน '
              '• ผู้ที่ออกจากเกมพูดและโหวตไม่ได้ '
              '• เก็บข้อมูลไว้ก่อนแล้วเปิดตอนที่จำเป็น คำพูดที่เผยชั้นของตัวเองอาจช่วยฆาตกร</div></div>')


write('6-player-guide.html', page('Hotel Murder - คู่มือผู้เล่น', single(player_guide())))


# ---------------------------------------------------------------- host script (2 pages)
HOST_NIGHT = [
    ('“ทุกคนหลับตา คืนที่ N ของโรงแรมมรณะเริ่มขึ้น”', 'รอ 3 วินาที'),
    ('“ช่างกุญแจ ลืมตา เลือกห้องที่จะล็อก”', 'ช่างกุญแจชี้ห้อง (ห้องที่ยังเปิด ห้ามซ้ำคืนก่อน ล็อกห้องตัวเองได้) โฮสต์จดไว้ “ช่างกุญแจ หลับตา”'),
    ('“แม่บ้าน ลืมตา เลือกชั้น”', 'โฮสต์นับผู้เล่นที่ยังมีชีวิตในชั้นนั้น (รวมตัวแม่บ้านเอง) แล้วชูนิ้วบอก “แม่บ้าน หลับตา”'),
    ('“ช่างเช็ดกระจก ลืมตา เลือกแถว”', 'ทำเหมือนแม่บ้านแต่นับตามแถวแนวตั้ง (ทุกชั้น) “ช่างเช็ดกระจก หลับตา”'),
    ('“นักสืบ ลืมตา เลือกผู้เล่นที่จะสืบ”', 'โฮสต์ชูนิ้วบอก “ชั้น” ที่คนนั้นพัก ไม่บอกแถว “นักสืบ หลับตา”'),
    ('“ผู้ช่วยกับฆาตกร ลืมตา”', 'ผู้ช่วยชี้ผู้เล่น 1 คน โฮสต์ชูนิ้วบอกชั้น แล้วฆาตกรชี้ห้องที่จะลงมือ (ห้ามห้องตัวเอง ห้องผู้ช่วย ห้องที่ปิด) '
                              'โฮสต์จดห้องไว้ ทีมสื่อสารเงียบๆ ได้ “ผู้ช่วยกับฆาตกร หลับตา”'),
    ('“พยาน ลืมตา เลือกชั้นที่จะเฝ้า”', 'ถ้าตรงกับชั้นที่ฆาตกรเลือก ชี้ขึ้น (ห้องฆาตกรสูงกว่า) / ลง (ต่ำกว่า) / ตรง (ชั้นเดียวกัน) '
                                      'ถ้าไม่ตรงไม่บอกอะไร ชี้แม้ห้องนั้นถูกล็อก “พยาน หลับตา”'),
    ('“ทุกคนลืมตา ฟ้าสางแล้ว 3-2-1”', 'ประกาศผลตามหัวข้อรุ่งเช้า'),
]


def host_script():
    rows = ''.join(f'<tr><td style="width:62mm"><b>{E(a)}</b></td><td>{E(b)}</td></tr>' for a, b in HOST_NIGHT)
    li = lambda items: '<ul class="gl">' + ''.join(f'<li>{t}</li>' for t in items) + '</ul>'
    page1 = ('<div class="host">' + hhead('HOTEL MURDER', 'สคริปต์โฮสต์ (1/2) · เตรียมเกมและกลางคืน')
             + '<p class="box2">พูดด้วยน้ำเสียงเรียบๆ และ <b>เรียกทุกบทตามจังหวะเท่ากัน แม้บทนั้นตายไปแล้วหรือไม่มีในเกม</b> เพื่อไม่ให้ใครรู้ว่าใครตาย</p>'
             + '<h3>เตรียมเกม</h3>' + li([
                 'ใช้ชั้น 1 ถึงชั้นเท่าจำนวนผู้เล่น วางป้าย “ปรับปรุง” บนชั้นที่เหลือ',
                 f'สุ่ม {CORPSES} ห้องที่พบศพจากชั้นที่ใช้ วางป้าย “พบศพ” ประกาศเลขห้อง แล้วแจกคีย์การ์ดห้องคว่ำคนละ 1 ใบจากห้องที่เหลือ (ใบที่เหลือคือห้องว่าง)',
                 'แจกการ์ดบทบาทลับ (6 คน ไม่มีช่างเช็ดกระจก · 8 คนเพิ่มแขก 1 · 9 คนเพิ่มแขก 2)',
                 '“ทุกคนหลับตา” เรียกแต่ละบทให้ลืมตาดูการ์ด แล้ว “ผู้ช่วยกับฆาตกรลืมตา ชูคีย์การ์ดให้เห็นกัน” ทุกคนหลับตา “ลืมตาพร้อมกัน 3-2-1”',
                 'เริ่มที่ <b>วัน 1</b> (ยังไม่มีเหตุการณ์เมื่อคืน)'])
             + '<h3>คืนที่ N (หลังวัน 1, 2, 3)</h3><table class="ht txt"><tr><th>โฮสต์พูด</th><th>ทำอะไร</th></tr>' + rows + '</table></div>')
    page2 = ('<div class="host">' + hhead('HOTEL MURDER', 'สคริปต์โฮสต์ (2/2) · เช้า กลางวัน และข้อควรระวัง')
             + '<h3>รุ่งเช้า (วัน 2 ขึ้นไป)</h3>' + li([
                 '“เมื่อคืนฆาตกรบุกไปที่ชั้น X ห้อง XXX” แล้วบอกอย่างใดอย่างหนึ่ง',
                 '<b>มีคนอยู่:</b> “ห้องนี้มีผู้เสียชีวิต กรุณาคืนคีย์การ์ด” (ไม่เปิดบทบาท) วางป้ายฆาตกรรม ห้องปิด',
                 '<b>ห้องว่าง:</b> “ห้องนี้ไม่มีคนอยู่” วางป้ายห้องว่าง',
                 '<b>ช่างกุญแจล็อกห้องนั้น:</b> “ประตูห้องนี้ล็อกอยู่ ลงมือไม่สำเร็จ” ห้องไม่ปิด',
                 'ตรวจเงื่อนไขชนะ: ฝ่ายฆาตกรเท่ากับผู้บริสุทธิ์ที่เหลือหรือไม่'])
             + '<h3>กลางวัน</h3>' + li([
                 '“เริ่มอภิปรายได้เลย” พลิกนาฬิกาทราย (ในแอปตั้งไว้ 4 นาที) หมดเวลา: “ขอเลขห้องที่จะรุมบุก 1 ห้อง”',
                 'ทุกคนเสนอได้คนละไม่เกิน 1 ห้อง (ห้องที่ปิดแล้วเสนอไม่ได้) โฮสต์ไล่ห้องจากเลขน้อยไปมาก “ถ้าเลือกบุกห้อง XXX ยกมือพร้อมกัน 3-2-1”',
                 'ห้องแรกที่ได้ <b>มากกว่าครึ่งของคนที่ยังอยู่</b> ถูกบุก ไม่มีห้องไหนถึง: “วันนี้ไม่มีใครถูกบุก”',
                 'เปิดห้อง: <b>ว่าง</b> → “ห้องนี้ว่าง” วางป้ายห้องว่าง · <b>มีคนอยู่</b> → วางป้ายประชาทัณฑ์ “กรุณาคืนคีย์การ์ดและออกจากเกม” (ไม่เปิดบทบาท) ตรวจเงื่อนไขชนะฝ่ายฆาตกร · '
                 '<b>ห้องฆาตกร</b> → “ฝ่ายบริสุทธิ์ชนะ!”',
                 f'จบวัน {DAYS} โดยไม่เจอห้องฆาตกร → “ฆาตกรหนีไปได้ ฝ่ายฆาตกรชนะ” มิฉะนั้นไปคืนถัดไป (วัน 1-3 มีคืนต่อท้าย วัน {DAYS} เป็นโอกาสสุดท้าย)'])
             + '<h3>หลังจบเกม</h3>' + li(['เปิดเผยบทบาทและห้องของทุกคน ย้อนดูใบบันทึกว่าคืนไหนล็อกห้องไหน ฆาตกรเลือกห้องไหน',
                                         'กรอกใบสรุปหลังเกม 1 ใบต่อ 1 เกม'])
             + '<h3>ข้อควรระวังของโฮสต์</h3>' + li([
                 '<b>เรียงลำดับให้ถูก</b> พยานเรียกหลังฆาตกรเสมอ เพราะต้องเทียบกับห้องที่ฆาตกรเลือก',
                 'ผู้เล่นที่ออกจากเกมแล้ว ยังต้องเรียกตามจังหวะเดิม โฮสต์ <b>ไม่ให้ข้อมูลจริง</b> ผู้ที่ออกจากเกมห้ามตอบสนอง',
                 'แม่บ้านและช่างเช็ดกระจกนับเฉพาะคนที่ยังมีชีวิต ณ ตอนนั้น (ก่อนผลของคืนนั้น) รวมตัวเอง',
                 'โฮสต์ <b>ห้ามเผลอพูดตัวเลขหรือคำตอบดังๆ</b> ใช้นิ้วเสมอ',
                 'ที่ต้องจดไว้: ห้องที่ล็อกของคืนก่อน · ห้องที่ปิด · ผู้ที่ออกจากเกม · เลขวัน']) + '</div>')
    return single(page1) + single(page2)


write('7-host-script.html', page('Hotel Murder - สคริปต์โฮสต์', host_script()))


# ---------------------------------------------------------------- tokens (sized to the board's room windows: ~29 x 19 mm)
def tok(cls, text, n):
    return ''.join(f'<div class="tok {cls}">{E(text)}</div>' for _ in range(n))


# tokens follow the real board: พบศพ (grey) = corpse rooms at the start, ฆาตกรรม (red) = killed at night,
# ห้องว่าง (green) = empty room found, ประชาทัณฑ์ (orange) = room the group raided that held an innocent
write('4-tokens.html', page(
    'Hotel Murder - ป้ายและตัวบอก',
    single('<h1>Hotel Murder — ป้ายและตัวบอก (ตัดตามเส้น)</h1>'
           '<p class="note">ป้ายสี่เหลี่ยมขนาดเท่าช่องห้องบนกระดาน (ประมาณ 29×19 มม.) พิมพ์ที่ A4 ขนาด 100% เปิดพิมพ์พื้นหลัง</p>'
           f'<h3>พบศพ — {CORPSES} ห้องที่พบศพตอนเริ่มเกม ({CORPSES} ป้าย)</h3><div class="toks">' + tok('dead', 'พบศพ', CORPSES) + '</div>'
           '<h3>ฆาตกรรม — ห้องที่ฆาตกรสังหารตอนกลางคืน (3 ป้าย)</h3><div class="toks">' + tok('kill', 'ฆาตกรรม', 3) + '</div>'
           f'<h3>ห้องว่าง — ห้องว่างที่ถูกบุก หรือที่ฆาตกรบุกแล้วไม่มีคน ({DAYS + 3} ป้าย)</h3><div class="toks">' + tok('empty', 'ห้องว่าง', DAYS + 3) + '</div>'
           f'<h3>ประชาทัณฑ์ — ห้องที่รุมบุกแล้วพบผู้บริสุทธิ์ เจ้าของออกจากเกม ({DAYS} ป้าย)</h3><div class="toks">' + tok('lynch', 'ประชาทัณฑ์', DAYS) + '</div>'
           '<h3>ล็อก — ห้องที่ช่างกุญแจล็อกคืนนี้ (2 ป้าย: คืนนี้กับคืนก่อน)</h3><div class="toks">' + tok('lock', 'ล็อก', 2) + '</div>'
           f'<h3>ปรับปรุง — ชั้นที่เกินจำนวนผู้เล่น วางทับช่องห้อง (6 คนปิดชั้น 7-9 = {(MAX_FLOORS - min(SETUP)) * ROWS} ป้าย)</h3><div class="toks">'
           + tok('off', 'ปรับปรุง', (MAX_FLOORS - min(SETUP)) * ROWS) + '</div>'
           '<h3>ตัวบอกวัน (วางบนวงกลมวันที่)</h3><div class="toks"><div class="coin sun"></div></div>')))

print('built:', sorted(os.listdir(PRINT)))
