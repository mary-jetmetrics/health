'use strict';
// Здоровье: вес, жир, состав тела и шаги в динамике, средние за день, неделю, месяц, квартал, полгода и год.
// Оболочка публичная, данные — в закрытом репозитории mary-jetmetrics/health-data (health.json собирает
// build_data.py из выгрузки Apple Health), доступ по ключу, который вводится один раз на устройстве.
const OWNER = 'mary-jetmetrics', REPO = 'health-data', BRANCH = 'main', FILE = 'health.json';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* без хранилища — войдёт заново */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* нечего удалять */ } },
};
// свой ключ или ключ «Поездок», «Книг», гардероба (тот же сайт, общее хранилище): если ему дан доступ к health-data, вводить ничего не надо
let TOKEN = LS.get('hl-token') || LS.get('trips-token') || LS.get('bk-token') || LS.get('wardrobe-token');
let D = null, DAYS = [], FIRST = 0, LAST = 0, PICOOC = null, loadedAt = 0;
const root = document.getElementById('root');

/* ---------- общее ---------- */
const MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MON_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_D = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const MON_S = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const ROM = ['I', 'II', 'III', 'IV'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return (m > 10 && m < 20) ? c : k === 1 ? a : (k >= 2 && k <= 4) ? b : c; };
const pad = n => String(n).padStart(2, '0');
// числа: запятая, разряды через неразрывный пробел, минус — настоящий
const num = (v, d = 0) => { const [i, f] = Math.abs(v).toFixed(d).split('.'); return (v < 0 && +Math.abs(v).toFixed(d) ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? ',' + f : ''); };
const signed = (v, d = 0) => { const r = +v.toFixed(d); return (r > 0 ? '+' : r < 0 ? '−' : '±') + num(Math.abs(r), d); };
const WAVE = '<svg class="ls-wave" viewBox="0 0 190 8" aria-hidden="true"><path d="M1 4 Q 6 0 11 4 T 21 4 T 31 4 T 41 4 T 51 4 T 61 4 T 71 4 T 81 4 T 91 4 T 101 4 T 111 4 T 121 4 T 131 4 T 141 4 T 151 4 T 161 4 T 171 4 T 181 4"/></svg>';
const head = sub => `<header class="head"><h1 class="ls-title">Здоровье</h1>${WAVE}${sub ? `<p class="cap">${sub}</p>` : ''}</header>`;

/* ---------- даты: дни в UTC, чтобы пояс браузера не сдвигал границы ---------- */
const DAY = 864e5;
const toT = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const ymd = t => { const d = new Date(t); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };
const ddmm = t => { const [, m, d] = ymd(t); return `${pad(d)}.${pad(m + 1)}`; };
function pStart(g, t) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (g === 'day') return t;
  if (g === 'week') return t - ((d.getUTCDay() + 6) % 7) * DAY;   // неделя с понедельника
  if (g === 'month') return Date.UTC(y, m, 1);
  if (g === 'quarter') return Date.UTC(y, m - m % 3, 1);
  if (g === 'half') return Date.UTC(y, m < 6 ? 0 : 6, 1);
  return Date.UTC(y, 0, 1);
}
function pNext(g, t) {
  if (g === 'day') return t + DAY;
  if (g === 'week') return t + 7 * DAY;
  const [y, m] = ymd(t);
  return Date.UTC(y, m + { month: 1, quarter: 3, half: 6, year: 12 }[g], 1);
}
// подпись периода: «12 октября 2026», «6–12 октября 2026», «октябрь 2026», «III квартал 2026», «2-е полугодие 2026», «2026 год»
function pLabel(g, t) {
  const [y, m, d] = ymd(t);
  if (g === 'day') return `${d} ${MON_G[m]} ${y}`;
  if (g === 'week') {
    const [y2, m2, d2] = ymd(t + 6 * DAY);
    if (m === m2) return `${d}–${d2} ${MON_G[m2]} ${y2}`;
    return `${d} ${MON_G[m]}${y !== y2 ? ' ' + y : ''} – ${d2} ${MON_G[m2]} ${y2}`;
  }
  if (g === 'month') return `${MON[m]} ${y}`;
  if (g === 'quarter') return `${ROM[m / 3]} квартал ${y}`;
  if (g === 'half') return `${m < 6 ? '1-е' : '2-е'} полугодие ${y}`;
  return `${y} год`;
}
// «к чему» сравниваем: «к сентябрю», «к 10 октября», «к прошлой неделе», «к III кварталу 2025»; год пишется, только если он другой
function pTo(g, t, cur) {
  const [y, m, d] = ymd(t), yy = ymd(cur)[0] !== y ? ' ' + y : '';
  if (g === 'day') return pNext(g, t) === cur ? 'ко дню раньше' : `к ${d} ${MON_G[m]}${yy}`;
  if (g === 'week') return pNext(g, t) === cur ? 'к прошлой неделе' : `к неделе с ${d} ${MON_G[m]}${yy}`;
  if (g === 'month') return `к ${MON_D[m]}${yy}`;
  if (g === 'quarter') return `к ${ROM[m / 3]} кварталу${yy}`;
  if (g === 'half') return `к ${m < 6 ? '1-му' : '2-му'} полугодию${yy}`;
  return `к ${y} году`;
}

