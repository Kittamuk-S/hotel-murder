#!/usr/bin/env python3
"""Hotel Murder - clue variant (host-less, rules 1.0 core). Builds data CSVs and print sheets from one source of truth.

Board, key cards and room tokens are NOT built here: use ../print (python ../tools/build.py).
Run:  python tools/build.py
Writes data/profiles.csv, data/clues.csv and print/*.html (A4, 100%, background graphics ON).
"""
import csv
import html
import itertools
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
PRINT = os.path.join(ROOT, 'print')
os.makedirs(DATA, exist_ok=True)
os.makedirs(PRINT, exist_ok=True)
E = html.escape
NIGHTS = 3          # rules 1.0: day 1 -> night 1 -> day 2 -> night 2 -> day 3 -> night 3 -> day 4

# ---------------------------------------------------------------- content
TRAITS = [
    # key, Thai name, four values (value, clue text found at the scene)
    ('color', 'สีเสื้อผ้า', [
        ('แดง', 'เศษผ้าสีแดงติดอยู่ที่ขอบประตู'),
        ('น้ำเงิน', 'ใยผ้าสีน้ำเงินเข้มบนพนักเก้าอี้'),
        ('เขียว', 'รอยเปื้อนผ้าสีเขียวบนผ้าม่าน'),
        ('เหลือง', 'ด้ายสีเหลืองสดหลุดอยู่บนพื้น')]),
    ('item', 'ของติดตัว', [
        ('กุญแจทองเหลือง', 'รอยขีดข่วนแบบกุญแจทองเหลืองที่ลูกบิด'),
        ('ร่มสีดำ', 'หยดน้ำรูปปลายร่มสีดำพิงผนัง'),
        ('แว่นตา', 'เลนส์แว่นแตกชิ้นเล็กใต้โต๊ะ'),
        ('ถุงมือหนัง', 'รอยนิ้วถุงมือหนังบนมือจับ')]),
    ('shoes', 'รองเท้า', [
        ('ส้นสูง', 'รอยส้นสูงเล็กๆ บนพรม'),
        ('บูทหนัง', 'รอยบูทหนังเปื้อนโคลนที่ธรณีประตู'),
        ('ผ้าใบ', 'รอยผ้าใบพื้นยางสีขาวบนกระเบื้อง'),
        ('รองเท้าแตะโรงแรม', 'รอยรองเท้าแตะเปียกน้ำเป็นทางยาว')]),
    ('scent', 'กลิ่นติดตัว', [
        ('กุหลาบ', 'กลิ่นกุหลาบอ่อนๆ ค้างอยู่ในอากาศ'),
        ('ไม้จันทน์', 'กลิ่นไม้จันทน์ติดผ้าม่าน'),
        ('ควันบุหรี่', 'กลิ่นควันบุหรี่จางๆ ในห้อง'),
        ('สบู่เลมอน', 'กลิ่นสบู่เลมอนบนผ้าเช็ดตัวที่ทิ้งไว้')]),
]

