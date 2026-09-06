/* ============================================================
   Vanilla Tetris · audio.js —— Web Audio 芯片音乐与音效
   零依赖手写：
     · 背景音乐：手写音序器播放《Korobeiniki》（俄罗斯方块经典配乐）
       方波主旋律 + 三角波贝斯，lookahead 调度，循环播放
     · 音效：移动 / 旋转 / 锁定 / 消行 / Tetris / 升级 / 游戏结束
   ============================================================ */
(function () {
  'use strict';

  const TetrisAudio = (window.TetrisAudio = window.TetrisAudio || {});

  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;

  let musicOn = true;
  let sfxOn = true;
  try {
    musicOn = localStorage.getItem('pa-tetris-music') !== 'off';
    sfxOn = localStorage.getItem('pa-tetris-sfx') !== 'off';
  } catch (e) { /* 忽略 */ }

  let musicTimer = 0;
  let musicPlaying = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.85;
      musicBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* ---------- 音色 ---------- */
  function tone({ freq, time, dur, type = 'square', gain = 0.06, bus = null, slide = 0 }) {
    const c = ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(freq * slide, 20), time + dur);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.008);
    g.gain.setValueAtTime(gain, time + Math.max(dur - 0.03, 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    g.connect(bus || sfxBus);
    o.start(time);
    o.stop(time + dur + 0.03);
  }

  /* ---------- 音效 ---------- */
  function sfx(name) {
    if (!sfxOn || !ensure()) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'move': tone({ freq: 660, time: t, dur: 0.03, type: 'square', gain: 0.03 }); break;
      case 'rotate': tone({ freq: 840, time: t, dur: 0.05, type: 'square', gain: 0.035 }); break;
      case 'kick': tone({ freq: 520, time: t, dur: 0.06, type: 'square', gain: 0.035 }); break;
      case 'lock': tone({ freq: 150, time: t, dur: 0.08, type: 'triangle', gain: 0.09 }); break;
      case 'hold': tone({ freq: 500, time: t, dur: 0.07, type: 'sine', gain: 0.06 }); break;
      case 'hard': tone({ freq: 220, time: t, dur: 0.09, type: 'square', gain: 0.06, slide: 0.4 }); break;
      case 'clear': tone({ freq: 520, time: t, dur: 0.14, type: 'square', gain: 0.055, slide: 1.9 }); break;
      case 'tetris':
        [660, 830, 990, 1320].forEach((f, i) =>
          tone({ freq: f, time: t + i * 0.07, dur: 0.12, type: 'square', gain: 0.06 }));
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) =>
          tone({ freq: f, time: t + i * 0.08, dur: 0.14, type: 'triangle', gain: 0.08 }));
        break;
      case 'over':
        [392, 330, 262, 196].forEach((f, i) =>
          tone({ freq: f, time: t + i * 0.16, dur: 0.22, type: 'triangle', gain: 0.08 }));
        break;
    }
  }
  TetrisAudio.sfx = sfx;

  /* ---------- 背景音乐：《Korobeiniki》----------
     150 BPM，方波主旋律 + 三角波贝斯，32 拍一循环。 */
  const BEAT = 60 / 150;
  const LEAD = [
    // 第 1-2 小节
    [76, 1], [71, 0.5], [72, 0.5], [74, 1], [72, 0.5], [71, 0.5],
    [69, 1], [69, 0.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5],
    // 第 3-4 小节
    [71, 1.5], [72, 0.5], [74, 1], [76, 1],
    [72, 1], [69, 1], [69, 1], [0, 1],
    // 第 5-6 小节
    [0, 0.5], [74, 1], [77, 0.5], [81, 1], [79, 0.5], [77, 0.5],
    [76, 1.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5],
    // 第 7-8 小节
    [71, 1], [71, 0.5], [72, 0.5], [74, 1], [76, 1],
    [72, 1], [69, 1], [69, 2],
  ];
  const BASS_ROOTS = [45, 45, 40, 45, 50, 45, 40, 45]; // A A E A D A E A

  function buildEvents() {
    const events = [];
    let t = 0;
    for (const [midi, dur] of LEAD) {
      if (midi > 0) events.push({ t, midi, dur: dur * 0.92, ch: 'lead' });
      t += dur;
    }
    BASS_ROOTS.forEach((root, bar) => {
      for (let e = 0; e < 8; e++) {
        events.push({ t: bar * 4 + e * 0.5, midi: e % 2 ? root + 7 : root, dur: 0.42, ch: 'bass' });
      }
    });
    events.sort((a, b) => a.t - b.t);
    return events;
  }
  const EVENTS = buildEvents();
  const LOOP_BEATS = 32;

  function schedule(ev, time) {
    if (ev.ch === 'lead') {
      tone({ freq: midiFreq(ev.midi), time, dur: ev.dur * BEAT, type: 'square', gain: 0.05, bus: musicBus });
    } else {
      tone({ freq: midiFreq(ev.midi), time, dur: ev.dur * BEAT, type: 'triangle', gain: 0.075, bus: musicBus });
    }
  }

  TetrisAudio.startMusic = function () {
    if (!musicOn || musicPlaying || !ensure()) return;
    musicPlaying = true;
    let idx = 0;
    let loopStart = ctx.currentTime + 0.08;
    const loopDur = LOOP_BEATS * BEAT;
    musicTimer = setInterval(() => {
      if (!musicPlaying) return;
      const horizon = ctx.currentTime + 0.45;
      let guard = 0;
      while (guard++ < 64) {
        const ev = EVENTS[idx];
        const t = loopStart + ev.t * BEAT;
        if (t >= horizon) break;
        schedule(ev, Math.max(t, ctx.currentTime + 0.01));
        idx++;
        if (idx >= EVENTS.length) { idx = 0; loopStart += loopDur; }
      }
    }, 120);
  };

  TetrisAudio.stopMusic = function () {
    musicPlaying = false;
    clearInterval(musicTimer);
    musicTimer = 0;
  };
  TetrisAudio.pauseMusic = TetrisAudio.stopMusic;

  /* ---------- 开关 ---------- */
  function reflect() {
    if (TetrisAudio.onMusicChange) TetrisAudio.onMusicChange(musicOn);
    if (TetrisAudio.onSfxChange) TetrisAudio.onSfxChange(sfxOn);
  }

  TetrisAudio.init = function () {
    const musicBtn = document.getElementById('music-toggle');
    const sfxBtn = document.getElementById('sfx-toggle');

    function paint() {
      if (musicBtn) {
        musicBtn.classList.toggle('off', !musicOn);
        musicBtn.setAttribute('aria-pressed', String(musicOn));
      }
      if (sfxBtn) {
        sfxBtn.classList.toggle('off', !sfxOn);
        sfxBtn.setAttribute('aria-pressed', String(sfxOn));
      }
    }

    if (musicBtn) musicBtn.addEventListener('click', () => {
      musicOn = !musicOn;
      try { localStorage.setItem('pa-tetris-music', musicOn ? 'on' : 'off'); } catch (e) { /* 忽略 */ }
      if (!musicOn) TetrisAudio.stopMusic();
      paint();
      if (musicOn && TetrisAudio.wantsMusic) TetrisAudio.startMusic();
      sfx('rotate');
    });
    if (sfxBtn) sfxBtn.addEventListener('click', () => {
      sfxOn = !sfxOn;
      try { localStorage.setItem('pa-tetris-sfx', sfxOn ? 'on' : 'off'); } catch (e) { /* 忽略 */ }
      paint();
      if (sfxOn) sfx('rotate');
    });

    paint();
  };

  Object.defineProperty(TetrisAudio, 'musicOn', { get: () => musicOn });
  Object.defineProperty(TetrisAudio, 'sfxOn', { get: () => sfxOn });
})();