/* ---------- настройки экрана ---------- */
const GS = [['day', 'день'], ['week', 'неделю'], ['month', 'месяц'], ['quarter', 'квартал'], ['half', 'полгода'], ['year', 'год']];
// показ: с начала недели / месяца / года, последние N дней, всё время (Мария, 29.10.26); третье — подсказка на кнопке
const RS = [['wtd', 'WTD', 'с начала недели'], ['mtd', 'MTD', 'с начала месяца'], ['ytd', 'YTD', 'с начала года'],
  ['30d', '30 дней', 'последние 30 дней'], ['90d', '90 дней', 'последние 90 дней'], ['180d', '180 дней', 'последние 180 дней'], ['all', 'всё время', 'с первого замера']];
const R_DEF = { day: '90d', week: '180d', month: 'all', quarter: 'all', half: 'all', year: 'all' };   // показ по умолчанию для шага
const saved = (() => { try { return JSON.parse(LS.get('hl-ui') || '{}'); } catch (e) { return {}; } })();
const UI = {
  g: GS.some(x => x[0] === saved.g) ? saved.g : 'month',
  r: RS.some(x => x[0] === saved.r) ? saved.r : null,
  act: saved.act === 's' ? 's' : 'a',   // активность: a — калории кольца «Движение» (по умолчанию), s — шаги
  hover: null,
};
if (!UI.r) UI.r = R_DEF[UI.g];
const keepUI = () => LS.set('hl-ui', JSON.stringify({ g: UI.g, r: UI.r, act: UI.act }));
const COARSE = () => ['month', 'quarter', 'half', 'year'].includes(UI.g);   // цвет «лучше / хуже» — только от месяца: день к дню у весов — вода

/* ---------- периоды и средние ---------- */
// начало показа — от последнего дня с данными; первый период берётся целиком, как и остальные
function rangeStart(g, r) {
  const [y, m] = ymd(LAST);
  const from = r === 'all' ? FIRST : r === 'wtd' ? pStart('week', LAST) : r === 'mtd' ? Date.UTC(y, m, 1)
    : r === 'ytd' ? Date.UTC(y, 0, 1) : LAST - (parseInt(r, 10) - 1) * DAY;
  return Math.max(pStart(g, FIRST), pStart(g, from));
}
const slotCount = (g, r) => { let n = 0; for (let t = rangeStart(g, r); t <= LAST; t = pNext(g, t)) n++; return n; };
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
// слот = период; в каждом среднее по дням, где есть значение, число таких дней и последний день
function buildSlots() {
  const slots = [];
  let k = 0;
  for (let t = rangeStart(UI.g, UI.r); t <= LAST; t = pNext(UI.g, t)) {
    const e = pNext(UI.g, t), acc = { w: [], f: [], s: [], a: [] }, last = {};
    while (k < DAYS.length && DAYS[k].t < t) k++;
    for (; k < DAYS.length && DAYS[k].t < e; k++) {
      const x = DAYS[k];
      for (const key of ['w', 'f', 's', 'a']) if (x[key] != null) { acc[key].push(x[key]); last[key] = x.t; }
    }
    const v = {};
    for (const key in acc) v[key] = avg(acc[key]);
    slots.push({ t, e, v, n: { w: acc.w.length, f: acc.f.length, s: acc.s.length, a: acc.a.length }, last, part: e - DAY > LAST });
  }
  return slots;
}

