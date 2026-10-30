'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const HM = require('../engine.js');

// rig a deterministic 7-player game (the video's table): 7 floors x 3 rooms, 3 corpse rooms
const ROLES7 = ['murderer', 'accomplice', 'locksmith', 'housekeeper', 'windowcleaner', 'detective', 'witness'];
const ROOMS7 = ['601', '203', '402', '303', '102', '502', '701'];
const CLOSED7 = ['401', '101', '503'];
function rig(roles = ROLES7, rooms = ROOMS7, closed = CLOSED7) {
  const s = HM.newGame(roles.length, 1);
  s.players.forEach((p, i) => { p.role = roles[i]; p.room = rooms[i]; p.alive = true; p.out = null; });
  s.closed = new Set(closed); s.closedKind = {}; closed.forEach((k) => { s.closedKind[k] = 'start'; });
  s.murdererId = roles.indexOf('murderer');
  s.accompliceId = roles.indexOf('accomplice') >= 0 ? roles.indexOf('accomplice') : undefined;
  return s;
}
const id = (s, role) => s.players.find((p) => p.role === role).id;
// play one whole night with explicit choices; returns the dawn result
function night(s, plan = {}) {
  s.phase = 'night'; s.night = null;
  HM.startNight(s);
  for (let a = HM.currentActor(s), guard = 0; a; a = HM.currentActor(s)) {
    if (++guard > 30) throw new Error('night() looped: ' + a.role);
    HM.act(s, a.playerId, plan[a.role]);
  }
  return HM.resolveNight(s);
}
const PLAN = { locksmith: { room: '203' }, housekeeper: { floor: 2 }, windowcleaner: { col: 1 }, detective: { target: 3 }, accomplice: { target: 3 }, murderer: { room: '502' }, witness: { floor: 5 } };
const plan = (over) => Object.assign({}, PLAN, over);
const raid = (s, rooms, yes) => HM.resolveRaid(s, rooms, yes);

test('setup: 6-9 players, floors = players, 3 rooms per floor, 3 corpse rooms, roster of the video at 7', () => {
  for (let n = 6; n <= 9; n++) {
    const c = HM.SETUP[n];
    assert.equal(c.roles.length, n);
    assert.equal(c.floors, n);
    assert.equal(c.roles.filter((r) => r === 'murderer').length, 1);
    assert.equal(c.roles.filter((r) => r === 'accomplice').length, 1);
    const s = HM.newGame(n, 5 + n);
    assert.equal(s.closed.size, 3);
    assert.equal(s.cols, 3);
    const homes = s.players.map((p) => p.room);
    assert.equal(new Set(homes).size, n, 'unique homes');
    homes.forEach((h) => { assert.ok(!s.closed.has(h), 'nobody lives in a corpse room'); assert.ok(HM.floorOf(h) >= 1 && HM.floorOf(h) <= n); assert.ok(HM.colOf(h) >= 1 && HM.colOf(h) <= 3); });
  }
  assert.deepEqual(HM.SETUP[7].roles.slice().sort(), ROLES7.slice().sort());
  assert.throws(() => HM.newGame(5, 1));
  assert.throws(() => HM.newGame(10, 1));
  assert.equal(HM.roomKey(4, 1), '401'); assert.equal(HM.floorOf('703'), 7); assert.equal(HM.colOf('703'), 3);
});

test('the game starts on day 1 (a raid happens before the first night)', () => {
  const s = HM.newGame(7, 3);
  assert.equal(s.phase, 'day'); assert.equal(s.day, 1);
  assert.throws(() => HM.startNight(s), /กลางคืน/);
});

test('night order: locksmith, housekeeper, window cleaner, detective, accomplice, murderer, witness; the dead do not act', () => {
  const s = rig(); s.phase = 'night';
  HM.startNight(s);
  assert.deepEqual(s.night.queue.map((q) => q.role), ['locksmith', 'housekeeper', 'windowcleaner', 'detective', 'accomplice', 'murderer', 'witness']);
  const t = rig(); t.players[id(t, 'housekeeper')].alive = false; t.phase = 'night';
  HM.startNight(t);
  assert.ok(!t.night.queue.some((q) => q.role === 'housekeeper'));
});

