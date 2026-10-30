'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const HM = require('../engine.js');
const { createHost } = require('../online-host.js');

// fake network: send() queues, the loop delivers each message to a scripted "client" that answers like a human would
function table(n, humanSeats, seed, opts = {}) {
  const queue = [], seen = [];
  let clock = 1000;
  const names = Array.from({ length: n }, (_, i) => `P${i}`);
  const host = createHost({ n, seed, names, humans: humanSeats, now: () => clock, send: (seat, msg) => queue.push({ seat, msg }), dayMs: 5000 });
  const answered = new Set();
  const rnd = HM.mulberry32(seed + 99);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const mute = new Set(opts.mute || []);                 // seats that never answer (to test the timers)

  function respond(seat, m) {
    if (mute.has(seat) || m.t !== 'screen') return;
    const key = `${seat}|${m.stage}|${m.scr}|${m.v.day}|${m.v.events.length}`;
    if (answered.has(key)) return; answered.add(key);
    switch (m.scr) {
      case 'role': case 'dawn': case 'raid': return host.receive(seat, { t: 'ack' });
      case 'result': return host.receive(seat, { t: 'resultAck' });
      case 'action': {
        const o = m.options;
        const action = o.type === 'lock' || o.type === 'kill' ? { room: pick(o.rooms) } : o.type === 'floor' || o.type === 'watch' ? { floor: pick(o.floors) }
          : o.type === 'column' ? { col: pick(o.cols) } : { target: pick(o.targets) };
        return host.receive(seat, { t: 'night', action });
      }
      case 'day': {
        if (!m.v.me.alive) return;
        if (m.claimOptions && m.claimOptions.length) host.receive(seat, { t: 'say', i: 0 });
        if (m.rooms && m.rooms.length && rnd() < 0.7) host.receive(seat, { t: 'propose', room: pick(m.rooms) });
        return host.receive(seat, { t: 'voteReady' });
      }
      case 'vote': return host.receive(seat, { t: 'hands', yes: m.ballot.filter(() => rnd() < 0.6).map((b) => b.room) });
      default:
    }
  }
  function run(maxSteps = 5000) {
    host.start();
    for (let i = 0, idle = 0; i < maxSteps && host.stage !== 'over' && idle < 8; i++) {
      if (!queue.length) { clock += 100000; host.tick(); idle++; continue; }     // nobody left to answer: let the deadlines pass
      idle = 0;
      const { seat, msg } = queue.shift();
      seen.push({ seat, msg });
      respond(seat, msg);
    }
    while (queue.length) seen.push(queue.shift());
  }
  return { host, run, seen, queue, tick: (ms) => { clock += ms; host.tick(); }, setClock: (t) => { clock = t; } };
}

test('all-human tables of every size play to the end', () => {
  for (let n = 6; n <= 9; n++) {
    for (let seed = 1; seed <= 20; seed++) {
      const t = table(n, Array.from({ length: n }, (_, i) => i), seed * 13 + n);
      t.run();
      assert.equal(t.host.S.phase, 'over', `n=${n} seed=${seed}`);
      assert.equal(t.host.stage, 'over');
      assert.ok(t.host.S.day <= HM.DAYS);
    }
  }
});

test('mixed table (3 humans + bots) finishes, and the dead are not asked to act', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const t = table(7, [0, 3, 5], seed);
    t.run();
    assert.equal(t.host.stage, 'over', `seed=${seed}`);
    t.seen.filter((x) => x.msg.scr === 'action').forEach((x) => assert.ok(x.msg.v.me.alive));
  }
});

test('a seat never learns another seat\'s secrets before the game ends', () => {
  const t = table(8, [0, 1, 2, 3, 4, 5, 6, 7], 5);
  t.run();
  t.seen.filter((x) => x.msg.t === 'screen' && x.msg.stage !== 'over' && !x.msg.v.winner).forEach(({ seat, msg }) => {
    msg.v.players.forEach((p) => {
      if (p.id === seat || !p.alive) return;
      const mate = msg.v.me.mateId === p.id;
      if (!mate) { assert.equal(p.role, null, 'role of a living stranger'); assert.equal(p.room, null, 'room of a living stranger'); }
    });
    assert.equal(msg.v.me.id, seat);
    if (msg.scr !== 'action') assert.equal(msg.options, undefined, 'night options only on your own turn');
    assert.ok(!('S' in msg) && !('state' in msg));
  });
  const last = t.seen.filter((x) => x.msg.stage === 'over');
  assert.ok(last.length, 'final reveal sent');
  last.forEach(({ msg }) => msg.v.players.forEach((p) => assert.ok(p.role)));
});

