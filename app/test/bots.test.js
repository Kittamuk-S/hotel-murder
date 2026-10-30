'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const HM = require('../engine.js');
const Bots = require('../bots.js');
const Ctl = require('../controller.js');

function play(n, seed) {
  const s = HM.newGame(n, seed);
  const ctl = Ctl.create(s, null, seed);
  ctl.autoplay();
  return s;
}

test('bots play every table size to the end, within 4 days, with legal moves only', () => {
  for (let n = 6; n <= 9; n++) {
    for (let seed = 1; seed <= 60; seed++) {
      const s = play(n, seed * 7 + n);
      assert.equal(s.phase, 'over', `n=${n} seed=${seed}`);
      assert.ok(s.winner === 'บริสุทธิ์' || s.winner === 'ฆาตกร');
      assert.ok(s.day <= HM.DAYS);
      s.players.filter((p) => !p.alive).forEach((p) => assert.ok(s.closed.has(p.room), 'dead player\'s room is closed'));
      s.events.filter((e) => e.type === 'locked').forEach((e) => assert.equal(e.player, null));
      if (s.winReason === 'บุกถูกห้องของฆาตกร') assert.equal(s.players[s.murdererId].alive, false);
    }
  }
});

test('both sides win a fair share of bot games (sanity, not balance)', () => {
  let inn = 0, kil = 0;
  for (let seed = 1; seed <= 300; seed++) { const s = play(7, seed); if (s.winner === 'บริสุทธิ์') inn++; else kil++; }
  assert.ok(inn > 15, `innocents won ${inn}/300`);
  assert.ok(kil > 15, `killers won ${kil}/300`);
});

test('bot views only show a killer their own partner', () => {
  const s = HM.newGame(7, 11);
  for (let id = 0; id < 7; id++) {
    const v = HM.viewFor(s, id);
    const killer = HM.ROLES[s.players[id].role].side === 'ฆาตกร';
    v.players.forEach((p) => {
      if (p.id === id) return;
      const mate = killer && HM.ROLES[s.players[p.id].role].side === 'ฆาตกร';
      if (!mate) assert.equal(p.role, null);
    });
  }
});

test('bot proposals: never a closed room; killers never target their own room or their partner', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = HM.newGame(7, seed);
    s.players.forEach((p) => {
      const v = HM.viewFor(s, p.id);
      const rnd = HM.mulberry32(seed * 31 + p.id);
      for (let i = 0; i < 20; i++) {
        const room = Bots.botProposal(v, rnd);
        assert.ok(!s.closed.has(room));
        if (HM.ROLES[p.role].side === 'ฆาตกร') {
          assert.notEqual(room, p.room);
          assert.notEqual(room, s.players[v.me.mateId].room);
        }
      }
    });
  }
});

test('bot support: killers never raise a hand against their own or their partner\'s room', () => {
  const s = HM.newGame(7, 5);
  const m = s.players[s.murdererId], a = s.players[s.accompliceId];
  const rnd = HM.mulberry32(1);
  for (let i = 0; i < 50; i++) {
    assert.equal(Bots.botSupport(HM.viewFor(s, m.id), m.room, rnd, false), false);
    assert.equal(Bots.botSupport(HM.viewFor(s, m.id), a.room, rnd, false), false);
  }
});

test('witness deduction: a trusted "higher" result steers innocents to higher floors', () => {
  const s = HM.newGame(7, 9);
  const w = s.players.find((p) => p.role === 'witness');
  s.day = 2;
  s.events.push({ day: 1, type: 'empty', room: '302', player: null });
  s.notes[w.id].push({ day: 1, kind: 'watch', floor: 3, cmp: 'higher' });
  const a = Bots.analyse(HM.viewFor(s, w.id));
  assert.ok(a.fw[5] > a.fw[2] * 100);
});

test('accomplice is never offered or makes a claim naming the accomplice role', () => {
  const s = HM.newGame(7, 5);
  const acc = s.accompliceId;
  s.notes[acc].push({ day: 1, kind: 'peek', target: (acc + 1) % 7, floor: 2 });
  s.day = 2;
  const v = HM.viewFor(s, acc);
  const real = Bots.realClaims(v);
  assert.equal(real.length, 1);
  assert.equal(real[0].as, 'detective');
  for (let i = 0; i < 200; i++) {
    Bots.botClaims(v, HM.mulberry32(i)).forEach((c) => assert.notEqual(c.as, 'accomplice'));
  }
});
