'use strict';

// ====== 設定 ======
const STORE_KEY = 'kcal-diary-v1';
// 拍照辨識後端網址的預設值；也可以在「個人設定 → AI 拍照辨識」填寫（AI 的 API 金鑰只放在後端）
const AI_ENDPOINT = '';
const CONFIDENCE = { high: '把握度高', medium: '把握度中等', low: '把握度低，請特別確認' };
// 條碼查詢用 Open Food Facts（免費開放資料庫）；不支援 BarcodeDetector 的瀏覽器（例如 iPhone）改載入 ZXing 解碼
const OFF_API = 'https://world.openfoodfacts.org/api/v2/product/';
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';

const MEALS = [
  { id: 'breakfast', name: '早餐' },
  { id: 'lunch', name: '午餐' },
  { id: 'dinner', name: '晚餐' },
  { id: 'snack', name: '點心' },
];
const ACTIVITY = [
  { v: 1.2, label: '久坐（幾乎不運動）' },
  { v: 1.375, label: '輕度（每週運動 1–3 天）' },
  { v: 1.55, label: '中度（每週運動 3–5 天）' },
  { v: 1.725, label: '高度（每週運動 6–7 天）' },
  { v: 1.9, label: '非常高（勞力工作或一天兩練）' },
];
const GOALS = {
  lose: { label: '減重（每日 −500 大卡）', delta: -500 },
  maintain: { label: '維持體重', delta: 0 },
  gain: { label: '增肌（每日 +300 大卡）', delta: 300 },
};

// ====== 小工具 ======
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = n => Math.round(Number(n) || 0);
const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const today = () => dateKey(new Date());
const WEEK = '日一二三四五六';
function fmtDate(k, short = false) {
  const d = parseKey(k);
  const base = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
  if (short) return base;
  const t = today();
  return base + (k === t ? ' 今天' : k === addDays(t, -1) ? ' 昨天' : '');
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ====== 資料 ======
function emptyState() { return { profile: null, logs: {}, customFoods: [], combos: [], weights: {}, ai: { endpoint: '', token: '' } }; }
const aiConfig = () => ({ endpoint: (state.ai && state.ai.endpoint) || AI_ENDPOINT, token: (state.ai && state.ai.token) || '' });
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === 'object') return { ...emptyState(), ...s };
  } catch (e) { /* 讀不到就用空資料 */ }
  return emptyState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('儲存失敗：' + e.message); }
}

let state = load();
const ui = { tab: state.profile ? 'today' : 'settings', date: today(), histRange: 7, histView: 'kcal', wRange: 30 };

function totals(items) {
  return items.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }), { kcal: 0, p: 0, c: 0, f: 0 });
}

// Mifflin-St Jeor 公式
function calcTargets(p) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * p.activity;
  let target = tdee + GOALS[p.goal].delta;
  let floored = false;
  // 減重時不建議低於基礎代謝率
  if (p.goal === 'lose' && target < bmr) { target = Math.min(bmr, tdee); floored = true; }
  if (p.customTarget > 0) target = p.customTarget;
  target = Math.round(target / 10) * 10;
  const protein = Math.round(p.weight * (p.goal === 'maintain' ? 1.2 : 1.6));
  const fat = Math.round(target * 0.25 / 9);
  const carb = Math.max(0, Math.round((target - protein * 4 - fat * 9) / 4));
  return { bmr: r0(bmr), tdee: r0(tdee), target, protein, fat, carb, floored };
}

// 攝取評估：±10% 內視為達標
function judge(kcal, target) {
  if (kcal <= 0) return { cls: 'low', text: '尚無紀錄' };
  const ratio = kcal / target;
  if (ratio > 1.1) return { cls: 'over', text: '攝取過多' };
  if (ratio < 0.8) return { cls: 'low', text: '攝取偏少' };
  return { cls: '', text: '接近目標' };
}

// ====== 體重 ======
// 成人 BMI 分級（衛福部國民健康署）
function bmiInfo(kg, heightCm) {
  const bmi = kg / ((heightCm / 100) ** 2);
  if (bmi < 18.5) return { bmi: r1(bmi), label: '體重過輕', cls: 'low' };
  if (bmi < 24) return { bmi: r1(bmi), label: '健康體位', cls: '' };
  if (bmi < 27) return { bmi: r1(bmi), label: '過重', cls: 'over' };
  return { bmi: r1(bmi), label: '肥胖', cls: 'over' };
}
const weightEntries = () => Object.entries(state.weights).sort(([a], [b]) => (a < b ? -1 : 1));
function latestWeight() { const all = weightEntries(); return all.length ? all[all.length - 1] : null; }
// 最新一筆體重會同步到個人資料，讓每日目標跟著體重更新
function syncProfileWeight() {
  const latest = latestWeight();
  if (!state.profile || !latest || state.profile.weight === latest[1]) return false;
  state.profile.weight = latest[1];
  return true;
}
function saveWeight(k, kg) {
  state.weights[k] = r1(kg);
  const synced = syncProfileWeight();
  save();
  return synced;
}

// ====== 畫面切換 ======
function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabbar button').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  render();
  window.scrollTo(0, 0);
}

function render() {
  const view = $('#view');
  $('#fab').hidden = ui.tab !== 'today' || !state.profile;
  if (ui.tab === 'today') view.innerHTML = renderToday();
  else if (ui.tab === 'history') { view.innerHTML = renderHistory(); bindChart(); }
  else view.innerHTML = renderSettings();
}

// ====== 今日 ======
function renderToday() {
  if (!state.profile) {
    return `<div class="card"><h3>歡迎使用熱量日記</h3>
      <p class="muted">請先填寫個人資料，系統會依你的身體數據計算每日建議攝取熱量。</p>
      <button class="btn primary block" data-go="settings">開始設定</button></div>`;
  }
  const T = calcTargets(state.profile);
  const items = state.logs[ui.date] || [];
  const sum = totals(items);
  const remain = T.target - r0(sum.kcal);
  const isToday = ui.date === today();
  const over = remain < 0;

  const R = 56, C = 2 * Math.PI * R;
  const frac = Math.min(sum.kcal / T.target, 1);
  const ring = `<div class="ring ${over ? 'over' : ''}" role="img" aria-label="已攝取 ${r0(sum.kcal)} 大卡，目標 ${T.target} 大卡">
    <svg viewBox="0 0 132 132"><circle class="track" cx="66" cy="66" r="${R}" fill="none" stroke-width="12"/>
    <circle class="bar" cx="66" cy="66" r="${R}" fill="none" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" ${frac === 0 ? 'stroke-opacity="0"' : ''}/></svg>
    <div class="center"><div class="big num">${r0(sum.kcal)}</div><div class="muted small">/ ${T.target} 大卡</div></div></div>`;

  let headline, chip = '';
  if (over) headline = `<p class="headline over">超過 ${-remain} 大卡</p>`;
  else headline = `<p class="headline">${isToday ? '還可以吃' : '剩餘'} <span class="num">${remain}</span> 大卡</p>`;
  if (!isToday || over) {
    const j = judge(sum.kcal, T.target);
    chip = `<span class="chip ${j.cls}">${esc(j.text)}</span>`;
  }

  const macro = (name, val, tgt, color) => `<div class="macro">
      <div class="name"><span class="dot" style="background:${color}"></span>${name}</div>
      <div class="val num">${r0(val)} <span class="muted small">/ ${tgt}g</span></div>
      <div class="meter"><span style="width:${Math.min(val / tgt, 1) * 100}%;background:${color}"></span></div></div>`;

  const meals = MEALS.map(m => {
    const list = items.filter(e => e.meal === m.id);
    const mk = r0(totals(list).kcal);
    const rows = list.map(e => `<li>
        <div class="info"><b>${esc(e.name)}</b><small>${esc(e.qty)} · 蛋白 ${r1(e.p)} / 碳水 ${r1(e.c)} / 脂肪 ${r1(e.f)} g</small></div>
        <span class="k num">${r0(e.kcal)}</span>
        <button class="icon-btn" data-del="${esc(e.id)}" aria-label="刪除 ${esc(e.name)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </li>`).join('');
    return `<section class="card">
      <div class="meal-head"><h3>${m.name}</h3><span class="kcal num">${mk ? mk + ' 大卡' : ''}</span><span class="spacer"></span>
        ${list.length ? `<button class="link subtle" data-savecombo="${m.id}">存成套餐</button>` : ''}
        <button class="link" data-add="${m.id}">＋ 新增</button></div>
      ${rows ? `<ul class="entries">${rows}</ul>` : ''}
    </section>`;
  }).join('');

  return `
    <div class="datenav">
      <button class="icon-btn" data-day="-1" aria-label="前一天"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div class="label">${fmtDate(ui.date)}</div>
      <button class="icon-btn" data-day="1" aria-label="後一天" ${isToday ? 'disabled style="opacity:.3"' : ''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    ${!isToday ? `<p style="text-align:center;margin:-6px 0 10px"><button class="link" data-today>回到今天</button></p>` : ''}
    <div class="card">
      <div class="summary">${ring}
        <div class="summary-text">${headline}${chip}
          <p class="muted small" style="margin:8px 0 0">每日目標 ${T.target} 大卡 · 消耗約 ${T.tdee} 大卡</p></div>
      </div>
      <div class="macros">
        ${macro('蛋白質', sum.p, T.protein, 'var(--protein)')}
        ${macro('碳水', sum.c, T.carb, 'var(--carb)')}
        ${macro('脂肪', sum.f, T.fat, 'var(--fat)')}
      </div>
    </div>
    ${meals}
    ${renderWeightCard()}`;
}

