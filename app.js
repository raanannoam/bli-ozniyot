// בלי אוזניות – שלב 1: מטרונום, הקלטה עם הקדמה, ניגון.
// ציר הזמן של השיר נמדד בשניות: 0 = תחילת תיבה 1.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ---------- נתונים קבועים ----------
  var SOUNDS = {
    wood:    { name: 'בלוק עץ', file: 'wood',   rate: { base: 1.0, mid: 1.12, top: 1.26 } },
    lowwood: { name: 'עץ נמוך', file: 'wood2',  rate: { base: 0.6, mid: 0.67, top: 0.75 } },
    shaker:  { name: 'שייקר',   file: 'shaker', rate: { base: 1.0, mid: 1.06, top: 1.12 } },
    claves:  { name: 'קלאבס',   file: 'claves', rate: { base: 1.0, mid: 1.12, top: 1.26 } }
  };
  var SOUND_ORDER = ['wood', 'lowwood', 'shaker', 'claves'];
  var LEVEL_GAIN = { base: 0.7, mid: 0.85, top: 1.0 };
  var METERS = ['2/4', '3/4', '4/4', '5/4', '7/4', '5/8', '6/8', '7/8', '9/8', '10/8', '12/8'];
  var GROUPS = { '5/8': [3, 2], '6/8': [3, 3], '7/8': [2, 2, 3], '9/8': [3, 2, 2, 2], '10/8': [3, 3, 2, 2], '12/8': [3, 3, 3, 3] };
  var LOOKAHEAD = 0.15;   // כמה שניות קדימה מתזמנים קליקים
  var START_DELAY = 0.12; // זמן התארגנות לפני שהשיר "מתחיל לזוז"

  // ---------- מצב ----------
  var S = {
    bpm: 92, meter: '4/4', pre: 1, sound: 'wood', clickOn: true,
    clickVol: 0.8, takeVol: 0.9,
    mode: 'idle',          // idle | play | rec
    cursorBar: 0,          // נקודת ההתחלה, במספר תיבה (0 = תיבה 1)
    take: null,            // { data, sr, start, punch, latency }
    stoppedAt: 0           // מיקום הסמן הלבן כשהכול עצור
  };

  var ctx = null, clickBus, takeBus, buffers = {};
  var recNode = null, micReady = false, chunks = [];
  var songT0 = 0, nextBeat = 0, schedTimer = null, takeSrc = null, recFrom = 0, recClicks = [];
  var wakeLock = null, peakHold = 0;

  // ---------- חישובי קצב ----------
  function parts() { var p = S.meter.split('/'); return { n: +p[0], d: +p[1] }; }
  function beatDur() { return (parts().d === 8 ? 30 : 60) / S.bpm; } // הקצב תמיד ברבעים
  function barDur() { return beatDur() * parts().n; }
  function pattern() {
    var n = parts().n, p = [];
    for (var i = 0; i < n; i++) p.push(i === 0 ? 'top' : 'base');
    var g = GROUPS[S.meter];
    if (g) { var at = 0; g.forEach(function (len, i) { if (i > 0) p[at] = 'mid'; at += len; }); }
    return p;
  }
  function cursorSec() { return S.cursorBar * barDur(); }
  function songNow() { return ctx ? ctx.currentTime - songT0 : 0; }

  // ---------- שמע ----------
  var WORKLET = [
    'class Rec extends AudioWorkletProcessor {',
    '  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; this.t = 0; this.peak = 0; }',
    '  process(inputs) {',
    '    var ch = inputs[0] && inputs[0][0];',
    '    if (!ch) return true;',
    '    if (this.n === 0) this.t = currentTime;',
    '    for (var i = 0; i < ch.length; i++) {',
    '      var v = ch[i]; this.buf[this.n++] = v;',
    '      var a = v < 0 ? -v : v; if (a > this.peak) this.peak = a;',
    '      if (this.n === this.buf.length) {',
    '        this.port.postMessage({ t: this.t, d: this.buf, p: this.peak }, [this.buf.buffer]);',
    '        this.buf = new Float32Array(2048); this.n = 0; this.peak = 0;',
    '        this.t = currentTime + (i + 1) / sampleRate;',
    '      }',
    '    }',
    '    return true;',
    '  }',
    '}',
    "registerProcessor('rec', Rec);"
  ].join('\n');

  async function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    try { ctx = new AC({ latencyHint: 'interactive', sampleRate: 48000 }); }
    catch (e) { ctx = new AC({ latencyHint: 'interactive' }); }
    clickBus = ctx.createGain(); clickBus.gain.value = S.clickVol; clickBus.connect(ctx.destination);
    takeBus = ctx.createGain(); takeBus.gain.value = S.takeVol; takeBus.connect(ctx.destination);
    await Promise.all(SOUND_ORDER.map(function (k) {
      var f = SOUNDS[k].file;
      return fetch('sounds/' + f + '.wav').then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return ctx.decodeAudioData(ab); })
        .then(function (b) { buffers[f] = b; });
    }));
    var url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    if (ctx.state === 'suspended') await ctx.resume();
  }

  async function initMic() {
    if (micReady) return;
    var stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    });
    var src = ctx.createMediaStreamSource(stream);
    recNode = new AudioWorkletNode(ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    var sink = ctx.createGain(); sink.gain.value = 0;
    src.connect(recNode); recNode.connect(sink); sink.connect(ctx.destination);
    recNode.port.onmessage = function (e) {
      if (e.data.p > peakHold) peakHold = e.data.p;
      if (S.mode === 'rec') chunks.push(e.data);
    };
    micReady = true;
  }

  function playClick(when, level) {
    var b = buffers[SOUNDS[S.sound].file];
    if (!b) return;
    var src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = SOUNDS[S.sound].rate[level];
    var g = ctx.createGain(); g.gain.value = LEVEL_GAIN[level];
    src.connect(g); g.connect(clickBus);
    src.start(when);
  }

  function scheduler() {
    var pat = pattern(), bd = beatDur(), n = pat.length;
    var horizon = songNow() + LOOKAHEAD;
    while (nextBeat * bd < horizon) {
      var t = nextBeat * bd;
      var idx = ((nextBeat % n) + n) % n;
      // בהקדמה הקליק תמיד מתנגן: הוא משמש גם ללמידה ולמדידת ההשהיה
      var inPre = S.mode === 'rec' && t < cursorSec() - 1e-6;
      if (S.clickOn || inPre) {
        playClick(songT0 + t, pat[idx]);
        if (S.mode === 'rec') recClicks.push({ t: t, pos: idx, pre: inPre });
      }
      nextBeat++;
    }
  }

  // ---------- תחבורה ----------
  function startTransport(fromSec) {
    songT0 = ctx.currentTime + START_DELAY - fromSec;
    nextBeat = Math.ceil(fromSec / beatDur() - 1e-6);
    scheduler();
    schedTimer = setInterval(scheduler, 25);
  }

  function takeData(tk) { return tk.useClean && tk.clean ? tk.clean : tk.data; }

  function playTake(fromSec) {
    var tk = S.take;
    if (!tk) return;
    var playStart = tk.start + tk.latencyShift; // זמן השיר של הדגימה הראשונה, אחרי תיקון השהיה
    var punchOffset = (tk.punch - playStart);   // מנגנים רק מנקודת ההתחלה, בלי ההקדמה
    var begin = Math.max(fromSec, tk.punch);
    var offset = punchOffset + (begin - tk.punch);
    var dur = tk.data.length / tk.sr;
    if (offset >= dur) return;
    var buf = ctx.createBuffer(1, tk.data.length, tk.sr);
    buf.copyToChannel(takeData(tk), 0);
    takeSrc = ctx.createBufferSource();
    takeSrc.buffer = buf;
    takeSrc.connect(takeBus);
    takeSrc.start(songT0 + begin, offset);
  }

  async function play() {
    await initAudio();
    S.mode = 'play';
    var from = S.stoppedAt;
    startTransport(from);
    playTake(from);
    render();
  }

  async function record() {
    try {
      await initAudio();
      await initMic();
    } catch (e) {
      setStatus('אין גישה למיקרופון. צריך לאשר את ההרשאה בדפדפן.');
      return;
    }
    chunks = []; recClicks = [];
    recFrom = cursorSec() - S.pre * barDur();
    S.mode = 'rec';
    startTransport(recFrom);
    requestWake();
    render();
  }

  function stop() {
    clearInterval(schedTimer); schedTimer = null;
    if (takeSrc) { try { takeSrc.stop(); } catch (e) {} takeSrc = null; }
    var wasRec = S.mode === 'rec';
    var pos = songNow();
    S.mode = 'idle';
    if (wasRec) {
      finishRecording();
      S.stoppedAt = cursorSec();
    } else {
      S.stoppedAt = Math.max(0, pos);
      setStatus('');
    }
    releaseWake();
    render();
  }

  function finishRecording() {
    if (!chunks.length) { setStatus('לא הוקלט כלום'); return; }
    var total = chunks.reduce(function (a, c) { return a + c.d.length; }, 0);
    var data = new Float32Array(total), at = 0;
    chunks.forEach(function (c) { data.set(c.d, at); at += c.d.length; });
    var start = chunks[0].t - songT0;    // זמן השיר של הדגימה הראשונה, כפי שהמחשב רשם אותה
    var take = { data: data, sr: ctx.sampleRate, start: start, punch: cursorSec(), preFrom: recFrom, latencyShift: 0, measured: null };
    var lat = measureLatency(take), prev = lastLatency();
    if (lat !== null) { take.measured = lat; take.latencyShift = -lat; rememberLatency(lat); }
    else if (prev !== null) { take.measured = prev; take.latencyShift = -prev; }
    S.take = take;
    chunks = [];
    $('save-btn').disabled = false;
    var clicksUsed = recClicks.slice(); recClicks = [];
    if (take.measured !== null) setTimeout(function () { cleanTake(take, clicksUsed); }, 30);
    if (lat !== null || prev !== null) setStatus('מסיר את הקליק מההקלטה…');
    else setStatus('ההקלטה נשמרה, אבל לא שמעתי את הקליק בהקדמה, אז ההשהיה לא תוקנה. נסו להקדמה של 2 תיבות, או להגביר.');
  }

  // מוריד את הקליק מההקלטה, בשני שלבים (dsp.js)
  function cleanTake(tk, clicks) {
    var lat = tk.measured;
    var list = clicks.map(function (c) {
      return { idx: Math.round((c.t + lat - tk.start) * tk.sr), pos: c.pos, pre: c.pre };
    });
    try {
      var r = window.ClickDSP.removeClicks(tk.data, tk.sr, list, {});
      if (r.ok) {
        tk.clean = r.clean; tk.useClean = true;
        setStatus('הקליק הוסר מההקלטה. אפשר להשוות למקור בכפתור למעלה.');
      } else setStatus('לא הצלחתי ללמוד את הקליק מההקדמה, אז הוא נשאר בהקלטה.');
    } catch (e) {
      setStatus('משהו השתבש בהסרת הקליק, ההקלטה המקורית נשמרה.');
    }
    render();
  }

  // מודד כמה זמן לוקח לקליק להגיע מהרמקול למיקרופון.
  // ממצע את כל קליקי ההקדמה יחד, כך שגם קליק חלש בולט מעל הרעש.
  function measureLatency(tk) {
    var bd = beatDur(), sr = tk.sr;
    var STEP = Math.round(sr / 2000);            // רזולוציה של חצי אלפית שנייה
    var maxLag = Math.min(1.0, bd * 0.95);
    var nLag = Math.floor(maxLag * 2000);
    // מעטפת: האנרגיה הממוצעת בכל חצי אלפית שנייה
    var nEnv = Math.floor(tk.data.length / STEP), env = new Float32Array(nEnv);
    for (var j = 0; j < nEnv; j++) {
      var m = 0;
      for (var i = j * STEP, e = i + STEP; i < e; i++) m += tk.data[i] * tk.data[i];
      env[j] = m / STEP;
    }
    // פרופיל ממוצע: מה המיקרופון שמע בכל השהיה אפשרית אחרי כל קליק בהקדמה
    var profile = new Float32Array(nLag), used = 0;
    for (var b = Math.ceil(tk.preFrom / bd - 1e-6); b * bd < tk.punch - 1e-6; b++) {
      var j0 = Math.round((b * bd - tk.start) * 2000);
      if (j0 < 0 || j0 + nLag >= nEnv) continue;
      for (var L = 0; L < nLag; L++) profile[L] += env[j0 + L];
      used++;
    }
    if (!used) return null;
    var peak = 0, peakAt = 0;
    for (L = 0; L < nLag; L++) { profile[L] /= used; if (profile[L] > peak) { peak = profile[L]; peakAt = L; } }
    var sorted = Array.prototype.slice.call(profile).sort(function (x, y) { return x - y; });
    var median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
    if (peak < median * 3) return null;          // לא ברור מספיק
    // תחילת הקליק: הנקודה האחרונה לפני השיא שבה הוא עוד היה מתחת ל־30% (מעל הרעש)
    var th = median + (peak - median) * 0.3;
    var onset = peakAt;
    while (onset > 0 && profile[onset - 1] >= th) onset--;
    return onset / 2000;
  }

  function lastLatency() { try { var v = parseFloat(localStorage.getItem('bli-latency')); return isNaN(v) ? null : v; } catch (e) { return null; } }
  function rememberLatency(v) { try { localStorage.setItem('bli-latency', String(v)); } catch (e) {} }

  // ---------- שמירה כקובץ ----------
  function wavFloat32(data, sr) {
    var buf = new ArrayBuffer(44 + data.length * 4), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + data.length * 4, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true);
    str(36, 'data'); v.setUint32(40, data.length * 4, true);
    new Float32Array(buf, 44).set(data);
    return new Blob([buf], { type: 'audio/wav' });
  }

  async function saveTake() {
    if (!S.take) return;
    var d = new Date();
    var name = 'bli-ozniyot-' + S.bpm + 'bpm-' + S.meter.replace('/', '-') + '-' +
      d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' +
      String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.wav';
    var blob = wavFloat32(takeData(S.take), S.take.sr); // נשמר מה שנשמע: נקי או מקור. כולל את ההקדמה
    var file = new File([blob], name, { type: 'audio/wav' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ---------- מסך דלוק ----------
  async function requestWake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  function releaseWake() { if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }

  // ---------- ציר הזמן ----------
  var cv = $('timeline'), wrap = $('timeline-wrap'), g2 = cv.getContext('2d');
  var layout = { pxPerBar: 80, bars: 8, padTop: 26 };

  function songBars() {
    var end = cursorSec() + barDur() * 2;
    if (S.take) end = Math.max(end, S.take.start + S.take.latencyShift + S.take.data.length / S.take.sr);
    if (S.mode !== 'idle') end = Math.max(end, songNow() + barDur());
    return Math.max(8, Math.ceil(end / barDur()) + 1);
  }

  function sizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var h = wrap.clientHeight;
    layout.bars = songBars();
    layout.pxPerBar = Math.max(70, wrap.clientWidth / 8);
    var w = Math.max(wrap.clientWidth, layout.bars * layout.pxPerBar);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h };
  }

  function xOf(sec) { return sec / barDur() * layout.pxPerBar; }

  function draw() {
    var sz = sizeCanvas(), w = sz.w, h = sz.h;
    var top = layout.padTop, n = parts().n;
    g2.clearRect(0, 0, w, h);
    // הקדמה
    var preX0 = xOf(Math.max(0, cursorSec() - S.pre * barDur())), preX1 = xOf(cursorSec());
    g2.save();
    g2.beginPath(); g2.rect(preX0, 0, preX1 - preX0, h); g2.clip();
    g2.strokeStyle = 'rgba(255,255,255,0.07)'; g2.lineWidth = 6;
    for (var s = preX0 - h; s < preX1 + h; s += 12) { g2.beginPath(); g2.moveTo(s, h); g2.lineTo(s + h, 0); g2.stroke(); }
    g2.restore();
    // קווי תיבות ופעמות
    for (var b = 0; b < layout.bars; b++) {
      var x = b * layout.pxPerBar;
      g2.fillStyle = 'rgba(255,255,255,0.11)'; g2.fillRect(x, 0, 1, h);
      for (var k = 1; k < n; k++) { g2.fillStyle = 'rgba(255,255,255,0.035)'; g2.fillRect(x + k * layout.pxPerBar / n, top, 1, h - top); }
      g2.fillStyle = '#8C939C'; g2.font = '500 11px "Space Grotesk", sans-serif'; g2.fillText(String(b + 1), x + 6, 16);
    }
    // ההקלטה
    var acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#6fe0a8';
    var trackTop = top + 8, trackH = h - top - 16;
    if (S.take) {
      var tk = S.take, st = tk.start + tk.latencyShift, td = takeData(tk);
      var x0 = xOf(tk.punch), x1 = xOf(st + tk.data.length / tk.sr);
      if (x1 > x0) {
        g2.fillStyle = 'hsla(150,60%,45%,0.18)';
        roundRect(x0 + 1, trackTop, x1 - x0 - 2, trackH, 10); g2.fill();
        g2.strokeStyle = acc; g2.lineWidth = 1.5; g2.stroke();
        g2.fillStyle = acc;
        var mid = trackTop + trackH / 2, spp = tk.sr * barDur() / layout.pxPerBar;
        for (var px = Math.ceil(x0) + 3; px < x1 - 3; px += 2) {
          var i0 = Math.floor((px / layout.pxPerBar * barDur() - st) * tk.sr), i1 = i0 + Math.ceil(spp * 2), pk = 0;
          for (var i = Math.max(0, i0); i < Math.min(td.length, i1); i++) { var a = Math.abs(td[i]); if (a > pk) pk = a; }
          var hh = Math.max(1, Math.min(1, pk * 1.4) * (trackH / 2 - 6));
          g2.fillRect(px, mid - hh, 1.5, hh * 2);
        }
      }
    }
    // נקודת ההתחלה
    var cx = xOf(cursorSec());
    g2.fillStyle = '#FF5A6A'; g2.fillRect(cx - 1, 0, 2, h);
    g2.fillStyle = 'rgba(238,51,72,0.9)'; roundRect(cx + 4, 2, 44, 17, 4); g2.fill();
    g2.fillStyle = '#fff'; g2.font = '500 10px Heebo, sans-serif'; g2.textAlign = 'center'; g2.fillText('התחלה', cx + 26, 14); g2.textAlign = 'start';
    // סמן ניגון
    var pos = S.mode === 'idle' ? S.stoppedAt : songNow();
    var px2 = xOf(Math.max(pos, S.mode === 'rec' ? recFrom : 0));
    g2.fillStyle = '#fff'; g2.shadowColor = 'rgba(255,255,255,0.6)'; g2.shadowBlur = 8;
    g2.fillRect(px2 - 1, 0, 2, h); g2.shadowBlur = 0;
    // גלילה אוטומטית אחרי הסמן
    if (S.mode !== 'idle') {
      var vw = wrap.clientWidth;
      if (px2 > wrap.scrollLeft + vw * 0.8 || px2 < wrap.scrollLeft) wrap.scrollLeft = Math.max(0, px2 - vw * 0.3);
    }
  }
  function roundRect(x, y, w, h, r) {
    g2.beginPath(); g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r);
    g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath();
  }

  // נגיעה בציר הזמן קובעת את נקודת ההתחלה, צמודה לתחילת תיבה
  var downX = null;
  cv.addEventListener('pointerdown', function (e) { downX = e.clientX; });
  cv.addEventListener('pointerup', function (e) {
    if (downX === null || Math.abs(e.clientX - downX) > 8 || S.mode !== 'idle') { downX = null; return; }
    downX = null;
    var r = cv.getBoundingClientRect();
    var bar = Math.round((e.clientX - r.left) / layout.pxPerBar);
    S.cursorBar = Math.max(0, bar);
    S.stoppedAt = cursorSec();
    setStatus('ההקלטה תתחיל בתיבה ' + (S.cursorBar + 1));
    render();
  });

  // ---------- גלגל קצב ----------
  var drum = $('drum');
  function renderDrum() {
    var html = '';
    for (var k = -2; k <= 2; k++) {
      var v = S.bpm + k;
      html += '<span class="d' + Math.abs(k) + '">' + (v >= 40 && v <= 240 ? v : '') + '</span>';
    }
    drum.innerHTML = html;
    drum.setAttribute('aria-valuenow', S.bpm);
  }
  function setBpm(v) {
    v = Math.max(40, Math.min(240, Math.round(v)));
    if (v === S.bpm) return;
    if (S.take && S.mode === 'idle' && !S.warnedTempo) {
      S.warnedTempo = true;
      setStatus('שימו לב: ההקלטה לא נמתחת עם הקצב, אז היא כבר לא תתאים לתיבות.');
    }
    S.bpm = v; renderDrum(); draw();
  }
  var dragX = null, dragBpm = 0;
  drum.addEventListener('pointerdown', function (e) { dragX = e.clientX; dragBpm = S.bpm; drum.setPointerCapture(e.pointerId); });
  drum.addEventListener('pointermove', function (e) { if (dragX !== null) setBpm(dragBpm - (e.clientX - dragX) / 10); });
  drum.addEventListener('pointerup', function () { dragX = null; });
  drum.addEventListener('pointercancel', function () { dragX = null; });
  drum.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setBpm(S.bpm - 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setBpm(S.bpm + 1);
  });

  // ---------- כפתורים ----------
  $('click-btn').addEventListener('click', function () { S.clickOn = !S.clickOn; render(); });
  $('meter-btn').addEventListener('click', function () {
    if (S.mode !== 'idle') return;
    S.meter = METERS[(METERS.indexOf(S.meter) + 1) % METERS.length];
    if (S.take) setStatus('שימו לב: שינוי משקל לא משנה את ההקלטה, אז היא כבר לא תתאים לתיבות.');
    render();
  });
  $('pre-btn').addEventListener('click', function () { if (S.mode === 'idle') { S.pre = S.pre === 1 ? 2 : 1; render(); } });
  $('sound-btn').addEventListener('click', async function () {
    S.sound = SOUND_ORDER[(SOUND_ORDER.indexOf(S.sound) + 1) % SOUND_ORDER.length];
    render();
    if (S.mode === 'idle') { await initAudio(); playClick(ctx.currentTime + 0.02, 'top'); }
  });
  $('rec-btn').addEventListener('click', function () { if (S.mode === 'rec') stop(); else { if (S.mode === 'play') stop(); record(); } });
  $('play-btn').addEventListener('click', function () { if (S.mode === 'play') stop(); else { if (S.mode === 'rec') stop(); play(); } });
  $('to-cursor').addEventListener('click', function () { var was = S.mode; if (was !== 'idle') stop(); S.stoppedAt = cursorSec(); if (was === 'play') play(); else render(); });
  $('to-start').addEventListener('click', function () { var was = S.mode; if (was !== 'idle') stop(); S.stoppedAt = 0; wrap.scrollLeft = 0; if (was === 'play') play(); else render(); });
  $('save-btn').addEventListener('click', saveTake);
  $('ab-btn').addEventListener('click', function () {
    if (!S.take || !S.take.clean) return;
    var was = S.mode === 'play', pos = songNow();
    if (was) stop();
    S.take.useClean = !S.take.useClean;
    if (was) { S.stoppedAt = Math.max(0, pos); play(); } else render();
  });
  $('click-vol').addEventListener('input', function (e) { S.clickVol = e.target.value / 100; if (clickBus) clickBus.gain.setTargetAtTime(S.clickVol, ctx.currentTime, 0.01); });
  $('take-vol').addEventListener('input', function (e) { S.takeVol = e.target.value / 100; if (takeBus) takeBus.gain.setTargetAtTime(S.takeVol, ctx.currentTime, 0.01); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && S.mode === 'play') stop(); });

  function setStatus(t) { $('status').textContent = t; }

  function render() {
    var app = $('app');
    app.classList.toggle('recording', S.mode === 'rec');
    app.classList.toggle('playing', S.mode === 'play');
    $('click-btn').setAttribute('aria-pressed', String(S.clickOn));
    $('meter-btn').textContent = S.meter;
    $('pre-val').textContent = S.pre;
    $('sound-name').textContent = SOUNDS[S.sound].name;
    $('rec-btn').setAttribute('aria-label', S.mode === 'rec' ? 'עצירת הקלטה' : 'הקלטה');
    $('play-btn').setAttribute('aria-label', S.mode === 'play' ? 'השהיה' : 'ניגון');
    if (S.mode === 'rec') setStatus('הקדמה של ' + (S.pre === 1 ? 'תיבה אחת' : '2 תיבות') + ', ואז הקלטה מתיבה ' + (S.cursorBar + 1) + ' עד שעוצרים');
    else if (S.mode === 'play') setStatus('מנגן');
    $('latency').textContent = S.take && S.take.measured !== null ? 'השהיה: ' + Math.round(S.take.measured * 1000) + 'ms' : '';
    var ab = $('ab-btn');
    ab.hidden = !(S.take && S.take.clean);
    if (S.take && S.take.clean) { ab.setAttribute('aria-pressed', String(S.take.useClean)); ab.textContent = S.take.useClean ? 'קליק הוסר' : 'מקור, עם קליק'; }
    renderDrum();
    draw();
  }

  // ---------- לולאת תצוגה ----------
  var fill = $('meter-fill'), clip = $('clip'), clipUntil = 0, shown = 0;
  function frame() {
    var p = peakHold; peakHold = 0;
    shown = Math.max(p, shown * 0.88);
    var db = shown > 0 ? 20 * Math.log10(shown) : -60;
    var pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
    fill.style.height = pct + '%';
    fill.style.setProperty('--meter-h', fill.parentElement.clientHeight + 'px');
    if (p >= 0.98) clipUntil = performance.now() + 1500;
    clip.classList.toggle('on', performance.now() < clipUntil);
    if (S.mode !== 'idle') {
      if (S.mode === 'rec' && songNow() >= cursorSec() && $('status').textContent.indexOf('מקליט') !== 0) setStatus('מקליט… מתיבה ' + (S.cursorBar + 1));
      draw();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', draw);
  render();
  requestAnimationFrame(frame);
})();