/* ---------- графики ---------- */
const TIP_W = 'Среднее по дням с замером; если взвешивалась несколько раз за день — среднее за день. Вес — с весов и ручных записей в «Здоровье». Столбцы начинаются не с нуля, а с низа шкалы — иначе разница в килограмм не видна.';
const TIP_F = 'Пунктир по горизонтали — цель 30%. Весы считают жир через воду в теле, поэтому день ото дня он прыгает: внутри месяца разброс до ±2,7 п. п. Сравнивай месяцами, а не днями. Пунктир по вертикали — смена весов: до февраля 2025 Zepp Life, после — PICOOC; приборы считают по-разному, скачок на стыке может быть от весов, а не от тела.';
const TIP_S = 'Шаги с айфона и часов без двойного счёта: за каждый час берётся тот, кто насчитал больше (с айфона после 12.10.2026 — только часы). Среднее за день по дням с данными; сегодняшний день не берётся — он неполный.';
const TIP_A = 'Калории кольца «Движение» — активная энергия, которую считают часы. С 20.04.2024: кольцо было и раньше, но без часов айфон считал в 7–10 раз меньше, такие цифры не сравнимы. Среднее за день по дням с данными; сегодняшний день не берётся — он неполный.';
// sign: −1 — меньше значит лучше, +1 — больше лучше, 0 — без оценки
const CHARTS = [
  { id: 'w', title: 'Вес', tip: TIP_W, kind: 'bars', zero: false, key: 'w', nkey: 'w', unit: 'кг', d: 1, du: 'кг', sign: 0, h: 168, color: 'weight' },
  // жир: линия в % со шкалой от 25%, пунктир — цель 30% (Мария, 23.10.26)
  { id: 'f', title: 'Жир', tip: TIP_F, kind: 'line', key: 'f', nkey: 'f', unit: '%', d: 1, du: 'п.\u00a0п.', sign: -1, h: 168, scales: true, from: 25, goal: 30 },
  // активность — переключатель «шаги / ккал» (Мария, 24.10.26): поля подставляются из ACT[UI.act]
  { id: 's', title: 'Активность', kind: 'bars', d: 0, sign: 1, h: 150, act: true },
];