function renderWeightCard() {
  const w = state.weights[ui.date];
  const earlier = weightEntries().filter(([k]) => k < ui.date);
  const prev = earlier.length ? earlier[earlier.length - 1] : null;
  const diff = w && prev ? r1(w - prev[1]) : null;
  const b = w ? bmiInfo(w, state.profile.height) : null;
  return `<section class="card">
    <div class="meal-head"><h3>體重</h3>${w ? `<span class="kcal num">${w} kg</span>` : ''}<span class="spacer"></span>
      ${diff !== null ? `<span class="muted small num">比 ${fmtDate(prev[0], true)} ${diff > 0 ? '+' : ''}${diff} kg</span>` : ''}</div>
    ${weightForm(ui.date, w)}
    ${b ? `<p class="muted small" style="margin:8px 0 0">BMI ${b.bmi} <span class="chip ${b.cls}">${b.label}</span></p>` : ''}
  </section>`;
}

function weightForm(k, current) {
  return `<form class="weight-form" data-wdate="${k}">
      <input class="input num" name="kg" type="number" inputmode="decimal" step="0.1" min="25" max="300"
        placeholder="${k === today() ? '輸入今天的體重' : '輸入這天的體重'}" value="${current ?? ''}" aria-label="體重（公斤）">
      <span class="muted">kg</span>
      <button class="btn primary" type="submit">${current ? '更新' : '記錄'}</button>
    </form>`;
}

// ====== 紀錄 ======
function renderHistory() {
  if (!state.profile) return renderToday();
  const switcher = `<div class="seg wide" role="group" aria-label="切換紀錄類型">
      <button data-hview="kcal" class="${ui.histView === 'kcal' ? 'active' : ''}">熱量</button>
      <button data-hview="weight" class="${ui.histView === 'weight' ? 'active' : ''}">體重</button></div>`;
  return switcher + (ui.histView === 'weight' ? renderWeightHistory() : renderKcalHistory());
}