# Nine guest profiles (rules 1.0 allow 6-9 players). Any two guests share at most ONE value, so two clues of different
# traits that both match one guest point to exactly that guest. Value counts per trait are 3,2,2,2 (no 9-set can be perfectly even).
GUESTS = [
    # code, name, job, one-line flavour, (color, item, shoes, scent) as value indexes
    ('A', 'ธนากร ศิริเวช', 'นักธุรกิจโรงแรม', 'ติดค้างหนี้ใครบางคนมานาน', (0, 0, 0, 0)),
    ('B', 'วรรณา ใจดี', 'นักข่าวสืบสวน', 'มาพักเพื่อตามข่าวใหญ่', (0, 1, 1, 1)),
    ('C', 'ดร.กิตติ พงศ์ไพศาล', 'แพทย์ศัลยกรรม', 'พกกระเป๋าใบเล็กไม่ห่างตัว', (0, 2, 2, 2)),
    ('D', 'มาริโอ รอสซี', 'เชฟระดับดาว', 'ชอบเข้าครัวตอนดึก', (1, 0, 1, 2)),
    ('E', 'ปริม ภัทรา', 'ดาราสาวมาพักผ่อน', 'หนีผู้จัดการส่วนตัวมา', (1, 1, 0, 3)),
    ('F', 'พอล แจ็คสัน', 'นักดนตรีแจ๊ส', 'เล่นเปียโนที่ล็อบบี้ทุกคืน', (2, 0, 2, 1)),
    ('G', 'จินตนา แสนสุข', 'แม่บ้านประจำชั้น 13', 'มีกุญแจทุกห้อง', (2, 3, 3, 0)),
    ('H', 'สมชาย มั่นคง', 'อดีตตำรวจ เกษียณแล้ว', 'ไม่เคยเลิกสงสัยทุกคน', (3, 2, 3, 1)),
    ('I', 'ภูผา ทองสุข', 'ไกด์นำเที่ยว', 'จำได้ทุกซอกทุกมุมของเมือง', (3, 3, 1, 3)),
]

# players -> (killer, accomplice, guests)
ROLE_SPLIT = {6: (1, 0, 5), 7: (1, 0, 6), 8: (1, 1, 6), 9: (1, 1, 7)}


def verify():
    assert len(GUESTS) == 9
    for t in range(4):
        counts = sorted(sum(g[4][t] == v for g in GUESTS) for v in range(4))
        assert counts == [2, 2, 2, 3], (t, counts)
    for a, b in itertools.combinations(GUESTS, 2):
        shared = sum(x == y for x, y in zip(a[4], b[4]))
        assert shared <= 1, (a[0], b[0], shared)
    for n, split in ROLE_SPLIT.items():
        assert sum(split) == n


verify()