function niceScale(min, max, count, fromZero) {
  if (fromZero) min = 0;
  if (min === max) { min -= 1; max += 1; }
  const span = max - min, raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { lo, hi, ticks, dec: step < 1 ? 1 : 0 };
}
// шкала времени: подписи месяцев, кварталов или лет — самые частые, какие помещаются
function xTicks(slots, gw) {
  const cand = [];
  slots.forEach((s, i) => {
    let t = s.t;   // первое 1-е число месяца внутри слота
    const [y, m, d] = ymd(t);
    if (d !== 1) t = Date.UTC(y, m + 1, 1);
    if (t < s.e) cand.push({ i, m: ymd(t)[1], y: ymd(t)[0] });
  });
  const levels = [c => true, c => c.m % 3 === 0, c => c.m === 0, c => c.m === 0 && c.y % 2 === 0, c => c.m === 0 && c.y % 5 === 0];
  for (const ok of levels) {
    const pick = cand.filter(ok);
    const minGap = Math.min(...pick.slice(1).map((c, j) => (c.i - pick[j].i) * gw));
    if (pick.length <= 1 || minGap >= 40) return pick.map(c => ({ i: c.i, label: c.m === 0 ? String(c.y) : MON_S[c.m] }));
  }
  return [];
}
let GEO = null;   // общая геометрия для наведения: все графики на одной шкале времени
function plot(c, slots) {
  const W = GEO.W, H = c.h, { pl, pr, pt, pb } = GEO, ph = H - pt - pb, n = slots.length, gw = GEO.gw;
  const cx = i => pl + gw * (i + 0.5);
  let out = '', sc;
  const vals = slots.map(s => s.v[c.key]).filter(v => v != null);
  if (c.from != null) {
    // шкала от заданного начала (жир — от 25%): шаг подбирается, чтобы делений было не больше четырёх и цель попадала внутрь
    const top = Math.max(c.goal || c.from, ...vals), step = [1, 2, 2.5, 5, 10].find(k => (top - c.from) / k <= 4) || 10;
    const n = Math.max(1, Math.ceil((top - c.from) / step - 1e-9));
    sc = { lo: c.from, hi: c.from + n * step, ticks: Array.from({ length: n + 1 }, (_, i) => c.from + i * step), dec: step < 1 ? 1 : 0 };
  } else {
    sc = vals.length ? niceScale(Math.min(...vals), Math.max(...vals), 4, c.kind === 'bars' && c.zero !== false) : { lo: 0, hi: 1, ticks: [], dec: 0 };
  }
  const y = v => pt + ph - (v - sc.lo) / (sc.hi - sc.lo) * ph;
  GEO.y[c.id] = y;
  // сетка и подписи значений
  sc.ticks.forEach((v, i) => {
    out += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="yl" x="${pl - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${num(v, sc.dec)}${c.from != null ? '%' : ''}</text>`;
  });
  // подписи времени: в месяцах и крупнее слот — сам период, подпись по центру, под точкой (Мария, 24.10.26);
  // в днях и неделях — у начала месяца. У краёв подпись прижимается внутрь, чтобы не вылезать за блок
  const mid = COARSE();
  for (const tk of xTicks(slots, gw)) {
    const x = pl + gw * (tk.i + (mid ? 0.5 : 0));
    const anchor = W - pr - x < (mid ? 14 : 30) ? 'end' : mid && x - pl < 14 ? 'start' : mid ? 'middle' : 'start';
    out += `<text class="xl" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${tk.label}</text><line class="tick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pt + ph}" y2="${pt + ph + 4}"/>`;
  }
  // разрыв линии, если замеров не было дольше: неделя для дней, две недели для недель, иначе любой пропуск;
  // у жира и состава — ещё и на смене весов: два прибора одной линией не соединяем
  const maxGap = UI.g === 'day' ? 7 : UI.g === 'week' ? 2 : 1;
  const bi = c.scales && PICOOC ? slots.findIndex(s => PICOOC < s.e) : -1;
  const runs = key => {
    const r = []; let cur = [], prev = -99;
    slots.forEach((s, i) => { if (s.v[key] == null) return; if ((i - prev > maxGap || (bi > 0 && prev < bi && i >= bi)) && cur.length) { r.push(cur); cur = []; } cur.push(i); prev = i; });
    if (cur.length) r.push(cur);
    return r;
  };
  const bars = (key, yy, cls) => {
    const bw = Math.max(1, Math.min(28, gw * (gw > 6 ? 0.62 : 0.8))), rx = bw >= 6 ? 2 : 0;
    slots.forEach((s, i) => {
      const v = s.v[key]; if (v == null) return;
      const top = yy(v), hgt = Math.max(1, pt + ph - top);
      out += `<rect class="${cls}" x="${(cx(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" rx="${rx}"/>`;
    });
  };
  if (c.kind === 'bars') bars(c.key, y, c.color ? 'bar ' + c.color : 'bar');
  if (c.goal) {
    const gy = y(c.goal).toFixed(1);
    out += `<line class="goal" x1="${pl}" x2="${W - pr}" y1="${gy}" y2="${gy}"/><text class="mk" x="${pl + 6}" y="${(+gy - 5).toFixed(1)}">цель ${c.goal}%</text>`;
  }
  if (c.kind === 'line') {
    const dots = n <= 70;
    for (const run of runs(c.key)) {
      if (run.length > 1) out += `<path class="ln" d="${run.map((i, j) => `${j ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(slots[i].v[c.key]).toFixed(1)}`).join('')}"/>`;
      if (dots || run.length === 1) out += run.map(i => `<circle class="pt" cx="${cx(i).toFixed(1)}" cy="${y(slots[i].v[c.key]).toFixed(1)}" r="${dots ? 2.5 : 1.8}"/>`).join('');
    }
  }
  // подписи значений, светлые (Мария, 24.10.26): у каждой точки, если помещаются; тесно — через одну-две, последняя всегда.
  // У краёв подпись прижимается внутрь, у верха графика — уходит под точку
  const idx = slots.map((s, i) => s.v[c.key] != null ? i : -1).filter(i => i >= 0);
  if (idx.length) {
    const lbl = v => num(v, c.d), wpx = Math.max(...idx.map(i => lbl(slots[i].v[c.key]).length)) * 5.8 + 6;
    const k = Math.max(1, Math.ceil(wpx / gw));
    let prev = Infinity, prevL = Infinity;   // prevL — левый край последней поставленной подписи: прижатая к краю не наезжает на соседнюю
    for (let q = idx.length - 1; q >= 0; q--) {
      const i = idx[q];
      if (prev - i < k) continue;
      const v = slots[i].v[c.key], x = cx(i), yy = y(v);
      const ty = c.kind === 'bars' ? Math.max(pt + 2, yy - 4) : (yy - 8 < pt + 6 ? yy + 15 : yy - 8);
      const anchor = x + wpx / 2 > W - pr + 4 ? 'end' : x - wpx / 2 < pl - 4 ? 'start' : 'middle';
      const L = anchor === 'end' ? x - wpx : anchor === 'start' ? x : x - wpx / 2;
      if (L + wpx > prevL) continue;
      prev = i; prevL = L;
      out +=`<text class="dv" x="${x.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}">${lbl(v)}</text>`;
    }
  }
  // смена весов: Zepp Life → PICOOC
  if (c.scales && PICOOC && PICOOC >= slots[0].t && PICOOC <= LAST) {
    const i = slots.findIndex(s => PICOOC >= s.t && PICOOC < s.e), x = pl + gw * i;
    out += `<line class="mark" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pt}" y2="${pt + ph}"/>`;
    if (x - pl > 60) out += `<text class="mk" x="${(x - 5).toFixed(1)}" y="${pt + 10}" text-anchor="end">Zepp Life</text>`;
    if (W - pr - x > 50) out += `<text class="mk" x="${(x + 5).toFixed(1)}" y="${pt + 10}">PICOOC</text>`;
  }
  out += `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${pt + ph}" y2="${pt + ph}"/>`;
  out += `<g class="hov" id="hv-${c.id}" visibility="hidden"><line class="xh" y1="${pt}" y2="${pt + ph}"/></g>`;
  return `<svg class="plot" data-c="${c.id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}: средние по периодам">${out}</svg>`;
}