function renderWeightHistory() {
  const P = state.profile;
  const t = today();
  const all = weightEntries();
  const from = ui.wRange ? addDays(t, -(ui.wRange - 1)) : (all.length ? all[0][0] : t);
  const pts = all.filter(([k]) => k >= from);
  const latest = latestWeight();
  const change = pts.length >= 2 ? r1(pts[pts.length - 1][1] - pts[0][1]) : null;
  const goal = P.targetWeight || 0;
  const toGoal = goal && latest ? r1(latest[1] - goal) : null;
  const b = latest ? bmiInfo(latest[1], P.height) : null;
  const signed = v => (v > 0 ? '+' : '') + v;

  let chart = '<p class="empty">這段期間還沒有體重紀錄。在上方輸入今天的體重開始追蹤。</p>';
  const tips = [];
  if (pts.length) {
    const W = 320, H = 170, padL = 34, padR = 8, padB = 22, padT = 10;
    const dayIdx = k => Math.round((parseKey(k) - parseKey(from)) / 86400000);
    const span = Math.max(dayIdx(t), 1);
    const vals = pts.map(p => p[1]);
    // 目標體重離資料不遠時才納入縱軸，避免曲線被壓扁
    if (goal && Math.abs(goal - vals[vals.length - 1]) <= 6) vals.push(goal);
    let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
    if (hi - lo < 2) { lo -= 1; hi += 1; }
    const x = k => padL + (W - padL - padR) * dayIdx(k) / span;
    const y = v => padT + (H - padT - padB) * (hi - v) / (hi - lo);
    const mid = r1((lo + hi) / 2);
    const grid = [lo, mid, hi].map(v => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis" x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('');
    const xLabels = [from, t].map((k, i) => `<text class="axis" x="${x(k)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${fmtDate(k, true).replace(/（.）/, '')}</text>`).join('');
    const goalLine = goal >= lo && goal <= hi
      ? `<line class="target" x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}"/>
         <text class="axis" x="${W - padR}" y="${y(goal) - 4}" text-anchor="end">目標 ${goal}</text>` : '';
    const line = pts.length > 1 ? `<path class="line" d="${pts.map(([k, v], i) => `${i ? 'L' : 'M'}${x(k)},${y(v)}`).join(' ')}"/>` : '';
    const dots = pts.map(([k, v], i) => {
      tips.push(`<b>${fmtDate(k, true)}</b><br>${v} kg${i ? `（${signed(r1(v - pts[i - 1][1]))}）` : ''}`);
      return `<circle class="pt" data-i="${i}" cx="${x(k)}" cy="${y(v)}" r="4"/><circle class="hit" data-i="${i}" cx="${x(k)}" cy="${y(v)}" r="14"/>`;
    }).join('');
    chart = `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="體重變化折線圖，最新 ${latest[1]} 公斤">
        ${grid}${goalLine}${line}${dots}${xLabels}</svg><div class="tip" id="tip"></div></div>`;
  }
  window.__tips = tips;

  const list = pts.slice().reverse().map(([k, v]) => {
    const i = all.findIndex(e => e[0] === k);
    const d = i > 0 ? r1(v - all[i - 1][1]) : null;
    return `<li><span style="flex:1;white-space:nowrap">${fmtDate(k, true)}</span>
      <span class="num">${v} kg</span>
      <span class="muted small num" style="width:52px;text-align:right">${d === null ? '' : signed(d)}</span>
      <button class="icon-btn" data-delweight="${k}" aria-label="刪除 ${fmtDate(k, true)} 的體重"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`;
  }).join('');

  return `<div class="card">
      <h3>記錄今天體重</h3>
      ${weightForm(t, state.weights[t])}
    </div>
    <div class="card">
      <div class="row"><h3>體重變化</h3><span class="spacer"></span>
        <div class="seg" role="group" aria-label="時間範圍">
          ${[[30, '30 天'], [90, '90 天'], [0, '全部']].map(([v, l]) => `<button data-wrange="${v}" class="${ui.wRange === v ? 'active' : ''}">${l}</button>`).join('')}</div></div>
      <div class="stats">
        <div class="stat"><div class="v num">${latest ? latest[1] : '—'}</div><div class="l">目前體重（kg）</div></div>
        <div class="stat"><div class="v num">${change === null ? '—' : signed(change)}</div><div class="l">期間變化（kg）</div></div>
        <div class="stat"><div class="v num">${toGoal === null ? '—' : toGoal === 0 ? '達標' : signed(toGoal)}</div><div class="l">${goal ? `距目標 ${goal} kg` : '可在設定填目標體重'}</div></div>
      </div>
      ${chart}
      ${b ? `<p class="muted small" style="margin:6px 0 0">BMI ${b.bmi} <span class="chip ${b.cls}">${b.label}</span>　成人健康體位為 18.5–24</p>` : ''}
    </div>
    ${list ? `<div class="card"><h3 style="margin-bottom:6px">體重明細</h3><ul class="daylist">${list}</ul></div>` : ''}`;
}

function renderKcalHistory() {
  const T = calcTargets(state.profile);
  const n = ui.histRange;
  const t = today();
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = addDays(t, -i);
    const items = state.logs[k] || [];
    days.push({ k, kcal: r0(totals(items).kcal), count: items.length });
  }
  const logged = days.filter(d => d.count > 0);
  const avg = logged.length ? r0(logged.reduce((s, d) => s + d.kcal, 0) / logged.length) : 0;
  const hit = logged.filter(d => d.kcal >= T.target * 0.9 && d.kcal <= T.target * 1.1).length;

  // 長條圖
  const W = 320, H = 170, padL = 34, padB = 22, padT = 8;
  const max = Math.max(T.target * 1.3, ...days.map(d => d.kcal));
  const top = Math.ceil(max / 500) * 500;
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  const slot = (W - padL) / n;
  const bw = Math.max(Math.min(slot - 2, 26), 3);
  const grid = [0, top / 2, top].map(v => `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('');
  const bars = days.map((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const h = d.kcal ? Math.max(y(0) - y(d.kcal), 2) : 0;
    const rx = Math.min(4, bw / 2, h);
    const showLabel = n <= 7 || i % 5 === (n - 1) % 5;
    const lab = showLabel ? `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${n <= 7 ? WEEK[parseKey(d.k).getDay()] : parseKey(d.k).getDate()}</text>` : '';
    // 只有上方圓角、底部貼齊基準線
    const path = h ? `<path class="b ${d.kcal > T.target * 1.1 ? 'over' : ''}" data-i="${i}" d="M${x},${y(0)} V${y(0) - h + rx} Q${x},${y(0) - h} ${x + rx},${y(0) - h} H${x + bw - rx} Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + rx} V${y(0)} Z"/>` : '';
    return `<rect class="hit" data-i="${i}" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${H - padT - padB}"/>${path}${lab}`;
  }).join('');
  const chart = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${n} 天每日攝取熱量長條圖，虛線為目標 ${T.target} 大卡">
      ${grid}${bars}<line class="target" x1="${padL}" x2="${W}" y1="${y(T.target)}" y2="${y(T.target)}"/></svg>`;

  const list = days.slice().reverse().filter(d => d.count > 0).map(d => {
    let j = judge(d.kcal, T.target);
    // 今天還沒結束，未超標前不評斷「偏少」
    if (d.k === t && j.cls !== 'over') j = { cls: '', text: '進行中' };
    const diff = d.kcal - T.target;
    return `<li data-open="${d.k}"><span style="flex:1;white-space:nowrap">${fmtDate(d.k, true)}</span>
      <span class="num">${d.kcal} 大卡</span>
      <span class="muted small num" style="width:62px;text-align:right">${diff > 0 ? '+' : ''}${diff}</span>
      <span class="chip ${j.cls}">${j.text}</span></li>`;
  }).join('');

  window.__tips = days.map(d => `<b>${fmtDate(d.k, true)}</b><br>${d.count ? `${d.kcal} 大卡 · ${judge(d.kcal, T.target).text}` : '無紀錄'}`);
  return `<div class="card">
      <div class="row"><h3>每日攝取</h3><span class="spacer"></span>
        <div class="seg" role="group" aria-label="時間範圍">
          <button data-range="7" class="${n === 7 ? 'active' : ''}">7 天</button>
          <button data-range="30" class="${n === 30 ? 'active' : ''}">30 天</button></div></div>
      <div class="stats">
        <div class="stat"><div class="v num">${avg || '—'}</div><div class="l">平均攝取（大卡）</div></div>
        <div class="stat"><div class="v num">${hit} / ${logged.length}</div><div class="l">達標天數（±10%）</div></div>
        <div class="stat"><div class="v num">${T.target}</div><div class="l">每日目標（虛線）</div></div>
      </div>
      <div class="chart-wrap">${chart}<div class="tip" id="tip"></div></div>
      <p class="muted small" style="margin:6px 0 0">紅色長條表示當天超過目標 10% 以上。</p>
    </div>
    <div class="card"><h3 style="margin-bottom:6px">每日明細</h3>
      ${list ? `<ul class="daylist">${list}</ul>` : '<p class="empty">這段期間還沒有紀錄。</p>'}</div>`;
}

function bindChart() {
  const wrap = $('.chart-wrap');
  if (!wrap) return;
  const tip = $('#tip');
  const clear = () => wrap.querySelectorAll('.hl').forEach(m => m.classList.remove('hl'));
  const show = el => {
    const i = +el.dataset.i;
    clear();
    const mark = wrap.querySelector(`.b[data-i="${i}"], .pt[data-i="${i}"]`);
    if (mark) mark.classList.add('hl');
    tip.innerHTML = window.__tips[i];
    const box = el.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
    const x = Math.min(Math.max(box.left - wb.left + box.width / 2, 50), wb.width - 50);
    tip.style.left = x + 'px';
    // 提示框放在長條頂端或資料點上方
    const anchor = (mark || el).getBoundingClientRect();
    tip.style.top = Math.max(anchor.top - wb.top - 8, 0) + 'px';
    tip.classList.add('show');
  };
  wrap.querySelectorAll('.hit').forEach(h => {
    h.addEventListener('pointerenter', () => show(h));
    h.addEventListener('click', () => show(h));
  });
  wrap.addEventListener('pointerleave', () => {
    tip.classList.remove('show');
    clear();
  });
}

// ====== 個人設定 ======
let deferredInstall = null;
function renderSettings() {
  const p = state.profile || { sex: 'female', age: '', height: '', weight: '', activity: 1.375, goal: 'maintain', customTarget: '' };
  const T = state.profile ? calcTargets(state.profile) : null;
  const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const myFoods = state.customFoods.map(f => `<li><span style="flex:1;min-width:0">${esc(f.name)} <span class="muted small">${esc(unitText(f))} · ${r0(f.kcal)} 大卡${f.barcode ? ' · 條碼 ' + esc(f.barcode) : ''}</span></span>
      <button class="icon-btn" data-delfood="${esc(f.id)}" aria-label="刪除 ${esc(f.name)}">${X}</button></li>`).join('');
  const myCombos = state.combos.map(c => `<li><span style="flex:1;min-width:0">${esc(c.name)} <span class="muted small">${c.items.length} 項 · ${r0(totals(c.items).kcal)} 大卡</span></span>
      <button class="icon-btn" data-delcombo="${esc(c.id)}" aria-label="刪除套餐 ${esc(c.name)}">${X}</button></li>`).join('');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  return `
    ${!state.profile ? `<div class="card"><h3>歡迎使用熱量日記</h3><p class="muted small" style="margin:4px 0 0">填寫以下資料後，會自動算出你的基礎代謝率、每日消耗與建議攝取量。所有資料只存在這台裝置上。</p></div>` : ''}
    ${T ? `<div class="card"><h3 style="margin-bottom:10px">你的每日建議</h3>
      <div class="result-grid">
        <div><div class="v num">${T.target}</div><div class="l">每日目標（大卡）</div></div>
        <div><div class="v num">${T.tdee}</div><div class="l">每日總消耗 TDEE</div></div>
        <div><div class="v num">${T.bmr}</div><div class="l">基礎代謝率 BMR</div></div>
        <div><div class="v num">${T.protein} / ${T.carb} / ${T.fat}</div><div class="l">蛋白質 / 碳水 / 脂肪（g）</div></div>
      </div>
      ${T.floored ? '<p class="note warn">減重目標已調整為不低於基礎代謝率，避免熱量攝取過低。</p>' : ''}
      <p class="note">以上為公式估算值，僅供參考；若有疾病、懷孕或特殊飲食需求，請諮詢醫師或營養師。</p></div>` : ''}

    <form class="card" id="profile-form" novalidate>
      <h3 style="margin-bottom:12px">個人資料</h3>
      <div class="field"><span>生理性別（用於代謝公式）</span>
        <div class="radio-row">
          <label><input type="radio" name="sex" value="female" ${p.sex === 'female' ? 'checked' : ''}><span>女</span></label>
          <label><input type="radio" name="sex" value="male" ${p.sex === 'male' ? 'checked' : ''}><span>男</span></label>
        </div></div>
      <div class="grid3">
        <label class="field"><span>年齡</span><input class="input" name="age" type="number" inputmode="numeric" min="10" max="100" value="${esc(p.age)}" required></label>
        <label class="field"><span>身高 cm</span><input class="input" name="height" type="number" inputmode="decimal" min="100" max="230" value="${esc(p.height)}" required></label>
        <label class="field"><span>體重 kg</span><input class="input" name="weight" type="number" inputmode="decimal" min="25" max="300" step="0.1" value="${esc(p.weight)}" required></label>
      </div>
      <label class="field"><span>目標體重 kg（選填）</span>
        <input class="input" name="targetWeight" type="number" inputmode="decimal" min="25" max="300" step="0.1" value="${esc(p.targetWeight || '')}"></label>
      <label class="field"><span>活動量</span><select class="input" name="activity">
        ${ACTIVITY.map(a => `<option value="${a.v}" ${+p.activity === a.v ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label>
      <label class="field"><span>目標</span><select class="input" name="goal">
        ${Object.entries(GOALS).map(([k, g]) => `<option value="${k}" ${p.goal === k ? 'selected' : ''}>${g.label}</option>`).join('')}</select></label>
      <label class="field"><span>自訂每日目標（選填，留空則自動計算）</span>
        <input class="input" name="customTarget" type="number" inputmode="numeric" min="800" max="6000" placeholder="例如 1800" value="${esc(p.customTarget || '')}"></label>
      <button class="btn primary block" type="submit">${state.profile ? '更新資料' : '儲存並開始'}</button>
    </form>

    ${state.profile ? `
    <form class="card" id="ai-form" novalidate>
      <div class="row" style="margin-bottom:4px"><h3>AI 拍照辨識（選用）</h3><span class="spacer"></span>
        <span class="chip ${aiConfig().endpoint ? '' : 'low'}">${aiConfig().endpoint ? '已啟用' : '未設定'}</span></div>
      <p class="muted small" style="margin:0 0 12px">此功能需自行部署後端並支付 AI 使用費（見 README）。不設定也能用其他所有功能，完全免費。</p>
      <label class="field"><span>後端網址</span>
        <input class="input" name="endpoint" type="url" inputmode="url" autocomplete="off" placeholder="https://food-ai-worker.你的帳號.workers.dev" value="${esc(state.ai?.endpoint || '')}"></label>
      <label class="field"><span>存取碼</span>
        <input class="input" name="token" type="password" autocomplete="off" value="${esc(state.ai?.token || '')}"></label>
      <button class="btn block" type="submit">儲存 AI 設定</button>
    </form>

    <div class="card"><h3 style="margin-bottom:6px">我的食物</h3>
      ${myFoods ? `<ul class="myfoods">${myFoods}</ul>` : '<p class="empty">在「新增食物 → 自訂」勾選「存到我的食物」，或掃描條碼，常吃的東西就會出現在這裡。</p>'}</div>

    <div class="card"><h3 style="margin-bottom:6px">我的套餐</h3>
      ${myCombos ? `<ul class="myfoods">${myCombos}</ul>` : '<p class="empty">在「今日」頁任一餐點旁按「存成套餐」，下次就能一鍵加入整組。</p>'}</div>

    <div class="card"><h3 style="margin-bottom:10px">資料備份</h3>
      <div class="grid2">
        <button class="btn" data-export>匯出備份</button>
        <label class="btn" style="margin:0">匯入備份<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
      <p class="note">資料只存在這個瀏覽器中。清除瀏覽器資料或換手機前，請先匯出備份。</p>
      <button class="btn danger block" style="margin-top:12px" data-reset>清除所有資料</button></div>` : ''}

    ${!standalone ? `<div class="card"><h3 style="margin-bottom:6px">安裝到主畫面</h3>
      ${deferredInstall ? '<button class="btn primary block" data-install>安裝熱量日記</button>'
        : isIOS ? '<p class="muted small" style="margin:0">在 Safari 點「分享」→「加入主畫面」，就能像 App 一樣全螢幕開啟、離線使用。</p>'
        : '<p class="muted small" style="margin:0">在瀏覽器選單中選「安裝應用程式」或「加到主畫面」，就能像 App 一樣使用。</p>'}</div>` : ''}
    <p class="muted small" style="text-align:center;margin-bottom:4px">熱量日記 v1.2</p>
    <p class="muted small" style="text-align:center;margin-top:0">食物營養資料：衛生福利部食品藥物管理署「食品營養成分資料集」（政府資料開放授權條款第1版）<br>
      條碼商品資料：Open Food Facts（ODbL 授權）</p>`;
}

function saveProfile(form) {
  const fd = new FormData(form);
  const p = {
    sex: fd.get('sex') === 'male' ? 'male' : 'female',
    age: num(fd.get('age')),
    height: num(fd.get('height')),
    weight: num(fd.get('weight')),
    activity: num(fd.get('activity')) || 1.2,
    goal: GOALS[fd.get('goal')] ? fd.get('goal') : 'maintain',
    customTarget: num(fd.get('customTarget')),
    targetWeight: num(fd.get('targetWeight')),
  };
  if (p.age < 10 || p.age > 100) return toast('請輸入正確的年齡（10–100）');
  if (p.height < 100 || p.height > 230) return toast('請輸入正確的身高（100–230 cm）');
  if (p.weight < 25 || p.weight > 300) return toast('請輸入正確的體重（25–300 kg）');
  if (p.customTarget && (p.customTarget < 800 || p.customTarget > 6000)) return toast('自訂目標請介於 800–6000 大卡');
  if (p.targetWeight && (p.targetWeight < 25 || p.targetWeight > 300)) return toast('請輸入正確的目標體重（25–300 kg）');
  const first = !state.profile;
  // 體重有變動時，順便記成今天的體重紀錄
  if (first || state.profile.weight !== p.weight) state.weights[today()] = r1(p.weight);
  state.profile = p;
  syncProfileWeight();
  save();
  toast('已儲存');
  if (first) setTab('today'); else render();
}

function exportData() {
  // 備份檔不含存取碼
  const data = { ...state, ai: { endpoint: aiConfig().endpoint, token: '' } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `熱量日記備份-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data.logs !== 'object') throw new Error('格式不符');
    if (!confirm('匯入會覆蓋目前所有資料，確定嗎？')) return;
    const keepAi = state.ai;
    state = { ...emptyState(), ...data };
    if (!state.ai || !state.ai.token) state.ai = { ...keepAi, endpoint: state.ai?.endpoint || keepAi.endpoint };
    save();
    toast('匯入完成');
    render();
  } catch (e) { toast('匯入失敗：' + e.message); }
}

// ====== 新增食物面板 ======
const sheet = { meal: 'breakfast', tab: 'search', q: '', picked: null, mult: 1, photo: null, ai: null, aiMeta: null, aiNote: '', aiBusy: false };

function defaultMeal() {
  const h = new Date().getHours();
  return h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 17 ? 'snack' : h < 21 ? 'dinner' : 'snack';
}
function openSheet(meal, mode = 'add') {
  Object.assign(sheet, { mode, meal: meal || defaultMeal(), tab: 'search', q: '', picked: null, mult: 1, photo: null, ai: null, aiMeta: null, aiNote: '', aiBusy: false, bc: { status: 'idle' } });
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  renderSheet();
  if (mode === 'add') setTimeout(() => $('#q')?.focus(), 50);
}
function closeSheet() {
  stopScan();
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

// 衛福部資料：每 100g 的數值
const TFDA = (typeof TFDA_FOODS === 'undefined' ? [] : TFDA_FOODS).map(r => ({
  name: r[0], kw: r[1] + ' ' + TFDA_CATS[r[2]], tag: '衛福部', per100: true, u: 'g',
  kcal: r[3], p: r[4], c: r[5], f: r[6], unitG: r[7],
}));
// 食物有兩種：以「一份」計（unit）或以每 100g/ml 計（per100，份量用克數輸入）
const unitText = f => (f.per100 ? `每 100${f.u || 'g'}${f.unitG ? `，1 份 ${f.unitG}${f.u || 'g'}` : ''}` : f.unit);
const portionFactor = (f, amount) => (f.per100 ? amount / 100 : amount);

function foodPool() {
  return [...state.customFoods.map(f => ({ ...f, tag: f.barcode ? '條碼' : '我的' })), ...FOODS.map(f => ({ ...f, tag: f.cat })), ...TFDA];
}
function recentFoods() {
  const seen = new Set(), out = [];
  const keys = Object.keys(state.logs).sort().reverse();
  for (const k of keys) {
    for (const e of state.logs[k].slice().reverse()) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      // e.base 保存一份的數值，重新加入時用一份計算
      const b = e.base || { unit: e.qty, kcal: e.kcal, p: e.p, c: e.c, f: e.f };
      out.push({ name: e.name, ...b, tag: '最近' });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

const mealName = () => MEALS.find(x => x.id === sheet.meal).name;

function renderSheet() {
  // 離開條碼分頁或不在掃描狀態時關掉相機
  if (sheet.bc?.status !== 'scanning' || sheet.tab !== 'barcode' || sheet.picked) {
    stopScan();
    if (sheet.bc?.status === 'scanning') sheet.bc = { status: 'idle' };
  }
  if (sheet.mode === 'combo') {
    $('#sheet-title').textContent = '存成套餐';
    $('#sheet-body').innerHTML = renderComboSave();
    return;
  }
  $('#sheet-title').textContent = sheet.picked ? '設定份量' : '新增食物';
  const mealChips = `<div class="chips" role="group" aria-label="餐別">${MEALS.map(m =>
    `<button data-meal="${m.id}" class="${sheet.meal === m.id ? 'active' : ''}">${m.name}</button>`).join('')}</div>`;

  if (sheet.picked) { $('#sheet-body').innerHTML = mealChips + renderPortion(); return; }

  const tabs = `<div class="tabs" role="tablist">
    ${[['search', '搜尋'], ['barcode', '條碼'], ['combo', '套餐'], ['custom', '自訂'], ['photo', '拍照']].map(([k, l]) =>
      `<button role="tab" data-stab="${k}" aria-selected="${sheet.tab === k}" class="${sheet.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (sheet.tab === 'search') body = `<input class="input" id="q" type="search" placeholder="搜尋食物，例如：便當、豆漿、雞胸肉" value="${esc(sheet.q)}" autocomplete="off"><div id="results"></div>`;
  else if (sheet.tab === 'barcode') body = renderBarcode();
  else if (sheet.tab === 'combo') body = renderCombos();
  else if (sheet.tab === 'custom') body = renderCustom();
  else body = renderPhoto();
  $('#sheet-body').innerHTML = mealChips + tabs + body;
  if (sheet.tab === 'search') renderResults();
}

const MAX_RESULTS = 60;
function renderResults() {
  const q = sheet.q.trim().toLowerCase();
  let html = '';
  const row = (f, i) => `<li><button data-pick="${i}">
      <div class="info">${esc(f.name)}<small>${esc(unitText(f))} · 蛋白 ${r1(f.p)} / 碳水 ${r1(f.c)} / 脂肪 ${r1(f.f)} g</small></div>
      <span class="tag">${esc(f.tag)}</span><span class="num" style="width:56px;text-align:right">${r0(f.kcal)}${f.per100 ? '<small class="muted">/100' + (f.u || 'g') + '</small>' : ''}</span></button></li>`;
  let list;
  if (!q) {
    const recent = recentFoods();
    const common = [...state.customFoods.map(f => ({ ...f, tag: f.barcode ? '條碼' : '我的' })), ...FOODS.map(f => ({ ...f, tag: f.cat }))];
    list = [...recent, ...common];
    html = (recent.length ? `<div class="section-label">最近吃過</div><ul class="results">${recent.map(row).join('')}</ul>` : '')
      + `<div class="section-label">常見食物</div><ul class="results">${common.map((f, i) => row(f, i + recent.length)).join('')}</ul>`
      + `<p class="muted small">輸入關鍵字，可搜尋衛福部資料庫 ${TFDA.length.toLocaleString()} 種食物。</p>`;
  } else {
    // 名稱完全相符 > 開頭相符 > 名稱包含 > 俗名／分類包含；同分時常見食物優先
    const rank = f => {
      const n = f.name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      if (n.includes(q)) return 2;
      return ((f.kw || '') + ' ' + (f.tag || '')).toLowerCase().includes(q) ? 3 : -1;
    };
    const matched = foodPool().map((f, i) => [rank(f), f.per100 && !f.barcode ? 1 : 0, i, f]).filter(x => x[0] >= 0)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(x => x[3]);
    list = matched.slice(0, MAX_RESULTS);
    html = list.length ? `<ul class="results">${list.map(row).join('')}</ul>`
      + (matched.length > MAX_RESULTS ? `<p class="muted small">共 ${matched.length} 筆，只顯示前 ${MAX_RESULTS} 筆，請輸入更精確的關鍵字。</p>` : '')
      : `<p class="empty">找不到「${esc(sheet.q)}」。<button class="link" data-stab="custom">改用自訂輸入</button></p>`;
  }
  sheet.list = list;
  $('#results').innerHTML = html;
}

function pickFood(f) {
  sheet.picked = f;
  sheet.mult = f.per100 ? (f.unitG || 100) : 1;
  renderSheet();
}

function renderPortion() {
  const f = sheet.picked, m = sheet.mult, u = f.u || 'g';
  const k = portionFactor(f, m);
  let quick, step, desc, unitLabel;
  if (f.per100) {
    const base = f.unitG || 100;
    quick = (f.unitG ? [base / 2, base, base * 1.5, base * 2] : [50, 100, 150, 200]).map(v => [r0(v), `${r0(v)}${u}`]);
    step = 10; unitLabel = u;
    desc = `每 100${u}：${r0(f.kcal)} 大卡${f.unitG ? `，1 份約 ${f.unitG}${u}` : ''}`;
  } else {
    quick = [0.5, 1, 1.5, 2].map(v => [v, `${v} 份`]);
    step = 0.5; unitLabel = '份';
    desc = `1 份 = ${esc(f.unit)}，${r0(f.kcal)} 大卡`;
  }
  const source = f.src === 'off' ? '資料來源：Open Food Facts，請對照包裝營養標示確認。'
    : f.tag === '衛福部' ? '資料來源：衛福部食品營養成分資料庫。' : '';
  return `<div class="card">
      <h3>${esc(f.name)}</h3><p class="muted small" style="margin:2px 0 12px">${desc}</p>
      <div class="stepper"><button class="btn" data-step="${-step}" aria-label="減少">−</button>
        <input class="input num" id="mult" type="number" inputmode="decimal" min="0" step="${f.per100 ? 1 : 0.1}" value="${m}" aria-label="${f.per100 ? '重量' : '份數'}">
        <button class="btn" data-step="${step}" aria-label="增加">＋</button><span class="muted">${unitLabel}</span></div>
      <div class="quick">${quick.map(([v, l]) => `<button data-mult="${v}" class="${m === v ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div class="row"><div class="calc num" id="calc">${r0(f.kcal * k)}</div><span class="muted">大卡</span></div>
      <p class="muted small" id="calc-macro" style="margin:2px 0 0">蛋白 ${r1(f.p * k)} / 碳水 ${r1(f.c * k)} / 脂肪 ${r1(f.f * k)} g</p>
      ${source ? `<p class="muted small" style="margin:8px 0 0">${source}</p>` : ''}
    </div>
    <div class="grid2"><button class="btn" data-back>返回</button>
      <button class="btn primary" data-confirm>加入${mealName()}</button></div>`;
}

function updatePortionCalc() {
  const f = sheet.picked, m = sheet.mult, k = portionFactor(f, m);
  $('#calc').textContent = r0(f.kcal * k);
  $('#calc-macro').textContent = `蛋白 ${r1(f.p * k)} / 碳水 ${r1(f.c * k)} / 脂肪 ${r1(f.f * k)} g`;
  document.querySelectorAll('[data-mult]').forEach(b => b.classList.toggle('active', +b.dataset.mult === m));
}

// ====== 套餐 ======
function renderCombos() {
  if (!state.combos.length) {
    return `<p class="empty">還沒有套餐。在「今日」頁記錄好一餐後，按該餐旁邊的「存成套餐」，下次就能在這裡一鍵加入整組。</p>`;
  }
  return `<ul class="results">${state.combos.map(c => `<li><button data-usecombo="${esc(c.id)}">
      <div class="info">${esc(c.name)}<small>${esc(c.items.map(i => i.name).join('、'))}</small></div>
      <span class="num" style="width:64px;text-align:right">${r0(totals(c.items).kcal)}</span></button></li>`).join('')}</ul>
    <p class="muted small combo-hint">點一下就把整組加入${mealName()}。</p>`;
}

function renderComboSave() {
  const items = state.logs[ui.date]?.filter(e => e.meal === sheet.meal) || [];
  const names = items.map(e => e.name);
  const suggested = names.slice(0, 2).join('＋') + (names.length > 2 ? ' 等' : '');
  return `<form id="combo-form" novalidate>
      <label class="field"><span>套餐名稱</span><input class="input" name="name" maxlength="30" value="${esc(suggested)}" required></label>
      <div class="card" style="padding:4px 16px">
        <ul class="entries" style="margin:0">${items.map(e => `<li><div class="info"><b>${esc(e.name)}</b><small>${esc(e.qty)}</small></div><span class="k num">${r0(e.kcal)}</span></li>`).join('')}</ul>
      </div>
      <p class="muted small">共 ${items.length} 項，${r0(totals(items).kcal)} 大卡</p>
      <button class="btn primary block" type="submit">儲存套餐</button>
    </form>`;
}

// ====== 條碼 ======
const scan = { stream: null, timer: null, decoder: null };

function renderBarcode() {
  const b = sheet.bc || { status: 'idle' };
  let out = '';
  if (b.status === 'scanning') {
    out += `<div class="scanner"><video id="scan-video" playsinline muted></video><div class="scan-frame" aria-hidden="true"></div></div>
      <p class="muted small" style="text-align:center">把條碼放進框內，對準後會自動辨識</p>
      <button class="btn block" data-stopscan>停止掃描</button>`;
  } else {
    out += `<div class="photo-actions">
        <button class="btn primary" data-startscan>用相機掃描</button>
        <label class="btn">從照片辨識<input type="file" accept="image/*" data-scanphoto></label></div>`;
  }
  if (b.status === 'loading') out += `<p class="note">${esc(b.msg)}</p>`;
  if (b.status === 'error') out += `<p class="note warn">${esc(b.msg)}</p>`;
  if (b.status === 'notfound') return out + renderLabelForm(b);
  out += `<form id="barcode-form" class="weight-form" style="margin-top:14px" novalidate>
      <input class="input num" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="14" placeholder="或輸入條碼數字" aria-label="條碼數字">
      <button class="btn" type="submit">查詢</button></form>
    <p class="muted small">掃過或手動輸入過的商品會存到「我的食物」，下次離線也查得到。</p>`;
  return out;
}

function renderLabelForm(b) {
  return `<form id="label-form" novalidate style="margin-top:12px">
    <p class="note">${esc(b.msg)}</p>
    <p class="muted small">條碼：${esc(b.code)}</p>
    <label class="field"><span>商品名稱 *</span><input class="input" name="name" required placeholder="例如：某某牌無糖豆漿"></label>
    <div class="field"><span>依營養標示上的</span>
      <div class="radio-row">
        <label><input type="radio" name="u" value="g" checked><span>每 100 公克</span></label>
        <label><input type="radio" name="u" value="ml"><span>每 100 毫升</span></label>
      </div></div>
    <div class="grid2">
      <label class="field"><span>熱量（大卡）*</span><input class="input" name="kcal" type="number" inputmode="decimal" min="0" step="0.1" required></label>
      <label class="field"><span>蛋白質 g</span><input class="input" name="p" type="number" inputmode="decimal" min="0" step="0.1"></label>
      <label class="field"><span>脂肪 g</span><input class="input" name="f" type="number" inputmode="decimal" min="0" step="0.1"></label>
      <label class="field"><span>碳水化合物 g</span><input class="input" name="c" type="number" inputmode="decimal" min="0" step="0.1"></label>
    </div>
    <label class="field"><span>每一份量（公克或毫升，選填）</span><input class="input" name="unitG" type="number" inputmode="decimal" min="0" step="0.1" placeholder="標示上的「每一份量」"></label>
    <div class="grid2"><button class="btn" type="button" data-bcreset>重新掃描</button><button class="btn primary" type="submit">儲存並選份量</button></div>
  </form>`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('無法載入條碼辨識元件，請確認網路連線'));
    document.head.appendChild(s);
  });
}

// 回傳 decode(canvas) → 條碼字串或 null
function getDecoder() {
  if (scan.decoder) return scan.decoder;
  scan.decoder = (async () => {
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
    if ('BarcodeDetector' in window) {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        if (supported.includes('ean_13')) {
          const det = new BarcodeDetector({ formats: formats.filter(f => supported.includes(f)) });
          return async canvas => (await det.detect(canvas))[0]?.rawValue || null;
        }
      } catch (e) { /* 改用 ZXing */ }
    }
    if (!window.ZXing) await loadScript(ZXING_URL);
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    return async canvas => {
      try {
        const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        return reader.decode(bitmap).getText();
      } catch (e) { return null; } // 這一張沒找到條碼
    };
  })();
  scan.decoder.catch(() => { scan.decoder = null; });
  return scan.decoder;
}

function stopScan() {
  clearTimeout(scan.timer);
  if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
  scan.stream = null;
}

async function startScan() {
  if (!navigator.mediaDevices?.getUserMedia) {
    sheet.bc = { status: 'error', msg: '這個瀏覽器無法開啟相機，請改用「從照片辨識」或輸入條碼數字。' };
    return renderSheet();
  }
  sheet.bc = { status: 'scanning' };
  renderSheet();
  try {
    const [decode, stream] = await Promise.all([
      getDecoder(),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
    ]);
    if (sheet.bc.status !== 'scanning' || $('#sheet').hidden) { stream.getTracks().forEach(t => t.stop()); return; }
    scan.stream = stream;
    const video = $('#scan-video');
    video.srcObject = stream;
    await video.play();
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!scan.stream) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (w) {
        // 只取畫面中間的區塊，辨識比較快
        cv.width = Math.round(w * 0.8); cv.height = Math.round(h * 0.5);
        ctx.drawImage(video, (w - cv.width) / 2, (h - cv.height) / 2, cv.width, cv.height, 0, 0, cv.width, cv.height);
        const code = await decode(cv);
        if (code && scan.stream) {
          stopScan();
          if (navigator.vibrate) navigator.vibrate(60);
          return lookupBarcode(code);
        }
      }
      scan.timer = setTimeout(tick, 250);
    };
    tick();
  } catch (e) {
    stopScan();
    sheet.bc = { status: 'error', msg: e.name === 'NotAllowedError'
      ? '沒有相機權限。請在瀏覽器設定中允許使用相機，或改用「從照片辨識」、輸入條碼數字。'
      : e.name === 'NotFoundError' ? '找不到相機，請改用「從照片辨識」或輸入條碼數字。' : '無法開啟相機：' + e.message };
    renderSheet();
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取圖片')); };
    img.src = url;
  });
}