test('locksmith: any open room, never the same room two nights in a row, never a closed room', () => {
  const s = rig();
  const lock = id(s, 'locksmith');
  night(s, plan({ locksmith: { room: '402' }, murderer: { room: '302' } }));   // protects own room (allowed)
  s.phase = 'night'; s.night = null; HM.startNight(s);
  assert.equal(HM.nightOptions(s, lock).rooms.includes('402'), false);
  assert.throws(() => HM.act(s, lock, { room: '402' }), /เดิม/);
  assert.throws(() => HM.act(s, lock, { room: '401' }), /ล็อกห้องนี้ไม่ได้/);
  assert.throws(() => HM.act(s, lock, { room: '999' }));
  assert.ok(HM.act(s, lock, { room: '203' }).ok);
});

test('murderer cannot pick a closed room, their own room, or the accomplice\'s room', () => {
  const s = rig(); s.phase = 'night'; HM.startNight(s);
  ['locksmith', 'housekeeper', 'windowcleaner', 'detective', 'accomplice'].forEach((r) => HM.act(s, id(s, r), PLAN[r]));
  const m = id(s, 'murderer');
  const rooms = HM.nightOptions(s, m).rooms;
  ['601', '203', '401', '101', '503'].forEach((k) => assert.ok(!rooms.includes(k), k));
  assert.equal(rooms.length, 21 - 3 - 2);
  assert.throws(() => HM.act(s, m, { room: '601' }));
  assert.throws(() => HM.act(s, m, { room: '203' }));
  assert.throws(() => HM.act(s, m, { room: '401' }));
  assert.ok(HM.act(s, m, { room: '502' }).ok);
});

test('murder in an occupied room: owner leaves without a role reveal, the room closes', () => {
  const s = rig();
  const r = night(s, PLAN);
  assert.equal(r.outcome, 'death'); assert.equal(r.room, '502'); assert.equal(r.victim, id(s, 'detective'));
  assert.equal(s.players[r.victim].alive, false); assert.equal(s.players[r.victim].out, 'killed');
  assert.ok(s.closed.has('502')); assert.equal(s.closedKind['502'], 'corpse');
  assert.equal(s.phase, 'dawn');
  const v = HM.viewFor(s, id(s, 'witness'));
  assert.equal(v.players[r.victim].role, null, 'killed player\'s role stays secret');
  assert.equal(v.players[r.victim].room, '502', 'the room is public once the body is found');
});

test('murder in an empty room: announced as empty, room closes, nobody dies', () => {
  const s = rig();
  const r = night(s, plan({ murderer: { room: '302' } }));
  assert.equal(r.outcome, 'empty'); assert.equal(r.victim, null);
  assert.ok(s.closed.has('302')); assert.equal(s.closedKind['302'], 'empty');
  assert.equal(s.players.filter((p) => p.alive).length, 7);
});

test('locked room: the attack fails whether or not the room is occupied, and the room stays open', () => {
  const s = rig();
  const r = night(s, plan({ locksmith: { room: '502' }, murderer: { room: '502' } }));
  assert.equal(r.outcome, 'locked'); assert.equal(r.victim, null);
  assert.equal(s.players[id(s, 'detective')].alive, true);
  assert.ok(!s.closed.has('502'));
  const t = rig();
  const r2 = night(t, plan({ locksmith: { room: '302' }, murderer: { room: '302' } }));       // empty and locked
  assert.equal(r2.outcome, 'locked');
});

test('housekeeper counts the living on a floor (herself included), window cleaner the living in a column, detective only the floor', () => {
  const s = rig();
  night(s, plan({ housekeeper: { floor: 3 }, windowcleaner: { col: 2 }, detective: { target: 0 } }));
  const hk = s.notes[id(s, 'housekeeper')][0], wc = s.notes[id(s, 'windowcleaner')][0], dt = s.notes[id(s, 'detective')][0];
  assert.equal(hk.count, 1);                                    // 303 is the housekeeper's own room
  assert.equal(wc.count, 3);                                    // column 2: 402, 102, 502
  assert.deepEqual(dt, { day: 1, kind: 'peek', target: 0, floor: 6 });
  assert.equal(dt.room, undefined);
});

test('counts only include the living', () => {
  const s = rig();
  s.players[id(s, 'detective')].alive = false;                  // the detective (502) is dead
  s.phase = 'night'; s.night = null;
  HM.startNight(s);
  ['locksmith', 'housekeeper'].forEach((r) => HM.act(s, id(s, r), r === 'locksmith' ? { room: '402' } : { floor: 3 }));
  HM.act(s, id(s, 'windowcleaner'), { col: 2 });
  assert.equal(s.notes[id(s, 'windowcleaner')][0].count, 3 - 1 - 0);
});

