/* eslint-disable */
// @ts-nocheck
/**
 * PhysLab 内核（由原 index.html 中的脚本迁移而来，功能完整保留）。
 * 在原有基础上新增：第 11 节“插件运行时”及若干扩展点（PL.*）。
 */
export default function bootPhysLab(host) {

/* 页面原始源码快照：用于“导出本配置网页”。必须在任何 DOM 改动之前获取。 */
const PRISTINE_HTML = host.pristineHtml || document.documentElement.outerHTML;

/* =====================================================================
 * 0. 工具
 * ===================================================================== */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const safeName = s => String(s || '未命名').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 存储不可用时静默 */ } }
};
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function toast(msg, type) {
  const t = document.createElement('div'); t.className = 'toast ' + (type || ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 2800); setTimeout(() => t.remove(), 3300);
}
function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
function mdLite(s) {
  return esc(s).split(/\n/).map(l => {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^#{1,6}\s*/.test(l)) return '<h4>' + l.replace(/^#{1,6}\s*/, '') + '</h4>';
    if (/^\s*[-*]\s+/.test(l)) return '<div>• ' + l.replace(/^\s*[-*]\s+/, '') + '</div>';
    return l.trim() ? '<div>' + l + '</div>' : '<div style="height:6px"></div>';
  }).join('');
}
const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>'
};

/* =====================================================================
 * 1. 表达式解析：支持 √3/3、2√2、π/6、3/8、sin(30°)、tan37°、2^0.5
 * ===================================================================== */
const Expr = (() => {
  const D2R = Math.PI / 180; let approx = true;
  function trig(fn, x) {
    if (approx) {
      const d = x / D2R;
      if (Math.abs(d - 37) < 1e-7) return fn === 'sin' ? 0.6 : fn === 'cos' ? 0.8 : 0.75;
      if (Math.abs(d - 53) < 1e-7) return fn === 'sin' ? 0.8 : fn === 'cos' ? 0.6 : 4 / 3;
    }
    return Math[fn](x);
  }
  const FN = { sqrt: Math.sqrt, abs: Math.abs, asin: Math.asin, acos: Math.acos, atan: Math.atan, sin: x => trig('sin', x), cos: x => trig('cos', x), tan: x => trig('tan', x) };
  function tokenize(src) {
    const s = String(src).replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/[×·•]/g, '*').replace(/[÷／]/g, '/')
      .replace(/[－−–—]/g, '-').replace(/＋/g, '+').replace(/[Ππ]/g, 'pi').replace(/²/g, '^2').replace(/³/g, '^3');
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const em = /^[eE][+-]?\d+/.exec(s.slice(j)); if (em && /\d$/.test(s.slice(i, j))) j += em[0].length;   // 科学计数法：2e-3
        const n = Number(s.slice(i, j)); if (!isFinite(n)) throw new Error('数字格式错误'); out.push({ t: 'n', v: n }); i = j; }
      else if (/[a-zA-Z]/.test(c)) { let j = i; while (j < s.length && /[a-zA-Z]/.test(s[j])) j++; out.push({ t: 'id', v: s.slice(i, j).toLowerCase() }); i = j; }
      else if ('+-*/^()√°'.indexOf(c) >= 0) { out.push({ t: c }); i++; }
      else throw new Error('无法识别的字符 “' + c + '”');
    }
    return out;
  }
  function parse(src) {
    const tk = tokenize(src); let p = 0;
    if (!tk.length) throw new Error('请输入数值');
    const peek = () => tk[p], next = () => tk[p++];
    function expr() { let v = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const o = next().t, r = term(); v = o === '+' ? v + r : v - r; } return v; }
    function term() {
      let v = unary();
      for (;;) {
        const k = peek(); if (!k) break;
        if (k.t === '*' || k.t === '/') { next(); const r = unary(); v = k.t === '*' ? v * r : v / r; }
        else if (k.t === 'id' || k.t === '(' || k.t === '√') v *= power();   // 隐式乘法：2√3、2π、3sin(…)
        else break;
      }
      return v;
    }
    function unary() { const k = peek(); if (k && (k.t === '-' || k.t === '+')) { next(); const v = unary(); return k.t === '-' ? -v : v; } return power(); }
    function power() { const b = postfix(); if (peek() && peek().t === '^') { next(); return Math.pow(b, unary()); } return b; }
    function postfix() { let v = primary(); while (peek() && peek().t === '°') { next(); v *= D2R; } return v; }
    function closeParen() { const c = next(); if (!c || c.t !== ')') throw new Error('缺少右括号'); }
    function primary() {
      const k = next(); if (!k) throw new Error('表达式不完整');
      if (k.t === 'n') return k.v;
      if (k.t === '(') { const v = expr(); closeParen(); return v; }
      if (k.t === '√') { const v = postfix(); if (v < 0) throw new Error('根号下不能为负'); return Math.sqrt(v); }
      if (k.t === 'id') {
        if (k.v === 'pi') return Math.PI;
        if (FN[k.v]) { let a; if (peek() && peek().t === '(') { next(); a = expr(); closeParen(); } else a = postfix(); return FN[k.v](a); }
        throw new Error('未知符号 “' + k.v + '”');
      }
      throw new Error('表达式语法错误');
    }
    const v = expr();
    if (p < tk.length) throw new Error('表达式语法错误');
    if (!isFinite(v)) throw new Error('结果不是有限数');
    return v;
  }
  return { eval: parse, setApprox(v) { approx = !!v; } };
})();

/* 数值 → 精确形式（分数、根式、π 的倍数、a+b√n） */
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
function fracOf(v, maxQ) { for (let q = 1; q <= maxQ; q++) { const p = Math.round(v * q); if (p !== 0 && Math.abs(v * q - p) < 1e-9 * Math.max(1, Math.abs(p))) return [p, q]; } return null; }
const exactCache = new Map();
function exactForm(x) {
  if (!isFinite(x)) return null;
  const key = x.toPrecision(13); if (exactCache.has(key)) return exactCache.get(key);
  const r = exactRaw(x); if (exactCache.size > 4000) exactCache.clear(); exactCache.set(key, r); return r;
}
function exactRaw(x) {
  const ax = Math.abs(x), sg = x < 0 ? '-' : '';
  if (ax < 1e-12) return '0'; if (ax > 1e5) return null;
  let f = fracOf(ax, 60); if (f) return sg + (f[1] === 1 ? f[0] : f[0] + '/' + f[1]);
  f = fracOf(ax * ax, 60);
  if (f && f[0] < 2e5) {                       // x = √(p/q) = s√n / q
    let n = f[0] * f[1], s = 1, q = f[1];
    for (let k = Math.floor(Math.sqrt(n)); k >= 2; k--) if (n % (k * k) === 0) { s = k; n /= k * k; break; }
    const g = gcd(s, q); s /= g; q /= g;
    return sg + (s === 1 ? '' : s) + '√' + n + (q === 1 ? '' : '/' + q);
  }
  f = fracOf(ax / Math.PI, 24); if (f) return sg + (f[0] === 1 ? '' : f[0]) + 'π' + (f[1] === 1 ? '' : '/' + f[1]);
  for (const n of [2, 3, 5, 6, 7, 10]) {
    const r = Math.sqrt(n);
    for (let c = 1; c <= 6; c++) for (let b = 1; b <= 6; b++) for (const sb of [1, -1]) {
      const a = Math.round(ax * c - sb * b * r);
      if (a !== 0 && Math.abs(a) <= 60 && Math.abs(ax * c - sb * b * r - a) < 1e-9 && gcd(gcd(a, b), c) === 1) {
        const bs = (b === 1 ? '' : b) + '√' + n;
        const core = sb > 0 ? (a > 0 ? a + '+' + bs : bs + '-' + (-a)) : (a + '-' + bs);
        return c === 1 ? (sg ? '-(' + core + ')' : core) : sg + '(' + core + ')/' + c;
      }
    }
  }
  return null;
}
function nfix(x, d) { if (x == null || !isFinite(x)) return '—'; let s = x.toFixed(d == null ? 3 : d); if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' ? '0' : s; }
/* 展示用：有限小数直接显示；否则尽量给出 “精确形式 ≈ 小数” */
function fmt(x, d) {
  if (x == null || !isFinite(x)) return '—';
  const r = Math.round(x * 1e4) / 1e4;
  if (Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x))) return nfix(r, 4);
  const e = exactForm(x); return e ? e + ' ≈ ' + nfix(x, d == null ? 3 : d) : nfix(x, d == null ? 3 : d);
}

/* =====================================================================
 * 2. 模型注册表（扩展点：新增参数 / 例题 / 模型都在这里）
 * ===================================================================== */
const COMMON_PARAMS = [
  { key: 'g', sym: 'g', name: '重力加速度', unit: 'm/s²', def: '10', group: '环境', pos: true },
  { key: 'theta', sym: 'θ', name: '倾斜角', unit: '°', def: '0', group: '环境', kind: 'angle', hint: '填度数（30、37），含 π 则按弧度（π/6）', ai: '以度为单位，水平填 "0"' },
  { key: 'tMax', sym: 't<sub>max</sub>', name: '最长模拟时间', unit: 's', def: '10', group: '环境', pos: true }
];
const BLOCK_PARAMS = (muName, x0Name) => [
  { key: 'm', sym: 'm', name: '物块质量', unit: 'kg', def: '1', group: '物块', pos: true },
  { key: 'x0', sym: 'x<sub>0</sub>', name: x0Name, unit: 'm', def: '0', group: '物块', nonneg: true, ai: '从左端(底端)量起；放在右端(顶端)时等于 L' },
  { key: 'v0', sym: 'v<sub>0</sub>', name: '物块初速度', unit: 'm/s', def: '0', group: '物块', ai: '带符号，向右/沿斜面向上为正' },
  { key: 'mu1', sym: 'μ' + (muName ? '<sub>1</sub>' : ''), name: muName || '动摩擦因数', unit: '', def: '0.2', group: '物块', nonneg: true },
  { key: 'Fb', sym: 'F', name: '物块所受外力（沿接触面）', unit: 'N', def: '0', group: '外力', ai: '带符号，无外力填 "0"' },
  { key: 'FbT', sym: 't<sub>F</sub>', name: '外力作用时长', unit: 's', def: '', group: '外力', optional: true, nonneg: true, hint: '留空 = 一直作用', ai: '留空字符串表示一直作用；填数值表示该时刻撤去' }
];
const MODELS = {
  belt: {
    id: 'belt', name: '传送带模型', short: '传送带', carrier: '传送带',
    params: [...COMMON_PARAMS,
      { key: 'L', sym: 'L', name: '传送带长度', unit: 'm', def: '10', group: '传送带', pos: true },
      { key: 'beltV', sym: 'v<sub>带</sub>', name: '传送带速度（稳定值）', unit: 'm/s', def: '2', group: '传送带', hint: '正 = 上表面向右 / 沿斜面向上', ai: '上表面运行速度，带符号：向右/沿斜面向上为正，沿斜面向下运行填负值' },
      { key: 'beltA', sym: 'a<sub>带</sub>', name: '启动加速度大小', unit: 'm/s²', def: '0', group: '传送带', nonneg: true, hint: '0 = 始终匀速', ai: '0 表示传送带始终以 beltV 匀速；>0 表示从 beltV0 匀变速到 beltV 后保持' },
      { key: 'beltV0', sym: 'v<sub>带0</sub>', name: '传送带初速度', unit: 'm/s', def: '0', group: '传送带', hint: '仅启动加速度 ≠ 0 时有效' },
      ...BLOCK_PARAMS('', '初始位置（距左/底端）')],
    presets: [
      { name: '水平传送带·轻放物块', params: { L: '10', beltV: '2', mu1: '0.2' },
        problem: { text: '水平传送带以 v=2 m/s 的速度向右匀速运行，两端相距 L=10 m。将质量 m=1 kg 的物块无初速度地轻放在左端，物块与传送带间的动摩擦因数 μ=0.2，g 取 10 m/s²。求：\n(1) 物块从左端运动到右端的时间；\n(2) 物块在传送带上留下的痕迹长度；\n(3) 摩擦产生的热量 Q。', answer: '(1) 5.5 s  (2) 1 m  (3) 2 J' } },
      { name: '水平传送带·物块逆向冲上', params: { L: '10', beltV: '2', x0: '10', v0: '-4', mu1: '0.2' },
        problem: { text: '水平传送带以 2 m/s 的速度向右匀速运行，长 L=10 m。质量 m=1 kg 的物块从右端以 4 m/s 的速度向左滑上传送带，μ=0.2，g 取 10 m/s²。求：\n(1) 物块向左运动的最大距离；\n(2) 物块在传送带上运动的总时间；\n(3) 相对路程与摩擦生热 Q。', answer: '(1) 4 m  (2) 4.5 s  (3) 9 m，18 J' } },
      { name: '倾斜传送带·顶端释放（μ<tanθ，痕迹重叠）', params: { theta: '37', L: '16', beltV: '-10', x0: '16', v0: '0', mu1: '0.5', tMax: '6' },
        problem: { text: '传送带与水平面夹角 θ=37°，以 v=10 m/s 的速率沿斜面向下运行。在传送带顶端无初速度地放一个质量 m=1 kg 的物块，物块与传送带间的动摩擦因数 μ=0.5，顶端到底端长 L=16 m，g 取 10 m/s²，sin37°=0.6，cos37°=0.8。求：\n(1) 物块从顶端运动到底端的时间；\n(2) 物块在传送带上留下的痕迹长度；\n(3) 摩擦产生的热量 Q。', answer: '(1) 2 s  (2) 5 m（第二阶段的 1 m 与原痕迹重叠）  (3) Q = μmgcosθ·(5+1) = 24 J' } },
      { name: '倾斜传送带·向上运送（保留 √3）', params: { theta: '30', L: '10', beltV: '5', mu1: '√3/2' },
        problem: { text: '倾角 θ=30° 的传送带以 v=5 m/s 的速度沿斜面向上匀速运行，底端到顶端长 L=10 m。将质量 m=1 kg 的物块无初速度地放在底端，动摩擦因数 μ=√3/2，g 取 10 m/s²。求：\n(1) 物块运动到顶端的时间；\n(2) 摩擦生热 Q；\n(3) 电动机因传送物块多消耗的电能。', answer: '(1) 3 s  (2) 37.5 J  (3) 100 J' } },
      { name: '传送带由静止启动·煤块痕迹', params: { L: '20', beltV: '4', beltA: '4', beltV0: '0', x0: '2', mu1: '0.2' },
        problem: { text: '一足够长的水平传送带上放着一煤块（可视为质点），煤块与传送带间的动摩擦因数 μ=0.2。初始时两者都静止，现让传送带以 a₀=4 m/s² 的加速度开始运动，速度达到 v₀=4 m/s 后做匀速运动，g 取 10 m/s²。求煤块在传送带上留下的黑色痕迹长度。', answer: '痕迹长度 2 m' } }
    ]
  },
  board: {
    id: 'board', name: '板块模型', short: '板块', carrier: '木板',
    params: [...COMMON_PARAMS,
      { key: 'L', sym: 'L', name: '木板长度', unit: 'm', def: '4', group: '木板', pos: true },
      { key: 'M', sym: 'M', name: '木板质量', unit: 'kg', def: '2', group: '木板', pos: true },
      { key: 'boardV0', sym: 'v<sub>板0</sub>', name: '木板初速度', unit: 'm/s', def: '0', group: '木板', ai: '带符号' },
      { key: 'mu2', sym: 'μ<sub>2</sub>', name: '木板与地面动摩擦因数', unit: '', def: '0', group: '木板', nonneg: true, ai: '地面光滑填 "0"' },
      ...BLOCK_PARAMS('物块与木板动摩擦因数', '初始位置（距木板左/下端）'),
      { key: 'mu3', sym: 'μ<sub>3</sub>', name: '物块与地面动摩擦因数', unit: '', def: '0', group: '物块', nonneg: true, hint: '仅“滑离后继续运动”时使用' },
      { key: 'Fc', sym: 'F<sub>板</sub>', name: '木板所受外力（沿接触面）', unit: 'N', def: '0', group: '外力', ai: '带符号，无外力填 "0"' },
      { key: 'FcT', sym: 't<sub>F板</sub>', name: '木板外力作用时长', unit: 's', def: '', group: '外力', optional: true, nonneg: true, hint: '留空 = 一直作用', ai: '留空字符串表示一直作用' }],
    presets: [
      { name: '光滑地面·物块冲上静止木板', params: { L: '3', M: '3', m: '1', v0: '4', mu1: '0.3', mu2: '0' },
        problem: { text: '质量 M=3 kg、长 L=3 m 的木板静止在光滑水平地面上，质量 m=1 kg 的物块以 v₀=4 m/s 的速度从木板左端滑上木板，物块与木板间的动摩擦因数 μ=0.3，g 取 10 m/s²。求：\n(1) 两者的共同速度及达到共速的时间；\n(2) 物块相对木板滑行的距离；\n(3) 系统产生的热量 Q。', answer: '(1) 1 m/s，1 s  (2) 2 m  (3) 6 J' } },
      { name: '粗糙地面·共速后一起减速', params: { L: '3', M: '1', m: '2', v0: '6', mu1: '0.4', mu2: '0.1' },
        problem: { text: '质量 M=1 kg、长 L=3 m 的木板静止在粗糙水平地面上，木板与地面间的动摩擦因数 μ₂=0.1。质量 m=2 kg 的物块以 v₀=6 m/s 从左端滑上木板，物块与木板间的动摩擦因数 μ₁=0.4，g 取 10 m/s²。求：\n(1) 物块与木板达到共速的时间和共同速度；\n(2) 物块相对木板滑行的距离；\n(3) 木板在地面上滑行的总距离。', answer: '(1) 2/3 s，10/3 m/s  (2) 2 m  (3) 20/3 m' } },
      { name: '外力拉木板·撤力后共速', params: { L: '2', M: '2', m: '1', x0: '1.5', mu1: '0.2', mu2: '0.1', Fc: '12', FcT: '1' },
        problem: { text: '质量 M=2 kg、长 L=2 m 的木板静止在水平地面上，木板与地面间 μ₂=0.1；质量 m=1 kg 的物块放在木板上距左端 1.5 m 处，物块与木板间 μ₁=0.2。现对木板施加水平向右的恒力 F=12 N，作用 1 s 后撤去，g 取 10 m/s²。求：\n(1) 撤去 F 时物块和木板的速度；\n(2) 物块相对木板滑动的总距离；\n(3) 物块与木板间摩擦产生的热量。', answer: '(1) 2 m/s，3.5 m/s  (2) 1 m  (3) 2 J' } },
      { name: '斜面上的板块·同时下滑（保留分数）', params: { theta: '37', L: '6', M: '1', m: '1', x0: '4', mu1: '3/8', mu2: '0.5', tMax: '6' },
        problem: { text: '倾角 θ=37° 的固定斜面上有一长 L=6 m、质量 M=1 kg 的木板，木板与斜面间的动摩擦因数 μ₂=0.5；质量 m=1 kg 的物块放在木板上距下端 4 m 处，物块与木板间的动摩擦因数 μ₁=3/8。同时由静止释放，g 取 10 m/s²，sin37°=0.6。求：\n(1) 物块和木板的加速度大小；\n(2) 物块滑离木板的时间。', answer: '(1) 3 m/s²，1 m/s²  (2) 2 s' } }
    ]
  }
};

function newConfig(modelId, preset) {
  const M = MODELS[modelId], params = {};
  M.params.forEach(p => { params[p.key] = p.def; });
  const cfg = { id: uid(), version: 1, name: preset ? preset.name : '新建' + M.name, model: modelId, params,
    options: { approx37: true, afterLeave: 'stop', collision: 'elastic' }, bookmarks: [],
    flags: modelId === 'duo' ? [{ id: uid(), anchor: 'ground', t: 0 }] : [{ id: uid(), anchor: 'ground', t: 0 }, { id: uid(), anchor: 'carrier', t: 0 }],
    problem: { title: preset ? preset.name : '', text: '', answer: '', analysis: '' } };
  if (preset) { Object.assign(cfg.params, preset.params); Object.assign(cfg.options, preset.options || {}); Object.assign(cfg.problem, preset.problem || {}); }
  return cfg;
}
function evalParam(p, s) { const v = Expr.eval(s); return (p.kind === 'angle' && /[πΠ°]|pi/i.test(s)) ? v * 180 / Math.PI : v; }
/* 宽容地规范化外部配置（导入文件 / AI 输出 / 内嵌配置） */
function normalizeConfig(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const modelId = MODELS[raw.model] ? raw.model : (/board|板/.test(String(raw.model || '')) ? 'board' : 'belt');
  const cfg = newConfig(modelId);
  if (raw.name) cfg.name = String(raw.name).slice(0, 60);
  const rp = raw.params && typeof raw.params === 'object' ? raw.params : {};
  MODELS[modelId].params.forEach(p => {
    if (rp[p.key] == null) return;
    const s = String(rp[p.key]).trim();
    if (s === '') { if (p.optional) cfg.params[p.key] = ''; return; }
    try { evalParam(p, s); cfg.params[p.key] = s; } catch (e) { /* 非法表达式保留默认值 */ }
  });
  const ro = raw.options || {};
  if (typeof ro.approx37 === 'boolean') cfg.options.approx37 = ro.approx37;
  if (ro.afterLeave === 'stop' || ro.afterLeave === 'continue') cfg.options.afterLeave = ro.afterLeave;
  if (['elastic', 'stick', 'e', 'none'].indexOf(ro.collision) >= 0) cfg.options.collision = ro.collision;
  if (Array.isArray(raw.bookmarks)) cfg.bookmarks = raw.bookmarks.filter(b => b && isFinite(+b.t)).map(b => ({ id: uid(), t: Math.max(0, +b.t), name: String(b.name || ('t = ' + b.t + ' s')).slice(0, 30) }));
  if (Array.isArray(raw.flags)) cfg.flags = raw.flags.filter(f => f && (f.anchor === 'ground' || f.anchor === 'carrier') && isFinite(+f.t)).map(f => ({ id: uid(), anchor: f.anchor, t: Math.max(0, +f.t) }));
  if (raw.problem && typeof raw.problem === 'object') ['title', 'text', 'answer', 'analysis'].forEach(k => { if (raw.problem[k] != null) cfg.problem[k] = String(raw.problem[k]); });
  if (MODELS[modelId].normalize) MODELS[modelId].normalize(raw, cfg);
  if (!cfg.problem.title) cfg.problem.title = cfg.name;
  return cfg;
}
/* 表达式 → 数值参数 */
function buildInput(cfg) {
  const M = MODELS[cfg.model], P = { model: cfg.model }, errors = {};
  const approx = cfg.options.approx37 !== false; Expr.setApprox(approx);
  for (const p of M.params) {
    const s = String(cfg.params[p.key] == null ? '' : cfg.params[p.key]).trim();
    if (s === '') { if (p.optional) P[p.key] = Infinity; else errors[p.key] = '请输入数值'; continue; }
    try {
      const v = evalParam(p, s);
      if (p.pos && !(v > 0)) throw new Error('必须大于 0');
      if (p.nonneg && v < 0) throw new Error('不能为负');
      P[p.key] = v;
    } catch (e) { errors[p.key] = e.message; }
  }
  if (P.theta == null && !errors.theta) P.theta = 0;   // 没有倾角参数的模型（人船、拼合）按水平处理
  if (!errors.theta && !(P.theta >= 0 && P.theta < 90)) errors.theta = '倾角需满足 0° ≤ θ < 90°';
  if (!errors.tMax && P.tMax > 600) errors.tMax = '最长 600 s';
  if (!errors.x0 && !errors.L && P.x0 > P.L + 1e-9) errors.x0 = '初始位置不能超过长度 L';
  if (cfg.model === 'duo' && !errors.xB0 && !errors.L && P.xB0 > P.L + 1e-9) errors.xB0 = '初始位置不能超过轨道长度 L';
  if (M.build) M.build(cfg, P, errors);   // 模型自带的校验 / 预处理
  const ok = Object.keys(errors).length === 0;
  if (ok) {
    P.rad = P.theta * Math.PI / 180; P.sin = Math.sin(P.rad); P.cos = Math.cos(P.rad);
    if (approx && Math.abs(P.theta - 37) < 1e-7) { P.sin = 0.6; P.cos = 0.8; }
    if (approx && Math.abs(P.theta - 53) < 1e-7) { P.sin = 0.8; P.cos = 0.6; }
    if (P.theta < 1e-12) { P.sin = 0; P.cos = 1; }
    P.afterLeave = cfg.options.afterLeave || 'stop'; P.collision = cfg.options.collision || 'elastic';
  }
  return { P, errors, ok };
}

/* =====================================================================
 * 3. 物理引擎：事件驱动的分段匀变速精确解
 *    约定：x 轴沿接触面（向右 / 沿斜面向上为正）；最大静摩擦 = 滑动摩擦
 * ===================================================================== */
const EPS = 1e-9, TE = 1e-10;
/* c + b t + (a/2) t² = 0 的最小正根；擦边（相切）不算穿越 */
function firstRoot(c, b, a) {
  const roots = [], h = a / 2;
  if (Math.abs(h) < 1e-14) { if (Math.abs(b) > 1e-14) roots.push(-c / b); }
  else {
    const D = b * b - 4 * h * c;
    if (D < 1e-9 * (b * b + Math.abs(4 * h * c) + 1e-12)) return Infinity;
    const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(D));
    roots.push(q / h); if (q !== 0) roots.push(c / q);
  }
  let best = Infinity; for (const r of roots) if (r > TE && r < best) best = r; return best;
}
function singleBody(net, mass, v, fmax) {
  const md = f => Math.abs(f) < 1e-9 ? 'none' : null;
  if (Math.abs(v) > EPS) { const f = -Math.sign(v) * fmax; return { a: (net + f) / mass, f, mode: md(f) || 'kinetic' }; }
  if (Math.abs(net) <= fmax + 1e-9) return { a: 0, f: -net, mode: md(net) || 'static' };
  const f = -Math.sign(net) * fmax; return { a: (net + f) / mass, f, mode: md(f) || 'kinetic' };
}
/* 接触求解：枚举“相对静止 / 向正滑 / 向负滑”，取第一个自洽解 */
function solveContact(P, S) {
  const m = P.m, gs = P.g * P.sin, gc = P.g * P.cos, nb = S.Fb - m * gs, N1 = m * gc, F1 = P.mu1 * N1;
  const md = (f, kin) => Math.abs(f) < 1e-9 ? 'none' : (kin ? 'kinetic' : 'static');
  if (P.model === 'belt') {
    const ac = S.acBelt, vr = S.vb - S.vc; let f1, ab, kin;
    if (Math.abs(vr) > EPS) { f1 = -Math.sign(vr) * F1; ab = (nb + f1) / m; kin = true; }
    else { const fr = m * ac - nb; if (Math.abs(fr) <= F1 + 1e-9) { f1 = fr; ab = ac; kin = false; } else { f1 = Math.sign(fr) * F1; ab = (nb + f1) / m; kin = true; } }
    return { ab, ac, f1, f2: 0, fg: 0, mode1: md(f1, kin), mode2: 'none', modeG: 'none', slip1: kin };
  }
  const M = P.M, nc = S.Fc - M * gs;
  if (!S.on) {
    const b = singleBody(nb, m, S.vb, P.mu3 * N1), c = singleBody(nc, M, S.vc, P.mu2 * M * gc);
    return { ab: b.a, ac: c.a, f1: 0, f2: c.f, fg: b.f, mode1: 'none', mode2: c.mode, modeG: b.mode, slip1: false };
  }
  const F2 = P.mu2 * (M + m) * gc, vr = S.vb - S.vc, tol = 1e-9;
  const o1 = Math.abs(vr) > EPS ? [{ k: -Math.sign(vr) }] : [{ s: 1 }, { k: 1, c: 1 }, { k: -1, c: 1 }];
  const o2 = Math.abs(S.vc) > EPS ? [{ k: -Math.sign(S.vc) }] : [{ s: 1 }, { k: 1, c: 1 }, { k: -1, c: 1 }];
  let fallback = null;
  for (const B of o2) for (const A of o1) {
    let ab, ac, f1, f2, ok = true;
    if (B.s) {
      ac = 0;
      if (A.s) { ab = 0; f1 = -nb; f2 = f1 - nc; ok = Math.abs(f1) <= F1 + tol && Math.abs(f2) <= F2 + tol; }
      else { f1 = A.k * F1; ab = (nb + f1) / m; f2 = f1 - nc; ok = Math.abs(f2) <= F2 + tol; if (A.c) ok = ok && ab * A.k < -1e-12; }
    } else {
      f2 = B.k * F2;
      if (A.s) { ab = ac = (nb + nc + f2) / (M + m); f1 = m * ab - nb; ok = Math.abs(f1) <= F1 + tol; if (B.c) ok = ok && ac * B.k < -1e-12; }
      else { f1 = A.k * F1; ab = (nb + f1) / m; ac = (nc - f1 + f2) / M; if (A.c) ok = ok && (ab - ac) * A.k < -1e-12; if (B.c) ok = ok && ac * B.k < -1e-12; }
    }
    const r = { ab, ac, f1, f2, fg: 0, mode1: md(f1, !A.s), mode2: md(f2, !B.s), modeG: 'none', slip1: !A.s };
    if (ok) return r; if (!fallback) fallback = r;
  }
  return fallback;
}

function simulate(P) {
  PL.run('beforeSimulate', P);
  const sim = simulateBase(P);
  PL.run('afterSimulate', sim, P);
  return sim;
}
function simulateBase(P) {
  if (MODELS[P.model] && MODELS[P.model].simulate) return MODELS[P.model].simulate(P);   // 模型自带引擎（人船、例题拼合…）
  if (P.model === 'duo') return simulateDuo(P);   // 多物块碰撞模型走独立引擎
  const isBelt = P.model === 'belt', m = P.m, M = isBelt ? 0 : P.M, L = P.L, F1max = P.mu1 * m * P.g * P.cos;
  const ramp = isBelt && Math.abs(P.beltA) > EPS && Math.abs(P.beltV - P.beltV0) > EPS;
  const tRamp = ramp ? Math.abs(P.beltV - P.beltV0) / Math.abs(P.beltA) : 0;
  const aRamp = ramp ? Math.sign(P.beltV - P.beltV0) * Math.abs(P.beltA) : 0;
  const FbT = P.Fb !== 0 ? P.FbT : Infinity, FcT = (!isBelt && P.Fc !== 0) ? P.FcT : Infinity;
  const x0 = clamp(P.x0, 0, L), vc0 = isBelt ? (ramp ? P.beltV0 : P.beltV) : P.boardV0;
  let t = 0, xb = x0, vb = P.v0, xc = 0, vc = vc0, on = true;
  let Q1 = 0, Q2 = 0, sRel = 0, Wf = 0, WFb = 0, WFc = 0, Wbelt = 0, rMin = x0, rMax = x0;
  let endReason = 'tmax', guard = 0, tCommon = null, tLeave = null;
  const segs = [], events = [];
  while (t < P.tMax - TE) {
    if (++guard > 500) { endReason = 'guard'; break; }
    const Fb = t < FbT - TE ? P.Fb : 0, Fc = isBelt ? 0 : (t < FcT - TE ? P.Fc : 0);
    const ramping = ramp && t < tRamp - TE;
    if (isBelt && !ramping) vc = P.beltV;
    const S = solveContact(P, { vb, vc, on, Fb, Fc, acBelt: ramping ? aRamp : 0 });
    const ab = S.ab, ac = S.ac, vr = vb - vc, ar = ab - ac;
    if (on) {   // 位于边缘且正向外运动：立即离开
      const pos = isBelt ? xb : xb - xc, vel = isBelt ? vb : vr, acc = isBelt ? ab : ar;
      const outL = pos <= 1e-9 && (vel < -EPS || (Math.abs(vel) <= EPS && acc < -1e-9));
      const outR = pos >= L - 1e-9 && (vel > EPS || (Math.abs(vel) <= EPS && acc > 1e-9));
      if (outL || outR) {
        const type = outL ? 'leaveL' : 'leaveR'; events.push({ t, type }); if (tLeave == null) tLeave = t;
        if (segs.length) segs[segs.length - 1].end2 = type;
        if (isBelt || P.afterLeave === 'stop') { endReason = 'leave'; break; }
        on = false; continue;
      }
    }
    let dE = Infinity, ev = '';
    const cand = (d, name) => { if (d > TE && d < dE - 1e-12) { dE = d; ev = name; } };
    if (on && S.slip1 && Math.abs(vr) > EPS && ar * vr < 0 && F1max > 0) cand(-vr / ar, 'common');
    if (!isBelt && Math.abs(vc) > EPS && ac * vc < 0) cand(-vc / ac, 'boardStop');
    if (Math.abs(vb) > EPS && ab * vb < 0) cand(-vb / ab, 'blockStop');
    if (on) {
      const pos = isBelt ? xb : xb - xc, vel = isBelt ? vb : vr, acc = isBelt ? ab : ar;
      cand(firstRoot(Math.max(pos, 0), vel, acc), 'leaveL');
      cand(firstRoot(Math.min(pos - L, 0), vel, acc), 'leaveR');
    }
    if (t < FbT - TE) cand(FbT - t, 'FbOff');
    if (t < FcT - TE) cand(FcT - t, 'FcOff');
    if (ramping) cand(tRamp - t, 'beltSteady');
    let dt;
    if (dE === Infinity) {
      if (Math.abs(ab) < 1e-12 && Math.abs(ac) < 1e-12) { dt = Math.min(P.tMax - t, t <= TE ? 2 : clamp(0.35 * t, 1, 4)); ev = 'steady'; }
      else { dt = P.tMax - t; ev = 'tmax'; }
    } else if (dE >= P.tMax - t) { dt = P.tMax - t; ev = 'tmax'; } else dt = dE;

    const seg = { i: segs.length, t0: t, t1: t + dt, xb0: xb, vb0: vb, ab, xc0: xc, vc0: vc, ac, on, f1: S.f1, f2: S.f2, fg: S.fg, fb: on ? S.f1 : S.fg,
      mode1: S.mode1, mode2: S.mode2, modeG: S.modeG, slip1: S.slip1, Fb, Fc, Q10: Q1, Q20: Q2, s0: sRel, rMin, rMax, end: ev };
    const xbN = xb + vb * dt + 0.5 * ab * dt * dt, xcN = xc + vc * dt + 0.5 * ac * dt * dt;
    const dxb = xbN - xb, dxc = xcN - xc, dxr = dxb - dxc;
    if (on) { Q1 += Math.abs(S.f1 * dxr); sRel += Math.abs(dxr); const r = xbN - xcN; rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); }
    else Q2 += Math.abs(S.fg * dxb);
    if (!isBelt) Q2 += Math.abs(S.f2 * dxc);
    Wf += seg.fb * dxb; WFb += Fb * dxb; WFc += Fc * dxc; if (isBelt) Wbelt += S.f1 * dxc;
    vb += ab * dt; vc += ac * dt; xb = xbN; xc = xcN; t += dt;
    if (ev === 'common') { if (isBelt) vb = vc; else { const v = (m * vb + M * vc) / (m + M); vb = vc = v; } if (tCommon == null) tCommon = t; }
    if (ev === 'boardStop') vc = 0;
    if (ev === 'blockStop') vb = 0;
    if (ev === 'beltSteady') vc = P.beltV;
    if (!isBelt && Math.abs(vc) < 1e-9) vc = 0;
    if (on && Math.abs(vb - vc) < 1e-9) vb = vc;
    if (Math.abs(vb) < 1e-9) vb = 0;
    seg.xb1 = xb; seg.vb1 = vb; seg.xc1 = xc; seg.vc1 = vc; segs.push(seg); events.push({ t, type: ev });
    if (ev === 'leaveL' || ev === 'leaveR') { if (tLeave == null) tLeave = t; if (isBelt || P.afterLeave === 'stop') { endReason = 'leave'; break; } on = false; continue; }
    if (ev === 'steady') { endReason = 'steady'; break; }
    if (ev === 'tmax') { endReason = 'tmax'; break; }
  }
  const sim = { P, isBelt, segs, events, tEnd: t, endReason, x0, vc0 };
  sim.fake = { i: 0, t0: 0, t1: 0, xb0: x0, vb0: P.v0, ab: 0, xc0: 0, vc0, ac: 0, on: true, f1: 0, f2: 0, fg: 0, fb: 0, Q10: 0, Q20: 0, s0: 0, rMin: x0, rMax: x0 };
  let xmin = 0, xmax = L, vmax = Math.max(Math.abs(P.v0), Math.abs(vc0), 1e-6);
  for (const g of segs) {
    if (!isBelt) { xmin = Math.min(xmin, g.xc1, g.xb1); xmax = Math.max(xmax, g.xc1 + L, g.xb1); }
    vmax = Math.max(vmax, Math.abs(g.vb1), Math.abs(g.vc1));
  }
  sim.xmin = xmin; sim.xmax = xmax; sim.vmax = vmax;
  sim.samples = []; const NS = 20;
  if (!segs.length) sim.samples.push(stateInSeg(sim, sim.fake, 0));
  for (const g of segs) for (let k = 0; k <= NS; k++) sim.samples.push(stateInSeg(sim, g, g.t0 + (g.t1 - g.t0) * k / NS));
  const last = segs[segs.length - 1], gsin = P.g * P.sin;
  const S = { tEnd: (endReason === 'steady' && last) ? last.t0 : t, tSim: t, xb: xb - x0, xc, vb, vc, dRel: (xb - xc) - x0, sRel, mark: rMax - rMin,
    Q1, Q2, Wf, WFb, WFc, Wbelt, tCommon, tLeave,
    dEkb: 0.5 * m * (vb * vb - P.v0 * P.v0), dEkc: isBelt ? 0 : 0.5 * M * (vc * vc - vc0 * vc0), dEpb: m * gsin * (xb - x0), dEpc: isBelt ? 0 : M * gsin * xc };
  S.resid = S.dEkb + S.dEkc + S.dEpb + S.dEpc + Q1 + Q2 - WFb - WFc - Wbelt;
  sim.summary = S;
  sim.phases = segs.map(g => describeSeg(sim, g));
  return sim;
}
function stateInSeg(sim, g, t) {
  const st = stateInSegBase(sim, g, t);
  if (PL.vars.length) {
    const model = sim.P && sim.P.model;
    for (const v of PL.vars) { if (!appliesTo(v.models, model)) continue; st[v.key] = PL.guard(v.plugin, '变量「' + v.key + '」计算', () => v.compute(st, { sim, P: sim.P, g, model }), NaN); }
  }
  return st;
}
function stateInSegBase(sim, g, t) {
  if (sim.stateInSeg) return sim.stateInSeg(g, t);   // 拼合模拟：转交给所属阶段
  const P = sim.P, d = clamp(t - g.t0, 0, g.t1 - g.t0);
  const xb = g.xb0 + g.vb0 * d + 0.5 * g.ab * d * d, vb = g.vb0 + g.ab * d, xc = g.xc0 + g.vc0 * d + 0.5 * g.ac * d * d, vc = g.vc0 + g.ac * d;
  const xr = xb - xc, dxr = xr - (g.xb0 - g.xc0), dxb = xb - g.xb0, dxc = xc - g.xc0;
  const st = { t: g.t0 + d, i: g.i, on: g.on, xb, vb, ab: g.ab, xc, vc, ac: g.ac, xr, vr: vb - vc, fb: g.fb, f1: g.f1, f2: g.f2,
    Q1: g.Q10 + (sim.duo ? Math.abs(g.f1 * dxb) : (g.on ? Math.abs(g.f1 * dxr) : 0)),
    Q2: g.Q20 + (g.on ? 0 : Math.abs(g.fg * dxb)) + (sim.isBelt ? 0 : Math.abs(g.f2 * dxc)),
    sRel: g.s0 + (g.on ? Math.abs(dxr) : 0), rMin: g.on ? Math.min(g.rMin, xr) : g.rMin, rMax: g.on ? Math.max(g.rMax, xr) : g.rMax,
    sb: xb - sim.x0, sc: xc - (sim.xc00 || 0), dRel: xr - (sim.xr0 == null ? sim.x0 : sim.xr0),
    Fb: g.Fb || 0, Fc: g.Fc || 0, mode1: g.mode1 || 'none', mode2: g.mode2 || 'none', Ec: g.Ec0 || 0, stuck: !!g.stuck };
  st.Ekb = 0.5 * P.m * vb * vb; st.Ekc = sim.isBelt ? 0 : 0.5 * P.M * vc * vc;
  st.dEp = P.m * P.g * P.sin * st.sb + (sim.isBelt ? 0 : P.M * P.g * P.sin * st.sc);
  st.pb = P.m * vb; st.pc = sim.isBelt ? 0 : P.M * vc;
  if (sim.duo || sim.boat) { st.rMin = 0; st.rMax = 0; }
  if (sim.boat) st.Q1 = 0;   // 人船：脚与船之间是静摩擦，不生热
  return st;
}
function stateAt(sim, t) {
  const segs = sim.segs; if (!segs.length) return stateInSeg(sim, sim.fake, 0);
  t = clamp(t, 0, sim.tEnd);
  const g = segs.find(s => t < s.t1) || segs[segs.length - 1];
  return stateInSeg(sim, g, t);
}
/* 分过程文字描述 */
function dirWord(P, sign) { if (P.flip) sign = -sign;   // 组合轨道的“下坡”阶段：状态量已换成以前进方向为正
  return P.theta > 1e-9 ? (sign > 0 ? '沿斜面向上' : '沿斜面向下') : (sign > 0 ? '向右' : '向左'); }
function motionWord(v0, a) { if (Math.abs(a) < 1e-9) return Math.abs(v0) < 1e-9 ? '静止' : '匀速'; if (Math.abs(v0) < 1e-9) return '由静止匀加速'; return a * v0 > 0 ? '匀加速' : '匀减速'; }
function eventLabel(sim, g) {
  const P = sim.P, cn = sim.isBelt ? '传送带' : '木板', inc = P.theta > 1e-9;
  const one = ev => {
    switch (ev) {
      case 'common': return Math.abs(g.vb1) < 1e-9 ? '物块减速到零，与' + cn + '相对静止' : '物块与' + cn + '共速（v = ' + fmt(g.vb1) + ' m/s）';
      case 'blockStop': return '物块速度减为零';
      case 'boardStop': return (g.on && Math.abs(g.vb1) < 1e-9 && Math.abs((g.vb0 - g.vc0)) < 1e-9) ? '物块与木板一起减速到零' : '木板速度减为零';
      case 'leaveL': return '物块从' + cn + (inc ? '底端' : '左端') + (sim.isBelt ? '离开' : '滑离');
      case 'leaveR': return '物块从' + cn + (inc ? '顶端' : '右端') + (sim.isBelt ? '离开' : '滑离');
      case 'FbOff': return '撤去物块所受外力 F';
      case 'FcOff': return '撤去木板所受外力 F';
      case 'beltSteady': return '传送带达到稳定速度 ' + fmt(P.beltV) + ' m/s';
      case 'steady': return '此后运动状态不再变化';
      case 'tmax': return '达到最长模拟时间';
      default: return ev;
    }
  };
  return one(g.end) + (g.end2 ? '，随即' + one(g.end2) : '');
}
function describeSeg(sim, g) {
  const P = sim.P, b = sim.isBelt, cn = b ? '传送带' : '木板', lines = [];
  const vrMid = (g.vb0 - g.vc0) + (g.ab - g.ac) * (g.t1 - g.t0) / 2, sliding = g.on && Math.abs(vrMid) > 1e-9;
  let fr;
  if (g.on) fr = g.mode1 === 'kinetic' ? '受滑动摩擦力 ' + fmt(Math.abs(g.f1)) + ' N（' + dirWord(P, g.f1) + '）' : g.mode1 === 'static' ? '受静摩擦力 ' + fmt(Math.abs(g.f1)) + ' N（' + dirWord(P, g.f1) + '）' : '不受摩擦力';
  else fr = g.modeG === 'none' ? '已离开木板，不受摩擦力' : '已离开木板，受地面摩擦力 ' + fmt(Math.abs(g.fg)) + ' N（' + dirWord(P, g.fg) + '）';
  const bw = motionWord(g.vb0, g.ab);
  lines.push('物块：' + bw + '，a = ' + fmt(g.ab) + ' m/s²，' + fr + '；v：' + fmt(g.vb0) + ' → ' + fmt(g.vb1) + ' m/s');
  let cw;
  if (b) { cw = Math.abs(g.ac) > 1e-9 ? '匀变速' : (Math.abs(g.vc0) < 1e-9 ? '静止' : '匀速'); lines.push('传送带：' + cw + '，v：' + fmt(g.vc0) + ' → ' + fmt(g.vc1) + ' m/s'); }
  else {
    cw = motionWord(g.vc0, g.ac);
    const gf = g.mode2 === 'kinetic' ? '地面滑动摩擦力 ' + fmt(Math.abs(g.f2)) + ' N' : g.mode2 === 'static' ? '地面静摩擦力 ' + fmt(Math.abs(g.f2)) + ' N' : '地面无摩擦';
    lines.push('木板：' + cw + '，a = ' + fmt(g.ac) + ' m/s²，' + gf + '；v：' + fmt(g.vc0) + ' → ' + fmt(g.vc1) + ' m/s');
  }
  if (g.on) lines.push(sliding ? '物块相对' + cn + dirWord(P, vrMid) + '滑动，本过程相对位移 ' + fmt((g.xb1 - g.xc1) - (g.xb0 - g.xc0)) + ' m' : '物块与' + cn + '保持相对静止');
  lines.push('位移：物块 ' + fmt(g.xb1 - g.xb0) + ' m，' + cn + ' ' + fmt(g.xc1 - g.xc0) + ' m');
  return { title: '物块' + bw + '，' + cn + cw + (g.on ? (sliding ? '（相对滑动）' : '（相对静止）') : '（物块已离板）'), lines, end: eventLabel(sim, g) };
}
const END_TEXT = { leave: '物块离开' , steady: '进入稳定状态（之后不再变化）', tmax: '达到最长模拟时间（过程可能未结束）', guard: '事件过多，已中止' };
function resultRows(sim) { return PL.rows(resultRowsBase(sim).slice(), sim); }
function resultRowsBase(sim) {
  if (sim.resultRows) return sim.resultRows(sim);
  if (sim.duo) return duoResultRows(sim);
  const S = sim.summary, P = sim.P, b = sim.isBelt, cn = b ? '传送带' : '木板', c = b ? '带' : '板', R = [];
  R.push(['结束情况', END_TEXT[sim.endReason] + (sim.endReason === 'leave' ? cn : '')]);
  R.push([sim.endReason === 'steady' ? '进入稳定状态的时刻' : '全过程时间 t', fmt(S.tEnd) + ' s']);
  if (S.tCommon != null) R.push(['首次共速时刻', fmt(S.tCommon) + ' s']);
  R.push(['物块位移 x物', fmt(S.xb) + ' m'], ['物块末速度', fmt(S.vb) + ' m/s'], [cn + '位移 x' + c, fmt(S.xc) + ' m']);
  if (!b) R.push(['木板末速度', fmt(S.vc) + ' m/s']);
  R.push(['相对位移 Δx = x物 − x' + c, fmt(S.dRel) + ' m'], ['相对路程 s相对', fmt(S.sRel) + ' m'], ['痕迹长度', fmt(S.mark) + ' m'], ['摩擦生热 Q = f·s相对', fmt(S.Q1) + ' J']);
  if (!b) R.push(['与地面摩擦生热 Q地', fmt(S.Q2) + ' J']);
  R.push(['摩擦力对物块做功 Wf', fmt(S.Wf) + ' J']);
  if (b) R.push(['电动机多消耗电能 W = Σf·x带', fmt(S.Wbelt) + ' J']);
  if (Math.abs(S.WFb) > 1e-12) R.push(['外力对物块做功', fmt(S.WFb) + ' J']);
  if (Math.abs(S.WFc) > 1e-12) R.push(['外力对木板做功', fmt(S.WFc) + ' J']);
  R.push(['物块动能变化 ΔEk', fmt(S.dEkb) + ' J']);
  if (P.sin > 1e-9) R.push(['物块重力势能变化 ΔEp', fmt(S.dEpb) + ' J']);
  if (!b) R.push(['木板动能变化', fmt(S.dEkc) + ' J']);
  R.push(['能量守恒残差', S.resid.toExponential(1) + ' J']);
  return R;
}

/* =====================================================================
 * 4. 本地物理一致性校验
 * ===================================================================== */
function crossCheck(sim) {   // 2 万步逐步积分，与解析分段解比对
  const P = sim.P, b = sim.isBelt, lv = sim.events.find(e => e.type.indexOf('leave') === 0), T = lv ? lv.t : sim.tEnd;
  if (!(T > 1e-6)) return null;
  const n = 20000, dt = T / n, F1 = P.mu1 * P.m * P.g * P.cos;
  const ramp = b && Math.abs(P.beltA) > EPS && Math.abs(P.beltV - P.beltV0) > EPS;
  const tRamp = ramp ? Math.abs(P.beltV - P.beltV0) / Math.abs(P.beltA) : 0, aRamp = ramp ? Math.sign(P.beltV - P.beltV0) * Math.abs(P.beltA) : 0;
  const vBelt = t => (ramp && t < tRamp) ? P.beltV0 + aRamp * t : P.beltV;
  const FbT = P.Fb !== 0 ? P.FbT : Infinity, FcT = (!b && P.Fc !== 0) ? P.FcT : Infinity;
  let t = 0, xb = sim.x0, vb = P.v0, xc = 0, vc = sim.vc0, dev = 0, scale = 1;
  for (let k = 0; k < n; k++) {
    const ramping = ramp && t < tRamp - TE;
    const S = solveContact(P, { vb, vc, on: true, Fb: t < FbT - TE ? P.Fb : 0, Fc: b ? 0 : (t < FcT - TE ? P.Fc : 0), acBelt: ramping ? aRamp : 0 });
    let vbN = vb + S.ab * dt, vcN = b ? vBelt(t + dt) : vc + S.ac * dt;
    if (!b && vc * vcN < 0) vcN = 0;
    const vr = vb - vc, vrN = vbN - vcN;
    if (F1 > 0 && vr * vrN < 0) { if (b) vbN = vcN; else { const v = (P.m * vbN + P.M * vcN) / (P.m + P.M); vbN = vcN = v; } }
    xb += (vb + vbN) / 2 * dt; xc += (vc + vcN) / 2 * dt; vb = vbN; vc = vcN; t += dt;
    if (k % 250 === 249) {
      const a = stateAt(sim, Math.min(t, T));
      scale = Math.max(scale, Math.abs(a.xb), Math.abs(a.vb), Math.abs(a.xc), Math.abs(a.vc));
      dev = Math.max(dev, Math.abs(a.xb - xb), Math.abs(a.vb - vb), Math.abs(a.xc - xc), Math.abs(a.vc - vc));
    }
  }
  return { dev, tol: 0.01 * scale + 0.01, T };
}
function localChecks(inp, sim) { return PL.checks(localChecksBase(inp, sim).slice(), inp, sim); }
function localChecksBase(inp, sim) {
  if (sim.checks) return sim.checks(inp, sim);
  if (sim.duo) return duoChecks(inp, sim);
  const out = [], P = inp.P, b = sim.isBelt, S = sim.summary, add = (status, item, detail) => out.push({ status, item, detail });
  const w = [];
  if (P.g < 9.7 || P.g > 10.01) w.push('g = ' + nfix(P.g) + ' 不在常用范围 9.8~10');
  if (P.mu1 > 1.5) w.push('物块的动摩擦因数 > 1.5，偏大');
  if (!b && P.mu2 > 1.5) w.push('木板与地面的动摩擦因数 > 1.5，偏大');
  if (sim.endReason === 'tmax') w.push('模拟被“最长模拟时间”截断，过程可能尚未结束');
  if (sim.endReason === 'guard') w.push('事件数量异常，模拟被中止');
  if (!sim.segs.length) w.push('物块在 t = 0 时即离开，可能是初始位置或方向设置有误');
  add(w.length ? 'warn' : 'pass', '参数与运行状态', w.length ? w.join('；') : '各参数量级、符号正常，过程完整结束');
  const bad = [], F1 = P.mu1 * P.m * P.g * P.cos; let maxR = 0, maxJ = 0;
  sim.segs.forEach((g, i) => {
    if (g.on) {
      if (Math.abs(g.f1) > F1 + 1e-6) bad.push('过程' + (i + 1) + '：摩擦力超过最大静摩擦');
      const vr = (g.vb0 - g.vc0) + (g.ab - g.ac) * (g.t1 - g.t0) / 2;
      if (F1 > 0 && Math.abs(vr) > 1e-9 && vr * g.f1 > 1e-9) bad.push('过程' + (i + 1) + '：滑动摩擦力未与相对运动方向相反');
      if (F1 > 0 && Math.abs(vr) > 1e-9 && Math.abs(Math.abs(g.f1) - F1) > 1e-6) bad.push('过程' + (i + 1) + '：相对滑动时摩擦力不等于 μN');
    }
    maxR = Math.max(maxR, Math.abs(P.m * g.ab - (g.Fb - P.m * P.g * P.sin + g.fb)));
    if (!b) maxR = Math.max(maxR, Math.abs(P.M * g.ac - (g.Fc - P.M * P.g * P.sin - g.f1 + g.f2)));
    if (i > 0) { const p = sim.segs[i - 1]; maxJ = Math.max(maxJ, Math.abs(g.xb0 - p.xb1), Math.abs(g.vb0 - p.vb1), Math.abs(g.xc0 - p.xc1), b ? 0 : Math.abs(g.vc0 - p.vc1)); }
  });
  add(bad.length ? 'fail' : 'pass', '摩擦力约束（|f静| ≤ μN，f滑 = μN 且与相对运动反向）', bad.length ? bad.join('；') : sim.segs.length + ' 个过程全部满足');
  add(maxR < 1e-6 ? 'pass' : 'fail', '牛顿第二定律逐过程复核', '合力与 ma 的最大残差 ' + maxR.toExponential(1) + ' N');
  add(maxJ < 1e-6 ? 'pass' : 'fail', '过程衔接连续性（位置、速度不突变）', '最大跳变 ' + maxJ.toExponential(1));
  const sc = Math.max(1, Math.abs(S.Q1) + Math.abs(S.Q2) + Math.abs(S.dEkb) + Math.abs(S.dEkc) + Math.abs(S.dEpb) + Math.abs(S.dEpc));
  add(Math.abs(S.resid) < 1e-7 * sc ? 'pass' : 'fail', '能量守恒：ΔEk + ΔEp + Q = W外力 + W电', 'ΔEk = ' + nfix(S.dEkb + S.dEkc) + ' J，ΔEp = ' + nfix(S.dEpb + S.dEpc) + ' J，Q = ' + nfix(S.Q1 + S.Q2) + ' J，输入功 = ' + nfix(S.WFb + S.WFc + S.Wbelt) + ' J，残差 ' + S.resid.toExponential(1) + ' J');
  const cc = crossCheck(sim);
  if (cc) add(cc.dev < cc.tol ? 'pass' : 'warn', '数值交叉验证（2 万步逐步积分 vs 解析分段解）', '0 ~ ' + nfix(cc.T) + ' s 内位置/速度最大偏差 ' + cc.dev.toExponential(1) + '（容差 ' + cc.tol.toExponential(1) + '）');
  if (P.sin > 1e-9 && b) {
    const tan = P.sin / P.cos;
    add('info', 'μ 与 tanθ 的关系', P.mu1 >= tan - 1e-12 ? 'μ = ' + fmt(P.mu1) + ' ≥ tanθ = ' + fmt(tan) + '：共速后物块可靠静摩擦与传送带保持相对静止' : 'μ = ' + fmt(P.mu1) + ' < tanθ = ' + fmt(tan) + '：共速后静摩擦不足，摩擦力反向，物块继续加速下滑');
  }
  if (!b && P.sin < 1e-9 && P.Fb === 0 && P.Fc === 0) {
    const fa = P.mu1 * P.m * P.g, fb2 = P.mu2 * (P.m + P.M) * P.g;
    add('info', '木板能否被物块带动', 'μ₁mg = ' + fmt(fa) + ' N，μ₂(M+m)g = ' + fmt(fb2) + ' N：' + (fa > fb2 + 1e-12 ? '物块的摩擦力大于地面最大静摩擦，木板会被带动' : '地面最大静摩擦足够大，静止的木板不会被带动'));
  }
  if (S.sRel - S.mark > 1e-6) add('info', '痕迹长度 ≠ 相对路程', '相对运动方向发生过反转，痕迹有重叠：痕迹长度 ' + fmt(S.mark) + ' m < 相对路程 ' + fmt(S.sRel) + ' m。求 Q 必须用相对路程。');
  return out;
}

/* =====================================================================
 * 5. 绘图：通用坐标图 + 场景动画（纯函数，可离屏渲染用于导出）
 * ===================================================================== */
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';
const COL = { block: '#e8590c', carrier: '#1c7ed6', rel: '#2b8a3e', extra: '#9c36b5', flag: '#e03131' };
function niceStep(range, n) { const raw = range / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), W = Math.round(r.width), H = Math.round(r.height);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, W, H };
}
/* spec: {title,xLabel,yLabel,series:[{name,color,pts,ghost,range,dot,points}],vlines} */
function drawPlot(ctx, W, H, spec) {
  ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, W, H);
  const m = { l: 50, r: 14, t: 36, b: 34 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of spec.series) for (const p of (s.range || s.pts)) { if (!isFinite(p[0]) || !isFinite(p[1])) continue; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  ctx.font = '600 13px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#1b2333'; ctx.fillText(spec.title || '', 10, 14);
  if (!isFinite(x0)) { ctx.font = '12px ' + FONT; ctx.fillStyle = '#8a93a6'; ctx.textAlign = 'center'; ctx.fillText('暂无数据', W / 2, H / 2); return null; }
  y0 = Math.min(y0, 0); y1 = Math.max(y1, 0);
  if (x1 - x0 < 1e-9) { x0 -= 0.5; x1 += 0.5; }
  if (y1 - y0 < 1e-9) { y0 -= 0.5; y1 += 0.5; }
  const pad = (y1 - y0) * 0.08; y1 += pad; y0 -= pad;
  const pw = W - m.l - m.r, ph = H - m.t - m.b, X = x => m.l + (x - x0) / (x1 - x0) * pw, Y = y => m.t + ph - (y - y0) / (y1 - y0) * ph;
  const ln = (a, b2, c, d) => { ctx.beginPath(); ctx.moveTo(a, b2); ctx.lineTo(c, d); ctx.stroke(); };
  const ticks = (lo, hi, n, cb) => { const st = niceStep(hi - lo, n), dec = clamp(-Math.floor(Math.log10(st) + 1e-9), 0, 6); for (let v = Math.ceil(lo / st - 1e-9) * st, k = 0; v <= hi + st * 1e-6 && k < 200; v += st, k++) cb(v, (Math.abs(v) < st * 1e-6 ? 0 : v).toFixed(dec)); };
  ctx.font = '11px ' + FONT; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ticks(x0, x1, Math.max(2, Math.floor(pw / 64)), (v, l) => { const x = X(v); ctx.strokeStyle = '#ece6da'; ln(x, m.t, x, m.t + ph); ctx.fillStyle = '#6b7488'; ctx.fillText(l, x, m.t + ph + 11); });
  ctx.textAlign = 'right';
  ticks(y0, y1, Math.max(2, Math.floor(ph / 34)), (v, l) => { const y = Y(v); ctx.strokeStyle = '#ece6da'; ln(m.l, y, m.l + pw, y); ctx.fillStyle = '#6b7488'; ctx.fillText(l, m.l - 6, y); });
  ctx.strokeStyle = '#b9b1a0'; ctx.strokeRect(m.l + 0.5, m.t + 0.5, pw, ph);
  if (y0 < 0 && y1 > 0) { ctx.strokeStyle = '#8a8271'; ln(m.l, Y(0), m.l + pw, Y(0)); }
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
  if (spec.vlines) { ctx.strokeStyle = 'rgba(86,96,120,.55)'; ctx.setLineDash([4, 4]); for (const v of spec.vlines) ln(X(v), m.t, X(v), m.t + ph); ctx.setLineDash([]); }
  const path = pts => { ctx.beginPath(); let pen = false; for (const p of pts) { if (!isFinite(p[0]) || !isFinite(p[1])) { pen = false; continue; } const x = X(p[0]), y = Y(p[1]); if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } } ctx.stroke(); };
  for (const s of spec.series) {
    ctx.strokeStyle = s.color; ctx.lineJoin = 'round';
    if (s.ghost) { ctx.globalAlpha = 0.26; ctx.lineWidth = 2; path(s.ghost); ctx.globalAlpha = 1; }
    ctx.lineWidth = s.width || 2.2; path(s.pts);
    if (s.points) { ctx.fillStyle = s.color; for (const p of s.pts) if (isFinite(p[0]) && isFinite(p[1])) { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 2.8, 0, 6.3); ctx.fill(); } }
  }
  ctx.restore();
  if (spec.cursor != null && isFinite(spec.cursor)) { ctx.strokeStyle = 'rgba(224,49,49,.7)'; ctx.lineWidth = 1; ln(X(spec.cursor), m.t, X(spec.cursor), m.t + ph); }
  for (const s of spec.series) if (s.dot && isFinite(s.dot[0]) && isFinite(s.dot[1])) {
    const dx = X(s.dot[0]), dy = Y(s.dot[1]);
    ctx.beginPath(); ctx.arc(dx, dy, 4.2, 0, 6.3); ctx.fillStyle = s.color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    if (spec.readout) {   // 联动读数
      const lab = nfix(s.dot[1], 2), right = dx < m.l + pw - 48, tx = dx + (right ? 7 : -7), ty = clamp(dy - 9, m.t + 7, m.t + ph - 5);
      ctx.font = '600 11px ' + FONT; ctx.textAlign = right ? 'left' : 'right'; ctx.lineWidth = 3; ctx.strokeStyle = '#fffdf8'; ctx.strokeText(lab, tx, ty); ctx.fillStyle = s.color; ctx.fillText(lab, tx, ty);
    }
  }
  ctx.font = '11px ' + FONT; ctx.fillStyle = '#6b7488'; ctx.textAlign = 'left'; ctx.fillText(spec.yLabel || '', 8, m.t - 9);
  ctx.textAlign = 'right'; ctx.fillText(spec.xLabel || '', W - m.r, H - 9);
  let lx = W - 10; ctx.textAlign = 'right';
  for (let i = spec.series.length - 1; i >= 0; i--) { const s = spec.series[i]; if (!s.name) continue; const tw = ctx.measureText(s.name).width; ctx.fillStyle = '#3a4358'; ctx.fillText(s.name, lx, 14); ctx.strokeStyle = s.color; ctx.lineWidth = 3; ln(lx - tw - 18, 14, lx - tw - 4, 14); lx -= tw + 28; }
  return { x0, x1, y0, y1, left: m.l, width: pw, top: m.t, height: ph };
}
/* 图表注册表（扩展点）：y / x 可以是状态字段名或函数；名称中的 @ 会替换为 传送带/木板 */
const CHARTS = [
  { id: 'vt', name: 'v-t 速度-时间', xl: 't / s', yl: 'v / (m·s⁻¹)', time: true, series: [{ n: '物块', c: COL.block, x: 't', y: 'vb' }, { n: '@', c: COL.carrier, x: 't', y: 'vc' }] },
  { id: 'vx', name: 'v-x 速度-位移', xl: 'x / m', yl: 'v / (m·s⁻¹)', series: [{ n: '物块', c: COL.block, x: 'sb', y: 'vb' }, { n: '@', c: COL.carrier, x: 'sc', y: 'vc' }] },
  { id: 'xt', name: 'x-t 位移-时间', xl: 't / s', yl: 'x / m', time: true, series: [{ n: '物块', c: COL.block, x: 't', y: 'sb' }, { n: '@', c: COL.carrier, x: 't', y: 'sc' }, { n: '相对Δx', c: COL.rel, x: 't', y: 'dRel' }] },
  { id: 'v2x', name: 'v²-x', xl: 'x / m', yl: 'v² / (m²·s⁻²)', series: [{ n: '物块', c: COL.block, x: 'sb', y: s => s.vb * s.vb }, { n: '木板', c: COL.carrier, x: 'sc', y: s => s.vc * s.vc, boardOnly: true }] },
  { id: 'at', name: 'a-t 加速度-时间', xl: 't / s', yl: 'a / (m·s⁻²)', time: true, series: [{ n: '物块', c: COL.block, x: 't', y: 'ab' }, { n: '@', c: COL.carrier, x: 't', y: 'ac' }] },
  { id: 'ft', name: 'f-t 摩擦力-时间', xl: 't / s', yl: 'f / N', time: true, series: [{ n: '物块受f', c: COL.block, x: 't', y: 'fb' }, { n: '地面对板f', c: COL.carrier, x: 't', y: 'f2', boardOnly: true }] },
  { id: 'Qt', name: 'Q-t 摩擦生热', xl: 't / s', yl: 'Q / J', time: true, series: [{ n: 'Q(物块-@)', c: COL.flag, x: 't', y: 'Q1' }, { n: 'Q(地面)', c: COL.extra, x: 't', y: 'Q2', boardOnly: true }] },
  { id: 'Et', name: 'E-t 能量', xl: 't / s', yl: 'E / J', time: true, series: [{ n: 'Ek物', c: COL.block, x: 't', y: 'Ekb' }, { n: 'Ek板', c: COL.carrier, x: 't', y: 'Ekc', boardOnly: true }, { n: 'ΔEp', c: COL.rel, x: 't', y: 'dEp' }, { n: 'Q总', c: COL.flag, x: 't', y: s => s.Q1 + s.Q2 + (s.Ec || 0) }] }
];
function chartSpec(def, sim, t, full) {
  const cn = sim.isBelt ? '传送带' : '木板', cur = stateAt(sim, t), get = (s, k) => typeof k === 'function' ? k(s) : s[k];
  const series = def.series.filter(s => !(s.boardOnly && sim.isBelt && !sim.combo)).map(s => {
    const all = sim.samples.map(p => [get(p, s.x), get(p, s.y)]), done = [];
    for (const p of sim.samples) { if (p.t <= t + 1e-9) done.push([get(p, s.x), get(p, s.y)]); else break; }
    const dot = [get(cur, s.x), get(cur, s.y)]; done.push(dot);
    return { name: sim.names ? (sim.names[s.n] || s.n) : sim.duo ? (DUO_NAMES[s.n] || s.n) : s.n.replace('@', cn), color: s.c, pts: done, ghost: full ? all : null, range: all, dot };
  });
  return { title: def.name, xLabel: def.xl, yLabel: def.yl, series, vlines: def.time ? sim.segs.slice(0, -1).map(g => g.t1) : null, cursor: def.time ? cur.t : null, readout: !!App.linked };
}
/* 场景动画 */
function renderScene(ctx, W, H, sim, st, o) {
  o = o || {};
  if (o.mode === '3d' && sim.render3D) return sim.render3D(ctx, W, H, sim, st, o);
  if (o.mode === '3d' && !sim.no3D) return render3D(ctx, W, H, sim, st, o);        // 3D 视图
  if (sim.render2D) return sim.render2D(ctx, W, H, sim, st, o);        // 模型自带的 2D 画法（如人船模型）
  const P = sim.P, b = sim.isBelt, th = P.rad, small = W < 480, vw = o.view || {};
  const span = Math.max(sim.xmax - sim.xmin, 1e-6), padX = small ? 28 : 54, padT = H * 0.4, padB = H * 0.17;
  const s = (vw.zoom || 1) * Math.min((W - 2 * padX) / (span * Math.cos(th)), (H - padT - padB) / Math.max(span * Math.sin(th), 1e-9));
  const cx = W / 2 + (vw.x || 0), cy = padT + (H - padT - padB) / 2 + (vw.y || 0), xmid = vw.follow ? st.xb : (sim.xmin + sim.xmax) / 2, X = x => (x - xmid) * s;
  const duo = !!sim.duo, bs = small ? 22 : 30, hB = (b || duo) ? 0 : (small ? 10 : 14), R = small ? 9 : 12, top = -hB;
  ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(70,90,130,.07)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0.5; x < W; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = 0.5; y < H; y += 20) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
  const ln = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const txt = (str, x, y, al, col, font) => { ctx.save(); ctx.translate(x, y); ctx.rotate(th); ctx.font = font || ('12px ' + FONT); ctx.textAlign = al || 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col || '#1b2333'; ctx.fillText(str, 0, 0); ctx.restore(); };
  const arrow = (x1, y, x2, col, w) => { const d = x2 > x1 ? 1 : -1; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w || 2; ln(x1, y, x2 - d * 5, y); ctx.beginPath(); ctx.moveTo(x2, y); ctx.lineTo(x2 - d * 8, y - 4); ctx.lineTo(x2 - d * 8, y + 4); ctx.closePath(); ctx.fill(); };
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-th);
  // 红旗位置
  const cnt = { ground: 0, carrier: 0 };
  const flags = (o.flags || []).map(f => { const n = ++cnt[f.anchor]; if (f.t > st.t + 1e-9 || (duo && f.anchor === 'carrier')) return null; const fs = peekState(sim, f.t); if (fs.stage !== st.stage) return null; return { anchor: f.anchor, label: (f.anchor === 'ground' ? '地' : (b ? '带' : '板')) + n, x: f.anchor === 'ground' ? fs.xb : fs.xr + st.xc }; }).filter(Boolean);
  const drawFlag = f => {
    const g = f.anchor === 'ground', x = X(f.x), y0 = g ? 0 : top, hh = g ? (small ? 44 : 54) + hB : (small ? 28 : 34), d = g ? 1 : -1;
    ctx.strokeStyle = g ? '#6b7280' : '#4a3520'; ctx.lineWidth = 2; ln(x, y0, x, y0 - hh);
    ctx.fillStyle = COL.flag; ctx.beginPath(); ctx.moveTo(x, y0 - hh); ctx.lineTo(x + d * 15, y0 - hh + 6); ctx.lineTo(x, y0 - hh + 12); ctx.closePath(); ctx.fill();
    txt(f.label, x + d * 18, y0 - hh + 6, g ? 'left' : 'right', '#a61e1e', '600 11px ' + FONT);
  };
  if (!b) {   // 地面 / 斜面
    const gx0 = X(sim.xmin) - 30, gx1 = X(sim.xmax) + 30;
    ctx.fillStyle = '#ebe4d4'; ctx.fillRect(gx0, 0, gx1 - gx0, 8);
    ctx.strokeStyle = '#b8ad96'; ctx.lineWidth = 1; for (let x = gx0 + 4; x < gx1 - 6; x += 10) ln(x + 7, 1, x, 8);
    ctx.strokeStyle = '#4b556b'; ctx.lineWidth = 2; ln(gx0, 0, gx1, 0);
  }
  flags.filter(f => f.anchor === 'ground').forEach(drawFlag);
  if (b) {    // 传送带
    const xa = X(0), xz = X(P.L);
    ctx.beginPath(); ctx.moveTo(xa, 0); ctx.lineTo(xz, 0); ctx.arc(xz, R, R, -Math.PI / 2, Math.PI / 2); ctx.lineTo(xa, 2 * R); ctx.arc(xa, R, R, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
    ctx.fillStyle = '#e9ecf2'; ctx.fill(); ctx.strokeStyle = '#7d869b'; ctx.lineWidth = 3; ctx.stroke();
    const sp = niceStep(span, 22), off = ((st.xc % sp) + sp) % sp;
    ctx.strokeStyle = '#7d869b'; ctx.lineWidth = 1.5;
    for (let x = off, k = 0; x <= P.L + 1e-9 && k < 400; x += sp, k++) ln(X(x), 1, X(x), 6);
    for (let x = P.L - off, k = 0; x >= -1e-9 && k < 400; x -= sp, k++) ln(X(x), 2 * R - 1, X(x), 2 * R - 6);
    const ang = st.xc * s / R;
    for (const px of [xa, xz]) {
      ctx.beginPath(); ctx.arc(px, R, R - 3.5, 0, 6.3); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#4b556b'; ctx.lineWidth = 1.5; ctx.stroke();
      for (let k = 0; k < 3; k++) { const a = ang + k * 2.0944; ln(px, R, px + Math.cos(a) * (R - 4), R + Math.sin(a) * (R - 4)); }
    }
  } else if (!duo) {    // 木板
    const bx0 = X(st.xc), bw = P.L * s;
    ctx.fillStyle = '#dfb97f'; ctx.fillRect(bx0, -hB, bw, hB); ctx.strokeStyle = '#8a5a22'; ctx.lineWidth = 1.5; ctx.strokeRect(bx0, -hB, bw, hB);
    ctx.strokeStyle = 'rgba(138,90,34,.35)'; ctx.lineWidth = 1; ln(bx0 + 4, -hB / 2, bx0 + bw - 4, -hB / 2);
    txt('M', bx0 + bw / 2, -hB / 2, 'center', '#5b3a12', 'italic 600 11px ' + FONT);
  }
  if (st.rMax - st.rMin > 1e-6) {   // 痕迹
    let a = st.rMin + st.xc, z = st.rMax + st.xc; if (b) { a = clamp(a, 0, P.L); z = clamp(z, 0, P.L); }
    if (z - a > 1e-9) { ctx.strokeStyle = 'rgba(15,15,20,.9)'; ctx.lineWidth = 4.5; ctx.lineCap = 'butt'; ln(X(a), top + 0.5, X(z), top + 0.5); }
  }
  flags.filter(f => f.anchor === 'carrier' && (!b || (f.x >= -1e-9 && f.x <= P.L + 1e-9))).forEach(drawFlag);
  // 物块
  const offA = duo && P.collision !== 'none' ? (sim.aLeft ? -bs / 2 : bs / 2) : 0;   // duo：A、B 以接触面为定位点，相碰时恰好相贴
  const by = st.on ? top : 0, bx = X(st.xb) + offA;
  if (duo) {
    const bx2 = X(st.xc) - offA; ctx.globalAlpha = P.collision === 'none' ? 0.78 : 1;
    ctx.fillStyle = COL.carrier; ctx.strokeStyle = '#0b4f8a'; ctx.lineWidth = 1.5; ctx.fillRect(bx2 - bs / 2, -bs, bs, bs); ctx.strokeRect(bx2 - bs / 2, -bs, bs, bs); ctx.globalAlpha = 1;
    txt('B', bx2, -bs / 2, 'center', '#fff', 'italic 600 13px ' + FONT);
  }
  ctx.fillStyle = COL.block; ctx.strokeStyle = '#a13a0a'; ctx.lineWidth = 1.5; ctx.fillRect(bx - bs / 2, by - bs, bs, bs); ctx.strokeRect(bx - bs / 2, by - bs, bs, bs);
  txt(duo ? 'A' : 'm', bx, by - bs / 2, 'center', '#fff', 'italic 600 13px ' + FONT);
  if (o.showVec !== false) {
    const k = (small ? 44 : 64) / sim.vmax, va = v => Math.sign(v) * Math.max(14, Math.abs(v) * k);
    if (Math.abs(st.vb) > 1e-6) { const d = Math.sign(st.vb), x1 = bx + d * bs / 2; arrow(x1, by - bs * 0.62, x1 + va(st.vb), '#c2410c'); txt((duo ? 'vA=' : 'v=') + nfix(st.vb, 2), x1 + va(st.vb) + d * 4, by - bs * 0.62 - 1, d > 0 ? 'left' : 'right', '#c2410c', '11px ' + FONT); }
    if (!o.forces && Math.abs(st.fb) > 1e-9) { const d = Math.sign(st.fb); arrow(bx, by - 5, bx + d * (small ? 22 : 28), '#9c36b5', 2); txt('f', bx + d * (small ? 28 : 35), by - 6, 'center', '#9c36b5', 'italic 600 12px ' + FONT); }
    if (Math.abs(st.vc) > 1e-6) {
      const d = Math.sign(st.vc);
      if (b) { const xm = X(P.L / 2) - va(st.vc) / 2; arrow(xm, R, xm + va(st.vc), COL.carrier); txt('v带=' + nfix(st.vc, 2), X(P.L / 2), 2 * R + 11, 'center', COL.carrier, '11px ' + FONT); }
      else if (duo) { const x1 = X(st.xc) - offA + d * bs / 2; arrow(x1, -bs * 0.38, x1 + va(st.vc), COL.carrier); txt('vB=' + nfix(st.vc, 2), x1 + va(st.vc) + d * 4, -bs * 0.38 - 1, d > 0 ? 'left' : 'right', COL.carrier, '11px ' + FONT); }
      else { const x1 = X(st.xc + (d > 0 ? P.L : 0)); arrow(x1, -hB / 2, x1 + va(st.vc), COL.carrier); txt('v板=' + nfix(st.vc, 2), x1 + va(st.vc) / 2, 18, 'center', COL.carrier, '11px ' + FONT); }
    }
  }
  // 标注：物块到最近一面带/板旗、地面旗的距离
  // 力学分析模式：受力示意（G、N、f、F、合力）与加速度
  if (o.forces) {
    const bodies = [{ x: bx, y: by, m: P.m, f: st.fb, F: st.Fb, a: st.ab }];
    if (duo) bodies.push({ x: X(st.xc) - offA, y: 0, m: P.M, f: st.f2, F: 0, a: st.ac });
    const fmaxv = Math.max.apply(null, bodies.map(q => Math.max(q.m * P.g, Math.abs(q.f), Math.abs(q.F), Math.abs(q.m * q.a)))), kf = (small ? 40 : 58) / Math.max(fmaxv, 1e-9);
    const vec = (x1, y1, dx, dy, col, label, dash) => {
      const len = Math.hypot(dx, dy); if (len < 3) return; const ux = dx / len, uy = dy / len, x2 = x1 + dx, y2 = y1 + dy;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2; if (dash) ctx.setLineDash([5, 3]); ln(x1, y1, x2 - ux * 6, y2 - uy * 6); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * 9 - uy * 4, y2 - uy * 9 + ux * 4); ctx.lineTo(x2 - ux * 9 + uy * 4, y2 - uy * 9 - ux * 4); ctx.closePath(); ctx.fill();
      txt(label, x2 + ux * 11, y2 + uy * 11, 'center', col, '600 11px ' + FONT);
    };
    bodies.forEach(q => {
      const G = q.m * P.g, cy0 = q.y - bs / 2, sg = Math.sign(q.a) || 1;
      vec(q.x, cy0, -Math.sin(th) * G * kf, Math.cos(th) * G * kf, '#2f3b52', 'G');
      vec(q.x, cy0, 0, -G * P.cos * kf, '#0b7285', 'N');
      if (Math.abs(q.f) > 1e-9) vec(q.x, q.y - 3, q.f * kf, 0, '#9c36b5', 'f');
      if (Math.abs(q.F) > 1e-9) vec(q.x, cy0, q.F * kf, 0, '#d9480f', 'F');
      if (Math.abs(q.a) > 1e-9) { vec(q.x + sg * 6, q.y - bs - 9, q.m * q.a * kf, 0, '#c92a2a', 'F合', true); vec(q.x + sg * 6, q.y - bs - 22, sg * clamp(Math.abs(q.a) * 7, 16, 64), 0, '#1f7a36', 'a'); }
    });
  }
  const dim = (xa, xz, y, col, label) => { if (Math.abs(xz - xa) < 3) return; ctx.strokeStyle = col; ctx.lineWidth = 1.2; ln(xa, y, xz, y); ln(xa, y - 4, xa, y + 4); ln(xz, y - 4, xz, y + 4); txt(label, (xa + xz) / 2, y - 8, 'center', col, '600 11px ' + FONT); };
  const lastOf = a => { for (let i = flags.length - 1; i >= 0; i--) if (flags[i].anchor === a) return flags[i]; return null; };
  const fc = lastOf('carrier'), fg = lastOf('ground');
  if (fc && st.on) dim(X(fc.x), bx, top - bs - (small ? 22 : 30), COL.rel, 'Δx相对=' + nfix(st.xb - fc.x, 2) + 'm');
  if (fg) dim(X(fg.x), bx - offA, top - bs - (small ? 40 : 52), COL.carrier, (duo ? 'xA=' : 'x物=') + nfix(st.xb - fg.x, 2) + 'm');
  ctx.restore();
  // 倾角标识
  if (th > 1e-6) {
    const xl = X(sim.xmin) - (b ? R : 30), yl = b ? 2 * R : 0, p0 = [cx + xl * Math.cos(th) + yl * Math.sin(th), cy - xl * Math.sin(th) + yl * Math.cos(th)];
    ctx.strokeStyle = '#8a93a6'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ln(p0[0], p0[1], p0[0] + 96, p0[1]); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p0[0], p0[1], 38, -th, 0); ctx.stroke();
    ctx.font = '12px ' + FONT; ctx.fillStyle = '#566078'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('θ=' + nfix(P.theta, 1) + '°', p0[0] + 44, p0[1] - 9);
  }
  // HUD
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = '#1b2333'; ctx.font = '600 14px ui-monospace,Consolas,monospace'; ctx.fillText('t = ' + st.t.toFixed(3) + ' s', 12, 22);
  if (sim.segs.length) {
    ctx.font = '12px ' + FONT; ctx.fillStyle = '#566078';
    let str = '过程 ' + (st.i + 1) + '/' + sim.segs.length + ' · ' + sim.phases[st.i].title, cut = false;
    while (ctx.measureText(str).width > W - 110 && str.length > 6) { str = str.slice(0, -1); cut = true; }
    ctx.fillText(str + (cut ? '…' : ''), 12, 40);
  }
  ctx.save(); ctx.translate(W - 58, 22); ctx.rotate(-th); arrow(0, 0, 40, '#566078', 1.5); ctx.restore();
  ctx.font = '11px ' + FONT; ctx.fillStyle = '#566078'; ctx.textAlign = 'right'; ctx.fillText('正方向', W - 64, 26);
}

/* =====================================================================
 * 6. 应用状态与模拟页 UI
 * ===================================================================== */
const K_STORE = 'pbsim.store.v1', K_UI = 'pbsim.ui.v1', K_AI = 'pbsim.ai.v1', K_PROMPT = 'pbsim.prompts.v1';
const App = { orphans: [], store: { configs: [], currentId: null }, cfg: null, inp: null, sim: null, t: 0, playing: false, speed: 1, stopAt: null, stepMode: false,
  charts: ['vt', 'xt', 'vx'], fullCurve: true, showVec: true, dirty: true, lastPhase: -1, statKeys: [], lastInput: null };
const saveStore = debounce(() => LS.set(K_STORE, Object.assign({}, App.store, { orphans: App.orphans })), 250);
const saveUI = () => LS.set(K_UI, { charts: App.charts, fullCurve: App.fullCurve, showVec: App.showVec, stepMode: App.stepMode, forces: !!App.forces, linked: App.linked !== false });
function restoreApprox() { if (App.cfg) Expr.setApprox(App.cfg.options.approx37 !== false); }

function renderCfgSel() {
  const s = $('#cfgSel'); s.innerHTML = App.store.configs.map(c => '<option value="' + c.id + '">' + esc(c.name) + '（' + MODELS[c.model].short + '）</option>').join('');
  s.value = App.cfg.id; $('#cfgName').value = App.cfg.name;
}
function setCurrent(cfg) {
  App.cfg = cfg; App.store.currentId = cfg.id; App.sim = null;
  renderCfgSel(); renderModelUI(); recompute(); refreshSweepForm(); refreshAITokens();
}
function addConfig(cfg) { App.store.configs.push(cfg); setCurrent(cfg); }
function replaceCurrent(n) { const i = App.store.configs.findIndex(c => c.id === App.cfg.id); n.id = App.cfg.id; App.store.configs[i] = n; setCurrent(n); }
function paramField(p, cfg) {
  const v = cfg.params[p.key] == null ? '' : cfg.params[p.key];
  if (Array.isArray(p.opts)) return '<select id="p_' + p.key + '">' + p.opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  return '<input id="p_' + p.key + '" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(v) + '">';
}
function renderModelUI() {
  const cfg = App.cfg, M = MODELS[cfg.model];
  $('#modelSeg').innerHTML = Object.keys(MODELS).filter(k => k !== 'combo' && !MODELS[k].hidden).map(k => '<button data-model="' + k + '"' + (MODELS[k].plugin ? ' title="来自插件：' + esc(MODELS[k].plugin) + '"' : '') + '>' + esc(k === 'duo' ? '碰撞相遇' : (MODELS[k].segLabel || MODELS[k].short)) + '</button>').join('');
  $$('#modelSeg button').forEach(b => b.classList.toggle('on', b.dataset.model === cfg.model));
  $('#presetSel').innerHTML = '<option value="">— 选择例题 —</option>' + M.presets.map((p, i) => '<option value="' + i + '">' + esc(p.name) + '</option>').join('');
  const groups = {}; M.params.forEach(p => { (groups[p.group] = groups[p.group] || []).push(p); });
  $('#paramBox').innerHTML = Object.keys(groups).map(g => '<fieldset class="pg"><legend>' + g + '</legend>' + groups[g].map(p =>
    '<div class="prow" data-key="' + p.key + '"><label for="p_' + p.key + '"><i class="sym">' + p.sym + '</i>' + p.name + '</label>' +
    '<div class="pin">' + paramField(p, cfg) + '<span class="unit">' + (p.unit || '') + '</span></div>' +
    '<div class="phint" id="h_' + p.key + '"></div></div>').join('') + '</fieldset>').join('');
  $('#optApprox').checked = cfg.options.approx37 !== false;
  $('#optLeave').value = cfg.options.afterLeave || 'stop';
  $('#optLeaveWrap').hidden = cfg.model !== 'board';
  $('#optCollWrap').hidden = cfg.model !== 'duo'; $('#optColl').value = cfg.options.collision || 'elastic'; $('#btnFlagC').hidden = cfg.model === 'duo' || !!M.noCarrier;
  $('#btnFlagC').textContent = '只插' + (M.carrier || '载体') + '旗';
  const c = cfg.model === 'belt' ? '带' : '板';
  const items = M.stats ? M.stats.map(x => x.slice()) : cfg.model === 'combo'
    ? [['t', 't', 's'], ['stageNo', '阶段', ''], ['sb', '路程 s', 'm'], ['vb', 'v', 'm/s'], ['ab', 'a', 'm/s²'], ['fb', 'f', 'N'], ['vc', 'v载体', 'm/s'], ['vr', 'v相对', 'm/s'], ['sRel', 's相对', 'm'], ['Qsum', 'Q摩擦', 'J'], ['Ec', 'ΔE碰', 'J'], ['Ekb', 'Ek', 'J']]
    : cfg.model === 'boat'
    ? [['t', 't', 's'], ['sb', 'x人', 'm'], ['vb', 'v人', 'm/s'], ['ab', 'a人', 'm/s²'], ['sc', 'x船', 'm'], ['vc', 'v船', 'm/s'], ['ac', 'a船', 'm/s²'], ['vr', 'v相对', 'm/s'], ['dRel', '人相对船', 'm'], ['fb', 'f人', 'N'], ['pb', 'p人', 'kg·m/s'], ['pc', 'p船', 'kg·m/s']]
    : cfg.model === 'duo'
    ? [['t', 't', 's'], ['sb', 'xA', 'm'], ['vb', 'vA', 'm/s'], ['ab', 'aA', 'm/s²'], ['sc', 'xB', 'm'], ['vc', 'vB', 'm/s'], ['ac', 'aB', 'm/s²'], ['vr', 'vA−vB', 'm/s'], ['xr', 'xA−xB', 'm'], ['Q1', 'QA', 'J'], ['Q2', 'QB', 'J'], ['Ec', 'ΔE碰', 'J']]
    : [['t', 't', 's'], ['sb', 'x物', 'm'], ['vb', 'v物', 'm/s'], ['ab', 'a物', 'm/s²'], ['sc', 'x' + c, 'm'], ['vc', 'v' + c, 'm/s'], ['vr', 'v相对', 'm/s'], ['dRel', 'Δx相对', 'm'], ['sRel', 's相对', 'm'], ['mark', '痕迹长', 'm'], ['Q1', 'Q', 'J'], ['fb', 'f物', 'N']];
  PL.varsFor(cfg.model).forEach(v => { if (v.stat !== false && !items.some(i => i[0] === v.key)) items.push([v.key, v.label, v.unit || '']); });
  $('#stats').innerHTML = items.map(i => '<div class="st"><span>' + i[1] + '</span><b id="st_' + i[0] + '">0</b><em>' + i[2] + '</em></div>').join('');
  App.statKeys = items.map(i => i[0]);
  const pr = cfg.problem || {}; $('#probTitle').value = pr.title || ''; $('#probText').value = pr.text || ''; $('#probAns').value = pr.answer || ''; $('#probAna').value = pr.analysis || '';
  renderChartGrid();
}
function updateHints(inp) {
  const cfg = App.cfg;
  MODELS[cfg.model].params.forEach(p => {
    const row = $('.prow[data-key="' + p.key + '"]'), h = $('#h_' + p.key); if (!row) return;
    const err = inp.errors[p.key]; row.classList.toggle('err', !!err);
    if (err) { h.textContent = err; return; }
    const s = String(cfg.params[p.key] || '').trim(), v = inp.P[p.key]; let tip = p.hint || '';
    if (p.kind === 'angle' && isFinite(v) && inp.ok) tip = '= ' + nfix(v, 3) + '°，sinθ = ' + fmt(inp.P.sin) + '，cosθ = ' + fmt(inp.P.cos);
    else if (s !== '' && isFinite(v) && !/^-?\d+(\.\d+)?$/.test(s)) tip = '= ' + nfix(v, 4) + (p.hint ? ' · ' + p.hint : '');
    h.innerHTML = mathText(tip);
  });
}
function recompute() {
  const cfg = App.cfg, inp = buildInput(cfg); App.inp = inp; updateHints(inp);
  const eb = $('#errBanner');
  if (inp.ok) { App.sim = simulate(inp.P); eb.hidden = true; }
  else { eb.hidden = false; eb.textContent = inp.errors._msg ? inp.errors._msg : '有 ' + Object.keys(inp.errors).length + ' 个参数填写有误，请按红色提示修改' + (App.sim ? '（下方仍显示上一次有效的模拟）' : '') + '。'; }
  App.t = 0; App.playing = false; App.stopAt = null; App.lastPhase = -1; updatePlayBtn();
  renderCombo(); renderPhases(); renderBookmarks(); renderResults(); renderSolution(); renderMeasure(); renderFlagList(); App.dirty = true; saveStore();
  document.title = cfg.name + ' · PhysLab';
  PL.run('configChanged', { cfg, sim: App.sim, inp }); PL.refreshInfoTabs();
}
const scheduleRecompute = debounce(recompute, 140);

function renderPhases() {
  const sim = App.sim, chips = $('#phaseChips'), list = $('#phaseList'), ticks = $('#tlTicks');
  if (!sim) { chips.innerHTML = ''; ticks.innerHTML = ''; list.innerHTML = '<p class="muted">参数有误，暂无模拟结果。</p>'; return; }
  if (!sim.segs.length) { chips.innerHTML = ''; ticks.innerHTML = ''; list.innerHTML = '<p class="muted">物块在 t = 0 时已处于边缘并向外运动，立即离开。请检查初始位置与速度方向。</p>'; return; }
  $('#stageSub').textContent = MODELS[App.cfg.model].name;
  // 过程轨道：每段宽度与时长成正比，与上方时间轴对齐
  chips.innerHTML = sim.segs.map((g, i) => '<button data-i="' + i + '" style="flex-grow:' + Math.max(g.t1 - g.t0, sim.tEnd * 0.02).toFixed(4) + '" title="过程 ' + (i + 1) + '（' + nfix(g.t0, 2) + '–' + nfix(g.t1, 2) + ' s）：' + esc(sim.phases[i].title) + '" aria-label="跳到过程 ' + (i + 1) + '">' + (i + 1) + '</button>').join('');
  ticks.innerHTML = sim.segs.slice(0, -1).map(g => '<i style="left:' + (g.t1 / sim.tEnd * 100).toFixed(3) + '%"></i>').join('');
  list.innerHTML = sim.segs.map((g, i) => {
    const d = sim.phases[i];
    return '<article class="ph" data-i="' + i + '"><header><b class="ph-n">' + (i + 1) + '</b><span>' + mathText(fmt(g.t0) + ' s → ' + fmt(g.t1) + ' s') + '</span><button class="btn mini" data-play="' + i + '">播放此过程</button></header>' +
      '<h5>' + esc(d.title) + '</h5><ul>' + d.lines.map(l => '<li>' + phaseLine(l) + '</li>').join('') + '</ul><footer>' + mathText('结束：' + d.end) + '</footer></article>';
  }).join('');
}
function renderResults() {
  const sim = App.sim, box = $('#resultBox');
  if (!sim) { box.innerHTML = '<p class="muted">暂无结果</p>'; return; }
  const S = sim.summary;
  box.innerHTML = resultTiles(sim) + '<table class="kv"><tbody>' + resultRows(sim).map(r => '<tr><td>' + mathText(r[0]) + '</td><td>' + mathText(r[1]) + '</td></tr>').join('') + '</tbody></table>' +
    (!sim.duo && S.sRel - S.mark > 1e-6 ? '<div class="qbox" style="margin-top:10px">痕迹有重叠：痕迹长度 <b>' + esc(fmt(S.mark)) + ' m</b> 小于相对路程 <b>' + esc(fmt(S.sRel)) + ' m</b>。求 Q 要用相对路程。</div>' : '') +
    '<p class="note">带 “≈” 的结果同时给出了保留根号 / 分数的精确形式。</p>';
}
function flagLabels() { const c = { ground: 0, carrier: 0 }, b = App.cfg.model === 'belt'; return App.cfg.flags.map(f => (f.anchor === 'ground' ? '地' : (b ? '带' : '板')) + (++c[f.anchor])); }
function renderFlagList() {
  const labs = flagLabels(), b = App.cfg.model === 'belt';
  $('#flagList').innerHTML = App.cfg.flags.length ? App.cfg.flags.map((f, i) => '<li><span class="fl">' + labs[i] + '</span><span>' + (f.anchor === 'ground' ? '地面旗' : (b ? '传送带旗' : '木板旗')) + ' · t = ' + nfix(f.t, 3) + ' s 插入</span><b id="fd_' + f.id + '">—</b><button class="btn mini" data-del="' + f.id + '" aria-label="删除红旗">×</button></li>').join('') : '<li class="muted" style="border-style:dashed">还没有红旗。播放到某一时刻后点击上方按钮插旗。</li>';
  App.dirty = true;
}
function plantFlag(anchors) {
  const sim = App.sim; if (!sim) return; const st = stateAt(sim, App.t); let n = 0;
  anchors.forEach(a => { if (a === 'carrier' && sim.duo) return; if (a === 'carrier' && !st.on) { toast('物块已离开木板，无法插木板旗'); return; } App.cfg.flags.push({ id: uid(), anchor: a, t: +App.t.toFixed(4) }); n++; });
  if (n) { renderFlagList(); saveStore(); toast('已在 t = ' + nfix(App.t, 3) + ' s 的物块位置插旗', 'ok'); }
}
function renderChartGrid() {
  const vis = CHARTS.filter(c => chartVisible(c, App.cfg.model));
  let on = vis.filter(c => App.charts.indexOf(c.id) >= 0);
  if (!on.length && vis.length) {
    const want = MODELS[App.cfg.model].defaultCharts || []; on = vis.filter(c => want.indexOf(c.id) >= 0); if (!on.length) on = vis.slice(0, 2);
    on.forEach(c => { if (App.charts.indexOf(c.id) < 0) App.charts.push(c.id); });
  }
  $('#chartChips').innerHTML = vis.map(c => '<button data-id="' + c.id + '" class="' + (on.indexOf(c) >= 0 ? 'on' : '') + '"' + (c.plugin ? ' title="来自插件：' + esc(c.plugin) + '"' : '') + '>' + c.name + '</button>').join('');
  $('#chartGrid').innerHTML = on.map(c => '<figure class="chart" data-id="' + c.id + '"><canvas aria-label="' + c.name + '"></canvas><button class="btn mini" data-png="' + c.id + '">PNG</button></figure>').join('') || '<p class="muted">请在上方选择要显示的图表。</p>';
  App.dirty = true;
}
function updatePlayBtn() { $('#btnPlay').innerHTML = App.playing ? ICON.pause + '暂停' : ICON.play + '播放'; }
function seek(t) { if (!App.sim) return; App.t = clamp(t, 0, App.sim.tEnd); App.playing = false; App.stopAt = null; updatePlayBtn(); App.dirty = true; }
function togglePlay() {
  const sim = App.sim; if (!sim || !sim.segs.length) return;
  if (App.playing) { App.playing = false; App.stopAt = null; }
  else { if (App.t >= sim.tEnd - 1e-9) App.t = 0; App.playing = true; }
  updatePlayBtn(); App.dirty = true;
}
function gotoPhase(d) {
  const sim = App.sim; if (!sim || !sim.segs.length) return; let i = stateAt(sim, App.t).i;
  if (d < 0) { if (App.t - sim.segs[i].t0 < 1e-6) i = Math.max(0, i - 1); seek(sim.segs[i].t0); }
  else seek(i < sim.segs.length - 1 ? sim.segs[i + 1].t0 : sim.tEnd);
}
function playPhase(i) { const g = App.sim.segs[i]; App.t = g.t0; App.stopAt = g.t1; App.playing = true; updatePlayBtn(); App.dirty = true; }

function draw() {
  const cv = $('#scene'), fit = fitCanvas(cv); if (!fit) return;
  const sim = App.sim, ctx = fit.ctx;
  if (!sim) { ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, fit.W, fit.H); ctx.fillStyle = '#8a93a6'; ctx.font = '14px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('请先修正左侧标红的参数', fit.W / 2, fit.H / 2); return; }
  const st = stateAt(sim, App.t);
  renderScene(ctx, fit.W, fit.H, sim, st, { flags: App.cfg.flags, showVec: App.showVec, forces: App.forces, mode: App.mode3d ? '3d' : '2d', view: App.view });
  renderForceBox(sim, st);
  $('#tl').value = sim.tEnd > 0 ? Math.round(App.t / sim.tEnd * 1000) : 0;
  $('#tNow').textContent = 't = ' + App.t.toFixed(2) + ' / ' + nfix(sim.tEnd, 2) + ' s';
  for (const k of App.statKeys) { const el = document.getElementById('st_' + k); if (el) el.textContent = nfix(k === 'mark' ? st.rMax - st.rMin : st[k], 3); }
  if (st.i !== App.lastPhase) { App.lastPhase = st.i; $$('#phaseChips button').forEach((b, i) => b.classList.toggle('on', i === st.i)); $$('#phaseList .ph').forEach((b, i) => b.classList.toggle('on', i === st.i)); }
  $$('#chartGrid .chart').forEach(fig => {
    const c = $('canvas', fig), f = fitCanvas(c); if (!f) return;
    const def = CHARTS.find(d => d.id === fig.dataset.id); c._def = def;
    if (def.paint) { c._map = paintCustomChart(def, f, sim); c._time = !!c._map; return; }
    c._map = drawPlot(f.ctx, f.W, f.H, chartSpec(def, sim, App.t, App.fullCurve)); c._time = !!def.time;
  });
  // 红旗读数 + 痕迹/Q 说明
  const b = sim.isBelt, cn = b ? '传送带' : '木板';
  App.cfg.flags.forEach(f => {
    const el = document.getElementById('fd_' + f.id); if (!el) return;
    if (f.t > st.t + 1e-9) { el.textContent = '尚未插入'; return; }
    const fs = peekState(sim, f.t); if (fs.stage !== st.stage && f.anchor !== 'ground') { el.textContent = '属于其他阶段'; return; }
    const fx = f.anchor === 'ground' ? fs.xb : fs.xr + st.xc;
    el.textContent = '物块距此旗 ' + nfix(st.xb - fx, 3) + ' m';
  });
  $('#qBox').innerHTML = sim.infoBox ? sim.infoBox(st) : sim.duo ? duoBox(sim, st) : '痕迹长度（物块在' + cn + '上划过的范围）= <b>' + nfix(st.rMax - st.rMin, 3) + ' m</b><br>相对路程 s<sub>相对</sub> = <b>' + nfix(st.sRel, 3) + ' m</b><br>此刻摩擦力 f = <b>' + nfix(Math.abs(st.fb), 3) + ' N</b><br>摩擦生热 Q = Σ f·s<sub>相对</sub> = <b>' + nfix(st.Q1, 3) + ' J</b>' + (st.sRel - (st.rMax - st.rMin) > 1e-6 ? '<br><span style="color:#a61e1e">痕迹已出现重叠：痕迹长度 &lt; 相对路程。</span>' : '');
}
let lastTs = 0;
function tick(ts) {
  if (App.playing && App.sim) {
    const dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)) * App.speed; let t = App.t + dt, limit = App.sim.tEnd;
    if (App.stopAt != null) limit = Math.min(limit, App.stopAt);
    else if (App.stepMode) { const g = App.sim.segs.find(s => s.t1 > App.t + 1e-9); if (g) limit = Math.min(limit, g.t1); }
    if (t >= limit) { t = limit; App.playing = false; App.stopAt = null; updatePlayBtn(); }
    App.t = t; App.dirty = true;
  }
  lastTs = ts;
  if (App.dirty) { App.dirty = false; try { draw(); } catch (e) { console.error(e); } }
  requestAnimationFrame(tick);
}

/* =====================================================================
 * 7. 导出：备份 / 网页 / 图片 / CSV / Word
 * ===================================================================== */
function exportBackup(cfg) {
  cfg = cfg || App.cfg;
  download(JSON.stringify({ app: 'pb-sim', version: 1, exportedAt: new Date().toISOString(), config: packCfg(cfg) }, null, 2), safeName(cfg.name) + '.备份.json', 'application/json');
  toast('已导出备份文件（不含 API Key）', 'ok');
}
function exportPage() {
  const json = JSON.stringify(Object.assign({}, packCfg(App.cfg), { _plugins: host.exportEmbeddedPlugins ? host.exportEmbeddedPlugins() : [] })).replace(/</g, '\\u003c');
  const open = '<scr' + 'ipt id="embedded-config" type="application/json">', close = '</scr' + 'ipt>';
  const a = PRISTINE_HTML.indexOf(open), b = a < 0 ? -1 : PRISTINE_HTML.indexOf(close, a);
  if (a < 0 || b < 0) { toast('导出失败：未找到配置占位标签', 'bad'); return; }
  const html = '<!DOCTYPE html>\n' + PRISTINE_HTML.slice(0, a + open.length) + json + PRISTINE_HTML.slice(b);
  download(html, safeName(App.cfg.name) + '.html', 'text/html;charset=utf-8');
  toast('已导出：打开该网页即自动载入本次配置', 'ok');
}
function canvasPNG(cv, name) { cv.toBlob(b => { if (b) download(b, name); }, 'image/png'); }
function offscreen(W, H, paint) { const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const ctx = c.getContext('2d'); ctx.scale(2, 2); paint(ctx, W, H); return c; }
function exportSimCSV() {
  const sim = App.sim; if (!sim) return; const c = sim.isBelt ? '带' : '板', M = MODELS[sim.P.model] || {}, vs = PL.varsFor(sim.P.model);
  const custom = M.builtinCharts === false && M.stats ? M.stats : null;
  const cols = custom ? custom.map(x => [x[0], x[1] + (x[2] ? '(' + x[2] + ')' : '')])
    : [['t', 't(s)'], ['sb', 'x物(m)'], ['vb', 'v物(m/s)'], ['ab', 'a物(m/s²)'], ['sc', 'x' + c + '(m)'], ['vc', 'v' + c + '(m/s)'], ['ac', 'a' + c + '(m/s²)'], ['dRel', 'Δx相对(m)'], ['sRel', 's相对(m)'], ['fb', 'f物(N)'], ['Q1', 'Q(J)'], ['Q2', 'Q地(J)']];
  vs.forEach(v => { if (!cols.some(x => x[0] === v.key)) cols.push([v.key, v.name + (v.unit ? '(' + v.unit + ')' : '')]); });
  const rows = [cols.map(x => x[1])];
  sim.samples.forEach(s => rows.push(cols.map(x => { const n = +s[x[0]]; return isFinite(n) ? +n.toFixed(6) : ''; })));
  download('\ufeff' + rows.map(r => r.join(',')).join('\r\n'), safeName(App.cfg.name) + '.数据.csv', 'text/csv;charset=utf-8');
}
function exportWord(cfgs, fname) {
  const imgs = [], base = 'file:///C:/pbsim/'; let body = '';
  const paras = t => String(t || '').split(/\n+/).filter(l => l.trim()).map(l => '<p>' + esc(l) + '</p>').join('');
  cfgs.forEach((cfg, k) => {
    const pr = cfg.problem || {}, inp = buildInput(cfg);
    body += '<h1>' + esc(pr.title || cfg.name) + '</h1>' + paras(pr.text);
    if (!inp.ok) { body += '<p>（该配置参数有误，无法生成模拟数据）</p>'; return; }
    const sim = simulate(inp.P), cn = sim.duo ? '物块B' : sim.isBelt ? '传送带' : '木板';
    const addImg = (cv, w, h, cap) => { const loc = base + 'image' + imgs.length + '.png'; imgs.push({ loc, b64: cv.toDataURL('image/png').split(',')[1] }); body += '<p style="text-align:center"><img src="' + loc + '" width="' + w + '" height="' + h + '"><br><span style="font-size:9pt;color:#555">' + esc(cap) + '</span></p>'; };
    addImg(offscreen(680, 300, (c, W, H) => renderScene(c, W, H, sim, stateAt(sim, 0), { flags: [], showVec: true })), 510, 225, '图 ' + (k + 1) + '-1 初始情景');
    if (pr.answer) body += '<h2>参考答案</h2>' + paras(pr.answer);
    body += '<h2>解析</h2>' + paras(pr.analysis || solutionText(sim));   // 未填写解析时使用自动生成的解题过程
    body += '<h2>模拟核对数据</h2><table><tr><th>过程</th><th>时间段 / s</th><th>物块 a / (m/s²)</th><th>物块 v / (m/s)</th><th>' + cn + ' a / (m/s²)</th><th>' + cn + ' v / (m/s)</th><th>结束事件</th></tr>' +
      sim.segs.map((g, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(fmt(g.t0)) + ' → ' + esc(fmt(g.t1)) + '</td><td>' + esc(fmt(g.ab)) + '</td><td>' + esc(fmt(g.vb0)) + ' → ' + esc(fmt(g.vb1)) + '</td><td>' + esc(fmt(g.ac)) + '</td><td>' + esc(fmt(g.vc0)) + ' → ' + esc(fmt(g.vc1)) + '</td><td>' + esc(sim.phases[i].end) + '</td></tr>').join('') + '</table><p></p><table>' +
      resultRows(sim).slice(0, -1).map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>';
    addImg(offscreen(680, 300, (c, W, H) => drawPlot(c, W, H, chartSpec(CHARTS[0], sim, sim.tEnd, false))), 510, 225, '图 ' + (k + 1) + '-2 v-t 图像（虚线为过程分界）');
    addImg(offscreen(680, 300, (c, W, H) => renderScene(c, W, H, sim, stateAt(sim, sim.tEnd), { flags: cfg.flags, showVec: false })), 510, 225, '图 ' + (k + 1) + '-3 末状态（红旗标记初始位置，黑色粗线为痕迹）');
    if (k < cfgs.length - 1) body += '<br clear="all" style="page-break-before:always">';
  });
  restoreApprox();
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>' + esc(fname) + '</title><style>body{font-family:"宋体",SimSun,serif;font-size:11pt;line-height:1.6}h1{font-family:"黑体",SimHei,sans-serif;font-size:15pt;margin:12pt 0 6pt}h2{font-family:"黑体",SimHei,sans-serif;font-size:12pt;margin:10pt 0 4pt}p{margin:3pt 0}table{border-collapse:collapse}td,th{border:1px solid #777;padding:2pt 6pt;font-size:10pt}th{background:#eee}</style></head><body>' + body + '</body></html>';
  const B = '----=_NextPart_PBSIM_' + uid();
  let out = 'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="' + B + '"; type="text/html"\r\n\r\n--' + B + '\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: 8bit\r\nContent-Location: ' + base + 'doc.htm\r\n\r\n' + html + '\r\n\r\n';
  imgs.forEach(im => { out += '--' + B + '\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ' + im.loc + '\r\n\r\n' + im.b64.replace(/(.{76})/g, '$1\r\n') + '\r\n\r\n'; });
  out += '--' + B + '--\r\n';
  download(new Blob([out], { type: 'application/msword' }), safeName(fname) + '.doc');
  toast('已导出 Word 文档（含 ' + imgs.length + ' 张图）', 'ok');
}

/* =====================================================================
 * 8. 参数扫描
 * ===================================================================== */
/* 扫描指标注册表（扩展点） */
const METRICS = [
  { id: 'tEnd', name: '全过程时间', unit: 's', f: s => s.summary.tEnd },
  { id: 'tCommon', name: '首次共速时刻', unit: 's', f: s => s.summary.tCommon == null ? NaN : s.summary.tCommon },
  { id: 'vb', name: '物块末速度', unit: 'm/s', f: s => s.summary.vb },
  { id: 'xb', name: '物块位移', unit: 'm', f: s => s.summary.xb },
  { id: 'xc', name: '传送带/木板位移', unit: 'm', f: s => s.summary.xc },
  { id: 'dRel', name: '相对位移', unit: 'm', f: s => s.summary.dRel },
  { id: 'sRel', name: '相对路程', unit: 'm', f: s => s.summary.sRel },
  { id: 'mark', name: '痕迹长度', unit: 'm', f: s => s.summary.mark },
  { id: 'Q1', name: '摩擦生热 Q', unit: 'J', f: s => s.summary.Q1 },
  { id: 'Qall', name: '总生热（含地面）', unit: 'J', f: s => s.summary.Q1 + s.summary.Q2 },
  { id: 'Wbelt', name: '电动机多消耗电能', unit: 'J', f: s => s.isBelt ? s.summary.Wbelt : NaN },
  { id: 'vc', name: '木板末速度', unit: 'm/s', f: s => s.isBelt ? NaN : s.summary.vc }
];
const Sweep = { last: null, exps: [] };
const plain = h => String(h).replace(/<[^>]+>/g, '');
function sweepParams() { return MODELS[App.cfg.model].params.filter(p => p.key !== 'tMax' && !p.optional); }
function refreshSweepForm() {
  const sp = $('#swParam'), old = sp.value, list = sweepParams();
  sp.innerHTML = list.map(p => '<option value="' + p.key + '">' + plain(p.sym) + '　' + p.name + '</option>').join('');
  sp.value = list.some(p => p.key === old) ? old : 'mu1';
  const sm = $('#swMetric'), om = sm.value;
  sm.innerHTML = METRICS.map(m => '<option value="' + m.id + '">' + m.name + '（' + m.unit + '）</option>').join('');
  sm.value = om || 'Q1'; refreshInverseForm();
}
function runSweep(spec) {
  const list = sweepParams(), pdef = list.find(p => p.key === spec.param), mdef = METRICS.find(m => m.id === spec.metric);
  if (!pdef || !mdef) { toast('扫描参数或指标无效', 'bad'); return false; }
  const n = clamp(Math.round(spec.steps) || 10, 3, 60), rows = [];
  if (!isFinite(spec.from) || !isFinite(spec.to) || spec.from === spec.to) { toast('请填写不同的起始值与终止值', 'bad'); return false; }
  for (let i = 0; i < n; i++) {
    const v = +(spec.from + (spec.to - spec.from) * i / (n - 1)).toPrecision(10), c = clone(App.cfg); c.params[spec.param] = String(v);
    const inp = buildInput(c);
    if (!inp.ok) { rows.push({ v, sim: null, vals: {} }); continue; }
    const sim = simulate(inp.P), vals = {}; METRICS.forEach(m => { vals[m.id] = m.f(sim); }); rows.push({ v, sim, vals });
  }
  restoreApprox();
  Sweep.last = { spec: { param: spec.param, from: spec.from, to: spec.to, steps: n, metric: spec.metric }, pdef, mdef, rows, base: App.cfg.name };
  $('#swSumOut').innerHTML = ''; renderSweep(); return true;
}
function renderSweep() {
  const sw = Sweep.last; if (!sw) return;
  const good = sw.rows.filter(r => r.sim), pn = plain(sw.pdef.sym) + (sw.pdef.unit ? ' / ' + sw.pdef.unit : '');
  const f1 = fitCanvas($('#swChart1'));
  if (f1) drawPlot(f1.ctx, f1.W, f1.H, { title: sw.mdef.name + ' 随 ' + sw.pdef.name + ' 的变化', xLabel: pn, yLabel: sw.mdef.name + ' / ' + sw.mdef.unit, series: [{ name: '', color: COL.block, pts: good.map(r => [r.v, r.vals[sw.spec.metric]]), points: true }] });
  const f2 = fitCanvas($('#swChart2'));
  if (f2) {
    const pick = [], k = Math.min(9, good.length); for (let i = 0; i < k; i++) pick.push(good[Math.round(i * (good.length - 1) / Math.max(1, k - 1))]);
    drawPlot(f2.ctx, f2.W, f2.H, { title: '物块 v-t 曲线族', xLabel: 't / s', yLabel: 'v / (m·s⁻¹)', series: pick.map((r, i) => ({ name: (i === 0 || i === pick.length - 1) ? plain(sw.pdef.sym) + '=' + nfix(r.v, 3) : '', color: 'hsl(' + Math.round(215 - 205 * i / Math.max(1, pick.length - 1)) + ',72%,46%)', width: 1.8, pts: r.sim.samples.map(s => [s.t, s.vb]) })) });
  }
  const isB = App.cfg.model === 'belt', cols = METRICS.filter(m => !(m.id === 'Wbelt' && !isB) && !(m.id === 'vc' && isB));
  $('#swTable').innerHTML = '<thead><tr><th>' + esc(pn) + '</th>' + cols.map(m => '<th>' + m.name + ' / ' + m.unit + '</th>').join('') + '</tr></thead><tbody>' +
    sw.rows.map(r => '<tr><td>' + nfix(r.v, 4) + '</td>' + cols.map(m => '<td>' + (r.sim ? nfix(r.vals[m.id], 4) : '参数无效') + '</td>').join('') + '</tr>').join('') + '</tbody>';
}
function sweepCSV() {
  const sw = Sweep.last; if (!sw) { toast('请先运行扫描'); return; }
  const rows = [[sw.pdef.name].concat(METRICS.map(m => m.name + '(' + m.unit + ')'))];
  sw.rows.forEach(r => rows.push([r.v].concat(METRICS.map(m => r.sim && isFinite(r.vals[m.id]) ? +r.vals[m.id].toFixed(6) : ''))));
  download('\ufeff' + rows.map(r => r.join(',')).join('\r\n'), safeName(sw.base) + '.扫描_' + sw.spec.param + '.csv', 'text/csv;charset=utf-8');
}
function renderExps() {
  $('#swExps').innerHTML = Sweep.exps.map((e, i) => '<div class="exp"><h5>' + esc(e.title) + '</h5><div class="muted">' + esc(e.pname) + '：' + nfix(e.from, 4) + ' → ' + nfix(e.to, 4) + '，' + e.steps + ' 点 · 观测 ' + esc(e.mname) + '</div><div style="margin:4px 0">' + esc(e.hypothesis || '') + '</div><button class="btn mini pri" data-exp="' + i + '">运行此实验</button></div>').join('');
}

/* =====================================================================
 * 9. AI：供应商（一键切换）、调用、Token 估算、提示词
 * ===================================================================== */
const AI = {
  /* 供应商预设（扩展点） */
  PRESETS: {
    deepseek: { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], vision: false, visionModel: '', ctx: 128000, temperature: 0.3, jsonMode: true, stream: true, imgRaw: false, color: '#4d6bfe' },
    glm: { name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6', models: ['glm-4.6', 'glm-4.5-flash', 'glm-4-flash-250414', 'glm-4.6v-flash', 'glm-4.5v'], vision: true, visionModel: 'glm-4.6v-flash', ctx: 128000, temperature: 0.3, jsonMode: true, stream: true, imgRaw: true, color: '#1f8a5b' },
    custom: { name: '自定义', baseURL: '', model: '', models: [], vision: false, visionModel: '', ctx: 32000, temperature: 0.3, jsonMode: false, stream: true, imgRaw: false, color: '#6b7280' }
  },
  data: null, usage: { calls: 0, inTok: 0, outTok: 0 },
  load() {
    const d = LS.get(K_AI, null);
    if (d && Array.isArray(d.providers)) this.data = d;
    else { const ps = ['deepseek', 'glm', 'custom'].map(k => Object.assign({ id: uid() + k, preset: k, apiKey: '' }, clone(this.PRESETS[k]))); this.data = { providers: ps, activeId: ps[0].id }; }
  },
  save() { LS.set(K_AI, this.data); },
  active() { return this.data.providers.find(p => p.id === this.data.activeId) || null; }
};
function estTokens(s) {   // 粗略估算：中日韩字符 ≈ 0.75 token，其余字符 ≈ 0.3 token
  if (!s) return 0; let cjk = 0, other = 0;
  for (const ch of String(s)) { const c = ch.codePointAt(0); if ((c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFFEF)) cjk++; else other++; }
  return Math.ceil(cjk * 0.75 + other * 0.3);
}
function tokLine(el, sys, user, nImg) {
  if (!el) return; const p = AI.active(), a = estTokens(sys), b = estTokens(user) + (nImg || 0) * 1100, tot = a + b + 8, ctx = p ? +p.ctx || 0 : 0;
  el.innerHTML = '实时 Token 估算：系统提示词 ≈ <b>' + a + '</b> ＋ 输入 ≈ <b>' + b + '</b> ＝ <b>' + tot + '</b>' + (nImg ? '（含图片约 ' + nImg * 1100 + '）' : '') + (ctx ? ' · 占上下文 <b>' + (tot / ctx * 100).toFixed(1) + '%</b>（' + esc(p.name) + ' ' + Math.round(ctx / 1000) + 'K）' : ' · 尚未启用模型');
}
async function callAI(o) {
  o = Object.assign({}, o); PL.run('aiRequest', o);
  const r = await callAIBase(o);
  PL.run('aiResponse', r, o);
  return r;
}
async function callAIBase(o) {
  const p = o.prov || AI.active();
  if (!p) throw new Error('请先在「模型配置」中添加并启用一个模型');
  if (!p.baseURL || !p.model) throw new Error('当前供应商「' + p.name + '」未填写 API 地址或模型');
  if (!p.apiKey) throw new Error('当前供应商「' + p.name + '」未填写 API Key，请到「模型配置」中填写');
  const imgs = o.images || [];
  if (imgs.length && !p.vision) throw new Error('当前模型未开启视觉能力，无法识别图片');
  const model = imgs.length && p.visionModel ? p.visionModel : p.model;
  const content = imgs.length ? [{ type: 'text', text: o.user || '请识别图片中的题目' }].concat(imgs.map(u => ({ type: 'image_url', image_url: { url: p.imgRaw ? u.split(',')[1] : u } }))) : o.user;
  const body = { model, messages: o.messages || [{ role: 'system', content: o.system }, { role: 'user', content }], temperature: isFinite(+p.temperature) ? +p.temperature : 0.3, stream: !!p.stream };
  if (o.json && p.jsonMode && !imgs.length) body.response_format = { type: 'json_object' };
  if (o.maxTokens) body.max_tokens = o.maxTokens;
  let url = String(p.baseURL).trim().replace(/\/+$/, ''); if (!/\/chat\/completions$/.test(url)) url += '/chat/completions';
  let res;
  try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + p.apiKey }, body: JSON.stringify(body) }); }
  catch (e) { throw new Error('网络请求失败：可能是网络不通、地址有误，或该接口不允许浏览器跨域访问（CORS）'); }
  if (!res.ok) { let msg = ''; try { msg = await res.text(); const j = JSON.parse(msg); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch (e) { /* 保留原文 */ } throw new Error('接口返回 ' + res.status + '：' + String(msg).slice(0, 240)); }
  let text = '', think = '', usage = null;
  const ct = res.headers.get('content-type') || '';
  if (body.stream && res.body && !/application\/json/i.test(ct)) {
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    const feed = line => {
      line = line.trim(); if (line.indexOf('data:') !== 0) return; const d = line.slice(5).trim(); if (!d || d === '[DONE]') return;
      try { const j = JSON.parse(d), dl = j.choices && j.choices[0] && j.choices[0].delta; if (dl) { if (dl.reasoning_content) think += dl.reasoning_content; if (dl.content) text += dl.content; if (o.onDelta) o.onDelta(text, think); } if (j.usage) usage = j.usage; } catch (e) { /* 忽略不完整分片 */ }
    };
    for (;;) { const r = await reader.read(); if (r.done) break; buf += dec.decode(r.value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); } }
    if (buf) feed(buf);
  } else { const j = await res.json(); text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''; usage = j.usage || null; }
  const inTok = usage && usage.prompt_tokens != null ? usage.prompt_tokens : estTokens(o.system) + estTokens(o.user) + imgs.length * 1100;
  const outTok = usage && usage.completion_tokens != null ? usage.completion_tokens : estTokens(text) + estTokens(think);
  AI.usage.calls++; AI.usage.inTok += inTok; AI.usage.outTok += outTok;
  if (!text.trim()) throw new Error('模型没有返回内容');
  return { text, usage, inTok, outTok, exact: !!usage };
}
/* 带界面状态的调用封装 */
async function runAI(o) {
  const btn = o.btn, out = o.out, old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = o.busy || 'AI 思考中…'; }
  if (out) { out.hidden = false; out.textContent = '正在请求模型…'; out.classList.remove('err'); }
  try {
    const r = await callAI(Object.assign({}, o, { onDelta: (txt, think) => { if (out) { out.textContent = txt || ('〔思考中〕' + think.slice(-500)); out.scrollTop = out.scrollHeight; } } }));
    if (out) out.textContent = r.text + '\n\n— 本次用量' + (r.exact ? '' : '（估算）') + '：输入 ' + r.inTok + ' · 输出 ' + r.outTok + ' tokens';
    return r;
  } catch (e) { if (out) { out.textContent = '✗ ' + e.message; out.classList.add('err'); } toast(e.message, 'bad'); return null; }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } renderUsage(); }
}
function parseJSONLoose(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) throw new Error('AI 返回内容中没有找到 JSON');
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('AI 返回的 JSON 无法解析：' + e.message); }
}
const toText = v => v == null ? '' : Array.isArray(v) ? v.map(toText).join('\n') : typeof v === 'object' ? JSON.stringify(v) : String(v);

/* 内置提示词（扩展点）。用户修改会保存在本机 */
const PROMPTS = {
  nl2sim: { name: '① 说题即模拟（自然语言 → 参数）', text:
'你是高中物理“板块模型 / 传送带模型”建模助手。任务：把用户给出的题目（文字或图片）转换成模拟器可直接运行的配置。\n\n{{SCHEMA}}\n\n【输出要求】\n1. 只输出一个 JSON 对象，不要输出解释文字或代码块标记。格式：\n{"config":{"name":"…","model":"…","params":{…},"options":{…}},"assumptions":["建模时做的假设…"],"targets":["题目要求求解的量…"]}\n2. 严格使用上面的参数键；数值一律写成字符串表达式，能保留根号 / π / 分数就保留。\n3. 认真判断方向并写对正负号。例如：“物块从右端以 4 m/s 向左滑上传送带” → x0 等于 L，v0 = "-4"；“传送带沿斜面向下运行” → beltV 为负；“物块从顶端由静止释放” → x0 等于 L，v0 = "0"。\n4. 题目未给的量取常规值（g = 10，质量未给取 1，物块视为质点），并写进 assumptions。\n5. tMax 取能覆盖全过程的合理值（通常 5 ~ 20）。\n6. 若题目包含模拟器不支持的情形（碰撞、圆弧轨道、弹簧等），只取可模拟的部分，并在 assumptions 中说明。' },
  check: { name: '② 物理一致性校验', text:
'你是严谨的高中物理验算专家，负责审查一个“板块 / 传送带”模拟器的输出是否物理自洽，防止“程序跑得动但物理错”。\n约定：x 轴沿接触面，向右 / 沿斜面向上为正；最大静摩擦力等于滑动摩擦力。\n用户会给出：参数、分过程运动数据、汇总结果、本地规则校验结果。请你独立完成：\n1. 对每个过程用牛顿第二定律重新计算物块与载体的加速度，并与模拟数据比对；\n2. 检查摩擦力类型与方向的判定（相对运动方向、是否超过最大静摩擦、共速后能否保持相对静止，如 μ 与 tanθ 的关系）；\n3. 用运动学公式抽查关键时刻的速度与位移；\n4. 用功能关系核对 Q = f·s相对、动能定理、电动机多消耗的电能；\n5. 判断参数本身是否合理（量级、单位、符号），以及是否可能存在与题意不符的建模错误。\n只输出 JSON：{"verdict":"pass|warn|fail","summary":"一句话结论","checks":[{"item":"检查项","status":"pass|warn|fail","detail":"关键推导与数值对比"}],"suggestions":["改进建议…"]}' },
  sweep: { name: '③ 参数扫描实验设计', text:
'你是高中物理探究实验设计师。根据当前模拟配置，设计 3 ~ 4 个“控制变量法”的参数扫描实验，帮助学生从单次模拟上升到规律发现（临界值、线性 / 二次关系、分段规律等）。\n可扫描参数（param 取键名）：\n{{PARAMS}}\n可观测指标（metric 取键名）：\n{{METRICS}}\n要求：扫描范围要跨过可能的临界点（如 μ = tanθ、恰好共速、恰好不滑离）；from、to 必须是数字且在物理上合理；steps 取 8 ~ 40。\n只输出 JSON：{"experiments":[{"title":"实验标题","param":"参数键","from":0,"to":1,"steps":20,"metric":"指标键","hypothesis":"预期规律与物理原因"}]}' },
  sweepSum: { name: '④ 扫描规律总结', text:
'你是高中物理教师。下面是一次参数扫描实验的数据（自变量、因变量及基础配置）。请总结规律：\n1. 定性趋势；\n2. 是否存在转折点 / 临界值，数值约为多少，对应的物理原因；\n3. 各段可能的函数关系（给出推导思路或表达式）；\n4. 给学生的 2 个追问。\n用简洁的中文回答，可使用 Markdown 小标题和列表，公式用 Unicode 字符，不要输出 JSON 或 LaTeX。' },
  problem: { name: '⑤ AI 出题', text:
'你是高中物理命题专家。请基于给定的模拟配置（及原题，如有）改编生成新的题目。新题必须能被下面的模拟器完整模拟。\n\n{{SCHEMA}}\n\n【命题要求】\n1. 改变情景或数据，不要照抄原题；数值要“好算”，结果尽量是整数、简单分数或简单根式。\n2. 题干用规范的高中物理表述，给出全部已知量，设 2 ~ 3 个小问（如时间、位移、相对位移 / 痕迹长度、摩擦生热 Q、电动机多消耗的电能等）。\n3. 题干中的数据必须与 config 完全一致，方向与正负号要对应。\n4. 只出题，不要写答案（答案由模拟器精确计算后再生成）。\n只输出 JSON：{"problems":[{"title":"题目标题","text":"完整题干（含各小问）","config":{"name":"…","model":"…","params":{…},"options":{…}}}]}' },
  solution: { name: '⑥ 答案与解析', text:
'你是高中物理解题教师。用户给出一道题和模拟器对该题的精确计算结果。请写出参考答案和分步解析。\n要求：\n1. 数值以模拟器结果为准（它是精确的）；若你的推导与之不符，请修正推导而不是修改数值；\n2. 解析按“过程划分 → 受力分析与牛顿第二定律 → 运动学 → 功能关系”组织，写出关键公式与代入；\n3. 结果保留根号 / 分数等精确形式，必要时给出近似值；\n4. 使用纯文本，公式用 Unicode 字符（μ、θ、√、²、Δ），不要使用 LaTeX；分段用换行。\n只输出 JSON：{"answer":"各小问答案（简洁）","analysis":"分步解析"}' }
};
const promptStore = LS.get(K_PROMPT, {}) || {};
function schemaText() {
  let s = '【模拟器配置 JSON 结构】\n{"name":"配置名","model":"belt 或 board","params":{"参数键":"表达式字符串"},"options":{"approx37":true,"afterLeave":"stop 或 continue"}}\n' +
    '【坐标与符号约定】x 轴沿接触面：水平时向右为正；倾斜时斜面左低右高，沿斜面向上为正。速度、外力带符号（向左 / 沿斜面向下为负）。位置从左端（底端）量起，右端（顶端）为 L。最大静摩擦力等于滑动摩擦力。\n' +
    '【表达式】参数值用字符串，可写 0.5、√3/3、2√2、π/6、tan(37°)、3/8 等。approx37 = true 时取 sin37° = 0.6、cos37° = 0.8。afterLeave 仅对板块模型有效；options.collision 仅对 duo 模型有效，取 elastic（弹性碰撞）、stick（完全非弹性，碰后粘连）、e（按恢复系数 e）、none（不碰撞，只记录相遇，用于追及相遇问题）。duo 模型中两物块 A、B 在同一直线上运动，各自只受重力、支持力和地面摩擦力。\n';
  Object.keys(MODELS).filter(id => !MODELS[id].noAI).forEach(id => { const M = MODELS[id]; s += '【model = "' + id + '"：' + M.name + '】参数：\n' + M.params.map(p => '- ' + p.key + '：' + p.name + (p.unit ? '（' + p.unit + '）' : '') + '，默认 "' + p.def + '"' + (p.ai ? '；' + p.ai : '')).join('\n') + '\n' + (M.aiNote ? M.aiNote + '\n' : ''); });
  return s;
}
function fillPrompt(id) {
  let t = fillPromptBase(id);
  (PL.promptPatches[id] || []).forEach(p => { const r = PL.guard(p.owner, '提示词「' + id + '」修改', () => p.fn(t, PL.ctx()), null); if (typeof r === 'string') t = r; });
  return t;
}
function fillPromptBase(id) {
  const t = promptStore[id] != null ? promptStore[id] : PROMPTS[id].text;
  return t.replace(/\{\{SCHEMA\}\}/g, schemaText)
    .replace(/\{\{PARAMS\}\}/g, () => sweepParams().map(p => '- ' + p.key + '：' + p.name + (p.unit ? '（' + p.unit + '）' : '') + '，当前值 "' + App.cfg.params[p.key] + '"').join('\n'))
    .replace(/\{\{METRICS\}\}/g, () => METRICS.map(m => '- ' + m.id + '：' + m.name + '（' + m.unit + '）').join('\n'));
}
function simDigest(cfg, P, sim) { return PL.digest(simDigestBase(cfg, P, sim), sim); }
function simDigestBase(cfg, P, sim) {
  if (sim.digest) return sim.digest();
  const r = x => (x == null || !isFinite(x)) ? null : +(+x).toFixed(4), S = sim.summary, num = {};
  MODELS[cfg.model].params.forEach(p => { num[p.key] = isFinite(P[p.key]) ? r(P[p.key]) : '一直作用'; });
  return { 模型: MODELS[cfg.model].name + (sim.duo ? '（下文“物块”= 物块A，“载体”= 物块B，摩擦力均指与地面间的摩擦力；碰撞类型 ' + P.collision + '）' : ''), 碰撞记录: sim.duo ? sim.collisions.map(c => ({ t: r(c.t), 位置: r(c.x), A碰前: r(c.u1), B碰前: r(c.u2), A碰后: r(c.v1), B碰后: r(c.v2), 机械能损失: r(c.loss) })) : undefined, 相遇记录: sim.duo && sim.meets.length ? sim.meets.map(c => ({ t: r(c.t), 位置: r(c.x) })) : undefined, 参数表达式: cfg.params, 参数数值: num, sinθ: r(P.sin), cosθ: r(P.cos),
    过程: sim.segs.map((g, i) => ({ 序号: i + 1, 时间段: [r(g.t0), r(g.t1)], 概述: sim.phases[i].title,
      物块: { a: r(g.ab), v始: r(g.vb0), v末: r(g.vb1), 位移: r(g.xb1 - g.xb0), 摩擦力: r(g.fb), 外力: r(g.Fb) },
      载体: { a: r(g.ac), v始: r(g.vc0), v末: r(g.vc1), 位移: r(g.xc1 - g.xc0), 地面摩擦力: r(g.f2), 外力: r(g.Fc) }, 结束事件: sim.phases[i].end })),
    结果: { 结束原因: sim.endReason, 全过程时间: r(S.tEnd), 首次共速时刻: r(S.tCommon), 物块位移: r(S.xb), 物块末速度: r(S.vb), 载体位移: r(S.xc), 载体末速度: r(S.vc), 相对位移: r(S.dRel), 相对路程: r(S.sRel), 痕迹长度: r(S.mark), 摩擦生热Q: r(S.Q1), 地面摩擦生热: r(S.Q2), 摩擦力对物块做功: r(S.Wf), 电动机多消耗电能: sim.isBelt ? r(S.Wbelt) : null, 精确形式: { 时间: fmt(S.tEnd), 物块位移: fmt(S.xb), 物块末速度: fmt(S.vb), 相对路程: fmt(S.sRel), Q: fmt(S.Q1) } } };
}
function cfgBrief(cfg) { return { name: cfg.name, model: cfg.model, params: cfg.params, options: cfg.options }; }

/* —— 供应商界面 —— */
function renderProviders() {
  const d = AI.data;
  $('#provList').innerHTML = d.providers.map(p => {
    const on = p.id === d.activeId;
    return '<div class="prov ' + (on ? 'on' : '') + '" data-id="' + p.id + '"><div class="pv-ic" style="background:' + esc(p.color || '#6b7280') + '">' + esc((p.name || '?').trim().charAt(0).toUpperCase()) + '</div>' +
      '<div class="pv-main"><div class="pv-name">' + esc(p.name) + (on ? '<span class="badge ok">使用中</span>' : '') + (p.vision ? '<span class="badge info">视觉</span>' : '') + (p.apiKey ? '' : '<span class="badge warn">未填 Key</span>') + '</div>' +
      '<div class="pv-sub">' + esc(p.baseURL || '未设置地址') + ' · ' + esc(p.model || '未设置模型') + '</div></div>' +
      '<div class="pv-act"><button class="btn mini ' + (on ? '' : 'pri') + '" data-act="use"' + (on ? ' disabled' : '') + '>' + (on ? '已启用' : '启用') + '</button><button class="btn mini" data-act="test">测试</button><button class="btn mini" data-act="edit">编辑</button><button class="btn mini" data-act="del">删除</button></div></div>';
  }).join('') || '<p class="muted">还没有供应商，点击右上角添加。</p>';
  const a = AI.active(), pill = $('#aiPill'), ready = !!(a && a.apiKey && a.baseURL && a.model);
  pill.className = 'pill' + (ready ? ' ready' : ''); pill.innerHTML = '<i></i>' + (a ? esc(a.name + ' · ' + (a.model || '未设模型')) + (ready ? '' : '（未填 Key）') : 'AI 未配置');
  $('#nlImgHint').textContent = a && a.vision ? '当前模型支持视觉：' + (a.visionModel || a.model) : '当前模型未开启视觉，仅支持文字';
  renderUsage(); refreshAITokens();
}
function renderUsage() { const u = AI.usage; $('#usageBox').innerHTML = '本次会话累计：调用 <b>' + u.calls + '</b> 次 · 输入 ≈ <b>' + u.inTok + '</b> · 输出 ≈ <b>' + u.outTok + '</b> · 合计 ≈ <b>' + (u.inTok + u.outTok) + '</b> tokens'; }
function fillProvForm(p) {
  $('#pvName').value = p.name || ''; $('#pvURL').value = p.baseURL || ''; $('#pvModel').value = p.model || ''; $('#pvCtx').value = p.ctx || 32000; $('#pvTemp').value = p.temperature != null ? p.temperature : 0.3;
  $('#pvVision').checked = !!p.vision; $('#pvVModel').value = p.visionModel || ''; $('#pvJson').checked = !!p.jsonMode; $('#pvStream').checked = p.stream !== false; $('#pvImgRaw').value = p.imgRaw ? '1' : '0';
  $('#pvModels').innerHTML = (p.models || []).map(m => '<option value="' + esc(m) + '">').join('');
}
function openProvDialog(id) {
  const dlg = $('#dlgProv'), p = id ? AI.data.providers.find(x => x.id === id) : null;
  dlg.dataset.id = id || ''; dlg.dataset.preset = p ? (p.preset || 'custom') : 'deepseek';
  $('#pvTitle').textContent = p ? '编辑供应商' : '添加供应商';
  $('#pvPresets').innerHTML = Object.keys(AI.PRESETS).map(k => '<button type="button" data-preset="' + k + '" class="' + (dlg.dataset.preset === k ? 'on' : '') + '">' + AI.PRESETS[k].name + '</button>').join('');
  fillProvForm(p || AI.PRESETS.deepseek); $('#pvKey').value = p ? (p.apiKey || '') : ''; $('#pvKey').type = 'password'; $('#pvKeyShow').checked = false;
  dlg.returnValue = ''; if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}
function saveProvDialog() {
  const dlg = $('#dlgProv'), id = dlg.dataset.id, k = dlg.dataset.preset || 'custom', pre = AI.PRESETS[k] || AI.PRESETS.custom;
  const p = { name: $('#pvName').value.trim() || pre.name, baseURL: $('#pvURL').value.trim(), apiKey: $('#pvKey').value.trim(), model: $('#pvModel').value.trim(), ctx: +$('#pvCtx').value || 32000, temperature: +$('#pvTemp').value,
    vision: $('#pvVision').checked, visionModel: $('#pvVModel').value.trim(), jsonMode: $('#pvJson').checked, stream: $('#pvStream').checked, imgRaw: $('#pvImgRaw').value === '1', preset: k, color: pre.color, models: pre.models };
  if (id) Object.assign(AI.data.providers.find(x => x.id === id), p);
  else { p.id = uid(); AI.data.providers.push(p); if (!AI.active()) AI.data.activeId = p.id; }
  AI.save(); renderProviders(); toast('供应商已保存', 'ok');
}
async function testProvider(id, btn) {
  const p = AI.data.providers.find(x => x.id === id), t0 = performance.now(), old = btn.textContent; btn.disabled = true; btn.textContent = '测试中…';
  try { const r = await callAI({ prov: p, system: '你是连通性测试助手。', user: '请只回复两个字母：OK', maxTokens: 16 }); toast('连接成功（' + Math.round(performance.now() - t0) + ' ms）：' + r.text.trim().slice(0, 30), 'ok'); }
  catch (e) { toast('测试失败：' + e.message, 'bad'); }
  finally { btn.disabled = false; btn.textContent = old; renderUsage(); }
}
function renderPromptEditor() {
  const sel = $('#promptSel'); if (!sel.options.length) sel.innerHTML = Object.keys(PROMPTS).map(k => '<option value="' + k + '">' + PROMPTS[k].name + '</option>').join('');
  const id = sel.value; $('#promptText').value = promptStore[id] != null ? promptStore[id] : PROMPTS[id].text;
  $('#promptTok').innerHTML = '该提示词展开占位符后 ≈ <b>' + estTokens(fillPrompt(id)) + '</b> tokens' + (promptStore[id] != null ? ' · 已自定义' : ' · 默认');
}

/* —— 功能 A：说题即模拟 —— */
const NL = { images: [] };
function readImage(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.86)); }; img.onerror = () => rej(new Error('图片无法读取')); img.src = fr.result; };
    fr.onerror = () => rej(new Error('文件读取失败')); fr.readAsDataURL(file);
  });
}
function renderNLImages() { $('#nlImgBox').innerHTML = NL.images.map((u, i) => '<span style="display:inline-block;position:relative;margin:4px 6px 0 0"><img src="' + u + '" alt="题目图片" style="height:70px;border:1px solid var(--line);border-radius:6px;display:block"><button class="btn mini" data-rm="' + i + '" style="position:absolute;right:2px;top:2px">×</button></span>').join(''); refreshAITokens(); }
function showNLResult(cfg, extra, source) {
  const M = MODELS[cfg.model], li = a => (a || []).map(x => '<li>' + esc(toText(x)) + '</li>').join('');
  $('#nlRes').innerHTML = '<div class="gen"><h4>' + esc(cfg.name) + '<span class="badge ok">已载入并运行</span></h4><div class="muted">' + esc(source) + ' · ' + M.name + '</div>' +
    '<table class="kv" style="margin-top:6px"><tbody>' + M.params.map(p => '<tr><td>' + p.name + '</td><td>' + esc(cfg.params[p.key] === '' ? '（留空）' : cfg.params[p.key]) + ' ' + (p.unit || '') + '</td></tr>').join('') + '</tbody></table>' +
    (extra.assumptions && extra.assumptions.length ? '<h6>建模假设</h6><ul style="margin:0;padding-left:18px;font-size:12.5px">' + li(extra.assumptions) + '</ul>' : '') +
    (extra.targets && extra.targets.length ? '<h6>题目所求</h6><ul style="margin:0;padding-left:18px;font-size:12.5px">' + li(extra.targets) + '</ul>' : '') +
    '<div class="row"><button class="btn pri" data-go="sim">查看模拟动画</button><button class="btn" data-go="check">做一致性校验</button><button class="btn" data-go="backup">导出备份</button></div></div>';
}
async function aiNL() {
  const text = $('#nlText').value.trim();
  if (!text && !NL.images.length) { toast('请先输入题目或上传图片'); return; }
  const r = await runAI({ btn: $('#btnNL'), out: $('#nlOut'), system: fillPrompt('nl2sim'), user: '题目：\n' + (text || '（见图片）'), images: NL.images, json: true });
  if (!r) return;
  try {
    const j = parseJSONLoose(r.text), cfg = normalizeConfig(j.config || j);
    cfg.problem = { title: cfg.name, text, answer: '', analysis: '' };
    addConfig(cfg); showNLResult(cfg, j, 'AI 解析'); toast('已根据题目生成配置并运行模拟', 'ok');
  } catch (e) { $('#nlOut').classList.add('err'); toast(e.message, 'bad'); }
}
/* 离线规则解析：只识别常见写法，作为无 AI 时的兜底 */
function localParse(text) {
  const isBoard = /木板|板块|长板/.test(text) && !/传送带/.test(text), cfg = newConfig(isBoard ? 'board' : 'belt'), got = [];
  const N = '([0-9]+(?:\\.[0-9]+)?(?:/[0-9]+)?|[0-9]*√[0-9]+(?:/[0-9]+)?)';
  const set = (k, v, label) => { cfg.params[k] = v; got.push(label + ' = ' + v); };
  let m;
  if ((m = text.match(/([0-9]+(?:\.[0-9]+)?)\s*°/))) set('theta', m[1], '倾角 θ');
  if ((m = text.match(/g\s*(?:取|=|＝)\s*([0-9.]+)/))) set('g', m[1], 'g');
  const mus = Array.from(text.matchAll(new RegExp('(?:因数|μ[₁₂12]?)[^0-9√]{0,6}' + N, 'g'))).map(x => x[1]);
  if (mus[0]) set('mu1', mus[0], isBoard ? 'μ₁' : 'μ'); if (mus[1] && isBoard) set('mu2', mus[1], 'μ₂');
  const Ls = Array.from(text.matchAll(new RegExp('(?:长度?为?|长|L|相距|距离)[^0-9√]{0,5}' + N + '\\s*m(?![/a-zA-Z·])', 'g'))); if (Ls[0]) set('L', Ls[0][1], '长度 L');
  let beltSet = false, v0Set = false;
  for (const x of text.matchAll(new RegExp('(.{0,14}?)' + N + '\\s*m/s(?![²2^])', 'g'))) {
    const c = x[1], v = x[2];
    if (!isBoard && !beltSet && /带|运行|匀速转动|顺时针|逆时针/.test(c) && !/初速|滑上|冲上/.test(c)) { set('beltV', v, '传送带速度'); beltSet = true; }
    else if (!v0Set) { set('v0', v, '物块初速度'); v0Set = true; }
  }
  let mSet = false;
  for (const x of text.matchAll(new RegExp('(.{0,10}?)' + N + '\\s*kg', 'g'))) {
    if (isBoard && /木板|长板|M/.test(x[1]) && !/物块|滑块|小物/.test(x[1].slice(-4))) set('M', x[2], '木板质量 M');
    else if (!mSet) { set('m', x[2], '物块质量 m'); mSet = true; }
  }
  cfg.name = '离线解析·' + (isBoard ? '板块' : '传送带'); cfg.problem = { title: cfg.name, text, answer: '', analysis: '' };
  return { cfg, got };
}

/* —— 功能 B：一致性校验 —— */
const ST_BADGE = { pass: ['ok', '通过'], warn: ['warn', '注意'], fail: ['bad', '不通过'], info: ['info', '提示'] };
function renderChecks(box, list) {
  box.innerHTML = list.map(c => { const s = ST_BADGE[c.status] || ST_BADGE.info; return '<div class="chkitem"><span class="badge ' + s[0] + '" style="margin:2px 0 0">' + s[1] + '</span><b>' + mathText(c.item) + '</b><div class="d">' + mathText(c.detail || '') + '</div></div>'; }).join('') || '<p class="muted">无检查项</p>';
}
/* 同一次模拟的本地校验结果只算一次（含 2 万步交叉验证，避免重复计算） */
function cachedChecks() { if (!App.sim._checks) App.sim._checks = localChecks(App.inp, App.sim); return App.sim._checks; }
function runLocalCheck(silent) {
  if (!App.sim || !App.inp.ok) { $('#chkLocalBox').innerHTML = '<p class="muted">当前参数有误，无法校验。</p>'; return null; }
  const list = cachedChecks(); renderChecks($('#chkLocalBox'), list);
  if (!silent) { const f = list.filter(c => c.status === 'fail').length, w = list.filter(c => c.status === 'warn').length; toast(f ? '本地校验发现 ' + f + ' 项不通过' : w ? '本地校验通过，有 ' + w + ' 项需注意' : '本地校验全部通过', f ? 'bad' : 'ok'); }
  return list;
}
function checkUserMsg() {
  if (!App.sim || !App.inp.ok) return '';
  return JSON.stringify({ 模拟数据: simDigest(App.cfg, App.inp.P, App.sim), 题干: (App.cfg.problem && App.cfg.problem.text) || '（无）', 本地规则校验: cachedChecks().map(c => ({ 项: c.item, 结论: c.status, 说明: c.detail })) });
}
async function aiCheck() {
  if (!App.sim || !App.inp.ok) { toast('当前参数有误，无法校验', 'bad'); return; }
  runLocalCheck(true);
  const r = await runAI({ btn: $('#btnChkAI'), out: $('#chkAIOut'), system: fillPrompt('check'), user: checkUserMsg(), json: true }); if (!r) return;
  try {
    const j = parseJSONLoose(r.text), s = ST_BADGE[j.verdict] || ST_BADGE.info;
    $('#chkAIBox').innerHTML = '<div class="qbox" style="margin-bottom:6px"><span class="badge ' + s[0] + '" style="margin-left:0">' + s[1] + '</span> ' + esc(toText(j.summary)) + '</div><div id="chkAIList"></div>' + ((j.suggestions || []).length ? '<h4 style="font-size:13px;margin:10px 0 4px">建议</h4><ul style="margin:0;padding-left:18px;font-size:12.5px">' + j.suggestions.map(x => '<li>' + esc(toText(x)) + '</li>').join('') + '</ul>' : '');
    renderChecks($('#chkAIList'), (j.checks || []).map(c => ({ status: c.status, item: toText(c.item), detail: toText(c.detail) })));
  } catch (e) { $('#chkAIBox').innerHTML = '<div class="md">' + mdLite(r.text) + '</div>'; }
}

/* —— 功能 C：AI 设计扫描实验 / 总结规律 —— */
async function aiSweepDesign() {
  if (!App.sim) { toast('当前参数有误', 'bad'); return; }
  const user = '当前配置：' + JSON.stringify(cfgBrief(App.cfg)) + '\n当前模拟的关键结果：' + JSON.stringify(simDigest(App.cfg, App.inp.P, App.sim).结果);
  const r = await runAI({ btn: $('#btnSweepAI'), out: $('#swAIOut'), system: fillPrompt('sweep'), user, json: true }); if (!r) return;
  try {
    const j = parseJSONLoose(r.text), list = sweepParams();
    Sweep.exps = (j.experiments || []).map(e => { const p = list.find(x => x.key === e.param), m = METRICS.find(x => x.id === e.metric); if (!p || !m || !isFinite(+e.from) || !isFinite(+e.to) || +e.from === +e.to) return null; return { title: toText(e.title) || (p.name + ' → ' + m.name), param: p.key, pname: p.name, metric: m.id, mname: m.name, from: +e.from, to: +e.to, steps: clamp(Math.round(+e.steps) || 20, 3, 60), hypothesis: toText(e.hypothesis) }; }).filter(Boolean);
    renderExps(); toast(Sweep.exps.length ? 'AI 设计了 ' + Sweep.exps.length + ' 个实验，点击即可运行' : 'AI 给出的实验参数无效，请重试', Sweep.exps.length ? 'ok' : 'bad');
  } catch (e) { toast(e.message, 'bad'); }
}
function sweepSumMsg() {
  const sw = Sweep.last; if (!sw) return '';
  return JSON.stringify({ 基础配置: cfgBrief(App.cfg), 自变量: sw.pdef.name + '（' + sw.spec.param + '）', 因变量: sw.mdef.name + '（' + sw.mdef.unit + '）', 数据: sw.rows.filter(r => r.sim).map(r => [r.v, isFinite(r.vals[sw.spec.metric]) ? +r.vals[sw.spec.metric].toFixed(4) : null]), 其它指标: { 全过程时间: sw.rows.filter(r => r.sim).map(r => +r.vals.tEnd.toFixed(3)), 相对路程: sw.rows.filter(r => r.sim).map(r => +r.vals.sRel.toFixed(3)) } });
}
async function aiSweepSummary() {
  if (!Sweep.last) { toast('请先运行一次扫描'); return; }
  const r = await runAI({ btn: $('#btnSwSum'), out: $('#swSumRaw'), system: fillPrompt('sweepSum'), user: sweepSumMsg() }); if (!r) return;
  $('#swSumRaw').hidden = true; $('#swSumOut').innerHTML = '<div class="qbox" style="margin-top:10px">' + mdLite(r.text) + '</div>';
}

/* —— 功能 D：AI 出题 + 答案解析 + Word —— */
const Gen = { items: [] };
function genUserMsg() {
  return '当前模拟配置：' + JSON.stringify(cfgBrief(App.cfg)) + '\n原题：' + ((App.cfg.problem && App.cfg.problem.text) || '（无）') + '\n命题要求：难度 = ' + $('#genLevel').value + '；题型 = ' + $('#genType').value + '；数量 = ' + $('#genCount').value + ' 道' + ($('#genExtra').value.trim() ? '；补充要求：' + $('#genExtra').value.trim() : '');
}
function renderGen() {
  $('#genList').innerHTML = Gen.items.map((it, i) => {
    const pr = it.cfg.problem, badge = it.state === 'ok' ? '<span class="badge ok">答案已按模拟结果校准</span>' : it.state === 'solving' ? '<span class="badge info">正在生成答案…</span>' : it.state === 'bad' ? '<span class="badge bad">参数无法模拟</span>' : '<span class="badge warn">仅有题干与模拟数据</span>';
    return '<div class="gen"><h4>' + esc(pr.title) + badge + '</h4><div class="muted">' + MODELS[it.cfg.model].name + '</div><pre>' + esc(pr.text) + '</pre>' +
      (it.key ? '<h6>模拟器核对结果</h6><div class="pre" style="font-family:var(--mono);font-size:12px">' + esc(it.key) + '</div>' : '') +
      (pr.answer ? '<h6>参考答案</h6><pre>' + esc(pr.answer) + '</pre>' : '') + (pr.analysis ? '<h6>解析</h6><pre>' + esc(pr.analysis) + '</pre>' : '') +
      '<div class="row"><button class="btn pri" data-apply="' + i + '"' + (it.state === 'bad' ? ' disabled' : '') + '>应用到网页（载入模拟）</button><button class="btn" data-word="' + i + '"' + (it.state === 'bad' ? ' disabled' : '') + '>导出 Word</button><button class="btn" data-drop="' + i + '">移除</button></div></div>';
  }).join('');
}
async function aiGenerate() {
  const btn = $('#btnGen'), out = $('#genOut'), n = +$('#genCount').value || 1;
  const r = await runAI({ btn, out, system: fillPrompt('problem'), user: genUserMsg(), json: true, busy: '正在命题…' }); if (!r) return;
  let list;
  try { const j = parseJSONLoose(r.text); list = Array.isArray(j.problems) ? j.problems : [j]; } catch (e) { toast(e.message, 'bad'); return; }
  for (const p of list.slice(0, n)) {
    const cfg = normalizeConfig(p.config || {}); cfg.name = String(p.title || cfg.name).slice(0, 60);
    cfg.problem = { title: cfg.name, text: toText(p.text), answer: '', analysis: '' };
    const item = { cfg, state: 'solving', key: '' }; Gen.items.unshift(item);
    const inp = buildInput(cfg);
    if (!inp.ok) { item.state = 'bad'; renderGen(); continue; }
    const sim = simulate(inp.P);
    item.key = resultRows(sim).slice(1, 11).map(x => x[0] + '：' + x[1]).join('\n'); renderGen();
    const r2 = await runAI({ btn, out, system: fillPrompt('solution'), user: '题目：\n' + cfg.problem.text + '\n\n模拟器精确结果（以此为准）：\n' + JSON.stringify(simDigest(cfg, inp.P, sim)), json: true, busy: '正在撰写答案解析…' });
    item.state = 'partial';
    if (r2) { try { const a = parseJSONLoose(r2.text); cfg.problem.answer = toText(a.answer); cfg.problem.analysis = toText(a.analysis); item.state = 'ok'; } catch (e) { cfg.problem.analysis = r2.text; } }
    renderGen();
  }
  restoreApprox(); if (Gen.items.length) toast('题目已生成', 'ok');
}
function refreshAITokens() {
  if (!App.cfg) return;
  tokLine($('#nlTok'), fillPrompt('nl2sim'), '题目：\n' + $('#nlText').value, NL.images.length);
  tokLine($('#chkTok'), fillPrompt('check'), checkUserMsg());
  tokLine($('#genTok'), fillPrompt('problem'), genUserMsg());
  tokLine($('#swTok'), fillPrompt('sweep'), '当前配置：' + JSON.stringify(cfgBrief(App.cfg)));
}

/* =====================================================================
 * 10. 事件绑定与启动
 * ===================================================================== */
/* =====================================================================
 * 9b. 扩展功能：多物块碰撞模型 / 力学分析 / 时刻书签 / 任意时刻测量 /
 *     解题过程 / 参数反求 / AI 对话助手 / 多图联动
 * ===================================================================== */
/* —— 多物块（A、B）碰撞·相遇模型：复用“物块 = A、载体 = B”的数据通道 —— */
MODELS.duo = {
  id: 'duo', name: '多物块·碰撞相遇模型（A、B）', short: '碰撞', carrier: '物块B',
  params: [...COMMON_PARAMS,
    { key: 'L', sym: 'L', name: '轨道显示长度', unit: 'm', def: '10', group: '轨道', pos: true, hint: '只影响画面范围' },
    { key: 'm', sym: 'm<sub>A</sub>', name: '物块 A 质量', unit: 'kg', def: '1', group: '物块 A', pos: true },
    { key: 'x0', sym: 'x<sub>A</sub>', name: 'A 初始位置', unit: 'm', def: '0', group: '物块 A', nonneg: true },
    { key: 'v0', sym: 'v<sub>A</sub>', name: 'A 初速度', unit: 'm/s', def: '4', group: '物块 A', ai: '带符号' },
    { key: 'mu1', sym: 'μ<sub>A</sub>', name: 'A 与地面动摩擦因数', unit: '', def: '0', group: '物块 A', nonneg: true },
    { key: 'M', sym: 'm<sub>B</sub>', name: '物块 B 质量', unit: 'kg', def: '1', group: '物块 B', pos: true },
    { key: 'xB0', sym: 'x<sub>B</sub>', name: 'B 初始位置', unit: 'm', def: '4', group: '物块 B', nonneg: true },
    { key: 'vB0', sym: 'v<sub>B</sub>', name: 'B 初速度', unit: 'm/s', def: '0', group: '物块 B', ai: '带符号' },
    { key: 'muB', sym: 'μ<sub>B</sub>', name: 'B 与地面动摩擦因数', unit: '', def: '0', group: '物块 B', nonneg: true },
    { key: 'e', sym: 'e', name: '恢复系数', unit: '', def: '0.5', group: '碰撞', nonneg: true, hint: '仅“按恢复系数 e”时使用，取 0 ~ 1' }],
  presets: [
    { name: '弹性碰撞·等质量交换速度', params: { L: '10', m: '1', x0: '0', v0: '4', M: '1', xB0: '4', vB0: '0', tMax: '5' }, options: { collision: 'elastic' },
      problem: { text: '光滑水平面上，质量为 1 kg 的物块 A 以 4 m/s 的速度向右运动，与前方 4 m 处静止的等质量物块 B 发生弹性正碰。求：\n(1) 经多长时间两物块相碰；\n(2) 碰后 A、B 的速度。', answer: '(1) 1 s  (2) vA = 0，vB = 4 m/s（交换速度）' } },
    { name: '弹性碰撞·质量不等（A 反弹）', params: { L: '10', m: '1', x0: '2', v0: '6', M: '2', xB0: '5', vB0: '0', tMax: '4' }, options: { collision: 'elastic' },
      problem: { text: '光滑水平面上，质量 mA = 1 kg 的物块 A 以 6 m/s 的速度与静止的质量 mB = 2 kg 的物块 B 发生弹性正碰，两者初始相距 3 m。求碰后两物块的速度。', answer: 'vA = −2 m/s（反弹），vB = 4 m/s' } },
    { name: '完全非弹性·粘连后滑行（保留根号）', params: { L: '8', m: '2', x0: '0', v0: '6', mu1: '0.2', M: '1', xB0: '3', vB0: '0', muB: '0.2', tMax: '6' }, options: { collision: 'stick' },
      problem: { text: '粗糙水平面上（μ = 0.2），质量 mA = 2 kg 的物块 A 以 6 m/s 的初速度滑向前方 3 m 处静止的物块 B（mB = 1 kg），碰撞后两者粘在一起，g 取 10 m/s²。求：\n(1) 碰前瞬间 A 的速度；\n(2) 碰后的共同速度；\n(3) 碰撞损失的机械能；\n(4) 碰后还能滑行多远。', answer: '(1) 2√6 m/s  (2) 4√6/3 m/s  (3) 8 J  (4) 8/3 m' } },
    { name: '追及相遇·刹车陷阱（不碰撞）', params: { L: '20', m: '1', x0: '0', v0: '8', mu1: '0.2', M: '1', xB0: '7', vB0: '2', muB: '0', tMax: '7' }, options: { collision: 'none' },
      problem: { text: 'A 以 8 m/s 的初速度做加速度大小为 2 m/s² 的匀减速直线运动，前方 7 m 处的 B 同时以 2 m/s 同向匀速运动（两者在相邻的平行轨道上，不会相撞）。求两者相遇的时刻。', answer: '第一次 t = 3 − √2 s；A 在 t = 4 s 时已停下，第二次相遇 t = 4.5 s（不是 3 + √2 s）' } },
    { name: '恢复系数 e = 0.5 的非弹性碰撞', params: { L: '10', m: '1', x0: '1', v0: '6', M: '2', xB0: '4', vB0: '0', e: '0.5', tMax: '4' }, options: { collision: 'e' },
      problem: { text: '光滑水平面上，mA = 1 kg 的物块 A 以 6 m/s 的速度与静止的 mB = 2 kg 的物块 B 正碰，恢复系数 e = 0.5。求碰后两者的速度和碰撞损失的机械能。', answer: 'vA = 0，vB = 3 m/s；ΔE = 9 J' } }
  ]
};
function simulateDuo(P) {
  const mA = P.m, mB = P.M, gs = P.g * P.sin, gc = P.g * P.cos, FA = P.mu1 * mA * gc, FB = P.muB * mB * gc, mode = P.collision || 'elastic';
  const xA0 = clamp(P.x0, 0, P.L), xB0 = clamp(P.xB0, 0, P.L), side = xA0 <= xB0 ? -1 : 1;
  let t = 0, xa = xA0, va = P.v0, xb = xB0, vb = P.vB0, stuck = false, Q1 = 0, Q2 = 0, Ec = 0, sRel = 0, guard = 0, endReason = 'tmax', tFirst = null;
  const segs = [], events = [], collisions = [], meets = [], phases = [];
  const kindName = { elastic: '弹性', stick: '完全非弹性', e: '非弹性', none: '' }[mode] || '';
  const frTxt = (f, md) => md === 'none' ? '不受摩擦力' : (md === 'kinetic' ? '滑动' : '静') + '摩擦力 ' + fmt(Math.abs(f)) + ' N（' + dirWord(P, f) + '）';
  while (t < P.tMax - TE) {
    if (++guard > 400) { endReason = 'guard'; break; }
    let aA, aB, fA, fB, mdA, mdB;
    if (stuck) { const r = singleBody(-(mA + mB) * gs, mA + mB, va, FA + FB), tot = FA + FB; aA = aB = r.a; fA = tot > 0 ? r.f * FA / tot : 0; fB = tot > 0 ? r.f * FB / tot : 0; mdA = mdB = r.mode; }
    else {
      const ra = singleBody(-mA * gs, mA, va, FA), rb = singleBody(-mB * gs, mB, vb, FB); aA = ra.a; fA = ra.f; mdA = ra.mode; aB = rb.a; fB = rb.f; mdB = rb.mode;
      // 贴在一起且被后者推着走：按整体处理
      if (mode !== 'none' && Math.abs(xa - xb) < 1e-9 && Math.abs(va - vb) < 1e-9 && (aA - aB) * (-side) > 1e-12) { stuck = true; xb = xa; vb = va; continue; }
    }
    let dE = Infinity, ev = '';
    const cand = (d, name) => { if (d > TE && d < dE - 1e-12) { dE = d; ev = name; } };
    if (!stuck) cand(firstRoot(xa - xb, va - vb, aA - aB), mode === 'none' ? 'meet' : 'hit');
    if (Math.abs(va) > EPS && aA * va < 0) cand(-va / aA, stuck ? 'allStop' : 'aStop');
    if (!stuck && Math.abs(vb) > EPS && aB * vb < 0) cand(-vb / aB, 'bStop');
    let dt;
    if (dE === Infinity) { if (Math.abs(aA) < 1e-12 && Math.abs(aB) < 1e-12) { dt = Math.min(P.tMax - t, t <= TE ? 2 : clamp(0.35 * t, 1, 4)); ev = 'steady'; } else { dt = P.tMax - t; ev = 'tmax'; } }
    else if (dE >= P.tMax - t) { dt = P.tMax - t; ev = 'tmax'; } else dt = dE;
    const seg = { i: segs.length, t0: t, t1: t + dt, xb0: xa, vb0: va, ab: aA, xc0: xb, vc0: vb, ac: aB, on: true, f1: fA, f2: fB, fg: 0, fb: fA, mode1: mdA, mode2: mdB, modeG: 'none', slip1: false, Fb: 0, Fc: 0, Q10: Q1, Q20: Q2, s0: sRel, rMin: 0, rMax: 0, Ec0: Ec, stuck, end: ev };
    const xaN = xa + va * dt + 0.5 * aA * dt * dt, xbN = xb + vb * dt + 0.5 * aB * dt * dt;
    Q1 += Math.abs(fA * (xaN - xa)); Q2 += Math.abs(fB * (xbN - xb)); sRel += Math.abs((xaN - xa) - (xbN - xb));
    va += aA * dt; vb += aB * dt; xa = xaN; xb = xbN; t += dt;
    if (ev === 'aStop' || ev === 'allStop') va = 0;
    if (ev === 'bStop' || ev === 'allStop') vb = 0;
    if (Math.abs(va) < 1e-9) va = 0;
    if (Math.abs(vb) < 1e-9) vb = 0;
    if (stuck) { xb = xa; vb = va; }
    if (ev === 'hit' || ev === 'meet') { xa = xb = (xa + xb) / 2; }
    seg.xb1 = xa; seg.vb1 = va; seg.xc1 = xb; seg.vc1 = vb;
    let endTxt;
    if (ev === 'hit') {
      const u1 = va, u2 = vb, e = mode === 'elastic' ? 1 : mode === 'stick' ? 0 : clamp(P.e, 0, 1), pt = mA * u1 + mB * u2;
      let v1 = (pt - mB * e * (u1 - u2)) / (mA + mB), v2 = (pt + mA * e * (u1 - u2)) / (mA + mB);
      if (Math.abs(v1 - v2) < 1e-7) v1 = v2 = pt / (mA + mB);
      if (Math.abs(v1) < 1e-9) v1 = 0;
      if (Math.abs(v2) < 1e-9) v2 = 0;
      const loss = Math.max(0, 0.5 * mA * u1 * u1 + 0.5 * mB * u2 * u2 - 0.5 * mA * v1 * v1 - 0.5 * mB * v2 * v2);
      Ec += loss; collisions.push({ t, x: xa, u1, u2, v1, v2, e, loss }); va = v1; vb = v2; if (tFirst == null) tFirst = t;
      if (mode === 'stick' || collisions.length > 60) stuck = true;
      endTxt = '第 ' + collisions.length + ' 次' + kindName + '碰撞：vA ' + fmt(u1) + ' → ' + fmt(v1) + '，vB ' + fmt(u2) + ' → ' + fmt(v2) + ' m/s' + (loss > 1e-9 ? '，机械能损失 ' + fmt(loss) + ' J' : '，机械能不损失');
    } else if (ev === 'meet') { meets.push({ t, x: xa, vA: va, vB: vb }); if (tFirst == null) tFirst = t; endTxt = '第 ' + meets.length + ' 次相遇（x = ' + fmt(xa) + ' m 处）'; }
    else endTxt = { aStop: '物块 A 速度减为零', bStop: '物块 B 速度减为零', allStop: 'A、B 整体停下', steady: '此后运动状态不再变化', tmax: '达到最长模拟时间' }[ev];
    phases.push({ title: seg.stuck ? 'A、B 一起' + motionWord(seg.vb0, aA) : 'A ' + motionWord(seg.vb0, aA) + '，B ' + motionWord(seg.vc0, aB),
      lines: ['物块 A：a = ' + fmt(aA) + ' m/s²，' + frTxt(fA, mdA) + '；v：' + fmt(seg.vb0) + ' → ' + fmt(seg.vb1) + ' m/s',
        '物块 B：a = ' + fmt(aB) + ' m/s²，' + frTxt(fB, mdB) + '；v：' + fmt(seg.vc0) + ' → ' + fmt(seg.vc1) + ' m/s',
        '位移：A ' + fmt(seg.xb1 - seg.xb0) + ' m，B ' + fmt(seg.xc1 - seg.xc0) + ' m；间距 |xA − xB|：' + fmt(Math.abs(seg.xb0 - seg.xc0)) + ' → ' + fmt(Math.abs(seg.xb1 - seg.xc1)) + ' m'], end: endTxt });
    segs.push(seg); events.push({ t, type: ev });
    if (ev === 'steady' || ev === 'tmax') { endReason = ev; break; }
  }
  const sim = { P, isBelt: false, duo: true, segs, events, tEnd: t, endReason, x0: xA0, vc0: P.vB0, xr0: xA0 - xB0, xc00: xB0, aLeft: side < 0, collisions, meets, phases };
  sim.fake = { i: 0, t0: 0, t1: 0, xb0: xA0, vb0: P.v0, ab: 0, xc0: xB0, vc0: P.vB0, ac: 0, on: true, f1: 0, f2: 0, fg: 0, fb: 0, Q10: 0, Q20: 0, s0: 0, rMin: 0, rMax: 0 };
  let xmin = Math.min(0, xA0, xB0), xmax = Math.max(P.L, xA0, xB0), vmax = Math.max(Math.abs(P.v0), Math.abs(P.vB0), 1e-6);
  for (const g of segs) { xmin = Math.min(xmin, g.xb1, g.xc1); xmax = Math.max(xmax, g.xb1, g.xc1); vmax = Math.max(vmax, Math.abs(g.vb0), Math.abs(g.vc0), Math.abs(g.vb1), Math.abs(g.vc1)); }
  sim.xmin = xmin; sim.xmax = xmax; sim.vmax = vmax; sim.samples = [];
  if (!segs.length) sim.samples.push(stateInSeg(sim, sim.fake, 0));
  for (const g of segs) for (let k = 0; k <= 20; k++) sim.samples.push(stateInSeg(sim, g, g.t0 + (g.t1 - g.t0) * k / 20));
  const last = segs[segs.length - 1];
  const S = { tEnd: (endReason === 'steady' && last) ? last.t0 : t, tSim: t, xb: xa - xA0, xc: xb - xB0, vb: va, vc: vb, dRel: (xa - xb) - (xA0 - xB0), sRel, mark: 0, Q1, Q2, Wf: -Q1, WFb: 0, WFc: 0, Wbelt: 0,
    tCommon: null, tLeave: null, tMeet: tFirst, nColl: collisions.length + meets.length, Ecoll: Ec,
    dEkb: 0.5 * mA * (va * va - P.v0 * P.v0), dEkc: 0.5 * mB * (vb * vb - P.vB0 * P.vB0), dEpb: mA * gs * (xa - xA0), dEpc: mB * gs * (xb - xB0) };
  S.resid = S.dEkb + S.dEkc + S.dEpb + S.dEpc + Q1 + Q2 + Ec; sim.summary = S;
  return sim;
}
function duoResultRows(sim) {
  const S = sim.summary, P = sim.P, R = [], none = P.collision === 'none';
  R.push(['结束情况', { steady: '进入稳定状态（之后不再变化）', tmax: '达到最长模拟时间（过程可能未结束）', guard: '事件过多，已中止' }[sim.endReason]]);
  R.push([sim.endReason === 'steady' ? '进入稳定状态的时刻' : '全过程时间 t', fmt(S.tEnd) + ' s']);
  R.push([none ? '相遇次数' : '碰撞次数', String(none ? sim.meets.length : sim.collisions.length)]);
  sim.meets.forEach((c, i) => R.push(['第 ' + (i + 1) + ' 次相遇', 't = ' + fmt(c.t) + ' s，x = ' + fmt(c.x) + ' m']));
  sim.collisions.slice(0, 6).forEach((c, i) => R.push(['第 ' + (i + 1) + ' 次碰撞', 't = ' + fmt(c.t) + ' s，x = ' + fmt(c.x) + ' m'], ['　vA：碰前 → 碰后', fmt(c.u1) + ' → ' + fmt(c.v1) + ' m/s'], ['　vB：碰前 → 碰后', fmt(c.u2) + ' → ' + fmt(c.v2) + ' m/s'], ['　机械能损失', fmt(c.loss) + ' J']));
  R.push(['A 位移 / 末速度', fmt(S.xb) + ' m / ' + fmt(S.vb) + ' m/s'], ['B 位移 / 末速度', fmt(S.xc) + ' m / ' + fmt(S.vc) + ' m/s'], ['A 与地面摩擦生热', fmt(S.Q1) + ' J'], ['B 与地面摩擦生热', fmt(S.Q2) + ' J'],
    ['碰撞损失的机械能', fmt(S.Ecoll) + ' J'], ['系统动量：初 / 末', fmt(P.m * P.v0 + P.M * P.vB0) + ' / ' + fmt(P.m * S.vb + P.M * S.vc) + ' kg·m/s'], ['能量守恒残差', S.resid.toExponential(1) + ' J']);
  return R;
}
function duoChecks(inp, sim) {
  const out = [], P = inp.P, S = sim.summary, add = (s, i, d) => out.push({ status: s, item: i, detail: d }), w = [];
  if (P.g < 9.7 || P.g > 10.01) w.push('g = ' + nfix(P.g) + ' 不在常用范围 9.8~10');
  if (P.collision === 'e' && P.e > 1) w.push('恢复系数 e > 1，已按 1 处理');
  if (sim.endReason !== 'steady') w.push(sim.endReason === 'tmax' ? '模拟被“最长模拟时间”截断，过程可能尚未结束' : '事件数量异常，模拟被中止');
  if (sim.collisions.length > 60) w.push('碰撞次数过多（反复挤压），之后已按整体处理');
  add(w.length ? 'warn' : 'pass', '参数与运行状态', w.length ? w.join('；') : '参数正常，过程完整结束');
  let dp = 0, de = 0;
  sim.collisions.forEach(c => { dp = Math.max(dp, Math.abs(P.m * (c.v1 - c.u1) + P.M * (c.v2 - c.u2))); de = Math.max(de, Math.abs((c.v2 - c.v1) - c.e * (c.u1 - c.u2))); });
  if (sim.collisions.length) {
    add(dp < 1e-8 ? 'pass' : 'fail', '每次碰撞动量守恒', sim.collisions.length + ' 次碰撞，动量变化最大残差 ' + dp.toExponential(1) + ' kg·m/s');
    add(de < 1e-6 ? 'pass' : 'warn', '恢复系数关系 v₂′ − v₁′ = e(v₁ − v₂)', '最大偏差 ' + de.toExponential(1) + ' m/s');
  }
  const bad = []; let maxR = 0, maxJ = 0;
  sim.segs.forEach((g, i) => {
    const FA = P.mu1 * P.m * P.g * P.cos, FB = P.muB * P.M * P.g * P.cos, vm = g.vb0 + g.ab * (g.t1 - g.t0) / 2, wm = g.vc0 + g.ac * (g.t1 - g.t0) / 2;
    if (Math.abs(g.f1) > FA + 1e-6 || Math.abs(g.f2) > FB + 1e-6) bad.push('过程' + (i + 1) + '：摩擦力超过 μN');
    if (Math.abs(vm) > 1e-9 && vm * g.f1 > 1e-9) bad.push('过程' + (i + 1) + '：A 的摩擦力未与运动方向相反');
    if (Math.abs(wm) > 1e-9 && wm * g.f2 > 1e-9) bad.push('过程' + (i + 1) + '：B 的摩擦力未与运动方向相反');
    if (g.stuck) maxR = Math.max(maxR, Math.abs((P.m + P.M) * g.ab - (g.f1 + g.f2 - (P.m + P.M) * P.g * P.sin)));
    else maxR = Math.max(maxR, Math.abs(P.m * g.ab - (g.f1 - P.m * P.g * P.sin)), Math.abs(P.M * g.ac - (g.f2 - P.M * P.g * P.sin)));
    if (i > 0) { const p = sim.segs[i - 1]; maxJ = Math.max(maxJ, Math.abs(g.xb0 - p.xb1), Math.abs(g.xc0 - p.xc1)); }
  });
  add(bad.length ? 'fail' : 'pass', '摩擦力约束（|f| ≤ μN，与运动方向相反）', bad.length ? bad.join('；') : sim.segs.length + ' 个过程全部满足');
  add(maxR < 1e-6 ? 'pass' : 'fail', '牛顿第二定律逐过程复核', '最大残差 ' + maxR.toExponential(1) + ' N');
  add(maxJ < 1e-6 ? 'pass' : 'fail', '位置连续（碰撞只改变速度，不改变位置）', '最大跳变 ' + maxJ.toExponential(1) + ' m');
  const sc = Math.max(1, Math.abs(S.dEkb) + Math.abs(S.dEkc) + Math.abs(S.Q1) + Math.abs(S.Q2) + Math.abs(S.Ecoll));
  add(Math.abs(S.resid) < 1e-7 * sc ? 'pass' : 'fail', '能量守恒：ΔEk + ΔEp + Q摩擦 + ΔE碰撞 = 0', 'ΔEk = ' + nfix(S.dEkb + S.dEkc) + ' J，ΔEp = ' + nfix(S.dEpb + S.dEpc) + ' J，Q摩擦 = ' + nfix(S.Q1 + S.Q2) + ' J，ΔE碰撞 = ' + nfix(S.Ecoll) + ' J，残差 ' + S.resid.toExponential(1) + ' J');
  if (P.collision === 'elastic' && sim.collisions.length) add('info', '弹性碰撞', '碰撞前后机械能不变；两物块质量相等时交换速度。');
  if (P.collision === 'none' && sim.meets.length > 1) add('info', '多次相遇', '共相遇 ' + sim.meets.length + ' 次。有减速物体时注意它是否已经停下（刹车陷阱）。');
  return out;
}
/* 图表补充：动量-时间；duo 模型下的图例名 */
CHARTS.push({ id: 'pt', name: 'p-t 动量-时间', xl: 't / s', yl: 'p / (kg·m·s⁻¹)', time: true, series: [{ n: '物块', c: COL.block, x: 't', y: 'pb' }, { n: '木板', c: COL.carrier, x: 't', y: 'pc', boardOnly: true }, { n: 'p总', c: COL.rel, x: 't', y: s => s.pb + s.pc, boardOnly: true }] });
const DUO_NAMES = { '物块': 'A', '@': 'B', '相对Δx': 'xA−xB 变化', '木板': 'B', '物块受f': 'A受f', '地面对板f': 'B受f', 'Q(物块-@)': 'Q(A)', 'Q(地面)': 'Q(B)', 'Ek物': 'EkA', 'Ek板': 'EkB', 'Q总': 'Q+ΔE碰' };
METRICS.push({ id: 'tMeet', name: '首次碰撞/相遇时刻', unit: 's', f: s => s.duo && s.summary.tMeet != null ? s.summary.tMeet : NaN },
  { id: 'Ecoll', name: '碰撞损失机械能', unit: 'J', f: s => s.duo ? s.summary.Ecoll : NaN },
  { id: 'nColl', name: '碰撞/相遇次数', unit: '次', f: s => s.duo ? s.summary.nColl : NaN });
function nm(sim) { return sim.who ? sim.who : sim.duo ? { a: 'A', c: 'B', A: '物块 A', C: '物块 B' } : { a: '物', c: sim.isBelt ? '带' : '板', A: '物块', C: sim.isBelt ? '传送带' : '木板' }; }
function duoBox(sim, st) {
  const tl = st.tl == null ? st.t : st.tl, done = sim.collisions.filter(c => c.t <= tl + 1e-9), mt = sim.meets.filter(c => c.t <= tl + 1e-9);
  return '系统动量 p = m<sub>A</sub>v<sub>A</sub> + m<sub>B</sub>v<sub>B</sub> = <b>' + nfix(st.pb + st.pc, 3) + ' kg·m/s</b><br>系统动能 E<sub>k</sub> = <b>' + nfix(st.Ekb + st.Ekc, 3) + ' J</b><br>摩擦生热 Q<sub>A</sub> + Q<sub>B</sub> = <b>' + nfix(st.Q1 + st.Q2, 3) + ' J</b><br>碰撞已损失的机械能 = <b>' + nfix(st.Ec, 3) + ' J</b>' +
    done.map((c, i) => '<br>第 ' + (i + 1) + ' 次碰撞（t = ' + nfix(c.t, 3) + ' s）：v<sub>A</sub> ' + nfix(c.u1, 2) + ' → ' + nfix(c.v1, 2) + '，v<sub>B</sub> ' + nfix(c.u2, 2) + ' → ' + nfix(c.v2, 2)).join('') +
    mt.map((c, i) => '<br>第 ' + (i + 1) + ' 次相遇：t = ' + nfix(c.t, 3) + ' s，x = ' + nfix(c.x, 3) + ' m').join('');
}

/* —— ① 力学分析模式：数值面板（箭头在 renderScene 中绘制） —— */
function renderForceBox(sim, st) {
  const box = $('#forceBox'); if (!App.forces) { if (!box.hidden) box.hidden = true; return; } box.hidden = false;
  if (sim.forceBox) { box.innerHTML = sim.forceBox(st, sim); return; }
  const P = sim.P, gc = P.g * P.cos, dir = v => Math.abs(v) < 1e-9 ? '' : '（' + dirWord(P, v) + '）', kind = md => md === 'kinetic' ? '滑动' : md === 'static' ? '静' : '';
  const row = (col, name, val, unit, extra) => '<div><i style="background:' + col + '"></i><span>' + name + '</span><b>' + nfix(Math.abs(val), 3) + ' ' + unit + (extra || '') + '</b></div>';
  const n = nm(sim);
  let h = '<h6>' + n.A + '（质量 ' + nfix(P.m) + ' kg）</h6>' + row('#2f3b52', '重力 G = mg', P.m * P.g, 'N', '（竖直向下）') + row('#0b7285', '支持力 N', P.m * gc, 'N', '（垂直接触面）') + row('#9c36b5', kind(st.on ? st.mode1 : '') + '摩擦力 f', st.fb, 'N', dir(st.fb));
  if (Math.abs(st.Fb) > 1e-9) h += row('#d9480f', '外力 F', st.Fb, 'N', dir(st.Fb));
  h += row('#c92a2a', '合力 F合 = ma', P.m * st.ab, 'N', dir(st.ab)) + row('#1f7a36', '加速度 a', st.ab, 'm/s²', dir(st.ab)) + row('#e8590c', '相对速度 v' + n.a + ' − v' + n.c, st.vr, 'm/s', dir(st.vr));
  if (!sim.isBelt) {
    h += '<h6>' + n.C + '（质量 ' + nfix(P.M) + ' kg）</h6>' + row('#2f3b52', '重力', P.M * P.g, 'N', '（竖直向下）') + row('#0b7285', '地面支持力', (P.M + (!sim.duo && st.on ? P.m : 0)) * gc, 'N', '') +
      (sim.duo ? '' : row('#9c36b5', '物块对木板的摩擦力 f′', -st.f1, 'N', dir(-st.f1))) + row('#6b4fbb', kind(st.mode2) + '地面摩擦力', st.f2, 'N', dir(st.f2)) +
      (Math.abs(st.Fc) > 1e-9 ? row('#d9480f', '外力 F板', st.Fc, 'N', dir(st.Fc)) : '') + row('#c92a2a', '合力 = Ma', P.M * st.ac, 'N', dir(st.ac)) + row('#1f7a36', '加速度', st.ac, 'm/s²', dir(st.ac));
  }
  box.innerHTML = sim.boat ? h.replace(/地面支持力/g, '水的浮力').replace(/物块对木板的摩擦力/g, '人对船的摩擦力').replace(/地面摩擦力/g, '水的阻力') : h;
}

/* —— ② 时刻书签 —— */
function renderBookmarks() {
  const sim = App.sim, bms = App.cfg.bookmarks || (App.cfg.bookmarks = []);
  let h = '<button class="btn mini red" data-add="1">＋ 书签</button>';
  h += bms.map(b => '<button class="bm" data-t="' + b.t + '" title="跳到 t = ' + nfix(b.t, 3) + ' s">' + esc(b.name) + '<b data-del="' + b.id + '" title="删除书签">×</b></button>').join('');
  if (sim) h += sim.segs.map((g, i) => '<button class="bm auto" data-t="' + g.t1 + '" title="' + esc(sim.phases[i].end) + '">' + nfix(g.t1, 2) + ' s · ' + esc(sim.phases[i].end) + '</button>').join('');
  $('#bmBar').innerHTML = h;
  const tk = $('#tlTicks'); $$('.bmk', tk).forEach(e => e.remove());
  if (sim && sim.tEnd > 0) bms.forEach(b => { if (b.t <= sim.tEnd + 1e-9) { const i = document.createElement('i'); i.className = 'bmk'; i.style.left = (b.t / sim.tEnd * 100).toFixed(3) + '%'; tk.appendChild(i); } });
}
function addBookmark(t, name) {
  const bms = App.cfg.bookmarks || (App.cfg.bookmarks = []);
  bms.push({ id: uid(), t: +(+t).toFixed(5), name: String(name || ('t = ' + nfix(t, 3) + ' s')).slice(0, 30) }); bms.sort((a, b) => a.t - b.t);
  renderBookmarks(); saveStore(); toast('已添加书签', 'ok');
}

/* —— ③ 任意时刻测量 / 反查时刻 —— */
function evalTime(s) { s = String(s == null ? '' : s).trim(); if (!s) return null; try { const v = Expr.eval(s); return v >= 0 ? v : null; } catch (e) { return null; } }
function measureRows(sim, st) {
  const R = sim.measureRows ? sim.measureRows(sim, st) : measureRowsBase(sim, st);
  PL.varsFor(sim.P.model).forEach(v => R.push([v.name, fmt(st[v.key]) + (v.unit ? ' ' + v.unit : '')]));
  return R;
}
function measureRowsBase(sim, st) {
  const P = sim.P, n = nm(sim), R = [];
  R.push(['所处过程', sim.segs.length ? '过程 ' + (st.i + 1) + '：' + sim.phases[st.i].title : '—']);
  R.push([n.A + ' 位置 / 位移', fmt(st.xb) + ' m / ' + fmt(st.sb) + ' m'], [n.A + ' 速度', fmt(st.vb) + ' m/s'], [n.A + ' 加速度', fmt(st.ab) + ' m/s²']);
  R.push([n.C + (sim.isBelt ? ' 位移' : ' 位置 / 位移'), sim.isBelt ? fmt(st.sc) + ' m' : fmt(st.xc) + ' m / ' + fmt(st.sc) + ' m'], [n.C + ' 速度', fmt(st.vc) + ' m/s'], [n.C + ' 加速度', fmt(st.ac) + ' m/s²']);
  R.push(['相对速度 v' + n.a + ' − v' + n.c, fmt(st.vr) + ' m/s']);
  if (sim.duo) R.push(['间距 |xA − xB|', fmt(Math.abs(st.xr)) + ' m'], ['摩擦生热 QA / QB', fmt(st.Q1) + ' J / ' + fmt(st.Q2) + ' J'], ['碰撞已损失机械能', fmt(st.Ec) + ' J']);
  else R.push(['相对位移 Δx', fmt(st.dRel) + ' m'], ['相对路程 s相对', fmt(st.sRel) + ' m'], ['痕迹长度', fmt(st.rMax - st.rMin) + ' m'], ['摩擦生热 Q', fmt(st.Q1) + ' J']);
  R.push([n.A + ' 所受摩擦力', fmt(st.fb) + ' N'], [n.A + ' 合力 ma', fmt(P.m * st.ab) + ' N'], [n.A + ' 动能 / 动量', fmt(st.Ekb) + ' J / ' + fmt(st.pb) + ' kg·m/s']);
  if (!sim.isBelt) R.push([n.C + ' 动能 / 动量', fmt(st.Ekc) + ' J / ' + fmt(st.pc) + ' kg·m/s']);
  if (P.sin > 1e-9) R.push(['重力势能变化 ΔEp', fmt(st.dEp) + ' J']);
  return R;
}
function renderMeasure() {
  const sim = App.sim, out = $('#msOut'), q = $('#msQ');
  if (!sim) { out.innerHTML = '<p class="muted">当前参数有误，无法测量。</p>'; return; }
  const n = nm(sim), old = q.value, kv = rows => '<table class="kv"><tbody>' + rows.map(r => '<tr><td>' + mathText(r[0]) + '</td><td>' + mathText(r[1]) + '</td></tr>').join('') + '</tbody></table>';
  q.innerHTML = (sim.measureKeys || [['vb', n.A + ' 速度'], ['sb', n.A + ' 位移'], ['xb', n.A + ' 位置'], ['vc', n.C + ' 速度'], ['sc', n.C + ' 位移'], ['vr', '相对速度'], ['dRel', '相对位移'], ['Q1', sim.duo ? 'A 的摩擦生热' : '摩擦生热 Q']]).concat(PL.varOptions(sim)).map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('');
  if (old) q.value = old;
  const t1 = evalTime($('#msT').value), t2 = evalTime($('#msT2').value);
  if (t1 == null) { out.innerHTML = '<p class="muted">请输入有效的时刻（≥ 0，可用 √、分数）。</p>'; return; }
  const a = stateAt(sim, t1);
  let h = kv([['时刻 t', fmt(a.t) + ' s' + (t1 > sim.tEnd + 1e-9 ? '（超出模拟时长，取末状态）' : '')]].concat(measureRows(sim, a)));
  if (t2 != null) {
    const b = stateAt(sim, t2), dt = b.t - a.t;
    h += '<h4 style="font-size:13px;margin:12px 0 4px">从 t 到 t₂ 的变化量</h4>' + kv([['时间间隔 Δt', fmt(dt) + ' s'], [n.A + ' 位移', fmt(b.xb - a.xb) + ' m'], [n.A + ' 速度变化 Δv', fmt(b.vb - a.vb) + ' m/s'], [n.A + ' 平均速度', Math.abs(dt) > 1e-12 ? fmt((b.xb - a.xb) / dt) + ' m/s' : '—'],
      [n.C + ' 位移', fmt(b.xc - a.xc) + ' m'], ['相对位移', fmt((b.xb - b.xc) - (a.xb - a.xc)) + ' m'], ['这段时间的摩擦生热', fmt(b.Q1 + b.Q2 - a.Q1 - a.Q2) + ' J'], [n.A + ' 动能变化', fmt(b.Ekb - a.Ekb) + ' J'], [n.A + ' 所受合冲量 mΔv', fmt(sim.P.m * (b.vb - a.vb)) + ' N·s']]);
  }
  out.innerHTML = h;
}
function findTimes(sim, key, val) {
  const res = [], tol = 1e-9 * (1 + Math.abs(val));
  for (const g of sim.segs) {
    const N = 48, f = t => stateInSeg(sim, g, t)[key] - val; let tp = g.t0, fp = f(tp), flat = false;
    for (let k = 1; k <= N; k++) {
      const tc = g.t0 + (g.t1 - g.t0) * k / N, fc = f(tc);
      if (Math.abs(fp) <= tol) { if (!flat) res.push(tp); flat = true; }
      else { flat = false; if (fp * fc < 0 && Math.abs(fc) > tol) { let lo = tp, hi = tc, flo = fp; for (let j = 0; j < 50; j++) { const md = (lo + hi) / 2, fm = f(md); if (flo * fm <= 0) hi = md; else { lo = md; flo = fm; } } res.push((lo + hi) / 2); } }
      tp = tc; fp = fc;
    }
    if (Math.abs(fp) <= tol && !flat) res.push(tp);
  }
  return res.filter((t, i) => i === 0 || t - res[i - 1] > 1e-6);
}

/* —— ⑤ 解题过程（由模拟结果自动生成：牛顿定律 → 运动学 → 功能关系 / 动量） —— */
function fx(v) { if (v == null || !isFinite(v)) return '—'; const r = Math.round(v * 1e4) / 1e4; if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return nfix(r, 4); return exactForm(v) || nfix(v, 3); }
function par(v) { return v < 0 ? '(' + fx(v) + ')' : fx(v); }
function termStr(terms, numeric) { const s = terms.map(tm => (tm[1] < 0 ? '− ' : '+ ') + (numeric ? fx(Math.abs(tm[1])) : tm[0])).join(' ').replace(/^\+ /, ''); return s || '0'; }
/* 解题过程的生成（solutionSteps / duoSolution）与排版见下方 9c 节 */
/* （旧版纯文本解题过程已由 9c 节的排版版本取代） */

/* —— ⑥ 参数反求：把某个参数当未知量，由已知结果在范围内求解 —— */
function refreshInverseForm() {
  const sp = $('#invParam'); if (!sp) return; const old = sp.value, list = sweepParams();
  sp.innerHTML = list.map(p => '<option value="' + p.key + '">' + plain(p.sym) + '　' + p.name + '</option>').join(''); sp.value = list.some(p => p.key === old) ? old : 'mu1';
  const sm = $('#invMetric'), om = sm.value; sm.innerHTML = METRICS.map(m => '<option value="' + m.id + '">' + m.name + '（' + m.unit + '）</option>').join(''); sm.value = om || 'tEnd';
}
function inverseSolve() {
  const key = $('#invParam').value, pdef = sweepParams().find(p => p.key === key), mdef = METRICS.find(m => m.id === $('#invMetric').value), out = $('#invOut');
  let target, lo, hi; try { target = Expr.eval($('#invTarget').value); lo = Expr.eval($('#invLo').value); hi = Expr.eval($('#invHi').value); } catch (e) { toast('输入无法识别：' + e.message, 'bad'); return; }
  if (!pdef || !mdef || !(hi > lo)) { toast('请检查未知参数与搜索范围（上限需大于下限）', 'bad'); return; }
  const f = v => { const c = clone(App.cfg); c.params[key] = String(+v.toPrecision(12)); const inp = buildInput(c); if (!inp.ok) return NaN; return mdef.f(simulate(inp.P)) - target; };
  const N = 200, xs = [], fs = [], roots = [], jumps = [], tol = 1e-6 * (1 + Math.abs(target)); let mn = Infinity, mx = -Infinity;
  for (let i = 0; i <= N; i++) { const x = lo + (hi - lo) * i / N, y = f(x); xs.push(x); fs.push(y); if (isFinite(y)) { mn = Math.min(mn, y + target); mx = Math.max(mx, y + target); } }
  for (let i = 0; i < N; i++) {
    const a = fs[i], b = fs[i + 1]; if (!isFinite(a) || !isFinite(b)) continue;
    if (Math.abs(a) < 1e-10) { roots.push(xs[i]); continue; }
    if (a * b < 0) { let l = xs[i], h = xs[i + 1], fl = a; for (let j = 0; j < 46; j++) { const md = (l + h) / 2, fm = f(md); if (!isFinite(fm)) break; if (fl * fm <= 0) h = md; else { l = md; fl = fm; } } const x = (l + h) / 2; (Math.abs(f(x)) < tol ? roots : jumps).push(x); }
  }
  if (isFinite(fs[N]) && Math.abs(fs[N]) < 1e-10) roots.push(xs[N]);
  restoreApprox();
  const uniq = roots.filter((x, i) => i === 0 || Math.abs(x - roots[i - 1]) > 1e-7), sym = plain(pdef.sym), u = pdef.unit ? ' ' + pdef.unit : '';
  const valStr = x => { const r = Math.round(x * 1e6) / 1e6; return Math.abs(x - r) < 1e-9 ? String(r) : (exactForm(x) || String(+x.toPrecision(8))); };
  let h = '<div class="qbox" style="margin-top:8px">已知 <b>' + esc(mdef.name) + ' = ' + esc(fmt(target)) + ' ' + mdef.unit + '</b>，未知量 <b>' + esc(sym) + ' = ?</b>（搜索范围 ' + nfix(lo, 4) + ' ~ ' + nfix(hi, 4) + '）<br>';
  if (uniq.length) h += uniq.slice(0, 6).map(x => '解：<b>' + esc(sym) + ' = ' + esc(fmt(x, 4)) + u + '</b> <button class="btn mini pri" data-apply="' + esc(valStr(x)) + '" data-key="' + key + '">应用到当前配置</button>').join('<br>') + (uniq.length > 6 ? '<br>（该范围内还有更多解，或在一段区间内恒成立）' : '');
  else h += '在该范围内没有解。' + (isFinite(mn) ? '此范围内「' + esc(mdef.name) + '」的取值约为 ' + nfix(mn, 4) + ' ~ ' + nfix(mx, 4) + ' ' + mdef.unit + '，请调整目标值或搜索范围。' : '该指标在此模型 / 范围内没有定义。');
  if (jumps.length) h += '<br><span class="muted">提示：在 ' + esc(sym) + ' ≈ ' + jumps.slice(0, 3).map(x => nfix(x, 4)).join('、') + ' 附近该指标发生跳变（临界点），目标值恰落在跳变之间。</span>';
  out.innerHTML = h + '</div>';
}

/* —— ⑦ AI 对话助手 —— */
PROMPTS.chat = { name: '⑦ AI 对话助手', text:
'你是高中物理“板块 / 传送带 / 碰撞”模型的辅导助手，嵌在一个模拟器网页里。系统会附上当前模拟的参数、分过程数据与结果（这些数值是精确的，请以它为准）。\n要求：\n1. 用简洁的中文回答，先给结论再讲原因；公式用 Unicode 字符（μ、θ、√、²、Δ），不要使用 LaTeX；\n2. 解释时引用具体的过程序号和数值；\n3. 学生问“为什么”时，从受力分析、牛顿第二定律、运动学、功能关系 / 动量中选最贴切的角度讲清楚，并指出易错点；\n4. 如果用户要求修改参数（如“把 μ 改成 0.3”“倾角换成 30°”），在回复最后单独一行输出 JSON：{"set":{"参数键":"表达式字符串"}}，参数键必须取自下面当前模型的参数表；不需要修改时不要输出 JSON。\n\n{{SCHEMA}}' };
const Chat = { msgs: [], busy: false };
const CHAT_QUICK = ['逐个过程解释受力和运动', '这道题最容易错在哪里？', '痕迹长度和相对路程为什么可能不同？', '用能量和动量的观点再解一遍', '把 μ 改成 0.3，再告诉我会有什么变化'];
function chatContext() { if (!App.sim || !App.inp || !App.inp.ok) return '（当前参数有误，暂无模拟结果）'; return JSON.stringify(simDigest(App.cfg, App.inp.P, App.sim)) + '\n题干：' + ((App.cfg.problem && App.cfg.problem.text) || '（无）'); }
function chatSys() { return fillPrompt('chat') + '\n\n【当前模型】' + App.cfg.model + '\n【当前模拟数据（精确）】\n' + chatContext(); }
function chatTok() { tokLine($('#chatTok'), chatSys(), Chat.msgs.slice(-12).map(m => m.content).join('\n') + $('#chatInput').value); }
function chatPatch(text) { const m = String(text).match(/\{\s*"set"\s*:\s*\{[^{}]*\}\s*\}/); if (!m) return null; try { const j = JSON.parse(m[0]); return j.set && typeof j.set === 'object' ? j.set : null; } catch (e) { return null; } }
function renderChat() {
  const log = $('#chatLog');
  log.innerHTML = Chat.msgs.length ? Chat.msgs.map((m, i) => {
    if (m.role === 'user') return '<div class="msg user">' + esc(m.content) + '</div>';
    const patch = m.pending ? null : chatPatch(m.content), shown = m.content.replace(/```(?:json)?\s*\{\s*"set"[\s\S]*?```/g, '').replace(/\{\s*"set"\s*:\s*\{[^{}]*\}\s*\}/, '').trim();
    return '<div class="msg assistant' + (m.err ? ' err' : '') + '">' + (shown ? mdLite(shown) : (m.pending ? '正在思考…' : '')) + (patch ? '<div class="row" style="margin-bottom:0"><button class="btn mini pri" data-patch="' + i + '">应用参数修改：' + esc(Object.keys(patch).map(k => k + ' = ' + patch[k]).join('，')) + '</button></div>' : '') + '</div>';
  }).join('') : '<p class="muted" style="margin:auto">还没有对话。可以直接提问，或点上方的快捷问题。</p>';
  log.scrollTop = log.scrollHeight;
}
async function chatSend(text) {
  text = String(text || $('#chatInput').value).trim(); if (!text || Chat.busy) return;
  Chat.msgs.push({ role: 'user', content: text }); $('#chatInput').value = '';
  const sys = chatSys(), hist = Chat.msgs.slice(-12).map(m => ({ role: m.role, content: m.content })), pending = { role: 'assistant', content: '', pending: true };
  Chat.msgs.push(pending); Chat.busy = true; $('#chatSend').disabled = true; renderChat();
  try {
    const r = await callAI({ system: sys, user: hist.map(m => m.content).join('\n'), messages: [{ role: 'system', content: sys }].concat(hist), onDelta: (txt, think) => { pending.content = txt || ('〔思考中〕' + think.slice(-160)); renderChat(); } });
    pending.content = r.text;
  } catch (e) { pending.content = '✗ ' + e.message; pending.err = true; }
  pending.pending = false; Chat.busy = false; $('#chatSend').disabled = false; renderChat(); renderUsage(); chatTok();
}
function applyParamPatch(set) {
  const defs = MODELS[App.cfg.model].params, done = [];
  Object.keys(set).forEach(k => { const p = defs.find(d => d.key === k); if (!p) return; const s = String(set[k]).trim(); try { if (s !== '' || !p.optional) evalParam(p, s); App.cfg.params[k] = s; done.push(plain(p.sym) + ' = ' + s); } catch (e) { /* 非法值跳过 */ } });
  if (done.length) { renderModelUI(); recompute(); chatTok(); toast('已修改：' + done.join('，'), 'ok'); } else toast('没有可应用的参数', 'bad');
}

/* —— ⑧ 多图联动：在任一图表上移动 / 拖动，动画、数据与所有图表同步到该时刻 —— */
function chartTime(c, e) {
  const sim = App.sim, mp = c._map; if (!sim || !mp) return null;
  const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  if (c._time) return mp.x0 + clamp((px - mp.left) / mp.width, 0, 1) * (mp.x1 - mp.x0);
  const def = c._def, get = (s, k) => typeof k === 'function' ? k(s) : s[k]; let best = Infinity, bt = null; if (!def) return null;
  for (const sr of def.series) { if (sr.boardOnly && sim.isBelt) continue;
    for (const p of sim.samples) { const X = mp.left + (get(p, sr.x) - mp.x0) / (mp.x1 - mp.x0) * mp.width, Y = mp.top + mp.height - (get(p, sr.y) - mp.y0) / (mp.y1 - mp.y0) * mp.height, d = (X - px) * (X - px) + (Y - py) * (Y - py); if (d < best) { best = d; bt = p.t; } } }
  return best < 45 * 45 ? bt : null;
}

function bindExtra() {
  const ui = LS.get(K_UI, null) || {};
  App.forces = !!ui.forces; App.linked = ui.linked !== false;
  $('#chkForce').checked = App.forces; $('#chkLink').checked = App.linked;
  $('#chkForce').addEventListener('change', e => { App.forces = e.target.checked; App.dirty = true; saveUI(); });
  $('#chkLink').addEventListener('change', e => { App.linked = e.target.checked; App.dirty = true; saveUI(); });
  $('#optColl').addEventListener('change', e => { App.cfg.options.collision = e.target.value; recompute(); });
  // 书签
  $('#bmBar').addEventListener('click', e => {
    if (e.target.closest('[data-add]')) { if (!App.sim) return; const name = prompt('书签名称（可留空）', 't = ' + nfix(App.t, 3) + ' s'); if (name !== null) addBookmark(App.t, name.trim()); return; }
    const del = e.target.closest('[data-del]');
    if (del) { App.cfg.bookmarks = (App.cfg.bookmarks || []).filter(b => b.id !== del.dataset.del); renderBookmarks(); saveStore(); return; }
    const b = e.target.closest('.bm'); if (b) seek(+b.dataset.t);
  });
  // 测量
  ['msT', 'msT2'].forEach(id => $('#' + id).addEventListener('input', debounce(renderMeasure, 120)));
  $('#msUse').addEventListener('click', () => { $('#msT').value = nfix(App.t, 4); renderMeasure(); });
  $('#msGo').addEventListener('click', () => { const t = evalTime($('#msT').value); if (t == null) toast('请输入有效时刻', 'bad'); else seek(t); });
  $('#msBm').addEventListener('click', () => { const t = evalTime($('#msT').value); if (t == null || !App.sim) toast('请输入有效时刻', 'bad'); else addBookmark(Math.min(t, App.sim.tEnd), '测量 t = ' + nfix(t, 3) + ' s'); });
  $('#msFind').addEventListener('click', () => {
    if (!App.sim) return; let val; try { val = Expr.eval($('#msVal').value); } catch (e) { toast('目标值无法识别：' + e.message, 'bad'); return; }
    const ts = findTimes(App.sim, $('#msQ').value, val), name = $('#msQ').selectedOptions[0].textContent;
    $('#msFound').innerHTML = ts.length ? ts.slice(0, 10).map(t => '<button class="bm" data-t="' + t + '">t = ' + esc(fmt(t)) + ' s</button>').join('') : '<span class="muted">全过程中「' + esc(name) + '」没有达到 ' + nfix(val, 4) + '。</span>';
  });
  $('#msFound').addEventListener('click', e => { const b = e.target.closest('.bm'); if (b) { seek(+b.dataset.t); $('#msT').value = nfix(+b.dataset.t, 4); renderMeasure(); } });
  // 解题过程
  $('#solFill').addEventListener('click', () => { if (!App.sim) return; App.cfg.problem.analysis = solutionText(App.sim); $('#probAna').value = App.cfg.problem.analysis; saveStore(); toast('已填入“题目 → 解析”栏，导出 Word 时会带上', 'ok'); });
  $('#solCopy').addEventListener('click', () => { if (!App.sim) return; const t = solutionText(App.sim); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast('已复制解题过程', 'ok'), () => toast('复制失败，请改用“填入解析栏”', 'bad')); else toast('当前浏览器不支持直接复制，请改用“填入解析栏”', 'bad'); });
  // 参数反求
  $('#btnInv').addEventListener('click', inverseSolve);
  $('#invOut').addEventListener('click', e => { const b = e.target.closest('button[data-apply]'); if (!b) return; App.cfg.params[b.dataset.key] = b.dataset.apply; renderModelUI(); recompute(); toast('已把求得的参数写入当前配置', 'ok'); });
  // AI 对话
  $('#chatQuick').innerHTML = CHAT_QUICK.map(q => '<button type="button">' + esc(q) + '</button>').join('');
  $('#chatQuick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) chatSend(b.textContent); });
  $('#chatSend').addEventListener('click', () => chatSend());
  $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatSend(); } });
  $('#chatInput').addEventListener('input', debounce(chatTok, 150));
  $('#chatClear').addEventListener('click', () => { if (Chat.busy) return; Chat.msgs = []; renderChat(); chatTok(); });
  $('#chatLog').addEventListener('click', e => { const b = e.target.closest('button[data-patch]'); if (!b) return; const p = chatPatch(Chat.msgs[+b.dataset.patch].content); if (p) applyParamPatch(p); });
  $('#aiTabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab="chat"]'); if (b) { renderChat(); chatTok(); } });
  // 多图联动
  const scrub = e => { const c = e.target.closest && e.target.closest('canvas'); if (!c) return; const t = chartTime(c, e); if (t != null) seek(t); };
  $('#chartGrid').addEventListener('pointerdown', scrub);
  $('#chartGrid').addEventListener('pointermove', e => { if (!App.linked) return; if (e.pointerType === 'mouse' ? (e.buttons > 0 || !App.playing) : true) scrub(e); });
  renderChat();
}

/* =====================================================================
 * 9c. 公式排版（V3）
 *   mrender(src,'t')：普通文字里的数值美化——分数竖排、根号加横线、“≈ 近似值”淡化、x物 / v带 / EkA 等下标
 *   mrender(src,'f')：公式标记——变量斜体；_下标 ^上标（多字符用 {}）；{分子}//{分母}；#重点结果#
 *   文本中用 $…$ 包住公式，richLine() 负责混排；plainMath() 还原为纯文本（Word / 复制用）
 * ===================================================================== */
const SUBD = '₀₁₂₃₄₅₆₇₈₉';
const RX_PFRAC = /\(([^()]+)\)\/(\d+)(?![\d.A-Za-z])/y, RX_NUM = /(\d+(?:\.\d+)?)?√(\d+)|(\d+(?:\.\d+)?)(π?)|π/y, RX_DEN = /\/(\d+)(?![\d.A-Za-z])/y,
  RX_APX = /≈\s*-?\d+(?:\.\d+)?/y, RX_FN = /sin|cos|tan/y, RX_GRP = /[\u4e00-\u9fa5]+|[A-Za-z0-9]+|[\s\S]/y,
  RX_VAR = /([xvafFQWsI])(相对|物|板|带|共|静|地|合|电|人|船)|([xvamfQ])([AB])(?![A-Za-z])|(E)([kp])(物|板|人|船|A|B)?/y;
function mFrac(a, b) { return '<span class="mf"><span>' + a + '</span><span>' + b + '</span></span>'; }
function mRoot(a) { return '<span class="mr">√<span class="mr-b">' + a + '</span></span>'; }
function mrender(src, mode) {
  const s = String(src == null ? '' : src), F = mode === 'f', n = s.length; let i = 0, out = '', res = false, m;
  const at = re => { re.lastIndex = i; return re.exec(s); };
  const brace = () => { let d = 0, j = i; for (; j < n; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } const g = s.slice(i + 1, j); i = Math.min(j + 1, n); return g; };
  const group = () => { if (s[i] === '{') return brace(); const g = at(RX_GRP); if (!g) return ''; i += g[0].length; return g[0]; };
  while (i < n) {
    const ch = s[i];
    if (F && ch === '{') { const a = brace(); if (s.startsWith('//{', i)) { i += 2; const b = brace(); out += mFrac(mrender(a, mode), mrender(b, mode)); } else out += mrender(a, mode); continue; }
    if (F && ch === '#') { res = !res; out += res ? '<b class="mres">' : '</b>'; i++; continue; }
    if (F && (ch === '_' || ch === '^')) { i++; const g = group(), tg = ch === '_' ? 'sub' : 'sup'; out += '<' + tg + '>' + esc(g) + '</' + tg + '>'; continue; }
    if (ch === '(' && (m = at(RX_PFRAC))) { out += mFrac(mrender(m[1], mode), m[2]); i += m[0].length; continue; }
    if ((m = at(RX_NUM))) {
      const pi = F ? '<i>π</i>' : 'π'; let html, dec = false;
      if (m[2] != null) html = (m[1] || '') + mRoot(m[2]);
      else if (m[3] != null) { html = m[3] + (m[4] ? pi : ''); dec = m[3].indexOf('.') >= 0; }
      else html = pi;
      i += m[0].length;
      const d = dec ? null : at(RX_DEN);
      if (d) { out += mFrac(html, d[1]); i += d[0].length; } else out += html;
      continue;
    }
    if ((m = at(RX_APX))) { out += '<span class="apx">' + m[0] + '</span>'; i += m[0].length; continue; }
    const sd = SUBD.indexOf(ch);
    if (sd >= 0) { out += '<sub>' + sd + '</sub>'; i++; continue; }
    if (ch === '½') { out += mFrac('1', '2'); i++; continue; }
    if (ch === '⇒') { out += '<span class="marr">⇒</span>'; i++; continue; }
    if (F) {
      if ((m = at(RX_FN))) { out += '<span class="mfn">' + m[0] + '</span>'; i += m[0].length; continue; }
      if (/[A-Za-zα-ω]/.test(ch)) { out += '<i>' + ch + '</i>'; i++; continue; }
      if (ch === '-') { out += '−'; i++; continue; }
    } else if (!/[A-Za-z]/.test(s[i - 1] || '') && (m = at(RX_VAR))) {
      out += '<i class="mv">' + (m[1] || m[3] || m[5]) + '</i><sub>' + (m[2] || m[4] || (m[6] + (m[7] || ''))) + '</sub>'; i += m[0].length; continue;
    }
    out += esc(ch); i++;
  }
  return res ? out + '</b>' : out;
}
function mathText(s) { return mrender(s, 't'); }
function richLine(s) { return String(s == null ? '' : s).split('$').map((seg, k) => k % 2 ? '<span class="math">' + mrender(seg, 'f') + '</span>' : mrender(seg, 't')).join(''); }
function plainMath(s) {
  const wrap = a => /[\s+−×]/.test(a) ? '(' + a + ')' : a;
  return String(s == null ? '' : s).replace(/[$#]/g, '').replace(/([_^])\{([^{}]*)\}/g, (m, k, a) => k === '^' ? (a === '2' ? '²' : '^' + a) : (/^\d$/.test(a) ? SUBD[+a] : a))
    .replace(/\{([^{}]*)\}\/\/\{([^{}]*)\}/g, (m, a, b) => wrap(a) + ' ÷ ' + wrap(b))
    .replace(/_(\d)/g, (m, d) => SUBD[+d]).replace(/_/g, '').replace(/\^2/g, '²').replace(/\^/g, '');
}
function phaseLine(l) { const k = l.indexOf('：'); return k > 0 && k <= 6 ? '<b>' + esc(l.slice(0, k)) + '</b>' + mathText(l.slice(k + 1)) : mathText(l); }
function resultTiles(sim) {
  const S = sim.summary, none = sim.P.collision === 'none';
  const T = sim.tiles ? sim.tiles : sim.duo ? [['全过程时间', fmt(S.tEnd) + ' s'], [none ? '相遇次数' : '碰撞次数', String(none ? sim.meets.length : sim.collisions.length)], ['碰撞损失机械能', fmt(S.Ecoll) + ' J'], ['摩擦生热', fmt(S.Q1 + S.Q2) + ' J']]
    : [['全过程时间', fmt(S.tEnd) + ' s'], ['摩擦生热 Q', fmt(S.Q1) + ' J'], ['相对路程', fmt(S.sRel) + ' m'], ['痕迹长度', fmt(S.mark) + ' m']];
  return '<div class="tiles">' + T.map(t => '<div class="tile"><span>' + t[0] + '</span><b>' + mathText(t[1]) + '</b></div>').join('') + '</div>';
}

/* —— 解题过程 V3：每一步 = { tag 标签, tex 含 $公式$ 的文字 } —— */
function solutionSteps(sim) { return PL.solution(solutionStepsBase(sim).slice(), sim); }
function solutionStepsBase(sim) {
  if (sim.solution) return sim.solution(sim);
  if (sim.duo) return duoSolution(sim);
  const P = sim.P, S = sim.summary, steps = [], inc = P.sin > 1e-9, cosS = inc ? ' cosθ' : '', G = P.m * P.g, b = sim.isBelt, cn = b ? '传送带' : '木板', c = b ? '带' : '板', mu = b ? 'μ' : 'μ_{1}';
  const I0 = [{ tag: '约定', tex: '取' + (inc ? '沿斜面向上' : '水平向右') + '为正方向；最大静摩擦力等于滑动摩擦力。' },
    { tag: '压力', tex: '$N = mg' + cosS + ' = ' + fx(G * P.cos) + '$ N' },
    { tag: '摩擦力', tex: '$f = ' + mu + 'N = ' + fx(P.mu1) + ' × ' + fx(G * P.cos) + ' = #' + fx(P.mu1 * G * P.cos) + '#$ N（滑动摩擦力，也是最大静摩擦力）' }];
  if (!b && P.mu2 !== 0) I0.push({ tag: '地面摩擦', tex: '$f_地 = μ_2(M + m)g' + cosS + ' = #' + fx(P.mu2 * (P.M + P.m) * P.g * P.cos) + '#$ N（最大值）' });
  steps.push({ title: '已知与约定', items: I0 });
  sim.segs.forEach((g, i) => {
    const dt = g.t1 - g.t0, L = [], dxb = g.xb1 - g.xb0, dxc = g.xc1 - g.xc0, dxr = dxb - dxc, fsym = g.on ? (g.mode1 === 'static' ? 'f_静' : 'f') : 'f_地';
    const tb = []; if (Math.abs(g.Fb) > 1e-12) tb.push(['F', g.Fb]); if (Math.abs(g.fb) > 1e-12) tb.push([fsym, g.fb]); if (inc) tb.push(['mg sinθ', -G * P.sin]);
    L.push({ tag: '物块', tex: tb.length ? '$m·a_物 = ' + termStr(tb) + '$ ⇒ $a_物 = {' + termStr(tb, 1) + '}//{' + fx(P.m) + '} = #' + fx(g.ab) + '#$ m/s²' : '沿接触面方向合力为零，$a_物 = #0#$' });
    if (g.on && g.mode1 === 'static') L.push({ tag: '静摩擦', tex: '与' + cn + '相对静止、加速度相同，反推 $f_静 = ' + fx(Math.abs(g.f1)) + '$ N ≤ $' + mu + 'N = ' + fx(P.mu1 * G * P.cos) + '$ N，假设成立。' });
    if (b) L.push({ tag: '传送带', tex: Math.abs(g.ac) > 1e-9 ? '匀变速运行，$a_带 = ' + fx(g.ac) + '$ m/s²' : '匀速运行，$v_带 = ' + fx(g.vc0) + '$ m/s' });
    else {
      const tc = []; if (Math.abs(g.Fc) > 1e-12) tc.push(['F_板', g.Fc]); if (g.on && Math.abs(g.f1) > 1e-12) tc.push(['f′', -g.f1]); if (Math.abs(g.f2) > 1e-12) tc.push(['f_地', g.f2]); if (inc) tc.push(['Mg sinθ', -P.M * P.g * P.sin]);
      L.push({ tag: '木板', tex: tc.length ? '$M·a_板 = ' + termStr(tc) + '$ ⇒ $a_板 = {' + termStr(tc, 1) + '}//{' + fx(P.M) + '} = #' + fx(g.ac) + '#$ m/s²' : '沿接触面方向合力为零，$a_板 = #0#$' });
    }
    if (g.end === 'common') L.push({ tag: '共速', tex: '令 $v_物 = v_' + c + '$：$' + fx(g.vb0) + ' + ' + par(g.ab) + '·t = ' + fx(g.vc0) + ' + ' + par(g.ac) + '·t$ ⇒ $Δt = #' + fx(dt) + '#$ s' });
    else if (g.end === 'blockStop') L.push({ tag: '减速到零', tex: '令 $v_物 = 0$：$0 = ' + fx(g.vb0) + ' + ' + par(g.ab) + '·t$ ⇒ $Δt = #' + fx(dt) + '#$ s' });
    else if (g.end === 'boardStop') L.push({ tag: '减速到零', tex: '令 $v_板 = 0$：$0 = ' + fx(g.vc0) + ' + ' + par(g.ac) + '·t$ ⇒ $Δt = #' + fx(dt) + '#$ s' });
    else if (g.end === 'leaveL' || g.end === 'leaveR') L.push({ tag: '到达端点', tex: '$' + (b ? 'x_物' : 'x_物 − x_板') + ' = v_{0}t + ½at^2 = ' + fx(b ? dxb : dxr) + '$ m ⇒ $Δt = #' + fx(dt) + '#$ s' });
    else L.push({ tag: '历时', tex: '$Δt = ' + fx(dt) + '$ s' });
    L.push({ tag: '速度', tex: '$v_物 = v_0 + aΔt = ' + fx(g.vb0) + ' + ' + par(g.ab) + ' × ' + fx(dt) + ' = #' + fx(g.vb0 + g.ab * dt) + '#$ m/s' });
    L.push({ tag: '位移', tex: '$x_物 = v_0Δt + ½aΔt^2 = #' + fx(dxb) + '#$ m，$x_' + c + ' = #' + fx(dxc) + '#$ m' });
    if (g.on) {
      L.push({ tag: '相对位移', tex: '$Δx = x_物 − x_' + c + ' = ' + fx(dxb) + ' − ' + par(dxc) + ' = #' + fx(dxr) + '#$ m' });
      L.push({ tag: '生热', tex: g.mode1 === 'kinetic' ? '$Q = f·|Δx| = ' + fx(Math.abs(g.f1)) + ' × ' + fx(Math.abs(dxr)) + ' = #' + fx(Math.abs(g.f1 * dxr)) + '#$ J' : '无相对滑动，不生热。' });
    }
    L.push({ tag: '结束', tex: sim.phases[i].end });
    steps.push({ title: '过程 ' + (i + 1) + '（' + fx(g.t0) + ' s → ' + fx(g.t1) + ' s）：' + sim.phases[i].title, items: L });
  });
  const E = [];
  E.push({ tag: '摩擦生热', tex: '$Q = Σ f·s_相对 = #' + fx(S.Q1) + '#$ J（相对路程 $s_相对 = ' + fx(S.sRel) + '$ m，痕迹长度 ' + fx(S.mark) + ' m）' });
  E.push({ tag: '动能定理', tex: '对物块：$W_f + W_F + W_G = ΔE_k$ ⇒ $' + par(S.Wf) + ' + ' + par(S.WFb) + ' + ' + par(-S.dEpb) + ' = #' + fx(S.dEkb) + '#$ J' });
  E.push({ tag: '动量定理', tex: '对物块：$I_合 = mΔv = ' + fx(P.m) + ' × (' + fx(S.vb) + ' − ' + par(P.v0) + ') = #' + fx(P.m * (S.vb - P.v0)) + '#$ N·s' });
  if (b) E.push({ tag: '能量守恒', tex: '电动机多消耗的电能：$W_电 = ΔE_k + ΔE_p + Q = ' + par(S.dEkb) + ' + ' + par(S.dEpb) + ' + ' + fx(S.Q1) + ' = #' + fx(S.Wbelt) + '#$ J（也等于 $Σ f·x_带$）' });
  else {
    E.push({ tag: '能量守恒', tex: '对系统：$W_F = ΔE_{k物} + ΔE_{k板} + ΔE_p + Q + Q_地$ ⇒ $' + fx(S.WFb + S.WFc) + ' = ' + par(S.dEkb) + ' + ' + par(S.dEkc) + ' + ' + par(S.dEpb + S.dEpc) + ' + ' + fx(S.Q1) + ' + ' + fx(S.Q2) + '$ J' });
    const p0 = P.m * P.v0 + P.M * P.boardV0, p1 = P.m * S.vb + P.M * S.vc, free = P.mu2 === 0 && !inc && P.Fb === 0 && P.Fc === 0 && S.tLeave == null;
    if (free) {
      E.push({ tag: '动量守恒', tex: '地面光滑、无外力，系统合外力为零：$mv_0 + MV_0 = mv + MV$ ⇒ $' + fx(p0) + ' = ' + fx(p1) + '$ kg·m/s' });
      if (S.tCommon != null) E.push({ tag: '共同速度', tex: '$v_共 = {mv_0 + MV_0}//{m + M} = {' + fx(p0) + '}//{' + fx(P.m + P.M) + '} = #' + fx(p0 / (P.m + P.M)) + '#$ m/s' });
    } else E.push({ tag: '动量', tex: '系统受地面摩擦 / 外力 / 重力分力，合外力不为零，动量不守恒：$p$ 由 ' + fx(p0) + ' 变为 ' + fx(p1) + ' kg·m/s，变化量等于合外力的冲量。' });
  }
  steps.push({ title: '功能关系与动量', items: E });
  return steps;
}
function duoSolution(sim) {
  const P = sim.P, S = sim.summary, steps = [], inc = P.sin > 1e-9, mode = P.collision;
  steps.push({ title: '已知与约定', items: [{ tag: '约定', tex: '取' + (inc ? '沿斜面向上' : '水平向右') + '为正方向。' },
    { tag: '物块 A', tex: '$m_A = ' + fx(P.m) + '$ kg，$v_A = ' + fx(P.v0) + '$ m/s，$x_A = ' + fx(sim.x0) + '$ m' },
    { tag: '物块 B', tex: '$m_B = ' + fx(P.M) + '$ kg，$v_B = ' + fx(P.vB0) + '$ m/s，$x_B = ' + fx(sim.xc00) + '$ m' },
    { tag: '碰撞类型', tex: ({ elastic: '弹性碰撞（动量守恒 + 机械能守恒）', stick: '完全非弹性碰撞（碰后粘在一起，只有动量守恒）', e: '非弹性碰撞（动量守恒，恢复系数 $e = ' + fx(clamp(P.e, 0, 1)) + '$）', none: '不发生碰撞，只研究追及与相遇' }[mode] || mode) }] });
  sim.segs.forEach((g, i) => {
    const dt = g.t1 - g.t0, L = [];
    const one = (sym, m, f, a) => { const tm = []; if (Math.abs(f) > 1e-12) tm.push(['f_' + sym, f]); if (inc) tm.push(['m_{' + sym + '}g sinθ', -m * P.g * P.sin]); return tm.length ? '$m_{' + sym + '}·a_' + sym + ' = ' + termStr(tm) + '$ ⇒ $a_' + sym + ' = {' + termStr(tm, 1) + '}//{' + fx(m) + '} = #' + fx(a) + '#$ m/s²' : '沿运动方向不受力，$a_' + sym + ' = #0#$'; };
    if (g.stuck) L.push({ tag: '整体', tex: 'A、B 作为整体：$a = #' + fx(g.ab) + '#$ m/s²' });
    else { L.push({ tag: 'A 受力', tex: one('A', P.m, g.f1, g.ab) }); L.push({ tag: 'B 受力', tex: one('B', P.M, g.f2, g.ac) }); }
    if (g.end === 'hit' || g.end === 'meet') L.push({ tag: g.end === 'hit' ? '相碰条件' : '相遇条件', tex: '令 $x_A = x_B$：$' + fx(g.xb0) + ' + ' + par(g.vb0) + '·t + ½ × ' + par(g.ab) + '·t^2 = ' + fx(g.xc0) + ' + ' + par(g.vc0) + '·t + ½ × ' + par(g.ac) + '·t^2$ ⇒ $Δt = #' + fx(dt) + '#$ s' });
    else L.push({ tag: '历时', tex: '$Δt = ' + fx(dt) + '$ s' });
    L.push({ tag: '速度', tex: g.stuck ? '$v = ' + fx(g.vb0) + ' + ' + par(g.ab) + ' × ' + fx(dt) + ' = #' + fx(g.vb0 + g.ab * dt) + '#$ m/s'
      : '$v_A = ' + fx(g.vb0) + ' + ' + par(g.ab) + ' × ' + fx(dt) + ' = #' + fx(g.vb0 + g.ab * dt) + '#$ m/s，$v_B = ' + fx(g.vc0) + ' + ' + par(g.ac) + ' × ' + fx(dt) + ' = #' + fx(g.vc0 + g.ac * dt) + '#$ m/s' });
    L.push({ tag: '位移', tex: '$Δx_A = #' + fx(g.xb1 - g.xb0) + '#$ m，$Δx_B = #' + fx(g.xc1 - g.xc0) + '#$ m' });
    L.push({ tag: '结束', tex: sim.phases[i].end });
    steps.push({ title: '过程 ' + (i + 1) + '（' + fx(g.t0) + ' s → ' + fx(g.t1) + ' s）：' + sim.phases[i].title, items: L });
  });
  sim.collisions.slice(0, 6).forEach((c, k) => {
    const L = [{ tag: '动量守恒', tex: '$m_{A}v_1 + m_{B}v_2 = m_{A}v_1′ + m_{B}v_2′$，碰前总动量 $p = ' + fx(P.m) + ' × ' + par(c.u1) + ' + ' + fx(P.M) + ' × ' + par(c.u2) + ' = ' + fx(P.m * c.u1 + P.M * c.u2) + '$ kg·m/s' }];
    if (mode === 'elastic') L.push({ tag: '机械能守恒', tex: '$½m_{A}v_1^2 + ½m_{B}v_2^2 = ½m_{A}v_1′^2 + ½m_{B}v_2′^2$（等价于 $v_2′ − v_1′ = v_1 − v_2$）' });
    else if (mode === 'stick') L.push({ tag: '碰后共速', tex: '$v_1′ = v_2′ = {m_{A}v_1 + m_{B}v_2}//{m_A + m_B}$' });
    else L.push({ tag: '恢复系数', tex: '$v_2′ − v_1′ = e(v_1 − v_2) = ' + fx(c.e) + ' × ' + par(c.u1 - c.u2) + '$' });
    L.push({ tag: '解得', tex: '$v_1′ = #' + fx(c.v1) + '#$ m/s，$v_2′ = #' + fx(c.v2) + '#$ m/s' });
    L.push({ tag: '能量损失', tex: '$ΔE = E_{k前} − E_{k后} = #' + fx(c.loss) + '#$ J' });
    steps.push({ title: '第 ' + (k + 1) + ' 次碰撞（t = ' + fx(c.t) + ' s，x = ' + fx(c.x) + ' m）', items: L });
  });
  const Ek0 = 0.5 * P.m * P.v0 * P.v0 + 0.5 * P.M * P.vB0 * P.vB0, Ek1 = 0.5 * P.m * S.vb * S.vb + 0.5 * P.M * S.vc * S.vc, noF = P.mu1 === 0 && P.muB === 0 && !inc;
  steps.push({ title: '能量与动量总览', items: [
    { tag: '能量守恒', tex: '$E_{k初} = E_{k末} + Q_摩擦 + ΔE_碰 + ΔE_p$ ⇒ $' + fx(Ek0) + ' = ' + fx(Ek1) + ' + ' + fx(S.Q1 + S.Q2) + ' + ' + fx(S.Ecoll) + ' + ' + par(S.dEpb + S.dEpc) + '$ J' },
    { tag: '系统动量', tex: '初 ' + fx(P.m * P.v0 + P.M * P.vB0) + ' kg·m/s → 末 ' + fx(P.m * S.vb + P.M * S.vc) + ' kg·m/s' + (noF ? '（合外力为零，全程守恒）' : '（碰撞瞬间守恒；有摩擦 / 重力分力时全程不守恒）') }] });
  return steps;
}
function solutionText(sim) { return solutionSteps(sim).map(s => '【' + plainMath(s.title) + '】\n' + s.items.map(it => (it.tag ? it.tag + '：' : '') + plainMath(it.tex)).join('\n')).join('\n'); }
function solutionHTML(sim) {
  return solutionSteps(sim).map((s, k) => '<section class="sol"><h5><span class="sol-n">' + (k + 1) + '</span><span>' + mathText(s.title) + '</span></h5><div class="eqs">' +
    s.items.map(it => '<div class="eq-t">' + esc(it.tag || '') + '</div><div class="eq-b">' + richLine(it.tex) + '</div>').join('') + '</div></section>').join('');
}
function renderSolution() { $('#solBox').innerHTML = App.sim ? solutionHTML(App.sim) : '<p class="muted">当前参数有误，暂无解题过程。</p>'; }
/* 大屏阅读：题干 + 答案 + 解题过程 */
function openRead() {
  if (!App.sim) { toast('当前参数有误，暂无解题过程', 'bad'); return; }
  const pr = App.cfg.problem || {}, dlg = $('#dlgRead');
  $('#readTitle').textContent = pr.title || App.cfg.name;
  $('#readBody').innerHTML = (pr.text ? '<div class="read-prob">' + mathText(pr.text) + '</div>' : '') +
    (pr.answer ? '<div class="qbox" style="margin-bottom:14px;white-space:pre-wrap;line-height:2.1">参考答案　' + mathText(pr.answer) + '</div>' : '') + solutionHTML(App.sim);
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  dlg.scrollTop = 0;
}
function bindV3() {
  $('#solRead').addEventListener('click', openRead);
  $('#readClose').addEventListener('click', () => $('#dlgRead').close());
  $('#readWord').addEventListener('click', () => exportWord([App.cfg], App.cfg.problem.title || App.cfg.name));
  // 窄屏：参数 / 图表 / 分析 三块切换
  $('#mTabs').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (!b) return; $('#simGrid').dataset.m = b.dataset.m; $$('#mTabs button').forEach(x => x.classList.toggle('on', x === b)); App.dirty = true; });
}

/* =====================================================================
 * 9d. V4：2D / 3D 视图 · 平移缩放 · 全屏 · 人船模型 · 例题拼合
 * ===================================================================== */
App.view = { zoom: 1, x: 0, y: 0, follow: false, yaw: 0.5, pitch: 0.42, drag: 'rotate' };
App.mode3d = false;
/* 取某一时刻的状态但不切换“当前阶段”（拼合模拟用） */
function peekState(sim, t) { const keep = sim.cur, s = stateAt(sim, t); if (sim.combo) sim.cur = keep; return s; }
function packCfg(cfg) { const M = MODELS[cfg.model]; return M && M.pack ? M.pack(cfg) : cfg; }

/* —— 屏幕坐标下的通用小画法（3D 视图与人船画面共用） —— */
function sArrow(ctx, x1, y1, x2, y2, col, w, dash) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); if (len < 3) return; const ux = dx / len, uy = dy / len;
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w || 2; ctx.setLineDash(dash ? [5, 3] : []);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * 6, y2 - uy * 6); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * 9 - uy * 4, y2 - uy * 9 + ux * 4); ctx.lineTo(x2 - ux * 9 + uy * 4, y2 - uy * 9 - ux * 4); ctx.closePath(); ctx.fill();
}
function sText(ctx, str, x, y, col, font, align) {
  ctx.font = font || ('12px ' + FONT); ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.setLineDash([]);
  ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,253,248,.88)'; ctx.strokeText(str, x, y); ctx.fillStyle = col || '#1b2333'; ctx.fillText(str, x, y);
}
function sDim(ctx, x1, y1, x2, y2, col, label) {   // 尺寸线：两端带短竖线，中间写数值
  if (Math.hypot(x2 - x1, y2 - y1) < 3) return; ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.moveTo(x1, y1 - 4); ctx.lineTo(x1, y1 + 4); ctx.moveTo(x2, y2 - 4); ctx.lineTo(x2, y2 + 4); ctx.stroke();
  sText(ctx, label, (x1 + x2) / 2, (y1 + y2) / 2 - 9, col, '600 11px ' + FONT);
}
function sHUD(ctx, W, H, sim, st, tag) {
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = '#1b2333'; ctx.font = '600 14px ui-monospace,Consolas,monospace'; ctx.fillText('t = ' + st.t.toFixed(3) + ' s', 12, 22);
  if (sim.segs.length) {
    ctx.font = '12px ' + FONT; ctx.fillStyle = '#566078'; let str = '过程 ' + (st.i + 1) + '/' + sim.segs.length + ' · ' + sim.phases[st.i].title, cut = false;
    while (ctx.measureText(str).width > W - 130 && str.length > 6) { str = str.slice(0, -1); cut = true; }
    ctx.fillText(str + (cut ? '…' : ''), 12, 40);
  }
  if (tag) { ctx.font = '11px ' + FONT; ctx.fillStyle = '#8a93a6'; ctx.textAlign = 'right'; ctx.fillText(tag, W - 12, 22); }
}
function sceneFlags(sim, st, flags, noCarrier) {   // 红旗此刻在接触面坐标中的位置
  const cnt = { ground: 0, carrier: 0 }, cl = sim.boat ? '船' : sim.isBelt ? '带' : '板';
  return (flags || []).map(f => {
    const n = ++cnt[f.anchor]; if (f.t > st.t + 1e-9 || (noCarrier && f.anchor === 'carrier')) return null;
    const fs = peekState(sim, f.t); if (fs.stage !== st.stage) return null;
    return { anchor: f.anchor, label: (f.anchor === 'ground' ? '地' : cl) + n, x: f.anchor === 'ground' ? fs.xb : fs.xr + st.xc };
  }).filter(Boolean);
}

/* ---------------------------------------------------------------------
 * 人船模型：水的阻力不计，水平方向动量守恒
 *   数据通道沿用“物块 = 人、载体 = 船”，因此图表 / 扫描 / 反求 / 测量都可直接使用
 * --------------------------------------------------------------------- */
MODELS.boat = {
  id: 'boat', name: '人船模型（动量守恒）', short: '人船', carrier: '船', fresh: true,
  params: [COMMON_PARAMS[0], COMMON_PARAMS[2],
    { key: 'L', sym: 'L', name: '船长', unit: 'm', def: '3', group: '船', pos: true },
    { key: 'M', sym: 'M', name: '船的质量', unit: 'kg', def: '120', group: '船', pos: true },
    { key: 'vS0', sym: 'v<sub>0</sub>', name: '人船初始共同速度', unit: 'm/s', def: '0', group: '船', hint: '原来静止填 0', ai: '带符号；人和船原来静止填 "0"' },
    { key: 'm', sym: 'm', name: '人的质量', unit: 'kg', def: '60', group: '人', pos: true },
    { key: 'x0', sym: 'x<sub>0</sub>', name: '人的初始位置（距船左端）', unit: 'm', def: '0', group: '人', nonneg: true, ai: '站在船尾(左端)填 "0"，站在船头(右端)填 L' },
    { key: 'dWalk', sym: 'd', name: '人相对船走过的距离', unit: 'm', def: '3', group: '人', pos: true, hint: '从一端走到另一端时等于船长 L' },
    { key: 'u', sym: 'u', name: '人相对船的行走速度', unit: 'm/s', def: '1', group: '人', hint: '正 = 向右走，负 = 向左走', ai: '带符号：向右走为正' },
    { key: 'aW', sym: 'a<sub>相</sub>', name: '起步 / 停步的相对加速度', unit: 'm/s²', def: '1', group: '人', nonneg: true, hint: '0 = 瞬间起步、瞬间停下' }],
  build(cfg, P, errors) {
    if (errors.u || errors.x0 || errors.L || errors.dWalk) return;
    if (Math.abs(P.u) < 1e-9) { errors.u = '相对速度不能为 0'; return; }
    const room = P.u > 0 ? P.L - P.x0 : P.x0;
    if (P.dWalk > room + 1e-9) errors.dWalk = '超出船的范围：朝这个方向最多还能走 ' + nfix(room, 3) + ' m';
  },
  simulate(P) { return simulateBoat(P); },
  presets: [
    { name: '经典人船·从船尾走到船头', params: { L: '3', M: '120', m: '60', x0: '0', dWalk: '3', u: '1', aW: '1' },
      problem: { text: '质量 M=120 kg、长 L=3 m 的小船静止在平静的水面上，质量 m=60 kg 的人站在船尾。不计水的阻力，人从船尾走到船头的过程中，求：\n(1) 人相对地面的位移；\n(2) 船相对地面的位移。', answer: '(1) 2 m（向前）  (2) 1 m（向后）' } },
    { name: '人船·结果保留分数', params: { L: '5', M: '140', m: '70', x0: '0', dWalk: '5', u: '1', aW: '1' },
      problem: { text: '长 L=5 m、质量 M=140 kg 的小船静止在水面上，质量 m=70 kg 的人从船尾走到船头，不计水的阻力。求人和船相对地面的位移大小。', answer: '人 10/3 m，船 5/3 m' } },
    { name: '人从船头走回船尾（反向行走）', params: { L: '4', M: '150', m: '50', x0: '4', dWalk: '4', u: '-1', aW: '1' },
      problem: { text: '长 L=4 m、质量 M=150 kg 的小船静止在水面上，质量 m=50 kg 的人从船头走到船尾，不计水的阻力。求人和船相对地面的位移。', answer: '人向后 3 m，船向前 1 m' } },
    { name: '人船原来一起匀速·人向前走', params: { L: '3', M: '120', m: '60', x0: '0', dWalk: '3', u: '1', aW: '1', vS0: '1' },
      problem: { text: '质量 M=120 kg、长 L=3 m 的小船载着质量 m=60 kg 的人，一起以 1 m/s 的速度在水面上匀速前进。人从船尾走到船头：相对船先以 1 m/s² 加速到 1 m/s，匀速一段后再以 1 m/s² 减速停下。不计水的阻力，求这段时间内人和船相对地面的位移。', answer: '用时 4 s；人 6 m，船 3 m（仍满足 x人 − x船 = 3 m）' } },
    { name: '突然起步（瞬间获得相对速度）', params: { L: '3', M: '120', m: '60', x0: '0', dWalk: '3', u: '1.5', aW: '0' },
      problem: { text: '质量 M=120 kg、长 L=3 m 的小船静止在水面上，质量 m=60 kg 的人突然以相对船 1.5 m/s 的速度从船尾匀速走向船头，不计水的阻力。求：\n(1) 行走过程中人和船相对地面的速度；\n(2) 走到船头时两者的位移。', answer: '(1) 人 1 m/s，船 0.5 m/s（反向）  (2) 人 2 m，船 1 m' } }
  ]
};
function simulateBoat(P) {
  const m = P.m, M = P.M, L = P.L, tot = m + M, dir = P.u >= 0 ? 1 : -1, U = Math.abs(P.u), D = P.dWalk, aW = P.aW, V0 = P.vS0, x0 = clamp(P.x0, 0, L), smooth = aW > 1e-9;
  const prof = [];   // 人相对船的运动：[时长, 相对加速度, 类型]
  if (smooth) {
    const d1 = U * U / (2 * aW);
    if (2 * d1 >= D - 1e-12) { const tp = Math.sqrt(D / aW); prof.push([tp, dir * aW, 'acc'], [tp, -dir * aW, 'dec']); }
    else prof.push([U / aW, dir * aW, 'acc'], [(D - 2 * d1) / U, 0, 'walk'], [U / aW, -dir * aW, 'dec']);
  } else prof.push([D / U, 0, 'walk']);
  let t = 0, xr = x0, xc = 0, vr = smooth ? 0 : dir * U, sRel = 0, endReason = 'steady', vrMax = Math.abs(vr), resid = 0;
  const segs = [], events = [], phases = [], wd = v => Math.abs(v) < 1e-9 ? '' : (v > 0 ? '（向右）' : '（向左）');
  const TITLE = { acc: '人起步加速，船反向加速', walk: '人匀速行走，船匀速运动', dec: '人减速停下，船同时减速', steady: Math.abs(V0) < 1e-12 ? '人、船都静止' : '人船一起匀速运动' };
  const push = (dt, ar, kind) => {
    const aP = M * ar / tot, aB = -m * ar / tot, f = m * aP, vr0 = vr;
    const g = { i: segs.length, t0: t, t1: t + dt, xb0: xc + xr, vb0: V0 + M * vr / tot, ab: aP, xc0: xc, vc0: V0 - m * vr / tot, ac: aB, on: true, f1: f, f2: 0, fg: 0, fb: f,
      mode1: Math.abs(f) > 1e-9 ? 'static' : 'none', mode2: 'none', modeG: 'none', slip1: false, Fb: 0, Fc: 0, Q10: 0, Q20: 0, s0: sRel, rMin: 0, rMax: 0, end: kind, kind };
    const dxr = vr * dt + 0.5 * ar * dt * dt; xc += g.vc0 * dt + 0.5 * aB * dt * dt; xr += dxr; sRel += Math.abs(dxr); vr += ar * dt; if (Math.abs(vr) < 1e-9) vr = 0; t += dt; vrMax = Math.max(vrMax, Math.abs(vr));
    g.xb1 = xc + xr; g.vb1 = V0 + M * vr / tot; g.xc1 = xc; g.vc1 = V0 - m * vr / tot; resid = Math.max(resid, Math.abs(m * g.vb1 + M * g.vc1 - tot * V0));
    segs.push(g); events.push({ t, type: kind });
    phases.push({ title: TITLE[kind], end: '', lines: [
      '人：a = ' + fmt(aP) + ' m/s²，' + (Math.abs(f) > 1e-9 ? '受船的静摩擦力 ' + fmt(Math.abs(f)) + ' N' + wd(f) : '水平方向不受力') + '；v：' + fmt(g.vb0) + ' → ' + fmt(g.vb1) + ' m/s',
      '船：a = ' + fmt(aB) + ' m/s²；v：' + fmt(g.vc0) + ' → ' + fmt(g.vc1) + ' m/s',
      '人相对船：速度 ' + fmt(vr0) + ' → ' + fmt(vr) + ' m/s，本过程在船上走过 ' + fmt(Math.abs(dxr)) + ' m',
      '位移：人 ' + fmt(g.xb1 - g.xb0) + ' m，船 ' + fmt(g.xc1 - g.xc0) + ' m'] });
  };
  for (let i = 0; i < prof.length; i++) {
    const p = prof[i], left = P.tMax - t; if (left <= TE) { endReason = 'tmax'; break; }
    const cut = p[0] > left + 1e-12, lastP = i === prof.length - 1;
    push(cut ? left : p[0], p[1], p[2]);
    phases[phases.length - 1].end = cut ? '达到最长模拟时间' : p[2] === 'acc' ? '人相对船的速度达到 ' + fmt(Math.abs(vr)) + ' m/s' : !lastP ? '人开始减速'
      : (smooth ? '人相对船停下' : '人突然停下，船也同时恢复原来的速度') + '：在船上共走过 ' + fmt(sRel) + ' m';
    if (cut) { endReason = 'tmax'; break; }
  }
  if (endReason === 'steady') { vr = 0; if (P.tMax - t > TE) { push(Math.min(P.tMax - t, clamp(0.35 * t, 1, 4)), 0, 'steady'); phases[phases.length - 1].end = '此后运动状态不再变化'; } }
  const last = segs[segs.length - 1], tail = last.kind === 'steady', done = endReason === 'steady';
  const sim = { P, isBelt: false, boat: true, segs, events, phases, tEnd: t, endReason, x0, vc0: V0, who: { a: '人', c: '船', A: '人', C: '船' },
    names: { '物块': '人', '@': '船', '木板': '船', '相对Δx': '人相对船', '物块受f': '人受f', '地面对板f': '水对船f', 'Q(物块-@)': 'Q', 'Q(地面)': 'Q水', 'Ek物': 'Ek人', 'Ek板': 'Ek船' },
    resultRows: boatRows, checks: boatChecks, solution: boatSolution, render2D: renderBoat };
  sim.infoBox = st => boatBox(sim, st);
  sim.fake = { i: 0, t0: 0, t1: 0, xb0: x0, vb0: V0, ab: 0, xc0: 0, vc0: V0, ac: 0, on: true, f1: 0, f2: 0, fg: 0, fb: 0, Q10: 0, Q20: 0, s0: 0, rMin: 0, rMax: 0 };
  let xmin = 0, xmax = L, vmax = Math.max(Math.abs(V0), 1e-6), vP = V0, vB = V0;
  segs.forEach(g => {
    xmin = Math.min(xmin, g.xc1); xmax = Math.max(xmax, g.xc1 + L); vmax = Math.max(vmax, Math.abs(g.vb0), Math.abs(g.vb1), Math.abs(g.vc0), Math.abs(g.vc1));
    [g.vb0, g.vb1].forEach(v => { if (Math.abs(v) > Math.abs(vP)) vP = v; }); [g.vc0, g.vc1].forEach(v => { if (Math.abs(v) > Math.abs(vB)) vB = v; });
  });
  sim.xmin = xmin; sim.xmax = xmax; sim.vmax = vmax; sim.samples = [];
  for (const g of segs) for (let k = 0; k <= 20; k++) sim.samples.push(stateInSeg(sim, g, g.t0 + (g.t1 - g.t0) * k / 20));
  const xbE = tail ? last.xb0 : last.xb1, xcE = tail ? last.xc0 : last.xc1, vbE = done ? V0 : last.vb1, vcE = done ? V0 : last.vc1;
  const S = { tEnd: tail ? last.t0 : t, tSim: t, xb: xbE - x0, xc: xcE, vb: vbE, vc: vcE, dRel: (xbE - xcE) - x0, sRel, mark: 0, Q1: 0, Q2: 0, Wf: 0.5 * m * (vbE * vbE - V0 * V0), WFb: 0, WFc: 0, Wbelt: 0,
    tCommon: null, tLeave: null, dEkb: 0.5 * m * (vbE * vbE - V0 * V0), dEkc: 0.5 * M * (vcE * vcE - V0 * V0), dEpb: 0, dEpc: 0, resid, vPmax: vP, vBmax: vB, Wman: 0.5 * m * M / tot * vrMax * vrMax };
  sim.summary = S;
  sim.tiles = [['走完用时', fmt(S.tEnd) + ' s'], ['人相对船', fmt(S.dRel) + ' m'], ['人对地位移', fmt(S.xb) + ' m'], ['船对地位移', fmt(S.xc) + ' m']];
  return sim;
}
function boatRows(sim) {
  const S = sim.summary, P = sim.P, R = [];
  R.push(['结束情况', sim.endReason === 'tmax' ? '达到最长模拟时间（人还没有走完）' : '人走完全程并相对船静止']);
  R.push(['人走完全程的时间', fmt(S.tEnd) + ' s'], ['人对地位移 x人', fmt(S.xb) + ' m'], ['船对地位移 x船', fmt(S.xc) + ' m'], ['人相对船的位移 d = x人 − x船', fmt(S.dRel) + ' m']);
  if (Math.abs(P.vS0) < 1e-12 && Math.abs(S.xc) > 1e-12) R.push(['位移大小之比 |x人| : |x船|', fmt(Math.abs(S.xb / S.xc)) + '（等于 M : m）']);
  R.push(['人的最大对地速度', fmt(S.vPmax) + ' m/s'], ['船的最大对地速度', fmt(S.vBmax) + ' m/s'], ['系统总动量（全程不变）', fmt((P.m + P.M) * P.vS0) + ' kg·m/s'],
    ['系统动能的最大增量（人做的功）', fmt(S.Wman) + ' J'], ['动量守恒残差', S.resid.toExponential(1) + ' kg·m/s']);
  return R;
}
function boatChecks(inp, sim) {
  const P = sim.P, S = sim.summary, out = [], tot = P.m + P.M, add = (s, i, d) => out.push({ status: s, item: i, detail: d });
  add(sim.endReason === 'tmax' ? 'warn' : 'pass', '参数与运行状态', sim.endReason === 'tmax' ? '模拟被“最长模拟时间”截断，人还没有走完' : '人走完全程，过程完整结束');
  add(S.resid < 1e-8 * Math.max(1, tot * Math.abs(P.vS0) + P.m * Math.abs(P.u)) ? 'pass' : 'fail', '动量守恒：m·v人 + M·v船 = (m + M)·v0', '各过程端点的最大残差 ' + S.resid.toExponential(1) + ' kg·m/s');
  let r3 = 0, rx = 0;
  sim.segs.forEach(g => { r3 = Math.max(r3, Math.abs(P.m * g.ab + P.M * g.ac)); rx = Math.max(rx, Math.abs(P.m * (g.xb1 - sim.x0) + P.M * g.xc1 - tot * P.vS0 * g.t1)); });
  add(r3 < 1e-8 * Math.max(1, tot) ? 'pass' : 'fail', '牛顿第三定律：人与船之间的水平力等大反向（m·a人 + M·a船 = 0）', '最大残差 ' + r3.toExponential(1) + ' N');
  add(rx < 1e-7 * Math.max(1, tot * P.L) ? 'pass' : 'fail', '位移关系：m·x人 + M·x船 = (m + M)·v0·t', '最大残差 ' + rx.toExponential(1) + ' kg·m');
  add(Math.abs(Math.abs(S.dRel) - S.sRel) < 1e-7 * Math.max(1, P.L) ? 'pass' : 'fail', '几何关系：x人 − x船 = 人相对船的位移', 'x人 − x船 = ' + nfix(S.dRel, 4) + ' m，人在船上走过 ' + nfix(S.sRel, 4) + ' m');
  if (Math.abs(P.vS0) < 1e-12) add('info', '人船模型结论', 'x人 = M·d ÷ (m + M) = ' + fmt(P.M * S.dRel / tot) + ' m，x船 = −m·d ÷ (m + M) = ' + fmt(-P.m * S.dRel / tot) + ' m。位移大小与质量成反比，与人走得快慢无关。');
  if (P.aW <= 1e-9) add('info', '瞬间起步 / 停步', '相对加速度取 0 表示人“突然”获得相对速度：起步和停步瞬间速度发生突变（冲量作用），动量仍然守恒。');
  return out;
}
function boatSolution(sim) {
  const P = sim.P, S = sim.summary, tot = P.m + P.M, d = S.dRel, v0 = P.vS0, still = Math.abs(v0) < 1e-12, steps = [];
  steps.push({ title: '模型与约定', items: [
    { tag: '约定', tex: '取水平向右为正方向；不计水的阻力，人和船组成的系统水平方向合外力为零，动量守恒。' },
    { tag: '已知', tex: '$m = ' + fx(P.m) + '$ kg，$M = ' + fx(P.M) + '$ kg，人相对船的位移 $d = ' + fx(d) + '$ m' + (still ? '；开始时人、船都静止。' : '；开始时人船一起以 $v_{0} = ' + fx(v0) + '$ m/s 运动。') }] });
  const A = [
    { tag: '动量守恒', tex: still ? '任意时刻 $m v_人 + M v_船 = 0$ ⇒ $m v_人 = −M v_船$（人向前走，船向后退）' : '任意时刻 $m v_人 + M v_船 = (m + M)v_{0}$' },
    { tag: '位移关系', tex: still ? '速度关系对时间累积：$m x_人 + M x_船 = 0$' : '速度关系对时间累积：$m x_人 + M x_船 = (m + M)v_{0}t$，其中 $t = ' + fx(S.tEnd) + '$ s' },
    { tag: '几何关系', tex: '人相对船的位移 $x_人 − x_船 = d = ' + fx(d) + '$ m' },
    { tag: '人的位移', tex: '$x_人 = {M}//{m + M}·d' + (still ? '' : ' + v_{0}t') + ' = {' + fx(P.M) + '}//{' + fx(tot) + '} × ' + par(d) + (still ? '' : ' + ' + par(v0 * S.tEnd)) + ' = #' + fx(S.xb) + '#$ m' },
    { tag: '船的位移', tex: '$x_船 = −{m}//{m + M}·d' + (still ? '' : ' + v_{0}t') + ' = −{' + fx(P.m) + '}//{' + fx(tot) + '} × ' + par(d) + (still ? '' : ' + ' + par(v0 * S.tEnd)) + ' = #' + fx(S.xc) + '#$ m' }];
  if (still) A.push({ tag: '结论', tex: '$|x_人| : |x_船| = M : m = ' + fx(P.M / P.m) + '$；位移只取决于质量和相对位移，与人走得快慢无关。' });
  steps.push({ title: '动量守恒 → 位移关系', items: A });
  sim.segs.forEach((g, i) => {
    if (g.kind === 'steady') return; const dt = g.t1 - g.t0, I = [];
    if (Math.abs(g.f1) > 1e-9) {
      I.push({ tag: '人', tex: '船对人的静摩擦力提供加速度：$f = m·a_人 = ' + fx(P.m) + ' × ' + par(g.ab) + ' = #' + fx(g.f1) + '#$ N' });
      I.push({ tag: '船', tex: '人对船的反作用力：$M·a_船 = −f$ ⇒ $a_船 = {' + fx(-g.f1) + '}//{' + fx(P.M) + '} = #' + fx(g.ac) + '#$ m/s²' });
    } else I.push({ tag: '受力', tex: '人匀速行走，人与船之间水平方向没有相互作用力，两者都做匀速运动。' });
    I.push({ tag: '速度', tex: '$v_人 = ' + fx(g.vb0) + ' → #' + fx(g.vb1) + '#$ m/s，$v_船 = ' + fx(g.vc0) + ' → #' + fx(g.vc1) + '#$ m/s' });
    I.push({ tag: '位移', tex: '$Δx_人 = #' + fx(g.xb1 - g.xb0) + '#$ m，$Δx_船 = #' + fx(g.xc1 - g.xc0) + '#$ m（历时 ' + fx(dt) + ' s）' });
    I.push({ tag: '结束', tex: sim.phases[i].end });
    steps.push({ title: '过程 ' + (i + 1) + '（' + fx(g.t0) + ' s → ' + fx(g.t1) + ' s）：' + sim.phases[i].title, items: I });
  });
  steps.push({ title: '能量', items: [{ tag: '功能关系', tex: '系统动能的增量来自人做的功（消耗体能）：行走中动能最多增加 $ΔE_k = #' + fx(S.Wman) + '#$ J；人停下后，系统动能又回到初值。' }] });
  return steps;
}
function boatBox(sim, st) {
  const P = sim.P;
  return '系统动量 m·v<sub>人</sub> + M·v<sub>船</sub> = <b>' + nfix(st.pb + st.pc, 3) + ' kg·m/s</b>（守恒）<br>人对地位移 x<sub>人</sub> = <b>' + nfix(st.sb, 3) + ' m</b><br>船对地位移 x<sub>船</sub> = <b>' + nfix(st.sc, 3) + ' m</b>' +
    '<br>人相对船 d = x<sub>人</sub> − x<sub>船</sub> = <b>' + nfix(st.dRel, 3) + ' m</b><br>m·x<sub>人</sub> + M·x<sub>船</sub> − (m+M)·v<sub>0</sub>·t = <b>' + nfix(P.m * st.sb + P.M * st.sc - (P.m + P.M) * P.vS0 * (st.tl == null ? st.t : st.tl), 3) + ' kg·m</b>';
}
/* 人船模型的 2D 画面：水面、船、行走的人，并标注 x人、x船 和相对位移 d */
function renderBoat(ctx, W, H, sim, st, o) {
  const P = sim.P, vw = o.view || {}, small = W < 480, span = Math.max(sim.xmax - sim.xmin, 1e-6), pad = small ? 34 : 70;
  const s = (vw.zoom || 1) * (W - 2 * pad) / span, cx = W / 2 + (vw.x || 0), yW = H * 0.68 + (vw.y || 0), xmid = vw.follow ? st.xb : (sim.xmin + sim.xmax) / 2, X = x => cx + (x - xmid) * s;
  const hull = small ? 16 : 22, deck = yW - hull * 0.6, keel = yW + hull * 0.5, hP = small ? 44 : 62, yTop = deck - hP;
  ctx.setLineDash([]); ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(70,90,130,.07)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0.5; x < W; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = 0.5; y < H; y += 20) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
  const ln = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const hullPath = xl => { const a = X(xl), z = X(xl + P.L), e = Math.min(20, (z - a) * 0.1); ctx.beginPath(); ctx.moveTo(a - e, deck); ctx.lineTo(z + e, deck); ctx.lineTo(z - e * 0.3, keel); ctx.lineTo(a + e * 0.3, keel); ctx.closePath(); };
  const man = (x, ghost) => {
    const r = hP * 0.13, hip = deck - hP * 0.42, sh = yTop + 2 * r + hP * 0.08, sw = ghost ? hP * 0.07 : hP * (0.05 + 0.13 * Math.abs(Math.sin(st.dRel * 7)));
    ctx.strokeStyle = ghost ? '#9aa3b5' : '#c2410c'; ctx.lineWidth = ghost ? 1.2 : 2.6; ctx.lineCap = 'round'; ctx.setLineDash(ghost ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(x + r, yTop + r); ctx.arc(x, yTop + r, r, 0, Math.PI * 2);
    ctx.moveTo(x, yTop + 2 * r); ctx.lineTo(x, hip); ctx.lineTo(x - sw, deck); ctx.moveTo(x, hip); ctx.lineTo(x + sw, deck);
    ctx.moveTo(x - hP * 0.17, sh + hP * 0.16); ctx.lineTo(x, sh); ctx.lineTo(x + hP * 0.17, sh + hP * 0.16); ctx.stroke();
    if (!ghost) { ctx.fillStyle = '#e8590c'; ctx.beginPath(); ctx.arc(x, yTop + r, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.setLineDash([]); ctx.lineCap = 'butt';
  };
  const moved = Math.abs(st.sc) > 1e-9 || Math.abs(st.sb) > 1e-9, px = X(st.xb), flags = sceneFlags(sim, st, o.flags);
  if (moved) { hullPath(0); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#9aa3b5'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]); man(sim.x0, true); }   // 初始位置的虚影
  const flag = f => {
    const g = f.anchor === 'ground', x = X(f.x), y0 = g ? keel + 6 : deck, y1 = g ? yTop - 56 : deck - hP * 0.55, d = g ? 1 : -1;
    ctx.strokeStyle = g ? '#6b7280' : '#4a3520'; ctx.lineWidth = 2; ln(x, y0, x, y1);
    ctx.fillStyle = COL.flag; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x + d * 15, y1 + 6); ctx.lineTo(x, y1 + 12); ctx.closePath(); ctx.fill();
    sText(ctx, f.label, x + d * 18, y1 + 6, '#a61e1e', '600 11px ' + FONT, g ? 'left' : 'right');
  };
  flags.filter(f => f.anchor === 'ground').forEach(flag);
  hullPath(st.xc); ctx.fillStyle = '#dfb97f'; ctx.fill(); ctx.strokeStyle = '#8a5a22'; ctx.lineWidth = 1.5; ctx.stroke();
  ln(X(st.xc), deck, X(st.xc), deck - 5); ln(X(st.xc + P.L), deck, X(st.xc + P.L), deck - 5);
  sText(ctx, 'M', X(st.xc + P.L / 2), (deck + keel) / 2, '#5b3a12', 'italic 600 12px ' + FONT);
  ctx.fillStyle = 'rgba(77,171,247,.18)'; ctx.fillRect(0, yW, W, Math.max(0, H - yW));   // 水
  ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x <= W; x += 6) { const y = yW + Math.sin((x + st.t * 14) / 16) * 1.6; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke();
  man(px, false);
  flags.filter(f => f.anchor === 'carrier').forEach(flag);
  if (moved) {   // 两者的位移标注
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#b8bfcc'; ctx.lineWidth = 1;
    ln(X(sim.x0), yTop - 44, X(sim.x0), deck); ln(px, yTop - 44, px, yTop - 4); ln(X(0), keel, X(0), keel + 30); ln(X(st.xc), keel, X(st.xc), keel + 30); ctx.setLineDash([]);
    sDim(ctx, X(sim.x0), yTop - 18, px, yTop - 18, COL.block, 'x人 = ' + nfix(st.sb, 2) + ' m');
    sDim(ctx, X(st.xc + sim.x0), yTop - 40, px, yTop - 40, COL.rel, 'd = x人 − x船 = ' + nfix(st.dRel, 2) + ' m');
    sDim(ctx, X(0), keel + 24, X(st.xc), keel + 24, COL.carrier, 'x船 = ' + nfix(st.sc, 2) + ' m');
  }
  if (o.showVec !== false) {
    const k = (small ? 44 : 64) / sim.vmax, va = v => Math.sign(v) * Math.max(14, Math.abs(v) * k);
    if (Math.abs(st.vb) > 1e-6) { const d = Math.sign(st.vb), y = deck - hP * 0.62, x1 = px + d * hP * 0.24; sArrow(ctx, x1, y, x1 + va(st.vb), y, '#c2410c', 2); sText(ctx, 'v人=' + nfix(st.vb, 2), x1 + va(st.vb) + d * 4, y - 1, '#c2410c', '11px ' + FONT, d > 0 ? 'left' : 'right'); }
    if (Math.abs(st.vc) > 1e-6) { const d = Math.sign(st.vc), y = (deck + keel) / 2, x1 = X(st.xc + (d > 0 ? P.L : 0)) + d * 24; sArrow(ctx, x1, y, x1 + va(st.vc), y, COL.carrier, 2); sText(ctx, 'v船=' + nfix(st.vc, 2), x1 + va(st.vc) + d * 4, y - 1, COL.carrier, '11px ' + FONT, d > 0 ? 'left' : 'right'); }
  }
  if (o.forces) {   // 竖直方向与水平方向的力分别取比例尺（水平力比重力小得多）
    const G = P.m * P.g, kv = (small ? 38 : 52) / Math.max(G, 1e-9), fm = Math.max.apply(null, sim.segs.map(g => Math.abs(g.f1)).concat([1e-9])), kh = (small ? 34 : 48) / fm, yc = deck - hP * 0.5;
    const vec = (x, y, dx, dy, col, lab) => { const l = Math.hypot(dx, dy); if (l < 3) return; sArrow(ctx, x, y, x + dx, y + dy, col, 2.2); sText(ctx, lab, x + dx + dx / l * 11, y + dy + dy / l * 11, col, '600 11px ' + FONT); };
    vec(px, yc, 0, G * kv, '#2f3b52', 'G'); vec(px, yc, 0, -G * kv, '#0b7285', 'N'); vec(px, deck - 3, st.fb * kh, 0, '#9c36b5', 'f'); vec(X(st.xc + P.L / 2), deck + 5, -st.f1 * kh, 0, '#6b4fbb', 'f′');
  }
  sHUD(ctx, W, H, sim, st, '正方向 →');
}

/* ---------------------------------------------------------------------
 * 3D 视图：不依赖任何库，用透视投影 + 分层绘制在 Canvas 2D 上画出立体场景
 *   接触面坐标 (x 沿接触面, h 垂直接触面向上, z 纵深) → 世界坐标 → 屏幕
 * --------------------------------------------------------------------- */
function render3D(ctx, W, H, sim, st, o) {
  const P = sim.P, vw = o.view || {}, th = P.rad || 0, c = Math.cos(th), sn = Math.sin(th), belt = !!sim.isBelt, duo = !!sim.duo, boat = !!sim.boat;
  const span = Math.max(sim.xmax - sim.xmin, 1e-6), xmid = (sim.xmin + sim.xmax) / 2, u = span * 0.065;           // u：物块边长（米）
  const wz = u * 2.4, tb = u * 0.35, hB = (belt || duo || boat) ? 0 : u * 0.32, hd = u * 0.9, base = belt ? -tb : 0, inc = th > 1e-9 && !boat;
  const Wp = (x, h, z) => [(x - xmid) * c - h * sn, (x - xmid) * sn + h * c, z || 0];
  const yG = boat ? -hd * 0.55 : inc ? Wp(sim.xmin - u, base, 0)[1] - span * 0.015 : belt ? -(tb + u * 1.5) : 0;      // 地面（水面）的世界高度
  const gBase = boat ? -hd * 0.55 : inc ? base : belt ? -(tb + u * 1.5) : 0;                                           // 地面旗的旗杆底
  const yaw = vw.yaw == null ? 0.5 : vw.yaw, pitch = vw.pitch == null ? 0.42 : vw.pitch, dist = span * 2.6;
  const T = vw.follow ? Wp(st.xb, u, 0) : [0, (yG + (inc ? (sim.xmax - xmid) * sn : 0)) / 2 + u * 0.5, 0];
  const K = (vw.zoom || 1) * Math.min(W * 0.72, H * 1.35) * dist / span, cx = W / 2 + (vw.x || 0), cy = H * 0.56 + (vw.y || 0);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const pr = p => { const vx = p[0] - T[0], vy = p[1] - T[1], vz = p[2] - T[2], x1 = vx * cyw + vz * syw, z1 = vz * cyw - vx * syw, d = Math.max(dist - (vy * sp + z1 * cp), dist * 0.08); return [cx + x1 * K / d, cy - (vy * cp - z1 * sp) * K / d, d]; };
  const cam = [T[0] - dist * cp * syw, T[1] + dist * sp, T[2] + dist * cp * cyw], LD = [-0.35, 0.8, 0.49];
  const poly = (pts, fill, stroke, lw) => {
    ctx.beginPath(); for (let i = 0; i < pts.length; i++) { const q = pr(pts[i]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  };
  const line = (a, b, col, lw, dash) => { const p = pr(a), q = pr(b); ctx.strokeStyle = col; ctx.lineWidth = lw || 1; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]); };
  // 一个朝外的平面：背向相机则不画；亮度随朝向变化
  const face = (pts, n, rgb) => {
    const q = pts[0]; if ((cam[0] - q[0]) * n[0] + (cam[1] - q[1]) * n[1] + (cam[2] - q[2]) * n[2] <= 0) return;
    const k = 0.6 + 0.4 * Math.max(0, n[0] * LD[0] + n[1] * LD[1] + n[2] * LD[2]); poly(pts, 'rgb(' + rgb.map(v => Math.round(v * k)).join(',') + ')', 'rgba(40,30,10,.35)', 1);
  };
  // 长方体：x∈[xa,xz]、h∈[h0,h1]、z∈[z0,z1]（接触面坐标）
  const box = (xa, xz, h0, h1, z0, z1, rgb) => {
    const ax = [[c, sn, 0], [-sn, c, 0], [0, 0, 1]], hs = [(xz - xa) / 2, (h1 - h0) / 2, (z1 - z0) / 2], oc = Wp((xa + xz) / 2, (h0 + h1) / 2, (z0 + z1) / 2);
    for (let a = 0; a < 3; a++) for (const sg of [1, -1]) {
      const n = ax[a].map(v => v * sg), ct = oc.map((v, i) => v + n[i] * hs[a]), b1 = ax[(a + 1) % 3], b2 = ax[(a + 2) % 3], e1 = hs[(a + 1) % 3], e2 = hs[(a + 2) % 3];
      face([[1, 1], [1, -1], [-1, -1], [-1, 1]].map(e => ct.map((v, i) => v + b1[i] * e1 * e[0] + b2[i] * e2 * e[1])), n, rgb);
    }
  };
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#eaf0fa'); sky.addColorStop(1, '#fffdf8'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // 地面 / 水面 + 网格
  const R = span * 0.95, Rz = Math.max(span * 0.42, wz * 2), gs = niceStep(span, 8), gl = boat ? '#9ccdf5' : '#d9cfb9';
  poly([[-R, yG, -Rz], [R, yG, -Rz], [R, yG, Rz], [-R, yG, Rz]], boat ? '#d3e8fb' : '#f1ead9', boat ? '#8cc4f2' : '#cfc5ae', 1);
  ctx.globalAlpha = 0.55;
  for (let x = Math.ceil(-R / gs) * gs, k = 0; x <= R && k < 60; x += gs, k++) line([x, yG, -Rz], [x, yG, Rz], gl, 1);
  for (let z = Math.ceil(-Rz / gs) * gs, k = 0; z <= Rz && k < 60; z += gs, k++) line([-R, yG, z], [R, yG, z], gl, 1);
  ctx.globalAlpha = 1;
  if (inc) {   // 斜面（楔形体）
    const A = Wp(sim.xmin - u, base), B = Wp(sim.xmax + u, base), zw = wz / 2 + u * 0.9, rgb = [228, 219, 200], Z = (p, z) => [p[0], p[1], z], G = (p, z) => [p[0], yG, z];
    face([Z(A, -zw), Z(B, -zw), G(B, -zw), G(A, -zw)], [0, 0, -1], rgb); face([Z(B, -zw), Z(B, zw), G(B, zw), G(B, -zw)], [1, 0, 0], rgb);
    face([Z(A, -zw), Z(A, zw), G(A, zw), G(A, -zw)], [-1, 0, 0], rgb); face([Z(A, zw), Z(B, zw), G(B, zw), G(A, zw)], [0, 0, 1], rgb);
    face([Z(A, -zw), Z(B, -zw), Z(B, zw), Z(A, zw)], [-sn, c, 0], rgb);
    const q = pr([A[0] + span * 0.16, yG, zw]); sText(ctx, 'θ=' + nfix(P.theta, 1) + '°', q[0], q[1] - 10, '#566078', '12px ' + FONT);
  }
  if (belt && !inc) for (const x of [P.L * 0.12, P.L * 0.88]) box(x - u * 0.16, x + u * 0.16, -(tb + u * 1.5), -tb, -wz * 0.4, wz * 0.4, [150, 158, 172]);   // 水平传送带的支架
  if (boat) { const hw = -hd * 0.55, q = [Wp(-u * 0.3, hw, -wz / 2), Wp(P.L + u * 0.3, hw, -wz / 2), Wp(P.L + u * 0.3, hw, wz / 2), Wp(-u * 0.3, hw, wz / 2)]; for (let i = 0; i < 4; i++) line(q[i], q[(i + 1) % 4], '#5f93bf', 1.3, [5, 4]); }   // 船的初始位置
  const offA = duo && P.collision !== 'none' ? (sim.aLeft ? -u / 2 : u / 2) : 0, zA = duo && P.collision === 'none' ? u * 0.75 : 0, bh = st.on ? hB : 0;
  const drawBlock = () => {
    if (boat) { box(st.xb - u * 0.24, st.xb + u * 0.24, 0, u * 1.35, -u * 0.24, u * 0.24, [232, 89, 12]); box(st.xb - u * 0.2, st.xb + u * 0.2, u * 1.4, u * 1.8, -u * 0.2, u * 0.2, [245, 190, 150]); }
    else box(st.xb + offA - u / 2, st.xb + offA + u / 2, bh, bh + u, zA - u / 2, zA + u / 2, [232, 89, 12]);
  };
  const drawB = () => box(st.xc - offA - u / 2, st.xc - offA + u / 2, 0, u, -zA - u / 2, -zA + u / 2, [28, 126, 214]);
  const drawCarrier = () => {
    if (belt) {
      box(0, P.L, -tb, 0, -wz / 2, wz / 2, [200, 206, 218]);
      const spc = niceStep(span, 22), off = ((st.xc % spc) + spc) % spc; for (let x = off, k = 0; x <= P.L + 1e-9 && k < 400; x += spc, k++) line(Wp(x, 0, -wz / 2), Wp(x, 0, wz / 2), '#7d869b', 1.2);
    } else if (boat) box(st.xc - u * 0.3, st.xc + P.L + u * 0.3, -hd * 0.55, 0, -wz / 2, wz / 2, [223, 185, 127]);
    else if (!duo) box(st.xc, st.xc + P.L, 0, hB, -wz / 2, wz / 2, [223, 185, 127]);
    if (st.rMax - st.rMin > 1e-6) {   // 痕迹
      let a = st.rMin + st.xc, z = st.rMax + st.xc; if (belt) { a = clamp(a, 0, P.L); z = clamp(z, 0, P.L); }
      const hm = hB + u * 0.002; if (z - a > 1e-9) poly([Wp(a, hm, -wz * 0.1), Wp(z, hm, -wz * 0.1), Wp(z, hm, wz * 0.1), Wp(a, hm, wz * 0.1)], 'rgba(15,15,20,.88)');
    }
  };
  const flag3 = f => {
    const g = f.anchor === 'ground', z = g ? -(wz / 2 + u * 0.5) : wz * 0.34, h0 = g ? gBase : hB, h1 = (g ? 0 : hB) + u * (g ? 2.7 : 1.7), d = g ? 1 : -1;
    line(Wp(f.x, h0, z), Wp(f.x, h1, z), g ? '#6b7280' : '#4a3520', 2);
    poly([Wp(f.x, h1, z), Wp(f.x + d * u * 0.75, h1 - u * 0.26, z), Wp(f.x, h1 - u * 0.52, z)], COL.flag);
    const q = pr(Wp(f.x + d * u * 0.9, h1 - u * 0.26, z)); sText(ctx, f.label, q[0] + d * 8, q[1], '#a61e1e', '600 11px ' + FONT, g ? 'left' : 'right');
  };
  // —— 分层绘制：按“相机在哪一侧”决定先后，保证遮挡关系正确 ——
  const flags = sceneFlags(sim, st, o.flags, duo), gFlags = flags.filter(f => f.anchor === 'ground'), cFlags = flags.filter(f => f.anchor === 'carrier' && (!belt || (f.x >= -1e-9 && f.x <= P.L + 1e-9)));
  const front = cam[2] > 0, offBoard = !belt && !duo && !boat && !st.on;
  if (front) gFlags.forEach(flag3);
  let late = null;
  if (offBoard) { const side = st.xb >= st.xc + P.L / 2 ? 1 : -1, e0 = Wp(st.xc + (side > 0 ? P.L : 0), 0, 0); if (((cam[0] - e0[0]) * c + (cam[1] - e0[1]) * sn) * side > 0) late = drawBlock; else drawBlock(); }
  drawCarrier();
  if (!front) cFlags.forEach(flag3);
  if (duo) {
    const aFirst = P.collision === 'none' ? !front : pr(Wp(st.xb + offA, u / 2, 0))[2] > pr(Wp(st.xc - offA, u / 2, 0))[2];
    if (aFirst) { drawBlock(); drawB(); } else { drawB(); drawBlock(); }
  } else if (!offBoard) drawBlock();
  if (front) cFlags.forEach(flag3);
  if (late) late();
  if (!front) gFlags.forEach(flag3);
  // —— 叠加层：文字、速度、受力、位移标注 ——
  const UX = [c, sn, 0], UY = [-sn, c, 0], add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
  const arrow3 = (a, b, col, w, dash) => { const p = pr(a), q = pr(b); sArrow(ctx, p[0], p[1], q[0], q[1], col, w, dash); return [p, q]; };
  const lab = (str, p, col, font) => { const q = pr(p); sText(ctx, str, q[0], q[1], col, font || ('600 12px ' + FONT)); };
  const ctrA = Wp(st.xb + offA, bh + (boat ? u * 0.9 : u / 2), zA), ctrB = Wp(st.xc - offA, u / 2, -zA);
  lab(boat ? '人' : duo ? 'A' : 'm', boat ? Wp(st.xb, u * 0.7, u * 0.24) : Wp(st.xb + offA, bh + u / 2, zA + u / 2), '#4a1d00', 'italic 600 12px ' + FONT);
  if (duo) lab('B', Wp(st.xc - offA, u / 2, -zA + u / 2), '#072f57', 'italic 600 12px ' + FONT);
  else if (boat) lab('船 M', Wp(st.xc + P.L / 2, -hd * 0.28, wz / 2), '#5b3a12');
  else if (!belt) lab('M', Wp(st.xc + P.L / 2, hB / 2, wz / 2), '#5b3a12', 'italic 600 11px ' + FONT);
  if (o.showVec !== false) {
    const kv = span * 0.16 / sim.vmax, vl = v => Math.sign(v) * Math.max(u * 0.6, Math.abs(v) * kv), tip = (pq, str, col) => { const d = pq[1][0] >= pq[0][0] ? 1 : -1; sText(ctx, str, pq[1][0] + d * 5, pq[1][1] - 8, col, '11px ' + FONT, d > 0 ? 'left' : 'right'); };
    if (Math.abs(st.vb) > 1e-6) { const a = Wp(st.xb + offA, bh + u * (boat ? 2.1 : 1.25), zA); tip(arrow3(a, add(a, UX, vl(st.vb)), '#c2410c', 2), (boat ? 'v人=' : duo ? 'vA=' : 'v=') + nfix(st.vb, 2), '#c2410c'); }
    if (Math.abs(st.vc) > 1e-6) {
      const a = duo ? Wp(st.xc - offA, u * 1.25, -zA) : Wp((belt ? P.L / 2 : st.xc + P.L / 2) - vl(st.vc) / 2, hB, wz / 2 + u * 0.35);
      tip(arrow3(a, add(a, UX, vl(st.vc)), COL.carrier, 2), (boat ? 'v船=' : duo ? 'vB=' : belt ? 'v带=' : 'v板=') + nfix(st.vc, 2), COL.carrier);
    }
  }
  if (o.forces) {
    const bodies = [{ p: ctrA, foot: Wp(st.xb + offA, bh, zA), m: P.m, f: st.fb, F: st.Fb, a: st.ab }]; if (duo) bodies.push({ p: ctrB, foot: Wp(st.xc - offA, 0, -zA), m: P.M, f: st.f2, F: 0, a: st.ac });
    const fm = Math.max.apply(null, bodies.map(q => Math.max(q.m * P.g, Math.abs(q.f), Math.abs(q.F), Math.abs(q.m * q.a)))), kf = span * 0.15 / Math.max(fm, 1e-9);
    const vec = (a, d, len, col, str, dash) => { if (Math.abs(len) < 1e-12) return; const pq = arrow3(a, add(a, d, len), col, 2.2, dash), dx = pq[1][0] - pq[0][0], dy = pq[1][1] - pq[0][1], l = Math.hypot(dx, dy); if (l > 3) sText(ctx, str, pq[1][0] + dx / l * 11, pq[1][1] + dy / l * 11, col, '600 11px ' + FONT); };
    bodies.forEach(q => {
      const G = q.m * P.g; vec(q.p, [0, -1, 0], G * kf, '#2f3b52', 'G'); vec(q.p, UY, G * P.cos * kf, '#0b7285', 'N'); vec(q.foot, UX, q.f * kf, '#9c36b5', 'f'); vec(q.p, UX, q.F * kf, '#d9480f', 'F');
      if (Math.abs(q.a) > 1e-9) { const top = add(q.p, UY, u * (boat ? 1.75 : 1.2)); vec(top, UX, q.m * q.a * kf, '#c92a2a', 'F合', true); vec(add(top, UY, u * 0.5), UX, Math.sign(q.a) * clamp(Math.abs(q.a) * span * 0.012, u * 0.5, u * 2.2), '#1f7a36', 'a'); }
    });
  }
  const dim3 = (xa, xz, h, z, col, str) => { const p = pr(Wp(xa, h, z)), q = pr(Wp(xz, h, z)); sDim(ctx, p[0], p[1], q[0], q[1], col, str); };
  const lastOf = a => { for (let i = flags.length - 1; i >= 0; i--) if (flags[i].anchor === a) return flags[i]; return null; }, fc = lastOf('carrier'), fg = lastOf('ground');
  if (boat) {
    dim3(sim.x0, st.xb, u * 2.7, 0, COL.block, 'x人=' + nfix(st.sb, 2) + 'm'); dim3(st.xc + sim.x0, st.xb, u * 3.5, 0, COL.rel, 'd=' + nfix(st.dRel, 2) + 'm');
    dim3(0, st.xc, -hd * 0.55, wz / 2 + u * 0.7, COL.carrier, 'x船=' + nfix(st.sc, 2) + 'm');
  } else {
    if (fc && st.on) dim3(fc.x, st.xb, hB + u * 2.3, 0, COL.rel, 'Δx相对=' + nfix(st.xb - fc.x, 2) + 'm');
    if (fg) dim3(fg.x, st.xb, hB + u * 3.1, 0, COL.carrier, (duo ? 'xA=' : 'x物=') + nfix(st.xb - fg.x, 2) + 'm');
  }
  sHUD(ctx, W, H, sim, st, '3D 视图 · 拖动旋转');
}

/* （上一版“引用配置、各算各的”拼合实现已删除；新实现见下方“例题拼合（组合轨道）”） */




/* ---------------------------------------------------------------------
 * 例题拼合（组合轨道）：把若干“阶段”首尾相接成一条连续轨道，全部画在同一张图上
 *   同一个物体依次通过各阶段；上一阶段出口的速度、质量自动成为下一阶段的入口条件
 *   STAGE_TYPES 是阶段类型注册表（扩展点）：params 参数表 / make 生成引擎参数 / judge 判定能否通过
 *   固定面、传送带、加速电场都借用传送带引擎（带速为 0 即固定面，电场力当作外力）；碰撞借用两物块引擎；木板借用板块引擎
 * --------------------------------------------------------------------- */
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫', circ = k => CIRC[k] || (k + 1) + '.';
const sPar = (key, sym, name, unit, def, x) => Object.assign({ key, sym, name, unit, def }, x || {});
const SP_TH = sPar('theta', 'θ', '倾角', '°', '0', { kind: 'angle', nonneg: true, hint: '0 = 水平' }),
  SP_DIR = sPar('dir', '', '倾斜方向', '', 'up', { opts: [['up', '上坡（沿斜面向上运动）'], ['down', '下坡（沿斜面向下运动）']], hint: '倾角为 0 时无效' });
function trigP(P, approx) {
  P.rad = P.theta * Math.PI / 180; P.sin = Math.sin(P.rad); P.cos = Math.cos(P.rad);
  if (approx && Math.abs(P.theta - 37) < 1e-7) { P.sin = 0.6; P.cos = 0.8; }
  if (approx && Math.abs(P.theta - 53) < 1e-7) { P.sin = 0.8; P.cos = 0.6; }
  if (P.theta < 1e-12) { P.sin = 0; P.cos = 1; }
  return P;
}
/* 轨道类阶段的引擎参数。x：{ theta, mu, vb 带速(以前进方向为正), F 沿前进方向的力 }；下坡时物理坐标从顶端 L 走到 0 */
function trackP(L, o, x) {
  const k = o.down ? -1 : 1;
  return trigP({ model: 'belt', g: o.g, tMax: o.tMax, theta: x.theta || 0, L, m: o.m, mu1: x.mu || 0, beltA: 0, beltV0: 0, FbT: Infinity, afterLeave: 'stop',
    x0: o.down ? L : 0, v0: k * o.vin || 0, beltV: k * (x.vb || 0) || 0, Fb: k * (x.F || 0) || 0 }, o.approx);
}
function judgeTrack(sub, o, L) {
  const last = sub.events[sub.events.length - 1], lv = sub.endReason === 'leave' && last ? last.type : '';
  if (lv === (o.down ? 'leaveL' : 'leaveR')) return { ok: true, vout: Math.abs(sub.summary.vb), nSeg: sub.segs.length, dur: sub.tEnd, len: L };
  return { ok: false, len: L, why: lv ? '物体从入口端退回' : sub.endReason === 'steady' ? '物体停在本阶段内' : '超过单阶段最长时间仍未通过' };
}
const STAGE_TYPES = {
  field: { name: '加速电场', surf: '电场区',
    params: [sPar('U', 'U', '加速电压', 'V', '4000', { pos: true }), sPar('d', 'd', '极板间距（电场区长度）', 'm', '1', { pos: true }), sPar('q', 'q', '物体电荷量', 'C', '2*10^-3', { pos: true, hint: '可写 2*10^-3 或 2e-3；水平面光滑' })],
    len: v => v.d, make: (v, o) => trackP(v.d, o, { F: v.q * v.U / v.d }), judge: (sub, v, o) => judgeTrack(sub, o, v.d) },
  plane: { name: '水平面 / 斜面', surf: '接触面',
    params: [sPar('L', 'L', '长度', 'm', '2', { pos: true }), SP_TH, SP_DIR, sPar('mu', 'μ', '动摩擦因数', '', '0', { nonneg: true, hint: '0 = 光滑' })],
    len: v => v.L, make: (v, o) => trackP(v.L, o, v), judge: (sub, v, o) => judgeTrack(sub, o, v.L) },
  belt: { name: '传送带', surf: '传送带',
    params: [sPar('L', 'L', '传送带长度', 'm', '6', { pos: true }), SP_TH, SP_DIR, sPar('vb', 'v<sub>带</sub>', '传送带速度', 'm/s', '2', { hint: '正 = 与物体前进方向相同，负 = 迎面运行' }), sPar('mu', 'μ', '动摩擦因数', '', '0.2', { nonneg: true })],
    len: v => v.L, make: (v, o) => trackP(v.L, o, v), judge: (sub, v, o) => judgeTrack(sub, o, v.L) },
  hit: { name: '碰撞',
    params: [sPar('gap', 'x<sub>B</sub>', '前方物块 B 的距离', 'm', '1', { pos: true }), sPar('mB', 'm<sub>B</sub>', '物块 B 的质量', 'kg', '1', { pos: true }), sPar('vB', 'v<sub>B</sub>', 'B 的初速度', 'm/s', '0', { hint: '正 = 与前进方向相同；一般为 0' }),
      sPar('mu', 'μ', '地面动摩擦因数', '', '0', { nonneg: true }), sPar('coll', '', '碰撞类型', '', 'elastic', { opts: [['elastic', '弹性碰撞'], ['stick', '完全非弹性（粘连）'], ['e', '按恢复系数 e']] }),
      sPar('e', 'e', '恢复系数', '', '0.5', { nonneg: true, hint: '仅“按恢复系数 e”时使用' }), sPar('track', '', '碰撞后继续跟踪', '', 'B', { opts: [['B', '被撞的物块 B'], ['A', '原来的物体 A']], hint: '粘连时跟踪粘在一起的整体' })],
    len: v => v.gap,
    make: (v, o) => trigP({ model: 'duo', g: o.g, tMax: o.tMax, theta: 0, L: v.gap, m: o.m, x0: 0, v0: o.vin, mu1: v.mu, M: v.mB, xB0: v.gap, vB0: v.vB, muB: v.mu, e: v.e, collision: v.coll }, o.approx),
    judge: (sub, v, o) => {
      const c = sub.collisions[0]; if (!c) return { ok: false, len: v.gap, why: '没有追上前方物块，未发生碰撞' };
      const tr = v.coll === 'stick' ? 'AB' : v.track === 'A' ? 'A' : 'B', vout = tr === 'A' ? c.v1 : c.v2, out = { coll: c, track: tr, len: c.x };
      if (!(vout > 1e-9)) return Object.assign(out, { ok: false, why: '碰撞后被跟踪的物体没有继续向前运动' });
      return Object.assign(out, { ok: true, vout, mout: tr === 'A' ? o.m : tr === 'B' ? v.mB : o.m + v.mB, nSeg: sub.segs.findIndex(g => g.end === 'hit') + 1, dur: c.t });
    } },
  board: { name: '木板（板块）',
    params: [sPar('L', 'L', '木板长度', 'm', '3', { pos: true }), sPar('M', 'M', '木板质量', 'kg', '3', { pos: true }), sPar('mu1', 'μ<sub>1</sub>', '物体与木板动摩擦因数', '', '0.3', { nonneg: true }), sPar('mu2', 'μ<sub>2</sub>', '木板与地面动摩擦因数', '', '0', { nonneg: true })],
    len: v => v.L,
    make: (v, o) => trigP({ model: 'board', g: o.g, tMax: o.tMax, theta: 0, L: v.L, M: v.M, boardV0: 0, mu2: v.mu2, m: o.m, x0: 0, v0: o.vin, mu1: v.mu1, mu3: 0, Fb: 0, FbT: Infinity, Fc: 0, FcT: Infinity, afterLeave: 'stop' }, o.approx),
    judge: (sub, v) => {
      const last = sub.events[sub.events.length - 1], lv = sub.endReason === 'leave' && last ? last.type : '', g = sub.segs[sub.segs.length - 1];
      if (lv === 'leaveR') return { ok: true, vout: sub.summary.vb, nSeg: sub.segs.length, dur: sub.tEnd, len: g.xb1 };
      return { ok: false, len: Math.max(g.xc1, 0) + v.L, why: lv ? '物体从木板左端退回' : sub.endReason === 'steady' ? '物体与木板共速，没有滑离木板' : '超过单阶段最长时间仍未滑离木板' };
    } }
};
const CHAIN_DEMOS = [
  { name: '加速电场 → 弹性碰撞 → 传送带', stages: [['field', {}], ['hit', { gap: '1', mB: '1', coll: 'elastic', track: 'B' }], ['belt', { L: '6', vb: '2', mu: '0.2' }]],
    text: '质量 m=1 kg、电荷量 q=2×10⁻³ C 的带正电物块由静止开始，经电压 U=4000 V 的加速电场（极板间距 d=1 m，水平面光滑）加速后，在光滑水平面上滑行 1 m，与静止的等质量不带电物块 B 发生弹性正碰；碰后 B 滑上以 2 m/s 同向运行、长 6 m 的水平传送带（μ=0.2），g 取 10 m/s²。求：\n(1) 物块离开电场时的速度；\n(2) 碰后 B 的速度；\n(3) B 在传送带上运动的时间和摩擦产生的热量。', answer: '(1) 4 m/s  (2) 4 m/s  (3) 2.5 s，2 J' },
  { name: '斜面下滑 → 光滑水平面 → 木板', stages: [['plane', { L: '2', theta: '37', dir: 'down', mu: '0.25' }], ['plane', { L: '1', mu: '0' }], ['board', { L: '3', M: '3', mu1: '0.3', mu2: '0' }]],
    text: '质量 m=1 kg 的物块从倾角 37°、长 2 m 的斜面顶端由静止下滑（μ=0.25），经 1 m 长的光滑水平面后滑上静止在光滑地面上的木板（M=3 kg，长 3 m，μ₁=0.3），g 取 10 m/s²，sin37°=0.6。求物块滑上木板时的速度，以及最终与木板的共同速度。', answer: '滑上木板时 4 m/s；共同速度 1 m/s（相对木板滑行 2 m，未滑离）' },
  { name: '传送带加速 → 粘连碰撞 → 粗糙水平面', stages: [['belt', { L: '4', vb: '4', mu: '0.4' }], ['hit', { gap: '1', mB: '1', coll: 'stick' }], ['plane', { L: '5', mu: '0.2' }]],
    text: '质量 m=1 kg 的物块无初速度地放在以 4 m/s 运行、长 4 m 的水平传送带左端（μ=0.4），离开传送带后在光滑水平面上滑行 1 m，与静止的等质量物块 B 碰撞并粘在一起，随后滑上粗糙水平面（μ=0.2），g 取 10 m/s²。求碰后的共同速度和在粗糙面上滑行的距离。', answer: '共同速度 2 m/s；滑行 1 m 后停下' }
];
MODELS.combo = {
  id: 'combo', name: '例题拼合（组合轨道）', short: '拼合', carrier: '载体', noAI: true, fresh: true, presets: [],
  params: [sPar('m', 'm', '物体的初始质量', 'kg', '1', { group: '初始条件', pos: true }), sPar('v0', 'v<sub>0</sub>', '进入第 1 阶段的速度', 'm/s', '0', { group: '初始条件', nonneg: true }),
    COMMON_PARAMS[0], sPar('tMax', 't<sub>max</sub>', '单个阶段最长模拟时间', 's', '20', { group: '环境', pos: true })],
  normalize(raw, cfg) {
    const pool = App.store.configs.concat((LS.get(K_STORE, null) || {}).configs || []);
    cfg.stages = (Array.isArray(raw.stages) ? raw.stages : []).map(s => {
      if (s && STAGE_TYPES[s.type]) return newStage(s.type, s.vals);
      const src = s && (s.snap || pool.find(x => x && x.id === s.cfgId)); return src ? stageFromCfg(src) : null;   // 兼容上一版“引用配置”的拼合
    }).filter(Boolean);
  },
  /* 逐阶段模拟：把上一阶段出口的质量 m、速度 v 交给下一阶段 */
  build(cfg, P, errors) {
    const list = cfg.stages || [], approx = cfg.options.approx37 !== false, runs = P.runs = [];
    let m = P.m, vin = P.v0, alive = !Object.keys(errors).length;
    list.forEach((s, k) => {
      const T = STAGE_TYPES[s.type], v = {}, er = {};
      T.params.forEach(p => {
        const raw = String(s.vals[p.key] == null ? p.def : s.vals[p.key]).trim();
        if (p.opts) { v[p.key] = p.opts.some(x => x[0] === raw) ? raw : p.def; return; }
        try { const x = evalParam(p, raw); if (p.pos && !(x > 0)) throw new Error('必须大于 0'); if (p.nonneg && x < 0) throw new Error('不能为负'); if (p.kind === 'angle' && !(x < 90)) throw new Error('倾角需小于 90°'); v[p.key] = x; }
        catch (e) { er[p.key] = e.message; }
      });
      const r = { k, s, T, v, er, bad: Object.keys(er).length > 0 }; runs.push(r);
      if (r.bad) { if (!errors._msg) errors._msg = '阶段 ' + (k + 1) + '（' + T.name + '）的参数填写有误，请点“参数”展开修改。'; alive = false; }
      if (!alive) return;
      const o = { g: P.g, tMax: P.tMax, approx, m, vin, down: v.dir === 'down' && v.theta > 1e-9 }, Ps = T.make(v, o), sub = simulate(Ps);
      if (!sub.segs.length) { errors._msg = '阶段 ' + (k + 1) + '（' + T.name + '）：物体一进入就被送回入口，无法模拟，请调整该阶段参数。'; alive = false; return; }
      if (o.down) Ps.flip = true;
      if (s.type === 'field' || s.type === 'plane') sub.who = { a: '物', c: '面', A: '物体', C: T.surf };
      Object.assign(r, { P: Ps, sub, min: m, vin }, T.judge(sub, v, o)); if (r.mout == null) r.mout = m;
      if (r.ok) { m = r.mout; vin = r.vout; } else alive = false;
    });
    if (!list.length) errors._msg = '这是“例题拼合”配置：请在下方添加阶段，或载入一条示例组合。';
  },
  simulate(P) { return simulateChain(P); }
};
function newStage(type, vals) { const v = {}; STAGE_TYPES[type].params.forEach(p => { v[p.key] = vals && vals[p.key] != null ? String(vals[p.key]) : p.def; }); return { id: uid(), type, vals: v }; }
/* 把一份例题 / 配置转换成阶段：保留装置参数，初速度和质量改由上一阶段传入 */
function stageFromCfg(c) {
  const p = c.params || {}, str = (k, d) => (p[k] != null && String(p[k]).trim() !== '') ? String(p[k]) : d, num = (k, d) => { try { const x = Expr.eval(String(p[k])); return isFinite(x) ? x : d; } catch (e) { return d; } };
  if (c.model === 'belt') { const back = num('x0', 0) > num('L', 10) / 2;   // 原题从右端 / 顶端出发：换成“下坡”或“迎面运行”
    return newStage('belt', { L: str('L', '6'), theta: str('theta', '0'), dir: back ? 'down' : 'up', vb: back ? '-(' + str('beltV', '0') + ')' : str('beltV', '0'), mu: str('mu1', '0.2') }); }
  if (c.model === 'board') return newStage('board', { L: str('L', '3'), M: str('M', '2'), mu1: str('mu1', '0.3'), mu2: str('mu2', '0') });
  if (c.model === 'duo') { const gap = Math.abs(num('xB0', 1) - num('x0', 0)), col = (c.options || {}).collision;
    return newStage('hit', { gap: gap > 1e-9 ? nfix(gap, 6) : '1', mB: str('M', '1'), vB: str('vB0', '0'), mu: str('mu1', '0'), coll: col === 'stick' || col === 'e' ? col : 'elastic', e: str('e', '0.5'), track: 'B' }); }
  return null;
}
function loadDemo(cfg, i) {
  const d = CHAIN_DEMOS[i] || CHAIN_DEMOS[0]; cfg.stages = d.stages.map(x => newStage(x[0], x[1])); cfg.params.m = '1'; cfg.params.v0 = '0';
  cfg.name = '拼合·' + d.name; cfg.problem = { title: cfg.name, text: d.text || '', answer: d.answer || '', analysis: '' }; App.stageSel = cfg.stages[0].id;
}
/* 阶段内的局部状态 → 全局状态：时间、路程连续，速度等以前进方向为正，热量等逐段累计；原始值保留在 loc 中供绘图使用 */
function chainState(sg, s, i) {
  const n = sg.sgn; s.loc = { xb: s.xb, xc: s.xc, on: s.on, rMin: s.rMin, rMax: s.rMax };
  s.tl = s.t; s.t += sg.tOff; s.i = i; s.stage = sg.k; s.stageNo = sg.k + 1;
  s.xb = sg.S0 + n * (s.loc.xb - sg.x0loc); s.xc = sg.type === 'hit' ? sg.S0 + s.loc.xc : n * s.loc.xc || 0; s.xr = s.xb - s.xc; s.sb = s.xb; s.sc = n * s.sc || 0;
  if (n < 0) ['vb', 'ab', 'vc', 'ac', 'vr', 'fb', 'f1', 'f2', 'Fb', 'Fc', 'pb', 'pc', 'dRel'].forEach(key => { s[key] = -s[key] || 0; });
  s.Q1 += sg.pre.Q1; s.Q2 += sg.pre.Q2; s.sRel += sg.pre.sR; s.dEp += sg.pre.dEp; s.Ec = (s.Ec || 0) + sg.pre.Ec; s.Qsum = s.Q1 + s.Q2;
  return s;
}
function simulateChain(P) {
  const stages = [], segs = [], phases = [], samples = [], events = [], pre = { Q1: 0, Q2: 0, Ec: 0, sR: 0, dEp: 0 }, bb = { x0: 0, x1: 0, y0: 0, y1: 0 }, sum = { Wf: 0, WFb: 0, Wbelt: 0, resid: 0 };
  let off = 0, S0 = 0, O = [0, 0], body = [{ off: -1, col: COL.block, edge: '#a13a0a', lab: 'm' }], front = 0, nB = 0, vmax = 1e-6, mark = 0, stopAt = -1;
  P.runs.forEach((r, k) => {
    const T = r.T, v = r.v, sub = r.sub, down = v.dir === 'down' && v.theta > 1e-9, rad = (v.theta || 0) * Math.PI / 180 * (down ? -1 : 1), len = r.len == null ? T.len(v) : r.len;
    // 版面：阶段起点 O、前进方向 ux、几何长度 len、路程起点 S0；body 是“被跟踪物体”的画法（碰撞后可能换成 B 或粘连体）
    const sg = { k, type: r.s.type, T, v, vals: r.s.vals, name: T.name, reached: !!sub, ok: !!r.ok, why: r.why || '', O, ux: [Math.cos(rad), Math.sin(rad)], len, S0, tOff: off, dur: 0, dQ: 0, sgn: down ? -1 : 1,
      x0loc: sub ? sub.x0 : (down ? len : 0), sub, P: r.P, pre: Object.assign({}, pre), min: r.min, vin: r.vin, mout: r.mout, vout: r.vout, coll: r.coll, track: r.track, body, front };
    if (sg.type === 'hit') sg.bPart = { off: front, col: COL.carrier, edge: '#0b4f8a', lab: 'B' + (++nB > 1 ? nB : '') };
    stages.push(sg); O = [O[0] + len * sg.ux[0], O[1] + len * sg.ux[1]]; S0 += len;
    bb.x0 = Math.min(bb.x0, O[0]); bb.x1 = Math.max(bb.x1, O[0]); bb.y0 = Math.min(bb.y0, O[1]); bb.y1 = Math.max(bb.y1, O[1]);
    if (!sub) return;
    const list = r.ok ? sub.segs.slice(0, r.nSeg) : sub.segs, dur = r.ok ? r.dur : sub.tEnd, last = list[list.length - 1], plainT = sg.type === 'field' || sg.type === 'plane';
    const raw = (g, t) => { const s = stateInSeg(sub, g, t); return { xb: s.xb, xc: s.xc, on: s.on, rMin: s.rMin, rMax: s.rMax, Q1: s.Q1, Q2: s.Q2, sRel: s.sRel, dEp: s.dEp }; };
    sg.dur = dur; sg.loc0 = raw(list[0], list[0].t0); sg.loc1 = raw(last, last.t1); sg.dQ = sg.loc1.Q1 + sg.loc1.Q2; vmax = Math.max(vmax, sub.vmax);
    list.forEach((g, j) => {
      const cg = Object.assign({}, g, { t0: g.t0 + off, t1: g.t1 + off, i: segs.length, k, sub: g }), ph = sub.phases[j], fin = j === list.length - 1;
      let title = ph.title, lines = ph.lines, end = ph.end;
      if (plainT) { title = title.split('，传送带')[0]; lines = lines.filter(l => !/^(传送带：|物块相对|物块与)/.test(l)); end = end.replace(/传送带/g, T.surf); }
      if (down && !j) lines = ['本阶段沿斜面向下前进，下面的速度、加速度仍以沿斜面向上为正'].concat(lines);
      if (fin) end = !r.ok ? end + '（' + r.why + '，流程到此结束）'
        : (sg.type === 'hit' ? end + '；之后跟踪' + { A: '原物体 A', B: '物块 B', AB: '粘连后的整体' }[r.track] : '通过本阶段，出口速度 ' + fmt(r.vout) + ' m/s') + (P.runs[k + 1] ? ' → 进入阶段 ' + (k + 2) : '');
      phases.push({ title: '〔' + circ(k) + sg.name + '〕' + title, lines, end }); segs.push(cg); events.push({ t: cg.t1, type: g.end });
      for (let q = 0; q <= 20; q++) samples.push(chainState(sg, stateInSeg(sub, g, g.t0 + (g.t1 - g.t0) * q / 20), cg.i));
    });
    pre.Q1 += sg.loc1.Q1; pre.Q2 += sg.loc1.Q2; pre.sR += sg.loc1.sRel; pre.dEp += sg.loc1.dEp; pre.Ec += r.ok ? (r.coll ? r.coll.loss : 0) : (sub.summary.Ecoll || 0);
    if (sg.type === 'belt' || sg.type === 'board') mark += sg.loc1.rMax - sg.loc1.rMin;
    if (sg.type !== 'hit') { sum.Wf += sub.summary.Wf; sum.WFb += sub.summary.WFb; sum.Wbelt += sub.summary.Wbelt; }
    sum.resid += Math.abs(sub.summary.resid);
    if (r.ok && sg.type === 'hit') { if (r.track === 'B') body = [sg.bPart]; else if (r.track === 'AB') body = body.concat([sg.bPart]); if (r.track !== 'A') front++; }
    const nx = P.runs[k + 1];   // 阶段之间：物体的曲线连续，载体（带 / 板 / B）的曲线断开
    if (nx && nx.sub) { const br = Object.assign({}, samples[samples.length - 1]); ['vc', 'sc', 'ac', 'f2', 'Ekc', 'pc', 'dRel'].forEach(key => { br[key] = NaN; }); samples.push(br); }
    off += dur; if (!r.ok) stopAt = k;
  });
  const lastSg = stages.filter(x => x.reached).pop(), allOk = stopAt < 0, endS = samples[samples.length - 1];
  const sim = { combo: true, no3D: true, cur: 0, stages, segs, phases, samples, events, tEnd: off, endReason: allOk ? 'leave' : lastSg.sub.endReason, bbox: bb, vmaxAll: vmax, stopAt,
    names: { '物块': '物体', '@': '载体 / B', '木板': '载体 / B', '相对Δx': '相对位移', '物块受f': '物体受f', '地面对板f': '地面对载体f', 'Q(物块-@)': 'Q(物体)', 'Q(地面)': 'Q(其他)', 'Ek物': 'Ek物体', 'Ek板': 'Ek载体', 'Q总': 'Q+ΔE碰' },
    render2D: renderChain, resultRows: chainRows, checks: chainChecks, solution: chainSolution };
  sim.stateInSeg = (g, t) => { const sg = stages[g.k]; sim.cur = g.k; return chainState(sg, stateInSeg(sg.sub, g.sub, t - sg.tOff), g.i); };
  sim.infoBox = st => chainBox(sim, st); sim.digest = () => chainDigest(sim);
  // 与“当前阶段”有关的属性（P、isBelt、duo…）：随时间自动指向所在阶段的子模拟，通用面板因此无需改动
  ['P', 'isBelt', 'duo', 'boat', 'who', 'x0', 'vc0', 'xr0', 'xc00', 'aLeft', 'collisions', 'meets', 'vmax', 'xmin', 'xmax'].forEach(key => Object.defineProperty(sim, key, { get() { return stages[sim.cur].sub[key]; } }));
  const S = { tEnd: allOk || lastSg.sub.endReason !== 'steady' ? off : lastSg.tOff + lastSg.sub.summary.tEnd, tSim: off, xb: endS.sb, xc: 0, vb: allOk ? lastSg.vout : endS.vb, vc: 0, dRel: 0, sRel: pre.sR, mark,
    Q1: pre.Q1, Q2: pre.Q2, Wf: sum.Wf, WFb: sum.WFb, WFc: 0, Wbelt: sum.Wbelt, tCommon: null, tLeave: null, dEkb: 0, dEkc: 0, dEpb: 0, dEpc: 0, Ecoll: pre.Ec, resid: sum.resid };
  sim.summary = S;
  sim.tiles = [['总时间', fmt(S.tEnd) + ' s'], ['完成阶段', stages.filter(x => x.ok).length + ' / ' + stages.length], ['最终速度', fmt(S.vb) + ' m/s'], ['摩擦生热合计', fmt(S.Q1 + S.Q2) + ' J']];
  return sim;
}
function chainRows(sim) {
  const S = sim.summary, stop = sim.stopAt >= 0 ? sim.stages[sim.stopAt] : null, R = [];
  R.push(['流程', stop ? '在阶段 ' + (stop.k + 1) + '（' + stop.name + '）结束：' + stop.why : '全部 ' + sim.stages.length + ' 个阶段依次通过']);
  R.push(['总时间', fmt(S.tEnd) + ' s'], ['总路程', fmt(S.xb) + ' m'], ['最终速度', fmt(S.vb) + ' m/s'], ['摩擦生热合计', fmt(S.Q1 + S.Q2) + ' J']);
  if (sim.stages.some(x => x.type === 'hit')) R.push(['碰撞损失机械能合计', fmt(S.Ecoll) + ' J']);
  sim.stages.forEach(sg => {
    R.push([circ(sg.k) + ' ' + sg.name, sg.reached ? 't = ' + fmt(sg.tOff) + ' s 进入' : '未到达']); if (!sg.reached) return;
    R.push(['　入口：速度 / 质量', fmt(sg.vin) + ' m/s / ' + fmt(sg.min) + ' kg']);
    R.push(sg.ok ? ['　出口：速度 / 质量', fmt(sg.vout) + ' m/s / ' + fmt(sg.mout) + ' kg'] : ['　结果', sg.why]);
    R.push(['　用时 / 摩擦生热', fmt(sg.dur) + ' s / ' + fmt(sg.dQ) + ' J']);
  });
  R.push(['能量守恒残差合计', S.resid.toExponential(1) + ' J']); return R;
}
function chainChecks(inp, sim) {
  const out = [], st = sim.stages, fixT = (sg, t) => sg.type === 'field' || sg.type === 'plane' ? String(t).replace(/传送带/g, sg.T.surf) : t; let gap = 0;
  st.forEach((sg, k) => { const nx = st[k + 1]; if (sg.ok && nx && nx.reached) gap = Math.max(gap, Math.abs(nx.vin - sg.vout), Math.abs(nx.min - sg.mout)); });
  out.push({ status: gap < 1e-9 ? 'pass' : 'fail', item: '阶段衔接：上一阶段出口的速度、质量 = 下一阶段入口', detail: st.filter(x => x.reached).map(sg => circ(sg.k) + ' v ' + nfix(sg.vin, 3) + ' → ' + (sg.ok ? nfix(sg.vout, 3) : '✗') + ' m/s').join('；') });
  if (sim.stopAt >= 0 && sim.stopAt < st.length - 1) out.push({ status: 'warn', item: '流程没有走完', detail: '在阶段 ' + (sim.stopAt + 1) + '（' + st[sim.stopAt].name + '）结束：' + st[sim.stopAt].why + '；后面 ' + (st.length - 1 - sim.stopAt) + ' 个阶段没有进行。' });
  st.forEach(sg => {
    if (!sg.reached) return; const list = sg.type === 'hit' ? duoChecks({ P: sg.P }, sg.sub) : localChecks({ P: sg.P }, sg.sub), np = list.filter(x => x.status !== 'pass');
    out.push({ status: np.some(x => x.status === 'fail') ? 'fail' : 'pass', item: circ(sg.k) + ' ' + sg.name + '：摩擦约束、牛顿定律、能量守恒等 ' + (list.length - np.length) + ' / ' + list.length + ' 项通过', detail: '入口 v = ' + nfix(sg.vin, 3) + ' m/s，m = ' + nfix(sg.min, 3) + ' kg' + (sg.ok ? '；出口 v = ' + nfix(sg.vout, 3) + ' m/s' : '；' + sg.why) });
    np.forEach(x => out.push({ status: x.status, item: circ(sg.k) + ' ' + fixT(sg, x.item), detail: fixT(sg, x.detail) }));
  });
  return out;
}
function chainSolution(sim) {
  const steps = [], who = { A: '原物体 A', B: '物块 B', AB: '粘在一起的整体' };
  steps.push({ title: '组合轨道：各阶段的衔接', items: [{ tag: '思路', tex: '同一物体依次通过各阶段；上一阶段出口的速度（和质量）就是下一阶段的入口条件，逐段求解。速度以前进方向为正。' }]
    .concat(sim.stages.map(sg => ({ tag: circ(sg.k) + sg.name, tex: !sg.reached ? '未到达' : '入口 $v = ' + fx(sg.vin) + '$ m/s，$m = ' + fx(sg.min) + '$ kg ⇒ ' + (sg.ok ? '出口 $v = #' + fx(sg.vout) + '#$ m/s' + (sg.mout !== sg.min ? '，$m = #' + fx(sg.mout) + '#$ kg' : '') : sg.why) }))) });
  sim.stages.forEach(sg => {
    if (!sg.reached) return; const head = '〔' + circ(sg.k) + sg.name + '〕', v = sg.v, m = sg.min, plainT = sg.type === 'field' || sg.type === 'plane', fixS = t => plainT ? String(t).replace(/传送带/g, sg.T.surf) : t;
    if (sg.type === 'field') { const F = v.q * v.U / v.d;
      steps.push({ title: head + '带电物体在电场中加速', items: [
        { tag: '电场力', tex: '$F = qE = {qU}//{d} = {' + fx(v.q * v.U) + '}//{' + fx(v.d) + '} = #' + fx(F) + '#$ N' },
        { tag: '加速度', tex: '$a = {F}//{m} = {' + fx(F) + '}//{' + fx(m) + '} = #' + fx(F / m) + '#$ m/s²' },
        { tag: '动能定理', tex: '$qU = ½mv^2 − ½mv_{0}^2$ ⇒ $v = #' + fx(sg.vout) + '#$ m/s' },
        { tag: '用时', tex: '$t = {v − v_{0}}//{a} = #' + fx(sg.dur) + '#$ s' }] }); return; }
    if (sg.type === 'hit') { const c = sg.coll, I = [{ tag: '靠近', tex: '物体 A 以 $v = ' + fx(sg.vin) + '$ m/s 运动' + (v.mu > 0 ? '（地面 $μ = ' + fx(v.mu) + '$）' : '') + '，物块 B 在前方 ' + fx(v.gap) + ' m 处' }];
      if (!c) I.push({ tag: '结果', tex: sg.why });
      else {
        I.push({ tag: '相碰', tex: '经 $t = #' + fx(c.t) + '#$ s 相碰，碰前 $v_1 = ' + fx(c.u1) + '$ m/s，$v_2 = ' + fx(c.u2) + '$ m/s' });
        I.push({ tag: '动量守恒', tex: '$m_{A}v_1 + m_{B}v_2 = m_{A}v_1′ + m_{B}v_2′$' });
        I.push(v.coll === 'elastic' ? { tag: '机械能守恒', tex: '$½m_{A}v_1^2 + ½m_{B}v_2^2 = ½m_{A}v_1′^2 + ½m_{B}v_2′^2$' } : v.coll === 'stick' ? { tag: '碰后共速', tex: '$v_1′ = v_2′ = {m_{A}v_1 + m_{B}v_2}//{m_A + m_B}$' } : { tag: '恢复系数', tex: '$v_2′ − v_1′ = e(v_1 − v_2)$，其中 $e = ' + fx(c.e) + '$' });
        I.push({ tag: '解得', tex: '$v_1′ = #' + fx(c.v1) + '#$ m/s，$v_2′ = #' + fx(c.v2) + '#$ m/s；损失机械能 $ΔE = #' + fx(c.loss) + '#$ J' });
        I.push({ tag: '衔接', tex: sg.ok ? '之后跟踪' + who[sg.track] + '：$v = #' + fx(sg.vout) + '#$ m/s，$m = #' + fx(sg.mout) + '#$ kg' : sg.why });
      }
      steps.push({ title: head + '碰撞', items: I }); return; }
    solutionSteps(sg.sub).forEach((s, n) => {
      let items = s.items.filter(it => !(plainT && (it.tag === '传送带' || it.tag === '能量守恒'))).map(it => ({ tag: it.tag, tex: fixS(it.tex) }));
      if (!n && sg.sgn < 0) items = [{ tag: '说明', tex: '本阶段沿斜面向下前进；下列各式仍以沿斜面向上为正，所以速度、位移为负。' }].concat(items);
      steps.push({ title: head + fixS(s.title), items });
    });
  });
  return steps;
}
function chainDigest(sim) {
  const r = x => (x == null || !isFinite(x)) ? null : +(+x).toFixed(4), S = sim.summary;
  return { 模型: '例题拼合（组合轨道）：同一物体依次通过各阶段，上一阶段出口的速度、质量是下一阶段的入口条件；速度以前进方向为正', 总时间: r(S.tEnd), 最终速度: r(S.vb), 摩擦生热合计: r(S.Q1 + S.Q2), 碰撞损失机械能: r(S.Ecoll),
    阶段: sim.stages.map(sg => ({ 序号: sg.k + 1, 类型: sg.name, 参数: sg.vals, 状态: !sg.reached ? '未到达' : sg.ok ? '通过' : sg.why, 进入时刻: r(sg.tOff), 入口速度: r(sg.vin), 入口质量: r(sg.min), 出口速度: r(sg.vout), 出口质量: sg.ok ? r(sg.mout) : null, 用时: r(sg.dur), 摩擦生热: r(sg.dQ),
      碰撞: sg.coll ? { 时刻: r(sg.tOff + sg.coll.t), A碰前: r(sg.coll.u1), B碰前: r(sg.coll.u2), A碰后: r(sg.coll.v1), B碰后: r(sg.coll.v2), 机械能损失: r(sg.coll.loss), 之后跟踪: sg.track } : undefined,
      过程: sim.segs.filter(g => g.k === sg.k).map(g => ({ 时间段: [r(g.t0), r(g.t1)], 概述: sim.phases[g.i].title, a: r(g.ab * sg.sgn), v始: r(g.vb0 * sg.sgn), v末: r(g.vb1 * sg.sgn), 结束: sim.phases[g.i].end })) })) };
}
function chainBox(sim, st) {
  return '<b>数据关联</b>（同一物体依次通过）' + sim.stages.map(sg => '<br>' + (sg.k === st.stage ? '▶ ' : '　') + circ(sg.k) + ' ' + sg.name + '：' + (!sg.reached ? '未到达'
    : 'v ' + nfix(sg.vin, 3) + ' → ' + (sg.ok ? nfix(sg.vout, 3) : '✗') + ' m/s' + (sg.ok && sg.mout !== sg.min ? '，m ' + nfix(sg.min, 3) + ' → ' + nfix(sg.mout, 3) + ' kg' : ''))).join('') +
    '<br>此刻：路程 <b>' + nfix(st.sb, 3) + ' m</b>，速度 <b>' + nfix(st.vb, 3) + ' m/s</b><br>累计摩擦生热 <b>' + nfix(st.Qsum, 3) + ' J</b>，碰撞损失 <b>' + nfix(st.Ec, 3) + ' J</b>';
}
/* 组合轨道的画面：所有阶段按顺序画在同一张图上；已通过的阶段停在结束状态，未到的阶段保持初始状态 */
function renderChain(ctx, W, H, sim, st, o) {
  const vw = o.view || {}, small = W < 480, bb = sim.bbox, stages = sim.stages, cur = stages[st.stage], bs = small ? 20 : 28, R = small ? 7 : 10, hB = small ? 9 : 12;
  const padX = small ? 30 : 60, padT = H * 0.36, padB = H * 0.22, prog = (sg, x) => sg.sgn * (x - sg.x0loc), curP = prog(cur, st.loc.xb);
  const s = (vw.zoom || 1) * Math.min((W - 2 * padX) / Math.max(bb.x1 - bb.x0, 1e-6), (H - padT - padB) / Math.max(bb.y1 - bb.y0, 1e-6));
  const mx = vw.follow ? cur.O[0] + curP * cur.ux[0] : (bb.x0 + bb.x1) / 2, my = vw.follow ? cur.O[1] + curP * cur.ux[1] : (bb.y0 + bb.y1) / 2, cx = W / 2 + (vw.x || 0), cy = padT + (H - padT - padB) / 2 + (vw.y || 0);
  // 阶段 sg 上：前进量 p（米）、离开接触面的高度 h（像素）、沿前进方向的偏移 dp（像素）→ 屏幕坐标
  const pt = (sg, p, h, dp) => { const c = sg.ux[0], n = sg.ux[1]; h = h || 0; dp = dp || 0; return [cx + (sg.O[0] + p * c - mx) * s + dp * c - h * n, cy - (sg.O[1] + p * n - my) * s - dp * n - h * c]; };
  const path = pts => { ctx.beginPath(); pts.forEach((q, i) => { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); };
  const line = (a, b, col, w, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w || 1; ctx.setLineDash(dash || []); path([a, b]); ctx.stroke(); ctx.setLineDash([]); };
  const paint = (f, e, w) => { ctx.closePath(); if (f) { ctx.fillStyle = f; ctx.fill(); } if (e) { ctx.strokeStyle = e; ctx.lineWidth = w || 1.5; ctx.stroke(); } };
  const quad = (sg, p0, p1, h0, h1, d0, d1) => path([pt(sg, p0, h0, d0), pt(sg, p1, h0, d1), pt(sg, p1, h1, d1), pt(sg, p0, h1, d0)]);
  const block = (sg, p, part, alpha) => {
    ctx.globalAlpha = alpha == null ? 1 : alpha; quad(sg, p, p, 0, bs, part.off * bs, (part.off + 1) * bs); paint(part.col, part.edge);
    const q = pt(sg, p, bs / 2, (part.off + 0.5) * bs); ctx.font = 'italic 600 12px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(part.lab, q[0], q[1]); ctx.globalAlpha = 1;
  };
  ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(70,90,130,.07)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0.5; x < W; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = 0.5; y < H; y += 20) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
  stages.forEach(sg => {
    const k = sg.k, T = sg.type, len = sg.len, act = k === st.stage, ls = act ? st.loc : !sg.reached ? null : k < st.stage ? sg.loc1 : sg.loc0, gh = T === 'board' ? -hB : 0, low = T === 'belt' ? -2 * R : gh - 7;
    line(pt(sg, 0, low - 22), pt(sg, 0, bs + 40), '#cfc6b2', 1, [4, 4]);   // 阶段分界线
    if (T === 'belt') {
      quad(sg, 0, len, -2 * R, 0); paint('#e9ecf2', '#7d869b', 2.5);
      const stp = niceStep(Math.max(len, 1e-6), 10), o0 = (((ls ? ls.xc : 0) % stp) + stp) % stp;
      for (let x = o0, n = 0; x <= len + 1e-9 && n < 200; x += stp, n++) line(pt(sg, prog(sg, x), 0), pt(sg, prog(sg, x), -5), '#7d869b', 1.5);
      for (const e of [0, 1]) { const c = pt(sg, e ? len : 0, -R, e ? -R : R); ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(R - 3, 2), 0, 6.3); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#4b556b'; ctx.lineWidth = 1.5; ctx.stroke(); }
    } else {
      quad(sg, 0, len, gh - 7, gh); paint('#ebe4d4'); line(pt(sg, 0, gh), pt(sg, len, gh), '#4b556b', 2);
      if (T === 'board') {   // 木板嵌在凹槽里，板面与前后轨道齐平
        line(pt(sg, 0, gh), pt(sg, 0, 0), '#4b556b', 2); line(pt(sg, len, gh), pt(sg, len, 0), '#4b556b', 2);
        const xl = ls ? ls.xc : 0, q = pt(sg, xl + sg.v.L / 2, -hB / 2); quad(sg, xl, xl + sg.v.L, -hB, 0); paint('#dfb97f', '#8a5a22'); sText(ctx, 'M', q[0], q[1], '#5b3a12', 'italic 600 11px ' + FONT);
      }
      if (T === 'field') {
        const top = bs + 36, a = pt(sg, 0, top + 9), b = pt(sg, len, top + 9), e0 = pt(sg, len * 0.14, top - 8), e1 = pt(sg, len * 0.86, top - 8), mq = pt(sg, len / 2, top - 18);
        quad(sg, 0, len, 0, top); paint('rgba(112,72,232,.07)'); line(pt(sg, 0, 0), pt(sg, 0, top), '#7048e8', 3); line(pt(sg, len, 0), pt(sg, len, top), '#7048e8', 3);
        sText(ctx, '+', a[0], a[1], '#7048e8', '700 14px ' + FONT); sText(ctx, '−', b[0], b[1], '#7048e8', '700 14px ' + FONT);
        ctx.globalAlpha = 0.5; sArrow(ctx, e0[0], e0[1], e1[0], e1[1], '#7048e8', 1.2); ctx.globalAlpha = 1; sText(ctx, 'E', mq[0], mq[1], '#7048e8', 'italic 600 11px ' + FONT);
      }
    }
    if (ls && (T === 'belt' || T === 'board') && ls.rMax - ls.rMin > 1e-6) {   // 痕迹
      let a = ls.rMin + ls.xc, z = ls.rMax + ls.xc; if (T === 'belt') { a = clamp(a, 0, len); z = clamp(z, 0, len); }
      if (z - a > 1e-9) line(pt(sg, prog(sg, a), 1), pt(sg, prog(sg, z), 1), 'rgba(15,15,20,.9)', 4.5);
    }
    if (T === 'hit') {
      if (!sg.ok || k >= st.stage) block(sg, ls ? ls.xc : sg.v.gap, sg.bPart);   // 碰前：B 在自己的位置
      else {   // 碰后不再跟踪的那个物体：按碰后速度滑走并淡出（静止的留在原地）
        const c = sg.coll, dt = st.t - (sg.tOff + sg.dur), left = sg.track === 'B' ? { v: c.v1, parts: sg.body } : sg.track === 'A' ? { v: c.v2, parts: [sg.bPart] } : null;
        if (left) { const al = Math.abs(left.v) < 1e-9 ? 0.45 : clamp(0.6 * (1 - dt / 1.5), 0, 0.6); if (al > 0.02) left.parts.forEach(pp => block(sg, c.x + left.v * dt, pp, al)); }
      }
    }
    const lq = pt(sg, len / 2, low - 13);
    sText(ctx, circ(k) + (len * s > 64 ? ' ' + sg.name : ''), lq[0], lq[1], act ? '#a61e1e' : '#566078', (act ? '700 ' : '600 ') + '11px ' + FONT);
    if (sg.reached && k <= st.stage) { const q = pt(sg, 0, bs + 50); sText(ctx, 'v=' + nfix(sg.vin, 2), q[0], q[1], '#566078', '10px ' + FONT); }   // 入口速度：随进度逐段显示
  });
  if (cur.ok && st.t >= sim.tEnd - 1e-9) { const q = pt(cur, cur.len, bs + 50); sText(ctx, 'v=' + nfix(cur.vout, 2), q[0], q[1], '#566078', '10px ' + FONT); }
  // 红旗：地面旗按全程路程定位，可跨阶段；载体旗只在本阶段的传送带 / 木板上显示
  const cnt = { ground: 0, carrier: 0 };
  (o.flags || []).forEach(f => {
    const n = ++cnt[f.anchor], g = f.anchor === 'ground'; if (f.t > st.t + 1e-9) return;
    const fs = peekState(sim, f.t); if (!g && (fs.stage !== st.stage || (cur.type !== 'belt' && cur.type !== 'board'))) return;
    const G = g ? fs.xb : fs.xr + st.xc; if (!g && cur.type === 'belt' && (G < cur.S0 - 1e-9 || G > cur.S0 + cur.len + 1e-9)) return;
    let sg = stages[0]; for (const x of stages) if (G >= x.S0 - 1e-9) sg = x;
    const p = G - sg.S0, hh = g ? bs + 44 : bs + 20, d = g ? 1 : -1, b = pt(sg, p, hh), q = pt(sg, p, hh - 6, d * 20);
    line(pt(sg, p, 0), b, g ? '#6b7280' : '#4a3520', 2); path([b, pt(sg, p, hh - 6, d * 15), pt(sg, p, hh - 12)]); paint(COL.flag);
    sText(ctx, (g ? '地' : '载') + n, q[0], q[1], '#a61e1e', '600 11px ' + FONT, g ? 'left' : 'right');
  });
  cur.body.forEach(pp => block(cur, curP, pp));   // 被跟踪的物体
  const offs = cur.body.map(pp => pp.off), fr = (Math.max.apply(null, offs) + 1) * bs, bk = Math.min.apply(null, offs) * bs, mid = (fr + bk) / 2;
  if (o.showVec !== false) {
    const kv = (small ? 40 : 60) / sim.vmaxAll, va = v => Math.sign(v) * Math.max(14, Math.abs(v) * kv);
    const arr = (sg, p, h, d0, v, col, lab) => { const d = Math.sign(v), a = pt(sg, p, h, d0), b = pt(sg, p, h, d0 + va(v)), t = pt(sg, p, h, d0 + va(v) + d * 5); sArrow(ctx, a[0], a[1], b[0], b[1], col, 2); sText(ctx, lab + nfix(v, 2), t[0], t[1], col, '11px ' + FONT, d * sg.ux[0] > 0 ? 'left' : 'right'); };
    if (Math.abs(st.vb) > 1e-6) arr(cur, curP, bs * 0.62, st.vb > 0 ? fr : bk, st.vb, '#c2410c', 'v=');
    if (Math.abs(st.vc) > 1e-6) {
      if (cur.type === 'belt') arr(cur, cur.len / 2, -R, -va(st.vc) / 2, st.vc, COL.carrier, 'v带=');
      else if (cur.type === 'board') arr(cur, st.loc.xc + (st.vc > 0 ? cur.v.L : 0), -hB / 2, 0, st.vc, COL.carrier, 'v板=');
      else if (cur.type === 'hit') arr(cur, st.loc.xc, bs * 0.38, (cur.bPart.off + (st.vc > 0 ? 1 : 0)) * bs, st.vc, COL.carrier, 'vB=');
    }
  }
  if (o.forces) {
    const Pc = cur.P, G = Pc.m * Pc.g, kf = (small ? 38 : 54) / Math.max(G, Math.abs(st.fb), Math.abs(st.Fb), Math.abs(Pc.m * st.ab), 1e-9), c0 = pt(cur, curP, bs / 2, mid), fwd = [cur.ux[0], -cur.ux[1]], nrm = [-cur.ux[1], -cur.ux[0]];
    const vec = (a, d, L, col, lab, dash) => { if (Math.abs(L) < 3) return; const e = [a[0] + d[0] * L, a[1] + d[1] * L], sg2 = Math.sign(L); sArrow(ctx, a[0], a[1], e[0], e[1], col, 2.2, dash); sText(ctx, lab, e[0] + d[0] * sg2 * 11, e[1] + d[1] * sg2 * 11, col, '600 11px ' + FONT); };
    vec(c0, [0, 1], G * kf, '#2f3b52', 'G'); vec(c0, nrm, G * Pc.cos * kf, '#0b7285', 'N'); vec(pt(cur, curP, 3, mid), fwd, st.fb * kf, '#9c36b5', 'f'); vec(c0, fwd, st.Fb * kf, '#d9480f', cur.type === 'field' ? 'F电' : 'F');
    if (Math.abs(st.ab) > 1e-9) { vec(pt(cur, curP, bs + 10, mid), fwd, Pc.m * st.ab * kf, '#c92a2a', 'F合', true); vec(pt(cur, curP, bs + 24, mid), fwd, Math.sign(st.ab) * clamp(Math.abs(st.ab) * 7, 16, 64), '#1f7a36', 'a'); }
  }
  sHUD(ctx, W, H, sim, st, o.mode === '3d' ? '组合轨道暂只提供 2D 视图' : '前进方向 →');
}
/* 左侧的阶段编辑器：结构只在增删 / 排序 / 展开时重建，输入过程中只刷新状态与提示（不打断输入） */
function renderCombo() {
  const cfg = App.cfg, el = $('#comboBox'); $('#paramCard').dataset.model = cfg.model;
  if (cfg.model !== 'combo') { if (el.dataset.sig) { el.innerHTML = ''; el.dataset.sig = ''; } return; }
  const list = cfg.stages || (cfg.stages = []), sig = [cfg.id, App.stageSel, App.store.configs.length].concat(list.map(s => s.id + s.type)).join('|');
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    const mine = App.store.configs.filter(x => x.model === 'belt' || x.model === 'board' || x.model === 'duo');
    el.innerHTML = '<p class="note" style="margin:0 0 10px">把例题当作“阶段”首尾相接成一条轨道：<b>同一个物体</b>依次通过，上一阶段出口的速度、质量自动成为下一阶段的入口条件，全部画在同一张图上。速度以前进方向为正。</p>' +
      list.map((s, k) => {
        const T = STAGE_TYPES[s.type], open = s.id === App.stageSel;
        return '<div class="stg' + (open ? ' sel' : '') + '" data-k="' + k + '"><b class="ph-n">' + (k + 1) + '</b><div style="min-width:0"><div class="stg-name">' + T.name + '<span class="stg-st"></span></div><div class="stg-io"></div></div>' +
          '<div class="stg-act"><button class="btn mini' + (open ? '' : ' pri') + '" data-do="edit">' + (open ? '收起' : '参数') + '</button><button class="btn mini" data-do="up"' + (k ? '' : ' disabled') + '>上移</button><button class="btn mini" data-do="down"' + (k < list.length - 1 ? '' : ' disabled') + '>下移</button><button class="btn mini" data-do="del">移除</button></div>' +
          (open ? '<div class="stg-form">' + T.params.map(p => '<div class="prow"><label><i class="sym">' + p.sym + '</i>' + p.name + '</label>' +
            (p.opts ? '<select data-sk="' + p.key + '" aria-label="' + p.name + '">' + p.opts.map(x => '<option value="' + x[0] + '"' + (s.vals[p.key] === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select>'
              : '<div class="pin"><input type="text" data-sk="' + p.key + '" aria-label="' + p.name + '" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(s.vals[p.key] == null ? p.def : s.vals[p.key]) + '"><span class="unit">' + (p.unit || '') + '</span></div>') +
            '<div class="phint" data-sh="' + p.key + '"></div></div>').join('') + '</div>' : '') + '</div>';
      }).join('') +
      '<label class="fld"><span>添加阶段</span><select id="stgAdd"><optgroup label="基本阶段">' + Object.keys(STAGE_TYPES).map(t => '<option value="t:' + t + '">' + STAGE_TYPES[t].name + '</option>').join('') + '</optgroup>' +
      ['belt', 'board', 'duo'].map(id => '<optgroup label="导入内置例题 · ' + MODELS[id].short + '">' + MODELS[id].presets.map((p, i) => '<option value="p:' + id + ':' + i + '">' + esc(p.name) + '</option>').join('') + '</optgroup>').join('') +
      (mine.length ? '<optgroup label="导入我的配置">' + mine.map(x => '<option value="c:' + x.id + '">' + esc(x.name) + '</option>').join('') + '</optgroup>' : '') +
      '<optgroup label="整条示例组合（替换全部阶段）">' + CHAIN_DEMOS.map((d, i) => '<option value="d:' + i + '">' + d.name + '</option>').join('') + '</optgroup></select></label>' +
      '<div class="row"><button class="btn pri" data-do="add">＋ 添加 / 载入</button></div>';
  }
  const runs = (App.inp && App.inp.P.runs) || [];
  list.forEach((s, k) => {
    const row = el.querySelector('.stg[data-k="' + k + '"]'), r = runs[k]; if (!row) return;
    const b = !r ? ['', ''] : r.bad ? ['bad', '参数有误'] : !r.sub ? ['', '未到达'] : r.ok ? ['ok', '通过'] : ['warn', '到此结束'];
    row.querySelector('.stg-st').innerHTML = b[1] ? '<span class="badge ' + b[0] + '">' + b[1] + '</span>' : '';
    row.querySelector('.stg-io').innerHTML = r && r.sub ? mathText('v ' + fmt(r.vin) + ' → ' + (r.ok ? fmt(r.vout) + ' m/s' + (r.mout !== r.min ? '，m ' + fmt(r.min) + ' → ' + fmt(r.mout) + ' kg' : '') + '，用时 ' + fmt(r.dur) + ' s' : '✗ ' + r.why)) : '';
    row.classList.toggle('bad', !!(r && r.bad));
    STAGE_TYPES[s.type].params.forEach(p => { const h = row.querySelector('[data-sh="' + p.key + '"]'); if (!h) return; const er = r && r.er[p.key]; h.textContent = er || p.hint || ''; h.parentNode.classList.toggle('err', !!er); });
  });
}
function bindChain() {
  const box = $('#comboBox');
  $('#btnCombo').addEventListener('click', () => {
    showView('sim');
    if (App.cfg.model === 'combo') { toast('当前已是拼合配置：在左侧添加、排序、调整阶段即可'); return; }
    const n = newConfig('combo'); loadDemo(n, 0); addConfig(n);
    if (window.matchMedia && window.matchMedia('(max-width:820px)').matches) $('#mTabs button[data-m="param"]').click();
    toast('已新建拼合配置（示例：加速电场 → 碰撞 → 传送带），可在左侧增删、排序、改参数', 'ok');
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-do]'); if (!b || App.cfg.model !== 'combo') return;
    const list = App.cfg.stages, row = b.closest('.stg'), k = row ? +row.dataset.k : -1, act = b.dataset.do;
    if (act === 'edit') { App.stageSel = App.stageSel === list[k].id ? null : list[k].id; renderCombo(); return; }
    if (act === 'add') {
      const val = $('#stgAdd').value, a = val.split(':'); let ns = null;
      if (a[0] === 'd') { loadDemo(App.cfg, +a[1]); renderCfgSel(); renderModelUI(); recompute(); toast('已载入示例组合', 'ok'); return; }
      if (a[0] === 't') ns = newStage(a[1]);
      else if (a[0] === 'p') ns = stageFromCfg(newConfig(a[1], MODELS[a[1]].presets[+a[2]]));
      else { const src = App.store.configs.find(x => x.id === val.slice(2)); ns = src ? stageFromCfg(src) : null; }
      if (!ns) { toast('这份配置无法作为阶段导入', 'bad'); return; }
      list.push(ns); App.stageSel = ns.id; if (a[0] !== 't') toast('已导入为阶段：保留装置参数，初速度和质量改由上一阶段传入', 'ok');
    } else if (act === 'del') list.splice(k, 1);
    else if (act === 'up' && k > 0) list.splice(k - 1, 0, list.splice(k, 1)[0]);
    else if (act === 'down' && k >= 0 && k < list.length - 1) list.splice(k + 1, 0, list.splice(k, 1)[0]);
    recompute();
  });
  box.addEventListener('input', e => {
    const inp = e.target.closest('[data-sk]'), row = inp && inp.closest('.stg'); if (!row || App.cfg.model !== 'combo') return;
    const s = App.cfg.stages[+row.dataset.k]; if (!s) return; s.vals[inp.dataset.sk] = inp.value;
    if (inp.tagName === 'SELECT') recompute(); else scheduleRecompute();
  });
  box.addEventListener('focusin', e => { if (e.target.tagName === 'INPUT' && e.target.dataset.sk) App.lastInput = e.target; });
}

/* —— 视图：缩放 / 平移 / 旋转 / 全屏 —— */
function zoomAt(f, px, py) {   // 以画面上的 (px, py) 为中心缩放
  const v = App.view, r = $('#scene').getBoundingClientRect(), z1 = clamp(v.zoom * f, 0.25, 16), k = z1 / v.zoom, ax = r.width / 2, ay = r.height * 0.6;
  v.x = (px - ax) * (1 - k) + k * v.x; v.y = (py - ay) * (1 - k) + k * v.y; v.zoom = z1; App.dirty = true;
}
function syncViewUI() {
  const fs = $('#stageCard').classList.contains('fs');
  $$('#dimSeg button').forEach(b => b.classList.toggle('on', (b.dataset.d === '3') === App.mode3d));
  $('#btnDrag').hidden = !App.mode3d; $('#btnDrag').textContent = App.view.drag === 'pan' ? '拖动：平移' : '拖动：旋转';
  $('#btnFollow').classList.toggle('on', !!App.view.follow); $('#btnFS').textContent = fs ? '退出全屏' : '全屏'; $('#btnFS').classList.toggle('on', fs);
  $('#scene').classList.toggle('free', App.mode3d || fs);
}
function toggleFS(on) {
  const card = $('#stageCard'), de = document.documentElement, cur = document.fullscreenElement || document.webkitFullscreenElement;
  on = on == null ? !card.classList.contains('fs') : !!on;
  card.classList.toggle('fs', on); document.body.classList.toggle('fs-lock', on);
  try {   // 画面铺满由样式完成；浏览器全屏只是去掉地址栏等，不支持时也不影响使用
    if (on && !cur) { const rq = de.requestFullscreen || de.webkitRequestFullscreen; if (rq) { const p = rq.call(de); if (p && p.catch) p.catch(() => {}); } }
    if (!on && cur) { const ex = document.exitFullscreen || document.webkitExitFullscreen; if (ex) { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } }
  } catch (e) { /* 忽略 */ }
  syncViewUI(); App.dirty = true; setTimeout(() => { App.dirty = true; }, 120); setTimeout(() => { App.dirty = true; }, 450);
}
function bindV4() {
  const cv = $('#scene'), pref = LS.get('pbsim.view.v1', null) || {};
  App.mode3d = !!pref.mode3d;
  $('#dimSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-d]'); if (!b) return; const was = App.mode3d;
    App.mode3d = b.dataset.d === '3'; LS.set('pbsim.view.v1', { mode3d: App.mode3d }); syncViewUI(); App.dirty = true;
    if (App.mode3d && !was) toast('3D 视图：拖动旋转，滚轮 / 双指缩放，Shift 或右键拖动平移');
  });
  $('#vTools').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return; const v = App.view, r = cv.getBoundingClientRect(), a = b.dataset.v;
    if (a === 'fs') { toggleFS(); return; }
    if (a === 'in') zoomAt(1.25, r.width / 2, r.height * 0.6); else if (a === 'out') zoomAt(0.8, r.width / 2, r.height * 0.6);
    else if (a === 'fit') Object.assign(v, { zoom: 1, x: 0, y: 0, follow: false });
    else if (a === 'follow') { v.follow = !v.follow; if (v.follow) { v.x = 0; v.y = 0; } }
    else if (a === 'drag') v.drag = v.drag === 'pan' ? 'rotate' : 'pan';
    syncViewUI(); App.dirty = true;
  });
  // 拖动：2D 平移；3D 旋转（Shift / 右键 / “拖动：平移”时为平移）；双指缩放并平移
  const pts = new Map(); let pinch = 0;
  cv.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = 0; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } });
  cv.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y, v = App.view; p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2) {
      const a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), r = cv.getBoundingClientRect();
      if (pinch > 0 && d > 0) zoomAt(d / pinch, (a[0].x + a[1].x) / 2 - r.left, (a[0].y + a[1].y) / 2 - r.top);
      pinch = d; v.x += dx / 2; v.y += dy / 2;
    } else if (App.mode3d && v.drag !== 'pan' && !e.shiftKey && e.buttons !== 2) { v.yaw += dx * 0.008; v.pitch = clamp(v.pitch + dy * 0.006, 0.1, 1.45); }
    else { v.x += dx; v.y += dy; }
    App.dirty = true;
  });
  const release = e => { pts.delete(e.pointerId); pinch = 0; };
  cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('dblclick', () => { Object.assign(App.view, { zoom: 1, x: 0, y: 0, follow: false, yaw: 0.5, pitch: 0.42 }); syncViewUI(); App.dirty = true; });
  cv.addEventListener('wheel', e => {   // 2D 普通状态下需按住 Ctrl，避免妨碍页面滚动；3D 或全屏时直接缩放
    if (!(e.ctrlKey || e.metaKey || App.mode3d || $('#stageCard').classList.contains('fs'))) return;
    e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  const onFsChange = () => { if (!(document.fullscreenElement || document.webkitFullscreenElement) && $('#stageCard').classList.contains('fs')) toggleFS(false); App.dirty = true; };
  document.addEventListener('fullscreenchange', onFsChange); document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#stageCard').classList.contains('fs') && !document.querySelector('dialog[open]')) toggleFS(false); });
  bindChain();   // 例题拼合（组合轨道）的阶段编辑器
  syncViewUI();
}
/* 扫描 / 反求的参数下拉：当前模型没有默认项（μ）时自动选中第一项 */
const refreshSweepFormBase = refreshSweepForm;
refreshSweepForm = function () { refreshSweepFormBase(); ['swParam', 'invParam'].forEach(id => { const s = $('#' + id); if (s && s.selectedIndex < 0 && s.options.length) s.selectedIndex = 0; }); };

function showView(v) {
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'view-' + v));
  if (v === 'sim') App.dirty = true;
  if (v === 'sweep') { refreshSweepForm(); requestAnimationFrame(renderSweep); }
  if (v === 'ai') { refreshAITokens(); if ($('#ai-check').classList.contains('on')) runLocalCheck(true); }
  if (v === 'set') { renderProviders(); renderPromptEditor(); }
  window.scrollTo(0, 0);
}
function bindTabs(tabsSel, prefix, onShow) {
  $(tabsSel).addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    $$(tabsSel + ' button').forEach(x => x.classList.toggle('on', x === b));
    $$('[id^="' + prefix + '"]').forEach(p => p.classList.toggle('on', p.id === prefix + b.dataset.tab));
    if (onShow) onShow(b.dataset.tab);
  });
}
function openNewDialog() {
  const dlg = $('#dlgNew'), ms = $('#newModel');
  ms.innerHTML = Object.keys(MODELS).map(k => '<option value="' + k + '">' + MODELS[k].name + '</option>').join(''); ms.value = App.cfg.model;
  const fill = () => { $('#newPreset').innerHTML = '<option value="">空白（默认参数）</option>' + MODELS[ms.value].presets.map((p, i) => '<option value="' + i + '">' + esc(p.name) + '</option>').join(''); };
  ms.onchange = fill; fill(); $('#newName').value = ''; dlg.returnValue = '';
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}
function bind() {
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) showView(b.dataset.view); });
  $('#aiPill').addEventListener('click', () => showView('set'));
  // 配置栏
  $('#cfgSel').addEventListener('change', e => { const c = App.store.configs.find(x => x.id === e.target.value); if (c) setCurrent(c); });
  $('#cfgName').addEventListener('input', e => { App.cfg.name = e.target.value.trim() || '未命名配置'; const o = $('#cfgSel').selectedOptions[0]; if (o) o.textContent = App.cfg.name + '（' + MODELS[App.cfg.model].short + '）'; document.title = App.cfg.name + ' · PhysLab'; saveStore(); });
  $('#btnNew').addEventListener('click', openNewDialog);
  $('#newCancel').addEventListener('click', () => $('#dlgNew').close('cancel'));
  $('#dlgNew').addEventListener('close', () => {
    if ($('#dlgNew').returnValue !== 'ok') return;
    const model = $('#newModel').value, pi = $('#newPreset').value, cfg = newConfig(model, pi === '' ? null : MODELS[model].presets[+pi]);
    const name = $('#newName').value.trim(); if (name) { cfg.name = name; cfg.problem.title = name; }
    addConfig(cfg); showView('sim'); toast('已新建配置：' + cfg.name, 'ok');
  });
  $('#btnDup').addEventListener('click', () => { const c = clone(App.cfg); c.id = uid(); c.name = App.cfg.name + ' 副本'; c.flags.forEach(f => { f.id = uid(); }); addConfig(c); toast('已复制为新配置', 'ok'); });
  $('#btnDel').addEventListener('click', () => {
    if (App.store.configs.length <= 1) { toast('至少保留一份配置'); return; }
    if (!confirm('确定删除配置「' + App.cfg.name + '」吗？')) return;
    App.store.configs = App.store.configs.filter(c => c.id !== App.cfg.id); setCurrent(App.store.configs[0]);
  });
  $('#btnExport').addEventListener('click', () => exportBackup());
  $('#btnPage').addEventListener('click', exportPage);
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return; const fr = new FileReader();
    fr.onload = () => { try { const j = JSON.parse(fr.result), raw = j.config || j; if (!raw || !raw.params) throw new Error('文件中没有配置数据'); addConfig(normalizeConfig(raw)); showView('sim'); toast('已导入配置：' + App.cfg.name, 'ok'); } catch (err) { toast('导入失败：' + err.message, 'bad'); } };
    fr.readAsText(f); e.target.value = '';
  });
  // 参数面板
  $('#modelSeg').addEventListener('click', e => {
    const b = e.target.closest('button[data-model]'); if (!b || b.dataset.model === App.cfg.model) return;
    const old = App.cfg, n = newConfig(b.dataset.model);
    if (!MODELS[n.model].fresh && !MODELS[old.model].fresh) MODELS[n.model].params.forEach(p => { if (old.params[p.key] != null && old.params[p.key] !== '') n.params[p.key] = old.params[p.key]; });
    n.name = old.name; n.problem = old.problem; n.options = old.options; replaceCurrent(n);
  });
  $('#presetSel').addEventListener('change', e => { if (e.target.value === '') return; const n = newConfig(App.cfg.model, MODELS[App.cfg.model].presets[+e.target.value]); replaceCurrent(n); toast('已载入例题：' + n.name, 'ok'); });
  $('#paramBox').addEventListener('input', e => { const row = e.target.closest('.prow'); if (!row) return; App.cfg.params[row.dataset.key] = e.target.value; scheduleRecompute(); });
  $('#paramBox').addEventListener('focusin', e => { if (e.target.tagName === 'INPUT') App.lastInput = e.target; });
  $('#keypad').addEventListener('mousedown', e => e.preventDefault());
  $('#keypad').addEventListener('click', e => {
    const b = e.target.closest('button[data-ins]'), inp = App.lastInput; if (!b) return;
    if (!inp || !document.body.contains(inp)) { toast('请先点选一个参数输入框'); return; }
    const a = inp.selectionStart == null ? inp.value.length : inp.selectionStart, z = inp.selectionEnd == null ? a : inp.selectionEnd, ins = b.dataset.ins;
    inp.value = inp.value.slice(0, a) + ins + inp.value.slice(z); inp.focus(); try { inp.setSelectionRange(a + ins.length, a + ins.length); } catch (err) { /* 部分浏览器不支持 */ }
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('#optApprox').addEventListener('change', e => { App.cfg.options.approx37 = e.target.checked; recompute(); });
  $('#optLeave').addEventListener('change', e => { App.cfg.options.afterLeave = e.target.value; recompute(); });
  // 播放控制
  $('#btnPlay').addEventListener('click', togglePlay);
  $('#btnReset').addEventListener('click', () => seek(0));
  $('#btnPrev').addEventListener('click', () => gotoPhase(-1));
  $('#btnNext').addEventListener('click', () => gotoPhase(1));
  $('#selSpeed').addEventListener('change', e => { App.speed = +e.target.value || 1; });
  $('#chkStep').addEventListener('change', e => { App.stepMode = e.target.checked; saveUI(); });
  $('#chkVec').addEventListener('change', e => { App.showVec = e.target.checked; App.dirty = true; saveUI(); });
  $('#chkFull').addEventListener('change', e => { App.fullCurve = e.target.checked; App.dirty = true; saveUI(); });
  $('#tl').addEventListener('input', e => { if (App.sim) seek(+e.target.value / 1000 * App.sim.tEnd); });
  $('#btnShot').addEventListener('click', () => canvasPNG($('#scene'), safeName(App.cfg.name) + '_t' + nfix(App.t, 2) + 's.png'));
  $('#btnCSV').addEventListener('click', exportSimCSV);
  $('#phaseChips').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b && App.sim) seek(App.sim.segs[+b.dataset.i].t0); });
  $('#phaseList').addEventListener('click', e => {
    if (!App.sim) return; const pb = e.target.closest('button[data-play]');
    if (pb) { playPhase(+pb.dataset.play); return; }
    const a = e.target.closest('.ph'); if (a) seek(App.sim.segs[+a.dataset.i].t0);
  });
  $('#chartChips').addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (!b) return; const id = b.dataset.id, i = App.charts.indexOf(id); if (i >= 0) App.charts.splice(i, 1); else App.charts.push(id); renderChartGrid(); saveUI(); });
  $('#chartGrid').addEventListener('click', e => {
    const pb = e.target.closest('button[data-png]');
    if (pb) { canvasPNG($('canvas', pb.parentNode), safeName(App.cfg.name) + '_' + pb.dataset.png + '.png'); return; }
    const c = e.target.closest('canvas'); if (!c || !c._map || !c._time || !App.sim) return;
    const r = c.getBoundingClientRect(), mp = c._map; seek(mp.x0 + clamp((e.clientX - r.left - mp.left) / mp.width, 0, 1) * (mp.x1 - mp.x0));
  });
  bindTabs('#infoTabs', 'pane-', tab => PL.renderTab(PL.infoTabs, 'pane-', tab));
  // 红旗
  $('#btnFlagBoth').addEventListener('click', () => plantFlag(['ground', 'carrier']));
  $('#btnFlagG').addEventListener('click', () => plantFlag(['ground']));
  $('#btnFlagC').addEventListener('click', () => plantFlag(['carrier']));
  $('#btnFlagClear').addEventListener('click', () => { App.cfg.flags = []; renderFlagList(); saveStore(); });
  $('#btnFlagInit').addEventListener('click', () => { App.cfg.flags = [{ id: uid(), anchor: 'ground', t: 0 }, { id: uid(), anchor: 'carrier', t: 0 }]; renderFlagList(); saveStore(); });
  $('#flagList').addEventListener('click', e => { const b = e.target.closest('button[data-del]'); if (!b) return; App.cfg.flags = App.cfg.flags.filter(f => f.id !== b.dataset.del); renderFlagList(); saveStore(); });
  // 题目
  [['probTitle', 'title'], ['probText', 'text'], ['probAns', 'answer'], ['probAna', 'analysis']].forEach(p => $('#' + p[0]).addEventListener('input', e => { App.cfg.problem[p[1]] = e.target.value; saveStore(); }));
  $('#btnWord').addEventListener('click', () => exportWord([App.cfg], App.cfg.problem.title || App.cfg.name));
  // 扫描
  $('#btnSweep').addEventListener('click', () => {
    let from, to; try { from = Expr.eval($('#swFrom').value); to = Expr.eval($('#swTo').value); } catch (e) { toast('起止值无法识别：' + e.message, 'bad'); return; }
    if (runSweep({ param: $('#swParam').value, from, to, steps: +$('#swSteps').value, metric: $('#swMetric').value })) toast('扫描完成', 'ok');
  });
  $('#btnSweepAI').addEventListener('click', aiSweepDesign);
  $('#swExps').addEventListener('click', e => {
    const b = e.target.closest('button[data-exp]'); if (!b) return; const x = Sweep.exps[+b.dataset.exp];
    $('#swParam').value = x.param; $('#swFrom').value = x.from; $('#swTo').value = x.to; $('#swSteps').value = x.steps; $('#swMetric').value = x.metric;
    if (runSweep(x)) toast('已运行：' + x.title, 'ok');
  });
  $('#btnSwCSV').addEventListener('click', sweepCSV);
  $('#btnSwPNG').addEventListener('click', () => { if (!Sweep.last) { toast('请先运行扫描'); return; } canvasPNG($('#swChart1'), safeName(Sweep.last.base) + '_扫描.png'); });
  $('#btnSwSum').addEventListener('click', aiSweepSummary);
  // AI 实验室
  bindTabs('#aiTabs', 'ai-', tab => { if (tab === 'check') runLocalCheck(true); refreshAITokens(); PL.renderTab(PL.aiTools, 'ai-', tab); });
  $('#nlText').addEventListener('input', debounce(refreshAITokens, 150));
  $('#genExtra').addEventListener('input', debounce(refreshAITokens, 150));
  ['genLevel', 'genType', 'genCount'].forEach(id => $('#' + id).addEventListener('change', refreshAITokens));
  $('#btnNlImg').addEventListener('click', () => { const a = AI.active(); if (!a || !a.vision) toast('当前模型未开启视觉：可到「模型配置」启用支持视觉的模型'); $('#nlImg').click(); });
  $('#nlImg').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { NL.images = [await readImage(f)]; renderNLImages(); } catch (err) { toast(err.message, 'bad'); } });
  $('#nlImgBox').addEventListener('click', e => { const b = e.target.closest('button[data-rm]'); if (b) { NL.images.splice(+b.dataset.rm, 1); renderNLImages(); } });
  $('#btnNL').addEventListener('click', aiNL);
  $('#btnNLLocal').addEventListener('click', () => {
    const text = $('#nlText').value.trim(); if (!text) { toast('请先输入题目文字'); return; }
    const r = localParse(text); if (!r.got.length) { toast('没有识别到任何参数，请改用 AI 解析', 'bad'); return; }
    addConfig(r.cfg); showNLResult(r.cfg, { assumptions: ['离线规则只做数值提取，无法判断方向与初始位置，请到「模拟」页核对。', '已识别：' + r.got.join('；')] }, '离线规则解析'); toast('已识别 ' + r.got.length + ' 个参数并载入', 'ok');
  });
  $('#nlRes').addEventListener('click', e => { const b = e.target.closest('button[data-go]'); if (!b) return; if (b.dataset.go === 'sim') showView('sim'); else if (b.dataset.go === 'backup') exportBackup(); else { $('#aiTabs button[data-tab="check"]').click(); } });
  $('#btnChkLocal').addEventListener('click', () => runLocalCheck(false));
  $('#btnChkAI').addEventListener('click', aiCheck);
  $('#btnGen').addEventListener('click', aiGenerate);
  $('#btnGenWord').addEventListener('click', () => { const ok = Gen.items.filter(i => i.state !== 'bad'); if (!ok.length) { toast('还没有可导出的题目'); return; } exportWord(ok.map(i => i.cfg), 'AI出题_' + ok.length + '道'); });
  $('#genList').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.apply != null) { const c = clone(Gen.items[+b.dataset.apply].cfg); c.id = uid(); addConfig(c); showView('sim'); $('#infoTabs button[data-tab="prob"]').click(); toast('已把新题写入网页并运行模拟', 'ok'); }
    else if (b.dataset.word != null) { const c = Gen.items[+b.dataset.word].cfg; exportWord([c], c.problem.title || c.name); }
    else if (b.dataset.drop != null) { Gen.items.splice(+b.dataset.drop, 1); renderGen(); }
  });
  // 模型配置
  $('#btnAddProv').addEventListener('click', () => openProvDialog(null));
  $('#provList').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return; const id = b.closest('.prov').dataset.id, act = b.dataset.act;
    if (act === 'use') { AI.data.activeId = id; AI.save(); renderProviders(); toast('已切换到：' + AI.active().name, 'ok'); }
    else if (act === 'edit') openProvDialog(id);
    else if (act === 'test') testProvider(id, b);
    else if (act === 'del') { const p = AI.data.providers.find(x => x.id === id); if (!confirm('确定删除供应商「' + p.name + '」吗？')) return; AI.data.providers = AI.data.providers.filter(x => x.id !== id); if (AI.data.activeId === id) AI.data.activeId = AI.data.providers[0] ? AI.data.providers[0].id : null; AI.save(); renderProviders(); }
  });
  $('#pvPresets').addEventListener('click', e => { const b = e.target.closest('button[data-preset]'); if (!b) return; $('#dlgProv').dataset.preset = b.dataset.preset; $$('#pvPresets button').forEach(x => x.classList.toggle('on', x === b)); fillProvForm(AI.PRESETS[b.dataset.preset]); });
  $('#pvKeyShow').addEventListener('change', e => { $('#pvKey').type = e.target.checked ? 'text' : 'password'; });
  $('#pvCancel').addEventListener('click', () => $('#dlgProv').close('cancel'));
  $('#dlgProv').addEventListener('close', () => { if ($('#dlgProv').returnValue === 'ok') saveProvDialog(); });
  $('#promptSel').addEventListener('change', renderPromptEditor);
  $('#promptText').addEventListener('input', debounce(() => { const id = $('#promptSel').value, v = $('#promptText').value; if (v === PROMPTS[id].text) delete promptStore[id]; else promptStore[id] = v; LS.set(K_PROMPT, promptStore); $('#promptTok').innerHTML = '该提示词展开占位符后 ≈ <b>' + estTokens(fillPrompt(id)) + '</b> tokens' + (promptStore[id] != null ? ' · 已自定义' : ' · 默认'); }, 200));
  $('#btnPromptReset').addEventListener('click', () => { delete promptStore[$('#promptSel').value]; LS.set(K_PROMPT, promptStore); renderPromptEditor(); toast('已恢复默认提示词', 'ok'); });
  window.addEventListener('resize', debounce(() => { App.dirty = true; if ($('#view-sweep').classList.contains('on')) renderSweep(); }, 80));
}
function init() {
  const ui = LS.get(K_UI, null);
  if (ui) { if (Array.isArray(ui.charts)) App.charts = ui.charts.filter(id => CHARTS.some(c => c.id === id)); App.fullCurve = ui.fullCurve !== false; App.showVec = ui.showVec !== false; App.stepMode = !!ui.stepMode; }
  $('#chkFull').checked = App.fullCurve; $('#chkVec').checked = App.showVec; $('#chkStep').checked = App.stepMode;
  const st = LS.get(K_STORE, null);
  if (st && Array.isArray(st.configs)) {
    // 所属插件被停用 / 卸载的配置不会丢：放进 orphans，插件重新启用后自动恢复
    const pool = (Array.isArray(st.orphans) ? st.orphans : []).concat(st.configs), keep = [], orphans = [];
    pool.forEach(c => { if (c && c.model && !MODELS[c.model]) orphans.push(c); else if (c) keep.push(c); });
    App.orphans = orphans;
    App.store = { configs: keep.map(c => { const n = normalizeConfig(c); if (c && c.id) n.id = c.id; return n; }), currentId: st.currentId };
  }
  let emb = null; try { emb = JSON.parse($('#embedded-config').textContent || 'null'); } catch (e) { emb = null; }
  if (emb && emb.params) {   // 由“导出网页”生成的页面：自动载入内嵌配置
    const n = normalizeConfig(emb), same = App.store.configs.find(c => c.name === n.name && c.model === n.model && JSON.stringify(c.params) === JSON.stringify(n.params));
    if (same) App.store.currentId = same.id; else { App.store.configs.push(n); App.store.currentId = n.id; }
  }
  if (!App.store.configs.length) { const c = newConfig('belt', MODELS.belt.presets[2]); App.store.configs.push(c); App.store.currentId = c.id; }
  AI.load(); PL.ensureProviders(); PL.mountUI(); bind(); bindExtra(); bindV3(); bindV4();
  setCurrent(App.store.configs.find(c => c.id === App.store.currentId) || App.store.configs[0]);
  renderProviders(); renderPromptEditor(); updatePlayBtn();
  requestAnimationFrame(tick);
}

/* =====================================================================
 * 11. 插件运行时（Plugin Runtime）
 *     所有“扩展点”都集中在 PL 对象里。插件通过 src/plugins/api.ts 提供的
 *     受控 API 间接调用这里的方法，不要在插件里直接改 MODELS / CHARTS。
 * ===================================================================== */
const PL = {
  API_VERSION: '1.0',
  vars: [], extraRows: [], rowFilters: [], checkFns: [], solAdds: [], solFilters: [], digestFns: [],
  hooks: { beforeSimulate: [], afterSimulate: [], configChanged: [], aiRequest: [], aiResponse: [], ready: [] },
  promptPatches: {}, infoTabs: [], aiTools: [], warned: {}
};
const appliesTo = (models, id) => !models || models === '*' || [].concat(models).indexOf(id) >= 0;
PL.guard = (owner, what, fn, dflt) => {
  try { return fn(); } catch (e) {
    const k = owner + '|' + what;
    if (!PL.warned[k]) { PL.warned[k] = 1; console.error('[PhysLab 插件 ' + owner + '] ' + what, e); toast('插件「' + owner + '」在「' + what + '」中出错：' + (e && e.message), 'bad'); }
    return dflt;
  }
};
PL.run = (name, a, b) => PL.hooks[name].slice().forEach(h => PL.guard(h.owner, name, () => h.fn(a, b)));
PL.on = (owner, name, fn) => {
  if (!PL.hooks[name]) throw new Error('未知钩子：' + name + '（可用：' + Object.keys(PL.hooks).join(' / ') + '）');
  const h = { owner, fn }; PL.hooks[name].push(h);
  return () => { const i = PL.hooks[name].indexOf(h); if (i >= 0) PL.hooks[name].splice(i, 1); };
};
const needStr = (v, what) => { if (typeof v !== 'string' || !v) throw new Error(what + ' 必须是非空字符串'); };

/* —— ① 模块（模型） —— */
PL.registerModel = (owner, def) => {
  if (!def || typeof def !== 'object') throw new Error('模块定义必须是对象');
  needStr(def.id, 'model.id'); needStr(def.name, 'model.name');
  if (!/^[a-zA-Z][\w-]*$/.test(def.id)) throw new Error('model.id 只能包含字母、数字、下划线、连字符，且以字母开头');
  if (MODELS[def.id]) throw new Error('模块 id「' + def.id + '」已存在，请换一个 id');
  if (!Array.isArray(def.params)) throw new Error('model.params 必须是数组');
  if (typeof def.simulate !== 'function') throw new Error('model.simulate(P) 必须是函数，并返回 sim 对象（可用 api.kit.makeSim 构造）');
  def.params.forEach(p => { needStr(p.key, 'param.key'); needStr(p.name, 'param.name'); if (p.def == null) throw new Error('参数 ' + p.key + ' 缺少默认值 def'); p.def = String(p.def); p.sym = p.sym || p.key; p.group = p.group || '参数'; p.unit = p.unit || ''; });
  const M = Object.assign({ short: def.name, carrier: '对象', presets: [], fresh: true, builtinCharts: false, stats: [['t', 't', 's']] }, def, { plugin: owner });
  MODELS[M.id] = M; return M;
};
PL.extendModel = (owner, id, patch) => {
  const M = MODELS[id]; if (!M) throw new Error('找不到要扩展的模块：' + id);
  (patch.params || []).forEach(p => {
    needStr(p.key, 'param.key'); if (M.params.some(q => q.key === p.key)) throw new Error('模块 ' + id + ' 已有参数 ' + p.key);
    M.params.push(Object.assign({ sym: p.key, group: '扩展', unit: '', def: '0' }, p, { def: String(p.def == null ? '0' : p.def), plugin: owner }));
  });
  (patch.presets || []).forEach(p => M.presets.push(Object.assign({}, p, { plugin: owner })));
  if (typeof patch.build === 'function') { const o = M.build; M.build = (cfg, P, errors) => { if (o) o(cfg, P, errors); PL.guard(owner, 'model.build', () => patch.build(cfg, P, errors)); }; }
  return M;
};

/* —— ② 图表 —— */
PL.registerChart = (owner, def) => {
  needStr(def.id, 'chart.id'); needStr(def.name, 'chart.name');
  if (CHARTS.some(c => c.id === def.id)) throw new Error('图表 id「' + def.id + '」已存在');
  if (!def.paint && !Array.isArray(def.series)) throw new Error('chart 需要 series（折线图）或 paint(ctx,W,H,env)（自绘图）');
  def.plugin = owner; CHARTS.push(def); return def;
};
function chartVisible(def, model) {
  if (def.models) return def.models === '*' || [].concat(def.models).indexOf(model) >= 0;
  const M = MODELS[model]; return !M || M.builtinCharts !== false;
}
function paintCustomChart(def, f, sim) {
  const ctx = f.ctx; ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, f.W, f.H);
  ctx.font = '600 13px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#1b2333'; ctx.fillText(def.name, 10, 14);
  const r = PL.guard(def.plugin || 'chart', '图表「' + def.name + '」绘制', () => def.paint(ctx, f.W, f.H, { sim, P: sim.P, t: App.t, st: stateAt(sim, App.t), full: App.fullCurve, cfg: App.cfg, kit: PL.kit }), null);
  return def.time && r && r.x0 != null ? r : null;
}

/* —— ③ 变量 / 公式 —— */
PL.registerVariable = (owner, v) => {
  needStr(v.key, 'variable.key'); if (!/^[A-Za-z_]\w*$/.test(v.key)) throw new Error('variable.key 必须是合法标识符');
  if (typeof v.compute !== 'function') throw new Error('variable.compute(st, ctx) 必须是函数');
  if (PL.vars.some(x => x.key === v.key)) throw new Error('变量 key「' + v.key + '」已被占用');
  v = Object.assign({ name: v.key, label: v.label || v.name || v.key, unit: '' }, v, { plugin: owner }); PL.vars.push(v);
  if (v.chart) CHARTS.push({ id: 'var_' + v.key, name: v.name + '-t', xl: 't / s', yl: v.name + (v.unit ? ' / ' + v.unit : ''), time: true, models: v.models || '*', plugin: owner, series: [{ n: v.name, c: v.color || COL.extra, x: 't', y: v.key }] });
  if (v.metric) METRICS.push({ id: 'v_' + v.key, name: v.name + (v.metric === 'max' ? '（最大值）' : v.metric === 'min' ? '（最小值）' : '（末值）'), unit: v.unit, plugin: owner,
    f: s => { if (!appliesTo(v.models, s.P.model)) return NaN; const a = s.samples.map(p => p[v.key]).filter(isFinite); if (!a.length) return NaN; return v.metric === 'max' ? Math.max.apply(null, a) : v.metric === 'min' ? Math.min.apply(null, a) : stateAt(s, s.tEnd)[v.key]; } });
  return v;
};
PL.varsFor = model => PL.vars.filter(v => appliesTo(v.models, model));
PL.varOptions = sim => PL.varsFor(sim.P.model).map(v => [v.key, v.name]);

/* —— ④ 结果 / 校验 / 解题 / AI 摘要 —— */
PL.rows = (rows, sim) => {
  const id = sim.P && sim.P.model;
  PL.extraRows.forEach(f => { if (!appliesTo(f.models, id)) return; const r = PL.guard(f.owner, 'results.add', () => f.fn(sim), null); if (Array.isArray(r)) rows = rows.concat(r.filter(Array.isArray)); });
  PL.rowFilters.forEach(f => { if (!appliesTo(f.models, id)) return; const r = PL.guard(f.owner, 'results.transform', () => f.fn(rows.map(x => x.slice()), sim), null); if (Array.isArray(r)) rows = r; });
  return rows;
};
PL.checks = (list, inp, sim) => {
  const id = sim.P && sim.P.model;
  PL.checkFns.forEach(f => { if (!appliesTo(f.models, id)) return; const r = PL.guard(f.owner, 'checks.add', () => f.fn(inp, sim), null); if (Array.isArray(r)) list = list.concat(r); });
  return list;
};
PL.solution = (steps, sim) => {
  const id = sim.P && sim.P.model;
  PL.solAdds.forEach(f => { if (!appliesTo(f.models, id)) return; const r = PL.guard(f.owner, 'solution.add', () => f.fn(sim), null); if (Array.isArray(r)) steps = steps.concat(r); });
  PL.solFilters.forEach(f => { if (!appliesTo(f.models, id)) return; const r = PL.guard(f.owner, 'solution.transform', () => f.fn(steps, sim), null); if (Array.isArray(r)) steps = r; });
  return steps;
};
PL.digest = (d, sim) => {
  const id = sim.P && sim.P.model;
  if (!d || typeof d !== 'object') return d;
  PL.digestFns.forEach(f => { if (!appliesTo(f.models, id)) return; const r = PL.guard(f.owner, 'ai.addContext', () => f.fn(sim), null); if (r && typeof r === 'object') { d = Object.assign({}, d); d['插件数据·' + f.owner] = r; } });
  return d;
};

/* —— ⑤ 界面：额外的“分析”选项卡 / AI 选项卡 —— */
PL.addInfoTab = (owner, t) => { needStr(t.id, 'tab.id'); needStr(t.title, 'tab.title'); if (typeof t.render !== 'function') throw new Error('tab.render(el, ctx) 必须是函数'); PL.infoTabs.push(Object.assign({ owner }, t)); };
PL.addAITool = (owner, t) => { needStr(t.id, 'tool.id'); needStr(t.name, 'tool.name'); if (typeof t.render !== 'function') throw new Error('tool.render(el, ctx) 必须是函数'); PL.aiTools.push(Object.assign({ owner }, t)); };
PL.ctx = () => ({ App, cfg: App.cfg, sim: App.sim, inp: App.inp, callAI, runAI, parseJSONLoose, digest: () => (App.sim && App.inp && App.inp.ok) ? simDigest(App.cfg, App.inp.P, App.sim) : null, systemPrompt: fillPrompt, toast, esc, fmt, nfix, mathText, download });
PL.mountUI = () => {
  const mk = (tabsSel, prefix, list, label) => {
    const tabs = $(tabsSel); if (!tabs) return; const host = tabs.parentElement;
    list.forEach(t => {
      const b = document.createElement('button'); b.dataset.tab = t.id; b.textContent = label(t); b.title = '来自插件：' + t.owner; tabs.appendChild(b);
      const p = document.createElement('div'); p.className = 'pane'; p.id = prefix + t.id; host.appendChild(p);
    });
  };
  mk('#infoTabs', 'pane-', PL.infoTabs, t => t.title);
  mk('#aiTabs', 'ai-', PL.aiTools, t => t.name);
};
PL.renderTab = (list, prefix, id) => {
  const t = list.find(x => x.id === id), el = t && document.getElementById(prefix + id); if (!t || !el) return;
  PL.guard(t.owner, '选项卡「' + id + '」渲染', () => t.render(el, PL.ctx()));
};
PL.refreshInfoTabs = () => PL.infoTabs.forEach(t => { const el = document.getElementById('pane-' + t.id); if (el && el.classList.contains('on')) PL.renderTab(PL.infoTabs, 'pane-', t.id); });
PL.addPrompt = (owner, id, def) => { needStr(id, 'prompt.id'); if (PROMPTS[id]) throw new Error('提示词 id「' + id + '」已存在'); PROMPTS[id] = { name: def.name || id, text: def.text || '', plugin: owner }; };
PL.patchPrompt = (owner, id, fn) => { (PL.promptPatches[id] = PL.promptPatches[id] || []).push({ owner, fn }); };
PL.addProvider = (owner, key, preset) => { needStr(key, 'provider.key'); AI.PRESETS[key] = Object.assign({}, AI.PRESETS.custom, preset, { plugin: owner }); };
PL.ensureProviders = () => {
  let ch = false;
  Object.keys(AI.PRESETS).forEach(k => { if (!AI.PRESETS[k].plugin) return; if (!AI.data.providers.some(p => p.preset === k)) { AI.data.providers.push(Object.assign({ id: uid() + k, preset: k, apiKey: '' }, clone(AI.PRESETS[k]))); ch = true; } });
  if (ch) AI.save();
};

/* —— ⑥ 模块开发工具箱 kit —— */
PL.kit = {
  STATE_DEFAULTS: { xb: 0, vb: 0, ab: 0, xc: 0, vc: 0, ac: 0, xr: 0, vr: 0, fb: 0, f1: 0, f2: 0, Q1: 0, Q2: 0, sRel: 0, rMin: 0, rMax: 0, sb: 0, sc: 0, dRel: 0, Fb: 0, Fc: 0, Ec: 0, Ekb: 0, Ekc: 0, dEp: 0, pb: 0, pc: 0 },
  SUMMARY_DEFAULTS: { xb: 0, xc: 0, vb: 0, vc: 0, dRel: 0, sRel: 0, mark: 0, Q1: 0, Q2: 0, Wf: 0, WFb: 0, WFc: 0, Wbelt: 0, tCommon: null, tLeave: null, dEkb: 0, dEkc: 0, dEpb: 0, dEpc: 0, resid: 0 },
  /* 把“按时间给出状态”的简单描述包装成引擎能识别的 sim 对象 */
  makeSim(o) {
    if (!o || !o.P || typeof o.state !== 'function') throw new Error('makeSim 需要 { P, tEnd, state(t, phaseIndex), phases, ... }');
    const P = o.P, tEnd = Math.max(+o.tEnd || 0, 1e-6), K = PL.kit, name = (MODELS[P.model] || {}).name || P.model;
    const ph = (o.phases && o.phases.length ? o.phases : [{ t0: 0, t1: tEnd, title: '全过程', lines: [], end: '' }]);
    const segs = ph.map((p, i) => ({ i, t0: +p.t0, t1: +p.t1, on: true, mode1: 'none', mode2: 'none' }));
    const sim = { P, isBelt: false, duo: false, kit: true, segs, events: [], tEnd, endReason: o.endReason || 'steady', x0: 0, xmin: o.xmin == null ? 0 : o.xmin, xmax: o.xmax == null ? 1 : o.xmax, vmax: o.vmax == null ? 1 : o.vmax,
      phases: ph.map(p => ({ title: p.title || '过程', lines: p.lines || [], end: p.end || '' })), names: o.names || {}, who: o.who || { a: '对象', c: '对象2', A: '对象', C: '对象2' } };
    sim.stateInSeg = (g, t) => {
      const tt = clamp(t, g.t0, g.t1), raw = o.state(tt, g.i, sim) || {};
      const st = Object.assign({ t: tt, i: g.i, on: true, mode1: 'none', mode2: 'none', stuck: false }, K.STATE_DEFAULTS, raw);
      if (raw.vr == null) st.vr = st.vb - st.vc;
      return st;
    };
    sim.fake = { i: 0, t0: 0, t1: 0, on: true, mode1: 'none', mode2: 'none' };
    sim.resample = () => { sim.samples = []; const n = o.samples || 40; for (const g of segs) for (let k = 0; k <= n; k++) sim.samples.push(stateInSeg(sim, g, g.t0 + (g.t1 - g.t0) * k / n)); };
    sim.summary = Object.assign({}, K.SUMMARY_DEFAULTS, { tEnd }, o.summary || {});
    sim.tiles = o.tiles || [['全过程时间', fmt(tEnd) + ' s']];
    sim.resultRows = o.rows ? () => o.rows(sim) : () => [['全过程时间', fmt(tEnd) + ' s']];
    sim.checks = o.checks ? (inp, s) => o.checks(inp, s) : () => [{ status: 'info', item: '本模块未提供本地校验', detail: '可在插件中通过 makeSim({ checks }) 添加。' }];
    sim.solution = o.solution ? s => o.solution(s) : () => [{ title: '说明', items: [{ tag: '提示', tex: '本模块未提供解题过程（可在插件中通过 makeSim({ solution }) 添加）。' }] }];
    sim.infoBox = st => o.infoBox ? o.infoBox(st, sim) : '';
    sim.forceBox = (st, s) => o.forceBox ? o.forceBox(st, s) : '<p class="muted">本模块未提供力学分析面板。</p>';
    sim.digest = o.digest ? () => o.digest(sim) : () => { const r = x => (x == null || !isFinite(x)) ? null : +(+x).toFixed(4);
      return { 模型: name, 参数: o.P && Object.keys(P).filter(k => typeof P[k] === 'number' && isFinite(P[k])).reduce((a, k) => (a[k] = r(P[k]), a), {}),
        过程: sim.segs.map((g, i) => ({ 序号: i + 1, 时间段: [r(g.t0), r(g.t1)], 概述: sim.phases[i].title, 说明: sim.phases[i].lines, 结束事件: sim.phases[i].end })),
        结果: sim.resultRows(sim).map(x => x[0] + '：' + x[1]) }; };
    if (o.render2D) sim.render2D = (ctx, W, H, s, st, opt) => o.render2D(ctx, W, H, s, st, opt);
    else sim.render2D = (ctx, W, H) => { ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#8a93a6'; ctx.font = '14px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('该模块未提供动画（makeSim({ render2D }) 可自定义）', W / 2, H / 2); };
    if (o.render3D) sim.render3D = (ctx, W, H, s, st, opt) => o.render3D(ctx, W, H, s, st, opt); else sim.no3D = true;
    const M = MODELS[P.model] || {};
    sim.measureKeys = o.measureKeys || (M.stats || []).filter(x => x[0] !== 't').map(x => [x[0], x[1]]);
    sim.measureRows = (s, st) => (o.measureRows ? o.measureRows(s, st) : (M.stats || []).filter(x => x[0] !== 't').map(x => [x[1], fmt(st[x[0]]) + (x[2] ? ' ' + x[2] : '')]));
    sim.resample();
    return sim;
  },
  /* 画坐标轴的小工具：返回 {X(x), Y(y)} 映射 */
  axes(ctx, box, rng, opt) {
    opt = opt || {}; const X = x => box.l + (x - rng.x0) / ((rng.x1 - rng.x0) || 1) * box.w, Y = y => box.t + box.h - (y - rng.y0) / ((rng.y1 - rng.y0) || 1) * box.h;
    ctx.strokeStyle = '#ddd5c5'; ctx.lineWidth = 1; ctx.fillStyle = '#8a93a6'; ctx.font = '11px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const sx = niceStep(rng.x1 - rng.x0, 6), sy = niceStep(rng.y1 - rng.y0, 5);
    for (let x = Math.ceil(rng.x0 / sx) * sx; x <= rng.x1 + 1e-9; x += sx) { ctx.beginPath(); ctx.moveTo(X(x), box.t); ctx.lineTo(X(x), box.t + box.h); ctx.stroke(); ctx.fillText(+x.toFixed(6), X(x), box.t + box.h + 4); }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = Math.ceil(rng.y0 / sy) * sy; y <= rng.y1 + 1e-9; y += sy) { ctx.beginPath(); ctx.moveTo(box.l, Y(y)); ctx.lineTo(box.l + box.w, Y(y)); ctx.stroke(); ctx.fillText(+y.toFixed(6), box.l - 5, Y(y)); }
    return { X, Y };
  }
};

/* —— 对插件公开的内核 —— */
host.core = {
  PL, MODELS, CHARTS, METRICS, PROMPTS, CHAT_QUICK, AI, App, Expr, COMMON_PARAMS, COL, FONT,
  helpers: { sArrow, sText, sDim, sHUD, FONT, COL, $, $$, clamp, esc, uid, clone, fmt, nfix, fx, mathText, toast, download, safeName, niceStep, drawPlot, stateAt, simulate, buildInput, newConfig, recompute, showView, callAI, runAI, parseJSONLoose, estTokens },
  lsKeys: { K_STORE, K_UI, K_AI, K_PROMPT }
};
host.exportEmbeddedPlugins = () => (host.exportPlugins ? host.exportPlugins() : []);
if (host.beforeInit) host.beforeInit(host.core);
init();
PL.run('ready');

}