const ACT = {
  s: { key: 's', nkey: 's', unit: 'шагов в день', du: '', tip: TIP_S, color: '' },
  a: { key: 'a', nkey: 'a', unit: 'ккал в день', du: 'ккал', tip: TIP_A, color: 'move' },
};
const setAct = () => CHARTS.forEach(c => c.act && Object.assign(c, ACT[UI.act]));
setAct();

/* ---------- цифра над графиком: выбранный период или последний с данными ---------- */
let SLOTS = [];
const lastWith = nkey => { for (let i = SLOTS.length - 1; i >= 0; i--) if (SLOTS[i].n[nkey]) return i; return -1; };
const prevWith = (nkey, i) => { for (let j = i - 1; j >= 0; j--) if (SLOTS[j].n[nkey]) return j; return -1; };
function deltaHtml(v, pv, spec, j, i) {
  const diff = +(v - pv).toFixed(spec.d);
  const cls = !COARSE() || !spec.sign || !diff ? '' : (diff * spec.sign > 0 ? 'good' : 'bad');
  return `<span class="dl ${cls}">${signed(diff, spec.d)}${spec.du ? ' ' + spec.du : ''} ${pTo(UI.g, SLOTS[j].t, SLOTS[i].t)}</span>`;
}
function caption(c, i) {
  const s = SLOTS[i], n = s.n[c.nkey], lastT = s.last[c.key];
  const bits = [pLabel(UI.g, s.t)];
  if (n && s.part && lastT) bits[0] += `, по ${ddmm(lastT)}`;
  if (UI.g !== 'day' && n) bits.push(`${n} ${plural(n, 'день', 'дня', 'дней')} ${c.id === 's' ? 'с данными' : 'с замером'}`);
  if (!n) bits.push(c.id === 's' ? 'нет данных' : 'нет замеров');
  return `<p class="cap">${bits.join(' · ')}</p>`;
}
function readout(c, hover) {
  const i = hover != null ? hover : lastWith(c.nkey);
  if (i < 0) return '<p class="cap">Пока пусто — сюда лягут замеры</p>';
  const s = SLOTS[i], j = s.n[c.nkey] ? prevWith(c.nkey, i) : -1;
  const v = s.v[c.key];
  if (v == null) return `<div class="big">—</div>${caption(c, i)}`;
  return `<div class="big">${num(v, c.d)}<span class="u">${c.unit}</span>${j >= 0 ? deltaHtml(v, SLOTS[j].v[c.key], c, j, i) : ''}</div>${caption(c, i)}`;
}