async function scanImageFile(file) {
  sheet.bc = { status: 'loading', msg: '正在找照片中的條碼…' };
  renderSheet();
  try {
    const [decode, img] = await Promise.all([getDecoder(), loadImage(file)]);
    const cv = document.createElement('canvas');
    // 先用較大尺寸找，找不到再縮小試一次
    for (const max of [1600, 800]) {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, cv.width, cv.height);
      const code = await decode(cv);
      if (code) return lookupBarcode(code);
    }
    sheet.bc = { status: 'error', msg: '照片中找不到條碼。請拍清楚一點、讓條碼置中，或直接輸入條碼數字。' };
  } catch (e) {
    sheet.bc = { status: 'error', msg: e.message };
  }
  renderSheet();
}

async function lookupBarcode(raw) {
  const code = String(raw).replace(/\D/g, '');
  if (code.length < 8 || code.length > 14) {
    sheet.bc = { status: 'error', msg: '條碼應為 8–14 位數字。' };
    return renderSheet();
  }
  const local = state.customFoods.find(f => f.barcode === code);
  if (local) return pickFood({ ...local, tag: '條碼' });
  if (!navigator.onLine) {
    sheet.bc = { status: 'notfound', code, msg: '目前離線，無法查詢線上資料庫。可以先照包裝上的營養標示輸入。' };
    return renderSheet();
  }
  sheet.bc = { status: 'loading', code, msg: `查詢條碼 ${code}…` };
  renderSheet();
  try {
    const food = await fetchProduct(code);
    if (food) {
      state.customFoods.unshift({ id: uid(), ...food });
      save();
      toast('找到商品，已存到我的食物');
      return pickFood({ ...food, tag: '條碼' });
    }
    sheet.bc = { status: 'notfound', code, msg: '資料庫裡沒有這個商品（或缺少熱量資料）。請照包裝上的營養標示輸入，存好後下次掃描就會直接帶出。' };
  } catch (e) {
    sheet.bc = { status: 'notfound', code, msg: `查詢失敗（${e.message}），可以先照包裝上的營養標示輸入。` };
  }
  renderSheet();
}