def write_csv(name, header, rows):
    with open(os.path.join(DATA, name), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


write_csv('profiles.csv', ['code', 'name', 'job', 'flavour'] + [t[1] for t in TRAITS],
          [[g[0], g[1], g[2], g[3]] + [TRAITS[i][2][g[4][i]][0] for i in range(4)] for g in GUESTS])
write_csv('clues.csv', ['trait', 'value', 'clue_text'], [[t[1], v[0], v[1]] for t in TRAITS for v in t[2]])

# ---------------------------------------------------------------- print sheets
CSS = """
@page { size: A4; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Noto Sans Thai', 'Tahoma', sans-serif; background: #fff; color: #1a1410; }
h1 { font-size: 16px; margin: 4mm 0 2mm; }
.note { font-size: 11px; color: #555; margin: 0 0 3mm; }
.sheet { display: grid; grid-template-columns: repeat(3, 63mm); gap: 3mm; justify-content: center; page-break-after: always; }
.card { width: 63mm; height: 88mm; border: 1.2px solid #222; border-radius: 3mm; padding: 4mm; position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 2mm; background: #fbf5e6; }
.card .code { position: absolute; right: 3mm; top: 2mm; font-weight: 700; font-size: 20px; opacity: .25; }
.card h2 { margin: 0; font-size: 15px; line-height: 1.25; }
.card .sub { font-size: 11px; color: #6a5a46; }
.card .flav { font-size: 10.5px; font-style: italic; color: #5a4a36; }
.trait { display: flex; justify-content: space-between; border-top: 1px dashed #b8a98a; padding-top: 1.2mm; font-size: 12px; }
.trait b { color: #7a1f1a; }
.clue { background: #f3ece0; }
.clue .big { font-size: 13px; line-height: 1.5; margin-top: 2mm; }
.clue .tag { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 8px; color: #fff; align-self: flex-start; }
.c-color .tag { background: #a3302a; } .c-item .tag { background: #2c5687; } .c-shoes .tag { background: #47702a; } .c-scent .tag { background: #7a5a1a; }
.rolecard { background: #1c1520; color: #f1e3bf; justify-content: center; text-align: center; }
.rolecard.guest { background: #f1e8d4; color: #1a1410; }
.rolecard h2 { font-size: 22px; }
.toks { display: flex; flex-wrap: wrap; gap: 2.5mm; margin: 1.5mm 0 4mm; }
.coin { width: 26mm; height: 26mm; border-radius: 50%; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; font-weight: 800; border: .5mm solid #0b1020; outline: .3mm solid #c9a24a; outline-offset: -1.6mm; line-height: 1.3; }
.coin.lab { background: #2c5687; color: #fff; } .coin.cam { background: #0f5a43; color: #fff; } .coin.cover { background: #2b2b30; color: #e9c46a; }
h3 { font-size: 13px; margin: 3mm 0 1.5mm; border-bottom: .4mm solid #c9a24a; }
table.nt { width: 190mm; border-collapse: collapse; font-size: 13px; }
table.nt th, table.nt td { border: 1px solid #222; padding: 3px; }
table.nt th { background: #eee; }
@media screen { body { padding: 8px; background: #eee; } .sheet { background: #fff; padding: 6mm; margin-bottom: 8px; } }
"""


def page(title, body):
    return f'<!doctype html><html lang="th"><head><meta charset="utf-8"><title>{E(title)}</title><style>{CSS}</style></head><body>{body}</body></html>'


def write(name, content):
    with open(os.path.join(PRINT, name), 'w', encoding='utf-8') as f:
        f.write(content)


def sheets(cards, per=9):
    return ''.join('<div class="sheet">' + ''.join(cards[i:i + per]) + '</div>' for i in range(0, len(cards), per))


def single(inner):
    return '<div class="sheet" style="display:block">' + inner + '</div>'


def profile_card(g):
    rows = ''.join(f'<div class="trait"><span>{E(TRAITS[i][1])}</span><b>{E(TRAITS[i][2][g[4][i]][0])}</b></div>' for i in range(4))
    return (f'<div class="card"><span class="code">{g[0]}</span><h2>{E(g[1])}</h2><div class="sub">{E(g[2])}</div>'
            f'<div class="flav">{E(g[3])}</div><div style="flex:1"></div>{rows}</div>')


def clue_card(trait, value, text):
    return (f'<div class="card clue c-{trait[0]}"><span class="tag">{E(trait[1])}</span>'
            f'<h2>{E(value)}</h2><div class="big">{E(text)}</div></div>')


ROLE_CARDS = {
    'killer': ('', 'ฆาตกร', 'อ่านการ์ดนี้คนเดียว รอดครบ 4 วัน หรือทำให้ฆาตกรเท่ากับผู้บริสุทธิ์ที่เหลือ'),
    'accomplice': ('', 'ผู้ช่วยฆาตกร', 'ชูคีย์การ์ดให้ฆาตกรเห็นกัน และวางหลักฐานปลอมเพิ่มได้คืนละ 1 ใบ'),
    'guest': (' guest', 'แขกผู้พัก', 'คุณบริสุทธิ์ ช่วยกันหาห้องของฆาตกร'),
}


def role_card(kind):
    cls, name, sub = ROLE_CARDS[kind]
    return f'<div class="card rolecard{cls}"><h2>{E(name)}</h2><div class="sub">{E(sub)}</div></div>'


profiles = [profile_card(g) for g in GUESTS]
roles = [role_card('killer'), role_card('accomplice')] + [role_card('guest')] * 7
split_txt = ' · '.join(f'{n} คน: ฆาตกร {k} ผู้ช่วย {a} แขก {g}' for n, (k, a, g) in ROLE_SPLIT.items())
write('1-profiles-and-roles.html', page(
    'Hotel Murder (โหมดหลักฐาน) - แขกผู้พักและบทบาท',
    f'<h1>การ์ดแขกผู้พัก 9 ใบ และการ์ดบทบาทลับ 9 ใบ</h1><p class="note">เล่น 6-9 คน: ใช้การ์ดแขก A, B, C… จำนวนเท่าคนเล่น บทบาท: {E(split_txt)}</p>'
    + sheets(profiles + roles)))

clue_cards = [clue_card(t, v[0], v[1]) for t in TRAITS for v in t[2]] * 2   # two sets: real set and scapegoat set may share a card
write('2-clues.html', page(
    'Hotel Murder (โหมดหลักฐาน) - การ์ดหลักฐาน',
    '<h1>การ์ดหลักฐาน 16 แบบ × 2 ชุด (32 ใบ)</h1>'
    '<p class="note">สีเดียวกัน = ประเภทเดียวกัน (สีเสื้อผ้า ของติดตัว รองเท้า กลิ่นติดตัว) พิมพ์หลังเป็นลายเดียวกัน ใช้เฉพาะฆาตกรกับผู้ช่วย</p>' + sheets(clue_cards)))


def coin(cls, text, n):
    return ''.join(f'<div class="coin {cls}">{text}</div>' for _ in range(n))


write('3-coins.html', page(
    'Hotel Murder (โหมดหลักฐาน) - เหรียญ',
    single('<h1>เหรียญ (ตัดตามเส้น)</h1>'
           '<h3>เหรียญแล็บ — ตรวจหลักฐาน 1 ใบ ผลออกเช้าวันถัดไป (3 เหรียญ)</h3><div class="toks">' + coin('lab', 'แล็บ', 3) + '</div>'
           '<h3>เหรียญกล้องวงจรปิด — ผู้เล่น 1 คนต้องบอกชั้นที่พักตามจริง (3 เหรียญ)</h3><div class="toks">' + coin('cam', 'กล้อง', 3) + '</div>'
           '<h3>เหรียญปกปิด — ของฆาตกรเท่านั้น ใช้ตอบผลแล็บว่า “ไม่ชัดเจน” (2 เหรียญ)</h3><div class="toks">' + coin('cover', 'ปกปิด', 2) + '</div>')))

HEAD = ['คืน', 'ห้องที่ถูกฆาตกรบุก', 'ผล (ตาย / ว่าง)', 'หลักฐาน 2 ใบ (ใบไหนจริง?)', 'ผลแล็บ / กล้อง']
cases = ('<table class="nt"><tr>' + ''.join(f'<th>{E(h)}</th>' for h in HEAD) + '</tr>'
         + ''.join(f'<tr style="height:17mm"><td style="text-align:center;font-weight:700">{i}</td>' + '<td></td>' * (len(HEAD) - 1) + '</tr>' for i in range(1, NIGHTS + 1))
         + '</table>')
suspects = ('<table class="nt"><tr><th>แขก</th>' + ''.join(f'<th>{E(t[1])}</th>' for t in TRAITS) + '<th>ชั้นที่พัก (จากกล้อง / คำบอกเล่า)</th><th>ห้องที่คาด</th></tr>'
            + ''.join(f'<tr style="height:10mm"><td>{g[0]} {E(g[1])}</td>'
                      + ''.join(f'<td style="text-align:center;color:#999;font-size:11px">{E(TRAITS[i][2][g[4][i]][0])}</td>' for i in range(4))
                      + '<td></td><td></td></tr>' for g in GUESTS) + '</table>')
write('4-notes.html', page(
    'Hotel Murder (โหมดหลักฐาน) - ใบบันทึกคดี',
    single('<h1>ใบบันทึกคดี (พิมพ์คนละแผ่น หรือใช้ร่วมกันทั้งกลุ่ม)</h1>' + cases
           + '<h1 style="margin-top:6mm">ตารางผู้ต้องสงสัย (ใส่ ✓ ถ้าหลักฐานตรงกับโปรไฟล์ แล้วตามหาห้อง)</h1>' + suspects)))

print('built:', sorted(os.listdir(DATA)), sorted(os.listdir(PRINT)))
