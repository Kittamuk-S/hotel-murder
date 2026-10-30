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
    else if (msg.stage === 'over' || msg.v.winner) assert.equal(msg.mic, true);
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