function chartBlock(c) {
  return `<section class="ls-block chart">
    <div class="sec-top"><h2 class="ls-h"><span class="tip" tabindex="0" data-tip="${esc(c.tip)}">${esc(c.title)}</span></h2>${c.act ? `<div class="filters sm" role="group" aria-label="Что показать">${[['s', 'шаги'], ['a', 'ккал']].map(([k, l]) => `<button type="button" data-act="${k}" aria-pressed="${UI.act === k}">${l}</button>`).join('')}</div>` : ''}</div>
    <div class="ro" id="ro-${c.id}">${readout(c, null)}</div>
    ${plot(c, SLOTS)}
  </section>`;
}

function render() {
  const W = Math.round(Math.max(300, Math.min(726, root.clientWidth - 34)));
  const rOk = r => r === 'all' || slotCount(UI.g, r) >= 3;
  if (!rOk(UI.r)) UI.r = R_DEF[UI.g];   // запомненный WTD в понедельник, YTD в январе — меньше трёх точек
  SLOTS = buildSlots();
  GEO = { W, pl: 42, pr: 6, pt: 8, pb: 22, y: {} };
  GEO.gw = (W - GEO.pl - GEO.pr) / Math.max(1, SLOTS.length);
  const ctr = `<div class="controls">
    <div class="ctl"><span class="cap">Среднее за</span><div class="filters" role="group" aria-label="Среднее за">${GS.map(([k, l]) => `<button type="button" data-g="${k}" aria-pressed="${UI.g === k}">${l}</button>`).join('')}</div></div>
    <div class="ctl"><span class="cap">Показать</span><div class="filters" role="group" aria-label="Показать">${RS.map(([k, l, tip]) => `<button type="button" data-r="${k}" title="${tip}" aria-pressed="${UI.r === k}"${rOk(k) ? '' : ' disabled'}>${l}</button>`).join('')}</div></div>
  </div>`;
  root.innerHTML = `${head(`Apple Health по ${ddmm(toT(D.updated))}.${D.updated.slice(0, 4)} · как считается — в подсказке у названия графика`)}${ctr}${CHARTS.map(chartBlock).join('')}`;
  UI.hover = null; lastW = root.clientWidth;
}

/* ---------- наведение: одна вертикаль через все графики, цифры над графиками — за выбранный период ---------- */
function hoverTo(i) {
  if (i === UI.hover) return;
  UI.hover = i;
  for (const c of CHARTS) {
    const g = document.getElementById('hv-' + c.id), ro = document.getElementById('ro-' + c.id);
    if (!g || !ro) continue;
    ro.innerHTML = readout(c, i);
    if (i == null) { g.setAttribute('visibility', 'hidden'); continue; }
    const x = (GEO.pl + GEO.gw * (i + 0.5)).toFixed(1), s = SLOTS[i], y = GEO.y[c.id];
    let dots = '';
    if (c.kind === 'line' && s.v[c.key] != null) dots = `<circle class="hd" cx="${x}" cy="${y(s.v[c.key]).toFixed(1)}" r="4"/>`;
    g.innerHTML = `<line class="xh" x1="${x}" x2="${x}" y1="${GEO.pt}" y2="${(c.h - GEO.pb).toFixed(1)}"/>${dots}`;
    g.setAttribute('visibility', 'visible');
  }
}
function slotAt(e, svg) {
  const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * GEO.W / r.width;
  const i = Math.floor((x - GEO.pl) / GEO.gw);
  return i >= 0 && i < SLOTS.length ? i : null;
}
root.addEventListener('pointermove', e => { const svg = e.target.closest && e.target.closest('svg.plot'); if (svg) hoverTo(slotAt(e, svg)); });
root.addEventListener('pointerdown', e => { const svg = e.target.closest && e.target.closest('svg.plot'); if (svg) hoverTo(slotAt(e, svg)); });
root.addEventListener('pointerout', e => { const svg = e.target.closest && e.target.closest('svg.plot'); if (svg && e.pointerType === 'mouse' && !svg.contains(e.relatedTarget)) hoverTo(null); });