test('witness: learns higher/lower/equal only when watching the floor the murderer picked', () => {
  const same = rig();                                             // murderer lives on 6, picks 502 -> floor 5
  night(same, plan({ witness: { floor: 5 } }));
  assert.equal(same.notes[id(same, 'witness')][0].cmp, 'higher');
  const wrong = rig();
  night(wrong, plan({ witness: { floor: 4 } }));
  assert.equal(wrong.notes[id(wrong, 'witness')][0].cmp, 'none');
  const low = rig(); low.players[0].room = '201';
  night(low, plan({ murderer: { room: '502' }, witness: { floor: 5 } }));
  assert.equal(low.notes[id(low, 'witness')][0].cmp, 'lower');
  const eq = rig(); eq.players[0].room = '501';
  night(eq, plan({ murderer: { room: '502' }, witness: { floor: 5 } }));
  assert.equal(eq.notes[id(eq, 'witness')][0].cmp, 'equal');
  const locked = rig();                                           // a locked attack still counts as the murderer's choice
  night(locked, plan({ locksmith: { room: '502' }, witness: { floor: 5 } }));
  assert.equal(locked.notes[id(locked, 'witness')][0].cmp, 'higher');
});

test('the killer team knows each other (role and room); everyone else sees nothing about them', () => {
  const s = rig();
  const m = HM.viewFor(s, 0), a = HM.viewFor(s, 1), w = HM.viewFor(s, id(s, 'witness'));
  assert.equal(m.players[1].role, 'accomplice'); assert.equal(m.players[1].room, '203'); assert.equal(m.me.mateId, 1);
  assert.equal(a.players[0].role, 'murderer'); assert.equal(a.players[0].room, '601');
  assert.equal(w.players[0].role, null); assert.equal(w.players[0].room, null); assert.equal(w.players[1].role, null);
  assert.equal(w.players[w.me.id].role, 'witness'); assert.equal(w.me.mateId, null);
  assert.equal(HM.viewFor(s, id(s, 'detective')).players[3].room, null);
});

test('the murderer sees the accomplice\'s result of the same night', () => {
  const s = rig(); s.phase = 'night'; HM.startNight(s);
  ['locksmith', 'housekeeper', 'windowcleaner', 'detective'].forEach((r) => HM.act(s, id(s, r), PLAN[r]));
  HM.act(s, 1, { target: 4 });
  const opts = HM.nightOptions(s, 0);
  assert.deepEqual(opts.teamNotes.map((n) => [n.target, n.floor]), [[4, 1]]);
  assert.equal(HM.viewFor(s, 0).me.teamNotes.length, 1);
  assert.equal(HM.viewFor(s, id(s, 'detective')).me.teamNotes.length, 0);
});

test('raid: needs MORE than half of the living; lowest room number is counted first', () => {
  const s = rig();
  let r = raid(s, ['302'], { '302': [0, 1, 2] });                 // 3 of 7 is not a majority
  assert.equal(r.outcome, 'skip'); assert.equal(r.room, null);
  assert.equal(s.phase, 'night'); assert.equal(s.night, null); assert.ok(!s.closed.has('302'));
  const t = rig();
  r = raid(t, ['302', '202'], { '302': [0, 1, 2, 3], '202': [0, 1, 2, 3, 4] });
  assert.equal(r.room, '202', 'the lower number is tried first and wins');
  assert.equal(r.outcome, 'empty');
  const u = rig();
  r = raid(u, ['302', '202'], { '302': [0, 1, 2, 3], '202': [0, 1, 2] });
  assert.equal(r.room, '302', 'a failed first proposal does not block the next');
});

test('raid: empty room just closes; an occupied room sends its owner out WITHOUT a role reveal', () => {
  const s = rig();
  let r = raid(s, ['302'], { '302': [0, 1, 2, 3] });
  assert.equal(r.outcome, 'empty'); assert.equal(s.closedKind['302'], 'empty');
  const t = rig();
  r = raid(t, ['402'], { '402': [0, 1, 3, 4] });                  // the locksmith's room
  assert.equal(r.outcome, 'evicted'); assert.equal(r.player, id(t, 'locksmith'));
  assert.equal(t.players[r.player].alive, false); assert.equal(t.players[r.player].out, 'raided');
  assert.equal(HM.viewFor(t, 0).players[r.player].role, null);
  assert.equal(HM.viewFor(t, 0).players[r.player].room, '402');
  assert.equal(t.phase, 'night', 'game goes on');
  assert.throws(() => HM.resolveRaid(t, ['302'], { '302': [0, 1, 3, 4] }), /ยังไม่ใช่เวลา/);
});