test('microphones are closed at night, and for the dead until the game is over', () => {
  const t = table(7, [0, 1, 2, 3, 4, 5, 6], 21);
  t.run();
  t.seen.filter((x) => x.msg.t === 'screen').forEach(({ msg }) => {
    if (msg.stage === 'night') assert.equal(msg.mic, false);
    else if (msg.stage === 'over') assert.equal(msg.mic, true);
    else assert.equal(msg.mic, msg.v.me.alive);
  });
  assert.ok(t.seen.some((x) => x.msg.stage === 'day' && x.msg.mic === true), 'day talk is open');
});

test('a silent player cannot stall the table: deadlines move the game on', () => {
  const t = table(6, [0, 1], 3, { mute: [1] });
  t.run();
  assert.equal(t.host.stage, 'over');
});

test('a player who leaves is replaced by a bot and the game finishes', () => {
  const t = table(7, [0, 1, 2], 9);
  t.host.start();
  for (let i = 0; i < 6 && t.queue.length; i++) { const { seat, msg } = t.queue.shift(); t.seen.push({ seat, msg }); }
  t.host.dropSeat(1);
  assert.ok(!t.host.humans.includes(1));
  t.run();
  assert.equal(t.host.stage, 'over');
});

test('bad input is refused without breaking the game', () => {
  const t = table(7, [0, 1, 2, 3, 4, 5, 6], 4);
  t.host.start();
  t.queue.length = 0;
  t.host.receive(0, { t: 'night', action: { room: '101' } });          // not night, not his turn
  assert.equal(t.queue[0].msg.t, 'error');
  t.host.receive(99, { t: 'ack' });                                   // not a seat
  t.host.receive(0, { t: 'propose', room: '101' });                   // not day
  assert.equal(t.host.stage, 'role');
});

// ---- helpers for the scripted tests below
function drain(t) { const out = t.queue.splice(0); out.forEach((x) => t.seen.push(x)); return out; }
function nightAction(o) {
  return o.type === 'lock' || o.type === 'kill' ? { room: o.rooms[0] } : o.type === 'floor' || o.type === 'watch' ? { floor: o.floors[0] }
    : o.type === 'column' ? { col: o.cols[0] } : { target: o.targets[0] };
}
function answer(t, { seat, msg }) {
  if (msg.t !== 'screen') return;
  if (['role', 'dawn', 'raid'].includes(msg.scr)) t.host.receive(seat, { t: 'ack' });
  else if (msg.scr === 'action') t.host.receive(seat, { t: 'night', action: nightAction(msg.options) });
  else if (msg.scr === 'result') t.host.receive(seat, { t: 'resultAck' });
  else if (msg.scr === 'day' && msg.v.me.alive) t.host.receive(seat, { t: 'voteReady' });
  else if (msg.scr === 'vote') t.host.receive(seat, { t: 'hands', yes: [] });
}
function toDay(t) {            // all humans ack the role screen -> day 1
  t.host.start(); drain(t);
  t.host.humans.forEach((s) => t.host.receive(s, { t: 'ack' }));
  assert.equal(t.host.stage, 'day');
  drain(t);
}

test('dropSeat at night does not extend the current actor deadline, even when repeated', () => {
  const t = table(8, [0, 1, 2, 3, 4, 5, 6, 7], 11);
  t.host.start();
  let guard = 0;
  while (t.host.stage !== 'night' && guard++ < 100) {
    const msgs = t.queue.splice(0);
    msgs.forEach((x) => t.seen.push(x));
    msgs.forEach((x) => answer(t, x));
    if (!t.queue.length && t.host.stage !== 'night') t.tick(100000);
  }
  assert.equal(t.host.stage, 'night');
  const actor = HM.currentActor(t.host.S).playerId;
  const before = t.queue.filter((x) => x.seat === actor && x.msg.t === 'screen' && x.msg.stage === 'night').pop();
  assert.ok(before, 'actor was sent its night screen');
  drain(t);
  const others = t.host.humans.filter((s) => s !== actor);
  t.tick(10000);
  others.slice(0, 3).forEach((s) => { t.host.dropSeat(s); assert.equal(HM.currentActor(t.host.S).playerId, actor); });
  const after = drain(t).filter((x) => x.seat === actor && x.msg.t === 'screen').pop().msg;
  assert.equal(after.scr, 'action');
  assert.equal(after.deadline, before.msg.deadline, 'deadline not reset by drops');
});

test('dropSeat keeps another seat pending night result screen', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const t = table(8, [0, 1, 2, 3, 4, 5, 6, 7], seed);
    t.host.start();
    for (let guard = 0; guard < 400 && t.host.stage !== 'over'; guard++) {
      const msgs = drain(t);
      const res = msgs.find((x) => x.msg.t === 'screen' && x.msg.scr === 'result');
      if (res) {
        const other = t.host.humans.find((s) => s !== res.seat);
        t.host.dropSeat(other);
        const again = drain(t).filter((x) => x.seat === res.seat && x.msg.t === 'screen').pop();
        assert.ok(again);
        assert.equal(again.msg.scr, 'result');
        return;
      }
      msgs.forEach((x) => answer(t, x));
      if (!t.queue.length) t.tick(100000);
    }
  }
  assert.fail('no result screen encountered');
});

