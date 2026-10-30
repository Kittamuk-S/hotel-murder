/*
 * fx.js - small, defensive UI animation helpers. Exports window.FX.
 * Pairs with app/fx.css (same class contract). No audio, no dependencies.
 *
 * API
 *   FX.reduced()                      -> boolean, live prefers-reduced-motion
 *   FX.phase(name)                    -> body[data-phase] = night|day|dawn|over (else removed)
 *   FX.enter(root, isNewScreen)       -> adds .enter to root; removed on animationend / 600ms
 *   FX.flipCard(wrapEl, opts)         -> markup .flip > .inner > .front + .back
 *                                        opts.hideButton: element that closes the card
 *                                        returns {open(), close(), toggle()} (or null)
 *   FX.dawnSequence(containerEl, lines) -> Promise; lines=[{text, kind?:'big'|'death'|'locked'}]
 *                                        builds .dawn-line (style --i, class big/death/locked)
 *   FX.react(emoji, leftPercent?)     -> floating .reaction on body (max 12, gone after 3s)
 *   FX.stars(el)                      -> ensures el is a .stars layer (CSS draws the stars)
 */
(function () {
  'use strict';

  var PHASES = { night: 1, day: 1, dawn: 1, over: 1 };
  var LINE_MS = 1100;
  var mq = null;
  try {
    mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch (e) { mq = null; }

  function reduced() {
    try { return !!(mq && mq.matches); } catch (e) { return false; }
  }

  function phase(name) {
    var b = document.body;
    if (!b) return;
    if (name && PHASES[name] === 1) b.dataset.phase = name;
    else delete b.dataset.phase;
  }

  function enter(root, isNewScreen) {
    if (!root || !isNewScreen || reduced()) return;
    if (root._fxEnterDone) root._fxEnterDone(); // clear any previous run
    var timer = null;
    function done() {
      if (timer) clearTimeout(timer);
      timer = null;
      root.classList.remove('enter');
      root.removeEventListener('animationend', onEnd);
      root._fxEnterDone = null;
    }
    function onEnd(ev) { if (ev.target === root) done(); }
    root._fxEnterDone = done;
    // restart the animation if the class was already present
    root.classList.remove('enter');
    void root.offsetWidth;
    root.classList.add('enter');
    root.addEventListener('animationend', onEnd);
    timer = setTimeout(done, 600);
  }

  function flipCard(wrap, opts) {
    if (!wrap) return null;
    opts = opts || {};
    if (wrap._fxFlip) { // already wired: just return the controls
      wrap._fxFlip.rebind(opts.hideButton);
      return wrap._fxFlip;
    }
    function set(open) {
      wrap.classList.toggle('open', !!open);
      wrap.setAttribute('aria-pressed', open ? 'true' : 'false');
      wrap.setAttribute('aria-label', open ? 'ซ่อนการ์ด' : 'แตะเพื่อดูการ์ด');
    }
    var ctl = {
      open: function () { set(true); },
      close: function () { set(false); },
      toggle: function () { set(!wrap.classList.contains('open')); },
      rebind: function (btn) {
        if (!btn || btn._fxBound) return;
        btn._fxBound = true;
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          set(false);
        });
      }
    };
    wrap._fxFlip = ctl;
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'button');
    set(false); // always start closed
    wrap.addEventListener('click', function (ev) {
      if (opts.hideButton && opts.hideButton.contains && opts.hideButton.contains(ev.target)) return;
      ctl.toggle();
    });
    wrap.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        ctl.toggle();
      }
    });
    ctl.rebind(opts.hideButton);
    return ctl;
  }

  function dawnSequence(el, lines) {
    return new Promise(function (resolve) {
      if (!el) { resolve(); return; }
      lines = Array.isArray(lines) ? lines : [];
      if (el._fxDawnTimers) el._fxDawnTimers.forEach(clearTimeout);
      el._fxDawnTimers = [];
      el.textContent = '';
      var quick = reduced();
      var kinds = { big: 1, death: 1, locked: 1 };
      var nodes = lines.map(function (ln, i) {
        var d = document.createElement('div');
        d.className = 'dawn-line' + (ln && kinds[ln.kind] ? ' ' + ln.kind : '');
        d.style.setProperty('--i', String(i));
        d.textContent = ln && ln.text != null ? String(ln.text) : '';
        el.appendChild(d);
        return d;
      });
      if (quick || !nodes.length) {
        nodes.forEach(function (n) { n.classList.add('shown'); });
        resolve();
        return;
      }
      // CSS reveals line i after i * 1.1s; mark .shown on the same schedule
      nodes.forEach(function (n, i) {
        el._fxDawnTimers.push(setTimeout(function () {
          n.classList.add('shown');
          if (i === nodes.length - 1) resolve();
        }, i * LINE_MS));
      });
    });
  }

  function react(emoji, left) {
    var b = document.body;
    if (!b) return null;
    var live = b.querySelectorAll('.reaction');
    if (live.length >= 12) return null;
    var pct = typeof left === 'number' && isFinite(left)
      ? Math.max(0, Math.min(100, left))
      : 10 + Math.random() * 80;
    var n = document.createElement('div');
    n.className = 'reaction';
    n.textContent = String(emoji == null ? '' : emoji);
    n.style.left = pct + '%';
    n.setAttribute('aria-hidden', 'true');
    b.appendChild(n);
    setTimeout(function () {
      if (n.parentNode) n.parentNode.removeChild(n);
    }, reduced() ? 1000 : 3000);
    return n;
  }

  function stars(el) {
    if (!el) return;
    el.classList.add('stars');
    el.setAttribute('aria-hidden', 'true');
  }

  window.FX = {
    reduced: reduced,
    phase: phase,
    enter: enter,
    flipCard: flipCard,
    dawnSequence: dawnSequence,
    react: react,
    stars: stars
  };
})();