test('raid: the murderer\'s room ends the game for the innocents', () => {
  const s = rig();
  const r = raid(s, ['601'], { '601': [2, 3, 4, 5] });
  assert.equal(r.outcome, 'murderer'); assert.equal(s.winner, 'บริสุทธิ์'); assert.equal(s.phase, 'over');
  assert.ok(HM.viewFor(s, 2).reveal);
  assert.equal(HM.viewFor(s, 2).players[0].role, 'murderer');
});

test('raiding the accomplice\'s room removes them but the game continues', () => {
  const s = rig();
  const r = raid(s, ['203'], { '203': [2, 3, 4, 5] });
  assert.equal(r.outcome, 'evicted'); assert.equal(s.winner, null); assert.equal(s.phase, 'night');
  assert.equal(s.players[1].alive, false);
});

test('raid input checks: closed room, dead voter', () => {
  const s = rig();
  assert.throws(() => raid(s, ['401'], { '401': [0, 1, 2, 3] }), /ปิดแล้ว/);
  s.players[6].alive = false;
  assert.throws(() => raid(s, ['302'], { '302': [6, 0, 1, 2] }), /ไม่ได้อยู่ในเกม/);
  assert.equal(HM.raidOptions(s, 6), null);
  assert.ok(HM.raidOptions(s, 0).includes('302'));
});

test('killer team wins when the innocents no longer outnumber them (2 v 2 in the video)', () => {
  const s = rig();
  s.players[id(s, 'housekeeper')].alive = false; s.players[id(s, 'windowcleaner')].alive = false;   // 3 innocents v 2
  const r = night(s, plan({ detective: { target: 6 }, accomplice: { target: 6 } }));   // detective dies -> 2 v 2
  assert.equal(r.outcome, 'death');
  assert.equal(s.winner, 'ฆาตกร'); assert.equal(s.phase, 'over');
  const t = rig();                                               // a raid can also tip the balance
  t.players[id(t, 'housekeeper')].alive = false; t.players[id(t, 'windowcleaner')].alive = false;
  const r2 = raid(t, ['402'], { '402': [0, 1, 5, 6] });
  assert.equal(r2.outcome, 'evicted'); assert.equal(t.winner, 'ฆาตกร');
});

test('four days: day -> night -> dawn -> day ... the murderer escapes if day 4 ends without finding the room', () => {
  const s = rig();
  for (let d = 1; d <= 3; d++) {
    assert.equal(s.day, d); assert.equal(s.phase, 'day');
    raid(s, [], {});
    assert.equal(s.phase, 'night');
    night(s, plan({ locksmith: { room: d % 2 ? '203' : '402' }, murderer: { room: ['302', '202', '303'][d - 1] } }));   // empty rooms, nobody dies
    assert.equal(s.winner, null);
    HM.startDay(s);
  }
  assert.equal(s.day, 4);
  raid(s, [], {});
  assert.equal(s.winner, 'ฆาตกร'); assert.equal(s.winReason, 'ฆาตกรรอดจนครบ 4 วัน'); assert.equal(s.phase, 'over');
});

test('finding the murderer on day 4 still wins for the innocents', () => {
  const s = rig(); s.day = 4;
  raid(s, ['601'], { '601': [2, 3, 4, 5] });
  assert.equal(s.winner, 'บริสุทธิ์');
});

test('redaction: before the end nobody can see another player\'s role', () => {
  const s = rig();
  for (let me = 2; me < 7; me++) {
    const v = HM.viewFor(s, me);
    v.players.forEach((p) => { if (p.id !== me) { assert.equal(p.role, null); assert.equal(p.room, null); } });
    assert.equal(v.reveal, undefined);
  }
});

test('claims are public and stamped with the day', () => {
  const s = rig(); s.day = 2;
  HM.addClaim(s, 2, { as: 'locksmith', kind: 'lock', room: '402' });
  assert.deepEqual(s.claims[0], { day: 2, by: 2, as: 'locksmith', kind: 'lock', room: '402' });
});
