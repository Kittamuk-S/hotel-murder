/* Hotel Murder - bot brains. Bots only ever see HM.viewFor(state, botId) plus the options the engine offers them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.HMBots = factory(root.HM);
})(typeof self !== 'undefined' ? self : this, function (HM) {
  'use strict';

  const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo, hi, rnd) => lo + Math.floor(rnd() * (hi - lo + 1));
  function weighted(items, weights, rnd) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return pick(items, rnd);
    let r = rnd() * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  const isKillerRole = (r) => HM.ROLES[r].side === 'ฆาตกร';

  // floors of players the killer team has looked at (the partner is never in there: peeks skip the partner)
  function knownFloors(view) {
    return view.me.notes.concat(view.me.teamNotes || []).filter((n) => n.kind === 'peek').map((n) => n.floor);
  }

  // ------------------------------------------------------------ night
  // returns { room | floor | col | target }
  function botNight(view, options, rnd) {
    const mine = view.me.notes;
    switch (options.type) {
      case 'lock': {
        if (options.rooms.includes(view.me.room) && rnd() < 0.35) return { room: view.me.room };
        return { room: pick(options.rooms, rnd) };
      }
      case 'kill': {
        const fl = knownFloors(view);
        const onKnown = options.rooms.filter((k) => fl.includes(HM.floorOf(k)));
        if (onKnown.length && rnd() < 0.7) return { room: pick(onKnown, rnd) };
        return { room: pick(options.rooms, rnd) };
      }
      case 'peek': {
        const seen = new Set(mine.filter((n) => n.kind === 'peek').map((n) => n.target));
        const pool = options.targets.filter((id) => id !== view.me.mateId && !seen.has(id));
        const any = options.targets.filter((id) => id !== view.me.mateId);
        return { target: pick(pool.length ? pool : (any.length ? any : options.targets), rnd) };
      }
      case 'floor': case 'watch': {
        const seen = new Set(mine.filter((n) => n.kind === (options.type === 'floor' ? 'floorCount' : 'watch')).map((n) => n.floor));
        const pool = options.floors.filter((f) => !seen.has(f));
        return { floor: pick(pool.length ? pool : options.floors, rnd) };
      }
      case 'column': {
        const seen = new Set(mine.filter((n) => n.kind === 'colCount').map((n) => n.col));
        const pool = options.cols.filter((c) => !seen.has(c));
        return { col: pick(pool.length ? pool : options.cols, rnd) };
      }
      default: throw new Error('unknown option type ' + options.type);
    }
  }

  // ------------------------------------------------------------ day: public claims
  // results of the night that just ended (notes are stamped with the day of their night)
  function realClaims(view) {
    const role = view.me.role;
    return view.me.notes.filter((n) => n.day === view.day - 1).map((n) => { const c = Object.assign({ as: role }, n); delete c.day; return c; });
  }
  function attackedFloor(view, night) {
    const e = view.events.find((x) => x.day === night && x.room && ['death', 'empty', 'locked'].includes(x.type));
    return e ? HM.floorOf(e.room) : null;
  }
  function fakeClaim(view, rnd, as) {
    const others = view.players.filter((p) => p.alive && p.id !== view.me.id).map((p) => p.id);
    const open = view.floors;
    switch (as) {
      case 'locksmith': {
        const closed = new Set(view.closed.map((c) => c.room));
        const rooms = []; for (let f = 1; f <= view.floors; f++) for (let c = 1; c <= view.cols; c++) { const k = HM.roomKey(f, c); if (!closed.has(k)) rooms.push(k); }
        return { as, kind: 'lock', room: pick(rooms, rnd) };
      }
      case 'housekeeper': return { as, kind: 'floorCount', floor: int(1, open, rnd), count: int(0, 3, rnd) };
      case 'windowcleaner': return { as, kind: 'colCount', col: int(1, view.cols, rnd), count: int(0, 4, rnd) };
      case 'witness': {
        const af = attackedFloor(view, view.day - 1);
        return { as, kind: 'watch', floor: af != null && rnd() < 0.6 ? af : int(1, open, rnd), cmp: pick(['higher', 'lower', 'equal', 'none'], rnd) };
      }
      default: return { as: 'detective', kind: 'peek', target: pick(others, rnd), floor: int(1, open, rnd) };
    }
  }
  function botClaims(view, rnd) {
    const role = view.me.role;
    const out = [];
    if (!view.me.alive || view.day < 2) return out;
    if (role === 'murderer') {
      if (rnd() < 0.6) out.push(fakeClaim(view, rnd, pick(HM.CLAIM_ROLES, rnd)));
    } else if (role === 'accomplice') {
      const real = realClaims(view).filter((c) => c.kind === 'peek');
      if (real.length && rnd() < 0.5) out.push(Object.assign({}, real[0], { as: 'detective' }));
      else if (rnd() < 0.4) out.push(fakeClaim(view, rnd, pick(HM.CLAIM_ROLES, rnd)));
    } else if (role !== 'guest') {
      realClaims(view).forEach((c) => { if (rnd() < 0.88) out.push(c); });
    }
    return out;
  }

  // ------------------------------------------------------------ deduction from public information only
  function applyCmp(fw, cmp, f, good, bad) {
    Object.keys(fw).forEach((k) => {
      const fl = +k;
      const ok = cmp === 'higher' ? fl > f : cmp === 'lower' ? fl < f : fl === f;
      fw[fl] *= ok ? good : bad;
    });
  }
  // weights for "which floor / column is the murderer's room on"
  function analyse(view) {
    const fw = {}, cw = {};
    for (let f = 1; f <= view.floors; f++) fw[f] = 1;
    for (let c = 1; c <= view.cols; c++) cw[c] = 1;
    view.claims.filter((c) => c.by !== view.me.id).forEach((c) => {
      if (c.kind === 'watch' && c.cmp !== 'none' && attackedFloor(view, c.day - 1) === c.floor) applyCmp(fw, c.cmp, c.floor, 3, 0.3);
      if (c.kind === 'floorCount' && c.count === 0 && fw[c.floor] != null) fw[c.floor] *= 0.3;
      if (c.kind === 'colCount' && c.count === 0 && cw[c.col] != null) cw[c.col] *= 0.3;
    });
    view.me.notes.forEach((n) => {                                        // what I saw myself beats anyone's claim
      if (n.kind === 'watch' && n.cmp !== 'none') applyCmp(fw, n.cmp, n.floor, 1, 0.001);
      if (n.kind === 'floorCount' && n.count === 0) fw[n.floor] = 0.001;
      if (n.kind === 'colCount' && n.count === 0) cw[n.col] = 0.001;
    });
    return { fw, cw };
  }
  function roomScore(view, a, room) {
    return a.fw[HM.floorOf(room)] * a.cw[HM.colOf(room)] * (room === view.me.room ? 0.01 : 1);
  }
  function openRooms(view) {
    const closed = new Set(view.closed.map((c) => c.room));
    const out = [];
    for (let f = 1; f <= view.floors; f++) for (let c = 1; c <= view.cols; c++) { const k = HM.roomKey(f, c); if (!closed.has(k)) out.push(k); }
    return out;
  }

  // ------------------------------------------------------------ raiding
  // the room this bot proposes (or null)
  function botProposal(view, rnd) {
    const rooms = openRooms(view);
    const mate = view.me.mateId != null ? view.players[view.me.mateId].room : null;
    if (isKillerRole(view.me.role)) {
      const pool = rooms.filter((k) => k !== view.me.room && k !== mate);
      const fl = knownFloors(view);
      const onKnown = pool.filter((k) => fl.includes(HM.floorOf(k)));
      return onKnown.length && rnd() < 0.5 ? pick(onKnown, rnd) : pick(pool, rnd);
    }
    const a = analyse(view);
    return weighted(rooms, rooms.map((k) => roomScore(view, a, k)), rnd);
  }
  // does this bot raise its hand for `room`?
  function botSupport(view, room, rnd, mine) {
    if (mine) return true;
    const mate = view.me.mateId != null ? view.players[view.me.mateId].room : null;
    if (isKillerRole(view.me.role)) return room !== view.me.room && room !== mate && rnd() < 0.55;
    if (room === view.me.room) return false;
    const a = analyse(view);
    const rooms = openRooms(view);
    const max = Math.max(...rooms.map((k) => roomScore(view, a, k)));
    return rnd() < Math.min(0.9, 0.2 + 0.7 * (roomScore(view, a, room) / max));
  }

  return { botNight, botClaims, fakeClaim, realClaims, botProposal, botSupport, analyse, roomScore, attackedFloor };
});
