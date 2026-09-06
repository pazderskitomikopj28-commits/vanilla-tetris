/* ============================================================
   Vanilla Tetris · game.js —— 游戏引擎
   现代规则（Tetris Guideline）的完整实现，零依赖：
     · SRS 超级旋转系统（含踢墙表）、7-Bag 随机、Hold、幽灵方块
     · 锁定延迟（500ms / 最多 15 次重置）、DAS/ARR 横移手感
     · 软降 / 硬降、连击（Combo）、Back-to-Back、T-Spin 三角判定
     · 消行粒子特效、屏幕微震、等级加速曲线
     · 键盘 + 触屏双操控、暂停 / 重开、最高分持久化
   调试接口：window.__tetris（供自动化测试用）
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  const COLS = 10;
  const ROWS = 20;
  const HIDDEN = 2;                 // 顶部缓冲行
  const TOTAL_ROWS = ROWS + HIDDEN;
  const DAS = 150, ARR = 40;        // 横移手感
  const LOCK_DELAY = 500;           // 锁定延迟 ms
  const MAX_LOCK_RESETS = 15;
  const CLEAR_MS = 260;             // 消行动画时长

  // SRS 基础矩阵（程序旋转出 4 个朝向）
  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  };
  const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  const COLORS = {
    I: '#22d3ee', J: '#818cf8', L: '#fb923c', O: '#fbbf24',
    S: '#34d399', T: '#a78bfa', Z: '#fb7185',
  };

  // 生成某方块某朝向的格子坐标
  const ROT_CACHE = {};
  function shapeCells(type, rot) {
    const key = type + rot;
    if (ROT_CACHE[key]) return ROT_CACHE[key];
    let m = SHAPES[type].map((r) => r.slice());
    for (let i = 0; i < rot; i++) {
      const n = m.length;
      // 顺时针旋转矩阵
      const out = Array.from({ length: n }, () => Array(n).fill(0));
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x][n - 1 - y] = m[y][x];
      m = out;
    }
    const cells = [];
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m.length; x++) {
        if (m[y][x]) cells.push([x, y]);
      }
    }
    ROT_CACHE[key] = cells;
    return cells;
  }

  // SRS 踢墙表（屏幕坐标，y 向下为正；由标准表翻转 y 得到）
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  };

  /* ---------- DOM ---------- */
  const $ = (s) => document.querySelector(s);
  const boardCanvas = $('#board');
  const holdCanvas = $('#hold-canvas');
  const nextCanvas = $('#next-canvas');
  const overlay = $('#overlay');
  const ovTitle = $('.ov-title', document);
  const ovDesc = $('.ov-desc', document);
  const ovAction = $('#ov-action');
  const hud = {
    score: $('#hud-score'), best: $('#hud-best'), level: $('#hud-level'),
    lines: $('#hud-lines'), comboRow: $('#hud-combo-row'), combo: $('#hud-combo'),
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 游戏状态 ---------- */
  let board = [];        // TOTAL_ROWS x COLS，0 为空，否则为类型索引+1
  let state = 'ready';   // ready | running | clearing | paused | over
  let cur = null;        // { type, rot, x, y }
  let queue = [];        // 接下来的方块 id
  let bag = [];
  let holdId = null;
  let canHold = true;

  let score = 0, lines = 0, level = 1, combo = -1, lastQualifying = false;
  let best = 0;
  try { best = Number(localStorage.getItem('pa-tetris-best')) || 0; } catch (e) { /* 忽略 */ }

  let gravAcc = 0, softHeld = false;
  let grounded = false, lockTimer = 0, lockResets = 0, lowestY = 0;
  let lastMoveWasRotate = false, lastKickIndex = 0;
  let clearRows = [], clearTimer = 0;
  let shakeT = 0, banner = null; // banner: { text, t }
  let particles = [];

  const keys = { left: { held: false, t: 0, arr: 0 }, right: { held: false, t: 0, arr: 0 } };

  /* ---------- 工具 ---------- */
  const gravMs = () => Math.max(16, Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000);

  function refillBag() {
    const b = [0, 1, 2, 3, 4, 5, 6];
    for (let i = b.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [b[i], b[j]] = [b[j], b[i]];
    }
    bag.push(...b);
  }
  function nextId() {
    if (bag.length < 7) refillBag();
    return bag.shift();
  }

  function reset() {
    board = Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(0));
    bag = []; queue = [];
    for (let i = 0; i < 6; i++) queue.push(nextId());
    holdId = null; canHold = true;
    score = 0; lines = 0; level = 1; combo = -1; lastQualifying = false;
    gravAcc = 0; softHeld = false;
    clearRows = []; clearTimer = 0;
    particles = []; banner = null; shakeT = 0;
    keys.left = { held: false, t: 0, arr: 0 };
    keys.right = { held: false, t: 0, arr: 0 };
    spawn();
    updateHud();
  }

  function spawn(id) {
    const type = TYPES[id !== undefined ? id : queue.shift()];
    if (id === undefined) queue.push(nextId());
    const size = SHAPES[type].length;
    cur = { type, rot: 0, x: Math.floor((COLS - size) / 2), y: 0 };
    grounded = false; lockTimer = 0; lockResets = 0; lowestY = 0;
    lastMoveWasRotate = false;
    if (collides(cur.type, cur.rot, cur.x, cur.y)) {
      gameOver();
      return false;
    }
    return true;
  }

  function cellAt(x, y) {
    if (x < 0 || x >= COLS || y >= TOTAL_ROWS) return true; // 墙与地板
    if (y < 0) return false;                                 // 顶部之上为空
    return board[y][x] !== 0;
  }
  function collides(type, rot, px, py) {
    const cells = shapeCells(type, rot);
    for (const [cx, cy] of cells) {
      if (cellAt(px + cx, py + cy)) return true;
    }
    return false;
  }

  /* ---------- 操作 ---------- */
  function tryMove(dx, dy, silent) {
    if (!cur) return false;
    if (collides(cur.type, cur.rot, cur.x + dx, cur.y + dy)) return false;
    cur.x += dx; cur.y += dy;
    if (dx !== 0) {
      lastMoveWasRotate = false;
      if (!silent) TetrisAudio.sfx('move');
    }
    onPieceMoved();
    return true;
  }

  function tryRotate(dir) { // dir: 1 顺 / -1 逆
    if (!cur || cur.type === 'O') { if (cur && cur.type === 'O') TetrisAudio.sfx('rotate'); return; }
    const from = cur.rot;
    const to = (cur.rot + dir + 4) % 4;
    const table = cur.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${from}>${to}`] || [[0, 0]];
    for (let i = 0; i < kicks.length; i++) {
      const [dx, dy] = kicks[i];
      if (!collides(cur.type, to, cur.x + dx, cur.y + dy)) {
        cur.rot = to; cur.x += dx; cur.y += dy;
        lastMoveWasRotate = true; lastKickIndex = i;
        TetrisAudio.sfx(i > 0 ? 'kick' : 'rotate');
        onPieceMoved();
        return;
      }
    }
  }

  function holdSwap() {
    if (!cur || !canHold) return;
    const curId = TYPES.indexOf(cur.type);
    const swapId = holdId;
    holdId = curId;
    canHold = false;
    TetrisAudio.sfx('hold');
    if (swapId === null) spawn();
    else spawn(swapId);
    updateHud();
  }

  function ghostY() {
    if (!cur) return 0;
    let y = cur.y;
    while (!collides(cur.type, cur.rot, cur.x, y + 1)) y++;
    return y;
  }

  function hardDrop() {
    if (!cur) return;
    const gy = ghostY();
    const dist = gy - cur.y;
    if (dist > 0) {
      score += dist * 2;
      cur.y = gy;
    }
    TetrisAudio.sfx('hard');
    shakeT = 90;
    lockPiece();
  }

  /* ---------- 锁定 / 消行 / 计分 ---------- */
  function tSpinCheck() {
    // T-Spin 三角判定：最后一动是旋转 + 至少 3 个角被占
    if (!cur || cur.type !== 'T' || !lastMoveWasRotate) return { spin: false, mini: false };
    const cx = cur.x + 1, cy = cur.y + 1; // 3x3 盒中心
    const occ = (x, y) => x < 0 || x >= COLS || y >= TOTAL_ROWS || (y >= 0 && board[y][x] !== 0);
    const c = {
      tl: occ(cx - 1, cy - 1), tr: occ(cx + 1, cy - 1),
      bl: occ(cx - 1, cy + 1), br: occ(cx + 1, cy + 1),
    };
    const total = (c.tl ? 1 : 0) + (c.tr ? 1 : 0) + (c.bl ? 1 : 0) + (c.br ? 1 : 0);
    if (total < 3) return { spin: false, mini: false };
    // 朝前的两个角（按朝向）
    const fronts = [
      [c.tl, c.tr], [c.tr, c.br], [c.br, c.bl], [c.bl, c.tl],
    ][cur.rot];
    const frontFilled = (fronts[0] ? 1 : 0) + (fronts[1] ? 1 : 0);
    const full = frontFilled === 2 || lastKickIndex === 4;
    return { spin: true, mini: !full };
  }

  function lockPiece() {
    const cells = shapeCells(cur.type, cur.rot);
    let aboveVisible = true;
    for (const [cx, cy] of cells) {
      const y = cur.y + cy, x = cur.x + cx;
      if (y >= HIDDEN) aboveVisible = false;
      if (y >= 0) board[y][x] = TYPES.indexOf(cur.type) + 1;
    }
    TetrisAudio.sfx('lock');
    if (aboveVisible) { gameOver(); return; } // 全部锁在可视区之外

    // 找满行
    clearRows = [];
    for (let y = 0; y < TOTAL_ROWS; y++) {
      if (board[y].every((c) => c !== 0)) clearRows.push(y);
    }

    const spin = tSpinCheck();
    const n = clearRows.length;
    applyScore(spin, n);

    canHold = true;
    cur = null;

    if (n > 0) {
      state = 'clearing';
      clearTimer = CLEAR_MS;
      spawnClearParticles();
      TetrisAudio.sfx(n === 4 ? 'tetris' : 'clear');
      if (n === 4) shakeT = Math.max(shakeT, 140);
    } else if (spin.spin) {
      if (spin.mini) showBanner('T-SPIN MINI');
      else showBanner('T-SPIN');
    }

    if (state !== 'clearing') {
      spawn() || updateHud();
      updateHud();
    }
  }

  function applyScore(spin, n) {
    let base = 0;
    if (spin.spin) base = spin.mini ? (n === 0 ? 100 : 200) : [400, 800, 1200, 1600][n];
    else base = [0, 100, 300, 500, 800][n];

    const qualifies = n === 4 || (spin.spin && n > 0);
    let mult = 1;
    if (qualifies && lastQualifying) mult = 1.5; // Back-to-Back
    lastQualifying = qualifies;

    let gained = Math.round(base * level * mult);

    if (n > 0) {
      combo++;
      if (combo >= 1) gained += 50 * combo * level;
    } else {
      combo = -1;
    }

    score += gained;
    lines += n;
    const newLevel = 1 + Math.floor(lines / 10);
    if (newLevel > level) {
      level = newLevel;
      showBanner(`LEVEL ${level}`);
      TetrisAudio.sfx('levelup');
    }
    if (score > best) {
      best = score;
      try { localStorage.setItem('pa-tetris-best', String(best)); } catch (e) { /* 忽略 */ }
    }
    updateHud();
  }

  function collapseRows() {
    for (const y of clearRows) {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(0));
    }
    clearRows = [];
  }

  /* ---------- 粒子 / 特效 ---------- */
  function spawnClearParticles() {
    if (reducedMotion) return;
    for (const y of clearRows) {
      for (let i = 0; i < 12; i++) {
        particles.push({
          x: Math.random() * COLS,
          y: y - HIDDEN + 0.5,
          vx: (Math.random() - 0.5) * 14,
          vy: -Math.random() * 10 - 2,
          life: 1,
          size: 2 + Math.random() * 3,
          color: ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24'][(Math.random() * 4) | 0],
        });
      }
    }
  }
  function showBanner(text) { banner = { text, t: 1300 }; }

  /* ---------- 主循环 ---------- */
  let raf = 0;
  let lastT = 0;

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(now - lastT, 80);
    lastT = now;
    update(dt, now);
    render(now);
  }

  function update(dt, now) {
    // 粒子在 clearing / running 时都更新
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vy += (30 * dt) / 1000;
      p.life -= dt / 620;
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (shakeT > 0) shakeT -= dt;
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

    if (state === 'clearing') {
      clearTimer -= dt;
      if (clearTimer <= 0) {
        collapseRows();
        state = 'running';
        if (!spawn()) return;
        updateHud();
      }
      return;
    }

    if (state !== 'running' || !cur) return;

    // DAS / ARR 横移
    for (const dir of ['left', 'right']) {
      const k = keys[dir];
      if (!k.held) continue;
      k.t += dt;
      if (k.t > DAS) {
        k.arr += dt;
        while (k.arr > ARR) {
          k.arr -= ARR;
          tryMove(dir === 'left' ? -1 : 1, 0, true);
        }
      }
    }

    // 重力（软降加速）
    const interval = softHeld ? Math.min(35, gravMs()) : gravMs();
    gravAcc += dt;
    while (gravAcc >= interval) {
      gravAcc -= interval;
      if (!collides(cur.type, cur.rot, cur.x, cur.y + 1)) {
        cur.y++;
        if (softHeld) score += 1;
        if (cur.y > lowestY) { lowestY = cur.y; lockResets = 0; }
        lastMoveWasRotate = false;
      } else {
        gravAcc = 0;
        break;
      }
    }

    // 锁定延迟
    if (collides(cur.type, cur.rot, cur.x, cur.y + 1)) {
      grounded = true;
      lockTimer += dt;
      if (lockTimer >= LOCK_DELAY) lockPiece();
    } else {
      grounded = false;
      lockTimer = 0;
    }
  }

  function onPieceMoved() {
    // 落地状态下的移动会重置锁定延迟（有上限）
    if (grounded && lockResets < MAX_LOCK_RESETS) {
      lockTimer = 0;
      lockResets++;
    }
  }

  /* ---------- 渲染 ---------- */
  const bctx = boardCanvas.getContext('2d');
  const hctx = holdCanvas.getContext('2d');
  const nctx = nextCanvas.getContext('2d');
  let cell = 28, dpr = 1;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const w = boardCanvas.clientWidth || 300;
    cell = Math.max(12, Math.floor(w / COLS));
    boardCanvas.width = cell * COLS * dpr;
    boardCanvas.height = cell * ROWS * dpr;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resizeMini(holdCanvas, hctx, 4, 3);
    resizeMini(nextCanvas, nctx, 4, 15);
    renderMiniHold();
    renderMiniNext();
  }
  function resizeMini(canvas, ctx, cols, rows) {
    const w = canvas.clientWidth || 96;
    const c = Math.max(10, Math.floor(w / cols / 1.6));
    canvas.width = cols * c * 1.6 * dpr;
    canvas.height = rows * c * 1.6 * dpr;
    canvas._cell = c * 1.6;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawCell(ctx, px, py, size, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(px + 1, py + 1, size - 2, size - 2, size * 0.18);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath();
      ctx.roundRect(px + 3, py + 3, size - 6, (size - 6) * 0.42, size * 0.12);
      ctx.fill();
    } else {
      ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawPieceAt(ctx, type, rot, px, py, size, alpha = 1) {
    const color = COLORS[type];
    for (const [cx, cy] of shapeCells(type, rot)) {
      drawCell(ctx, px + cx * size, py + cy * size, size, color, alpha);
    }
  }

  function render(now) {
    const W = cell * COLS, H = cell * ROWS;
    bctx.clearRect(0, 0, W, H);
    bctx.fillStyle = '#0b1020';
    bctx.fillRect(0, 0, W, H);

    // 屏幕微震
    bctx.save();
    if (shakeT > 0 && !reducedMotion) {
      const s = (shakeT / 90) * 3;
      bctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    // 网格
    bctx.strokeStyle = 'rgba(255,255,255,.045)';
    bctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      bctx.beginPath(); bctx.moveTo(x * cell, 0); bctx.lineTo(x * cell, H); bctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      bctx.beginPath(); bctx.moveTo(0, y * cell); bctx.lineTo(W, y * cell); bctx.stroke();
    }

    // 已固定的方块
    for (let y = HIDDEN; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = board[y][x];
        if (v) drawCell(bctx, x * cell, (y - HIDDEN) * cell, cell, COLORS[TYPES[v - 1]]);
      }
    }

    // 消行闪烁
    if (state === 'clearing') {
      const a = 0.55 + Math.sin(now / 40) * 0.35;
      bctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      for (const y of clearRows) {
        bctx.fillRect(0, (y - HIDDEN) * cell, W, cell);
      }
    }

    // 幽灵方块 + 当前方块
    if (cur && (state === 'running' || state === 'paused')) {
      const gy = ghostY();
      if (gy !== cur.y) {
        const color = COLORS[cur.type];
        for (const [cx, cy] of shapeCells(cur.type, cur.rot)) {
          const px = (cur.x + cx) * cell, py = (gy + cy - HIDDEN) * cell;
          if (gy + cy < HIDDEN) continue;
          bctx.strokeStyle = color;
          bctx.globalAlpha = 0.45;
          bctx.lineWidth = 2;
          if (bctx.roundRect) {
            bctx.beginPath();
            bctx.roundRect(px + 2, py + 2, cell - 4, cell - 4, cell * 0.18);
            bctx.stroke();
          } else {
            bctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
          }
          bctx.globalAlpha = 1;
        }
      }
      drawPieceAt(bctx, cur.type, cur.rot, cur.x * cell, (cur.y - HIDDEN) * cell, cell);
    }

    // 粒子
    for (const p of particles) {
      bctx.globalAlpha = Math.max(p.life, 0);
      bctx.fillStyle = p.color;
      bctx.fillRect(p.x * cell, p.y * cell, p.size, p.size);
    }
    bctx.globalAlpha = 1;

    // 顶部渐隐遮罩（缓冲区边界提示）
    const grad = bctx.createLinearGradient(0, 0, 0, cell * 0.9);
    grad.addColorStop(0, 'rgba(11,16,32,.9)');
    grad.addColorStop(1, 'rgba(11,16,32,0)');
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, W, cell * 0.9);

    // 升级 / T-Spin 横幅
    if (banner) {
      const a = Math.min(banner.t / 300, 1);
      bctx.globalAlpha = a;
      bctx.fillStyle = 'rgba(10,14,26,.72)';
      bctx.fillRect(0, H / 2 - cell * 1.1, W, cell * 2.2);
      bctx.fillStyle = '#22d3ee';
      bctx.font = `800 ${Math.round(cell * 0.95)}px ${'system-ui, sans-serif'}`;
      bctx.textAlign = 'center';
      bctx.textBaseline = 'middle';
      bctx.fillText(banner.text, W / 2, H / 2);
      bctx.globalAlpha = 1;
    }

    bctx.restore();
  }

  function renderMiniHold() {
    const c = holdCanvas._cell || 24;
    const W = holdCanvas.width / dpr, H = holdCanvas.height / dpr;
    hctx.clearRect(0, 0, W, H);
    if (holdId === null) {
      hctx.fillStyle = 'rgba(139,147,167,.4)';
      hctx.font = `600 12px ${'system-ui, sans-serif'}`;
      hctx.textAlign = 'center';
      hctx.fillText('空（C 键）', W / 2, H / 2);
      return;
    }
    const type = TYPES[holdId];
    const cells = shapeCells(type, 0);
    const minX = Math.min(...cells.map((p) => p[0])), maxX = Math.max(...cells.map((p) => p[0]));
    const minY = Math.min(...cells.map((p) => p[1])), maxY = Math.max(...cells.map((p) => p[1]));
    const w = (maxX - minX + 1) * c, h = (maxY - minY + 1) * c;
    drawPieceAt(hctx, type, 0, (W - w) / 2 - minX * c, (H - h) / 2 - minY * c, c, canHold ? 1 : 0.35);
  }

  function renderMiniNext() {
    const c = nextCanvas._cell || 24;
    const W = nextCanvas.width / dpr, H = nextCanvas.height / dpr;
    nctx.clearRect(0, 0, W, H);
    const slotH = H / 5;
    queue.slice(0, 5).forEach((id, i) => {
      const type = TYPES[id];
      const cells = shapeCells(type, 0);
      const minX = Math.min(...cells.map((p) => p[0])), maxX = Math.max(...cells.map((p) => p[0]));
      const minY = Math.min(...cells.map((p) => p[1])), maxY = Math.max(...cells.map((p) => p[1]));
      const w = (maxX - minX + 1) * c, h = (maxY - minY + 1) * c;
      drawPieceAt(nctx, type, 0, (W - w) / 2 - minX * c, slotH * i + (slotH - h) / 2 - minY * c, c, i === 0 ? 1 : 0.75);
    });
  }

  /* ---------- HUD 与覆盖层 ---------- */
  function updateHud() {
    hud.score.textContent = score.toLocaleString('zh-CN');
    hud.best.textContent = best.toLocaleString('zh-CN');
    hud.level.textContent = String(level);
    hud.lines.textContent = String(lines);
    if (combo >= 1) {
      hud.comboRow.hidden = false;
      hud.combo.textContent = `×${combo}`;
    } else {
      hud.comboRow.hidden = true;
    }
    if (cur) { renderMiniHold(); renderMiniNext(); }
  }

  function showOverlay(title, desc, btnText, extraHtml) {
    ovTitle.textContent = title;
    ovDesc.textContent = desc;
    ovAction.textContent = btnText;
    let extra = $('.ov-extra', overlay);
    if (extra) extra.remove();
    if (extraHtml) {
      extra = document.createElement('div');
      extra.className = 'ov-extra';
      extra.innerHTML = extraHtml; // 内部固定文案，无用户输入
      ovAction.before(extra);
    }
    overlay.classList.remove('hidden');
  }
  function hideOverlay() { overlay.classList.add('hidden'); }

  function showReady() {
    showOverlay('准备好了吗？', 'SRS 踢墙 · 7-BAG · HOLD · T-SPIN', '开始游戏');
    state = 'ready';
  }
  function showPause() {
    showOverlay('已暂停', '音乐已同时暂停', '继续游戏');
  }
  function showOver() {
    const isNewBest = score > 0 && score >= best;
    showOverlay(
      '游戏结束',
      `消除了 ${lines} 行 · 到达等级 ${level}`,
      '再来一局',
      `<p class="ov-score mono">${score.toLocaleString('zh-CN')}</p>` +
      (isNewBest ? '<p class="ov-newbest mono">★ 新纪录！</p>' : `<p class="ov-hint mono">最高 ${best.toLocaleString('zh-CN')}</p>`)
    );
  }

  function startGame() {
    reset();
    state = 'running';
    hideOverlay();
    TetrisAudio.wantsMusic = true;
    TetrisAudio.startMusic();
    updateHud();
  }
  function pauseGame() {
    if (state !== 'running' && state !== 'clearing') return;
    state = state === 'clearing' ? 'clearing' : 'paused';
    if (state === 'paused') { showPause(); TetrisAudio.stopMusic(); }
  }
  function resumeGame() {
    if (state !== 'paused') return;
    state = 'running';
    hideOverlay();
    if (TetrisAudio.musicOn) TetrisAudio.startMusic();
    lastT = performance.now();
  }
  function togglePause() {
    if (state === 'paused') resumeGame();
    else pauseGame();
  }
  function gameOver() {
    state = 'over';
    cur = null;
    TetrisAudio.stopMusic();
    TetrisAudio.sfx('over');
    showOver();
    updateHud();
  }

  /* ---------- 输入：键盘 ---------- */
  const GAME_KEYS = ['arrowleft', 'arrowright', 'arrowdown', 'arrowup', ' ', 'x', 'z', 'c', 'p', 'r', 'escape', 'shift'];

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (!GAME_KEYS.includes(k)) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    e.preventDefault();

    if (state === 'ready' || state === 'over') {
      if (k === ' ' || k === 'r') startGame();
      return;
    }
    if (k === 'p' || k === 'escape') { togglePause(); return; }
    if (k === 'r') { startGame(); return; }
    if (state === 'paused') return;
    if (state !== 'running' || !cur) return;

    if (k === 'arrowleft' && !e.repeat && !keys.left.held) {
      keys.left = { held: true, t: 0, arr: 0 };
      tryMove(-1, 0);
    } else if (k === 'arrowright' && !e.repeat && !keys.right.held) {
      keys.right = { held: true, t: 0, arr: 0 };
      tryMove(1, 0);
    } else if (k === 'arrowdown') {
      softHeld = true;
    } else if (!e.repeat) {
      if (k === 'arrowup' || k === 'x') tryRotate(1);
      else if (k === 'z') tryRotate(-1);
      else if (k === ' ') hardDrop();
      else if (k === 'c' || k === 'shift') holdSwap();
    }
  });

  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft') keys.left.held = false;
    else if (k === 'arrowright') keys.right.held = false;
    else if (k === 'arrowdown') softHeld = false;
  });

  /* ---------- 输入：触屏 ---------- */
  const touchBox = $('#touch-controls');
  let touchRepeat = 0;
  if (touchBox) {
    touchBox.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      const act = btn.dataset.act;
      if (state === 'ready' || state === 'over') { startGame(); return; }
      if (state !== 'running' || !cur) return;
      if (act === 'left' || act === 'right') {
        tryMove(act === 'left' ? -1 : 1, 0);
        clearInterval(touchRepeat);
        touchRepeat = setInterval(() => {
          if (state === 'running') tryMove(act === 'left' ? -1 : 1, 0, true);
        }, 110);
      } else if (act === 'rotate') tryRotate(1);
      else if (act === 'hold') holdSwap();
      else if (act === 'drop') hardDrop();
      else if (act === 'down') softHeld = true;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
      touchBox.addEventListener(ev, () => {
        clearInterval(touchRepeat);
        softHeld = false;
      })
    );
  }

  /* ---------- 按钮 ---------- */
  ovAction.addEventListener('click', () => {
    if (state === 'ready' || state === 'over') startGame();
    else if (state === 'paused') resumeGame();
  });
  $('#pause-btn').addEventListener('click', (e) => { togglePause(); e.currentTarget.blur(); });
  $('#restart-btn').addEventListener('click', (e) => { startGame(); e.currentTarget.blur(); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });
  addEventListener('blur', () => pauseGame());

  /* ---------- 启动 ---------- */
  TetrisAudio.init();
  addEventListener('resize', resize);
  reset();
  resize();
  showReady();
  // 主循环常开：ready 状态也渲染棋盘（呼吸的空板面）
  lastT = performance.now();
  raf = requestAnimationFrame(loop);

  /* ---------- 调试接口（自动化测试用） ---------- */
  window.__tetris = {
    get state() { return state; },
    get score() { return score; },
    get lines() { return lines; },
    get level() { return level; },
    get combo() { return combo; },
    get holdId() { return holdId; },
    get canHold() { return canHold; },
    get queue() { return queue.slice(); },
    board: () => board.map((r) => r.slice()),
    start: startGame,
    pause: pauseGame,
    resume: resumeGame,
    move: (dx) => tryMove(dx, 0, true),
    rotate: (d) => tryRotate(d),
    hardDrop,
    holdSwap,
    debugFillRow(y, exceptCol = -1) {
      for (let x = 0; x < COLS; x++) {
        if (x !== exceptCol) board[y][x] = 1;
      }
    },
  };
})();