test('rejoinSeat: a dropped seat is human again, gets only its own redacted view, game still finishes', () => {
  const t = table(7, [0, 1, 2], 9);
  t.host.start(); drain(t);
  t.host.dropSeat(1);
  assert.equal(t.host.rejoinSeat(0), false, 'never dropped');
  assert.equal(t.host.rejoinSeat(5), false, 'never human');
  drain(t);
  assert.equal(t.host.rejoinSeat(1), true);
  assert.ok(t.host.humans.includes(1));
  assert.equal(t.host.rejoinSeat(1), false, 'already back');
  const mine = drain(t).filter((x) => x.seat === 1 && x.msg.t === 'screen');
  assert.ok(mine.length);
  mine.forEach(({ msg }) => {
    assert.equal(msg.v.me.id, 1);
    msg.v.players.forEach((p) => { if (p.id !== 1 && p.alive && msg.v.me.mateId !== p.id) assert.equal(p.role, null); });
  });
  t.run();
  assert.equal(t.host.stage, 'over');
});

test('rejoin mid-game after a drop in the day stage', () => {
  const t = table(7, [0, 1, 2], 15);
  toDay(t);
  t.host.dropSeat(2);
  assert.equal(t.host.rejoinSeat(2), true);
  const m = drain(t).filter((x) => x.seat === 2 && x.msg.t === 'screen').pop().msg;
  assert.equal(m.stage, 'day'); assert.equal(m.v.me.id, 2);
  t.run();
  assert.equal(t.host.stage, 'over');
});

test('bluffs are capped at 3 per seat per day; the extra one gets an error', () => {
  const t = table(7, [0, 1, 2, 3, 4, 5, 6], 6);
  t.host.start();
  for (let guard = 0; guard < 600 && !(t.host.stage === 'day' && t.host.S.day === 2) && t.host.stage !== 'over'; guard++) {
    drain(t).forEach((x) => answer(t, x));
    if (!t.queue.length) t.tick(100000);
  }
  assert.equal(t.host.stage, 'day'); assert.equal(t.host.S.day, 2);
  const seat = t.host.humans.find((s) => t.host.S.players[s].alive);
  drain(t);
  for (let i = 0; i < 3; i++) t.host.receive(seat, { t: 'bluff', as: HM.CLAIM_ROLES[0] });
  assert.ok(!drain(t).some((x) => x.msg.t === 'error'), 'first three are fine');
  t.host.receive(seat, { t: 'bluff', as: HM.CLAIM_ROLES[0] });
  assert.ok(drain(t).some((x) => x.seat === seat && x.msg.t === 'error'));
});

test('react: whitelisted, rate limited per seat, broadcast to every human including the dead', () => {
  const t = table(7, [0, 1, 2], 2);
  toDay(t);
  t.host.receive(0, { t: 'react', e: '😱' });
  const got = drain(t);
  assert.equal(got.length, 3);
  got.forEach((x) => { assert.deepEqual(x.msg, { t: 'react', by: 0, e: '😱', id: 1 }); });
  t.host.receive(0, { t: 'react', e: '👍' });                 // too soon
  assert.equal(drain(t).length, 0);
  t.host.receive(1, { t: 'react', e: '🔪' });                 // other seat has its own budget
  assert.equal(drain(t).length, 3);
  t.host.receive(1, { t: 'react', e: '💩' });                 // not on the list
  t.tick(2000);
  assert.equal(drain(t).filter((x) => x.msg.t === 'react').length, 0);
  t.host.receive(0, { t: 'react', e: '👍' });
  const again = drain(t).filter((x) => x.msg.t === 'react');
  assert.equal(again.length, 3); assert.equal(again[0].msg.id, 3);
  t.host.receive(99, { t: 'react', e: '👍' });
  assert.equal(drain(t).length, 0);
  t.host.S.players[2].alive = false;                           // a dead human may react
  t.host.receive(2, { t: 'react', e: '😂' });
  assert.equal(drain(t).length, 3);
});

test('day payload exposes passed (voteReady seats) and proposals', () => {
  const t = table(7, [0, 1, 2], 2);
  toDay(t);
  t.host.receive(1, { t: 'voteReady' });
  const m = drain(t).filter((x) => x.seat === 0 && x.msg.stage === 'day').pop().msg;
  assert.deepEqual(m.passed, [1]);
  assert.deepEqual(m.readyVote, [1]);
  assert.ok(Array.isArray(m.proposals));
});

