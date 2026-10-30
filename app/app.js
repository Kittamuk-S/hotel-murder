/* Hotel Murder - single-player UI (you + bots, the app is the host). Rules: docs/RULES_FROM_VIDEO_TH.md */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const BOT_NAMES = ['คุณมานพ', 'คุณณัฐ', 'คุณปลา', 'คุณใจ', 'คุณเอ', 'คุณบี', 'คุณแอน', 'คุณโต', 'คุณนุ่น', 'คุณเต้', 'คุณมิ้น', 'คุณหมี'];
  const ROLE_TEXT = {
    locksmith: 'ทุกคืนเลือก 1 ห้องให้ปลอดภัยจากฆาตกร ถ้าฆาตกรเลือกห้องนั้น การลงมือไร้ผล (ล็อกห้องตัวเองได้) ห้ามล็อกห้องเดิมสองคืนติด',
    housekeeper: 'ทุกคืนเลือก 1 ชั้น รู้จำนวนผู้เล่นที่ยังมีชีวิตอยู่ในชั้นนั้น',
    windowcleaner: 'ทุกคืนเลือก 1 แถวแนวตั้ง (1-3) รู้จำนวนผู้เล่นที่ยังมีชีวิตในแถวนั้นทุกชั้น',
    detective: 'ทุกคืนเลือกผู้เล่น 1 คน รู้ว่าเขาพักอยู่ “ชั้นไหน”',
    witness: 'ทุกคืนเลือกเฝ้า 1 ชั้น ถ้าตรงกับชั้นที่ฆาตกรเลือกลงมือ จะรู้ว่าห้องของฆาตกรอยู่สูงกว่า / ต่ำกว่า / ชั้นเดียวกับชั้นที่เฝ้า',
    accomplice: 'อยู่ฝ่ายฆาตกร รู้ตัวและห้องของฆาตกร ทุกคืนเลือกผู้เล่น 1 คนเพื่อรู้ “ชั้น” ที่เขาพัก กลางวันสวมบทบาทอะไรก็ได้ถ้าไม่มีใครแย้ง',
    murderer: 'ทุกคืนเลือก 1 ห้องไปฆาตกรรม คนในห้องนั้นต้องออกจากเกม ห้องว่างจะถูกประกาศว่าว่าง คุณรู้ตัวและห้องของผู้ช่วย ต้องรอดให้ครบ 4 วัน',
    guest: 'ไม่มีสกิลกลางคืน ใช้คำพูดและการสังเกตช่วยฝ่ายบริสุทธิ์',
  };
  const ME = 0;
  let S, ctl, timer = null, dayBegun = 0;

  // ---------------------------------------------------------------- tiny DOM helper (text only: names are user input)
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e[k] = v;
      else if (k.startsWith('data-') || k.startsWith('aria-')) e.setAttribute(k, v);
      else e[k === 'for' ? 'htmlFor' : k] = v;
    });
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  let curPhase = null, lastCaughtBy = [];
  function show(...nodes) {
    if (timer) { clearInterval(timer); timer = null; }
    app.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
    window.scrollTo(0, 0);
    if (window.FX) { FX.phase(curPhase); FX.enter(app, true); }
  }
  const phased = (name, ...nodes) => { curPhase = name; show(...nodes); };
  const actionbar = (btn, why) => h('div', { class: 'actionbar' }, btn, why ? h('span', { class: 'why' }, why) : null);
  const view = () => HM.viewFor(S, ME);
  const nm = (id) => S.players[id].name;

  // ---------------------------------------------------------------- shared pieces
  function board(v) {
    const closed = {}; v.closed.forEach((c) => { closed[c.room] = c.kind; });
    const wrap = h('div', { class: 'board', 'aria-label': 'แผนผังโรงแรม' });
    wrap.style.setProperty('--cols', v.cols);
    const head = h('div', { class: 'board-row' }, h('span'));
    for (let c = 1; c <= v.cols; c++) head.append(h('div', { class: 'colhead' }, `แถว ${c}`));
    wrap.append(head);
    for (let f = v.floors; f >= 1; f--) {
      const row = h('div', { class: 'board-row' }, h('div', { class: 'flr' }, f));
      for (let c = 1; c <= v.cols; c++) {
        const k = HM.roomKey(f, c);
        const kind = closed[k];
        const title = kind === 'empty' ? 'ห้องว่าง' : kind === 'raid' ? 'ถูกบุก' : kind ? 'พบศพ' : k === v.me.room ? 'ห้องคุณ' : '';
        const cls = 'cell' + (kind ? (kind === 'empty' ? ' empty' : kind === 'raid' ? ' raid' : ' corpse dead') : '') + (k === v.me.room ? ' mine' : '');
        row.append(h('div', { class: cls, title }, h('b', {}, k)));
      }
      wrap.append(row);
    }
    return wrap;
  }
  function noteText(v, n) {
    const name = (id) => v.players[id].name;
    const night = `คืนที่ ${n.day}`;
    switch (n.kind) {
      case 'lock': return `${night}: คุณล็อกห้อง ${n.room}`;
      case 'peek': return `${night}: สืบ ${name(n.target)} → อยู่ชั้น ${n.floor}`;
      case 'floorCount': return `${night}: ชั้น ${n.floor} มีคนอยู่ ${n.count} คน`;
      case 'colCount': return `${night}: แถว ${n.col} มีคนอยู่ ${n.count} คน`;
      case 'watch': return `${night}: เฝ้าชั้น ${n.floor} → ${n.cmp === 'none' ? 'ฆาตกรไม่ได้เลือกชั้นนี้ ไม่ได้ข้อมูล' : 'ห้องฆาตกร' + HMCtl.CMP[n.cmp] + (n.cmp === 'equal' ? '' : 'ชั้นนี้')}`;
      default: return '';
    }
  }
  function notebook(v) {
    const items = v.me.notes.map((n) => h('li', {}, noteText(v, n)));
    const extra = [h('li', {}, `ห้องของคุณ: ${v.me.room}`)];
    if (v.me.mateId != null) {
      const mate = v.players[v.me.mateId];
      extra.push(h('li', {}, `${HM.ROLES[mate.role].name}: ${mate.name} (ห้อง ${mate.room})`));
    }
    v.me.teamNotes.forEach((n) => items.push(h('li', {}, `ผู้ช่วยตรวจ: ${noteText(v, n)}`)));
    return h('details', {}, h('summary', {}, 'สมุดโน้ตของคุณ (ข้อมูลลับ)'), h('ul', { class: 'notes' }, extra, items));
  }
  function statusLine(v) {
    const alive = v.players.filter((p) => p.alive).length;
    return h('p', { class: 'sub center' }, `วันที่ ${v.day}/${v.days} · ยังอยู่ ${alive}/${v.n} คน · ห้องเปิด ${HM.openRooms(S).length} ห้อง`);
  }
  function roleCard(v) {
    const role = v.me.role, bad = HM.ROLES[role].side === 'ฆาตกร';
    return h('div', { class: 'card' + (bad ? ' bad' : '') },
      h('img', { src: `../art/${role}.png`, alt: '' }), h('div', { class: 'shade' }), h('div', { class: 'frame' }),
      h('div', { class: 'txt' }, h('h2', {}, HM.ROLES[role].name), h('div', { class: 'side' }, `ฝ่าย${HM.ROLES[role].side}`), h('div', { class: 'rule' }, ROLE_TEXT[role])));
  }
  function choice(label, onPick, extra) {
    return h('button', { class: 'opt', type: 'button', 'aria-pressed': 'false', onclick: onPick }, label, extra ? h('small', {}, extra) : null);
  }
  const roomGrid = (rooms, cols, onPick) => {
    const g = h('div', { class: 'grid', style: `grid-template-columns: repeat(${cols}, 1fr)` });
    rooms.forEach((k) => { const b = choice(k, () => { [...g.children].forEach((c) => c.setAttribute('aria-pressed', c === b ? 'true' : 'false')); onPick(k); }); g.append(b); });
    return g;
  };

  // ---------------------------------------------------------------- screens
  function home() {
    const nameIn = h('input', { type: 'text', id: 'name', value: 'คุณ', maxLength: 14, autocomplete: 'off' });
    const nSel = h('select', { id: 'count' }, [6, 7, 8, 9].map((n) => h('option', { value: n, selected: n === 7 }, `${n} คน (คุณ + บอต ${n - 1})${n === 7 ? ' — ตามคลิปสอนเล่น' : ''}`)));
    phased(null,
      h('h1', {}, 'HOTEL MURDER'), h('p', { class: 'center sub' }, 'ปริศนาโรงแรมมรณะ'), h('div', { class: 'deco' }),
      h('div', { class: 'panel' },
        h('p', {}, 'เล่นคนเดียวกับบอต ตัวเกมทำหน้าที่ “โฮสต์” แทนคน คุณจะได้บทบาทลับและห้องลับ ฆาตกรซ่อนอยู่ในหมู่แขก ฝ่ายบริสุทธิ์มี 4 วันที่จะหาห้องของฆาตกรให้เจอก่อนเขาหนีไปได้'),
        h('label', { for: 'name' }, 'ชื่อของคุณ'), nameIn,
        h('label', { for: 'count' }, 'จำนวนผู้เล่น'), nSel,
        h('button', { class: 'btn go', type: 'button', id: 'start', onclick: () => startGame(nameIn.value.trim() || 'คุณ', +nSel.value) }, 'เช็กอิน'),
        h('a', { class: 'btn', href: 'online.html', style: 'text-align:center;text-decoration:none' }, '🎤 เล่นกับเพื่อนออนไลน์ (คุยด้วยไมค์)')),
      h('details', {}, h('summary', {}, 'กติกาย่อ'), h('ul', { class: 'notes' },
        h('li', {}, 'โรงแรมมีชั้นละ 3 ห้อง เปิดเกมมี 3 ห้องที่พบศพ (ปิดไว้) ทุกคนมีห้องลับของตัวเอง'),
        h('li', {}, 'กลางวัน: คุยกัน (โกหกได้) เสนอห้องที่จะรุมบุก แล้วยกมือโหวต ต้องได้มากกว่าครึ่งของคนที่ยังอยู่ ห้องว่างจะถูกปิด ห้องที่มีคนอยู่ เจ้าของออกจากเกม (ไม่เปิดบทบาท) ถ้าเป็นห้องฆาตกร ฝ่ายบริสุทธิ์ชนะ'),
        h('li', {}, 'กลางคืน: ช่างกุญแจล็อกห้อง แม่บ้านนับคนในชั้น ช่างเช็ดกระจกนับคนในแถว นักสืบรู้ชั้นของคนที่เลือก ผู้ช่วยฆาตกรรู้ชั้นของคนที่เลือก ฆาตกรเลือกห้องลงมือ พยานเฝ้าชั้น'),
        h('li', {}, 'ฝ่ายฆาตกรชนะถ้ารอดครบ 4 วัน หรือถ้าจำนวนฝ่ายฆาตกรเท่ากับผู้บริสุทธิ์ที่เหลือ'))));
  }

  function startGame(name, n) {
    const q = new URLSearchParams(location.search);
    const seed = q.get('seed') ? +q.get('seed') : (Date.now() % 1e9);
    const bots = HM.shuffle(BOT_NAMES, HM.mulberry32(seed));
    S = HM.newGame(n, seed, [name].concat(bots.slice(0, n - 1)));
    ctl = HMCtl.create(S, ME, seed);
    dayBegun = 0;
    window.__hm = { S, ctl };
    roleScreen();
  }

  function roleScreen() {
    const v = view();
    const mate = v.me.mateId != null ? v.players[v.me.mateId] : null;
    const hide = h('button', { class: 'btn hide-role', type: 'button' }, 'ซ่อนบทบาท');
    const wrap = h('div', { class: 'flip' }, h('div', { class: 'inner' },
      h('div', { class: 'front' }, roleCard(v),
        h('p', { class: 'center' }, `ห้องของคุณคือ `, h('b', {}, v.me.room), ' (ห้ามบอกใคร)'),
        mate ? h('p', { class: 'center' }, `${HM.ROLES[mate.role].name}ของคุณคือ `, h('b', {}, mate.name), ` (ห้อง ${mate.room})`) : null, hide),
      h('div', { class: 'back' }, h('span', {}, 'แตะเพื่อดูบทบาท'))));
    phased('night',
      h('h2', { class: 'center' }, 'บทบาทของคุณ'), wrap,
      h('h3', {}, `ห้องที่พบศพตอนเริ่มเกม (${v.closed.length} ห้อง)`), board(v),
      actionbar(h('button', { class: 'btn go', type: 'button', onclick: day }, 'เริ่มวันที่ 1'), 'ซ่อนบทบาทก่อนส่งเครื่องต่อหรือเริ่มเกม'));
    if (window.FX) FX.flipCard(wrap, { hideButton: hide });
  }

  function sleepScreen(then) {
    const sky = h('div', {}); if (window.FX) FX.stars(sky);
    phased('night', h('div', { class: 'sleep' }, sky, 'ทุกคนหลับตา...', h('p', { class: 'sub' }, `คืนที่ ${S.day}`)));
    setTimeout(then, 1800);
  }

  function night() {
    const r = ctl.runNight();
    if (r.need) return actionScreen(r.options, null);
    const sleeping = !S.night.queue.some((q) => q.playerId === ME);
    if (sleeping) sleepScreen(() => dawn(r.dawn)); else dawn(r.dawn);
  }

  function actionScreen(o, message) {
    const v = view();
    let picked = null;
    const go = h('button', { class: 'btn go', type: 'button', disabled: true }, 'ยืนยัน');
    const why = h('span', { class: 'why' }, 'เลือกก่อนจึงจะยืนยันได้');
    const body = [];
    const pick = (val) => { picked = val; go.disabled = false; why.textContent = ''; };
    const titles = {
      lock: 'คุณคือช่างกุญแจ — เลือกห้องที่จะล็อก', kill: 'คุณคือฆาตกร — เลือกห้องที่จะลงมือ',
      peek: o.role === 'detective' ? 'คุณคือนักสืบ — เลือกผู้เล่นที่จะสืบ' : 'คุณคือผู้ช่วยฆาตกร — เลือกผู้เล่นที่จะตรวจ',
      floor: 'คุณคือแม่บ้าน — เลือกชั้นที่จะนับคน', column: 'คุณคือช่างเช็ดกระจก — เลือกแถวที่จะนับคน', watch: 'คุณคือพยาน — เลือกชั้นที่จะเฝ้า',
    };
    let submit;
    if (o.type === 'lock' || o.type === 'kill') {
      body.push(roomGrid(o.rooms, v.cols, pick));
      if (o.type === 'lock') body.push(h('p', { class: 'sub' }, 'ถ้าฆาตกรเลือกห้องนี้ การลงมือไร้ผล ล็อกห้องตัวเองได้ ห้ามซ้ำกับคืนก่อน'));
      else {
        if (o.teamNotes.length) body.push(h('div', { class: 'panel' }, h('b', {}, 'ผู้ช่วยตรวจคืนนี้: '), o.teamNotes.map((n) => noteText(v, n).replace(/^คืนที่ \d+: /, '')).join(' · ')));
        body.push(h('p', { class: 'sub' }, 'ห้องของคุณ ห้องของผู้ช่วย และห้องที่ปิดแล้วเลือกไม่ได้'));
      }
      submit = () => ctl.humanNight({ room: picked });
    } else if (o.type === 'floor' || o.type === 'watch') {
      const g = h('div', { class: 'grid', style: `grid-template-columns: repeat(${Math.min(5, o.floors.length)}, 1fr)` });
      o.floors.forEach((f) => { const b = choice(`ชั้น ${f}`, () => { [...g.children].forEach((c) => c.setAttribute('aria-pressed', c === b ? 'true' : 'false')); pick(f); }); g.append(b); });
      body.push(g);
      submit = () => ctl.humanNight({ floor: picked });
    } else if (o.type === 'column') {
      const g = h('div', { class: 'grid', style: `grid-template-columns: repeat(${o.cols.length}, 1fr)` });
      o.cols.forEach((c) => { const b = choice(`แถว ${c}`, () => { [...g.children].forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); pick(c); }); g.append(b); });
      body.push(g);
      submit = () => ctl.humanNight({ col: picked });
    } else {   // peek
      const g = h('div', { class: 'grid', style: 'grid-template-columns: repeat(2, 1fr)' });
      o.targets.forEach((id) => { const b = choice(nm(id), () => { [...g.children].forEach((c) => c.setAttribute('aria-pressed', c === b ? 'true' : 'false')); pick(id); }); g.append(b); });
      body.push(g);
      submit = () => ctl.humanNight({ target: picked });
    }
    go.onclick = () => {
      let res;
      try { res = submit(); } catch (e) { return actionScreen(o, e.message); }
      if (res && res.result) return resultScreen();
      night();
    };
    phased('night', h('h2', {}, `คืนที่ ${S.day}`), h('p', { class: 'sub' }, 'เลือกด้วยความเงียบ ไม่มีใครเห็นการเลือกของคุณ'), statusLine(v),
      h('h3', {}, titles[o.type]), message ? h('div', { class: 'toast', role: 'alert' }, message) : null,
      body, notebook(v), h('details', {}, h('summary', {}, 'แผนผังโรงแรม'), board(v)), h('div', { class: 'actionbar' }, go, why));
  }

  function resultScreen() {
    const v = view(); const last = v.me.notes[v.me.notes.length - 1];
    phased('night', h('h2', {}, 'ผลที่คุณได้รับ'), h('div', { class: 'panel' }, h('p', { class: 'center', style: 'font-size:20px' }, noteText(v, last).replace(/^คืนที่ \d+: /, ''))),
      h('p', { class: 'sub center' }, 'จดไว้ได้ในสมุดโน้ต ผลนี้เป็นความลับของคุณ'),
      actionbar(h('button', { class: 'btn go', type: 'button', onclick: night }, 'หลับตาต่อ')));
  }

  function dawn(d) {
    const v = view();
    const stage = h('div', { class: 'dawn-stage', 'aria-live': 'polite' });
    const boardBox = h('div', {});
    const next = S.phase === 'over' ? h('button', { class: 'btn go', type: 'button', onclick: overScreen, disabled: true }, 'ดูผล')
      : h('button', { class: 'btn go', type: 'button', onclick: day, disabled: true }, `เข้าสู่วันที่ ${S.day + 1}`);
    const why = h('span', { class: 'why' }, 'รอฟังประกาศรุ่งเช้า...');
    phased('dawn', h('h2', {}, 'รุ่งเช้า'), stage, boardBox,
      d.victim === ME ? h('p', { class: 'center sub' }, 'คุณออกจากเกมแล้ว แต่ยังดูเกมต่อได้') : null,
      d.outcome === 'death' ? h('p', { class: 'center sub' }, 'ผู้เสียชีวิตคืนคีย์การ์ดและออกจากเกม ไม่เปิดเผยบทบาท') : null,
      h('div', { class: 'actionbar' }, next, why));
    const last = d.outcome === 'death' ? { text: `${nm(d.victim)} เสียชีวิต`, kind: 'death' }
      : d.outcome === 'empty' ? { text: 'ห้องว่าง ไม่มีใครเสียชีวิต', kind: 'big' }
        : { text: 'ประตูถูกล็อก ลงมือไม่สำเร็จ', kind: 'locked' };
    const lines = [{ text: 'ฆาตกรลงมือเมื่อคืน...' }, { text: `ชั้น ${HM.floorOf(d.room)}` }, { text: `ห้อง ${d.room}`, kind: 'big' }, last];
    const fin = () => { if (!stage.isConnected) return; boardBox.replaceChildren(board(v)); next.disabled = false; why.textContent = ''; };
    if (window.FX) FX.dawnSequence(stage, lines).then(fin);
    else { lines.forEach((l) => stage.append(h('div', { class: 'dawn-line shown' + (l.kind ? ' ' + l.kind : '') }, l.text))); fin(); }
  }

  function chatList() {
    const list = h('div', { class: 'chat' });
    Object.keys(ctl.proposals).forEach((id) => {
      if (S.players[id].alive) list.append(h('div', { class: 'msg sus' }, h('b', {}, nm(+id)), ': ขอเสนอบุกห้อง ', ctl.proposals[id]));
    });
    if (!list.children.length) list.append(h('p', { class: 'sub' }, 'ยังไม่มีใครเสนอห้อง'));
    return list;
  }

  // players strip: who proposed a room, who is out
  function pbar(myRoom) {
    const bar = h('div', { class: 'pbar', 'aria-label': 'ผู้เล่น' });
    S.players.forEach((p) => {
      const room = p.id === ME ? myRoom : ctl.proposals[p.id];
      const cls = 'pchip' + (!p.alive ? ' out' : room ? ' proposed' : '');
      bar.append(h('span', { class: cls }, (p.id === ME ? 'คุณ' : p.name) + (!p.alive ? ' (ออก)' : room ? ` → ${room}` : '')));
    });
    return bar;
  }

  // public claims; two players claiming the same role + same kind on the same day with different results conflict
  function claimConflicts() {
    const sig = (c) => JSON.stringify(Object.keys(c).filter((k) => k !== 'day' && k !== 'by').sort().map((k) => [k, c[k]]));
    const bad = new Set();
    S.claims.forEach((a, i) => S.claims.forEach((b, j) => {
      if (i < j && a.day === b.day && a.as === b.as && a.kind === b.kind && a.by !== b.by && sig(a) !== sig(b)) { bad.add(i); bad.add(j); }
    }));
    return bad;
  }
  function claimboard() {
    const bad = claimConflicts();
    if (!S.claims.length) return h('p', { class: 'sub' }, 'ยังไม่มีใครประกาศผล');
    const list = h('ul', { class: 'claimboard', 'aria-label': 'ผลที่ประกาศ' });
    S.claims.forEach((c, i) => {
      list.append(h('li', { class: bad.has(i) ? 'conflict' : '' }, h('b', {}, `วันที่ ${c.day} · ${c.by === ME ? 'คุณ' : nm(c.by)}`), h('span', {}, HMCtl.describeClaim(S, c))));
    });
    return list;
  }

  function day() {
    if (S.phase === 'over') return overScreen();
    if (dayBegun !== S.day || S.phase === 'dawn') { ctl.beginDay(); dayBegun = S.day; }
    const v = view(); const alive = v.me.alive;
    let myRoom = null;
    const chatBox = h('div', {}), claimsBox = h('div', {}), pbarBox = h('div', {});
    const renderChat = () => { chatBox.replaceChildren(chatList()); claimsBox.replaceChildren(claimboard()); pbarBox.replaceChildren(pbar(myRoom)); }; renderChat();
    const claimBox = h('div', {});
    if (alive) {
      ctl.humanClaims().forEach((c) => claimBox.append(h('button', { class: 'btn', type: 'button', onclick: (e) => { ctl.say(c.claim); e.target.disabled = true; renderChat(); } }, `ประกาศ: ${c.text}`)));
      const roleSel = h('select', { id: 'bluffrole', 'aria-label': 'บทบาทที่จะอ้าง' }, HM.CLAIM_ROLES.map((r) => h('option', { value: r }, HM.ROLES[r].name)));
      if (S.day > 1) claimBox.append(h('details', {}, h('summary', {}, 'บลัฟ: ประกาศผลปลอมของบทบาทอื่น'), roleSel,
        h('button', { class: 'btn', type: 'button', onclick: () => { ctl.say(ctl.humanBluff(roleSel.value)); renderChat(); } }, 'ประกาศผลปลอมแบบสุ่ม')));
    }
    const proposeBox = h('div', {});
    if (alive) {
      const shown = h('p', { class: 'sub' }, 'คุณยังไม่ได้เสนอห้อง (ไม่เสนอก็ได้)');
      proposeBox.append(h('details', {}, h('summary', {}, 'เสนอห้องที่จะรุมบุก'),
        roomGrid(HM.openRooms(S).filter((k) => k !== v.me.room), v.cols, (k) => { myRoom = k; shown.textContent = `คุณเสนอบุกห้อง ${k}`; renderChat(); }), shown));
    }
    let left = 240; const clock = h('div', { class: 'timer', 'aria-label': 'เวลาอภิปรายที่เหลือ' });
    const toVote = () => raidVoteScreen(myRoom);
    const tick = () => { clock.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; if (left-- <= 0) { clearInterval(timer); toVote(); } };
    phased('day', h('div', { class: 'sun', 'aria-hidden': 'true' }), h('h2', { class: 'center' }, `กลางวัน วันที่ ${S.day}`), statusLine(v), clock, pbarBox,
      alive ? null : h('div', { class: 'toast' }, 'คุณออกจากเกมแล้ว ดูการอภิปรายได้อย่างเดียว'),
      S.day === 1 ? h('p', { class: 'sub' }, 'วันแรกยังไม่มีใครถูกฆ่า แต่เสนอห้องและบุกได้เลย') : null,
      h('h3', {}, 'ผลที่ประกาศ'), claimsBox, h('h3', {}, 'การเสนอห้อง'), chatBox, claimBox, proposeBox, notebook(v), h('details', { open: true }, h('summary', {}, 'แผนผังโรงแรม'), board(v)),
      actionbar(h('button', { class: 'btn go', type: 'button', onclick: toVote }, 'ไปยกมือโหวต'), 'เวลาหมดจะเข้าสู่การโหวตเอง'));
    timer = setInterval(tick, 1000); tick();
  }

  function doRaid(myRoom, yes) {
    const by = {}; ctl.ballot(myRoom).forEach((b) => { by[b.room] = b.by; });
    const res = ctl.raid(myRoom, yes);
    lastCaughtBy = res.outcome === 'murderer' ? (by[res.room] || []) : [];
    return res;
  }

  function raidVoteScreen(myRoom) {
    if (S.phase !== 'day') return S.phase === 'over' ? overScreen() : night();     // never vote twice (timer + button)
    const v = view();
    const ballot = ctl.ballot(myRoom);
    if (!v.me.alive || !ballot.length) return raidResult(doRaid(myRoom, []));
    const need = Math.floor(HM.aliveList(S).length / 2) + 1;
    const yes = new Set();
    const rows = ballot.map(({ room, by }) => {
      const chk = h('input', { type: 'checkbox', id: `r${room}`, onchange: () => { if (chk.checked) yes.add(room); else yes.delete(room); } });
      return h('label', { for: `r${room}`, class: 'opt' }, chk, ` ห้อง ${room}`, h('small', {}, `เสนอโดย ${by.map((i) => (i === ME ? 'คุณ' : nm(i))).join(', ')}`));
    });
    phased('day', h('h2', {}, 'ยกมือโหวตบุกห้อง'), statusLine(v),
      h('p', { class: 'sub' }, `โฮสต์ไล่นับจากเลขห้องน้อยไปมาก ห้องแรกที่ได้ ${need} เสียงขึ้นไป (มากกว่าครึ่งของคนที่ยังอยู่) จะถูกบุก ถ้าไม่มีห้องไหนถึง วันนี้ไม่มีใครถูกบุก`),
      h('div', { class: 'panel' }, rows),
      notebook(v), h('details', {}, h('summary', {}, 'แผนผังโรงแรม'), board(v)),
      actionbar(h('button', { class: 'btn go', type: 'button', onclick: () => raidResult(doRaid(myRoom, [...yes])) }, 'ยืนยันการยกมือ'), 'ไม่ติ๊กห้องไหนก็ยืนยันได้ (ไม่ยกมือให้ห้องใด)'));
  }

  function raidResult(res) {
    const v = view();
    const text = () => {
      switch (res.outcome) {
        case 'murderer': return `ห้อง ${res.room} คือห้องของฆาตกร! ${nm(res.player)} ถูกจับได้`;
        case 'evicted': return `ห้อง ${res.room} มีคนอยู่ — ${nm(res.player)} คืนคีย์การ์ดและออกจากเกม (ไม่เปิดบทบาท)`;
        case 'empty': return `ห้อง ${res.room} เป็นห้องว่าง ปิดห้องนี้`;
        default: return res.proposals.length ? 'ไม่มีห้องไหนได้เสียงเกินครึ่ง วันนี้ไม่มีใครถูกบุก' : 'ไม่มีใครเสนอห้อง วันนี้ไม่มีใครถูกบุก';
      }
    };
    const rows = res.tallies.map((t) => h('tr', {}, h('td', {}, `ห้อง ${t.room}`), h('td', {}, `${t.yes} / ${res.alive} เสียง`)));
    const next = S.phase === 'over' ? h('button', { class: 'btn go', type: 'button', onclick: overScreen }, 'ดูผลเกม')
      : h('button', { class: 'btn go', type: 'button', onclick: night }, `เริ่มคืนที่ ${S.day}`);
    phased('day', h('h2', {}, `ผลการบุกวันที่ ${res.day}`), h('div', { class: 'panel' }, h('p', { class: 'center', style: 'font-size:19px' }, text())),
      rows.length ? h('details', { open: true }, h('summary', {}, 'ผลนับเสียง'), h('table', {}, rows)) : null, board(v), actionbar(next));
  }

  function recap(v) {
    const R = v.reveal, items = [];
    const who = (id) => (id === ME ? 'คุณ' : nm(id));
    const maxDay = Math.max(0, ...R.raids.map((r) => r.day), ...R.nights.map((n) => n.day));
    for (let d = 1; d <= maxDay; d++) {
      R.raids.filter((r) => r.day === d).forEach((r) => {
        const t = r.outcome === 'murderer' ? `ห้อง ${r.room} คือห้องฆาตกร จับ ${who(r.player)} ได้`
          : r.outcome === 'evicted' ? `บุกห้อง ${r.room} ${who(r.player)} ออกจากเกม`
            : r.outcome === 'empty' ? `บุกห้อง ${r.room} เป็นห้องว่าง` : 'ไม่มีห้องไหนถูกบุก';
        items.push(h('li', { class: 'day' }, `วันที่ ${d}: ${t}`));
      });
      R.nights.filter((n) => n.day === d).forEach((n) => {
        const t = n.outcome === 'death' ? `ฆาตกรบุกห้อง ${n.chosen} — ${who(n.victim)} เสียชีวิต`
          : n.outcome === 'empty' ? `ฆาตกรบุกห้อง ${n.chosen} — ห้องว่าง` : `ฆาตกรบุกห้อง ${n.chosen} แต่ประตูถูกล็อก`;
        items.push(h('li', { class: 'night' }, `คืนที่ ${d}: ${t}${n.locked ? ` (ล็อกห้อง ${n.locked})` : ''}`));
      });
    }
    return h('ul', { class: 'recap' }, items.length ? items : h('li', { class: 'day' }, 'จบเกมโดยไม่มีเหตุการณ์'));
  }

  function awards(v) {
    const R = v.reveal, out = [];
    const who = (id) => (id === ME ? 'คุณ' : nm(id));
    const first = R.nights.find((n) => n.outcome === 'death');
    if (first) out.push(`เหยื่อรายแรก: ${who(first.victim)} (คืนที่ ${first.day})`);
    const killer = v.players.find((p) => p.role === 'murderer');
    const escapes = R.raids.filter((r) => r.outcome !== 'murderer').length;
    if (killer && escapes > 0) out.push(`รอดหวุดหวิด: ${who(killer.id)} (ฆาตกร) รอดจากการโหวตบุก ${escapes} ครั้ง`);
    const cnt = {}; S.claims.forEach((c) => { cnt[c.by] = (cnt[c.by] || 0) + 1; });
    const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a - b)[0];
    if (top != null) out.push(`ปากไว: ${who(+top)} ประกาศผลมากที่สุด ${cnt[top]} ครั้ง`);
    if (S.winner === 'บริสุทธิ์' && lastCaughtBy.length) out.push(`สายตาเฉียบ: ${lastCaughtBy.map(who).join(', ')} เสนอห้องที่จับฆาตกรได้`);
    const saved = R.nights.filter((n) => n.outcome === 'locked').length;
    if (saved > 0) out.push(`ประตูแน่นหนา: ช่างกุญแจกันการลงมือไว้ ${saved} คืน`);
    return out.slice(0, 5).map((t) => h('div', { class: 'award' }, t));
  }

  function overScreen() {
    const v = view(); const mine = HM.ROLES[v.me.role].side === S.winner;
    const rows = v.players.map((p) => h('tr', {}, h('td', {}, p.id === ME ? `${p.name} (คุณ)` : p.name), h('td', {}, HM.ROLES[p.role].name), h('td', {}, p.room),
      h('td', {}, p.out === 'killed' ? 'ถูกฆ่า' : p.out === 'raided' ? 'ถูกบุกห้อง' : 'รอด')));
    phased('over', h('div', { class: 'win ' + (S.winner === 'บริสุทธิ์' ? 'good' : 'evil') }, S.winner === 'บริสุทธิ์' ? 'ฝ่ายบริสุทธิ์ชนะ!' : 'ฝ่ายฆาตกรชนะ!'),
      h('p', { class: 'center' }, S.winReason), h('p', { class: 'center sub' }, mine ? 'คุณอยู่ฝ่ายที่ชนะ' : 'คุณอยู่ฝ่ายที่แพ้'),
      awards(v),
      h('h3', {}, 'ลำดับเหตุการณ์'), recap(v),
      h('div', { class: 'panel' }, h('table', {}, h('tr', {}, h('th', {}, 'ผู้เล่น'), h('th', {}, 'บทบาท'), h('th', {}, 'ห้อง'), h('th', {}, 'สถานะ')), rows)),
      h('h3', {}, 'ห้องที่ช่างกุญแจล็อกแต่ละคืน'), h('p', { class: 'sub' }, v.reveal.lockHistory.length ? v.reveal.lockHistory.map((b) => `คืน ${b.day}: ${b.room}`).join(' · ') : 'ไม่มีช่างกุญแจ'),
      board(v), actionbar(h('button', { class: 'btn go', type: 'button', onclick: home }, 'เล่นใหม่')));
  }

  home();
})();
