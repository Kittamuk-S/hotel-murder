/* Hotel Murder - game controller: runs the bots, stops whenever the human has to decide.
 * With humanId = null every seat is a bot (used by the simulation tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./bots.js'));
  else root.HMCtl = factory(root.HM, root.HMBots);
})(typeof self !== 'undefined' ? self : this, function (HM, Bots) {
  'use strict';

  const CMP = { higher: 'สูงกว่า', lower: 'ต่ำกว่า', equal: 'ชั้นเดียวกัน', none: 'ไม่ได้ข้อมูล' };

  function describeClaim(s, c) {
    const nm = (id) => s.players[id].name;
    const role = HM.ROLES[c.as] ? HM.ROLES[c.as].name : '';
    switch (c.kind) {
      case 'lock': return `ฉันเป็น${role} คืนก่อนล็อกห้อง ${c.room}`;
      case 'peek': return `ฉันเป็น${role} สืบ ${nm(c.target)} ได้ผลว่าอยู่ชั้น ${c.floor}`;
      case 'floorCount': return `ฉันเป็น${role} ชั้น ${c.floor} มีคนอยู่ ${c.count} คน`;
      case 'colCount': return `ฉันเป็น${role} แถว ${c.col} มีคนอยู่ ${c.count} คน`;
      case 'watch': return `ฉันเป็น${role} เฝ้าชั้น ${c.floor} ห้องฆาตกร${c.cmp === 'none' ? ' — ไม่ได้ข้อมูล' : ' ' + CMP[c.cmp] + 'ชั้นนี้'}`;
      default: return '';
    }
  }

  function create(s, humanId, seed) {
    const rnd = HM.mulberry32((seed == null ? 12345 : seed) ^ 0x9e3779b1);
    const ctl = { s, humanId, rnd, proposals: {} };
    const isBot = (id) => id !== humanId;
    const humanAlive = () => humanId != null && s.players[humanId].alive;

    // ---------------------------------------------------------------- night
    function botNightTurn(a) {
      const opts = HM.nightOptions(s, a.playerId);
      const d = Bots.botNight(HM.viewFor(s, a.playerId), opts, rnd);
      HM.act(s, a.playerId, d);
    }
    // run the night until it ends or the human must act
    ctl.runNight = function () {
      if (s.phase === 'night' && (!s.night || s.night.forDay !== s.day)) HM.startNight(s);
      for (let guard = 0; guard < 100; guard++) {
        const a = HM.currentActor(s);
        if (!a) { const dawn = HM.resolveNight(s); return { done: true, dawn }; }
        if (!isBot(a.playerId)) return { need: 'night', playerId: a.playerId, options: HM.nightOptions(s, a.playerId) };
        botNightTurn(a);
      }
      throw new Error('night did not finish');
    };
    ctl.humanNight = function (action) {
      const a = HM.currentActor(s);
      if (!a || a.playerId !== humanId) throw new Error('ไม่ใช่ตาของคุณ');
      return HM.act(s, humanId, action);
    };

    // ---------------------------------------------------------------- day
    // morning (or the very first day): bots speak and decide which room to propose
    ctl.beginDay = function () {
      if (s.phase === 'dawn') HM.startDay(s);
      if (s.phase !== 'day') throw new Error('ไม่ใช่เวลากลางวัน');
      const speakers = HM.shuffle(HM.aliveList(s).filter((p) => isBot(p.id)).map((p) => p.id), rnd);
      speakers.forEach((id) => Bots.botClaims(HM.viewFor(s, id), rnd).forEach((c) => HM.addClaim(s, id, c)));
      ctl.proposals = {};
      speakers.forEach((id) => { if (rnd() < 0.85) ctl.proposals[id] = Bots.botProposal(HM.viewFor(s, id), rnd); });
    };

    // claims the human may make: true results, or a plausible bluff of a chosen role
    ctl.humanClaims = function () {
      return Bots.realClaims(HM.viewFor(s, humanId)).filter((c) => HM.CLAIM_ROLES.includes(c.as) || c.kind === 'peek')
        .map((c) => ({ claim: c, text: describeClaim(s, c) }));
    };
    ctl.humanBluff = function (as) { return Bots.fakeClaim(HM.viewFor(s, humanId), rnd, as); };
    ctl.say = function (claim) { HM.addClaim(s, humanId, claim); };

    // rooms on the table for the vote: [{ room, by: [names] }] from the lowest room number up (the host's order)
    ctl.ballot = function (humanRoom) {
      const map = {};
      Object.keys(ctl.proposals).forEach((id) => { (map[ctl.proposals[id]] = map[ctl.proposals[id]] || []).push(+id); });
      if (humanRoom && humanAlive()) (map[humanRoom] = map[humanRoom] || []).push(humanId);
      return Object.keys(map).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((room) => ({ room, by: map[room] }));
    };

    // the show of hands. humanYes = rooms the human raises a hand for. Returns the engine's raid result.
    ctl.raid = function (humanRoom, humanYes) {
      const ballot = ctl.ballot(humanRoom);
      const yes = {};
      ballot.forEach(({ room, by }) => {
        yes[room] = [];
        HM.aliveList(s).forEach((p) => {
          if (p.id === humanId) { if ((humanYes || []).includes(room)) yes[room].push(p.id); return; }
          if (Bots.botSupport(HM.viewFor(s, p.id), room, rnd, by.includes(p.id))) yes[room].push(p.id);
        });
      });
      const res = HM.resolveRaid(s, ballot.map((b) => b.room), yes);
      res.hands = yes;
      return res;
    };

    // fully automatic game (humanId null)
    ctl.autoplay = function () {
      for (let guard = 0; guard < 40 && s.phase !== 'over'; guard++) {
        if (s.phase === 'night') { ctl.runNight(); if (s.phase === 'over') break; }
        if (s.phase === 'dawn' || s.phase === 'day') { ctl.beginDay(); ctl.raid(null, []); }
      }
      return s;
    };
    return ctl;
  }

  return { create, describeClaim, CMP };
});