// 向 Open Food Facts 查詢商品，回傳每 100g/ml 的營養素；查不到或沒有熱量時回傳 null
async function fetchProduct(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const fields = 'product_name,product_name_zh,product_name_zh-tw,generic_name,brands,quantity,serving_quantity,nutriments';
    const res = await fetch(`${OFF_API}${code}.json?fields=${fields}`, { signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('伺服器回應 ' + res.status);
    const data = await res.json();
    const pr = data.product;
    if (data.status !== 1 || !pr) return null;
    const n = pr.nutriments || {};
    let kcal = n['energy-kcal_100g'];
    if (kcal == null && n['energy-kj_100g'] != null) kcal = n['energy-kj_100g'] / 4.184;
    if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184; // energy_100g 單位為 kJ
    if (kcal == null) return null;
    const title = pr['product_name_zh-tw'] || pr.product_name_zh || pr.product_name || pr.generic_name || '';
    const brand = (pr.brands || '').split(',')[0].trim();
    const name = (brand && !title.includes(brand) ? `${brand} ${title}` : title).trim() || `商品 ${code}`;
    return {
      name, per100: true, u: /\d\s*(ml|cl|l|毫升|公升)/i.test(pr.quantity || '') ? 'ml' : 'g',
      kcal: r1(kcal), p: r1(n.proteins_100g), c: r1(n.carbohydrates_100g), f: r1(n.fat_100g),
      unitG: r1(pr.serving_quantity), barcode: code, src: 'off',
    };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '連線逾時' : e.message === 'Failed to fetch' ? '無法連線' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

function renderCustom() {
  return `<form id="custom-form" novalidate>
    ${sheet.photo ? `<img class="thumb" src="${sheet.photo}" alt="剛剛拍的食物照片">` : ''}
    <label class="field"><span>食物名稱 *</span><input class="input" name="name" required placeholder="例如：媽媽煮的咖哩飯"></label>
    <label class="field"><span>份量描述</span><input class="input" name="unit" placeholder="例如：1 盤"></label>
    <label class="field"><span>熱量（大卡）*</span><input class="input" name="kcal" type="number" inputmode="decimal" min="0" required></label>
    <div class="grid3">
      <label class="field"><span>蛋白質 g</span><input class="input" name="p" type="number" inputmode="decimal" min="0" step="0.1"></label>
      <label class="field"><span>碳水 g</span><input class="input" name="c" type="number" inputmode="decimal" min="0" step="0.1"></label>
      <label class="field"><span>脂肪 g</span><input class="input" name="f" type="number" inputmode="decimal" min="0" step="0.1"></label>
    </div>
    <label class="check"><input type="checkbox" name="keep" checked> 存到我的食物，下次直接搜尋</label>
    <button class="btn primary block" type="submit">加入${MEALS.find(x => x.id === sheet.meal).name}</button>
  </form>`;
}

function renderPhoto() {
  let out = `<div class="photo-actions">
      <label class="btn primary">拍照<input type="file" accept="image/*" capture="environment" data-photo></label>
      <label class="btn">從相簿選擇<input type="file" accept="image/*" data-photo></label></div>`;
  if (sheet.photo) out += `<img class="preview" src="${sheet.photo}" alt="食物照片預覽">`;
  const manual = `<button class="btn block" style="margin-top:12px" data-stab="custom">用這張照片手動輸入</button>`;
  if (!aiConfig().endpoint) {
    out += `<p class="note">尚未設定 AI 後端。請到「個人設定 → AI 拍照辨識」填入後端網址；現在也可以先拍照，再到「自訂」手動輸入熱量。</p>`;
    return out + (sheet.photo ? manual : '');
  }
  if (!sheet.photo) {
    return out + `<p class="note">拍下整份餐點，盡量從斜上方拍、讓餐具入鏡，AI 比較能判斷份量。</p>`;
  }
  if (!sheet.ai) {
    out += `<label class="field" style="margin-top:12px"><span>補充說明（選填）</span>
        <input class="input" id="ai-note" maxlength="200" placeholder="例如：飯只吃一半、無糖、去皮" value="${esc(sheet.aiNote)}"></label>
      <button class="btn primary block" data-analyze ${sheet.aiBusy ? 'disabled' : ''}>${sheet.aiBusy ? '辨識中，約需 10–30 秒…' : '開始辨識'}</button>`;
    return out;
  }
  const meta = sheet.aiMeta || {};
  if (!sheet.ai.length) {
    return out + `<p class="note warn">沒有辨識到食物。${esc(meta.note || '')}</p>${manual}`;
  }
  const total = sheet.ai.reduce((s, it) => s + it.kcal, 0);
  out += `<p class="note ${meta.confidence === 'low' ? 'warn' : ''}">${CONFIDENCE[meta.confidence] || ''}。${esc(meta.note || '')}
      AI 估算的份量可能有 20–30% 誤差，請確認或修改熱量後再加入。</p>
    <div id="ai-list">${sheet.ai.map((it, i) => `<div class="ai-item">
      <input type="checkbox" data-ai-check="${i}" checked aria-label="選取 ${esc(it.name)}">
      <div><input class="input" data-ai-name="${i}" value="${esc(it.name)}" aria-label="名稱">
        <small class="muted">${esc(it.portion)}${it.grams ? `（約 ${r0(it.grams)}g）` : ''} · 蛋白 ${r1(it.p)} / 碳水 ${r1(it.c)} / 脂肪 ${r1(it.f)} g</small></div>
      <input class="input num" data-ai-kcal="${i}" type="number" min="0" value="${r0(it.kcal)}" aria-label="${esc(it.name)} 熱量（大卡）"></div>`).join('')}</div>
    <p class="muted small" style="margin:8px 0 0">合計約 ${r0(total)} 大卡</p>
    <div class="grid2" style="margin-top:12px"><button class="btn" data-analyze-again>重新辨識</button>
      <button class="btn primary" data-ai-add>加入選取的項目</button></div>`;
  return out;
}

// 把照片縮到最長邊 1024px，減少上傳量
function resizeImage(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s);
      cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取圖片')); };
    img.src = url;
  });
}

