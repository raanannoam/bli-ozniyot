// החסרת קליק – שני שלבים.
// שלב 1: לומדים תבנית לכל פעמה מקליקי ההקדמה, ומחסירים אותה בכל קליק (יישור תת־דגימתי + התאמת עוצמה).
// שלב 2: מנמיכים את השארית רק ברגעי הקליק ורק בתדרים שלו.
(function (root) {
  'use strict';

  var PRE_MS = 5, LEN_MS = 260, MAXLAG_MS = 1.5, FIT_MS = 40;

  // ---------- כלים ----------
  function sincShift(x, d) {
    // מזיז את x ב־d דגימות (שבר), בעזרת אינטרפולציית sinc עם חלון
    var n = x.length, out = new Float32Array(n), H = 16;
    var di = Math.floor(d), f = d - di;
    var taps = new Float32Array(2 * H + 1), sum = 0;
    for (var k = -H; k <= H; k++) {
      var t = k + f;
      var s = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      var w = 0.5 + 0.5 * Math.cos(Math.PI * t / (H + 1));
      taps[k + H] = s * w; sum += s * w;
    }
    for (k = 0; k < taps.length; k++) taps[k] /= sum;
    // out[i] ≈ x(i - d)
    for (var i = 0; i < n; i++) {
      var acc = 0, base = i - di;
      for (k = -H; k <= H; k++) {
        var j = base + k;
        if (j >= 0 && j < n) acc += x[j] * taps[k + H];
      }
      out[i] = acc;
    }
    return out;
  }

  function bestLag(x, s, tpl, maxLag) {
    // מחפש את ההזזה (בדגימות, כולל שבר) שבה tpl הכי מתאים ל־x החל מ־s
    var best = -Infinity, bi = 0, c = new Float64Array(2 * maxLag + 1);
    for (var L = -maxLag; L <= maxLag; L++) {
      var acc = 0, o = s + L;
      for (var i = 0; i < tpl.length; i++) acc += x[o + i] * tpl[i];
      c[L + maxLag] = acc;
      if (acc > best) { best = acc; bi = L + maxLag; }
    }
    var off = 0;
    if (bi > 0 && bi < c.length - 1) {
      var a = c[bi - 1], b = c[bi], cc = c[bi + 1], den = a - 2 * b + cc;
      if (den !== 0) off = 0.5 * (a - cc) / den;
    }
    return bi - maxLag + off;
  }

  function slice(x, s, n) {
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) { var j = s + i; out[i] = (j >= 0 && j < x.length) ? x[j] : 0; }
    return out;
  }

  // ---------- FFT ----------
  function fft(re, im) {
    var n = re.length, i, j = 0, k, len;
    for (i = 1; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var ar = re[i + k], ai = im[i + k];
          var br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          var bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function ifft(re, im) {
    for (var i = 0; i < im.length; i++) im[i] = -im[i];
    fft(re, im);
    var n = re.length;
    for (i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
  }

  // ---------- שלב 1 ----------
  // clicks: [{ idx: מיקום תחילת הקליק בדגימות בתוך data, pos: מספר הפעמה בתיבה, pre: האם בהקדמה }]
  function stage1(data, sr, clicks, opts) {
    opts = opts || {};
    var PRE = Math.round(PRE_MS * sr / 1000), L = Math.round(LEN_MS * sr / 1000);
    var M = Math.round(MAXLAG_MS * sr / 1000), FIT = Math.round(FIT_MS * sr / 1000);
    var mu = opts.mu == null ? 0.25 : opts.mu, cth = opts.cth == null ? 0.97 : opts.cth;
    var y = Float32Array.from(data), est = new Float32Array(data.length);
    var tpls = {}, counts = {};

    // לימוד מההקדמה: ליישר כל קליק לקליק הראשון של אותה פעמה ולמצע
    clicks.forEach(function (c) {
      if (!c.pre) return;
      var s = c.idx - PRE;
      if (s - M < 0 || s + L + M > data.length) return;
      if (!tpls[c.pos]) { tpls[c.pos] = slice(data, s, L); counts[c.pos] = 1; return; }
      var lag = bestLag(data, s, tpls[c.pos], M);
      var seg = sincShift(slice(data, s - M, L + 2 * M), -lag).subarray(M, M + L);
      var t = tpls[c.pos], n = ++counts[c.pos];
      for (var i = 0; i < L; i++) t[i] += (seg[i] - t[i]) / n;
    });
    // פעמה שלא הופיעה בהקדמה: לוקחים ממוצע של כל הפעמות
    var any = Object.keys(tpls);
    if (!any.length) return { clean: y, est: est, ok: false };
    var avg = new Float32Array(L);
    any.forEach(function (k) { for (var i = 0; i < L; i++) avg[i] += tpls[k][i] / any.length; });

    clicks.forEach(function (c) {
      var tpl = tpls[c.pos] || avg;
      var s = c.idx - PRE;
      if (s - M < 0 || s + L + M > data.length) return;
      var lag = bestLag(data, s, tpl, M);
      var padded = new Float32Array(L + 2 * M); padded.set(tpl, M);
      var tsh = sincShift(padded, lag);
      var num = 0, den = 0;
      for (var i = 0; i < FIT + M; i++) { var v = data[s - M + i]; num += v * tsh[i]; den += tsh[i] * tsh[i]; }
      var g = den > 0 ? Math.max(0.7, Math.min(1.3, num / den)) : 1;
      for (i = 0; i < L + 2 * M; i++) { var j = s - M + i; y[j] -= g * tsh[i]; est[j] += g * tsh[i]; }
      // עדכון זהיר של התבנית, רק כשהקליק "נקי" (בלי כלי מעליו)
      if (!c.pre && tpls[c.pos] && mu > 0) {
        var obs = sincShift(slice(data, s - M, L + 2 * M), -lag).subarray(M, M + L);
        var oo = 0, tt = 0, ot = 0, T = tpls[c.pos];
        for (i = 0; i < L; i++) { var o = obs[i] / g; oo += o * o; tt += T[i] * T[i]; ot += o * T[i]; }
        if (ot / Math.sqrt(oo * tt + 1e-20) > cth) for (i = 0; i < L; i++) T[i] = (1 - mu) * T[i] + mu * obs[i] / g;
      }
    });
    return { clean: y, est: est, ok: true };
  }

  // ---------- שלב 2 ----------
  function stage2(y, est, opts) {
    opts = opts || {};
    // ברירת מחדל "חזק מאוד": נבדק על הקלטות אמיתיות, כ־51 דציבלים לקליק, ופגיעה זניחה בכלי
    var c = opts.c == null ? 0.1 : opts.c, beta = opts.beta == null ? 32 : opts.beta, floor = opts.floor == null ? 0.01 : opts.floor;
    var N = 1024, HOP = 256, nb = N / 2 + 1;
    var win = new Float32Array(N);
    for (var i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    var nF = Math.ceil((y.length + N) / HOP) + 1, off = N / 2;
    // מוצאים אילו מסגרות בכלל נוגעות בקליק
    var active = new Uint8Array(nF), any = false;
    for (var f = 0; f < nF; f++) {
      var s = f * HOP - off, e = 0;
      for (i = 0; i < N; i += 4) { var j = s + i; if (j >= 0 && j < est.length) e += est[j] * est[j]; }
      if (e > 1e-10) { active[f] = 1; any = true; }
    }
    if (!any) return Float32Array.from(y);
    // מרחיבים בזמן במסגרת אחת לכל צד
    var act = Uint8Array.from(active);
    for (f = 0; f < nF; f++) if (active[f]) { if (f > 0) act[f - 1] = 1; if (f < nF - 1) act[f + 1] = 1; }

    var Yr = [], Yi = [], Ep = [], G = [];
    for (f = 0; f < nF; f++) {
      if (!act[f]) { Yr.push(null); Yi.push(null); Ep.push(null); continue; }
      var yr = new Float64Array(N), yi = new Float64Array(N), er = new Float64Array(N), ei = new Float64Array(N);
      s = f * HOP - off;
      for (i = 0; i < N; i++) { j = s + i; if (j >= 0 && j < y.length) { yr[i] = y[j] * win[i]; er[i] = est[j] * win[i]; } }
      fft(yr, yi); fft(er, ei);
      var ep = new Float64Array(nb);
      for (var k = 0; k < nb; k++) ep[k] = er[k] * er[k] + ei[k] * ei[k];
      Yr.push(yr); Yi.push(yi); Ep.push(ep);
    }
    // הערכת השארית: עוצמת הקליק המשוער, מורחבת קצת בזמן ובתדר
    for (f = 0; f < nF; f++) {
      if (!act[f]) { G.push(null); continue; }
      var g = new Float64Array(nb);
      for (k = 0; k < nb; k++) {
        var r = 0;
        for (var df = -1; df <= 1; df++) {
          var ff = f + df; if (ff < 0 || ff >= nF || !Ep[ff]) continue;
          for (var dk = -1; dk <= 1; dk++) { var kk = k + dk; if (kk >= 0 && kk < nb && Ep[ff][kk] > r) r = Ep[ff][kk]; }
        }
        var p = Yr[f][k] * Yr[f][k] + Yi[f][k] * Yi[f][k];
        var v = 1 - beta * c * r / Math.max(p, 1e-12);
        g[k] = v < floor ? floor : (v > 1 ? 1 : v);
      }
      G.push(g);
    }
    // החלקה של הרווחים 3×3, כדי שלא יישמעו "בועות"
    var out = Float32Array.from(y), acc = new Float64Array(y.length + N), wsum = new Float64Array(y.length + N);
    for (f = 0; f < nF; f++) {
      if (!act[f]) continue;
      var gs = new Float64Array(nb);
      for (k = 0; k < nb; k++) {
        var sum = 0, cnt = 0;
        for (df = -1; df <= 1; df++) {
          ff = f + df;
          for (dk = -1; dk <= 1; dk++) {
            kk = k + dk; if (kk < 0 || kk >= nb) continue;
            sum += (ff >= 0 && ff < nF && G[ff]) ? G[ff][kk] : 1; cnt++;
          }
        }
        gs[k] = sum / cnt;
      }
      var re = Yr[f], im = Yi[f];
      for (k = 0; k < nb; k++) { re[k] *= gs[k]; im[k] *= gs[k]; if (k > 0 && k < N / 2) { re[N - k] *= gs[k]; im[N - k] *= gs[k]; } }
      ifft(re, im);
      s = f * HOP - off;
      for (i = 0; i < N; i++) { j = s + i; if (j >= 0 && j < y.length) { acc[j] += re[i] * win[i]; wsum[j] += win[i] * win[i]; } }
    }
    // מחברים: איפה שעובדו מסגרות, לוקחים את התוצאה; בשאר – המקור. מעבר רך בין השניים
    var cover = new Float64Array(y.length);
    for (f = 0; f < nF; f++) { if (!act[f]) continue; s = f * HOP - off; for (i = 0; i < N; i++) { j = s + i; if (j >= 0 && j < y.length) cover[j] += win[i] * win[i]; } }
    // סכום ריבועי חלון מלא בחפיפה של 75% הוא 1.5
    for (i = 0; i < y.length; i++) {
      if (wsum[i] > 1e-6) {
        var proc = acc[i] / wsum[i], wgt = Math.min(1, wsum[i] / 1.5);
        out[i] = wgt * proc + (1 - wgt) * y[i];
      }
    }
    return out;
  }

  function removeClicks(data, sr, clicks, opts) {
    var r = stage1(data, sr, clicks, opts);
    if (!r.ok) return { clean: Float32Array.from(data), ok: false };
    return { clean: stage2(r.clean, r.est, opts), stage1: r.clean, ok: true };
  }

  var api = { removeClicks: removeClicks, stage1: stage1, stage2: stage2, sincShift: sincShift, fft: fft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClickDSP = api;
})(this);
