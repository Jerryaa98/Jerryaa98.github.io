/* paper-anims.js: one concept animation per paper thumbnail, in the page's magma palette.
   Same approach as muradtuk.github.io: each piece is drawn in a 160x100 logical space
   scaled to cover its plate, only tiles near the viewport run, and hovering a card speeds
   its tile up. The static figure stays as the tile's link target and as the fallback.
   URL flags: ?anim=off keeps the static figures; ?animt=<seconds> freezes every tile at
   that moment (for review screenshots). Reduced motion shows one still frame per tile. */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  if (q.get('anim') === 'off') return;
  var fixedT = q.get('animt') !== null ? parseFloat(q.get('animt')) : null;
  if (fixedT !== null && isNaN(fixedT)) fixedT = null;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 160, H = 100, TAU = Math.PI * 2, PLATE = '#120c16';
  var P = { amber: '#ffc861', coral: '#ff8a5c', magenta: '#e8559a', violet: '#9d6bff', red: '#ff6f7d', cream: '#fff1d6', dim: '#a8959f' };

  /* ---------- helpers ---------- */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(str) { var h = 2166136261, i; for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function ease(u) { u = clamp(u, 0, 1); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function ramp(t, a, b) { return ease((t - a) / (b - a)); }   // 0 before a, eased to 1 at b
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
  function noise(k, j, seed) { var n = Math.sin(k * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return n - Math.floor(n); }
  function rgbOf(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  function hexa(hex, a) { var c = rgbOf(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  function dot(ctx, x, y, r, fill) { if (r <= 0) return; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill(); }
  function ring(ctx, x, y, r, color, lw) { if (r <= 0) return; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = color; ctx.lineWidth = lw || 1; ctx.stroke(); }
  function line(ctx, x1, y1, x2, y2, color, lw, dash) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = lw || 1; if (dash) ctx.setLineDash(dash); ctx.stroke(); if (dash) ctx.setLineDash([]); }
  function glow(ctx, x, y, r, color, a) { if (r <= 0 || a <= 0) return; var g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexa(color, a)); g.addColorStop(1, hexa(color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function quad(p0, c, p1, u) { var v = 1 - u; return [v * v * p0[0] + 2 * v * u * c[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * c[1] + u * u * p1[1]]; }
  // the magma colormap the page's palette is drawn from: black, purple, magenta, coral, amber, cream
  var MAGMA = [[0, '#120c16'], [0.18, '#3b0f70'], [0.38, '#8c2981'], [0.58, '#de4968'], [0.78, '#fe9f6d'], [1, '#fcfdbf']].map(function (s) { return [s[0], rgbOf(s[1])]; });
  function magma(v, a) {
    v = clamp(v, 0, 1);
    for (var i = 1; i < MAGMA.length; i++) if (v <= MAGMA[i][0]) {
      var f = (v - MAGMA[i - 1][0]) / (MAGMA[i][0] - MAGMA[i - 1][0]), c0 = MAGMA[i - 1][1], c1 = MAGMA[i][1];
      return 'rgba(' + Math.round(lerp(c0[0], c1[0], f)) + ',' + Math.round(lerp(c0[1], c1[1], f)) + ',' + Math.round(lerp(c0[2], c1[2], f)) + ',' + (a === undefined ? 1 : a) + ')';
    }
    return 'rgb(252,253,191)';
  }

  var A = {};
  /* Each piece: period (s), still (the frame shown with reduced motion), fade (per-frame
     darkening: 1 = clear, smaller = light trails), init(r) -> state, draw(ctx, s, t, dt, u, T)
     where t = time inside the cycle, u = t / period, T = total running time. */

  /* 1. AXON: a masked sequence is decoded in parallel. Each step, the most confident masked
        token is revealed as an anchor (amber) and supports its masked neighbours, which are
        revealed with it along light arcs. The step meter finishes well before the 12 steps
        a plain decoder needs. */
  A.axon = {
    period: 9, still: 4.75, fade: 1,
    init: function (r) {
      var cols = 9, rows = 2, cw = 14, ch = 11, gap = 2.6, x0 = (W - (cols * cw + (cols - 1) * gap)) / 2, toks = [], i;
      for (i = 0; i < cols * rows; i++) {
        var row = Math.floor(i / cols), col = i % cols;
        toks.push({ row: row, col: col, x: x0 + col * (cw + gap), y: 20 + row * (ch + 7), conf: r(), t: 99, anchor: false, from: -1,
                    glyph: [3 + r() * 3, r() < 0.4 ? 0 : 1.5 + r() * 2] });   // word bars, kept inside the 14-wide cell
      }
      var masked = toks.map(function (_, j) { return j; }), STEPS = 7, k;
      for (k = 0; k < STEPS && masked.length; k++) {
        var t0 = 0.7 + k * 0.85;
        masked.sort(function (a, b) { return toks[b].conf - toks[a].conf; });
        var a = masked.shift(), anc = toks[a];
        anc.t = t0; anc.anchor = true;
        var near = masked.map(function (j) { return [Math.abs(toks[j].col - anc.col) + Math.abs(toks[j].row - anc.row) * 0.8, j]; })
                         .sort(function (p, q2) { return p[0] - q2[0]; });
        var take = k === STEPS - 1 ? near.length : Math.min(2, near.filter(function (p) { return p[0] <= 2.2; }).length);
        near.slice(0, take).forEach(function (p, n) { var tk = toks[p[1]]; tk.t = t0 + 0.3 + n * 0.08; tk.from = a; masked.splice(masked.indexOf(p[1]), 1); });
      }
      return { toks: toks, cw: cw, ch: ch, steps: k, stepT: function (n) { return 0.7 + n * 0.85; } };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var reset = ramp(t, 8.2, 8.9), cw = s.cw, ch = s.ch, i;
      // tokens
      s.toks.forEach(function (tk) {
        var age = t - tk.t, on = age >= 0 ? 1 - reset : 0, x = tk.x, y = tk.y, cx = x + cw / 2, cy = y + ch / 2;
        ctx.fillStyle = hexa(P.violet, 0.07); ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = hexa(P.dim, 0.3); ctx.lineWidth = 0.6; ctx.strokeRect(x + 0.3, y + 0.3, cw - 0.6, ch - 0.6);
        if (on < 1) for (i = 0; i < 4; i++) {   // [MASK]: shimmering noise
          var fr = Math.floor(T * 7 + i * 0.37);
          dot(ctx, x + 2 + noise(fr, i + tk.col * 5, tk.row + 1) * (cw - 4), y + 2 + noise(fr, i + tk.col * 5, tk.row + 7) * (ch - 4), 0.65, hexa(P.violet, (0.25 + 0.45 * noise(fr, i, tk.col)) * (1 - on)));
        }
        if (on > 0) {
          var col = tk.anchor ? P.amber : P.coral;
          ctx.fillStyle = hexa(col, 0.26 * on); ctx.fillRect(x, y, cw, ch);
          ctx.fillStyle = hexa(P.cream, 0.85 * on);   // the decoded word
          ctx.fillRect(x + 2.5, cy - 0.8, tk.glyph[0], 1.6);
          if (tk.glyph[1]) ctx.fillRect(x + 3.5 + tk.glyph[0], cy - 0.8, tk.glyph[1], 1.6);
          if (tk.anchor) { ctx.strokeStyle = hexa(P.amber, 0.95 * on); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1); }
          if (age < 0.5) { ctx.globalCompositeOperation = 'lighter'; glow(ctx, cx, cy, 5 + 9 * (1 - age / 0.5), col, 0.75 * (1 - age / 0.5)); ctx.globalCompositeOperation = 'source-over'; }
        }
      });
      // support arcs from each anchor to the neighbours it unlocks, with a spark running along
      ctx.globalCompositeOperation = 'lighter';
      s.toks.forEach(function (tk) {
        if (tk.from < 0) return;
        var a = s.toks[tk.from], life = t - a.t, span = tk.t - a.t;
        if (life < 0 || life > span + 0.7) return;
        var p0 = [a.x + cw / 2, a.y + ch / 2], p1 = [tk.x + cw / 2, tk.y + ch / 2], d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        var c = [(p0[0] + p1[0]) / 2, Math.min(p0[1], p1[1]) - 7 - d * 0.18];
        var alpha = (life < span ? 1 : 1 - (life - span) / 0.7) * (1 - reset), n, pts = [];
        for (n = 0; n <= 16; n++) pts.push(quad(p0, c, p1, n / 16));
        ctx.beginPath(); pts.forEach(function (p, k) { k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
        ctx.strokeStyle = hexa(P.amber, 0.5 * alpha); ctx.lineWidth = 0.8; ctx.stroke();
        if (life < span) { var sp = quad(p0, c, p1, ease(life / span)); glow(ctx, sp[0], sp[1], 4, P.amber, 0.9); dot(ctx, sp[0], sp[1], 1, P.cream); }
      });
      ctx.globalCompositeOperation = 'source-over';
      // step meter: AXON's steps (lit) against the 12 a plain parallel decoder takes (rings)
      var y = 80, x0 = 25, gx = 10, done = 0;
      for (i = 0; i < 12; i++) if (i < s.steps && t >= s.stepT(i)) done = i + 1;
      line(ctx, x0, y, x0 + gx * 11, y, hexa(P.dim, 0.18), 0.8);
      if (done > 1) line(ctx, x0, y, x0 + gx * (done - 1), y, hexa(P.coral, 0.7 * (1 - reset)), 1.2);
      for (i = 0; i < 12; i++) {
        var px = x0 + i * gx;
        if (i < done && reset < 1) { glow(ctx, px, y, 4.5, P.coral, 0.45 * (1 - reset)); dot(ctx, px, y, 1.9, hexa(P.coral, 1 - reset)); }
        else ring(ctx, px, y, 1.7, hexa(P.dim, i < s.steps ? 0.45 : 0.3), 0.7);
      }
      if (done === s.steps) {   // finished early: the saved steps
        var since = t - s.stepT(s.steps - 1), fx = x0 + gx * (s.steps - 1);
        if (since < 0.8) ring(ctx, fx, y, 2 + 10 * since, hexa(P.amber, 0.7 * (1 - since / 0.8)), 1);
        ctx.fillStyle = hexa(P.amber, 0.14 * (1 - reset)); ctx.fillRect(fx + gx / 2, y - 4, gx * (12 - s.steps) - gx / 2 + 3, 8);
      }
    }
  };

  /* 2. Balanced pairwise affinities (M.Sc. thesis): frozen features start biased and mixed.
        The affinity matrix is balanced with Sinkhorn (rows and columns even out and blocks
        appear on the diagonal), then the features are adapted into clean class clusters. */
  function sinkhorn(K, iters) {
    var n = K.length, M = K.map(function (row) { return row.slice(); }), it, i, j, s2;
    for (it = 0; it < iters; it++) {
      for (i = 0; i < n; i++) { s2 = 0; for (j = 0; j < n; j++) s2 += M[i][j]; for (j = 0; j < n; j++) M[i][j] /= s2 * n; }
      for (j = 0; j < n; j++) { s2 = 0; for (i = 0; i < n; i++) s2 += M[i][j]; for (i = 0; i < n; i++) M[i][j] /= s2 * n; }
    }
    return M;
  }
  function affinity(pts, key, sigma) {
    return pts.map(function (a, i) { return pts.map(function (b, j) { if (i === j) return 0.0001; var dx = a[key][0] - b[key][0], dy = a[key][1] - b[key][1]; return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)); }); });
  }
  function normMax(M) { var mx = 0; M.forEach(function (r) { r.forEach(function (v) { mx = Math.max(mx, v); }); }); return M.map(function (r) { return r.map(function (v) { return v / mx; }); }); }
  A.bpa = {
    period: 10, still: 6.4, fade: 1,
    init: function (r) {
      var cls = [P.amber, P.magenta, P.violet], from = [[44, 46], [58, 56], [48, 62]], to = [[26, 28], [80, 36], [48, 80]], pts = [], c, i;
      for (c = 0; c < 3; c++) for (i = 0; i < 6; i++) pts.push({ c: c, a: [from[c][0] + gauss(r) * 13, from[c][1] + gauss(r) * 11], b: [to[c][0] + gauss(r) * 4.5, to[c][1] + gauss(r) * 4], ph: r() * TAU });
      pts.forEach(function (p) { p.a[0] = clamp(p.a[0], 8, 96); p.a[1] = clamp(p.a[1], 8, 92); });
      var raw = affinity(pts, 'a', 16), rowSum = raw.map(function (row) { return row.reduce(function (x, y) { return x + y; }, 0); }), mx = Math.max.apply(null, rowSum);
      return { cls: cls, to: to, pts: pts, raw: normMax(raw), bal: normMax(sinkhorn(affinity(pts, 'b', 7), 30)), rowRaw: rowSum.map(function (v) { return v / mx; }) };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var back = ramp(t, 8.8, 9.9), cm = ramp(t, 1.2, 4.2) * (1 - back), cp = ramp(t, 4.0, 6.8) * (1 - back), n = s.pts.length, i, j;
      var M = s.raw.map(function (row, a) { return row.map(function (v, b) { return lerp(v, s.bal[a][b], cm); }); });
      var pos = s.pts.map(function (p) { return [lerp(p.a[0], p.b[0], ease(cp)) + Math.sin(T * 1.3 + p.ph) * 0.6, lerp(p.a[1], p.b[1], ease(cp)) + Math.cos(T * 1.1 + p.ph) * 0.6]; });
      // affinity lines: each point to its two strongest partners
      for (i = 0; i < n; i++) {
        var best = M[i].map(function (v, k) { return [v, k]; }).filter(function (e) { return e[1] !== i; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, 2);
        best.forEach(function (e) { var same = s.pts[e[1]].c === s.pts[i].c; line(ctx, pos[i][0], pos[i][1], pos[e[1]][0], pos[e[1]][1], same ? hexa(s.cls[s.pts[i].c], 0.18 + 0.3 * e[0]) : hexa(P.dim, 0.25 * e[0] + 0.05), 0.7); });
      }
      ctx.globalCompositeOperation = 'lighter';
      if (cp > 0.6) s.to.forEach(function (c, k) { var a = (cp - 0.6) / 0.4; glow(ctx, c[0], c[1], 14, s.cls[k], 0.22 * a); ring(ctx, c[0], c[1], 9 + Math.sin(T * 2 + k) * 0.8, hexa(s.cls[k], 0.45 * a), 0.8); });
      s.pts.forEach(function (p, k) { glow(ctx, pos[k][0], pos[k][1], 4, s.cls[p.c], 0.5); dot(ctx, pos[k][0], pos[k][1], 1.5, s.cls[p.c]); });
      ctx.globalCompositeOperation = 'source-over';
      // the affinity matrix, rows and columns grouped by class, in magma
      var mx0 = 106, my0 = 22, cell = 2.5, side = cell * n;
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) { ctx.fillStyle = magma(Math.pow(M[i][j], 0.7)); ctx.fillRect(mx0 + j * cell, my0 + i * cell, cell + 0.15, cell + 0.15); }
      ctx.strokeStyle = hexa(P.dim, 0.45); ctx.lineWidth = 0.6; ctx.strokeRect(mx0 - 0.5, my0 - 0.5, side + 1, side + 1);
      // row marginals: uneven before balancing, equal after
      for (i = 0; i < n; i++) { var len = lerp(s.rowRaw[i], 0.7, cm) * 7; ctx.fillStyle = hexa(P.coral, 0.75); ctx.fillRect(mx0 + side + 2.5, my0 + i * cell + 0.4, len, cell - 0.8); }
      for (i = 0; i < 3; i++) { ctx.fillStyle = s.cls[i]; ctx.fillRect(mx0 - 3.5, my0 + i * 6 * cell + 0.5, 1.6, 6 * cell - 1); }
    }
  };

  /* 3. SpurAudio: a bird chirp over a rainy background in both the support clip and the
        query. When the query's background changes to street noise, the embedding of the same
        bird slides to the class that was recorded on the street: a shortcut, not the sound. */
  A.spuraudio = {
    period: 9, still: 6.2, fade: 1,
    init: function () { return { bird: [104, 30], other: [138, 70], sup: [[96, 24], [112, 26], [100, 38]], oth: [[146, 64], [132, 76], [144, 78]] }; },
    draw: function (ctx, s, t, dt, u, T) {
      var shift = ramp(t, 3.3, 4.4) * (1 - ramp(t, 7.8, 8.8));
      function spectro(x, y, w, h, mix, seed) {
        var cols = 30, rows = 12, cw = w / cols, rh = h / rows, k0 = Math.floor(T * 11), off = (T * 11) % 1, i, j;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.fillStyle = PLATE; ctx.fillRect(x, y, w, h);
        for (i = -1; i <= cols; i++) {
          var k = k0 + i, px = x + (i - off) * cw;
          for (j = 0; j < rows; j++) {
            var rain = noise(k, j, seed) > 0.62 ? 0.42 : 0.12 + 0.12 * noise(k * 3, j, seed + 1);                          // broadband speckle
            var low = j / (rows - 1), street = 0.12 + 0.55 * Math.pow(low, 2.2) * (0.7 + 0.3 * Math.sin(k * 0.21 + j)) + (j === 5 && k % 24 < 7 ? 0.55 : 0);   // rumble and a horn
            var v = lerp(rain, street, mix), ph = k % 16;
            if (ph < 6) { var cj = 8 - ph; if (j === cj) v = 1; else if (j === cj - 3) v = Math.max(v, 0.72); }   // the chirp and its harmonic
            ctx.fillStyle = magma(v); ctx.fillRect(px, y + j * rh, cw + 0.3, rh + 0.3);
          }
        }
        ctx.restore();
        ctx.strokeStyle = hexa(P.dim, 0.5); ctx.lineWidth = 0.6; ctx.strokeRect(x + 0.3, y + 0.3, w - 0.6, h - 0.6);
      }
      spectro(6, 10, 66, 34, 0, 3);            // support clip
      spectro(6, 56, 66, 34, shift, 9);        // query clip
      // embedding: two class prototypes with their support points
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, s.bird[0], s.bird[1], 20, P.amber, 0.28); glow(ctx, s.other[0], s.other[1], 20, P.violet, 0.3);
      ctx.globalCompositeOperation = 'source-over';
      ring(ctx, s.bird[0], s.bird[1], 13, hexa(P.amber, 0.4), 0.7); ring(ctx, s.other[0], s.other[1], 13, hexa(P.violet, 0.45), 0.7);
      s.sup.forEach(function (p) { dot(ctx, p[0], p[1], 2, P.amber); });
      s.oth.forEach(function (p) { dot(ctx, p[0], p[1], 2, P.violet); });
      line(ctx, 74, 27, 86, 27, hexa(P.dim, 0.35), 0.7, [1.5, 2]);
      // the query: lands on "bird", then follows the background to the wrong class
      var qx = lerp(108, 128, shift), qy = lerp(36, 64, shift), col = shift > 0.55 ? P.red : P.amber, target = shift > 0.5 ? s.other : s.bird;
      line(ctx, 74, 73, qx - 4, qy, hexa(P.dim, 0.35), 0.7, [1.5, 2]);
      line(ctx, qx, qy, target[0], target[1], hexa(col, 0.5), 0.8, [2, 2]);
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, qx, qy, 9, col, 0.8); ctx.globalCompositeOperation = 'source-over';
      dot(ctx, qx, qy, 2.8, col); dot(ctx, qx, qy, 1.1, P.cream);
      if (shift > 0.8) { var a = (shift - 0.8) / 0.2, mx = qx + 7, my = qy - 7; line(ctx, mx - 2.2, my - 2.2, mx + 2.2, my + 2.2, hexa(P.red, a), 1.1); line(ctx, mx + 2.2, my - 2.2, mx - 2.2, my + 2.2, hexa(P.red, a), 1.1); }
    }
  };

  /* 4. SPECTRA: five sessions, each adds a class from five clips. The shots form a prototype,
        unlabelled queries pull the prototypes into place (transport lines), and then the shots
        are dropped: each old class lives on as a subspace that keeps replaying features, so
        nothing is forgotten. The timeline at the bottom tracks the sessions. */
  A.spectra = {
    period: 11.6, still: 10.2, fade: 1,
    init: function (r) {
      var centers = [[30, 28], [72, 20], [120, 30], [50, 62], [104, 64]], cols = [P.amber, P.coral, P.magenta, P.violet, P.red];
      var classes = centers.map(function (c, k) {
        var rot = (r() - 0.5) * 1.6, shots = [], i;
        for (i = 0; i < 5; i++) { var a = gauss(r) * 0.8, b = gauss(r) * 0.6; shots.push({ x: c[0] + Math.cos(rot) * a * 11 - Math.sin(rot) * b * 4, y: c[1] + Math.sin(rot) * a * 11 + Math.cos(rot) * b * 4, y0: 10 + r() * 70, bend: (r() - 0.5) * 30 }); }
        var qs = []; for (i = 0; i < 4; i++) qs.push([c[0] + gauss(r) * 7, c[1] + gauss(r) * 5]);
        return { c: c, col: cols[k], rot: rot, shots: shots, qs: qs, t0: 0.4 + k * 1.9 };
      });
      return { classes: classes };
    },
    draw: function (ctx, s, t, dt, u, T) {
      var out = 1 - ramp(t, 11, 11.55), active = -1;
      s.classes.forEach(function (cl, k) { if (t >= cl.t0) active = k; });
      ctx.globalAlpha = out;
      s.classes.forEach(function (cl, k) {
        var tau = t - cl.t0; if (tau < 0) return;
        var proto = ramp(tau, 0.6, 1.0), sub = ramp(tau, 1.3, 1.9), ref = tau > 0.85 && tau < 1.6 ? Math.sin(Math.PI * (tau - 0.85) / 0.75) : 0;
        // subspace (after the shots are dropped) and the features it replays
        if (sub > 0) {
          ctx.save(); ctx.translate(cl.c[0], cl.c[1]); ctx.rotate(cl.rot);
          ctx.beginPath(); ctx.ellipse(0, 0, 13, 4.5, 0, 0, TAU); ctx.strokeStyle = hexa(cl.col, 0.55 * sub); ctx.lineWidth = 0.8; ctx.stroke();
          ctx.fillStyle = hexa(cl.col, 0.07 * sub); ctx.fill();
          line(ctx, -13, 0, 13, 0, hexa(cl.col, 0.25 * sub), 0.6, [1.5, 2]);
          ctx.globalCompositeOperation = 'lighter';
          for (var n = 0; n < 6; n++) {
            var ph = T * 0.9 + n / 6 + k * 0.13, life = ph % 1, idx = Math.floor(ph);
            dot(ctx, (noise(idx, n, k) * 2 - 1) * 11, (noise(idx, n, k + 9) * 2 - 1) * 3, 1.1, hexa(cl.col, 0.85 * Math.sin(Math.PI * life) * sub));
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.restore();
        }
        // the few shots fly in, then fade once the class is summarised
        cl.shots.forEach(function (sh, i) {
          var fly = ease(clamp((tau - i * 0.06) / 0.7, 0, 1)), a = 1 - sub;
          if (a <= 0) return;
          var p = quad([-4, sh.y0], [lerp(-4, sh.x, 0.5), (sh.y0 + sh.y) / 2 + sh.bend], [sh.x, sh.y], fly);
          if (fly < 1) { var p2 = quad([-4, sh.y0], [lerp(-4, sh.x, 0.5), (sh.y0 + sh.y) / 2 + sh.bend], [sh.x, sh.y], Math.max(0, fly - 0.12)); line(ctx, p2[0], p2[1], p[0], p[1], hexa(cl.col, 0.6 * a), 1); }
          dot(ctx, p[0], p[1], 1.6, hexa(cl.col, a));
        });
        // unlabelled queries pull the prototype into place along transport lines
        if (ref > 0) cl.qs.forEach(function (qp) { line(ctx, qp[0], qp[1], cl.c[0], cl.c[1], hexa(P.cream, 0.35 * ref), 0.6); dot(ctx, qp[0], qp[1], 1.1, hexa(P.cream, 0.8 * ref)); });
        if (proto > 0) {
          var pulse = k === active ? 0.5 + 0.5 * Math.sin(T * 4) : 0;
          ctx.globalCompositeOperation = 'lighter'; glow(ctx, cl.c[0], cl.c[1], 7 + 3 * pulse, cl.col, 0.6 * proto); ctx.globalCompositeOperation = 'source-over';
          ctx.save(); ctx.translate(cl.c[0], cl.c[1]); ctx.rotate(Math.PI / 4); ctx.fillStyle = hexa(cl.col, proto); ctx.fillRect(-2.2, -2.2, 4.4, 4.4); ctx.restore();
          dot(ctx, cl.c[0], cl.c[1], 0.9, hexa(P.cream, proto));
        }
      });
      // session timeline
      var y = 90, x0 = 32, gx = 24, i;
      line(ctx, x0, y, x0 + gx * 4, y, hexa(P.dim, 0.25), 0.8);
      if (active > 0) line(ctx, x0, y, x0 + gx * active, y, hexa(P.coral, 0.6), 1);
      for (i = 0; i < 5; i++) {
        var cl2 = s.classes[i], lit = i <= active;
        if (lit) { glow(ctx, x0 + gx * i, y, i === active ? 6 : 4, cl2.col, 0.5); dot(ctx, x0 + gx * i, y, 2, cl2.col); }
        else ring(ctx, x0 + gx * i, y, 1.8, hexa(P.dim, 0.4), 0.7);
      }
      ctx.globalAlpha = 1;
    }
  };

  /* ---------- harness ---------- */
  var items = [], running = false, paused = false, staticMode = reduce || fixedT !== null;
  window.__animErrors = [];

  function sizeItem(it) {
    var r = it.el.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    it.dpr = Math.min(window.devicePixelRatio || 1, 2); it.w = w; it.h = h;
    it.cv.width = Math.round(w * it.dpr); it.cv.height = Math.round(h * it.dpr);
    it.first = true;
  }
  function drawFrame(it, dt) {
    var ctx = it.ctx, A1 = it.A, s = Math.max(it.w / W, it.h / H), ox = (it.w - W * s) / 2, oy = (it.h - H * s) / 2;
    ctx.setTransform(it.dpr * s, 0, 0, it.dpr * s, it.dpr * ox, it.dpr * oy);
    ctx.save(); ctx.beginPath(); ctx.rect(-2, -2, W + 4, H + 4); ctx.clip();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = it.first || A1.fade >= 1 ? PLATE : 'rgba(18,12,22,' + A1.fade + ')'; ctx.fillRect(-2, -2, W + 4, H + 4);
    it.first = false;
    var t = it.time % A1.period;
    try { A1.draw(ctx, it.st, t, dt, t / A1.period, it.time); }
    catch (e) { if (!it.err) { it.err = true; window.__animErrors.push(it.key + ': ' + e.message); if (window.console) console.warn('paper-anims', it.key, e); } }
    ctx.restore();
  }
  function renderStatic(it) {
    it.st = it.A.init(rng(hash(it.key)));
    it.time = fixedT !== null ? fixedT : it.A.still;
    it.first = true;
    drawFrame(it, 1 / 60);
  }
  function frame(now) {
    var any = false;
    if (paused) { running = false; return; }
    items.forEach(function (it) {
      if (!it.visible) { it.last = now; return; }
      any = true;
      var dt = clamp((now - it.last) / 1000, 0, 0.05) * it.speed; it.last = now; it.time += dt;
      drawFrame(it, dt);
    });
    if (any) requestAnimationFrame(frame); else running = false;
  }
  function kick() { if (!running && !paused && !staticMode) { running = true; requestAnimationFrame(frame); } }
  // used while the Camtek dialog covers the page
  window.__pausePaperAnims = function (p) { paused = !!p; if (!paused) { var now = performance.now(); items.forEach(function (it) { it.last = now; }); kick(); } };

  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { var it = e.target.__anim; if (!it) return; it.visible = e.isIntersecting; if (it.visible) { if (staticMode) renderStatic(it); else { it.last = performance.now(); kick(); } } });
  }, { rootMargin: '160px 0px' }) : null;
  var ro = 'ResizeObserver' in window ? new ResizeObserver(function (entries) {
    entries.forEach(function (e) { var it = e.target.__anim; if (it) { sizeItem(it); if (staticMode || !running) renderStatic(it); } });
  }) : null;

  function setup(el) {
    var key = el.getAttribute('data-anim'), A1 = A[key];
    if (!A1) return;
    var cv = document.createElement('canvas'); cv.className = 'anim-canvas'; cv.setAttribute('aria-hidden', 'true');
    var r = rng(hash(key)), st;
    try { st = A1.init(r); } catch (e) { window.__animErrors.push(key + ' init: ' + e.message); return; }
    el.appendChild(cv); el.classList.add('anim');
    var it = { key: key, el: el, cv: cv, ctx: cv.getContext('2d'), A: A1, st: st, w: 0, h: 0, dpr: 1, visible: !io, time: A1.still, last: performance.now(), speed: 1, first: true };
    el.__anim = it; items.push(it); sizeItem(it);
    var card = el.closest('.pub') || el;
    card.addEventListener('pointerenter', function () { it.speed = 1.8; });
    card.addEventListener('pointerleave', function () { it.speed = 1; });
    if (io) io.observe(el); else if (staticMode) renderStatic(it);
    if (ro) ro.observe(el);
  }
  function start() { document.querySelectorAll('.pub-thumb[data-anim]').forEach(setup); if (!io) kick(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