async function analyzePhoto() {
  const { endpoint, token } = aiConfig();
  if (!navigator.onLine) return toast('目前離線，無法使用 AI 辨識');
  sheet.aiBusy = true; renderSheet();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Token': token },
      body: JSON.stringify({ image: sheet.photo, note: sheet.aiNote }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '伺服器回應 ' + res.status);
    if (!Array.isArray(data.items)) throw new Error('回傳格式錯誤');
    sheet.ai = data.items.map(it => ({
      name: String(it.name || '未命名'), portion: String(it.portion || '1 份'), grams: num(it.grams),
      kcal: num(it.kcal), p: num(it.protein), c: num(it.carb), f: num(it.fat),
    }));
    sheet.aiMeta = { confidence: data.confidence, note: String(data.note || '') };
  } catch (e) {
    toast('辨識失敗：' + (e.message === 'Failed to fetch' ? '無法連到後端，請確認網址' : e.message));
  }
  sheet.aiBusy = false; renderSheet();
}

function addEntry({ name, qty, kcal, p, c, f, src, base }) {
  const list = state.logs[ui.date] || (state.logs[ui.date] = []);
  list.push({ id: uid(), meal: sheet.meal, name, qty, kcal: r1(kcal), p: r1(p), c: r1(c), f: r1(f), src, base, at: Date.now() });
  save();
}

