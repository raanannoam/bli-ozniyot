// בלי אוזניות – שלב 1: מטרונום, הקלטה עם הקדמה, ניגון.
// ציר הזמן של השיר נמדד בשניות: 0 = תחילת תיבה 1.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // אם הדפדפן הביא דף ישן מהזיכרון יחד עם קוד חדש, טוענים מחדש פעם אחת
  var CODE_VERSION = '9';
  if (window.BLI_PAGE_VERSION !== CODE_VERSION) {
    var tried = false;
    try { tried = sessionStorage.getItem('bli-reload') === CODE_VERSION; sessionStorage.setItem('bli-reload', CODE_VERSION); } catch (e) {}
    if (!tried) { location.replace(location.pathname + '?v=' + CODE_VERSION + '&t=' + Date.now()); return; }
  }

  // ---------- נתונים קבועים ----------
  // ms: אורך הצליל עד שהוא דועך (נמדד). קצר יותר = קל יותר להסיר.
  // high: צליל גבוה, מתאים לכלים נמוכים (בס). low: צליל עמוק, מתאים לכלים גבוהים.
  var SOUNDS = {
    clap:      { name: 'מחיאת כף',    desc: 'יבש',               file: 'clap',      ms: 50,  high: true,  rate: { base: 1.0, mid: 1.08, top: 1.16 } },
    woodtight: { name: 'עץ קצר',      desc: 'בלוק עץ, זנב מקוצר', file: 'woodtight', ms: 55,  rate: { base: 1.0, mid: 1.12, top: 1.26 } },
    cabasa:    { name: 'קבסה',        desc: 'רחש גבוה',          file: 'cabasa',    ms: 80,  high: true,  rate: { base: 1.0, mid: 1.06, top: 1.12 } },
    cajon:     { name: 'קחון',        desc: 'מכה יבשה',          file: 'cajon',     ms: 90,  rate: { base: 1.0, mid: 1.1, top: 1.2 } },
    bongo:     { name: 'בונגו מושתק',  desc: 'חם ורך',            file: 'bongo',     ms: 90,  low: true,   rate: { base: 1.0, mid: 1.12, top: 1.26 } },
    claves:    { name: 'קלאבס',       desc: 'חד וברור',          file: 'claves',    ms: 185, high: true,  rate: { base: 1.0, mid: 1.12, top: 1.26 } },
    wood:      { name: 'בלוק עץ',     desc: 'קלאסי',             file: 'wood',      ms: 190, rate: { base: 1.0, mid: 1.12, top: 1.26 } },
    shaker:    { name: 'שייקר',       desc: 'רך ומוזיקלי',       file: 'shaker',    ms: 220, high: true,  rate: { base: 1.0, mid: 1.06, top: 1.12 } },
    lowwood:   { name: 'עץ נמוך',     desc: 'עמוק ורך',          file: 'wood2',     ms: 300, low: true,   rate: { base: 0.6, mid: 0.67, top: 0.75 } }
  };
  var SOUND_ORDER = ['clap', 'woodtight', 'cabasa', 'cajon', 'bongo', 'claves', 'wood', 'shaker', 'lowwood'];
  // כלים: prefer = איזה קליק עדיף. high = צליל גבוה (רחוק מהבס), low = צליל עמוק יותר (רחוק מכלים גבוהים)
  var INSTRUMENTS = [
    { k: 'guitar', name: 'גיטרה' }, { k: 'bass', name: 'בס', prefer: 'high' }, { k: 'voice', name: 'קול' },
    { k: 'drums', name: 'תופים' }, { k: 'perc', name: 'כלי הקשה', prefer: 'low' }, { k: 'keys', name: 'מקלדים' },
    { k: 'violin', name: 'כינור', prefer: 'low' }, { k: 'other', name: 'אחר' }
  ];
  var LEVEL_GAIN = { base: 0.7, mid: 0.85, top: 1.0 };
  var METERS = ['2/4', '3/4', '4/4', '5/4', '7/4', '5/8', '6/8', '7/8', '9/8', '10/8', '12/8'];
  var GROUPS = { '5/8': [3, 2], '6/8': [3, 3], '7/8': [2, 2, 3], '9/8': [3, 2, 2, 2], '10/8': [3, 3, 2, 2], '12/8': [3, 3, 3, 3] };
  var LOOKAHEAD = 0.15;   // כמה שניות קדימה מתזמנים קליקים
  var START_DELAY = 0.12; // זמן התארגנות לפני שהשיר "מתחיל לזוז"

  // ---------- מצב ----------
  var S = {
    bpm: 92, meter: '4/4', pre: 1, clickOn: true, instrument: null, clips: [],
    sound: (function () { try { var v = localStorage.getItem('bli-sound'); return v || 'woodtight'; } catch (e) { return 'woodtight'; } })(),
    clickVol: Math.pow(10, -10 * 0.5 / 20), takeVol: Math.pow(10, -10 * 0.5 / 20),
    mode: 'idle',          // idle | play | rec
    cursorBar: 0,          // נקודת ההתחלה, במספר תיבה (0 = תיבה 1)
    take: null,            // { data, sr, start, punch, latency }
    stoppedAt: 0,          // מיקום הסמן הלבן כשהכול עצור
    level: (function () { try { var v = localStorage.getItem('bli-level2'); return v && v !== 'gentle' ? v : 'strong'; } catch (e) { return 'strong'; } })()
  };

  var ctx = null, clickBus, takeBus, buffers = {};
  var recNode = null, micReady = false, chunks = [];
  var songT0 = 0, nextBeat = 0, schedTimer = null, takeSrc = null, recFrom = 0, recClicks = [], livePeaks = [], liveLat = 0;
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
      if (S.mode === 'rec') {
        chunks.push(e.data);
        livePeaks.push({ t: e.data.t - songT0 - liveLat, d: e.data.d.length / ctx.sampleRate, p: e.data.p });
      }
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
  function clipStart(tk) { return tk.start + tk.latencyShift; }            // זמן השיר של הדגימה הראשונה
  function clipEnd(tk) { return clipStart(tk) + tk.data.length / tk.sr; }

  // ערוץ העבודה: כל ההקלטות מודבקות על ציר אחד. הקלטה חדשה מכסה את מה שמתחתיה (העליון מנצח),
  // עם מעבר רך של 5 אלפיות שנייה בקצוות. הישנות לא נמחקות.
  var workCache = null;
  function invalidateWork() { workCache = null; }
  function workTrack() {
    if (workCache) return workCache;
    if (!S.clips.length) return null;
    var sr = S.clips[0].sr, end = 0;
    S.clips.forEach(function (c) { end = Math.max(end, clipEnd(c)); });
    var out = new Float32Array(Math.ceil(end * sr) + 1), fade = Math.round(0.005 * sr);
    S.clips.forEach(function (c) {
      var src = takeData(c), st = clipStart(c);
      var a = Math.max(0, Math.round(c.punch * sr)), b = Math.min(out.length, Math.floor(clipEnd(c) * sr));
      for (var i = a; i < b; i++) {
        var j = Math.round(i - st * sr);
        var v = (j >= 0 && j < src.length) ? src[j] : 0;
        var w = Math.min(1, (i - a) / fade, (b - 1 - i) / fade);
        out[i] = w >= 1 ? v : out[i] * (1 - w) + v * w;
      }
    });
    return (workCache = out);
  }

  function playTake(fromSec) {
    var wt = workTrack();
    if (!wt) return;
    var sr = S.clips[0].sr, begin = Math.max(0, fromSec);
    if (begin * sr >= wt.length) return;
    var buf = ctx.createBuffer(1, wt.length, sr);
    buf.copyToChannel(wt, 0);
    takeSrc = ctx.createBufferSource();
    takeSrc.buffer = buf;
    takeSrc.connect(takeBus);
    takeSrc.start(songT0 + begin, begin);
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
    chunks = []; recClicks = []; livePeaks = []; liveLat = lastLatency() || 0;
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
    S.clips.push(take);
    invalidateWork();
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
      var r = window.ClickDSP.removeClicks(tk.data, tk.sr, list, { level: S.level === 'orig' ? 'strong' : S.level });
      if (r.ok) {
        tk.s1 = r.stage1; tk.est = r.est;
        tk.clean = S.level === 'orig' ? window.ClickDSP.stage2(r.stage1, r.est, window.ClickDSP.LEVELS.strong) : r.clean;
        tk.cleanLevel = S.level === 'orig' ? 'strong' : S.level;
        tk.useClean = S.level !== 'orig';
        invalidateWork();
        setStatus('הקליק הוסר. למעלה אפשר לבחור כמה חזק להסיר, או לשמוע את המקור.');
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
    var blob = wavFloat32(workTrack(), S.take.sr); // נשמר מה שנשמע: ערוץ העבודה מתחילת השיר, נקי או מקור
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
    S.clips.forEach(function (c) { end = Math.max(end, clipEnd(c)); });
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
    var wt = workTrack();
    if (wt) {
      var wsr = S.clips[0].sr, mid = trackTop + trackH / 2, spp = wsr * barDur() / layout.pxPerBar;
      // מסגרת לכל הקלטה; הישנות קודם, כך שהחדשה מעליהן
      S.clips.forEach(function (c, ci) {
        var x0 = xOf(c.punch), x1 = xOf(clipEnd(c));
        if (x1 <= x0) return;
        var newest = ci === S.clips.length - 1;
        g2.fillStyle = newest ? 'hsla(150,60%,45%,0.18)' : 'hsla(150,40%,40%,0.12)';
        roundRect(x0 + 1, trackTop, x1 - x0 - 2, trackH, 10); g2.fill();
        g2.strokeStyle = newest ? acc : 'rgba(150,200,175,0.45)'; g2.lineWidth = 1.5; g2.stroke();
      });
      g2.fillStyle = acc;
      var lo = Infinity; S.clips.forEach(function (c) { lo = Math.min(lo, c.punch); });
      for (var px = Math.ceil(xOf(lo)) + 3; px < xOf(wt.length / wsr) - 3; px += 2) {
        var i0 = Math.floor(px / layout.pxPerBar * barDur() * wsr), i1 = i0 + Math.ceil(spp * 2), pk = 0;
        for (var i = Math.max(0, i0); i < Math.min(wt.length, i1); i++) { var a = Math.abs(wt[i]); if (a > pk) pk = a; }
        if (pk < 1e-5) continue;
        var hh = Math.max(1, Math.min(1, pk * 1.4) * (trackH / 2 - 6));
        g2.fillRect(px, mid - hh, 1.5, hh * 2);
      }
    }
    // הקלטה חיה: אזור אדום שגדל, עם הגל כפי שהוא נכנס
    if (S.mode === 'rec') {
      var now = songNow() - liveLat, rx0 = xOf(Math.max(0, recFrom)), rx1 = xOf(Math.max(recFrom, now));
      var cx0 = xOf(cursorSec());
      if (rx1 > cx0) {
        g2.fillStyle = 'rgba(238,51,72,0.14)'; roundRect(cx0 + 1, trackTop, rx1 - cx0 - 1, trackH, 10); g2.fill();
        g2.strokeStyle = 'rgba(255,90,106,0.8)'; g2.lineWidth = 1.5; g2.stroke();
      }
      var midL = trackTop + trackH / 2;
      for (var q = 0; q < livePeaks.length; q++) {
        var lp = livePeaks[q]; if (lp.t + lp.d < 0) continue;
        var lx = xOf(lp.t), lw = Math.max(1, xOf(lp.t + lp.d) - lx - 0.5);
        var lh = Math.max(1, Math.min(1, lp.p * 1.4) * (trackH / 2 - 6));
        g2.fillStyle = lp.t < cursorSec() ? 'rgba(255,255,255,0.25)' : '#FF8E99';
        g2.fillRect(lx, midL - lh, lw, lh * 2);
      }
      // תגית "מקליט" מהבהבת
      if (Math.floor(performance.now() / 500) % 2 === 0 || now < cursorSec()) {
        var lbl = now < cursorSec() ? 'הקדמה ' + Math.max(1, Math.ceil((cursorSec() - now) / beatDur())) : '● מקליט';
        g2.font = '700 12px Heebo, sans-serif';
        var tw = g2.measureText(lbl).width + 16, tx = Math.max(4, Math.min(rx1 - tw - 6, w - tw - 4));
        g2.fillStyle = now < cursorSec() ? 'rgba(255,255,255,0.85)' : 'rgba(238,51,72,0.95)';
        roundRect(tx, trackTop + 6, tw, 22, 6); g2.fill();
        g2.fillStyle = now < cursorSec() ? '#0C0E12' : '#fff'; g2.textAlign = 'center'; g2.fillText(lbl, tx + tw / 2, trackTop + 21); g2.textAlign = 'start';
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
  // ---------- בחירת כלי, והצעת קליק מתאים ----------
  function suggestFor(inst) {
    var cur = SOUNDS[S.sound];
    if (inst.prefer === 'high' && !cur.high) return { k: 'clap', why: 'לבס עדיף קליק גבוה, כדי שההסרה לא תפגע בבס.' };
    if (inst.prefer === 'low' && cur.high) return { k: 'bongo', why: 'ל' + inst.name + ' עדיף קליק עמוק יותר, רחוק מהצליל של הכלי.' };
    return null;
  }
  function showSuggestion() {
    var inst = INSTRUMENTS.filter(function (i) { return i.k === S.instrument; })[0], btn = $('suggest-btn');
    var sg = inst ? suggestFor(inst) : null;
    if (!sg) { btn.hidden = true; return; }
    setStatus(sg.why);
    btn.textContent = 'להחליף ל' + SOUNDS[sg.k].name;
    btn.dataset.k = sg.k; btn.hidden = false;
  }
  $('suggest-btn').addEventListener('click', async function () {
    S.sound = this.dataset.k; this.hidden = true;
    try { localStorage.setItem('bli-sound', S.sound); } catch (e) {}
    setStatus('הקליק הוחלף ל' + SOUNDS[S.sound].name);
    render();
    if (S.mode === 'idle') { await initAudio(); playClick(ctx.currentTime + 0.02, 'top'); }
  });
  $('inst-btn').addEventListener('click', function () {
    $('inst-list').innerHTML = INSTRUMENTS.map(function (i) {
      return '<button class="snd" data-k="' + i.k + '" aria-pressed="' + (i.k === S.instrument) + '"><span class="snd-name">' + i.name + '</span></button>';
    }).join('');
    $('inst-sheet').hidden = false;
  });
  $('inst-close').addEventListener('click', function () { $('inst-sheet').hidden = true; });
  $('inst-sheet').addEventListener('click', function (e) { if (e.target.id === 'inst-sheet') $('inst-sheet').hidden = true; });
  $('inst-list').addEventListener('click', function (e) {
    var b = e.target.closest('.snd'); if (!b) return;
    S.instrument = b.dataset.k;
    $('inst-sheet').hidden = true;
    render(); showSuggestion();
  });

  // בחירת סאונד: רשימה עם דירוג של כמה קל להסיר
  function renderSoundList() {
    var html = '';
    SOUND_ORDER.forEach(function (k) {
      var s = SOUNDS[k];
      var tag = s.high ? ' <em>לכלים נמוכים</em>' : (s.low ? ' <em class="lo">לכלים גבוהים</em>' : '');
      html += '<button class="snd" data-k="' + k + '" aria-pressed="' + (k === S.sound) + '">' +
        '<span class="snd-name">' + s.name + tag + '</span>' +
        '<span class="snd-desc">' + s.desc + '</span>' +
        '<span class="snd-ms num">' + s.ms + ' אלפיות שנייה</span></button>';
    });
    $('sound-list').innerHTML = html;
  }
  $('sound-btn').addEventListener('click', function () { renderSoundList(); $('sound-sheet').hidden = false; });
  $('sound-close').addEventListener('click', function () { $('sound-sheet').hidden = true; });
  $('sound-sheet').addEventListener('click', function (e) { if (e.target.id === 'sound-sheet') $('sound-sheet').hidden = true; });
  $('sound-list').addEventListener('click', async function (e) {
    var b = e.target.closest('.snd'); if (!b) return;
    S.sound = b.dataset.k;
    try { localStorage.setItem('bli-sound', S.sound); } catch (err) {}
    renderSoundList(); render(); showSuggestion();
    if (S.mode === 'idle') { await initAudio(); playClick(ctx.currentTime + 0.02, 'top'); }
  });
  $('rec-btn').addEventListener('click', function () { if (S.mode === 'rec') stop(); else { if (S.mode === 'play') stop(); record(); } });
  $('play-btn').addEventListener('click', function () { if (S.mode === 'play') stop(); else { if (S.mode === 'rec') stop(); play(); } });
  $('to-cursor').addEventListener('click', function () { var was = S.mode; if (was !== 'idle') stop(); S.stoppedAt = cursorSec(); if (was === 'play') play(); else render(); });
  $('to-start').addEventListener('click', function () { var was = S.mode; if (was !== 'idle') stop(); S.stoppedAt = 0; wrap.scrollLeft = 0; if (was === 'play') play(); else render(); });
  $('save-btn').addEventListener('click', saveTake);
  document.querySelectorAll('.lv').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!S.take || !S.take.s1) return;
      var lv = b.dataset.level;
      var was = S.mode === 'play', pos = songNow();
      if (was) stop();
      S.level = lv;
      try { localStorage.setItem('bli-level2', lv); } catch (e) {}
      // הרמה חלה על כל ההקלטות בערוץ
      S.clips.forEach(function (tk) {
        if (!tk.s1) return;
        if (lv === 'orig') { tk.useClean = false; return; }
        if (tk.cleanLevel !== lv) { tk.clean = window.ClickDSP.stage2(tk.s1, tk.est, window.ClickDSP.LEVELS[lv]); tk.cleanLevel = lv; }
        tk.useClean = true;
      });
      invalidateWork();
      if (was) { S.stoppedAt = Math.max(0, pos); play(); } else render();
    });
  });
  // פיידרים בדציבלים: כל הזזה נשמעת. 100 = עוצמה מלאה, כל 10 = בערך 5 דציבלים, 0 = שקט
  function faderGain(v) { v = +v; return v <= 0 ? 0 : Math.pow(10, (v - 100) * 0.5 / 20); }
  function showDb(id, v) { $(id).textContent = +v <= 0 ? '−∞' : String(Math.round((v - 100) * 0.5)); }
  $('click-vol').addEventListener('input', function (e) { showDb('click-db', e.target.value); });
  $('take-vol').addEventListener('input', function (e) { showDb('take-db', e.target.value); });
  $('click-vol').addEventListener('input', function (e) { S.clickVol = faderGain(e.target.value); if (clickBus) clickBus.gain.setTargetAtTime(S.clickVol, ctx.currentTime, 0.01); });
  $('take-vol').addEventListener('input', function (e) { S.takeVol = faderGain(e.target.value); if (takeBus) takeBus.gain.setTargetAtTime(S.takeVol, ctx.currentTime, 0.01); });
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
    var inst = INSTRUMENTS.filter(function (i) { return i.k === S.instrument; })[0];
    $('inst-name').textContent = inst ? inst.name : 'בחרו';
    $('rec-btn').setAttribute('aria-label', S.mode === 'rec' ? 'עצירת הקלטה' : 'הקלטה');
    $('play-btn').setAttribute('aria-label', S.mode === 'play' ? 'השהיה' : 'ניגון');
    if (S.mode === 'rec') setStatus('הקדמה של ' + (S.pre === 1 ? 'תיבה אחת' : '2 תיבות') + ', ואז הקלטה מתיבה ' + (S.cursorBar + 1) + ' עד שעוצרים');
    else if (S.mode === 'play') setStatus('מנגן');
    $('latency').textContent = S.take && S.take.measured !== null ? 'השהיה: ' + Math.round(S.take.measured * 1000) + 'ms' : '';
    var hasClean = !!(S.take && S.take.s1);
    $('levels').hidden = !hasClean;
    if (hasClean) {
      var cur = S.take.useClean ? S.take.cleanLevel : 'orig';
      document.querySelectorAll('.lv').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.level === cur)); });
    }
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
