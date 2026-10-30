# Hotel Murder — Prompt สำหรับสร้างภาพการ์ด (ตัวละครต้นฉบับ)

> **หลักการ:** สร้างภาพ **ตัวละครต้นฉบับของเรา** ในแนวสไตล์เดียวกัน (อาร์ตเดโค ยุค 1920s นัวร์ ภาพวาดหมึกแบบคอมมิก) ไม่ใช่การลอกตัวละครหรือการ์ดของเกมที่วางขายอยู่แล้ว
> **ห้ามอัปโหลดภาพการ์ดของเกมต้นฉบับเป็นภาพอ้างอิง** (style reference / character reference / image-to-image) เพราะจะได้ภาพที่เกือบเหมือนเดิม ใช้ภาพอ้างอิงจากภาพที่คุณสร้างเองในชุดนี้เท่านั้น
> **ห้ามให้ AI เขียนตัวอักษรบนการ์ด** ชื่อบทบาทและคำอธิบายใส่ทีหลังด้วย `tools/build.py` (AI วาดตัวอักษรไทยผิดบ่อย)

## 1. ข้อกำหนดของภาพ

| เรื่อง | ค่าแนะนำ |
|---|---|
| สัดส่วน | แนวตั้ง 2:3 (การ์ดจริงขนาด 63×88 มม. ใกล้เคียง 5:7 ตัดขอบได้) |
| ขนาดที่ขอจาก AI | อย่างน้อย 1024×1536 พิกเซล แล้วอัปสเกลเป็น 1500×2100 ขึ้นไป (พิมพ์ 300 dpi ต้องการ ~750×1040 ที่ขนาดการ์ด แต่ควรเผื่อ) |
| พื้นที่ว่าง | เว้น **ส่วนล่างประมาณ 30%** เป็นพื้นมืดเรียบ ไว้วางชื่อบทบาทและคำอธิบาย |
| สีขอบ | ฝ่ายบริสุทธิ์ใช้โทน **น้ำเงินกลางคืน** ฝ่ายฆาตกรใช้โทน **แดงเข้ม** (ใส่ผ่านพื้นหลังของภาพ ไม่ต้องวาดกรอบ) |
| ไฟล์ | ตั้งชื่อ `art/locksmith.png`, `art/murderer.png` ฯลฯ ตรงกับ id ใน `data/roles.csv` |

## 2. บล็อกสไตล์กลาง (วางต้นทุก prompt เพื่อให้ทั้งชุดเข้ากัน)

```
1920s Art Deco noir illustration, bold black ink linework, cel shading with subtle halftone texture,
limited palette, strong rim light, dramatic moonlit atmosphere, a large pale moon halo behind the character
with geometric Art Deco sunburst rays radiating from it, poster-like composition, three-quarter portrait from the waist up, character centered in the upper 70% of the frame,
the lower 30% of the frame fades into plain dark empty space, no text, no letters, no logo, no frame, no border
```

**สัดส่วนภาพ (ต้องระบุเสมอ ไม่เช่นนั้นเครื่องมือมักให้ภาพแนวนอน):** ต่อท้าย prompt ด้วย `vertical portrait, 2:3 aspect ratio (1024x1536)` (ChatGPT/GPT-image) หรือ `--ar 2:3` (Midjourney) หรือเลือกอัตราส่วนแนวตั้งในหน้าตั้งค่า (Gemini/Firefly) แล้วตรวจว่าภาพที่ได้สูงกว่ากว้าง

**ข้อความที่ไม่ต้องการ (negative prompt / "avoid")** — ใส่ถ้าเครื่องมือมีช่องนี้:

```
text, letters, watermark, signature, border, card frame, extra fingers, deformed hands, blurry, photo, 3d render,
modern clothes, smartphone
```

## 3. Prompt รายบทบาท (ฝ่ายบริสุทธิ์ = โทนน้ำเงิน)

ใช้รูปแบบ: `[บล็อกสไตล์กลาง] + [prompt ของบทบาท] + [โทนสี]` แต่ละตัวละครออกแบบให้แตกต่างจากตัวละครของเกมที่วางขาย

### ช่างกุญแจ (locksmith) — ฝ่ายบริสุทธิ์
```
A weathered elderly woman with a long silver braid over her shoulder, leather tool apron over a wool cardigan,
holding up a huge antique brass skeleton key in one raised hand, calm knowing smile, a heavy iron gate half closed
behind her, deep midnight blue and brass gold palette
```

### แม่บ้าน (housekeeper) — ฝ่ายบริสุทธิ์
```
A stern middle-aged hotel housekeeper with round glasses and a neat grey bun, starched uniform with a ring of
numbered room tags clipped to her belt, one hand resting on a linen cart, looking down a grand staircase as if counting
people on each floor, deep midnight blue and cream palette
```

### ช่างเช็ดกระจก (window cleaner) — ฝ่ายบริสุทธิ์
```
A young male window cleaner in a canvas jumpsuit and a flat cap, hanging from a rope harness on the outside of a tall
hotel window, squeegee in hand, city lights and a moon reflected in the glass, one eye on the lit windows in a vertical
row, deep midnight blue and teal palette
```

### นักสืบ (detective) — ฝ่ายบริสุทธิ์
```
A sharp-eyed male detective in his forties with slicked-back dark hair and a neat mustache, trench coat over a tailored
pinstripe waistcoat and tie, fedora pushed back on his head, pencil behind his ear, holding a small notebook and a
brass magnifying glass up to one eye, thin trail of cigarette smoke curling across the frame,
deep midnight blue and warm brown palette
```

