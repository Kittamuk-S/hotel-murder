/* Hotel Murder - online mode: friends join one room by code and talk by voice (WebRTC through PeerJS).
 * The host's browser runs the game (online-host.js); every player only receives their own redacted view.
 * Voice: mic -> gain node (the game closes it at night and for the dead) -> one call to every other player.
 */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const vbar = document.getElementById('voice');
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

  // ---------------------------------------------------------------- tiny DOM helpers (text only: names are user input)
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
  // re-rendering must not close the <details> a player opened, nor jump to the top on every update
  const detailsOpen = {};
  app.addEventListener('toggle', (e) => { if (e.target.tagName === 'DETAILS') detailsOpen[e.target.firstChild.textContent] = e.target.open; }, true);
  const FX = window.FX || { phase() {}, enter() {}, flipCard() { return null; }, dawnSequence() { return Promise.resolve(); }, react() {}, stars() {}, reduced() { return false; } };
  const PHASE_OF = { sleep: 'night', action: 'night', result: 'night', dawn: 'dawn', day: 'day', vote: 'day', raid: 'day', over: 'over' };
  let timer = null, lastKey = '';
  function show(key, ...nodes) {
    if (timer) { clearInterval(timer); timer = null; }
    app.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
    app.querySelectorAll('details').forEach((d) => { const k = d.firstChild.textContent; if (k in detailsOpen) d.open = detailsOpen[k]; });
    const fresh = key !== lastKey;
    FX.phase(PHASE_OF[key.split('|')[0]] || null);
    FX.enter(app, fresh);
    if (fresh) { window.scrollTo(0, 0); lastKey = key; }
  }

  // ---------------------------------------------------------------- state
  const st = { peer: null, mode: null, code: null, name: 'ผู้เล่น', conns: {}, hostConn: null, lobby: [], seat: null, players: [], game: null, last: null, skew: 0, toast: null, started: false, tokens: {}, hostGone: false, wake: null };
  const ui = { key: '', picked: null, yes: new Set(), sent: false, roleOpen: false, bluff: 'locksmith', toastText: null, toastAt: 0, dawnPlayed: {}, dawnRunning: null, pendingDawn: null };
  const myId = () => (st.last ? st.last.v.me.id : st.seat);

  // ---------------------------------------------------------------- voice
  const voice = (function () {
    let ctx = null, dest = null, gain = null, micOn = false, allowed = true, userMuted = false, micError = null;
    const calls = {}, analysers = {}, audios = {}, speaking = new Set();
    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC(); dest = ctx.createMediaStreamDestination(); gain = ctx.createGain(); gain.gain.value = 0; gain.connect(dest);
        analyse('me', gain);
      }
      if (ctx.state === 'suspended') ctx.resume();
    }
    function analyse(id, node) {
      const an = ctx.createAnalyser(); an.fftSize = 512; node.connect(an); analysers[id] = { an, buf: new Float32Array(an.fftSize) };
    }
    function apply() { if (gain) gain.gain.value = micOn && allowed && !userMuted ? 1 : 0; renderBar(); }
    async function enableMic() {
      ensure();
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        ctx.createMediaStreamSource(s).connect(gain); micOn = true; micError = null;
      } catch (e) { micError = e && e.name === 'NotAllowedError' ? 'denied' : 'unavailable'; }
      apply();
    }
    function hook(c, id) {
      if (calls[id]) { try { calls[id].close(); } catch (e) { /* already closed */ } }
      calls[id] = c;
      c.on('stream', (s) => attach(id, s));
      c.on('close', () => detach(id));
      c.on('error', () => detach(id));
    }
    function attach(id, stream) {
      ensure();
      let a = audios[id];
      if (!a) { a = new Audio(); a.autoplay = true; audios[id] = a; }
      a.srcObject = stream;
      const p = a.play(); if (p && p.catch) p.catch(() => {});
      if (analysers[id]) return;
      analyse(id, ctx.createMediaStreamSource(stream));
    }
    function detach(id) {
      delete calls[id]; speaking.delete(id); delete analysers[id];
      if (audios[id]) { audios[id].srcObject = null; delete audios[id]; }
      renderBar();
    }
    function callAll(peer, ids) { ensure(); ids.forEach((id) => { if (id !== peer.id && !calls[id]) hook(peer.call(id, dest.stream), id); }); }
    function answer(c) { ensure(); c.answer(dest.stream); hook(c, c.peer); }
    function poll() {
      const now = new Set();
      Object.keys(analysers).forEach((id) => {
        const { an, buf } = analysers[id]; an.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        if (Math.sqrt(sum / buf.length) > 0.015) now.add(id);
      });
      const changed = now.size !== speaking.size || [...now].some((i) => !speaking.has(i));
      speaking.clear(); now.forEach((i) => speaking.add(i));
      if (changed) renderBar();
    }
    setInterval(() => { if (ctx) poll(); }, 150);
    return {
      enableMic, callAll, answer, ensure,
      setAllowed(v) { if (allowed !== v) { allowed = v; apply(); } },
      toggleMute() { userMuted = !userMuted; apply(); },
      closeAll() { Object.keys(calls).forEach((id) => { try { calls[id].close(); } catch (e) { /* ignore */ } detach(id); }); },
      get state() { return { micOn, allowed, userMuted, micError, speaking }; },
    };
  })();

  function renderBar() {
    if (!st.peer) { vbar.replaceChildren(); return; }
    const vs = voice.state;
    const people = st.started ? st.players : st.lobby.map((p, i) => ({ peerId: p.peerId, seat: i, name: p.name }));
    const dead = new Set(st.last ? st.last.v.players.filter((p) => !p.alive).map((p) => p.id) : []);
    const night = !!st.last && st.last.stage === 'night';
    const chips = people.map((p) => {
      const isMe = p.peerId === st.peer.id;
      const sp = isMe ? (vs.speaking.has('me')) : vs.speaking.has(p.peerId);
      const out = st.started && dead.has(p.seat) && !(st.last && st.last.stage === 'over');
      return h('span', { class: 'chip' + (sp ? ' speaking' : '') + (out ? ' out' : '') + (st.started && !sp && (night || out) ? ' gamemuted' : '') }, isMe ? `${p.name} (คุณ)` : p.name);
    });
    const btn = !vs.micOn
      ? h('button', { class: 'vbtn', type: 'button', onclick: () => voice.enableMic() }, '🎤 เปิดไมค์')
      : h('button', { class: 'vbtn' + (vs.userMuted ? '' : ' on'), type: 'button', onclick: () => voice.toggleMute() }, vs.userMuted ? '🔇 ปิดเสียงตัวเอง' : '🎤 ไมค์เปิด');
    const states = [];
    if (vs.micError === 'denied') states.push(['err', 'เบราว์เซอร์ไม่อนุญาตให้ใช้ไมค์ ฟังคนอื่นได้ แต่พูดไม่ได้ กดไอคอนแม่กุญแจบนแถบที่อยู่เพื่อเปิดสิทธิ์']);
    else if (vs.micError) states.push(['err', 'ไม่พบไมค์ในเครื่องนี้ ฟังคนอื่นได้อย่างเดียว']);
    else if (!vs.allowed) states.push(['warn', night ? '🌙 กลางคืน เกมปิดไมค์ทุกคนอัตโนมัติ' : '🕯️ คุณออกจากเกมแล้ว ไมค์ถูกปิด']);
    else if (!vs.micOn) states.push(['', 'กดเปิดไมค์เพื่อคุยกับเพื่อน (ต้องใช้ลิงก์ https หรือ localhost)']);
    if (st.mode === 'host' && st.started && !(st.last && st.last.stage === 'over')) states.push(['warn', 'โฮสต์: อย่าล็อกหน้าจอหรือสลับแอป เกมของทุกคนจะหยุดทันที']);
    vbar.replaceChildren(h('div', { class: 'vrow' }, chips, btn), ...states.map(([k, t]) => h('div', { class: 'vstate' + (k ? ' ' + k : ''), role: k === 'err' ? 'alert' : null }, t)));
  }

  // ---------------------------------------------------------------- network
  const send = (msg) => { if (st.mode === 'host') st.game.receive(0, msg); else if (st.hostConn && st.hostConn.open) st.hostConn.send(msg); };
  const sendSeat = (seat, msg) => {
    if (seat === 0) {
      if (msg.t === 'error') { ui.sent = false; st.toast = msg.msg; if (st.last) onScreen(st.last, true); }
      else if (msg.t === 'react') showReact(msg);
      else if (msg.t === 'screen') onScreen(msg);
    } else if (st.conns[seat] && st.conns[seat].open) st.conns[seat].send(msg);
  };
  function showReact(m) {
    const n = st.last ? st.last.v.n : 9;
    FX.react(m.e, ((m.by + 0.5) / n) * 80 + 10);
  }
  const rejoinStore = {
    get() { try { const j = JSON.parse(sessionStorage.getItem('hm-rejoin') || 'null'); return j && j.code && j.token ? j : null; } catch (e) { return null; } },
    set(v) { try { sessionStorage.setItem('hm-rejoin', JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
    clear() { try { sessionStorage.removeItem('hm-rejoin'); } catch (e) { /* ignore */ } },
  };
  function randToken() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  // the host keeps the screen awake: a locked phone freezes the whole game
  function keepAwake(on) {
    if (!on) { if (st.wake) { try { st.wake.release(); } catch (e) { /* ignore */ } st.wake = null; } return; }
    if (!(navigator.wakeLock && navigator.wakeLock.request)) return;
    navigator.wakeLock.request('screen').then((l) => { st.wake = l; l.addEventListener('release', () => { if (st.wake === l) st.wake = null; }); }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.mode === 'host' && st.started && !st.wake) keepAwake(true); });
  const peerIds = () => st.lobby.map((p) => p.peerId);

  function newCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = '';
    for (let i = 0; i < 5; i++) c += a[Math.floor(Math.random() * a.length)];
    return c;
  }
  function fail(text) {
    st.toast = text;
    const p = st.peer; st.peer = null; st.started = false;       // clear first: destroy() fires close handlers that would call fail() again
    if (p) { try { p.destroy(); } catch (e) { /* ignore */ } }
    voice.closeAll(); home();
  }

  function makePeer(id) {
    if (typeof Peer === 'undefined') { st.toast = 'โหลดตัวเชื่อมต่อ (PeerJS) ไม่ได้ ตรวจอินเทอร์เน็ตแล้วรีเฟรช'; return null; }
    const p = id ? new Peer(id) : new Peer();
    // only answer people who are in this room (a stranger who knows the peer id must not be able to listen in)
    const accept = (c, tries) => {
      const known = st.players.some((x) => x.peerId === c.peer) || st.lobby.some((x) => x.peerId === c.peer);
      if (known) voice.answer(c);
      else if (tries < 6) setTimeout(() => accept(c, tries + 1), 1000);      // our list may lag behind the caller's
      else { try { c.close(); } catch (e) { /* ignore */ } }
    };
    p.on('call', (c) => accept(c, 0));
    return p;
  }

  function hostRoom(name, tries) {
    voice.ensure();
    const code = newCode();
    const peer = makePeer('hotelmurder-' + code);
    if (!peer) return home();
    st.peer = peer; st.mode = 'host'; st.code = code; st.name = name; st.lobby = []; st.conns = {}; st.started = false; st.tokens = {}; st.hostGone = false; st.players = [];
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && (tries || 0) < 5) { try { peer.destroy(); } catch (x) { /* ignore */ } st.peer = null; return hostRoom(name, (tries || 0) + 1); }
      if (st.started) { st.toast = 'สัญญาณเซิร์ฟเวอร์ห้องมีปัญหา (' + e.type + ') เกมยังเล่นต่อได้'; return; }
      fail('เชื่อมต่อเซิร์ฟเวอร์ห้องไม่ได้ (' + e.type + ') ลองใหม่อีกครั้ง');
    });
    peer.on('open', (id) => { st.lobby = [{ peerId: id, name }]; renderBar(); lobbyScreen(); });
    peer.on('connection', (conn) => {
      conn.on('data', (m) => hostData(conn, m));
      conn.on('close', () => hostLeft(conn));
    });
  }
  function seatOf(conn) { return st.lobby.findIndex((p) => p.peerId === conn.peer); }
  function hostData(conn, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'rejoin') {
      const seat = st.started ? Object.keys(st.tokens).find((k) => st.tokens[k] === m.token) : undefined;
      if (seat === undefined) return conn.send({ t: 'refuse', msg: st.started ? 'ใช้โค้ดกลับเข้าห้องนี้ไม่ได้' : 'ห้องนี้ยังไม่ได้เริ่มเกม ให้เข้าร่วมใหม่' });
      const s = +seat;
      if (st.conns[s] && st.conns[s] !== conn) { const old = st.conns[s]; st.conns[s] = null; try { old.close(); } catch (e) { /* ignore */ } }
      st.lobby[s].peerId = conn.peer; st.players[s].peerId = conn.peer; st.conns[s] = conn;
      Object.keys(st.conns).forEach((k) => st.conns[k] && st.conns[k].open && st.conns[k].send({ t: 'players', players: st.players }));
      conn.send({ t: 'start', seat: s, players: st.players, n: st.game.S.n, token: st.tokens[s], rejoin: true });
      if (!st.game.rejoinSeat(s)) st.game.sync(s);
      renderBar();
    } else if (m.t === 'join') {
      if (st.started) return conn.send({ t: 'refuse', msg: 'เกมเริ่มไปแล้ว' });
      if (st.lobby.length >= 9) return conn.send({ t: 'refuse', msg: 'ห้องเต็มแล้ว (สูงสุด 9 คน)' });
      if (seatOf(conn) >= 0) return;
      st.lobby.push({ peerId: conn.peer, name: String(m.name || 'ผู้เล่น').slice(0, 14) });
      st.conns[st.lobby.length - 1] = conn;
      broadcastLobby(); renderBar(); lobbyScreen();
    } else if (st.started) {
      const seat = seatOf(conn);
      if (seat > 0) st.game.receive(seat, m);
    }
  }
  function hostLeft(conn) {
    const seat = seatOf(conn);
    if (seat < 1) return;
    if (st.started) { if (st.conns[seat] && st.conns[seat] !== conn) return; st.game.dropSeat(seat); delete st.conns[seat]; renderBar(); return; }
    st.lobby.splice(seat, 1);
    st.conns = {}; // seat numbers shift before the start: rebuild from the live connections
    st.lobby.forEach((p, i) => { const c = Object.values(st.peer.connections).flat().find((x) => x.peer === p.peerId && x.open); if (i > 0 && c) st.conns[i] = c; });
    broadcastLobby(); renderBar(); lobbyScreen();
  }
  function broadcastLobby() {
    const players = st.lobby.map((p) => ({ peerId: p.peerId, name: p.name }));
    Object.keys(st.conns).forEach((seat) => st.conns[seat].open && st.conns[seat].send({ t: 'lobby', players, you: +seat, code: st.code, peers: players.map((p) => p.peerId) }));
  }

  function joinRoom(name, code, token) {
    voice.ensure();
    const peer = makePeer(null);
    if (!peer) return home();
    st.peer = peer; st.mode = 'guest'; st.code = code; st.name = name; st.lobby = []; st.started = false; st.hostGone = false; st.players = [];
    peer.on('error', (e) => { if (token && e.type === 'peer-unavailable') rejoinStore.clear(); fail(e.type === 'peer-unavailable' ? 'ไม่พบห้องรหัส ' + code + ' ตรวจรหัสอีกครั้ง' : 'เชื่อมต่อไม่ได้ (' + e.type + ')'); });
    peer.on('open', () => {
      const conn = peer.connect('hotelmurder-' + code, { reliable: true });
      st.hostConn = conn;
      conn.on('open', () => conn.send(token ? { t: 'rejoin', token } : { t: 'join', name }));
      conn.on('data', guestData);
      conn.on('close', () => {
        if (!st.peer) return;
        if (st.last && st.last.stage === 'over') { st.hostGone = true; onScreen(st.last, true); return; }   // the game is finished: keep the result on screen
        fail('การเชื่อมต่อกับโฮสต์หลุด ถ้าโฮสต์ยังอยู่ กด “กลับเข้าห้อง” ได้');
      });
    });
  }
  function guestData(m) {
    if (!m) return;
    if (m.t === 'refuse') { rejoinStore.clear(); return fail(m.msg); }
    if (m.t === 'lobby') { st.lobby = m.players; st.seat = m.you; renderBar(); if (!st.started) lobbyScreen(); voice.callAll(st.peer, m.peers.slice(0, m.you)); }
    else if (m.t === 'start') {
      st.started = true; st.seat = m.seat; st.players = m.players;
      if (m.token) rejoinStore.set({ code: st.code, seat: m.seat, token: m.token });
      voice.callAll(st.peer, (m.rejoin ? m.players : m.players.slice(0, m.seat)).map((p) => p.peerId)); renderBar();
    }
    else if (m.t === 'players') { st.players = m.players; renderBar(); }
    else if (m.t === 'screen') onScreen(m);
    else if (m.t === 'react') showReact(m);
    else if (m.t === 'error') { ui.sent = false; st.toast = m.msg; if (st.last) onScreen(st.last, true); }
  }

  function startGame(n) {
    const humans = st.lobby.length;
    const seed = new URLSearchParams(location.search).get('seed');
    const sd = seed ? +seed : Date.now() % 1e9;
    const bots = HM.shuffle(BOT_NAMES, HM.mulberry32(sd)).slice(0, n - humans);
    const names = st.lobby.map((p) => p.name).concat(bots);
    st.players = st.lobby.map((p, i) => ({ peerId: p.peerId, seat: i, name: p.name }));
    st.seat = 0; st.started = true;
    st.game = HMOnlineHost.createHost({ n, seed: sd, names, humans: st.lobby.map((_, i) => i), send: sendSeat });
    st.tokens = {}; Object.keys(st.conns).forEach((seat) => { st.tokens[seat] = randToken(); });
    keepAwake(true);
    Object.keys(st.conns).forEach((seat) => st.conns[seat].open && st.conns[seat].send({ t: 'start', seat: +seat, players: st.players, n, token: st.tokens[seat] }));
    st.tick = setInterval(() => st.game.tick(), 1000);
    st.game.start();
  }

  // ---------------------------------------------------------------- shared pieces
  const nmOf = (v, id) => v.players[id].name;
  const KIND_CLS = { start: 'corpse dead', corpse: 'corpse dead', empty: 'empty', raid: 'raid' };
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
        const k = HM.roomKey(f, c), kind = closed[k];
        const cls = 'cell' + (kind ? ' ' + (KIND_CLS[kind] || 'corpse dead') : '') + (k === v.me.room ? ' mine' : '');
        row.append(h('div', { class: cls }, h('b', {}, k)));
      }
      wrap.append(row);
    }
    return wrap;
  }
  function noteText(v, n) {
    const name = (id) => v.players[id].name, night = `คืนที่ ${n.day}`;
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
    if (v.me.mateId != null) { const mate = v.players[v.me.mateId]; extra.push(h('li', {}, `${HM.ROLES[mate.role].name}: ${mate.name} (ห้อง ${mate.room})`)); }
    v.me.teamNotes.forEach((n) => items.push(h('li', {}, `ผู้ช่วยตรวจ: ${noteText(v, n)}`)));
    return h('details', {}, h('summary', {}, 'สมุดโน้ตของคุณ (ข้อมูลลับ)'), h('ul', { class: 'notes' }, extra, items));
  }
  function statusLine(v) {
    const alive = v.players.filter((p) => p.alive).length, open = v.floors * v.cols - v.closed.length;
    return h('p', { class: 'sub center' }, `วันที่ ${v.day}/${v.days} · ยังอยู่ ${alive}/${v.n} คน · ห้องเปิด ${open} ห้อง`);
  }
  function roleCard(v) {
    const role = v.me.role, bad = HM.ROLES[role].side === 'ฆาตกร';
    return h('div', { class: 'card' + (bad ? ' bad' : '') }, h('img', { src: `../art/${role}.png`, alt: '' }), h('div', { class: 'shade' }), h('div', { class: 'frame' }),
      h('div', { class: 'txt' }, h('h2', {}, HM.ROLES[role].name), h('div', { class: 'side' }, `ฝ่าย${HM.ROLES[role].side}`), h('div', { class: 'rule' }, ROLE_TEXT[role])));
  }
  const choice = (label, pressed, onPick, extra) => h('button', { class: 'opt', type: 'button', 'aria-pressed': pressed ? 'true' : 'false', onclick: onPick }, label, extra ? h('small', {}, extra) : null);
  const grid = (cols) => h('div', { class: 'grid', style: `grid-template-columns: repeat(${cols}, 1fr)` });
  // a toast survives re-renders of the same screen (pushes from other players) for a few seconds
  const toast = () => {
    if (st.toast) { ui.toastText = st.toast; ui.toastAt = Date.now(); st.toast = null; }
    return ui.toastText && Date.now() - ui.toastAt < 8000 ? h('div', { class: 'toast', role: 'alert' }, ui.toastText) : null;
  };
  const secs = (m) => Math.max(0, Math.round((m.deadline - (Date.now() + st.skew)) / 1000));
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  function countdown(m, label) {
    const clock = h('div', { class: 'timer', 'aria-label': label });
    const tick = () => { clock.textContent = fmt(secs(m)); };
    tick(); timer = setInterval(tick, 500);
    return clock;
  }
  function waitText(v, ids) {
    if (!ids.length) return '';
    return `รอ ${ids.slice(0, 3).map((id) => nmOf(v, id)).join(', ')}${ids.length > 3 ? ' ...' : ''} อีก ${ids.length} คน`;
  }
  function waitingFor(m) {
    const alive = new Set(m.v.players.filter((p) => p.alive).map((p) => p.id));
    return waitText(m.v, m.humans.filter((id) => alive.has(id) && !m.acked.includes(id)));
  }
  const REACTS = ['🤨', '😱', '🫵', '👍', '😂', '🔪'];
  const reactBar = () => h('div', { class: 'reactbar inbar', 'aria-label': 'ส่งอีโมจิ' }, REACTS.map((e) => h('button', { type: 'button', 'aria-label': 'ส่ง ' + e, onclick: () => send({ t: 'react', e }) }, e)));
  // the sticky bar at the bottom: the one main button, and the reason when it cannot be pressed
  const bar = (btn, why, react) => h('div', { class: 'actionbar' }, react ? reactBar() : null, btn, why ? h('span', { class: 'why' }, why) : null);

  // ---------------------------------------------------------------- screens
  function home() {
    ui.dawnPlayed = {}; ui.dawnRunning = null; ui.pendingDawn = null;
    if (st.tick) { clearInterval(st.tick); st.tick = null; }
    keepAwake(false); ui.toastText = null;
    st.last = null; st.game = null; st.started = false; renderBar();
    const nameIn = h('input', { type: 'text', id: 'name', value: st.name, maxLength: 14, autocomplete: 'off' });
    const codeIn = h('input', { type: 'text', id: 'code', maxLength: 5, autocomplete: 'off', placeholder: 'รหัสห้อง 5 ตัว', style: 'text-transform:uppercase' });
    const nm = () => nameIn.value.trim() || 'ผู้เล่น';
    const rj = rejoinStore.get();
    show('home', h('h1', {}, 'HOTEL MURDER'), h('p', { class: 'center sub' }, 'ปริศนาโรงแรมมรณะ · เล่นกับเพื่อนพร้อมไมค์'), h('div', { class: 'deco' }),
      toast(),
      rj ? h('div', { class: 'panel' }, h('p', {}, `เกมเดิมในห้อง ${rj.code} (ที่นั่ง ${rj.seat + 1}) ยังเล่นอยู่หรือเปล่า`),
        h('button', { class: 'btn go', type: 'button', onclick: () => joinRoom(nm(), rj.code, rj.token) }, 'กลับเข้าห้อง'),
        h('button', { class: 'btn', type: 'button', onclick: () => { rejoinStore.clear(); home(); } }, 'ลืมห้องนี้')) : null,
      h('div', { class: 'panel' },
        h('p', {}, 'เกมนี้ต้องคุยกันถึงจะสนุก เพื่อนทุกคนเข้าห้องเดียวกัน คุยกันได้ด้วยเสียงตอนกลางวัน กลางคืนเกมปิดไมค์ทุกคนให้อัตโนมัติ ที่นั่งที่ไม่มีคนจะเป็นบอต'),
        h('label', { for: 'name' }, 'ชื่อของคุณ'), nameIn,
        h('button', { class: 'btn go', type: 'button', onclick: () => hostRoom(nm()) }, 'สร้างห้องใหม่'),
        h('label', { for: 'code' }, 'หรือเข้าห้องของเพื่อน'), codeIn,
        h('button', { class: 'btn', type: 'button', onclick: () => { const c = codeIn.value.trim().toUpperCase(); if (c.length !== 5) { st.toast = 'ใส่รหัสห้อง 5 ตัวอักษร'; st.name = nm(); return home(); } joinRoom(nm(), c); } }, 'เข้าร่วมห้อง')),
      h('details', {}, h('summary', {}, 'ก่อนเล่นต้องรู้'), h('ul', { class: 'notes' },
        h('li', {}, 'ไมค์ใช้ได้เฉพาะเมื่อเปิดหน้านี้ผ่าน https หรือ localhost'),
        h('li', {}, 'เสียงและข้อมูลส่งตรงระหว่างเบราว์เซอร์ของผู้เล่น (WebRTC) โดยใช้เซิร์ฟเวอร์กลางของ PeerJS ช่วยเชื่อมต่อ ไม่มีการอัดเสียง'),
        h('li', {}, 'ใช้หูฟังเพื่อกันเสียงสะท้อน เบราว์เซอร์จะถามขออนุญาตใช้ไมค์'),
        h('li', {}, 'โฮสต์ (คนสร้างห้อง) คือเครื่องที่รันเกม ถ้าโฮสต์ปิดหน้า เกมจบ และต้องไม่ล็อกหน้าจอหรือสลับแอปตลอดเกม'))));
  }

  function lobbyScreen() {
    const isHost = st.mode === 'host';
    const list = h('ul', { class: 'notes' }, st.lobby.map((p, i) => h('li', {}, p.name, i === 0 ? ' (โฮสต์)' : '', p.peerId === (st.peer && st.peer.id) ? ' — คุณ' : '')));
    const nSel = h('select', { id: 'count', onchange: () => { ui.tableSize = +nSel.value; } }, [6, 7, 8, 9].filter((n) => n >= st.lobby.length).map((n) => h('option', { value: n, selected: n === (ui.tableSize && ui.tableSize >= st.lobby.length ? ui.tableSize : Math.max(7, st.lobby.length)) }, `${n} คน (คนจริง ${st.lobby.length} + บอต ${n - st.lobby.length})`)));
    show('lobby', h('h2', { class: 'center' }, 'ห้องรอ'), h('p', { class: 'center sub' }, 'บอกรหัสนี้ให้เพื่อน'), h('div', { class: 'code' }, st.code),
      h('div', { class: 'panel' }, h('b', {}, `ผู้เล่นในห้อง ${st.lobby.length}/9`), list),
      isHost ? [h('label', { for: 'count' }, 'จำนวนผู้เล่นทั้งหมด'), nSel,
        h('button', { class: 'btn go', type: 'button', onclick: () => startGame(+nSel.value) }, 'เริ่มเกม')]
        : h('p', { class: 'center sub' }, 'รอโฮสต์เริ่มเกม...'),
      h('p', { class: 'sub center' }, 'กด “เปิดไมค์” ด้านบน แล้วลองคุยกันระหว่างรอได้เลย'),
      h('button', { class: 'btn', type: 'button', onclick: () => { rejoinStore.clear(); fail('ออกจากห้องแล้ว'); } }, 'ออกจากห้อง'));
  }

  function onScreen(m, keepUi) {
    st.last = m; st.skew = m.now - Date.now();
    const key = `${m.scr}|${m.v.day}|${m.v.events.length}|${m.v.me.notes.length}`;
    if (!keepUi && key !== ui.key) { ui.key = key; ui.picked = null; ui.yes = new Set(); ui.sent = false; ui.roleOpen = false; ui.toastText = null; }
    voice.setAllowed(m.mic); renderBar();
    ({ role: roleScreen, sleep: sleepScreen, action: actionScreen, result: resultScreen, dawn: dawnScreen, day: dayScreen, vote: voteScreen, raid: raidScreen, over: overScreen }[m.scr] || (() => {}))(m);
  }

  function ackButton(m, label) {
    const done = m.acked.includes(m.v.me.id);
    const b = h('button', { class: 'btn go', type: 'button', disabled: done, onclick: () => { b.disabled = true; b.textContent = 'รอคนอื่น...'; send({ t: 'ack' }); } }, done ? 'รอคนอื่น...' : label);
    return bar(b, waitingFor(m), m.scr !== 'role');
  }

  // the role card is face down until tapped, and re-renders (pushes) keep it as the player left it
  function roleFlip(v, secret) {
    const wrap = h('div', { class: 'flip', style: 'min-height:500px' }, h('div', { class: 'inner' },
      h('div', { class: 'front' }, roleCard(v)), h('div', { class: 'back' }, h('span', {}, 'แตะเพื่อดูบทบาท'))));
    const hide = h('button', { class: 'hide-role', type: 'button' }, 'ซ่อนการ์ด');
    const ctl = FX.flipCard(wrap, { hideButton: hide });
    if (ctl && ui.roleOpen) ctl.open();
    const sync = () => { ui.roleOpen = wrap.classList.contains('open'); secret.hidden = !ui.roleOpen; };
    wrap.addEventListener('click', sync); hide.addEventListener('click', sync);
    secret.hidden = !ui.roleOpen;
    return [wrap, hide];
  }
  function roleScreen(m) {
    const v = m.v, mate = v.me.mateId != null ? v.players[v.me.mateId] : null;
    const secret = h('div', {}, h('p', { class: 'center' }, 'ห้องของคุณคือ ', h('b', {}, v.me.room), ' (ห้ามบอกใคร)'),
      mate ? h('p', { class: 'center' }, `${HM.ROLES[mate.role].name}ของคุณคือ `, h('b', {}, mate.name), ` (ห้อง ${mate.room})`) : null);
    show('role', h('h2', { class: 'center' }, 'บทบาทของคุณ'), roleFlip(v, secret), secret,
      h('h3', {}, `ห้องที่พบศพตอนเริ่มเกม (${v.closed.length} ห้อง)`), board(v),
      ackButton(m, 'พร้อมแล้ว เริ่มวันที่ 1'));
  }

  function sleepScreen(m) {
    const sky = h('div'); FX.stars(sky);
    show('sleep|' + m.v.day, h('div', { class: 'sleep' }, sky, 'ทุกคนหลับตา...',
      h('p', { class: 'sub' }, `คืนที่ ${m.v.day} · ไมค์ปิดอัตโนมัติ`), m.v.me.alive ? null : h('p', { class: 'sub' }, 'คุณออกจากเกมแล้ว ดูเกมต่อได้')));
  }

  function actionScreen(m) {
    const o = m.options, v = m.v, pick = (val, rebuild) => { ui.picked = val; rebuild(); };
    const titles = { lock: 'คุณคือช่างกุญแจ — เลือกห้องที่จะล็อก', kill: 'คุณคือฆาตกร — เลือกห้องที่จะลงมือ',
      peek: o.role === 'detective' ? 'คุณคือนักสืบ — เลือกผู้เล่นที่จะสืบ' : 'คุณคือผู้ช่วยฆาตกร — เลือกผู้เล่นที่จะตรวจ',
      floor: 'คุณคือแม่บ้าน — เลือกชั้นที่จะนับคน', column: 'คุณคือช่างเช็ดกระจก — เลือกแถวที่จะนับคน', watch: 'คุณคือพยาน — เลือกชั้นที่จะเฝ้า' };
    const field = { lock: 'room', kill: 'room', floor: 'floor', watch: 'floor', column: 'col', peek: 'target' }[o.type];
    const items = o.type === 'lock' || o.type === 'kill' ? o.rooms.map((k) => [k, k]) : o.type === 'floor' || o.type === 'watch' ? o.floors.map((f) => [f, `ชั้น ${f}`])
      : o.type === 'column' ? o.cols.map((c) => [c, `แถว ${c}`]) : o.targets.map((id) => [id, nmOf(v, id)]);
    const cols = o.type === 'lock' || o.type === 'kill' ? v.cols : o.type === 'peek' ? 2 : Math.min(5, items.length);
    const g = grid(cols), go = h('button', { class: 'btn go', type: 'button', disabled: ui.picked == null, onclick: () => send({ t: 'night', action: { [field]: ui.picked } }) }, 'ยืนยัน');
    const why = h('span', { class: 'why' }, ui.picked == null ? 'เลือกก่อน' : '');
    const rebuild = () => { go.disabled = ui.picked == null; why.textContent = ui.picked == null ? 'เลือกก่อน' : ''; [...g.children].forEach((b, i) => b.setAttribute('aria-pressed', items[i][0] === ui.picked ? 'true' : 'false')); };
    items.forEach(([val, label]) => g.append(choice(label, ui.picked === val, () => pick(val, rebuild))));
    const team = o.type === 'kill' && o.teamNotes.length ? h('div', { class: 'panel' }, h('b', {}, 'ผู้ช่วยตรวจคืนนี้: '), o.teamNotes.map((n) => noteText(v, n).replace(/^คืนที่ \d+: /, '')).join(' · ')) : null;
    show('action|' + v.day, h('h2', {}, `คืนที่ ${v.day}`), h('p', { class: 'sub' }, 'เลือกด้วยความเงียบ ไมค์ปิดอยู่ ไม่มีใครเห็นการเลือกของคุณ'), statusLine(v),
      h('h3', {}, titles[o.type]), toast(), team, g, notebook(v), h('details', {}, h('summary', {}, 'แผนผังโรงแรม'), board(v)),
      h('div', { class: 'actionbar' }, go, why));
  }

  function resultScreen(m) {
    const v = m.v, last = v.me.notes[v.me.notes.length - 1];
    show('result|' + v.day, h('h2', {}, 'ผลที่คุณได้รับ'), h('div', { class: 'panel' }, h('p', { class: 'center', style: 'font-size:20px' }, noteText(v, last).replace(/^คืนที่ \d+: /, ''))),
      h('p', { class: 'sub center' }, 'จดไว้ได้ในสมุดโน้ต ผลนี้เป็นความลับของคุณ'),
      bar(h('button', { class: 'btn go', type: 'button', onclick: () => send({ t: 'resultAck' }) }, 'หลับตาต่อ')));
  }

  // dawn: the murderer's strike is revealed line by line, once per dawn; any later re-render shows everything at once
  function dawnLines(lines, instant) {
    return lines.map((ln) => h('div', { class: 'dawn-line shown' + (ln.kind ? ' ' + ln.kind : ''), style: instant ? 'animation:none;opacity:1' : null }, ln.text));
  }
  function dawnScreen(m) {
    const d = m.dawn, v = m.v, day = v.day;
    if (ui.dawnRunning === day) { ui.pendingDawn = m; return; }       // do not rebuild the stage while it plays
    const outcome = d.outcome === 'death' ? { text: `${nmOf(v, d.victim)} เสียชีวิต`, kind: 'death' }
      : d.outcome === 'empty' ? { text: 'ห้องว่าง ไม่มีใครเสียชีวิต', kind: 'big' } : { text: 'ประตูถูกล็อก — ลงมือไม่สำเร็จ', kind: 'locked' };
    const lines = [{ text: 'ฆาตกรลงมือเมื่อคืน...' }, { text: `ชั้น ${HM.floorOf(d.room)}` }, { text: `ห้อง ${d.room}` }, outcome];
    const stage = h('div', { class: 'dawn-stage', 'aria-live': 'polite' });
    const play = !ui.dawnPlayed[day];
    if (play) {
      ui.dawnPlayed[day] = true; ui.dawnRunning = day;
      FX.dawnSequence(stage, lines).then(() => {
        ui.dawnRunning = null;
        const p = ui.pendingDawn || st.last; ui.pendingDawn = null;
        if (p && st.last && st.last.scr === 'dawn' && st.last.v.day === day) dawnScreen(p);
      });
    } else stage.append(...dawnLines(lines, true));
    show('dawn|' + day, h('h2', {}, 'รุ่งเช้า'), stage,
      play ? null : [d.victim === v.me.id ? h('p', { class: 'center sub' }, 'คุณออกจากเกมแล้ว แต่ยังดูเกมต่อได้') : null,
        d.outcome === 'death' ? h('p', { class: 'center sub' }, 'ผู้เสียชีวิตคืนคีย์การ์ดและออกจากเกม ไม่เปิดเผยบทบาท') : null, board(v)],
      ackButton(m, v.winner ? 'ดูผล' : `เข้าสู่วันที่ ${v.day + 1}`));
  }

  // two claims contradict when two different players claim the same role, or one player claims two roles / two results for one role
  function conflictSet(chat) {
    const bad = new Set();
    chat.forEach((a, i) => chat.forEach((b, j) => {
      if (j <= i || !a.claim || !b.claim) return;
      const A = a.claim, B = b.claim;
      const clash = a.by !== b.by ? A.as === B.as : (A.as !== B.as || (A.kind === B.kind && JSON.stringify(A) !== JSON.stringify(B)));
      if (clash) { bad.add(i); bad.add(j); }
    }));
    return bad;
  }

  function dayScreen(m) {
    const v = m.v, alive = v.me.alive;
    const proposed = {}; m.proposals.forEach((p) => { proposed[p.by] = p.room; });
    const pbar = h('div', { class: 'pbar', 'aria-label': 'สถานะผู้เล่น' }, v.players.map((p) => {
      const cls = !p.alive ? 'out' : proposed[p.id] ? 'proposed' : m.readyVote.includes(p.id) ? 'ready' : '';
      return h('span', { class: 'pchip' + (cls ? ' ' + cls : '') }, p.id === v.me.id ? `${p.name} (คุณ)` : p.name, proposed[p.id] && p.alive ? ` · ${proposed[p.id]}` : '', proposed[p.id] && p.alive && m.readyVote.includes(p.id) ? ' ✓' : '');
    }));
    const bad = conflictSet(m.chat);
    const board$ = m.chat.length ? h('div', { class: 'claimboard' }, m.chat.map((c, i) => h('div', { class: bad.has(i) ? 'conflict' : null }, h('span', { class: 'name' }, c.by === v.me.id ? 'คุณ' : nmOf(v, c.by)), h('span', {}, c.text))))
      : h('p', { class: 'sub' }, 'ยังไม่มีใครประกาศอะไร คุยกันด้วยเสียงได้เลย');
    const claims = h('div', {});
    const bluffRole = h('select', { id: 'bluffrole', 'aria-label': 'บทบาทที่จะอ้าง', onchange: () => { ui.bluff = bluffRole.value; } }, ['locksmith', 'housekeeper', 'windowcleaner', 'detective', 'witness'].map((r) => h('option', { value: r }, HM.ROLES[r].name)));
    bluffRole.value = ui.bluff;
    if (alive) {
      m.claimOptions.forEach((c) => claims.append(h('button', { class: 'btn', type: 'button', disabled: c.said, onclick: () => send({ t: 'say', i: c.i }) }, `ประกาศ: ${c.text}`)));
      if (m.canBluff) claims.append(h('details', {}, h('summary', {}, 'บลัฟ: ประกาศผลปลอมของบทบาทอื่น'), bluffRole,
        h('button', { class: 'btn', type: 'button', onclick: () => send({ t: 'bluff', as: bluffRole.value }) }, 'ประกาศผลปลอมแบบสุ่ม')));
    }
    const propose = alive ? h('details', {}, h('summary', {}, 'เสนอห้องที่จะรุมบุก'),
      (() => { const g = grid(v.cols); m.rooms.forEach((k) => g.append(choice(k, m.myProposal === k, () => send({ t: 'propose', room: m.myProposal === k ? null : k })))); return g; })(),
      h('p', { class: 'sub' }, m.myProposal ? `คุณเสนอบุกห้อง ${m.myProposal} (กดซ้ำเพื่อยกเลิก)` : 'คุณยังไม่ได้เสนอห้อง (ไม่เสนอก็ได้)')) : null;
    const ready = m.readyVote.includes(v.me.id);
    const liveHumans = m.humans.filter((id) => v.players[id].alive), notReady = liveHumans.filter((id) => !m.readyVote.includes(id));
    const btn = h('button', { class: 'btn go', type: 'button', disabled: ready, onclick: () => { btn.disabled = true; send({ t: 'voteReady' }); } }, ready ? 'รอคนอื่นพร้อม...' : 'พร้อมยกมือโหวต');
    show('day|' + v.day, h('div', { class: 'sun', 'aria-hidden': 'true' }), h('h2', {}, `กลางวัน วันที่ ${v.day}`), statusLine(v), countdown(m, 'เวลาอภิปรายที่เหลือ'),
      h('p', { class: 'sub center' }, alive ? '🎤 คุยกันได้เลย ไมค์เปิดตอนกลางวัน' : 'คุณออกจากเกมแล้ว ฟังและดูได้อย่างเดียว'),
      toast(), v.day === 1 ? h('p', { class: 'sub' }, 'วันแรกยังไม่มีใครถูกฆ่า แต่เสนอห้องและบุกได้เลย') : null,
      pbar, h('h3', {}, 'คำประกาศวันนี้'), board$, claims, propose, notebook(v), h('details', { open: true }, h('summary', {}, 'แผนผังโรงแรม'), board(v)),
      bar(alive ? btn : null, alive ? (ready ? waitText(v, notReady) : `พร้อมโหวต ${liveHumans.length - notReady.length}/${liveHumans.length} คน · หมดเวลาแล้วโหวตอัตโนมัติ`) : '', true));
  }

  function voteScreen(m) {
    const v = m.v, mine = m.submitted.includes(v.me.id) || ui.sent;
    const pending = m.humans.filter((id) => v.players[id].alive && !m.submitted.includes(id));
    if (!v.me.alive) return show('vote|' + v.day, h('h2', {}, 'ยกมือโหวตบุกห้อง'), statusLine(v), h('p', { class: 'center sub' }, 'คุณออกจากเกมแล้ว รอผลโหวต...'), countdown(m, 'เวลาโหวต'), board(v), bar(null, '', true));
    const rows = m.ballot.map(({ room, by }) => {
      const chk = h('input', { type: 'checkbox', id: `r${room}`, checked: ui.yes.has(room), disabled: mine, onchange: () => { if (chk.checked) ui.yes.add(room); else ui.yes.delete(room); } });
      return h('label', { for: `r${room}`, class: 'opt' }, chk, ` ห้อง ${room}`, h('small', {}, `เสนอโดย ${by.map((i) => (i === v.me.id ? 'คุณ' : nmOf(v, i))).join(', ')}`));
    });
    const go = h('button', { class: 'btn go', type: 'button', disabled: mine, onclick: () => { ui.sent = true; send({ t: 'hands', yes: [...ui.yes] }); } }, mine ? 'ส่งแล้ว รอคนอื่น...' : 'ยืนยันการยกมือ');
    show('vote|' + v.day, h('h2', {}, 'ยกมือโหวตบุกห้อง'), statusLine(v), countdown(m, 'เวลาโหวต'), toast(),
      h('p', { class: 'sub' }, `ไล่นับจากเลขห้องน้อยไปมาก ห้องแรกที่ได้ ${m.need} เสียงขึ้นไป (มากกว่าครึ่งของคนที่ยังอยู่) จะถูกบุก ถ้าไม่มีห้องไหนถึง วันนี้ไม่มีใครถูกบุก`),
      h('div', { class: 'panel' }, rows), notebook(v), h('details', {}, h('summary', {}, 'แผนผังโรงแรม'), board(v)),
      bar(go, mine ? waitText(v, pending) : 'ติ๊กห้องที่เห็นด้วย แล้วกดยืนยัน (ไม่ติ๊กเลย = ไม่เห็นด้วยทุกห้อง)', true));
  }

  function raidScreen(m) {
    const v = m.v, res = m.raid;
    const text = res.outcome === 'murderer' ? `ห้อง ${res.room} คือห้องของฆาตกร! ${nmOf(v, res.player)} ถูกจับได้`
      : res.outcome === 'evicted' ? `ห้อง ${res.room} มีคนอยู่ — ${nmOf(v, res.player)} ถูกประชาทัณฑ์ คืนคีย์การ์ดและออกจากเกม (ไม่เปิดบทบาท)`
        : res.outcome === 'empty' ? `ห้อง ${res.room} เป็นห้องว่าง ปิดห้องนี้`
          : (res.proposals.length ? 'ไม่มีห้องไหนได้เสียงเกินครึ่ง วันนี้ไม่มีใครถูกบุก' : 'ไม่มีใครเสนอห้อง วันนี้ไม่มีใครถูกบุก');
    const rows = res.tallies.map((t) => h('tr', {}, h('td', {}, `ห้อง ${t.room}`), h('td', {}, `${t.yes} / ${res.alive} เสียง`)));
    show('raid|' + v.day, h('h2', {}, `ผลการบุกวันที่ ${res.day}`), h('div', { class: 'panel' }, h('p', { class: 'center', style: 'font-size:19px' }, text)),
      rows.length ? h('details', { open: true }, h('summary', {}, 'ผลนับเสียง'), h('table', {}, rows)) : null, board(v),
      ackButton(m, v.winner ? 'ดูผลเกม' : `เริ่มคืนที่ ${v.day}`));
  }

  // ---- game over: banner, awards and a recap timeline, all from data every player may see after the game
  function awardsOf(m) {
    const v = m.v, r = v.reveal, nm = (id) => nmOf(v, id), out = [];
    const killer = v.players.find((p) => p.role === 'murderer');
    const first = r.nights.find((n) => n.outcome === 'death');
    out.push(first ? ['🩸 เหยื่อรายแรก', `${nm(first.victim)} (คืนที่ ${first.day}, ห้อง ${first.chosen})`] : ['🕊️ ค่ำคืนสงบ', 'ไม่มีใครถูกฆ่าตลอดเกม']);
    if (killer) {
      const failed = r.nights.filter((n) => n.outcome !== 'death').length, wrong = r.raids.filter((x) => x.outcome === 'evicted' || x.outcome === 'empty').length;
      out.push(['🍀 โชคช่วยฆาตกร', `${nm(killer.id)} ลงมือพลาด/ถูกล็อก ${failed} คืน และรอดจากการบุกผิดห้อง ${wrong} ครั้ง`]);
    }
    const caught = r.raids.find((x) => x.outcome === 'murderer');
    if (caught) {
      const by = (m.raidBy || []).map(nm);
      out.push(['🎯 ผู้ไขคดี', by.length ? `${by.join(', ')} เสนอห้อง ${caught.room} ที่จับ ${nm(caught.player)} ได้ (วันที่ ${caught.day})` : `ห้อง ${caught.room} จับ ${nm(caught.player)} ได้ (วันที่ ${caught.day})`]);
    } else if (killer) out.push(['🕶️ ฆาตกรลอยนวล', `${nm(killer.id)} รอดจนจบเกม`]);
    const said = {}; v.claims.forEach((c) => { said[c.by] = (said[c.by] || 0) + 1; });
    const top = Object.keys(said).sort((a, b) => said[b] - said[a] || a - b)[0];
    if (top != null) out.push(['📣 นักประกาศตัวยง', `${nm(+top)} ประกาศผลทั้งหมด ${said[top]} ครั้ง`]);
    return out;
  }
  function recapOf(v) {
    const r = v.reveal, nm = (id) => nmOf(v, id), items = [];
    for (let d = 1; d <= v.days; d++) {
      const raid = r.raids.find((x) => x.day === d), night = r.nights.find((x) => x.day === d);
      if (raid) {
        const t = raid.outcome === 'murderer' ? `บุกห้อง ${raid.room} — จับ ${nm(raid.player)} ฆาตกรได้!` : raid.outcome === 'evicted' ? `บุกห้อง ${raid.room} — ${nm(raid.player)} ถูกประชาทัณฑ์ (ผิดคน)`
          : raid.outcome === 'empty' ? `บุกห้อง ${raid.room} — ห้องว่าง` : 'ไม่มีใครถูกบุกห้อง';
        items.push(h('li', { class: 'day' }, h('b', {}, `วันที่ ${d}: `), t));
      }
      if (night) {
        const t = night.outcome === 'death' ? `ฆาตกรบุกห้อง ${night.chosen} — ${nm(night.victim)} เสียชีวิต` : night.outcome === 'locked' ? `ฆาตกรเลือกห้อง ${night.chosen} แต่ถูกล็อกไว้`
          : `ฆาตกรเลือกห้อง ${night.chosen} — ห้องว่าง`;
        items.push(h('li', { class: 'night' }, h('b', {}, `คืนที่ ${d}: `), t));
      }
    }
    return h('ol', { class: 'recap' }, items);
  }
  function overScreen(m) {
    const v = m.v, mine = HM.ROLES[v.me.role].side === v.winner;
    const rows = v.players.map((p) => h('tr', {}, h('td', {}, p.id === v.me.id ? `${p.name} (คุณ)` : p.name), h('td', {}, HM.ROLES[p.role].name), h('td', {}, p.room),
      h('td', {}, p.out === 'killed' ? 'ถูกฆ่า' : p.out === 'raided' ? 'ถูกบุกห้อง' : 'รอด')));
    show('over', st.hostGone ? h('div', { class: 'vstate warn' }, 'โฮสต์ปิดการเชื่อมต่อแล้ว แต่ผลเกมยังดูได้ที่นี่') : null,
      h('div', { class: 'win ' + (v.winner === 'บริสุทธิ์' ? 'good' : 'evil') }, v.winner === 'บริสุทธิ์' ? 'ฝ่ายบริสุทธิ์ชนะ!' : 'ฝ่ายฆาตกรชนะ!'),
      h('p', { class: 'center' }, v.winReason), h('p', { class: 'center sub' }, mine ? 'คุณอยู่ฝ่ายที่ชนะ' : 'คุณอยู่ฝ่ายที่แพ้'),
      h('p', { class: 'center sub' }, '🎤 ไมค์เปิดแล้ว คุยเฉลยกันได้เลย'),
      h('h3', {}, 'รางวัลประจำเกม'), awardsOf(m).map(([t, d]) => h('div', { class: 'award' }, h('b', {}, t), h('div', {}, d))),
      h('h3', {}, 'เรื่องราวทั้งเกม'), recapOf(v),
      h('div', { class: 'panel' }, h('table', {}, h('tr', {}, h('th', {}, 'ผู้เล่น'), h('th', {}, 'บทบาท'), h('th', {}, 'ห้อง'), h('th', {}, 'สถานะ')), rows)),
      h('h3', {}, 'ห้องที่ช่างกุญแจล็อกแต่ละคืน'), h('p', { class: 'sub' }, v.reveal.lockHistory.length ? v.reveal.lockHistory.map((b) => `คืน ${b.day}: ${b.room}`).join(' · ') : 'ไม่มีช่างกุญแจ'),
      board(v), reactBar(),
      h('button', { class: 'btn go', type: 'button', onclick: () => { rejoinStore.clear(); if (st.peer) { try { st.peer.destroy(); } catch (e) { /* ignore */ } } voice.closeAll(); st.peer = null; home(); } }, 'กลับหน้าแรก'));
  }

  if (/[?&]debug\b/.test(location.search)) window.__hmOnline = { voice };     // never expose game state (st.game.S) to the console otherwise
  home();
})();
