/* Hotel Murder - online host: runs ONE game for several human seats (the rest are bots) and talks to the seats through
 * send(seat, msg). No DOM and no network here, so it can be tested in Node with a fake transport.
 * The host browser is the single authority: it holds the engine state; every seat only ever receives HM.viewFor(state, seat)
 * plus the options of its own turn. Voice is handled by the page (online.js); this file only says who may talk (msg.mic).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./bots.js'), require('./controller.js'));
  else root.HMOnlineHost = factory(root.HM, root.HMBots, root.HMCtl);
})(typeof self !== 'undefined' ? self : this, function (HM, Bots, Ctl) {
  'use strict';

  const DAY_MS = 240000, VOTE_MS = 60000, ACK_MS = 45000, NIGHT_MS = 60000, ROLE_MS = 120000;

  // opts: { n, seed, names: [n], humans: [seat ids], send(seat, msg), now?() , dayMs? }
  function createHost(opts) {
    const now = opts.now || Date.now;
    const send = opts.send;
    const S = HM.newGame(opts.n, opts.seed, opts.names);
    const rnd = HM.mulberry32((opts.seed == null ? 12345 : opts.seed) ^ 0x9e3779b1);
    const humans = new Set(opts.humans);
    const dayMs = opts.dayMs || DAY_MS;
    let stage = 'role';                 // role | night | dawn | day | vote | raid | over
    let acks = new Set(), readyVote = new Set(), hands = {}, ballot = [];
    let proposals = {}, resultSeat = null, lastNight = null, deadline = null;
    const isBot = (id) => !humans.has(id);
    const aliveHumans = () => HM.aliveList(S).filter((p) => humans.has(p.id)).map((p) => p.id);

    // ------------------------------------------------------------ what each seat is told
    function mic(seat) {
      if (stage === 'over' || S.phase === 'over') return true;
      if (stage === 'night') return false;
      return S.players[seat].alive;
    }
    function humanClaims(seat) {
      return Bots.realClaims(HM.viewFor(S, seat)).filter((c) => HM.CLAIM_ROLES.includes(c.as) || c.kind === 'peek');
    }
    function payload(seat) {
      const v = HM.viewFor(S, seat);
      const m = { t: 'screen', stage, v, mic: mic(seat), humans: [...humans], now: now(), deadline, acked: [...acks] };
      if (stage === 'night') {
        const a = HM.currentActor(S);
        if (resultSeat === seat) { m.scr = 'result'; }
        else if (a && a.playerId === seat && resultSeat == null) { m.scr = 'action'; m.options = HM.nightOptions(S, seat); }
        else m.scr = 'sleep';
      } else m.scr = stage;
      if (stage === 'dawn') m.dawn = lastNight;
      if (stage === 'day') {
        const mine = S.claims.filter((c) => c.day === S.day && c.by === seat).map((c) => JSON.stringify(c));
        m.chat = S.claims.filter((c) => c.day === S.day).map((c) => ({ by: c.by, text: Ctl.describeClaim(S, c) }));
        m.proposals = Object.keys(proposals).filter((id) => S.players[id].alive).map((id) => ({ by: +id, room: proposals[id] }));
        m.myProposal = proposals[seat] || null;
        m.readyVote = [...readyVote];
        if (v.me.alive) {
          m.claimOptions = humanClaims(seat).map((c, i) => ({ i, text: Ctl.describeClaim(S, c), said: mine.includes(JSON.stringify(Object.assign({ day: S.day, by: seat }, c))) }));
          m.canBluff = S.day > 1;
          m.rooms = HM.openRooms(S).filter((k) => k !== v.me.room);
        }
      }
      if (stage === 'vote') {
        m.ballot = ballot;
        m.need = Math.floor(HM.aliveList(S).length / 2) + 1;
        m.submitted = Object.keys(hands).map(Number);
      }
      if (stage === 'raid') m.raid = S.lastRaid && Object.assign({}, S.lastRaid, { hands: lastHands });
      return m;
    }
    let lastHands = {};
    function push() { humans.forEach((seat) => send(seat, payload(seat))); }

    // ------------------------------------------------------------ night
    function advanceNight() {
      stage = 'night';
      if (S.phase === 'night' && (!S.night || S.night.forDay !== S.day)) HM.startNight(S);
      for (let guard = 0; guard < 100; guard++) {
        const a = HM.currentActor(S);
        if (!a) {
          lastNight = HM.resolveNight(S);
          stage = 'dawn'; acks = new Set(); deadline = now() + ACK_MS;
          return push();
        }
        if (humans.has(a.playerId)) { deadline = now() + NIGHT_MS; return push(); }
        HM.act(S, a.playerId, Bots.botNight(HM.viewFor(S, a.playerId), HM.nightOptions(S, a.playerId), rnd));
      }
      throw new Error('night did not finish');
    }

    // ------------------------------------------------------------ day
    function beginDay() {
      if (S.phase === 'dawn') HM.startDay(S);
      const speakers = HM.shuffle(HM.aliveList(S).filter((p) => isBot(p.id)).map((p) => p.id), rnd);
      speakers.forEach((id) => Bots.botClaims(HM.viewFor(S, id), rnd).forEach((c) => HM.addClaim(S, id, c)));
      proposals = {};
      speakers.forEach((id) => { if (rnd() < 0.85) proposals[id] = Bots.botProposal(HM.viewFor(S, id), rnd); });
      readyVote = new Set(); hands = {}; ballot = [];
      stage = 'day'; deadline = now() + dayMs;
      push();
    }
    function startVote() {
      const map = {};
      Object.keys(proposals).forEach((id) => { if (S.players[id].alive) (map[proposals[id]] = map[proposals[id]] || []).push(+id); });
      ballot = Object.keys(map).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((room) => ({ room, by: map[room] }));
      hands = {}; stage = 'vote'; deadline = now() + VOTE_MS;
      if (!ballot.length || !aliveHumans().length) return resolveVote();
      push();
    }
    function resolveVote() {
      const yes = {};
      ballot.forEach(({ room, by }) => {
        yes[room] = [];
        HM.aliveList(S).forEach((p) => {
          if (humans.has(p.id)) { if ((hands[p.id] || []).includes(room)) yes[room].push(p.id); return; }
          if (Bots.botSupport(HM.viewFor(S, p.id), room, rnd, by.includes(p.id))) yes[room].push(p.id);
        });
      });
      HM.resolveRaid(S, ballot.map((b) => b.room), yes);
      lastHands = yes;
      stage = 'raid'; acks = new Set(); deadline = now() + ACK_MS;
      push();
    }

    // ------------------------------------------------------------ flow control: called after every input and every tick
    const allIn = (set, who) => who.every((id) => set.has(id));
    function progress() {
      const late = deadline != null && now() >= deadline;
      if (stage === 'role') { if (allIn(acks, [...humans]) || late) beginDay(); }
      else if (stage === 'night') {
        if (!late) return;
        if (resultSeat != null) { resultSeat = null; advanceNight(); return; }
        const a = HM.currentActor(S);        // too slow: a bot brain plays this turn so the night goes on
        if (a) HM.act(S, a.playerId, Bots.botNight(HM.viewFor(S, a.playerId), HM.nightOptions(S, a.playerId), rnd));
        advanceNight();
      }
      else if (stage === 'day') { if (!aliveHumans().length || allIn(readyVote, aliveHumans()) || late) startVote(); }
      else if (stage === 'vote') { if (allIn(new Set(Object.keys(hands).map(Number)), aliveHumans()) || late) resolveVote(); }
      else if (stage === 'dawn') {
        if (allIn(acks, aliveHumans()) || late || (S.phase === 'over' && allIn(acks, [...humans]))) { if (S.phase === 'over') { stage = 'over'; push(); } else beginDay(); }
      } else if (stage === 'raid') {
        if (allIn(acks, aliveHumans()) || late) { if (S.phase === 'over') { stage = 'over'; push(); } else advanceNight(); }
      }
    }

    // ------------------------------------------------------------ input from a seat
    function receive(seat, msg) {
      if (!humans.has(seat) || !msg) return;
      const fail = (e) => send(seat, { t: 'error', msg: e.message });
      switch (msg.t) {
        case 'ack':
          if (['role', 'dawn', 'raid'].includes(stage)) { acks.add(seat); progress(); push(); }
          break;
        case 'night': {
          const a = HM.currentActor(S);
          if (stage !== 'night' || resultSeat != null || !a || a.playerId !== seat) return fail(new Error('ยังไม่ถึงตาของคุณ'));
          let res;
          try { res = HM.act(S, seat, msg.action || {}); } catch (e) { return fail(e); }
          if (res.result) { resultSeat = seat; deadline = now() + ACK_MS; push(); } else advanceNight();
          break;
        }
        case 'resultAck':
          if (resultSeat === seat) { resultSeat = null; advanceNight(); }
          break;
        case 'say': {
          if (stage !== 'day' || !S.players[seat].alive) return;
          const c = humanClaims(seat)[msg.i];
          if (!c || S.claims.some((x) => x.day === S.day && x.by === seat && JSON.stringify(x) === JSON.stringify(Object.assign({ day: S.day, by: seat }, c)))) return;
          HM.addClaim(S, seat, c); push();
          break;
        }
        case 'bluff':
          if (stage === 'day' && S.players[seat].alive && S.day > 1 && HM.CLAIM_ROLES.includes(msg.as)) {
            HM.addClaim(S, seat, Bots.fakeClaim(HM.viewFor(S, seat), rnd, msg.as)); push();
          }
          break;
        case 'propose':
          if (stage !== 'day' || !S.players[seat].alive) return;
          if (msg.room == null) delete proposals[seat];
          else if (HM.openRooms(S).includes(msg.room) && msg.room !== S.players[seat].room) proposals[seat] = msg.room;
          else return fail(new Error('เสนอห้องนี้ไม่ได้'));
          push();
          break;
        case 'voteReady':
          if (stage === 'day' && S.players[seat].alive) { readyVote.add(seat); progress(); if (stage === 'day') push(); }
          break;
        case 'hands':
          if (stage === 'vote' && S.players[seat].alive && !hands[seat]) {
            hands[seat] = (Array.isArray(msg.yes) ? msg.yes : []).filter((r) => ballot.some((b) => b.room === r));
            progress(); if (stage === 'vote') push();
          }
          break;
        default:
      }
    }

    // a human who left the table becomes a bot; the game never waits for them again
    function dropSeat(seat) {
      if (!humans.delete(seat)) return;
      if (resultSeat === seat) resultSeat = null;
      acks.delete(seat); readyVote.delete(seat); delete hands[seat];
      if (stage === 'night') advanceNight();
      else { progress(); if (!['night'].includes(stage)) push(); }
    }

    return {
      S, receive, dropSeat, tick: progress, start() { deadline = now() + ROLE_MS; push(); },
      get stage() { return stage; }, get humans() { return [...humans]; },
    };
  }

  return { createHost, DAY_MS, VOTE_MS, ACK_MS };
});