### พยาน (witness) — ฝ่ายบริสุทธิ์
```
An elderly gentleman in striped pajamas and a silk dressing gown peeking through a narrow gap of a hotel room door,
holding antique opera glasses to his eyes, wide-eyed and anxious, a long dim corridor behind him,
deep midnight blue and soft yellow lamplight palette
```

### แขกผู้พัก (guest) — ฝ่ายบริสุทธิ์ (ทำ 5 แบบ ใช้บล็อกสไตล์เดียวกัน)
```
A [ROLE] hotel guest with a travel trunk and a hat box, glancing nervously over their shoulder, deep midnight blue palette
```
แทน `[ROLE]` ด้วย: `wealthy widow with pearls` / `young jazz trumpeter` / `retired colonel with a cane` / `stage actress with a feather boa` / `traveling salesman with a sample case`

## 4. Prompt ฝ่ายฆาตกร (โทนแดง)

### ฆาตกร (murderer)
```
A tall figure in a hotel bellhop uniform with brass buttons and a pillbox cap, face half hidden in deep shadow,
white gloves with a faint dark stain, a polite unsettling smile, standing behind a folding brass elevator gate,
blood red and black palette, smoky haze, red moon halo
```

### ผู้ช่วยฆาตกร (accomplice)
```
A poised young concierge with slicked-back hair and a bow tie, red carnation on the lapel, holding a silver tray with a
folded note, glancing sideways with a conspiratorial smirk, blood red and black palette, red moon halo
```

## 5. ภาพประกอบอื่นที่อาจต้องใช้

### พื้นหลังกระดานโรงแรม (ตัดผ่านอาคาร)
```
A cutaway illustration of a grand 1920s Art Deco hotel building seen from the front, five floors with four rooms each,
rooms drawn as lit windows with tiny silhouettes, a thunderstorm and a pale moon, clean flat layout so a grid can be
overlaid, deep midnight blue palette, no text
```

### หลังการ์ด (card back)
```
A symmetrical Art Deco fan-and-sunburst pattern in gold on deep midnight blue, a small keyhole motif in the center,
flat vector style, no text, seamless-looking edges
```

## 6. เลือกเครื่องมือสร้างภาพ

ผมไม่สามารถยืนยันรุ่นล่าสุดและเงื่อนไขการใช้งานของแต่ละเครื่องมือได้ ให้ตรวจเงื่อนไขและราคาบนเว็บของผู้ให้บริการก่อนใช้

| เครื่องมือ | เหมาะกับ | ข้อควรระวัง |
|---|---|---|
| **Midjourney** | สไตล์ภาพประกอบที่ได้ความสวยและบรรยากาศสูงสุด สั่งให้ทั้งชุดเข้ากันด้วยการใช้ภาพที่เราสร้างเองเป็น style reference | ใช้งานเชิงพาณิชย์ต้องมีแผนที่อนุญาต ตรวจเงื่อนไข ใช้ผ่านเดสก์ท็อป/Discord |
| **GPT-image (ChatGPT)** | ทำตาม prompt ยาวได้ดี แก้ภาพทีละจุดได้ในแชต (เช่น "แก้มือให้ถือกุญแจ") | บางครั้งวาดตัวอักษรบนภาพเอง ให้สั่งไม่ให้มีตัวอักษร |
| **Gemini / Imagen** | ทำภาพชุดเดียวกันโดยอ้างอิงภาพก่อนหน้าในแชตเดียวกัน | ตรวจสิทธิ์และเงื่อนไขการใช้งานเชิงพาณิชย์ |
| **Adobe Firefly** | ถ้าจะ **ขายหรือเผยแพร่** เพราะผู้ให้บริการระบุว่าฝึกจากข้อมูลที่มีสิทธิ์ใช้ได้ | สไตล์อาจเรียบกว่า ตรวจเงื่อนไขเอง |
| **Flux (รันเองหรือผ่านเว็บ)** | ถ้าอยากควบคุมเอง ปรับซ้ำได้ไม่จำกัด | ตั้งค่ายากกว่า ต้องมี GPU ถ้ารันเอง |

**คำแนะนำ:** ถ้าเล่นกับเพื่อนอย่างเดียว ใช้ตัวที่คุณสะดวกที่สุด ถ้าจะ **ขายหรือเผยแพร่** เลือกเครื่องมือที่ระบุสิทธิ์เชิงพาณิชย์ชัดเจน และจำไว้ว่าในหลายประเทศภาพที่ AI สร้างทั้งภาพอาจไม่ได้รับการคุ้มครองลิขสิทธิ์ของเรา

## 7. ขั้นตอนทำให้ภาพทั้งชุดเข้ากัน

1. สร้าง **ภาพแรก** (เช่น ช่างกุญแจ) ด้วยบล็อกสไตล์กลาง สร้าง 4 ตัวเลือก เลือกใบที่ชอบที่สุด
2. ใช้ **ภาพนั้นเป็น style reference** สำหรับตัวละครถัดไป (เครื่องมือที่รองรับ) หรือสร้างต่อในแชตเดียวกัน
3. สร้างทีละบทบาท ตรวจ **มือและของที่ถือ** (กุญแจ แว่นขยาย ไม้ถู) ซึ่งเป็นจุดที่ AI พลาดบ่อย
4. ถ้าภาพแตกต่างกันมาก ให้ปรับ prompt เฉพาะชุดสี ไม่ต้องเปลี่ยนบล็อกสไตล์
5. อัปสเกลภาพที่เลือกให้ได้ 1500×2100 ขึ้นไป
6. เก็บไฟล์ในโฟลเดอร์ `art/` ตั้งชื่อตาม id แล้วบอกผม ผมจะแก้ `tools/build.py` ให้ใส่ภาพลงการ์ดพิมพ์และเพิ่มกรอบอาร์ตเดโคของเราเอง