root.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.g) { UI.g = b.dataset.g; UI.r = R_DEF[UI.g]; keepUI(); render(); }
  else if (b.dataset.r) { UI.r = b.dataset.r; keepUI(); render(); }
  else if (b.dataset.act) { UI.act = b.dataset.act; setAct(); keepUI(); render(); }
});
root.addEventListener('submit', e => {
  if (e.target.id !== 'login') return;
  e.preventDefault();
  const v = document.getElementById('key').value.trim();
  if (v) { TOKEN = v; LS.set('hl-token', v); boot(); }
});

/* ---------- GitHub ---------- */
async function getData() {
  const r = await fetch(`${API}/contents/${FILE}?ref=${BRANCH}`, { cache: 'no-store', headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw+json' } });
  if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
function setData(data) {
  D = data;
  DAYS = Object.entries(D.days).map(([d, x]) => ({ t: toT(d), ...x }));
  FIRST = DAYS[0].t; LAST = DAYS[DAYS.length - 1].t;
  const p = DAYS.find(x => x.sc === 'P');
  PICOOC = p && DAYS.some(x => x.sc === 'Z' && x.t < p.t) ? p.t : null;
  loadedAt = Date.now();
}
function loginView(msg) {
  root.innerHTML = `${head('Вход один раз на устройстве')}
    ${msg ? `<p class="msg">${esc(msg)}</p>` : ''}
    <form class="ls-block login" id="login">
      <label class="cap" for="key">Ключ доступа</label>
      <input id="key" type="password" autocomplete="off" placeholder="github_pat_…" required>
      <button class="btn main" type="submit">Войти</button>
    </form>`;
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('k')) { TOKEN = h.get('k'); LS.set('hl-token', TOKEN); history.replaceState(null, '', location.pathname); }
}
async function boot() {
  readHash();
  if (!TOKEN) return loginView();
  root.innerHTML = head('Загружаю…');
  try {
    setData(await getData());
    render();
  } catch (e) {
    if ([401, 403, 404].includes(e.status)) {
      const own = TOKEN === LS.get('hl-token');   // чужой ключ других приложений не стираем: он нужен там
      if (own) LS.del('hl-token'); TOKEN = null;
      return loginView(own ? 'Ключ не подошёл. Проверь, что у него есть доступ к репозиторию health-data и он не просрочен.' : '');
    }
    root.innerHTML = head('Нет связи с GitHub. Обнови страницу через минуту.');
  }
}
// данные меняются редко: вернулась на вкладку спустя 10 минут — перечитать
async function refresh() {
  if (document.hidden || !D || Date.now() - loadedAt < 10 * 60e3) return;
  try { const d = await getData(); if (d.updated !== D.updated || Object.keys(d.days).length !== DAYS.length) { setData(d); render(); } else loadedAt = Date.now(); } catch (e) { /* без сети — в другой раз */ }
}
// свежая версия: GitHub Pages разрешает браузеру 10 минут держать старую страницу. Сверяем номер версии
// в свежем index.html с загруженным и при расхождении перезагружаем — один раз на версию
const MY_V = (document.querySelector('script[src*="app.js?v="]') || { src: '' }).src.split('v=')[1] || '';
async function checkFresh() {
  try {
    const html = await (await fetch(`${location.pathname}?fresh=${Date.now()}`, { cache: 'no-store' })).text();
    const v = (html.match(/app\.js\?v=([\w-]+)/) || [])[1];
    if (!v || !MY_V || v === MY_V) return;
    if (sessionStorage.getItem('hl-reloaded') === v) return;
    sessionStorage.setItem('hl-reloaded', v); location.reload();
  } catch (e) { /* без сети — в другой раз */ }
}
let resizeT = null, lastW = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (D && root.clientWidth !== lastW) { lastW = root.clientWidth; render(); } }, 200); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkFresh(); refresh(); } });
checkFresh();
boot();