test('when only dead humans remain the table waits for their ack or the deadline', () => {
  const t = table(7, [0], 4);
  toDay(t);
  t.host.S.players[0].alive = false;                          // the only human is a spectator now
  t.tick(1);
  assert.equal(t.host.stage, 'day', 'day is not skipped');
  t.host.receive(0, { t: 'voteReady' });                       // spectator may pass the day when nobody alive is left
  assert.notEqual(t.host.stage, 'day');
  let waited = false;
  for (let i = 0; i < 60 && t.host.stage !== 'over'; i++) {
    const st = t.host.stage;
    if (st === 'dawn' || st === 'raid') {
      t.tick(1000);
      if (t.host.stage === st) { waited = true; t.host.receive(0, { t: 'ack' }); }
    } else { drain(t); t.tick(100000); }
  }
  assert.ok(waited, 'waited for the spectator ack at dawn/raid');
  const t2 = table(7, [0], 4);
  toDay(t2);
  t2.host.S.players[0].alive = false;
  t2.host.dropSeat(0);                                         // nobody connected: nothing to wait for
  t2.run();
  assert.equal(t2.host.stage, 'over');
});

test('dawn/raid payloads of a finished game hide other roles; the reveal comes only at stage over', () => {
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const t = table(7, [0, 1, 2, 3, 4, 5, 6], seed);
    t.run();
    t.seen.filter((x) => x.msg.t === 'screen' && x.msg.v.winner && x.msg.stage !== 'over').forEach(({ seat, msg }) => {
      checked++;
      msg.v.players.forEach((p) => {
        if (p.id === seat || msg.v.me.mateId === p.id) return;
        if (p.alive) assert.equal(p.role, null, `stage ${msg.stage} leaks role of living ${p.id}`);
      });
    });
    t.seen.filter((x) => x.msg.stage === 'over').forEach(({ msg }) => msg.v.players.forEach((p) => assert.ok(p.role)));
  }
  assert.ok(checked > 0, 'saw decided-but-held payloads');
});

test('m.chat carries only the fields of public claims, and the mic opens for all only at stage over', () => {
  const ALLOWED = ['as', 'kind', 'floor', 'count', 'col', 'room', 'target', 'cmp'];
  let chats = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const t = table(7, [0, 1, 2], seed);
    t.run();
    t.seen.filter((x) => x.msg.t === 'screen').forEach(({ msg }) => {
      if (msg.stage !== 'over' && msg.v.winner && !msg.v.me.alive) assert.equal(msg.mic, false, 'dead stay muted until stage over');
      (msg.chat || []).forEach((c) => {
        chats++;
        assert.deepEqual(Object.keys(c).sort(), ['by', 'claim', 'text']);
        Object.keys(c.claim).forEach((k) => assert.ok(ALLOWED.includes(k), 'leaked field ' + k));
        assert.ok(c.claim.as && c.claim.kind);
      });
    });
  }
  assert.ok(chats > 0, 'saw claims');
});

test('reactions are broadcast to every human seat and rate-limited per seat', () => {
  const t = table(7, [0, 1], 5);
  t.host.start(); t.queue.length = 0;
  t.host.receive(1, { t: 'react', e: '😱' });
  t.host.receive(1, { t: 'react', e: '😱' });          // too soon
  t.host.receive(1, { t: 'react', e: 'x' });            // not allowed
  const got = t.queue.filter((q) => q.msg.t === 'react');
  assert.equal(got.length, 2);                          // one per human seat
  assert.ok(got.every((q) => q.msg.by === 1 && q.msg.e === '😱'));
});

test('rejoinSeat brings a dropped human back, sync re-sends only to a connected human', () => {
  const t = table(7, [0, 1, 2], 8);
  t.host.start(); t.queue.length = 0;
  t.host.dropSeat(1);
  t.queue.length = 0;
  assert.equal(t.host.rejoinSeat(1), true);
  assert.ok(t.queue.some((q) => q.seat === 1 && q.msg.t === 'screen'));
  assert.equal(t.host.rejoinSeat(1), false);
  t.queue.length = 0;
  t.host.sync(1); t.host.sync(5);                    // 5 is a bot seat
  assert.deepEqual(t.queue.map((q) => q.seat), [1]);
});

test('final payload tells who proposed the raided room', () => {
  let saw = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = table(7, [0, 1, 2], seed);
    t.run();
    t.seen.filter((x) => x.msg.stage === 'over').forEach(({ msg }) => { saw++; assert.ok(Array.isArray(msg.raidBy)); msg.raidBy.forEach((id) => assert.ok(msg.v.players[id])); });
  }
  assert.ok(saw > 0);
});