// ====== 事件 ======
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) setTab(b.dataset.tab);
});
$('#fab').addEventListener('click', () => openSheet());

$('#view').addEventListener('click', e => {
  const t = e.target.closest('button, li[data-open]');
  if (!t) return;
  if (t.dataset.go) setTab(t.dataset.go);
  else if (t.dataset.add) openSheet(t.dataset.add);
  else if (t.dataset.day) {
    const next = addDays(ui.date, +t.dataset.day);
    if (next <= today()) { ui.date = next; render(); }
  }
  else if ('today' in t.dataset) { ui.date = today(); render(); }
  else if (t.dataset.del) {
    const list = state.logs[ui.date] || [];
    const i = list.findIndex(x => x.id === t.dataset.del);
    if (i >= 0) {
      const [removed] = list.splice(i, 1);
      if (!list.length) delete state.logs[ui.date];
      save(); render(); toast(`已刪除「${removed.name}」`);
    }
  }
  else if (t.dataset.range) { ui.histRange = +t.dataset.range; render(); }
  else if (t.dataset.hview) { ui.histView = t.dataset.hview; render(); }
  else if (t.dataset.wrange) { ui.wRange = +t.dataset.wrange; render(); }
  else if (t.dataset.delweight) {
    const k = t.dataset.delweight;
    if (!confirm(`刪除 ${fmtDate(k, true)} 的體重紀錄？`)) return;
    delete state.weights[k];
    syncProfileWeight();
    save(); render();
  }
  else if (t.dataset.open) { ui.date = t.dataset.open; setTab('today'); }
  else if (t.dataset.delfood) {
    state.customFoods = state.customFoods.filter(f => f.id !== t.dataset.delfood);
    save(); render();
  }
  else if (t.dataset.delcombo) {
    const c = state.combos.find(x => x.id === t.dataset.delcombo);
    if (!c || !confirm(`刪除套餐「${c.name}」？`)) return;
    state.combos = state.combos.filter(x => x !== c);
    save(); render();
  }
  else if (t.dataset.savecombo) openSheet(t.dataset.savecombo, 'combo');
  else if ('export' in t.dataset) exportData();
  else if ('reset' in t.dataset) {
    if (confirm('確定要清除所有資料嗎？此動作無法復原，建議先匯出備份。')) {
      localStorage.removeItem(STORE_KEY);
      state = emptyState();
      setTab('settings');
    }
  }
  else if ('install' in t.dataset && deferredInstall) {
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(() => { deferredInstall = null; render(); });
  }
});
$('#view').addEventListener('submit', e => {
  const form = e.target;
  if (form.id === 'profile-form') { e.preventDefault(); saveProfile(form); }
  else if (form.id === 'ai-form') {
    e.preventDefault();
    const endpoint = form.endpoint.value.trim();
    if (endpoint && !/^https:\/\/|^http:\/\/localhost[:/]/.test(endpoint)) return toast('後端網址需以 https:// 開頭');
    state.ai = { endpoint, token: form.token.value.trim() };
    save(); render(); toast(endpoint ? 'AI 設定已儲存' : '已關閉 AI 辨識');
  }
  else if (form.dataset.wdate) {
    e.preventDefault();
    const kg = parseFloat(form.kg.value);
    if (!(kg >= 25 && kg <= 300)) return toast('請輸入正確的體重（25–300 kg）');
    const synced = saveWeight(form.dataset.wdate, kg);
    render();
    toast(synced ? '已記錄，每日目標已依新體重更新' : '已記錄體重');
  }
});
$('#view').addEventListener('change', e => {
  if ('import' in e.target.dataset && e.target.files[0]) importData(e.target.files[0]);
});

