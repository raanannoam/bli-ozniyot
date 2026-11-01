// בלי אוזניות – שלב 1: מטרונום, הקלטה עם הקדמה, ניגון.
// ציר הזמן של השיר נמדד בשניות: 0 = תחילת תיבה 1.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // אם הדפדפן הביא דף ישן מהזיכרון יחד עם קוד חדש, טוענים מחדש פעם אחת
  var CODE_VERSION = '16';
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
  var LEVEL_OK = { medium: 1, strong: 1, max: 1 };
  var LEVEL_GAIN = { base: 0.7, mid: 0.85, top: 1.0 };
  var METERS = ['2/4', '3/4', '4/4', '5/4', '7/4', '5/8', '6/8', '7/8', '9/8', '10/8', '12/8'];
  var GROUPS = { '5/8': [3, 2], '6/8': [3, 3], '7/8': [2, 2, 3], '9/8': [3, 2, 2, 2], '10/8': [3, 3, 2, 2], '12/8': [3, 3, 3, 3] };
  var LOOKAHEAD = 0.15;   // כמה שניות קדימה מתזמנים קליקים
  var START_DELAY = 0.12; // זמן התארגנות לפני שהשיר "מתחיל לזוז"

  // ---------- מצב ----------
  var S = {
    songId: null, songName: 'שיר', created: 0,
    bpm: 92, meter: '4/4', pre: 1, clickOn: true, instrument: null, clips: [], mix: [], mixVol: Math.pow(10, -10 * 0.5 / 20),
    sound: (function () { try { var v = localStorage.getItem('bli-sound'); return v || 'woodtight'; } catch (e) { return 'woodtight'; } })(),
    clickVol: Math.pow(10, -10 * 0.5 / 20), takeVol: Math.pow(10, -10 * 0.5 / 20),
    mode: 'idle',          // idle | play | rec
    cursorBar: 0,          // נקודת ההתחלה, במספר תיבה (0 = תיבה 1)
    take: null,            // { data, sr, start, punch, latency }
    stoppedAt: 0,          // מיקום הסמן הלבן כשהכול עצור
    level: (function () { try { var v = localStorage.getItem('bli-level3'); return v && LEVEL_OK[v] ? v : 'strong'; } catch (e) { return 'strong'; } })(),
    endBar: 4,             // סמן הסיום, במספר תיבה (תמיד יש לו מקום)
    endInf: true,
    zoom: 1,               // זום רוחבי: 1 = כ־8 תיבות על המסך          // אינסוף: מקליטים בלי גבול, עד שעוצרים. נגיעה בידית של הסיום מחליפה
    undo: []
  };

  var ctx = null, clickBus, takeBus, mixBus, buffers = {}, mixSrc = null, recRef = null;
  var recNode = null, micReady = false, chunks = [];
  var songT0 = 0, nextBeat = 0, schedTimer = null, takeSrc = null, recFrom = 0, recClicks = [], livePeaks = [], liveLat = 0, recLimit = null;
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
    mixBus = ctx.createGain(); mixBus.gain.value = S.mixVol; mixBus.connect(ctx.destination);
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
  function clipEnd(tk) {
    if (tk.erase) return tk.endT;
    var e = clipStart(tk) + tk.data.length / tk.sr;
    return tk.limit != null ? Math.min(e, tk.limit) : e;
  }
  function goodLevel() { return S.level !== 'orig' ? S.level : (S.lastLevel || 'strong'); }

  // ערוץ העבודה: כל ההקלטות מודבקות על ציר אחד. הקלטה חדשה מכסה את מה שמתחתיה (העליון מנצח),
  // עם מעבר רך של 5 אלפיות שנייה בקצוות. הישנות לא נמחקות.
  var workCache = null;
  function invalidateWork() { workCache = null; }
  function workTrack() {
    if (workCache) return workCache;
    if (!S.clips.length) return null;
    var sr = 48000; S.clips.forEach(function (c) { if (c.sr) sr = c.sr; });
    var end = 0;
    S.clips.forEach(function (c) { if (!c.erase) end = Math.max(end, clipEnd(c)); });
    if (end <= 0) return null;
    var out = new Float32Array(Math.ceil(end * sr) + 1), fade = Math.round(0.005 * sr);
    S.clips.forEach(function (c) {
      if (c.erase) {
        var ea = Math.max(0, Math.round(c.punch * sr)), eb = Math.min(out.length, Math.round(c.endT * sr));
        for (var ii = ea; ii < eb; ii++) { var ww = Math.min(1, (ii - ea) / fade, (eb - 1 - ii) / fade); out[ii] *= (1 - Math.max(0, ww)); }
        return;
      }
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
    var sr = ctx.sampleRate, begin = Math.max(0, fromSec);
    if (begin * sr >= wt.length) return;
    var buf = ctx.createBuffer(1, wt.length, sr);
    buf.copyToChannel(wt, 0);
    takeSrc = ctx.createBufferSource();
    takeSrc.buffer = buf;
    takeSrc.connect(takeBus);
    takeSrc.start(songT0 + begin, begin);
  }

  // ---------- המיכל ----------
  function hueOf(i) { return (150 + i * 28) % 360; }
  var mixCache = null;
  function invalidateMix() { mixCache = null; mixPeaksKey = ''; }
  function mixBuffer() {
    if (mixCache) return mixCache;
    var on = S.mix.filter(function (m) { return !m.muted; });
    if (!on.length) return null;
    var len = 0; on.forEach(function (m) { len = Math.max(len, m.data.length); });
    var out = new Float32Array(len);
    on.forEach(function (m) { for (var i = 0; i < m.data.length; i++) out[i] += m.data[i]; });
    return (mixCache = out);
  }
  function playMix(fromSec) {
    var mb = mixBuffer();
    if (!mb) return;
    var sr = ctx.sampleRate, begin = Math.max(0, fromSec);
    if (begin * sr >= mb.length) return;
    var buf = ctx.createBuffer(1, mb.length, sr);
    buf.copyToChannel(mb, 0);
    mixSrc = ctx.createBufferSource(); mixSrc.buffer = buf; mixSrc.connect(mixBus);
    mixSrc.start(songT0 + begin, begin);
  }

  async function play() {
    await initAudio();
    S.mode = 'play';
    var from = S.stoppedAt;
    startTransport(from);
    playTake(from);
    playMix(from);
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
    recLimit = S.endInf ? null : endSec();
    recFrom = cursorSec() - S.pre * barDur();
    S.mode = 'rec';
    // מה שהרמקול ינגן מהמיכל, בעוצמה הנוכחית: זה ה"רקע" שנחסיר אחר כך
    var mb = mixBuffer();
    recRef = mb ? { data: mb, gain: S.mixVol } : null;
    startTransport(recFrom);
    playMix(recFrom);
    requestWake();
    render();
  }

  function stop() {
    clearInterval(schedTimer); schedTimer = null;
    if (takeSrc) { try { takeSrc.stop(); } catch (e) {} takeSrc = null; }
    if (mixSrc) { try { mixSrc.stop(); } catch (e) {} mixSrc = null; }
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
    var take = { data: data, sr: ctx.sampleRate, start: start, punch: cursorSec(), preFrom: recFrom, latencyShift: 0, measured: null, ref: recRef };
    recRef = null;
    var lat = measureLatency(take), prev = lastLatency();
    if (lat !== null) { take.measured = lat; take.latencyShift = -lat; rememberLatency(lat); }
    else if (prev !== null) { take.measured = prev; take.latencyShift = -prev; }
    take.limit = recLimit;
    pushUndo();
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
      // הרקע כפי שהגיע למיקרופון: המיכל, מוזז בהשהיה שנמדדה
      var ref = null;
      if (tk.ref) {
        ref = new Float32Array(tk.data.length);
        var off = Math.round((tk.start - lat) * tk.sr), src = tk.ref.data, gref = tk.ref.gain;
        for (var q = 0; q < ref.length; q++) { var j = q + off; if (j >= 0 && j < src.length) ref[q] = src[j] * gref; }
      }
      var r = window.ClickDSP.removeAll(tk.data, tk.sr, list, ref, { level: goodLevel() });
      if (r.ok) {
        tk.s1 = r.stage1; tk.est = r.est;
        tk.clean = r.clean; tk.cleanLevel = goodLevel();
        // הקלטה חדשה תמיד נקייה. אם היינו במצב "מקור", חוזרים לרמה האחרונה בכל הערוץ
        if (S.level === 'orig') { S.level = goodLevel(); S.clips.forEach(function (c) { if (c.clean) c.useClean = true; }); }
        tk.useClean = true;
        invalidateWork();
        tk.ref = null;
        setStatus(r.bgOk ? 'הקליק והמיקס הוסרו מההקלטה. למעלה אפשר לבחור עוצמת הסרה, או לשמוע את המקור.' : 'הקליק הוסר. למעלה אפשר לבחור כמה חזק להסיר, או לשמוע את המקור.');
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
    var wt = workTrack(); if (!wt) return;
    // נשמר מה שנשמע: ערוץ העבודה מתחילת השיר, נקי או מקור
    shareWav(wt, ctx ? ctx.sampleRate : 48000, (S.level === 'orig' ? 'מקור' : 'נקי'));
  }
  async function shareWav(arr, sr, label) {
    var d = new Date();
    var safe = (S.songName + '-' + label).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_');
    var name = safe + '-' + S.bpm + 'bpm-' + S.meter.replace('/', '-') + '-' +
      d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' +
      String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.wav';
    var blob = wavFloat32(arr, sr);
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

  // סוף התוכן בערוץ העבודה (בשניות)
  function contentEnd() { var e = 0; visibleSegments().forEach(function (s) { e = Math.max(e, s.b); }); return e; }
  // מיקום סמן הסיום. תמיד לפחות תיבה אחת אחרי ההתחלה
  function endSec() { return Math.max(S.endBar, S.cursorBar + 1) * barDur(); }
  function songBars() {
    var end = Math.max(cursorSec() + barDur() * 2, endSec() + barDur());
    S.clips.forEach(function (c) { end = Math.max(end, clipEnd(c)); });
    S.mix.forEach(function (m) { end = Math.max(end, m.data.length / m.sr); });
    if (S.mode !== 'idle') end = Math.max(end, songNow() + barDur());
    return Math.max(8, Math.ceil(end / barDur()) + 1);
  }

  function sizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var h = wrap.clientHeight;
    layout.bars = songBars();
    layout.pxPerBar = Math.max(70, wrap.clientWidth / 8) * S.zoom;
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
    var mixH = Math.round((h - top) * 0.32), trackTop = top + 8, trackH = h - top - 16 - mixH - 6;
    var mixTop = trackTop + trackH + 6;
    drawMix(mixTop, mixH, w);
    var wt = workTrack();
    if (wt) {
      var wsr = ctx ? ctx.sampleRate : 48000, mid = trackTop + trackH / 2, spp = wsr * barDur() / layout.pxPerBar;
      // מסגרת לכל קטע שנשמע בפועל (אחרי כיסויים ומחיקות). החדש מודגש
      var segs = visibleSegments(), last = -1;
      S.clips.forEach(function (c, ci) { if (!c.erase) last = ci; });
      segs.forEach(function (sg) {
        var x0 = xOf(sg.a), x1 = xOf(sg.b);
        if (x1 - x0 < 3) return;
        var newest = sg.owner === last;
        g2.fillStyle = newest ? 'hsla(var(--hue),60%,45%,0.18)'.replace('var(--hue)', hueOf(S.mix.length)) : 'rgba(150,200,175,0.10)';
        roundRect(x0 + 1, trackTop, x1 - x0 - 2, trackH, 10); g2.fill();
        g2.strokeStyle = newest ? acc : 'rgba(150,200,175,0.45)'; g2.lineWidth = 1.5; g2.stroke();
      });
      g2.fillStyle = acc;
      var lo = Infinity; segs.forEach(function (sg) { lo = Math.min(lo, sg.a); });
      if (lo === Infinity) lo = 0;
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
    // שני הסמנים: התחלה וסיום, עם ידיות, והאזור שביניהם
    var cx = xOf(cursorSec()), ex = xOf(endSec());
    g2.fillStyle = S.endInf ? 'rgba(255,90,106,0.04)' : 'rgba(255,90,106,0.08)'; g2.fillRect(cx, 0, ex - cx, h);
    if (!S.endInf) {
      var nb = Math.round((endSec() - cursorSec()) / barDur()), tl = nb === 1 ? 'תיבה אחת' : nb + ' תיבות';
      g2.font = '700 11px Heebo, sans-serif'; g2.textAlign = 'center'; g2.fillStyle = 'rgba(255,194,200,0.9)';
      if (ex - cx > 60) g2.fillText(tl, (cx + ex) / 2, 34);
      g2.textAlign = 'start';
    }
    [[cx, 'התחלה'], [ex, S.endInf ? '∞ בלי גבול' : 'סוף']].forEach(function (m, mi) {
      var mx = m[0];
      if (mi === 1 && S.endInf) { g2.fillStyle = 'rgba(255,90,106,0.5)'; for (var dy = 0; dy < h; dy += 8) g2.fillRect(mx - 1, dy, 2, 4); }
      else { g2.fillStyle = '#FF5A6A'; g2.fillRect(mx - 1, 0, 2, h); }
      g2.fillStyle = 'rgba(238,51,72,0.95)'; roundRect(mx - 14, 0, 28, 22, 7); g2.fill();
      g2.fillStyle = 'rgba(255,255,255,0.9)';
      for (var gi = -1; gi <= 1; gi++) g2.fillRect(mx + gi * 4 - 0.75, 6, 1.5, 10);
      g2.font = '500 10px Heebo, sans-serif'; g2.textAlign = 'left';
      var lw2 = g2.measureText(m[1]).width + 10;
      g2.fillStyle = 'rgba(238,51,72,0.85)'; roundRect(mx + 16, 3, lw2, 16, 4); g2.fill();
      g2.fillStyle = '#fff'; g2.fillText(m[1], mx + 21, 15); g2.textAlign = 'start';
    });
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
  // הקטעים שנשמעים בערוץ העבודה: כל הקלטה מכסה את מה שמתחתיה, מחיקה מורידה
  function visibleSegments() {
    var segs = [];
    function cut(a, b) {
      var out = [];
      segs.forEach(function (s) {
        if (s.b <= a || s.a >= b) { out.push(s); return; }
        if (s.a < a) out.push({ a: s.a, b: a, owner: s.owner });
        if (s.b > b) out.push({ a: b, b: s.b, owner: s.owner });
      });
      segs = out;
    }
    S.clips.forEach(function (c, ci) {
      var a = c.punch, b = clipEnd(c);
      if (b <= a) return;
      cut(a, b);
      if (!c.erase) segs.push({ a: a, b: b, owner: ci });
    });
    return segs.sort(function (x, y) { return x.a - y.a; });
  }

  // ערוץ המיכל: גל אחד. כל עמודה בצבע של הקלטה אחרת מבין אלה שמתנגנות באותו רגע, בגובה הממוצע
  var mixPeaksKey = '', mixPeaks = null;
  function drawMix(y0, hh, w) {
    g2.fillStyle = 'rgba(0,0,0,0.22)'; roundRect(2, y0, w - 4, hh, 10); g2.fill();
    var list = S.mix.map(function (m, i) { return { m: m, i: i }; }).filter(function (o) { return !o.m.muted; });
    if (!list.length) {
      g2.fillStyle = 'rgba(167,173,182,0.7)'; g2.font = '500 12px Heebo, sans-serif'; g2.textAlign = 'right';
      g2.fillText(S.mix.length ? 'כל ההקלטות במיקס מושתקות' : 'המיקס ריק. "הכנס למיקס" מעביר לכאן את ערוץ העבודה', Math.min(w, wrap.clientWidth + wrap.scrollLeft) - 14, y0 + hh / 2 + 4);
      g2.textAlign = 'start'; return;
    }
    var step = 3, key = layout.pxPerBar + '|' + barDur() + '|' + w + '|' + S.mix.length + '|' + list.map(function (o) { return o.i; }).join(',');
    if (key !== mixPeaksKey) {
      mixPeaksKey = key; mixPeaks = [];
      list.forEach(function (o) {
        var d = o.m.data, sr = o.m.sr, arr = new Float32Array(Math.ceil(w / step));
        for (var c = 0; c < arr.length; c++) {
          var i0 = Math.floor((c * step) / layout.pxPerBar * barDur() * sr), i1 = Math.floor(((c + 1) * step) / layout.pxPerBar * barDur() * sr), pk = 0;
          for (var i = Math.max(0, i0); i < Math.min(d.length, i1); i += 4) { var a = d[i] < 0 ? -d[i] : d[i]; if (a > pk) pk = a; }
          arr[c] = pk;
        }
        mixPeaks.push({ hue: hueOf(o.i), p: arr });
      });
    }
    var mid = y0 + hh / 2, cols = mixPeaks[0].p.length;
    for (var c = 0; c < cols; c++) {
      var act = [], sum = 0;
      for (var k = 0; k < mixPeaks.length; k++) if (mixPeaks[k].p[c] > 0.003) { act.push(mixPeaks[k]); sum += mixPeaks[k].p[c]; }
      if (!act.length) continue;
      var avg = sum / act.length, bh = Math.max(1, Math.min(1, avg * 1.4) * (hh / 2 - 5));
      g2.fillStyle = 'hsl(' + act[c % act.length].hue + ' 62% 60%)';
      g2.fillRect(c * step, mid - bh, step - 1, bh * 2);
    }
  }

  function roundRect(x, y, w, h, r) {
    g2.beginPath(); g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r);
    g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath();
  }

  // ציר הזמן: גרירת ידית מזיזה סמן (נצמד לתיבות), גרירה במקום אחר גוללת, ונגיעה קובעת את ההתחלה
  var gest = null, pts = {}, pinch = null;
  function setZoom(z, anchorClientX) {
    z = Math.max(0.5, Math.min(8, z));
    var r = wrap.getBoundingClientRect(), ax = (anchorClientX == null ? r.left + r.width / 2 : anchorClientX) - r.left;
    var sec = (wrap.scrollLeft + ax) / layout.pxPerBar * barDur();
    S.zoom = z; draw();
    wrap.scrollLeft = Math.max(0, sec / barDur() * layout.pxPerBar - ax);
    $('zoom-val').textContent = '×' + (Math.round(S.zoom * 10) / 10);
  }
  $('zoom-in').addEventListener('click', function () { setZoom(S.zoom * 1.5); });
  $('zoom-out').addEventListener('click', function () { setZoom(S.zoom / 1.5); });
  cv.addEventListener('pointerdown', function (e) {
    pts[e.pointerId] = e.clientX;
    var ids = Object.keys(pts);
    if (ids.length === 2) {   // צביטה בשתי אצבעות: זום
      gest = null;
      pinch = { d: Math.abs(pts[ids[0]] - pts[ids[1]]) || 1, z: S.zoom };
      return;
    }
    var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    var which = null;
    if (y < 34 && S.mode === 'idle') {
      var ds = Math.abs(x - xOf(cursorSec())), de = Math.abs(x - xOf(endSec()));
      if (Math.min(ds, de) < 24) which = de < ds ? 'end' : 'start';
    }
    gest = { x0: e.clientX, sl: wrap.scrollLeft, which: which, moved: false };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', function (e) {
    if (pts[e.pointerId] !== undefined) pts[e.pointerId] = e.clientX;
    if (pinch) {
      var ids = Object.keys(pts); if (ids.length < 2) return;
      var d = Math.abs(pts[ids[0]] - pts[ids[1]]) || 1;
      setZoom(pinch.z * d / pinch.d, (pts[ids[0]] + pts[ids[1]]) / 2);
      return;
    }
    if (!gest) return;
    if (Math.abs(e.clientX - gest.x0) > 8) gest.moved = true;
    if (!gest.which) { wrap.scrollLeft = gest.sl - (e.clientX - gest.x0); return; }
    var r = cv.getBoundingClientRect(), bar = Math.round((e.clientX - r.left) / layout.pxPerBar);
    if (gest.which === 'start') {
      // ההתחלה זזה לבד, והסיום נשאר. לפחות תיבה אחת ביניהם
      S.cursorBar = Math.max(0, Math.min(S.endBar - 1, bar)); S.stoppedAt = cursorSec();
      setStatus('התחלה: תיבה ' + (S.cursorBar + 1) + lenText());
    } else {
      S.endBar = Math.max(S.cursorBar + 1, bar);
      setStatus('סוף: תחילת תיבה ' + (S.endBar + 1) + lenText());
    }
    render();
  });
  function endGesture(e) {
    if (!gest) return;
    var g = gest; gest = null;
    if (g.moved || S.mode !== 'idle') return;
    // נגיעה בידית של הסיום: מחליפה בין "סוף" לבין אינסוף
    if (g.which === 'end') {
      S.endInf = !S.endInf;
      setStatus(S.endInf ? 'בלי גבול: מקליטים עד שעוצרים' : 'ההקלטה תיעצר לבד בסוף' + lenText());
      render(); return;
    }
    if (g.which) return;
    var r = cv.getBoundingClientRect();
    var bar = Math.max(0, Math.round((e.clientX - r.left) / layout.pxPerBar));
    var len = S.endBar - S.cursorBar;
    S.cursorBar = bar;
    if (S.endBar <= bar) S.endBar = bar + len;   // אם ההתחלה עברה את הסוף, הסוף זז איתה ושומר על האורך
    S.stoppedAt = cursorSec();
    setStatus('ההקלטה תתחיל בתיבה ' + (S.cursorBar + 1) + lenText());
    render();
  }
  function lenText() {
    if (S.endInf) return ', בלי גבול';
    var n = S.endBar - S.cursorBar;
    return ', ' + (n === 1 ? 'תיבה אחת' : n + ' תיבות');
  }
  function lift(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) { if (pinch) { pinch = null; gest = null; return true; } } return false; }
  cv.addEventListener('pointerup', function (e) { if (lift(e)) return; endGesture(e); });
  cv.addEventListener('pointercancel', function (e) { lift(e); gest = null; });

  // ---------- מחיקה וביטול ----------
  function pushUndo() {
    S.undo.push({ clips: S.clips.slice(), mix: S.mix.slice(), take: S.take });
    if (S.undo.length > 50) S.undo.shift();
  }
  $('del-btn').addEventListener('click', function () {
    if (S.mode !== 'idle' || !S.clips.length) return;
    var a = cursorSec(), b = S.endInf ? Math.max(endSec(), contentEnd()) : endSec();
    if (b <= a) return;
    pushUndo();
    S.clips.push({ erase: true, punch: a, endT: b });
    invalidateWork();
    setStatus('נמחק מתיבה ' + (S.cursorBar + 1) + ' עד ' + (S.endInf ? 'סוף ההקלטה' : 'תחילת תיבה ' + (S.endBar + 1)) + '. "ביטול" מחזיר.');
    render();
  });
  $('undo-btn').addEventListener('click', function () {
    if (S.mode !== 'idle' || !S.undo.length) return;
    var u = S.undo.pop();
    S.clips = u.clips; S.mix = u.mix; S.take = u.take;
    invalidateWork(); invalidateMix();
    setStatus('הפעולה האחרונה בוטלה');
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
      if (!S.clips.some(function (c) { return c.s1; })) return;
      var lv = b.dataset.level;
      var was = S.mode === 'play', pos = songNow();
      if (was) stop();
      S.level = lv;
      // "מקור" הוא רק להשוואה: לא נזכר, ולא נכנס למיקס
      if (lv !== 'orig') { S.lastLevel = lv; try { localStorage.setItem('bli-level3', lv); } catch (e) {} }
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
  $('mix-vol').addEventListener('input', function (e) { showDb('mix-db', e.target.value); S.mixVol = faderGain(e.target.value); if (mixBus) mixBus.gain.setTargetAtTime(S.mixVol, ctx.currentTime, 0.01); });
  $('take-vol').addEventListener('input', function (e) { showDb('take-db', e.target.value); });
  $('click-vol').addEventListener('input', function (e) { S.clickVol = faderGain(e.target.value); if (clickBus) clickBus.gain.setTargetAtTime(S.clickVol, ctx.currentTime, 0.01); });
  $('take-vol').addEventListener('input', function (e) { S.takeVol = faderGain(e.target.value); if (takeBus) takeBus.gain.setTargetAtTime(S.takeVol, ctx.currentTime, 0.01); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && S.mode === 'play') stop(); });

  // ---------- הכנס למיקס ----------
  function instName() { var i = INSTRUMENTS.filter(function (x) { return x.k === S.instrument; })[0]; return i ? i.name : ''; }
  $('mixin-btn').addEventListener('click', function () {
    if (!S.clips.length || S.mode !== 'idle') return;
    $('name-input').value = instName() || ('הקלטה ' + (S.mix.length + 1));
    $('name-dot').style.background = 'hsl(' + hueOf(S.mix.length) + ' 62% 60%)';
    $('name-chips').innerHTML = INSTRUMENTS.filter(function (i) { return i.k !== 'other'; }).map(function (i) { return '<button data-n="' + i.name + '">' + i.name + '</button>'; }).join('');
    $('name-sheet').hidden = false;
  });
  $('name-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) $('name-input').value = b.dataset.n; });
  $('name-close').addEventListener('click', function () { $('name-sheet').hidden = true; });
  $('name-ok').addEventListener('click', function () {
    // למיקס נכנסת תמיד הגרסה הנקייה, ברמה האחרונה שנבחרה (גם אם עכשיו מאזינים ל"מקור")
    var lv = goodLevel();
    S.clips.forEach(function (c) {
      if (!c.s1) return;
      if (c.cleanLevel !== lv) { c.clean = window.ClickDSP.stage2(c.s1, c.est, window.ClickDSP.LEVELS[lv]); c.cleanLevel = lv; }
      c.useClean = true;
    });
    S.level = lv;
    invalidateWork();
    var wt = workTrack(); if (!wt) return;
    var name = $('name-input').value.trim() || ('הקלטה ' + (S.mix.length + 1));
    pushUndo();
    S.mix.push({ name: name, data: Float32Array.from(wt), sr: ctx ? ctx.sampleRate : 48000, muted: false, clips: S.clips.slice() });
    S.clips = []; S.take = null; invalidateWork(); invalidateMix();
    $('save-btn').disabled = true;
    $('name-sheet').hidden = true;
    S.instrument = null; $('suggest-btn').hidden = true;
    setStatus('״' + name + '״ נכנס למיקס. אפשר להקליט את הבא, והמיקס יתנגן ברקע.');
    render();
  });

  // ---------- מה יש במיקס ----------
  var confirmDel = -1;
  function renderMixList() {
    if (!S.mix.length) { $('mix-list').innerHTML = '<div class="mix-empty">עדיין אין כלום במיקס.</div>'; return; }
    $('mix-list').innerHTML = S.mix.map(function (m, i) {
      return '<div class="mix-row' + (m.muted ? ' muted' : '') + '">' +
        '<span class="nm"><i class="dot" style="background:hsl(' + hueOf(i) + ' 62% 60%)"></i>' + m.name.replace(/</g, '&lt;') + '</span>' +
        '<button class="btn" data-a="mute" data-i="' + i + '">' + (m.muted ? 'מושתק' : 'פעיל') + '</button>' +
        '<button class="btn" data-a="edit" data-i="' + i + '">לעריכה</button>' +
        '<button class="btn" data-a="save" data-i="' + i + '" aria-label="שמירה כקובץ">שמירה</button>' +
        '<button class="btn danger" data-a="del" data-i="' + i + '">' + (confirmDel === i ? 'בטוח?' : 'מחיקה') + '</button></div>';
    }).join('');
  }
  $('mixlist-btn').addEventListener('click', function () { confirmDel = -1; renderMixList(); $('mix-sheet').hidden = false; });
  $('mix-close').addEventListener('click', function () { $('mix-sheet').hidden = true; });
  $('mix-sheet').addEventListener('click', function (e) { if (e.target.id === 'mix-sheet') $('mix-sheet').hidden = true; });
  $('mix-list').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var i = +b.dataset.i, m = S.mix[i];
    if (S.mode !== 'idle') stop();
    if (b.dataset.a === 'save') { shareWav(m.data, m.sr, m.name); return; }
    if (b.dataset.a === 'mute') { m.muted = !m.muted; invalidateMix(); confirmDel = -1; }
    else if (b.dataset.a === 'del') {
      if (confirmDel !== i) { confirmDel = i; renderMixList(); return; }
      pushUndo(); S.mix.splice(i, 1); invalidateMix(); confirmDel = -1;
    } else if (b.dataset.a === 'edit') {
      if (S.clips.length) { setStatus('בערוץ העבודה יש הקלטה. קודם להכניס אותה למיקס, ואז להחזיר את "' + m.name + '" לעריכה.'); $('mix-sheet').hidden = true; render(); return; }
      pushUndo();
      if (m.clips && m.clips.length) { S.clips = m.clips.slice(); }
      else {
        var first = 0; while (first < m.data.length && Math.abs(m.data[first]) < 1e-6) first++;
        S.clips = [{ data: m.data, sr: m.sr, start: 0, latencyShift: 0, punch: first / m.sr, measured: null, useClean: false }];
      }
      S.take = null; S.clips.forEach(function (c) { if (!c.erase) S.take = c; });
      invalidateWork();
      S.mix.splice(i, 1); invalidateMix();
      $('save-btn').disabled = false;
      $('mix-sheet').hidden = true;
      setStatus('״' + m.name + '״ חזר לערוץ העבודה.');
    }
    renderMixList(); render();
  });

  function setStatus(t) { $('status').textContent = t; }

  // ---------- שמירה אוטומטית ----------
  var AID = new WeakMap(), saveTimer = null, loading = false;
  function aidOf(arr, pending) {
    if (!arr) return null;
    var id = AID.get(arr);
    if (!id) { id = window.Store.newId(); AID.set(arr, id); pending.push([id, arr]); }
    return id;
  }
  function clipMeta(c, pending) {
    if (c.erase) return { erase: true, punch: c.punch, endT: c.endT };
    return {
      punch: c.punch, start: c.start, latencyShift: c.latencyShift, measured: c.measured, sr: c.sr, limit: c.limit == null ? null : c.limit,
      preFrom: c.preFrom, cleanLevel: c.cleanLevel || null, useClean: !!c.useClean,
      data: aidOf(c.data, pending), s1: aidOf(c.s1, pending), est: aidOf(c.est, pending)
    };
  }
  function songMeta(pending) {
    var ids = [];
    function track(m) { ['data', 's1', 'est'].forEach(function (k) { if (m[k]) ids.push(m[k]); }); return m; }
    var faders = {}; ['take-vol', 'click-vol', 'mix-vol'].forEach(function (k) { faders[k] = +$(k).value; });
    return {
      id: S.songId, name: S.songName, created: S.created, updated: Date.now(),
      settings: { bpm: S.bpm, meter: S.meter, pre: S.pre, clickOn: S.clickOn, instrument: S.instrument, sound: S.sound,
        level: S.level === 'orig' ? goodLevel() : S.level, cursorBar: S.cursorBar, endBar: S.endBar, endInf: S.endInf, zoom: S.zoom, faders: faders },
      clips: S.clips.map(function (c) { return track(clipMeta(c, pending)); }),
      mix: S.mix.map(function (m) {
        return { name: m.name, muted: !!m.muted, sr: m.sr, data: (function () { var id = aidOf(m.data, pending); ids.push(id); return id; })(),
          clips: (m.clips || []).map(function (c) { return track(clipMeta(c, pending)); }) };
      }),
      audioIds: ids,
      takes: S.mix.length
    };
  }
  function scheduleSave() {
    if (loading || !S.songId || !window.Store) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (loading || !S.songId || S.mode === 'rec') { if (S.mode === 'rec') scheduleSave(); return; }
    var pending = [], meta = songMeta(pending);
    try {
      for (var i = 0; i < pending.length; i++) await window.Store.putAudio(pending[i][0], pending[i][1]);
      await window.Store.putSong(meta);
      try { localStorage.setItem('bli-last-song', S.songId); } catch (e) {}
    } catch (e) {
      pending.forEach(function (p) { AID.delete(p[1]); });
      setStatus('השמירה נכשלה. ייתכן שהזיכרון בטלפון מלא.');
    }
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && saveTimer) saveNow(); });

  async function loadArr(id) { if (!id) return null; var a = await window.Store.getAudio(id); if (a) AID.set(a, id); return a || null; }
  async function clipFrom(m) {
    if (m.erase) return { erase: true, punch: m.punch, endT: m.endT };
    var c = { punch: m.punch, start: m.start, latencyShift: m.latencyShift, measured: m.measured, sr: m.sr, limit: m.limit, preFrom: m.preFrom,
      cleanLevel: m.cleanLevel, useClean: m.useClean };
    c.data = await loadArr(m.data); c.s1 = await loadArr(m.s1); c.est = await loadArr(m.est);
    if (c.s1 && c.est) c.clean = window.ClickDSP.stage2(c.s1, c.est, window.ClickDSP.LEVELS[c.cleanLevel || 'strong'] || window.ClickDSP.LEVELS.strong);
    return c;
  }
  async function loadSong(id) {
    var meta = await window.Store.getSong(id);
    if (!meta) return false;
    if (S.mode !== 'idle') stop();
    loading = true;
    try {
      var st = meta.settings || {};
      S.songId = meta.id; S.songName = meta.name; S.created = meta.created || Date.now();
      ['bpm', 'meter', 'pre', 'clickOn', 'instrument', 'sound', 'level', 'cursorBar', 'endBar', 'endInf', 'zoom'].forEach(function (k) { if (st[k] !== undefined) S[k] = st[k]; });
      if (!SOUNDS[S.sound]) S.sound = 'woodtight';
      if (st.faders) Object.keys(st.faders).forEach(function (k) { var el = $(k); if (el) { el.value = st.faders[k]; el.dispatchEvent(new Event('input')); } });
      S.clips = []; for (var i = 0; i < (meta.clips || []).length; i++) S.clips.push(await clipFrom(meta.clips[i]));
      S.mix = [];
      for (i = 0; i < (meta.mix || []).length; i++) {
        var mm = meta.mix[i], cl = [];
        for (var j = 0; j < (mm.clips || []).length; j++) cl.push(await clipFrom(mm.clips[j]));
        S.mix.push({ name: mm.name, muted: mm.muted, sr: mm.sr, data: await loadArr(mm.data), clips: cl });
      }
      S.take = null; S.clips.forEach(function (c) { if (!c.erase) S.take = c; });
      S.undo = []; S.stoppedAt = cursorSec();
      invalidateWork(); invalidateMix();
      try { localStorage.setItem('bli-last-song', S.songId); } catch (e) {}
      $('zoom-val').textContent = '×' + (Math.round(S.zoom * 10) / 10);
      setStatus('״' + S.songName + '״ נפתח');
    } finally { loading = false; }
    render();
    return true;
  }
  async function newSong() {
    if (S.mode !== 'idle') stop();
    var all = []; try { all = await window.Store.allSongs(); } catch (e) {}
    S.songId = window.Store.newId(); S.created = Date.now();
    S.songName = 'שיר ' + (all.length + 1);
    S.clips = []; S.mix = []; S.take = null; S.undo = []; S.instrument = null;
    S.cursorBar = 0; S.endBar = 4; S.endInf = true; S.stoppedAt = 0;
    invalidateWork(); invalidateMix();
    setStatus('שיר חדש: ״' + S.songName + '״');
    render(); saveNow();
  }
  async function startup() {
    if (!window.Store) return;
    window.Store.persist();
    var last = null; try { last = localStorage.getItem('bli-last-song'); } catch (e) {}
    try {
      if (last && await loadSong(last)) return;
      var all = await window.Store.allSongs();
      if (all.length) { all.sort(function (a, b) { return b.updated - a.updated; }); if (await loadSong(all[0].id)) return; }
    } catch (e) {}
    newSong();
  }

  // ---------- מסך השירים ----------
  var renaming = null, confirmSongDel = null;
  async function renderSongs() {
    var all = []; try { all = await window.Store.allSongs(); } catch (e) {}
    all.sort(function (a, b) { return b.updated - a.updated; });
    $('songs-list').innerHTML = all.map(function (m) {
      var d = new Date(m.updated), st = m.settings || {};
      var when = d.getDate() + '.' + (d.getMonth() + 1) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      var nm = renaming === m.id
        ? '<input class="text-in" id="rename-in" value="' + m.name.replace(/"/g, '&quot;') + '">'
        : '<span>' + m.name.replace(/</g, '&lt;') + '</span><span class="song-meta">' + when + ' · ' + (st.bpm || '') + ' · ' + (st.meter || '') + ' · ' + (m.takes || 0) + ' במיקס</span>';
      return '<div class="mix-row' + (m.id === S.songId ? ' current' : '') + '"><span class="nm">' + nm + '</span>' +
        (renaming === m.id ? '<button class="btn" data-a="rename-ok" data-id="' + m.id + '">אישור</button>'
          : '<button class="btn" data-a="open" data-id="' + m.id + '">' + (m.id === S.songId ? 'פתוח' : 'פתיחה') + '</button>' +
            '<button class="btn" data-a="rename" data-id="' + m.id + '">שם</button>' +
            '<button class="btn" data-a="dup" data-id="' + m.id + '">שכפול</button>' +
            '<button class="btn danger" data-a="del" data-id="' + m.id + '">' + (confirmSongDel === m.id ? 'בטוח?' : 'מחיקה') + '</button>') +
        '</div>';
    }).join('') || '<div class="mix-empty">אין עדיין שירים.</div>';
    var ri = $('rename-in'); if (ri) { ri.focus(); ri.select(); }
  }
  $('songs-btn').addEventListener('click', async function () {
    if (S.mode !== 'idle') stop();
    await saveNow(); renaming = null; confirmSongDel = null;
    await renderSongs(); $('songs-sheet').hidden = false;
  });
  $('songs-close').addEventListener('click', function () { $('songs-sheet').hidden = true; });
  $('songs-sheet').addEventListener('click', function (e) { if (e.target.id === 'songs-sheet') $('songs-sheet').hidden = true; });
  $('song-new').addEventListener('click', async function () { await saveNow(); await newSong(); $('songs-sheet').hidden = true; });
  $('songs-list').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = b.dataset.id, a = b.dataset.a;
    if (a !== 'del') confirmSongDel = null;
    if (a === 'open') { if (id !== S.songId) await loadSong(id); $('songs-sheet').hidden = true; return; }
    if (a === 'rename') { renaming = id; }
    else if (a === 'rename-ok') {
      var v = ($('rename-in').value || '').trim(); renaming = null;
      if (v) { var m = await window.Store.getSong(id); m.name = v; await window.Store.putSong(m); if (id === S.songId) { S.songName = v; render(); } }
    } else if (a === 'dup') {
      var src = await window.Store.getSong(id);
      var cp = JSON.parse(JSON.stringify(src)); cp.id = window.Store.newId(); cp.name = src.name + ' (עותק)'; cp.created = cp.updated = Date.now();
      await window.Store.putSong(cp);   // הצליל עצמו משותף, לא משוכפל
    } else if (a === 'del') {
      if (confirmSongDel !== id) { confirmSongDel = id; await renderSongs(); return; }
      confirmSongDel = null;
      var all = await window.Store.allSongs(), victim = all.filter(function (x) { return x.id === id; })[0], keep = {};
      all.forEach(function (x) { if (x.id !== id) (x.audioIds || []).forEach(function (q) { keep[q] = 1; }); });
      // מוחקים רק צליל שאף שיר אחר לא משתמש בו
      if (victim) await window.Store.deleteAudio((victim.audioIds || []).filter(function (q) { return !keep[q]; }));
      await window.Store.deleteSong(id);
      if (id === S.songId) { S.songId = null; var rest = all.filter(function (x) { return x.id !== id; }); if (rest.length) { rest.sort(function (x, y) { return y.updated - x.updated; }); await loadSong(rest[0].id); } else await newSong(); }
    }
    await renderSongs();
  });
  $('songs-list').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'rename-in') { var ok = document.querySelector('[data-a="rename-ok"]'); if (ok) ok.click(); } });

  function render() {
    var app = $('app');
    $('song-name').textContent = S.songName;
    scheduleSave();
    document.documentElement.style.setProperty('--hue', hueOf(S.mix.length));
    $('mixin-btn').disabled = !(workTrack() && S.mode === 'idle');
    $('del-btn').disabled = !(workTrack() && S.mode === 'idle');
    $('undo-btn').disabled = !(S.undo.length && S.mode === 'idle');
    $('save-btn').disabled = !workTrack();
    $('mix-count').textContent = S.mix.length ? '(' + S.mix.length + ')' : '';
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
    $('latency').textContent = S.take && S.take.measured != null ? 'השהיה: ' + Math.round(S.take.measured * 1000) + 'ms' : '';
    var hasClean = S.clips.some(function (c) { return c.s1; });
    $('levels').hidden = !hasClean;
    if (hasClean) {
      var cur = S.level;
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
    if (S.mode === 'rec' && recLimit !== null && songNow() - liveLat >= recLimit + 0.05) stop();
    if (S.mode !== 'idle') {
      if (S.mode === 'rec' && songNow() >= cursorSec() && $('status').textContent.indexOf('מקליט') !== 0) setStatus('מקליט… מתיבה ' + (S.cursorBar + 1));
      draw();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', draw);
  render();
  requestAnimationFrame(frame);
  startup();
})();
