/* Hotel Murder - pure rules engine (no DOM, no timers). Works in the browser (window.HM) and in Node (require).
 * Rules follow docs/RULES_FROM_VIDEO_TH.md. The engine plays the HOST: it knows every secret and exposes redacted
 * per-player views via viewFor().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 3;
  const DAYS = 4;
  const CORPSES = 3;
  const ROLES = {
    locksmith: { name: 'ช่างกุญแจ', side: 'บริสุทธิ์', order: 1 },
    housekeeper: { name: 'แม่บ้าน', side: 'บริสุทธิ์', order: 2 },
    windowcleaner: { name: 'ช่างเช็ดกระจก', side: 'บริสุทธิ์', order: 3 },
    detective: { name: 'นักสืบ', side: 'บริสุทธิ์', order: 4 },
    accomplice: { name: 'ผู้ช่วยฆาตกร', side: 'ฆาตกร', order: 5 },
    murderer: { name: 'ฆาตกร', side: 'ฆาตกร', order: 6 },
    witness: { name: 'พยาน', side: 'บริสุทธิ์', order: 7 },
    guest: { name: 'แขกผู้พัก', side: 'บริสุทธิ์', order: 0 },
  };
  const INFO_ROLES = ['housekeeper', 'windowcleaner', 'detective', 'witness'];
  const CLAIM_ROLES = ['locksmith'].concat(INFO_ROLES);
  const CORE = ['murderer', 'accomplice', 'locksmith', 'housekeeper', 'windowcleaner', 'detective', 'witness'];
  // players -> roles (7 = the roster shown in the video). Floors = players (max 9), 3 rooms per floor.
  const SETUP = {};
  for (let n = 6; n <= 9; n++) {
    const base = n === 6 ? CORE.filter((r) => r !== 'windowcleaner') : CORE.slice();
    SETUP[n] = { floors: n, cols: COLS, roles: base.concat(Array(Math.max(0, n - 7)).fill('guest')) };
  }

  // ---------------------------------------------------------------- helpers
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // room "401" = floor 4, column 1
  const roomKey = (f, c) => `${f}0${c}`;
  const floorOf = (key) => Math.floor(parseInt(key, 10) / 100);
  const colOf = (key) => parseInt(key, 10) % 100;
  const isKiller = (p) => ROLES[p.role].side === 'ฆาตกร';
  const cmpFloor = (a, b) => (a > b ? 'higher' : a < b ? 'lower' : 'equal');

  const byId = (s, id) => s.players[id];
  const holder = (s, role) => s.players.find((p) => p.role === role);
  const aliveList = (s) => s.players.filter((p) => p.alive);
  const allRooms = (s) => { const r = []; for (let f = 1; f <= s.floors; f++) for (let c = 1; c <= s.cols; c++) r.push(roomKey(f, c)); return r; };
  const openRooms = (s) => allRooms(s).filter((k) => !s.closed.has(k));
  const partnerOf = (s, p) => (p.role === 'murderer' ? holder(s, 'accomplice') : p.role === 'accomplice' ? holder(s, 'murderer') : null);

  // ---------------------------------------------------------------- setup
  function newGame(n, seed, names) {
    const cfg = SETUP[n];
    if (!cfg) throw new Error('จำนวนผู้เล่นต้องอยู่ระหว่าง 6-9');
    const rnd = mulberry32(seed == null ? Date.now() : seed);
    const rooms = [];
    for (let f = 1; f <= cfg.floors; f++) for (let c = 1; c <= cfg.cols; c++) rooms.push(roomKey(f, c));
    const shuffled = shuffle(rooms, rnd);
    const corpses = shuffled.slice(0, CORPSES);
    const homes = shuffled.slice(CORPSES, CORPSES + n);
    const roles = shuffle(cfg.roles, rnd);
    const players = roles.map((role, i) => ({ id: i, name: (names && names[i]) || `ผู้เล่น ${i + 1}`, role, room: homes[i], alive: true, out: null }));
    const s = {
      n, floors: cfg.floors, cols: cfg.cols, rnd, day: 1, phase: 'day', players,
      murdererId: players.find((p) => p.role === 'murderer').id,
      accompliceId: (players.find((p) => p.role === 'accomplice') || {}).id,
      closed: new Set(corpses), closedKind: {}, prevLock: null, lockHistory: [],
      notes: {}, claims: [], events: [], night: null, lastRaid: null, winner: null, winReason: null,
    };
    corpses.forEach((k) => { s.closedKind[k] = 'start'; });
    players.forEach((p) => { s.notes[p.id] = []; });
    s.events.push({ day: 0, type: 'start', rooms: corpses.slice() });
    return s;
  }

  // ---------------------------------------------------------------- night
  function startNight(s) {
    if (s.winner) throw new Error('เกมจบแล้ว');
    if (s.phase !== 'night') throw new Error('ยังไม่ถึงกลางคืน');
    const queue = [];
    Object.keys(ROLES).filter((r) => ROLES[r].order > 0).sort((a, b) => ROLES[a].order - ROLES[b].order).forEach((r) => {
      const p = holder(s, r);
      if (p && p.alive) queue.push({ role: r, playerId: p.id });
    });
    s.night = { forDay: s.day, queue, idx: 0, locked: null, chosen: null, count: {} , victim: null, outcome: null };
    return s;
  }

  function currentActor(s) {
    const n = s.night;
    if (!n || n.idx >= n.queue.length) return null;
    return n.queue[n.idx];
  }

  function killRooms(s) {
    const m = byId(s, s.murdererId);
    const mate = partnerOf(s, m);
    return openRooms(s).filter((k) => k !== m.room && !(mate && mate.alive && k === mate.room));
  }

  function nightOptions(s, playerId) {
    const a = currentActor(s);
    if (!a || a.playerId !== playerId) return null;
    const others = aliveList(s).filter((p) => p.id !== playerId).map((p) => p.id);
    const floors = Array.from({ length: s.floors }, (_, i) => i + 1);
    switch (a.role) {
      case 'locksmith': return { role: a.role, type: 'lock', rooms: openRooms(s).filter((k) => k !== s.prevLock) };
      case 'murderer': return { role: a.role, type: 'kill', rooms: killRooms(s), teamNotes: teamNotes(s, playerId) };
      case 'accomplice': case 'detective': return { role: a.role, type: 'peek', targets: others };
      case 'housekeeper': return { role: a.role, type: 'floor', floors };
      case 'windowcleaner': return { role: a.role, type: 'column', cols: Array.from({ length: s.cols }, (_, i) => i + 1) };
      case 'witness': return { role: a.role, type: 'watch', floors };
      default: return null;
    }
  }

  function note(s, playerId, data) { s.notes[playerId].push(Object.assign({ day: s.day }, data)); }
  // the accomplice's result of tonight is visible to the murderer (the team has its eyes open together)
  function teamNotes(s, playerId) {
    const me = byId(s, playerId);
    if (me.role !== 'murderer' || s.accompliceId == null || !s.night) return [];
    return s.notes[s.accompliceId].filter((x) => x.day === s.night.forDay && x.kind === 'peek');
  }

  function act(s, playerId, action) {
    const a = currentActor(s);
    if (!a || a.playerId !== playerId) throw new Error('ยังไม่ถึงตาของผู้เล่นนี้');
    const me = byId(s, playerId);
    const n = s.night;
    const floorOk = (f) => Number.isInteger(f) && f >= 1 && f <= s.floors;
    switch (a.role) {
      case 'locksmith': {
        const k = action.room;
        if (typeof k !== 'string' || !openRooms(s).includes(k)) throw new Error('ล็อกห้องนี้ไม่ได้ (ห้องปิดแล้วหรือไม่มีห้องนี้)');
        if (k === s.prevLock) throw new Error('ห้ามล็อกห้องเดิมสองคืนติด');
        n.locked = k; s.prevLock = k; s.lockHistory.push({ day: s.day, room: k });
        note(s, playerId, { kind: 'lock', room: k });
        n.idx++;
        return { ok: true };
      }
      case 'murderer': {
        const k = action.room;
        if (typeof k !== 'string' || !killRooms(s).includes(k)) throw new Error('เลือกห้องนี้ไม่ได้ (ห้องปิดแล้ว ห้องตัวเอง หรือห้องผู้ช่วย)');
        n.chosen = k; n.idx++;
        return { ok: true };
      }
      case 'accomplice': case 'detective': {
        const t = byId(s, action.target);
        if (!t || !t.alive || t.id === playerId) throw new Error('เลือกผู้เล่นนี้ไม่ได้');
        const floor = floorOf(t.room);
        note(s, playerId, { kind: 'peek', target: t.id, floor });
        n.idx++;
        return { ok: true, result: { target: t.id, floor } };
      }
      case 'housekeeper': {
        const f = action.floor;
        if (!floorOk(f)) throw new Error('ชั้นไม่ถูกต้อง');
        const count = aliveList(s).filter((p) => floorOf(p.room) === f).length;
        note(s, playerId, { kind: 'floorCount', floor: f, count });
        n.idx++;
        return { ok: true, result: { floor: f, count } };
      }
      case 'windowcleaner': {
        const c = action.col;
        if (!Number.isInteger(c) || c < 1 || c > s.cols) throw new Error('แถวไม่ถูกต้อง');
        const count = aliveList(s).filter((p) => colOf(p.room) === c).length;
        note(s, playerId, { kind: 'colCount', col: c, count });
        n.idx++;
        return { ok: true, result: { col: c, count } };
      }
      case 'witness': {
        const f = action.floor;
        if (!floorOk(f)) throw new Error('ชั้นไม่ถูกต้อง');
        const m = byId(s, s.murdererId);
        let cmp = 'none';
        if (n.chosen && floorOf(n.chosen) === f) cmp = cmpFloor(floorOf(m.room), f);
        note(s, playerId, { kind: 'watch', floor: f, cmp });
        n.idx++;
        return { ok: true, result: { floor: f, cmp } };
      }
      default: throw new Error('บทบาทนี้ไม่มีสกิลกลางคืน');
    }
  }

  function checkWin(s) {
    if (s.winner) return s.winner;
    const alive = aliveList(s);
    const inn = alive.filter((p) => !isKiller(p)).length;
    const kil = alive.length - inn;
    if (inn <= kil) { s.winner = 'ฆาตกร'; s.winReason = 'ฝ่ายฆาตกรเหลือเท่ากับผู้บริสุทธิ์'; s.phase = 'over'; }
    return s.winner;
  }

  // end of night: resolve the murder and announce the dawn
  function resolveNight(s) {
    if (!s.night || currentActor(s)) throw new Error('กลางคืนยังไม่จบ');
    const n = s.night;
    const key = n.chosen;
    let victim = null, outcome;
    if (key === n.locked) outcome = 'locked';
    else {
      const v = s.players.find((p) => p.alive && p.room === key);
      if (v) { v.alive = false; v.out = 'killed'; victim = v.id; outcome = 'death'; s.closedKind[key] = 'corpse'; }
      else { outcome = 'empty'; s.closedKind[key] = 'empty'; }
      s.closed.add(key);
    }
    n.victim = victim; n.outcome = outcome;
    s.phase = 'dawn';
    s.events.push({ day: s.day, type: outcome, room: key, player: victim });
    checkWin(s);
    return { outcome, room: key, victim };
  }

  // ---------------------------------------------------------------- day
  function startDay(s) {
    if (s.phase !== 'dawn') throw new Error('ต้องผ่านรุ่งเช้าก่อน');
    s.day++;
    s.phase = 'day';
  }

  // public statement (what a player says in the discussion)
  function addClaim(s, byPlayer, claim) {
    s.claims.push(Object.assign({ day: s.day, by: byPlayer }, claim));
  }

  // rooms a player may propose to raid (any room still open)
  function raidOptions(s, pid) {
    const p = byId(s, pid);
    return p && p.alive ? openRooms(s) : null;
  }

  // proposals: [room]; yes: { room: [voterId...] } (hands raised). The host takes proposals from the lowest room number up;
  // the first with more than half of the living players wins. No winner -> nobody is raided today.
  function resolveRaid(s, proposals, yes) {
    if (s.phase !== 'day') throw new Error('ยังไม่ใช่เวลาบุกห้อง');
    const alive = aliveList(s);
    const open = new Set(openRooms(s));
    const list = [...new Set(proposals)].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    list.forEach((k) => { if (!open.has(k)) throw new Error(`ห้อง ${k} เสนอไม่ได้ (ปิดแล้ว)`); });
    const tallies = [];
    let win = null;
    list.forEach((k) => {
      const voters = [...new Set(yes[k] || [])];
      voters.forEach((id) => { if (!byId(s, id) || !byId(s, id).alive) throw new Error('ผู้โหวตไม่ได้อยู่ในเกม'); });
      tallies.push({ room: k, yes: voters.length });
      if (win == null && voters.length * 2 > alive.length) win = k;
    });
    const res = { day: s.day, proposals: list, tallies, alive: alive.length, room: win, outcome: 'skip', player: null };
    if (win != null) {
      s.closed.add(win);
      const occ = s.players.find((p) => p.alive && p.room === win);
      if (!occ) { s.closedKind[win] = 'empty'; res.outcome = 'empty'; }
      else if (occ.id === s.murdererId) {
        s.closedKind[win] = 'raid'; res.outcome = 'murderer'; res.player = occ.id; occ.alive = false; occ.out = 'raided';
        s.winner = 'บริสุทธิ์'; s.winReason = 'บุกถูกห้องของฆาตกร'; s.phase = 'over';
      } else {
        s.closedKind[win] = 'raid'; res.outcome = 'evicted'; res.player = occ.id; occ.alive = false; occ.out = 'raided';
        checkWin(s);
      }
    }
    s.lastRaid = res;
    s.events.push({ day: s.day, type: 'raid', outcome: res.outcome, room: win, player: res.player });
    if (!s.winner && s.day >= DAYS) { s.winner = 'ฆาตกร'; s.winReason = 'ฆาตกรรอดจนครบ 4 วัน'; s.phase = 'over'; }
    if (!s.winner) { s.phase = 'night'; s.night = null; }
    return res;
  }

  // ---------------------------------------------------------------- redacted view (what player `pid` may see)
  function viewFor(s, pid) {
    const over = s.phase === 'over';
    const me = byId(s, pid);
    const mate = partnerOf(s, me);
    const players = s.players.map((p) => {
      const team = !!mate && p.id === mate.id;
      return {
        id: p.id, name: p.name, alive: p.alive, out: p.out,
        role: over || p.id === pid || team ? p.role : null,
        room: over || p.id === pid || team || !p.alive ? p.room : null,
      };
    });
    const v = {
      n: s.n, floors: s.floors, cols: s.cols, day: s.day, days: DAYS, phase: s.phase,
      players, closed: [...s.closed].map((k) => ({ room: k, kind: s.closedKind[k] })),
      claims: s.claims.slice(), events: s.events.slice(), lastRaid: s.lastRaid, winner: s.winner, winReason: s.winReason,
      me: { id: pid, role: me.role, room: me.room, alive: me.alive, notes: s.notes[pid].slice(), mateId: mate ? mate.id : null,
        teamNotes: me.role === 'murderer' && s.accompliceId != null ? s.notes[s.accompliceId].filter((x) => x.kind === 'peek') : [] },
    };
    if (over) v.reveal = { lockHistory: s.lockHistory.slice() };
    return v;
  }

  return {
    COLS, DAYS, CORPSES, ROLES, INFO_ROLES, CLAIM_ROLES, SETUP, mulberry32, shuffle, roomKey, floorOf, colOf, isKiller,
    newGame, startNight, currentActor, nightOptions, killRooms, act, resolveNight, startDay, addClaim,
    raidOptions, resolveRaid, viewFor, checkWin, openRooms, aliveList, partnerOf,
  };
});