const sheetEl = $('#sheet');
sheetEl.addEventListener('click', e => {
  const t = e.target.closest('[data-close], button');
  if (!t) return;
  if ('close' in t.dataset) return closeSheet();
  if (t.dataset.meal) {
    sheet.meal = t.dataset.meal;
    const label = '加入' + MEALS.find(x => x.id === sheet.meal).name;
    document.querySelectorAll('[data-meal]').forEach(b => b.classList.toggle('active', b.dataset.meal === sheet.meal));
    document.querySelectorAll('#sheet [data-confirm], #custom-form [type=submit]').forEach(b => { b.textContent = label; });
    const hint = $('#sheet .combo-hint');
    if (hint) hint.textContent = `點一下就把整組加入${mealName()}。`;
  }
  else if (t.dataset.stab) { sheet.tab = t.dataset.stab; renderSheet(); }
  else if (t.dataset.pick) pickFood(sheet.list[+t.dataset.pick]);
  else if (t.dataset.mult) { sheet.mult = +t.dataset.mult; $('#mult').value = sheet.mult; updatePortionCalc(); }
  else if (t.dataset.step) {
    const step = +t.dataset.step;
    sheet.mult = Math.max(Math.abs(step), r1(sheet.mult + step));
    $('#mult').value = sheet.mult; updatePortionCalc();
  }
  else if ('back' in t.dataset) { sheet.picked = null; renderSheet(); }
  else if ('confirm' in t.dataset) {
    const f = sheet.picked, m = sheet.mult;
    if (!(m > 0)) return toast(f.per100 ? '請輸入重量' : '請輸入份數');
    const k = portionFactor(f, m);
    const qty = f.per100 ? `${r1(m)}${f.u || 'g'}` : m === 1 ? f.unit : `${m} × ${f.unit}`;
    const amounts = { kcal: f.kcal * k, p: f.p * k, c: f.c * k, f: f.f * k };
    // 以每 100g 計的食物，記住這次的克數，之後「最近吃過」直接帶入同樣份量
    const base = f.per100 ? { unit: qty, ...amounts } : { unit: f.unit, kcal: f.kcal, p: f.p, c: f.c, f: f.f };
    addEntry({ name: f.name, qty, ...amounts, src: f.src || 'db', base });
    closeSheet(); render(); toast(`已加入 ${f.name}`);
  }
  else if (t.dataset.usecombo) {
    const c = state.combos.find(x => x.id === t.dataset.usecombo);
    if (!c) return;
    c.items.forEach(it => addEntry({ ...it, src: 'combo' }));
    closeSheet(); render(); toast(`已加入「${c.name}」共 ${c.items.length} 項`);
  }
  else if ('startscan' in t.dataset) startScan();
  else if ('stopscan' in t.dataset) { stopScan(); sheet.bc = { status: 'idle' }; renderSheet(); }
  else if ('bcreset' in t.dataset) { sheet.bc = { status: 'idle' }; renderSheet(); }
  else if ('analyze' in t.dataset) analyzePhoto();
  else if ('analyzeAgain' in t.dataset) { sheet.ai = null; sheet.aiMeta = null; renderSheet(); }
  else if ('aiAdd' in t.dataset) {
    let n = 0;
    sheet.ai.forEach((it, i) => {
      if (!$(`[data-ai-check="${i}"]`).checked) return;
      const name = $(`[data-ai-name="${i}"]`).value.trim() || it.name;
      const kcal = num($(`[data-ai-kcal="${i}"]`).value);
      // 使用者改了熱量時，三大營養素等比例調整
      const k = it.kcal ? kcal / it.kcal : 0;
      const qty = it.portion + (it.grams ? `（約 ${r0(it.grams)}g）` : '');
      const p = it.p * k, c = it.c * k, f = it.f * k;
      addEntry({ name, qty, kcal, p, c, f, src: 'ai', base: { unit: qty, kcal, p, c, f } });
      n++;
    });
    if (!n) return toast('請至少選取一項');
    closeSheet(); render(); toast(`已加入 ${n} 項`);
  }
});
sheetEl.addEventListener('input', e => {
  if (e.target.id === 'q') { sheet.q = e.target.value; renderResults(); }
  else if (e.target.id === 'ai-note') sheet.aiNote = e.target.value;
  else if (e.target.id === 'mult') {
    const v = parseFloat(e.target.value);
    if (v > 0) { sheet.mult = v; updatePortionCalc(); }
  }
});
sheetEl.addEventListener('change', async e => {
  if (!e.target.files || !e.target.files[0]) return;
  if ('scanphoto' in e.target.dataset) return scanImageFile(e.target.files[0]);
  if (!('photo' in e.target.dataset)) return;
  try {
    sheet.photo = await resizeImage(e.target.files[0]);
    sheet.ai = null;
    sheet.aiMeta = null;
    renderSheet();
  } catch (err) { toast(err.message); }
});
sheetEl.addEventListener('submit', e => {
  const form = e.target;
  if (form.id === 'barcode-form') {
    e.preventDefault();
    return lookupBarcode(form.code.value);
  }
  if (form.id === 'label-form') {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const kcalRaw = String(fd.get('kcal') || '').trim();
    if (!name) return toast('請輸入商品名稱');
    if (kcalRaw === '' || !(parseFloat(kcalRaw) >= 0)) return toast('請輸入熱量');
    const food = {
      id: uid(), name, per100: true, u: fd.get('u') === 'ml' ? 'ml' : 'g',
      kcal: num(kcalRaw), p: num(fd.get('p')), c: num(fd.get('c')), f: num(fd.get('f')),
      unitG: r1(num(fd.get('unitG'))), barcode: sheet.bc.code, src: 'label',
    };
    state.customFoods = state.customFoods.filter(x => x.barcode !== food.barcode);
    state.customFoods.unshift(food);
    save();
    toast('已存到我的食物，下次掃描會直接帶出');
    return pickFood({ ...food, tag: '條碼' });
  }
  if (form.id === 'combo-form') {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) return toast('請輸入套餐名稱');
    const items = (state.logs[ui.date] || []).filter(x => x.meal === sheet.meal)
      .map(({ name, qty, kcal, p, c, f, base }) => ({ name, qty, kcal, p, c, f, base }));
    if (!items.length) return toast('這一餐沒有項目');
    state.combos.unshift({ id: uid(), name, items });
    save();
    closeSheet();
    return toast(`已存成套餐「${name}」`);
  }
  if (form.id !== 'custom-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = String(fd.get('name') || '').trim();
  const kcalRaw = String(fd.get('kcal') || '').trim();
  if (!name) return toast('請輸入食物名稱');
  if (kcalRaw === '' || !(parseFloat(kcalRaw) >= 0)) return toast('請輸入熱量');
  const food = { name, unit: String(fd.get('unit') || '').trim() || '1 份', kcal: num(kcalRaw), p: num(fd.get('p')), c: num(fd.get('c')), f: num(fd.get('f')) };
  if (fd.get('keep') && !state.customFoods.some(x => x.name === name)) state.customFoods.unshift({ id: uid(), ...food });
  addEntry({ ...food, qty: food.unit, src: 'custom', base: { ...food } });
  closeSheet(); render(); toast(`已加入 ${name}`);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheetEl.hidden) closeSheet(); });

// 跨過午夜後回到前景時，自動切到新的一天
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = today();
  if (t !== lastToday) { if (ui.date === lastToday) ui.date = t; lastToday = t; render(); }
});

// ====== PWA ======
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  if (ui.tab === 'settings') render();
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

setTab(ui.tab);
