/* Alarmes — appli d'alarmes sur mesure (Chris) */
'use strict';

const VERSION = '1.5.1';
const HORIZON_DAYS = 62;      // fenêtre programmée à l'avance côté Android
const MAX_NATIVE = 450;       // limite prudente (Android plafonne à 500 alarmes par appli)

/* ---------- Natif (Capacitor) ---------- */
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const Native = isNative ? window.Capacitor.registerPlugin('AlarmNative') : null;

/* ---------- Petits utilitaires ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = o => JSON.parse(JSON.stringify(o));

const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const atTime = (dateStr, hhmm) => { const d = parseYmd(dateStr); const [h, m] = (hhmm || '00:00').split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const lastDayOfMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_COURTS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];   // ordre lundi → dimanche
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const fmtDate = d => `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
const fmtShort = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

function relDay(d) {
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today0()) / 86400000);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  if (diff > 1 && diff < 7) return JOURS[d.getDay()];
  return fmtDate(d) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false; t.onclick = null;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/** Message avec un bouton (ex. « Annuler »). */
function toastAction(msg, label, fn, ms = 5000) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span><button class="toast-btn">${esc(label)}</button>`;
  t.hidden = false;
  clearTimeout(toast._t);
  t.onclick = e => { if (e.target.closest('.toast-btn')) { t.hidden = true; t.onclick = null; clearTimeout(toast._t); fn(); } };
  toast._t = setTimeout(() => { t.hidden = true; t.onclick = null; }, ms);
}

/* ---------- Niveaux d'urgence ---------- */
const LEVELS = [
  { id: 'info', label: 'Info', color: '#0284c7' },
  { id: 'normal', label: 'Normal', color: '#16a34a' },
  { id: 'important', label: 'Important', color: '#ea580c' },
  { id: 'urgent', label: 'Urgent', color: '#dc2626' },
];
const levelOf = a => LEVELS.find(l => l.id === a.level) || null;
const colorOf = a => a.color || (levelOf(a) || LEVELS[1]).color;
const levelLabel = a => (levelOf(a) && !a.customColor) ? levelOf(a).label : (levelOf(a) ? levelOf(a).label : '');

/* ---------- Stockage (IndexedDB) ---------- */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('alarmes', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k, def) {
    const db = await this.open();
    return new Promise(res => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result === undefined ? def : q.result);
      q.onerror = () => res(def);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
};

const S = {
  alarms: [],
  settings: { snoozeMin: 10, defaultTime: '07:30', veilleTime: '20:00', ringMin: 2, repeats: 2, sound: null },
  tab: 'list',
  search: '',
  selMode: false,
  sel: new Set(),
  visibleIds: [],
  listFilter: 'all',
  calMonth: null,
  calSel: null,
  imp: null,
  fired: {},
};

async function loadAll() {
  S.alarms = await DB.get('alarms', []);
  S.settings = Object.assign(S.settings, await DB.get('settings', {}));
  S.fired = await DB.get('fired', {});
}
async function saveAlarms() {
  await DB.set('alarms', S.alarms);
  await syncNative();
}
async function saveSettings() {
  await DB.set('settings', S.settings);
  await syncNative();
}

/* ---------- Règles de répétition ---------- */
/*
  schedule = {
    type: 'dates' | 'weekly' | 'monthly' | 'daily',
    dates: ['YYYY-MM-DD'],          // type dates
    weekdays: [0..6],               // 0 = dimanche (getDay)
    monthDays: [1..31, -1],         // -1 = dernier jour du mois
    start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' | '',
    except: ['YYYY-MM-DD'],         // jours retirés de la règle
    extra: ['YYYY-MM-DD'],          // jours ajoutés hors règle
  }
*/
function newSchedule(type = 'dates') {
  return { type, dates: [], weekdays: [], monthDays: [], start: ymd(today0()), end: '', except: [], extra: [] };
}

function ruleMatches(sc, d) {
  const s = ymd(d);
  if (sc.type === 'dates') return sc.dates.includes(s);
  if (sc.start && s < sc.start) return false;
  if (sc.end && s > sc.end) return false;
  if (sc.type === 'daily') return true;
  if (sc.type === 'weekly') return sc.weekdays.includes(d.getDay());
  if (sc.type === 'monthly') {
    const dom = d.getDate();
    return sc.monthDays.includes(dom) || (sc.monthDays.includes(-1) && dom === lastDayOfMonth(d));
  }
  return false;
}

function dayRings(sc, d) {
  const s = ymd(d);
  if (sc.type !== 'dates') {
    if ((sc.except || []).includes(s)) return false;
    if ((sc.extra || []).includes(s)) return true;
  }
  return ruleMatches(sc, d);
}

/** Occurrences (objets Date) entre from et to inclus. */
function occurrences(a, from, to, limit = 1000) {
  const out = [];
  const sc = a.schedule;
  if (sc.type === 'dates') {
    for (const s of [...sc.dates].sort()) {
      const d = atTime(s, a.time);
      if (d >= from && d <= to) out.push(d);
      if (out.length >= limit) break;
    }
    return out;
  }
  let d = new Date(from); d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  for (let i = 0; i < 3700 && d <= end && out.length < limit; i++) {
    if (dayRings(sc, d)) {
      const t = atTime(ymd(d), a.time);
      if (t >= from && t <= to) out.push(t);
    }
    d = addDays(d, 1);
  }
  return out;
}

function nextOcc(a, after = new Date()) {
  const r = occurrences(a, after, addDays(after, 3660), 1);
  return r[0] || null;
}

function lastOcc(a) {
  if (a.schedule.type === 'dates') {
    const s = [...a.schedule.dates].sort().pop();
    return s ? atTime(s, a.time) : null;
  }
  return null;
}

function scheduleSummary(a) {
  const sc = a.schedule;
  let s = '';
  if (sc.type === 'dates') {
    const n = sc.dates.length;
    s = n === 0 ? 'Aucune date' : n === 1 ? 'Une fois' : `${n} dates choisies`;
  } else if (sc.type === 'daily') s = 'Chaque jour';
  else if (sc.type === 'weekly') {
    const w = WD_ORDER.filter(x => sc.weekdays.includes(x)).map(x => JOURS[x].slice(0, 3));
    s = w.length === 7 ? 'Chaque jour' : w.length ? 'Chaque ' + w.join(', ') : 'Aucun jour';
  } else if (sc.type === 'monthly') {
    const m = [...sc.monthDays].sort((x, y) => (x === -1) - (y === -1) || x - y).map(x => x === -1 ? 'dernier jour' : x);
    s = m.length ? 'Le ' + m.join(', ') + ' du mois' : 'Aucun jour';
  }
  if (sc.type !== 'dates') {
    if (sc.except && sc.except.length) s += ` · ${sc.except.length} exception${sc.except.length > 1 ? 's' : ''}`;
    if (sc.extra && sc.extra.length) s += ` · +${sc.extra.length}`;
    if (sc.end) s += ` · jusqu'au ${fmtShort(parseYmd(sc.end))}`;
  }
  return s;
}

/* ---------- Synchronisation avec Android ---------- */
function hashInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 99999989 + 1;
}

/* ---------- Sonnerie (son, durée, répétitions) ---------- */
const DUR_CHOICES = [1, 2, 3, 4, 5];
const REP_CHOICES = [0, 1, 2, 3, 4, 5];
const repLabel = n => n === 0 ? 'aucune' : `${n} fois`;
function effRing(a) {
  const r = (a && a.ring) || {};
  return {
    sound: r.sound || S.settings.sound || null,
    durationMin: r.durationMin || Number(S.settings.ringMin) || 2,
    repeats: (r.repeats === 0 || r.repeats) ? r.repeats : Number(S.settings.repeats ?? 2),
  };
}
const soundName = snd => snd ? snd.name : 'Son d’alarme du téléphone';
function ringSummary(a) {
  const e = effRing(a);
  return `${soundName(e.sound)} · ${e.durationMin} min · répétitions : ${repLabel(e.repeats)}`;
}
async function pickSound(kind, current) {
  if (!Native) { toast('Disponible dans l’appli Android'); return null; }
  try {
    const r = kind === 'file' ? await Native.pickFileSound() : await Native.pickSystemSound({ current: current ? current.uri : '' });
    if (!r || r.cancelled || !r.uri) return null;
    return { uri: r.uri, name: r.name || 'Son choisi', kind };
  } catch (e) { toast('Choix du son impossible : ' + (e.message || e)); return null; }
}
let previewing = false;
async function togglePreview(snd) {
  if (!Native) { toast('Disponible dans l’appli Android'); return; }
  try {
    if (previewing) { await Native.stopPreview(); previewing = false; return; }
    await Native.previewSound({ uri: snd ? snd.uri : '' });
    previewing = true;
    setTimeout(() => { previewing = false; }, 10000);
  } catch (e) { toast('Son illisible'); previewing = false; }
}

/** Itinéraire Google Maps vers le lieu joint. */
function placeNavUrl(place) {
  if (!place) return '';
  const u = place.url || '';
  const m = u.match(/[?&](?:query|q|destination)=([^&]+)/);
  if (m) return 'https://www.google.com/maps/dir/?api=1&destination=' + m[1];
  if (u) return u;
  return place.label ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(place.label) : '';
}
function extrasPayload(a) {
  return {
    photoCount: (a.photos || []).length,
    contactName: a.contact ? (a.contact.name || '') : '',
    contactPhone: a.contact ? (a.contact.phone || '') : '',
    placeLabel: a.place ? (a.place.label || '') : '',
    placeNavUrl: placeNavUrl(a.place),
  };
}
/** Copie les photos des alarmes là où l'écran de sonnerie Android peut les lire. */
async function syncPhotos(force) {
  if (!Native) return;
  S.photoKeys = S.photoKeys || await DB.get('photoKeys', {});
  const keep = [];
  let changed = false;
  for (const a of S.alarms) {
    const ph = a.photos || [];
    if (!ph.length) continue;
    keep.push(a.id);
    const key = ph.length + ':' + ph.map(p => p.length).join(',');
    if (!force && S.photoKeys[a.id] === key) continue;
    try { await Native.setPhotos({ id: a.id, photos: ph }); S.photoKeys[a.id] = key; changed = true; } catch (e) { /* ignore */ }
  }
  for (const id of Object.keys(S.photoKeys)) if (!keep.includes(id)) { delete S.photoKeys[id]; changed = true; }
  if (S.lastTestId) keep.push(S.lastTestId);
  try { await Native.prunePhotos({ keep }); } catch (e) { /* ignore */ }
  if (changed) await DB.set('photoKeys', S.photoKeys);
}

function nativePayload() {
  const now = new Date();
  const to = addDays(now, HORIZON_DAYS);
  const list = [];
  for (const a of S.alarms) {
    if (!a.enabled) continue;
    for (const d of occurrences(a, now, to, 200)) {
      list.push({
        nid: hashInt(a.id + '|' + d.getTime()),
        at: d.getTime(),
        title: a.title || 'Alarme',
        body: a.description || '',
        color: colorOf(a),
        levelLabel: levelOf(a) ? levelOf(a).label : '',
        mode: a.mode || 'alarm',
        alarmId: a.id,
        hasExtras: !!((a.photos && a.photos.length) || a.contact || a.place),
        ...extrasPayload(a),
        soundUri: effRing(a).sound ? effRing(a).sound.uri : '',
        durationMin: effRing(a).durationMin,
        repeats: effRing(a).repeats,
        ringIndex: 0,
      });
    }
  }
  list.sort((x, y) => x.at - y.at);
  const truncated = list.length > MAX_NATIVE - 1;
  const kept = list.slice(0, MAX_NATIVE - 1);
  const beyond = truncated || S.alarms.some(a => a.enabled && nextOcc(a, to));
  if (beyond && kept.length) {
    const nowMs = now.getTime();
    let at = truncated ? kept[kept.length - 1].at - 2 * 86400000 : nowMs + (HORIZON_DAYS - 7) * 86400000;
    if (at < nowMs + 3600000) at = nowMs + 3600000;
    const until = new Date(kept[kept.length - 1].at);
    kept.push({
      nid: 1888888888, at, title: 'Alarmes : ouvre l’appli',
      body: `Tes sonneries sont programmées jusqu’au ${fmtShort(until)}. Ouvre l’appli Alarmes pour programmer la suite.`,
      color: '#64748b', levelLabel: '', mode: 'notif', alarmId: '', hasExtras: false,
      photoCount: 0, contactName: '', contactPhone: '', placeLabel: '', placeNavUrl: '',
      soundUri: '', durationMin: 1, repeats: 0, ringIndex: 0,
    });
  }
  return kept;
}

let lastSync = { count: 0, until: null };
async function syncNative() {
  const list = nativePayload();
  const real = list.filter(x => x.nid !== 1888888888);
  lastSync = { count: real.length, until: real.length ? new Date(real[real.length - 1].at) : null };
  if (!Native) return;
  await syncPhotos();
  try {
    await Native.setAll({ alarms: list, snoozeMin: Number(S.settings.snoozeMin) || 10 });
  } catch (e) {
    toast('Programmation Android impossible : ' + (e.message || e));
  }
}

/* ---------- Sonnerie dans le navigateur (repli hors APK) ---------- */
let audioCtx = null, beepTimer = null;
function startBeep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.25, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      o.start(); o.stop(audioCtx.currentTime + 0.5);
      if (navigator.vibrate) navigator.vibrate(400);
    };
    beep(); beepTimer = setInterval(beep, 900);
  } catch (e) { /* pas de son possible */ }
}
function stopBeep() { clearInterval(beepTimer); beepTimer = null; }

let ringTimer = null;
function showRing(a, when, ringIndex = 0) {
  const r = $('#ring');
  const eff = effRing(a);
  clearTimeout(ringTimer);
  r.style.setProperty('--c', colorOf(a));
  r.innerHTML = `
    <div class="t">${fmtTime(when || new Date())}</div>
    <div style="text-align:center;opacity:.9;text-transform:uppercase;letter-spacing:.1em;font-size:13px">${esc(levelOf(a) ? levelOf(a).label : '')}</div>
    <h3>${esc(a.title || 'Alarme')}</h3>
    ${(a.photos || []).length ? `<div class="ring-photos">${a.photos.map(p => `<img src="${p}" alt="">`).join('')}</div>` : ''}
    <div class="box">${esc(a.description || '(pas de description)')}</div>
    ${a.contact?.phone || a.place ? `<div class="btns">
      ${a.contact?.phone ? `<a class="btn" href="tel:${esc(a.contact.phone.replace(/[^\d+]/g, ''))}">📞 Appeler</a>` : ''}
      ${a.place ? `<a class="btn" href="${esc(placeNavUrl(a.place))}" target="_blank" rel="noopener">📍 Itinéraire</a>` : ''}
    </div>` : ''}
    <div class="btns">
      <button class="btn" data-r="snooze">Snooze ${S.settings.snoozeMin} min</button>
      <button class="btn" data-r="details">Détails</button>
    </div>
    <div class="btns"><button class="btn primary" data-r="stop">Arrêter</button></div>`;
  r.hidden = false;
  stopBeep(); startBeep();
  ringTimer = setTimeout(() => {
    stopBeep(); r.hidden = true;
    if (ringIndex < eff.repeats) {
      toast(`Pas de réponse : nouvelle sonnerie dans ${S.settings.snoozeMin} min`, 4000);
      ringTimer = setTimeout(() => showRing(a, new Date(), ringIndex + 1), S.settings.snoozeMin * 60000);
    }
  }, eff.durationMin * 60000);
  r.onclick = e => {
    const act = e.target.dataset.r;
    if (!act) return;
    clearTimeout(ringTimer);
    stopBeep(); r.hidden = true;
    if (act === 'snooze') {
      const t = Date.now() + S.settings.snoozeMin * 60000;
      setTimeout(() => showRing(a, new Date()), t - Date.now());
    }
    if (act === 'details') openDetail(a.id);
  };
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(a.title || 'Alarme', { body: a.description || '' }); } catch (e) { /* ignore */ }
  }
}

function webTick() {
  if (isNative) return;
  const now = new Date();
  const from = new Date(now.getTime() - 60000);
  for (const a of S.alarms) {
    if (!a.enabled) continue;
    for (const d of occurrences(a, from, now, 5)) {
      const key = a.id + '|' + d.getTime();
      if (!S.fired[key]) {
        S.fired[key] = 1;
        DB.set('fired', S.fired);
        showRing(a, d);
      }
    }
  }
}

/* ---------- Navigation ---------- */
const TITLES = { list: 'Alarmes', calendar: 'Calendrier', import: 'Importer', settings: 'Réglages' };
function go(tab) {
  if (tab !== S.tab) { S.selMode = false; S.sel.clear(); }
  S.tab = tab;
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#viewTitle').textContent = TITLES[tab];
  render();
  updateSelBar();
  window.scrollTo(0, 0);
}
function render() {
  const v = $('#view');
  if (S.tab === 'list') renderList(v);
  else if (S.tab === 'calendar') renderCalendarTab(v);
  else if (S.tab === 'import') renderImport(v);
  else renderSettings(v);
}

/* ---------- Vue liste ---------- */
function alarmCard(a, when) {
  const clips = [
    a.photos && a.photos.length ? '📷' : '',
    a.contact ? '👤' : '',
    a.place ? '📍' : '',
    a.source ? '📥' : '',
    a.event ? (a.event.missing ? '⚠️📅' : '📅') : '',
    a.mode === 'notif' ? '🔕' : '',
  ].join('');
  const sub = when ? `${capital(relDay(when))} · ${scheduleSummary(a)}` : scheduleSummary(a);
  const picking = S.selMode && (S.tab === 'list' || S.tab === 'calendar');
  const picked = picking && S.sel.has(a.id);
  return `<div class="card alarm ${a.enabled ? '' : 'off'} ${picked ? 'picked' : ''}" style="--c:${colorOf(a)}" ${picking ? `data-pick="${a.id}"` : `data-open="${a.id}"`}>
      <div class="time">${esc(a.time)}</div>
      <div class="info">
        <div class="title">${esc(a.title || 'Sans titre')}</div>
        <div class="sub">${esc(sub)}</div>
        ${clips ? `<div class="clips">${clips}</div>` : ''}
      </div>
      ${picking ? `<span class="selbox">${picked ? '✓' : ''}</span>` : `<label class="switch" data-stop="1"><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? 'checked' : ''}><span></span></label>`}
    </div>`;
}

function listMatches(a) {
  const w = norm(S.search).trim();
  return !w || norm(a.title + ' ' + a.description + ' ' + (a.source ? a.source.name : '')).includes(w);
}

function renderList(v) {
  if (!S.alarms.length) {
    S.selMode = false; S.sel.clear();
    v.innerHTML = `<div class="empty"><b>Aucune alarme</b>Touche + pour en créer une, ou importe un fichier de dates dans l'onglet Importer.</div>`;
    updateSelBar();
    return;
  }
  if (!$('#listSearch', v)) {
    v.innerHTML = `<div class="searchbar">
        <input type="search" id="listSearch" placeholder="🔍 Rechercher un mot…" autocomplete="off">
        <button class="btn small" data-sel="toggle" id="selToggle"></button>
      </div><div id="listBody"></div>`;
    $('#listSearch', v).value = S.search;
  }
  renderListBody();
}

function renderListBody() {
  const body = $('#listBody');
  if (!body) return;
  $('#selToggle').textContent = S.selMode ? 'Terminer' : 'Sélectionner';
  const now = new Date();
  const withNext = S.alarms.map(a => ({ a, n: a.enabled ? nextOcc(a, now) : null }));
  let items = withNext;
  if (S.listFilter === 'week') items = items.filter(x => x.n && x.n - now < 7 * 86400000);
  if (S.listFilter === 'import') items = items.filter(x => x.a.source);
  if (S.listFilter === 'manual') items = items.filter(x => !x.a.source);
  items = items.filter(x => listMatches(x.a));
  S.visibleIds = items.map(x => x.a.id);

  const groups = { "Aujourd'hui": [], 'Demain': [], 'Cette semaine': [], 'Plus tard': [], 'Désactivées ou terminées': [] };
  const t0 = today0();
  for (const x of items) {
    if (!x.n) { groups['Désactivées ou terminées'].push(x); continue; }
    const diff = Math.floor((new Date(x.n).setHours(0, 0, 0, 0) - t0) / 86400000);
    if (diff === 0) groups["Aujourd'hui"].push(x);
    else if (diff === 1) groups['Demain'].push(x);
    else if (diff < 7) groups['Cette semaine'].push(x);
    else groups['Plus tard'].push(x);
  }
  const hasImport = S.alarms.some(a => a.source);
  let html = `<div class="chips">
      <button class="chip ${S.listFilter === 'all' ? 'on' : ''}" data-filter="all">Toutes</button>
      <button class="chip ${S.listFilter === 'week' ? 'on' : ''}" data-filter="week">7 prochains jours</button>
      ${hasImport ? `<button class="chip ${S.listFilter === 'manual' ? 'on' : ''}" data-filter="manual">Manuelles</button>
      <button class="chip ${S.listFilter === 'import' ? 'on' : ''}" data-filter="import">Importées</button>` : ''}
    </div>`;
  if (backupDue() && !S.selMode) html += `<div class="card banner" data-gobackup="1">💾 <b>Pense à sauvegarder tes alarmes</b><div class="note">${backupStatus()} Touche ici pour le faire.</div></div>`;
  if (S.search.trim()) html += `<p class="note" style="margin:0 4px 8px">${items.length} résultat${items.length > 1 ? 's' : ''} pour « ${esc(S.search.trim())} »</p>`;
  if (S.selMode) {
    const allIn = items.length && items.every(x => S.sel.has(x.a.id));
    html += `<div class="chips">
      <button class="chip ${allIn ? 'on' : ''}" data-sel="all">Tout sélectionner (${items.length})</button>
      ${S.sel.size ? `<button class="chip" data-sel="none">Tout désélectionner</button>` : ''}
    </div>`;
  }
  let any = false;
  for (const [name, arr] of Object.entries(groups)) {
    if (!arr.length) continue;
    any = true;
    arr.sort((x, y) => (x.n || lastOcc(x.a) || 0) - (y.n || lastOcc(y.a) || 0));
    const shown = name === 'Plus tard' && arr.length > 60 ? arr.slice(0, 60) : arr;
    html += `<h2>${name} · ${arr.length}</h2>` + shown.map(x => alarmCard(x.a, x.n)).join('');
    if (shown.length < arr.length) html += `<p class="note">… et ${arr.length - shown.length} autres (voir le calendrier).</p>`;
  }
  if (!any) html += `<div class="empty">${S.search.trim() ? 'Aucune alarme ne contient ce mot.' : 'Rien dans ce filtre.'}</div>`;
  body.innerHTML = html;
  updateSelBar();
}

/* ---------- Sélection multiple ---------- */
function updateSelBar() {
  let bar = $('#selBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'selBar'; bar.className = 'selbar'; bar.hidden = true;
    document.body.appendChild(bar);
    bar.addEventListener('click', e => { const b = e.target.closest('[data-sb]'); if (b && !b.disabled) selAction(b.dataset.sb); });
  }
  const on = S.selMode && (S.tab === 'list' || S.tab === 'calendar');
  document.body.classList.toggle('selmode', on);
  $('#fab').hidden = on || !(S.tab === 'list' || S.tab === 'calendar');
  bar.hidden = !on;
  if (!on) return;
  const n = S.sel.size, dis = n ? '' : 'disabled';
  bar.innerHTML = `<div class="selcount"><b>${n}</b> sélectionnée${n > 1 ? 's' : ''}</div>
    <div class="selbtns">
      <button class="btn small primary" data-sb="edit" ${dis}>Modifier</button>
      <button class="btn small" data-sb="on" ${dis}>Activer</button>
      <button class="btn small" data-sb="off" ${dis}>Désactiver</button>
      <button class="btn small danger" data-sb="del" ${dis}>Supprimer</button>
    </div>`;
}

function refreshView() {
  if (S.tab === 'list') keepScroll(renderListBody);
  else keepScroll(render);
}

function startSelectionWith(id) {
  if (!id) return;
  S.selMode = true; S.sel.add(id);
  refreshView();
}

async function deleteWithUndo(id) {
  const idx = S.alarms.findIndex(a => a.id === id);
  if (idx < 0) return;
  const [a] = S.alarms.splice(idx, 1);
  S.sel.delete(id);
  await saveAlarms();
  refreshView();
  const several = a.schedule.type !== 'dates' || a.schedule.dates.length > 1;
  toastAction(`« ${(a.title || 'Alarme').slice(0, 40)} » supprimée${several ? ' (toutes ses dates)' : ''}`, 'Annuler', async () => {
    S.alarms.splice(Math.min(idx, S.alarms.length), 0, a);
    await saveAlarms();
    refreshView();
    toast('Alarme restaurée');
  });
}

async function selAction(act) {
  const ids = new Set(S.sel);
  const n = ids.size;
  if (!n) return;
  if (act === 'edit') { openBulkEditor(); return; }
  if (act === 'on' || act === 'off') {
    S.alarms.forEach(a => { if (ids.has(a.id)) a.enabled = act === 'on'; });
    await saveAlarms(); refreshView();
    toast(`${n} alarme(s) ${act === 'on' ? 'activée(s)' : 'désactivée(s)'}`);
    return;
  }
  if (act === 'del') {
    if (!confirm(`Supprimer définitivement ${n} alarme(s) ?`)) return;
    S.alarms = S.alarms.filter(a => !ids.has(a.id));
    S.sel.clear(); S.selMode = false;
    await saveAlarms(); render();
    toast(`${n} alarme(s) supprimée(s)`);
  }
}

let BE = null; // modification groupée en cours

function openBulkEditor() {
  ED = null;
  BE = {
    ids: [...S.sel],
    timeMode: 'keep', timeValue: S.settings.defaultTime || '07:30', timeShift: '',
    dayShift: '', mode: '', level: '', color: '',
    soundMode: 'keep', sound: null, dur: '', rep: '',
    placeMode: 'keep', placeLabel: '', placeUrl: '',
    contactMode: 'keep', ctName: '', ctPhone: '', ctEmail: '',
    addPhotos: [], clearPhotos: false, appendDesc: '', find: '', replace: '',
  };
  renderBulk();
  showSheet();
}

function readBulkFields() {
  if (!BE) return;
  const g = id => document.getElementById(id);
  const val = id => (g(id) ? g(id).value : undefined);
  if (g('beTime')) BE.timeValue = val('beTime') || BE.timeValue;
  if (g('beShift')) BE.timeShift = val('beShift');
  BE.dayShift = val('beDays') ?? BE.dayShift;
  BE.mode = val('beMode') ?? BE.mode;
  BE.dur = val('beDur') ?? BE.dur;
  BE.rep = val('beRep') ?? BE.rep;
  if (g('bePlLabel')) { BE.placeLabel = val('bePlLabel').trim(); BE.placeUrl = val('bePlUrl').trim(); }
  if (g('beCtName')) { BE.ctName = val('beCtName').trim(); BE.ctPhone = val('beCtPhone').trim(); BE.ctEmail = val('beCtEmail').trim(); }
  if (g('beClearPh')) BE.clearPhotos = g('beClearPh').checked;
  BE.appendDesc = val('beDesc') ?? BE.appendDesc;
  BE.find = val('beFind') ?? BE.find;
  BE.replace = val('beRepl') ?? BE.replace;
}

function renderBulk() {
  const b = BE, n = b.ids.length;
  const seg = (name, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-be-${name}="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const s = $('#sheet');
  s.innerHTML = `
  <div class="sheet-head">
    <button data-be="close">✕</button>
    <h3>Modifier ${n} alarme${n > 1 ? 's' : ''}</h3>
    <button class="save" data-be="apply">Appliquer</button>
  </div>
  <div class="sheet-body">
    <p class="note">Seuls les réglages que tu changes sont appliqués. Le reste de chaque alarme ne bouge pas.</p>

    <label class="f">Heure</label>
    ${seg('time', b.timeMode, [['keep', 'Ne pas changer'], ['set', 'Fixer à'], ['shift', 'Décaler']])}
    ${b.timeMode === 'set' ? `<input type="time" id="beTime" value="${esc(b.timeValue)}" style="margin-top:8px">` : ''}
    ${b.timeMode === 'shift' ? `<div class="row" style="margin-top:8px"><input type="number" id="beShift" value="${esc(b.timeShift)}" placeholder="ex. -30"><span style="flex:none">minutes</span></div><p class="note">Négatif = plus tôt. Passer minuit change aussi le jour.</p>` : ''}

    <label class="f">Décaler les dates</label>
    <div class="row"><input type="number" id="beDays" value="${esc(b.dayShift)}" placeholder="0"><span style="flex:none">jours</span></div>
    <p class="note">Négatif = plus tôt. Dates choisies, exceptions et périodes sont décalées ; les jours de la semaine aussi. Les répétitions « jours du mois » ne bougent pas.</p>

    <label class="f">Type</label>
    <select id="beMode">
      <option value="">Ne pas changer</option>
      <option value="alarm" ${b.mode === 'alarm' ? 'selected' : ''}>Sonnerie d'alarme</option>
      <option value="notif" ${b.mode === 'notif' ? 'selected' : ''}>Rappel discret</option>
    </select>

    <label class="f">Urgence (couleur)</label>
    <div class="chips" style="margin-bottom:6px"><button class="chip ${b.level === '' ? 'on' : ''}" data-be-level="">Ne pas changer</button></div>
    <div class="levels">${LEVELS.map(l => `<button data-be-level="${l.id}" class="${b.level === l.id ? 'on' : ''}" style="--c:${l.color}">${l.label}</button>`).join('')}</div>
    <label class="custom-color"><input type="color" id="beColor" value="${b.color || '#7c3aed'}"> Autre couleur${b.level === 'custom' ? ' (choisie)' : ''}</label>

    <div class="card" style="margin-top:14px">
      <b>Sonnerie</b>
      <label class="f">Son</label>
      ${seg('snd', b.soundMode, [['keep', 'Ne pas changer'], ['default', 'Par défaut'], ['set', 'Choisir']])}
      ${b.soundMode === 'set' ? `<div class="attach" style="margin-top:8px"><span>🎵</span><div class="t"><b>${esc(b.sound ? b.sound.name : 'Aucun son choisi')}</b></div>${isNative && b.sound ? '<button class="btn small" data-be="preview">▶</button>' : ''}</div>
        ${isNative ? `<div class="btns" style="margin-top:0"><button class="btn small" data-be="sysSound">Sons du téléphone</button><button class="btn small" data-be="fileSound">Fichier audio</button></div>` : '<p class="note">Choix du son : dans l’appli Android.</p>'}` : ''}
      <div class="row">
        <div><label class="f">Durée</label>
          <select id="beDur"><option value="">Ne pas changer</option><option value="def" ${b.dur === 'def' ? 'selected' : ''}>Par défaut</option>${DUR_CHOICES.map(x => `<option value="${x}" ${b.dur === String(x) ? 'selected' : ''}>${x} min</option>`).join('')}</select></div>
        <div><label class="f">Répétitions</label>
          <select id="beRep"><option value="">Ne pas changer</option><option value="def" ${b.rep === 'def' ? 'selected' : ''}>Par défaut</option>${REP_CHOICES.map(x => `<option value="${x}" ${b.rep === String(x) ? 'selected' : ''}>${x === 0 ? 'Aucune' : x + ' fois'}</option>`).join('')}</select></div>
      </div>
    </div>

    <label class="f">Lieu</label>
    ${seg('pl', b.placeMode, [['keep', 'Ne pas changer'], ['set', 'Définir'], ['remove', 'Retirer']])}
    ${b.placeMode === 'set' ? `<input type="text" id="bePlLabel" placeholder="Nom du lieu ou adresse" value="${esc(b.placeLabel)}" style="margin-top:8px">
      <input type="url" id="bePlUrl" placeholder="Lien Google Maps (facultatif)" value="${esc(b.placeUrl)}" style="margin-top:8px">` : ''}

    <label class="f">Contact</label>
    ${seg('ct', b.contactMode, [['keep', 'Ne pas changer'], ['set', 'Définir'], ['remove', 'Retirer']])}
    ${b.contactMode === 'set' ? `${isNative ? '<div class="btns"><button class="btn small" data-be="pickcontact">Choisir dans le répertoire</button></div>' : ''}
      <input type="text" id="beCtName" placeholder="Nom" value="${esc(b.ctName)}" style="margin-top:8px">
      <input type="tel" id="beCtPhone" placeholder="Téléphone" value="${esc(b.ctPhone)}" style="margin-top:8px">
      <input type="email" id="beCtEmail" placeholder="E-mail" value="${esc(b.ctEmail)}" style="margin-top:8px">` : ''}

    <label class="f">Photos à ajouter</label>
    <div class="photos">
      ${b.addPhotos.map((p, i) => `<div class="ph"><img src="${p}" alt=""><button class="x" data-be-delph="${i}">✕</button></div>`).join('')}
      <button class="add" data-be="photo">+</button>
    </div>
    <input type="file" id="bePhotoInput" accept="image/*" multiple hidden>
    <label class="custom-color"><input type="checkbox" id="beClearPh" ${b.clearPhotos ? 'checked' : ''} style="width:20px;height:20px"> Retirer d’abord les photos existantes</label>

    <label class="f">Ajouter à la fin de la description</label>
    <textarea id="beDesc" placeholder="Texte ajouté sur une nouvelle ligne" style="min-height:70px">${esc(b.appendDesc)}</textarea>

    <label class="f">Rechercher-remplacer dans les titres</label>
    <div class="row"><input type="text" id="beFind" placeholder="Rechercher" value="${esc(b.find)}"><input type="text" id="beRepl" placeholder="Remplacer par" value="${esc(b.replace)}"></div>
    <p class="note">Majuscules ignorées. Laisse « Remplacer par » vide pour effacer le mot.</p>

    <div class="btns" style="margin-top:22px"><button class="btn primary" data-be="apply">Appliquer à ${n} alarme${n > 1 ? 's' : ''}</button></div>
  </div>`;
}

function shiftSchedule(sc, n) {
  const f = d => ymd(addDays(parseYmd(d), n));
  sc.dates = (sc.dates || []).map(f).sort();
  sc.except = (sc.except || []).map(f);
  sc.extra = (sc.extra || []).map(f);
  if (sc.type !== 'dates') {
    if (sc.start) sc.start = f(sc.start);
    if (sc.end) sc.end = f(sc.end);
    if (sc.type === 'weekly') sc.weekdays = sc.weekdays.map(w => (((w + n) % 7) + 7) % 7);
  }
}

async function applyBulk() {
  readBulkFields();
  const b = BE;
  const ids = new Set(b.ids);
  const shiftMin = b.timeMode === 'shift' ? Math.round(Number(b.timeShift) || 0) : 0;
  const days = Math.round(Number(b.dayShift) || 0);
  const findRe = b.find.trim() ? new RegExp(b.find.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
  const hasChange = (b.timeMode === 'set') || shiftMin || days || b.mode || b.level || b.soundMode !== 'keep' || b.dur || b.rep
    || b.placeMode !== 'keep' || b.contactMode !== 'keep' || b.addPhotos.length || b.clearPhotos || b.appendDesc.trim() || findRe;
  if (!hasChange) { toast('Aucun changement choisi'); return; }
  if (b.soundMode === 'set' && !b.sound) { toast('Choisis un son, ou mets « Ne pas changer »'); return; }
  if (b.placeMode === 'set' && !b.placeLabel && !b.placeUrl) { toast('Indique le lieu, ou mets « Ne pas changer »'); return; }
  if (b.contactMode === 'set' && !b.ctName && !b.ctPhone && !b.ctEmail) { toast('Indique le contact, ou mets « Ne pas changer »'); return; }
  if (!confirm(`Appliquer ces changements à ${ids.size} alarme(s) ?`)) return;

  for (const a of S.alarms) {
    if (!ids.has(a.id)) continue;
    let dayShift = days;
    if (b.timeMode === 'set' && b.timeValue) a.time = b.timeValue;
    if (shiftMin) {
      const [h, m] = (a.time || '00:00').split(':').map(Number);
      let t = h * 60 + m + shiftMin;
      dayShift += Math.floor(t / 1440);
      t = ((t % 1440) + 1440) % 1440;
      a.time = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    }
    if (dayShift) shiftSchedule(a.schedule, dayShift);
    if (b.mode) a.mode = b.mode;
    if (b.level === 'custom') { a.color = b.color; a.customColor = true; }
    else if (b.level) { a.level = b.level; a.customColor = false; a.color = ''; }
    if (b.soundMode !== 'keep' || b.dur || b.rep) a.ring = a.ring || {};
    if (b.soundMode === 'default') a.ring.sound = null;
    if (b.soundMode === 'set') a.ring.sound = b.sound;
    if (b.dur) a.ring.durationMin = b.dur === 'def' ? null : Number(b.dur);
    if (b.rep) a.ring.repeats = b.rep === 'def' ? null : Number(b.rep);
    if (b.placeMode === 'remove') a.place = null;
    if (b.placeMode === 'set') a.place = { label: b.placeLabel, url: b.placeUrl };
    if (b.contactMode === 'remove') a.contact = null;
    if (b.contactMode === 'set') a.contact = { name: b.ctName, phone: b.ctPhone, email: b.ctEmail };
    if (b.clearPhotos) a.photos = [];
    if (b.addPhotos.length) a.photos = [...(a.photos || []), ...b.addPhotos];
    if (b.appendDesc.trim()) a.description = (a.description ? a.description.replace(/\s+$/, '') + '\n\n' : '') + b.appendDesc.trim();
    if (findRe) a.title = a.title.replace(findRe, b.replace).replace(/\s{2,}/g, ' ').trim() || a.title;
    a.updatedAt = Date.now();
  }
  const n = ids.size;
  closeSheet();
  S.sel.clear(); S.selMode = false;
  await saveAlarms();
  render();
  toast(`${n} alarme(s) modifiée(s)`);
}

async function bulkClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const d = btn.dataset;
  if (d.be === 'close') { closeSheet(); return; }
  readBulkFields();
  const y = $('#sheet').scrollTop;
  const rerender = () => { renderBulk(); $('#sheet').scrollTop = y; };
  if (d.beTime) { BE.timeMode = d.beTime; return rerender(); }
  if (d.beSnd) { BE.soundMode = d.beSnd; return rerender(); }
  if (d.bePl) { BE.placeMode = d.bePl; return rerender(); }
  if (d.beCt) { BE.contactMode = d.beCt; return rerender(); }
  if (d.beLevel !== undefined) { BE.level = d.beLevel; return rerender(); }
  if (d.beDelph !== undefined) { BE.addPhotos.splice(Number(d.beDelph), 1); return rerender(); }
  switch (d.be) {
    case 'apply': return applyBulk();
    case 'photo': $('#bePhotoInput').click(); return;
    case 'preview': return togglePreview(BE.sound);
    case 'sysSound': case 'fileSound': {
      const snd = await pickSound(d.be === 'fileSound' ? 'file' : 'system', BE.sound);
      if (snd) { BE.sound = snd; rerender(); }
      return;
    }
    case 'pickcontact':
      try {
        const r = await Native.pickContact();
        if (r && !r.cancelled) { BE.ctName = r.name || ''; BE.ctPhone = r.phone || ''; rerender(); }
      } catch (err) { toast('Contact non récupéré'); }
      return;
  }
}

/* ---------- Composant calendrier ---------- */
function calendarHTML(month, dayAttrs) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  let d = addDays(first, -startOffset);
  const t = ymd(today0());
  let cells = JOURS_COURTS.map(j => `<div class="dow">${j}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const s = ymd(d);
    const at = dayAttrs(d, s) || {};
    const cls = ['cal-day', d.getMonth() !== month.getMonth() ? 'other' : '', s === t ? 'today' : '', at.cls || ''].join(' ');
    cells += `<button class="${cls}" data-day="${s}" style="${at.style || ''}">${d.getDate()}${at.inner || ''}</button>`;
    d = addDays(d, 1);
    if (i === 34 && d.getMonth() !== month.getMonth()) break;
  }
  return `<div class="cal">
    <div class="cal-head"><button data-cal="-1">‹</button><b>${MOIS[month.getMonth()]} ${month.getFullYear()}</b><button data-cal="1">›</button></div>
    <div class="cal-grid">${cells}</div></div>`;
}

/* ---------- Onglet calendrier ---------- */
function renderCalendarTab(v) {
  if (!S.calMonth) S.calMonth = new Date(today0().setDate(1));
  if (!S.calSel) S.calSel = ymd(today0());
  const m = S.calMonth;
  const from = addDays(new Date(m.getFullYear(), m.getMonth(), 1), -7);
  const to = addDays(new Date(m.getFullYear(), m.getMonth() + 1, 0), 8);
  const byDay = {};
  for (const a of S.alarms) {
    if (!a.enabled) continue;
    for (const d of occurrences(a, from, to, 400)) (byDay[ymd(d)] = byDay[ymd(d)] || []).push({ a, d });
  }
  const cal = calendarHTML(m, (d, s) => {
    const list = byDay[s] || [];
    if (!list.length) return { cls: s === S.calSel ? 'sel' : '' };
    const dots = list.slice(0, 4).map(x => `<i style="--c:${colorOf(x.a)}"></i>`).join('');
    return { cls: s === S.calSel ? 'sel' : '', inner: `<span class="dots">${dots}</span>` };
  });
  const sel = (byDay[S.calSel] || []).sort((x, y) => x.d - y.d);
  S.visibleIds = [...new Set(sel.map(x => x.a.id))];
  const allIn = S.visibleIds.length && S.visibleIds.every(id => S.sel.has(id));
  v.innerHTML = cal + `<div class="dayhead"><h2>${capital(fmtDate(parseYmd(S.calSel)))}</h2>
      ${sel.length || S.selMode ? `<button class="btn small" data-sel="toggle">${S.selMode ? 'Terminer' : 'Sélectionner'}</button>` : ''}</div>` +
    (S.selMode ? `<div class="chips">
        ${sel.length ? `<button class="chip ${allIn ? 'on' : ''}" data-sel="all">Tout le jour (${S.visibleIds.length})</button>` : ''}
        ${S.sel.size ? `<button class="chip" data-sel="none">Tout désélectionner</button>` : ''}
      </div><p class="note" style="margin:0 4px 8px">Tu peux changer de jour : ce qui est coché le reste.</p>` : '') +
    (sel.length ? sel.map(x => alarmCard(x.a, x.d)).join('') : `<p class="note" style="padding:0 4px">Aucune alarme ce jour-là.${S.selMode ? '' : ' Touche + pour en créer une à cette date.'}</p>`);
  updateSelBar();
}

/* ---------- Éditeur ---------- */
let ED = null; // alarme en cours d'édition

function blankAlarm(dateStr) {
  const sc = newSchedule('dates');
  sc.dates = [dateStr || ymd(today0())];
  return {
    id: uid(), title: '', description: '', time: S.settings.defaultTime || '07:30',
    level: 'normal', color: '', customColor: false, mode: 'alarm', enabled: true,
    schedule: sc, photos: [], contact: null, place: null, source: null, createdAt: Date.now(),
  };
}

function openEditor(id, dateStr) {
  const existing = S.alarms.find(a => a.id === id);
  ED = existing ? clone(existing) : blankAlarm(dateStr);
  ED._isNew = !existing;
  ED._calMonth = (() => {
    const n = nextOcc(ED) || (ED.schedule.dates[0] ? parseYmd(ED.schedule.dates[0]) : today0());
    return new Date(n.getFullYear(), n.getMonth(), 1);
  })();
  renderEditor();
  showSheet();
}

function showSheet() {
  const s = $('#sheet');
  if (s.hidden) { try { history.pushState({ sheet: 1 }, ''); } catch (e) { /* ignore */ } }
  s.hidden = false; s.scrollTop = 0;
  document.body.classList.add('lock');
}
function closeSheet(fromPop) {
  const s = $('#sheet');
  const wasOpen = !s.hidden;
  s.hidden = true; s.innerHTML = ''; ED = null; BE = null;
  document.body.classList.remove('lock');
  if (wasOpen && !fromPop && history.state && history.state.sheet) history.back();
}

function editorCalendar() {
  const sc = ED.schedule;
  const c = colorOf(ED);
  return calendarHTML(ED._calMonth, (d, s) => {
    let cls = '';
    if (sc.type === 'dates') { if (sc.dates.includes(s)) cls = 'hit'; }
    else {
      const rule = ruleMatches(sc, d);
      if ((sc.except || []).includes(s) && rule) cls = 'except';
      else if ((sc.extra || []).includes(s)) cls = 'hit extra';
      else if (rule) cls = 'hit';
    }
    return { cls, style: `--c:${c}` };
  });
}

function renderEditor() {
  const a = ED, sc = a.schedule;
  const lvl = a.customColor ? null : a.level;
  const legend = sc.type === 'dates'
    ? 'Touche les jours où l’alarme doit sonner (autant que tu veux, sur plusieurs mois).'
    : 'Les jours colorés sonnent. Touche un jour coloré pour l’exclure (barré), ou un jour vide pour l’ajouter en plus.';
  const s = $('#sheet');
  s.innerHTML = `
  <div class="sheet-head">
    <button data-ed="close">✕</button>
    <h3>${a._isNew ? 'Nouvelle alarme' : 'Modifier'}</h3>
    <button class="save" data-ed="save">Enregistrer</button>
  </div>
  <div class="sheet-body">
    <label class="f">Titre</label>
    <input type="text" id="edTitle" value="${esc(a.title)}" placeholder="Ex. : rendre les copies de 5B">

    <label class="f">Raison / description (affichée en entier quand ça sonne)</label>
    <textarea id="edDesc" placeholder="Tout ce que tu veux te rappeler…">${esc(a.description)}</textarea>

    <div class="row">
      <div><label class="f">Heure</label><input type="time" id="edTime" value="${esc(a.time)}" ${a.event ? 'disabled' : ''}></div>
      <div><label class="f">Type</label>
        <select id="edMode">
          <option value="alarm" ${a.mode !== 'notif' ? 'selected' : ''}>Sonnerie d'alarme</option>
          <option value="notif" ${a.mode === 'notif' ? 'selected' : ''}>Rappel discret</option>
        </select></div>
    </div>

    ${a.mode !== 'notif' ? editorRingHTML(a) : ''}

    <label class="f">Urgence (couleur)</label>
    <div class="levels">${LEVELS.map(l => `<button data-level="${l.id}" class="${lvl === l.id ? 'on' : ''}" style="--c:${l.color}">${l.label}</button>`).join('')}</div>
    <label class="custom-color"><input type="color" id="edColor" value="${colorOf(a)}"> Autre couleur${a.customColor ? ' (choisie)' : ''}</label>

    ${editorEventHTML(a)}

    <div ${a.event ? 'hidden' : ''}>
    <label class="f">Quand</label>
    <div class="seg" id="edType">
      <button data-type="dates" class="${sc.type === 'dates' ? 'on' : ''}">Dates choisies</button>
      <button data-type="weekly" class="${sc.type === 'weekly' ? 'on' : ''}">Semaine</button>
      <button data-type="monthly" class="${sc.type === 'monthly' ? 'on' : ''}">Mois</button>
      <button data-type="daily" class="${sc.type === 'daily' ? 'on' : ''}">Chaque jour</button>
    </div>
    ${sc.type === 'weekly' ? `<label class="f">Jours de la semaine</label><div class="wd">${WD_ORDER.map((w, i) => `<button data-wd="${w}" class="${sc.weekdays.includes(w) ? 'on' : ''}">${JOURS_COURTS[i]}</button>`).join('')}</div>` : ''}
    ${sc.type === 'monthly' ? `<label class="f">Jours du mois</label><div class="md">${Array.from({ length: 31 }, (_, i) => i + 1).map(n => `<button data-md="${n}" class="${sc.monthDays.includes(n) ? 'on' : ''}">${n}</button>`).join('')}<button data-md="-1" class="last ${sc.monthDays.includes(-1) ? 'on' : ''}">Dernier jour</button></div>` : ''}
    ${sc.type !== 'dates' ? `<div class="row"><div><label class="f">À partir du</label><input type="date" id="edStart" value="${esc(sc.start)}"></div><div><label class="f">Jusqu'au (facultatif)</label><input type="date" id="edEnd" value="${esc(sc.end)}"></div></div>` : ''}

    <div style="margin-top:12px" id="edCal">${editorCalendar()}</div>
    <div class="cal-legend">${legend}</div>
    <div class="note" id="edNext" style="margin-top:6px"></div>
    </div>

    <label class="f">Photos</label>
    <div class="photos">
      ${a.photos.map((p, i) => `<div class="ph"><img src="${p}" alt=""><button class="x" data-delphoto="${i}">✕</button></div>`).join('')}
      <button class="add" data-ed="photo">+</button>
    </div>
    <input type="file" id="edPhotoInput" accept="image/*" multiple hidden>

    <label class="f">Contact</label>
    ${a.contact ? `<div class="attach"><span>👤</span><div class="t"><b>${esc(a.contact.name || 'Contact')}</b><small>${esc([a.contact.phone, a.contact.email].filter(Boolean).join(' · '))}</small></div><button class="btn small" data-ed="delcontact">Retirer</button></div>` : ''}
    <div class="btns" style="margin-top:0">
      ${isNative ? `<button class="btn small" data-ed="pickcontact">Choisir dans le répertoire</button>` : ''}
      <button class="btn small" data-ed="manualcontact">${a.contact ? 'Modifier' : 'Saisir'} à la main</button>
    </div>
    <div id="contactForm" hidden>
      <input type="text" id="ctName" placeholder="Nom" style="margin-top:8px" value="${esc(a.contact?.name || '')}">
      <input type="tel" id="ctPhone" placeholder="Téléphone" style="margin-top:8px" value="${esc(a.contact?.phone || '')}">
      <input type="email" id="ctEmail" placeholder="E-mail" style="margin-top:8px" value="${esc(a.contact?.email || '')}">
      <div class="btns"><button class="btn small primary" data-ed="savecontact">Valider le contact</button></div>
    </div>

    <label class="f">Lieu</label>
    <input type="text" id="plLabel" placeholder="Nom du lieu ou adresse (ex. : salle 216, 12 calle Alfonso I)" value="${esc(a.place?.label || '')}">
    <input type="url" id="plUrl" placeholder="Lien Google Maps (facultatif, à coller)" style="margin-top:8px" value="${esc(a.place?.url || '')}">
    <div class="btns">
      <button class="btn small" data-ed="here">📍 Ma position actuelle</button>
      <button class="btn small" data-ed="searchmap">Chercher sur Maps</button>
    </div>

    <div class="btns" style="margin-top:28px">
      ${isNative ? `<button class="btn" data-ed="test">🔔 Tester (5 s)</button>` : ''}
      ${!a._isNew ? `<button class="btn" data-ed="dup">Dupliquer</button>` : ''}
    </div>
    ${!a._isNew ? `<div class="btns"><button class="btn danger" data-ed="delete">Supprimer l'alarme</button></div>` : ''}
    ${a.source ? `<p class="note">Créée par import (« ${esc(a.source.name)} »). Un nouvel import du même fichier mettra à jour cette alarme.</p>` : ''}
  </div>`;
  updateEdNext();
}

function editorRingHTML(a) {
  const r = a.ring || {};
  const d = effRing({});
  const own = !!r.sound;
  return `<div class="card" style="margin-top:14px">
      <b>Sonnerie</b>
      <div class="attach" style="margin-top:8px"><span>🎵</span><div class="t"><b>${esc(soundName(r.sound || d.sound))}</b><small>${own ? 'son propre à cette alarme' : 'son par défaut (Réglages)'}</small></div>
        ${isNative ? `<button class="btn small" data-ed="preview">▶</button>` : ''}</div>
      ${isNative ? `<div class="btns" style="margin-top:0">
        <button class="btn small" data-ed="sysSound">Sons du téléphone</button>
        <button class="btn small" data-ed="fileSound">Fichier audio</button>
        ${own ? '<button class="btn small" data-ed="defSound">Par défaut</button>' : ''}
      </div>` : '<p class="note">Choix du son : dans l’appli Android.</p>'}
      <div class="row">
        <div><label class="f">Durée de sonnerie</label>
          <select id="edDur"><option value="">Par défaut (${d.durationMin} min)</option>${DUR_CHOICES.map(n => `<option value="${n}" ${r.durationMin === n ? 'selected' : ''}>${n} min</option>`).join('')}</select></div>
        <div><label class="f">Répétitions</label>
          <select id="edRep"><option value="">Par défaut (${repLabel(d.repeats)})</option>${REP_CHOICES.map(n => `<option value="${n}" ${r.repeats === n ? 'selected' : ''}>${n === 0 ? 'Aucune' : n + ' fois'}</option>`).join('')}</select></div>
      </div>
      <p class="note">Sans réponse, l’alarme s’arrête après la durée choisie, puis resonne ${S.settings.snoozeMin} min plus tard, autant de fois que prévu.</p>
    </div>`;
}

/* ---------- Lien avec un événement de l'agenda ---------- */
const EVENT_OFFSETS = [[0, 'À l’heure de l’événement'], [5, '5 min avant'], [10, '10 min avant'], [15, '15 min avant'], [30, '30 min avant'], [60, '1 h avant'], [120, '2 h avant'], [1440, 'La veille (24 h avant)']];

function eventStart(ev) {
  if (!ev.allDay) return new Date(ev.begin);
  const u = new Date(ev.begin);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 9, 0, 0, 0);
}
function eventLabel(ev) {
  const d = eventStart(ev);
  return `${capital(fmtDate(d))}${ev.allDay ? ' (toute la journée)' : ' à ' + fmtTime(d)}`;
}
function applyEventSchedule(a) {
  if (!a.event) return;
  const d = new Date(eventStart(a.event).getTime() - (Number(a.eventOffset) || 0) * 60000);
  a.schedule = newSchedule('dates');
  a.schedule.dates = [ymd(d)];
  a.time = fmtTime(d);
}

function editorEventHTML(a) {
  if (!a.event) {
    return isNative ? `<div class="btns"><button class="btn" data-ed="linkEvent">📅 Lier à un événement de l’agenda</button></div>` : '';
  }
  const ev = a.event;
  const ring = new Date(eventStart(ev).getTime() - (Number(a.eventOffset) || 0) * 60000);
  return `<div class="card" style="margin-top:14px;border-left:6px solid ${esc(ev.color || '#64748b')}">
      <b>📅 ${esc(ev.title || 'Événement')}</b>
      <div class="note">${esc(eventLabel(ev))}${ev.calendar ? ' · ' + esc(ev.calendar) : ''}</div>
      ${ev.missing ? '<div class="note" style="color:var(--danger)">⚠️ Événement introuvable dans l’agenda (supprimé ?).</div>' : ''}
      <label class="f">Quand sonner</label>
      <select id="edEvOffset">${EVENT_OFFSETS.map(([m, l]) => `<option value="${m}" ${Number(a.eventOffset) === m ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <p class="note">Sonnera ${esc(relDay(ring))} à ${fmtTime(ring)}. Si tu déplaces l’événement dans ton agenda, l’alarme suit (à l’ouverture de l’appli).</p>
      <div class="btns" style="margin-top:0">
        <button class="btn small" data-ed="linkEvent">Changer</button>
        <button class="btn small" data-ed="openEvent">Ouvrir dans l’agenda</button>
        <button class="btn small" data-ed="unlinkEvent">Délier</button>
      </div>
    </div>`;
}

async function openEventPicker(onPick) {
  let pk = $('#picker');
  if (!pk) { pk = document.createElement('div'); pk.id = 'picker'; pk.className = 'sheet picker'; document.body.appendChild(pk); }
  pk.innerHTML = `<div class="sheet-head"><button data-pk="close">✕</button><h3>Choisir un événement</h3></div>
    <div class="sheet-body"><input type="search" id="pkSearch" placeholder="🔍 Rechercher…" autocomplete="off"><div id="pkList" class="note" style="margin-top:12px">Lecture de l’agenda…</div></div>`;
  pk.hidden = false;
  let events = [];
  const draw = () => {
    const w = norm($('#pkSearch').value).trim();
    const list = events.filter(e => !w || norm(e.title + ' ' + e.location + ' ' + e.calendar).includes(w));
    if (!list.length) { $('#pkList').innerHTML = events.length ? 'Aucun événement ne correspond.' : 'Aucun événement dans les 4 prochains mois.'; return; }
    let html = '', day = '';
    list.slice(0, 300).forEach((e, i) => {
      const d = eventStart(e), k = ymd(d);
      if (k !== day) { day = k; html += `<h2>${capital(relDay(d))}</h2>`; }
      html += `<div class="card evrow" data-pk-i="${events.indexOf(e)}" style="border-left:6px solid ${esc(e.color)}">
        <b>${esc(e.title || '(sans titre)')}</b>
        <div class="note">${e.allDay ? 'Toute la journée' : fmtTime(d) + ' – ' + fmtTime(new Date(e.end))}${e.location ? ' · ' + esc(e.location) : ''}</div>
        <div class="note">${esc(e.calendar)}</div></div>`;
    });
    $('#pkList').innerHTML = html;
    $('#pkList').classList.remove('note');
  };
  pk.oninput = e => { if (e.target.id === 'pkSearch') draw(); };
  pk.onclick = e => {
    if (e.target.closest('[data-pk="close"]')) { pk.hidden = true; return; }
    const row = e.target.closest('[data-pk-i]');
    if (row) { pk.hidden = true; onPick(events[Number(row.dataset.pkI)]); }
  };
  try {
    const r = await Native.listEvents({ days: 120 });
    events = (r.events || []).filter(e => !e.allDay || eventStart(e) >= today0());
    draw();
  } catch (err) {
    $('#pkList').textContent = 'Agenda inaccessible : ' + (err.message || err) + '. Autorise l’accès à l’agenda dans les réglages Android de l’appli.';
  }
}

/** Suit les événements liés : si l'un a été déplacé dans l'agenda, l'alarme suit. */
async function syncEvents() {
  if (!Native) return false;
  const linked = S.alarms.filter(a => a.event && a.event.id);
  if (!linked.length) return false;
  let r;
  try { r = await Native.findEvents({ ids: [...new Set(linked.map(a => a.event.id))] }); } catch (e) { return false; }
  if (!r || !r.allowed) return false;
  const byId = {};
  (r.events || []).forEach(e => { (byId[e.id] = byId[e.id] || []).push(e); });
  const now = Date.now();
  let moved = 0, changed = false;
  for (const a of linked) {
    if (a.event.begin < now - 2 * 86400000) continue;
    const insts = byId[a.event.id] || [];
    if (!insts.length) {
      if (!a.event.missing) { a.event.missing = true; changed = true; }
      continue;
    }
    const best = insts.reduce((x, y) => Math.abs(y.begin - a.event.begin) < Math.abs(x.begin - a.event.begin) ? y : x);
    const wasMissing = a.event.missing;
    if (best.begin !== a.event.begin || best.end !== a.event.end || best.allDay !== a.event.allDay || best.title !== a.event.title || wasMissing) {
      if (best.begin !== a.event.begin || best.allDay !== a.event.allDay) moved++;
      Object.assign(a.event, { begin: best.begin, end: best.end, allDay: best.allDay, title: best.title, location: best.location, calendar: best.calendar, color: best.color, missing: false });
      applyEventSchedule(a);
      changed = true;
    }
  }
  if (changed) await DB.set('alarms', S.alarms);
  if (moved) toast(`${moved} alarme(s) déplacée(s) avec leur événement`, 3500);
  return changed;
}

function readEditorFields() {
  if (!ED) return;
  const g = id => document.getElementById(id);
  ED.title = g('edTitle').value.trim();
  ED.description = g('edDesc').value;
  ED.time = g('edTime').value || '07:30';
  if (g('edEvOffset')) { ED.eventOffset = Number(g('edEvOffset').value) || 0; applyEventSchedule(ED); }
  ED.mode = g('edMode').value;
  if (g('edDur')) {
    ED.ring = ED.ring || {};
    ED.ring.durationMin = g('edDur').value ? Number(g('edDur').value) : null;
    ED.ring.repeats = g('edRep').value === '' ? null : Number(g('edRep').value);
  }
  if (g('edStart')) ED.schedule.start = g('edStart').value || ymd(today0());
  if (g('edEnd')) ED.schedule.end = g('edEnd').value || '';
  const label = g('plLabel').value.trim(), url = g('plUrl').value.trim();
  ED.place = (label || url) ? { label, url } : null;
}

function updateEdNext() {
  const el = $('#edNext');
  if (!el || !ED) return;
  const nx = occurrences(ED, new Date(), addDays(new Date(), 3660), 3);
  el.textContent = nx.length
    ? 'Prochaines : ' + nx.map(d => `${relDay(d)} ${fmtTime(d)}`).join(' · ')
    : 'Aucune sonnerie à venir avec ces réglages.';
}

function refreshEditorCalendar() {
  $('#edCal').innerHTML = editorCalendar();
  updateEdNext();
}

async function compressImage(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const r = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } finally { URL.revokeObjectURL(url); }
}

function mapsUrl(place) {
  if (!place) return '';
  if (place.url) return place.url;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.label);
}

async function editorAction(act, el) {
  const sc = ED.schedule;
  if (act === 'close') { closeSheet(); return; }
  readEditorFields();
  switch (act) {
    case 'save': {
      if (sc.type === 'dates' && !sc.dates.length) { toast('Choisis au moins une date dans le calendrier.'); return; }
      if (sc.type === 'weekly' && !sc.weekdays.length) { toast('Choisis au moins un jour de la semaine.'); return; }
      if (sc.type === 'monthly' && !sc.monthDays.length) { toast('Choisis au moins un jour du mois.'); return; }
      if (!ED.title) ED.title = ED.description.split('\n')[0].slice(0, 60) || 'Alarme';
      const isNew = ED._isNew;
      delete ED._isNew; delete ED._calMonth;
      ED.updatedAt = Date.now();
      if (ED.source) ED.source.edited = true;
      const i = S.alarms.findIndex(x => x.id === ED.id);
      if (i >= 0) S.alarms[i] = ED; else S.alarms.push(ED);
      const n = nextOcc(ED);
      closeSheet();
      await saveAlarms();
      render();
      toast(n ? `${isNew ? 'Créée' : 'Enregistrée'} · sonnera ${relDay(n)} à ${fmtTime(n)}` : 'Enregistrée (aucune sonnerie à venir)');
      return;
    }
    case 'delete':
      if (!confirm('Supprimer cette alarme ?')) return;
      S.alarms = S.alarms.filter(x => x.id !== ED.id);
      closeSheet(); await saveAlarms(); render(); toast('Alarme supprimée');
      return;
    case 'dup': {
      const copy = clone(ED); copy.id = uid(); copy.title = (copy.title || 'Alarme') + ' (copie)'; copy.source = null;
      copy._isNew = true; copy._calMonth = ED._calMonth;
      ED = copy; renderEditor(); toast('Copie créée, pense à enregistrer');
      return;
    }
    case 'test':
      try {
        const er = effRing(ED);
        const tid = 'test_' + ED.id;
        S.lastTestId = tid;
        if ((ED.photos || []).length) await Native.setPhotos({ id: tid, photos: ED.photos });
        await Native.test(Object.assign({ seconds: 5, title: ED.title || 'Test', body: ED.description || 'Test d’alarme', color: colorOf(ED), levelLabel: levelOf(ED) ? levelOf(ED).label : '', mode: ED.mode, soundUri: er.sound ? er.sound.uri : '', durationMin: er.durationMin, repeats: 0 }, extrasPayload(ED), { alarmId: tid }));
        toast('Sonnerie dans 5 secondes… tu peux verrouiller le téléphone.');
      } catch (e) { toast('Test impossible : ' + (e.message || e)); }
      return;
    case 'sysSound': case 'fileSound': {
      const snd = await pickSound(act === 'fileSound' ? 'file' : 'system', effRing(ED).sound);
      if (snd) { ED.ring = Object.assign(ED.ring || {}, { sound: snd }); renderEditor(); toast('Son : ' + snd.name); }
      return;
    }
    case 'defSound': ED.ring = Object.assign(ED.ring || {}, { sound: null }); renderEditor(); return;
    case 'linkEvent':
      openEventPicker(ev => {
        if (!ED) return;
        const first = !ED.event;
        ED.event = { id: ev.id, begin: ev.begin, end: ev.end, allDay: ev.allDay, title: ev.title, location: ev.location, calendar: ev.calendar, color: ev.color };
        if (ED.eventOffset === undefined || ED.eventOffset === null) ED.eventOffset = ev.allDay ? 0 : 30;
        if (first || !ED.title) ED.title = ED.title || ev.title;
        if (!ED.description && ev.description) ED.description = ev.description;
        if (!ED.place && ev.location) ED.place = { label: ev.location, url: '' };
        applyEventSchedule(ED);
        const y = $('#sheet').scrollTop; renderEditor(); $('#sheet').scrollTop = y;
        toast('Lié à « ' + (ev.title || 'événement') + ' »');
      });
      return;
    case 'unlinkEvent': ED.event = null; renderEditor(); return;
    case 'openEvent':
      try { await Native.openEvent({ id: ED.event.id, begin: ED.event.begin, end: ED.event.end }); } catch (e) { toast('Impossible d’ouvrir l’agenda'); }
      return;
    case 'preview': togglePreview(effRing(ED).sound); return;
    case 'photo': $('#edPhotoInput').click(); return;
    case 'pickcontact':
      try {
        const r = await Native.pickContact();
        if (r && !r.cancelled) { ED.contact = { name: r.name || '', phone: r.phone || '', email: '' }; renderEditor(); }
      } catch (e) { toast('Contact non récupéré : ' + (e.message || e)); }
      return;
    case 'manualcontact': $('#contactForm').hidden = false; $('#ctName').focus(); return;
    case 'savecontact': {
      const name = $('#ctName').value.trim(), phone = $('#ctPhone').value.trim(), email = $('#ctEmail').value.trim();
      ED.contact = (name || phone || email) ? { name, phone, email } : null;
      renderEditor(); return;
    }
    case 'delcontact': ED.contact = null; renderEditor(); return;
    case 'here':
      if (!navigator.geolocation) { toast('Localisation indisponible'); return; }
      toast('Recherche de ta position…');
      navigator.geolocation.getCurrentPosition(p => {
        const { latitude: la, longitude: lo } = p.coords;
        $('#plUrl').value = `https://www.google.com/maps/search/?api=1&query=${la.toFixed(6)},${lo.toFixed(6)}`;
        if (!$('#plLabel').value) $('#plLabel').value = 'Position enregistrée';
        readEditorFields(); toast('Position ajoutée');
      }, err => toast('Position refusée ou introuvable (' + err.message + ')'), { enableHighAccuracy: true, timeout: 15000 });
      return;
    case 'searchmap': {
      const q = $('#plLabel').value.trim();
      if (!q) { toast('Écris d’abord une adresse ou un nom de lieu.'); return; }
      const u = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
      if (isNative) location.href = u; else window.open(u, '_blank');
      return;
    }
  }
}

function bindSheet() {
  const s = $('#sheet');
  s.addEventListener('click', async e => {
    if (BE) return bulkClick(e);
    if (!ED) {
      const d = e.target.closest('[data-dt]');
      if (d) {
        const act = d.dataset.dt;
        if (act === 'close') closeSheet();
        if (act === 'edit') openEditor(d.dataset.id);
        if (act === 'openevent') {
          const a = S.alarms.find(x => x.id === d.dataset.id);
          if (a && a.event) Native.openEvent({ id: a.event.id, begin: a.event.begin, end: a.event.end }).catch(() => toast('Impossible d’ouvrir l’agenda'));
        }
      }
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    const sc = ED.schedule;
    if (btn.dataset.ed) { e.preventDefault(); return editorAction(btn.dataset.ed, btn); }
    if (btn.dataset.level) {
      readEditorFields();
      ED.level = btn.dataset.level; ED.customColor = false; ED.color = '';
      renderEditor(); return;
    }
    if (btn.dataset.type) {
      readEditorFields();
      const t = btn.dataset.type;
      if (t !== sc.type) {
        const keep = { start: sc.start, end: sc.end };
        if (t === 'dates' && sc.type !== 'dates') {
          ED.schedule = newSchedule('dates');
          ED.schedule.dates = occurrences(ED, today0(), addDays(today0(), 60), 60).map(ymd);
          if (!ED.schedule.dates.length) ED.schedule.dates = [ymd(today0())];
        } else {
          const first = sc.type === 'dates' && sc.dates.length ? parseYmd([...sc.dates].sort()[0]) : today0();
          ED.schedule = Object.assign(newSchedule(t), keep);
          if (t === 'weekly') ED.schedule.weekdays = [first.getDay()];
          if (t === 'monthly') ED.schedule.monthDays = [first.getDate()];
          ED.schedule.start = ymd(first < today0() ? today0() : first);
        }
        renderEditor();
      }
      return;
    }
    if (btn.dataset.wd !== undefined) {
      readEditorFields();
      const w = Number(btn.dataset.wd);
      sc.weekdays = sc.weekdays.includes(w) ? sc.weekdays.filter(x => x !== w) : [...sc.weekdays, w];
      btn.classList.toggle('on'); refreshEditorCalendar(); return;
    }
    if (btn.dataset.md !== undefined) {
      readEditorFields();
      const m = Number(btn.dataset.md);
      sc.monthDays = sc.monthDays.includes(m) ? sc.monthDays.filter(x => x !== m) : [...sc.monthDays, m];
      btn.classList.toggle('on'); refreshEditorCalendar(); return;
    }
    if (btn.dataset.cal) {
      ED._calMonth = new Date(ED._calMonth.getFullYear(), ED._calMonth.getMonth() + Number(btn.dataset.cal), 1);
      refreshEditorCalendar(); return;
    }
    if (btn.dataset.day) {
      readEditorFields();
      const s2 = btn.dataset.day, d = parseYmd(s2);
      const toggle = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
      if (sc.type === 'dates') sc.dates = toggle(sc.dates, s2).sort();
      else if (ruleMatches(sc, d)) { sc.except = toggle(sc.except || [], s2); sc.extra = (sc.extra || []).filter(x => x !== s2); }
      else { sc.extra = toggle(sc.extra || [], s2); sc.except = (sc.except || []).filter(x => x !== s2); }
      refreshEditorCalendar(); return;
    }
    if (btn.dataset.delphoto !== undefined) {
      readEditorFields();
      ED.photos.splice(Number(btn.dataset.delphoto), 1); renderEditor(); return;
    }
  });
  s.addEventListener('input', e => {
    if (BE && e.target.id === 'beColor') {
      readBulkFields(); BE.color = e.target.value; BE.level = 'custom';
      $$('[data-be-level]', s).forEach(x => x.classList.remove('on'));
      return;
    }
    if (!ED) return;
    if (e.target.id === 'edColor') {
      ED.color = e.target.value; ED.customColor = true;
      $$('.levels button', s).forEach(b => b.classList.remove('on'));
      refreshEditorCalendar();
    }
    if (e.target.id === 'edTime' || e.target.id === 'edStart' || e.target.id === 'edEnd') { readEditorFields(); refreshEditorCalendar(); }
    if (e.target.id === 'edEvOffset') { const y = $('#sheet').scrollTop; readEditorFields(); renderEditor(); $('#sheet').scrollTop = y; }
    if (e.target.id === 'edMode') { const y = $('#sheet').scrollTop; readEditorFields(); renderEditor(); $('#sheet').scrollTop = y; }
  });
  s.addEventListener('change', async e => {
    if (BE && e.target.id === 'bePhotoInput') {
      readBulkFields();
      for (const f of e.target.files) { try { BE.addPhotos.push(await compressImage(f)); } catch (err) { toast('Photo illisible'); } }
      const y = $('#sheet').scrollTop; renderBulk(); $('#sheet').scrollTop = y;
      return;
    }
    if (!ED || e.target.id !== 'edPhotoInput') return;
    readEditorFields();
    for (const f of e.target.files) {
      try { ED.photos.push(await compressImage(f)); } catch (err) { toast('Photo illisible'); }
    }
    renderEditor();
  });
}

/* ---------- Fiche détail (lecture complète) ---------- */
function openDetail(id) {
  const a = S.alarms.find(x => x.id === id);
  if (!a) { toast('Cette alarme n’existe plus.'); return; }
  ED = null;
  const now = new Date();
  const nx = a.enabled ? occurrences(a, now, addDays(now, 3660), 12) : [];
  const c = a.contact;
  const s = $('#sheet');
  s.innerHTML = `
  <div class="sheet-head">
    <button data-dt="close">✕</button>
    <h3>Détails</h3>
    <button class="save" data-dt="edit" data-id="${a.id}">Modifier</button>
  </div>
  <div class="sheet-body">
    <div class="detail-hero" style="--c:${colorOf(a)}">
      <div class="lvl">${esc(levelOf(a) && !a.customColor ? levelOf(a).label : 'Alarme')}${a.mode === 'notif' ? ' · rappel discret' : ''}</div>
      <h3>${esc(a.title || 'Alarme')}</h3>
      <div class="when">${a.time} · ${esc(scheduleSummary(a))}</div>
      ${a.mode !== 'notif' ? `<div class="when" style="font-size:13px;opacity:.85;margin-top:4px">🎵 ${esc(ringSummary(a))}</div>` : ''}
    </div>
    <label class="f">Description</label>
    <div class="card desc">${esc(a.description || '(pas de description)')}</div>
    ${a.photos && a.photos.length ? `<label class="f">Photos</label>${a.photos.map(p => `<img class="big-photo" src="${p}" alt="">`).join('')}` : ''}
    ${c ? `<label class="f">Contact</label>
      <div class="attach"><span>👤</span><div class="t"><b>${esc(c.name || 'Contact')}</b><small>${esc([c.phone, c.email].filter(Boolean).join(' · '))}</small></div></div>
      <div class="btns" style="margin-top:0">
        ${c.phone ? `<a class="linkbtn" href="tel:${esc(c.phone.replace(/\s/g, ''))}">📞 Appeler</a><a class="linkbtn" href="sms:${esc(c.phone.replace(/\s/g, ''))}">💬 SMS</a><a class="linkbtn" href="https://wa.me/${esc(c.phone.replace(/[^\d]/g, ''))}">WhatsApp</a>` : ''}
        ${c.email ? `<a class="linkbtn" href="mailto:${esc(c.email)}">✉️ E-mail</a>` : ''}
      </div>` : ''}
    ${a.place ? `<label class="f">Lieu</label>
      <div class="attach"><span>📍</span><div class="t"><b>${esc(a.place.label || 'Lieu')}</b>${a.place.url ? `<small>${esc(a.place.url)}</small>` : ''}</div>${(a.place.url || !/^salle\b/i.test(a.place.label || '')) ? `<a href="${esc(mapsUrl(a.place))}">Ouvrir Maps</a>` : ''}</div>` : ''}
    ${a.event ? `<label class="f">Événement de l’agenda</label>
      <div class="attach"><span>📅</span><div class="t"><b>${esc(a.event.title || 'Événement')}</b><small>${esc(eventLabel(a.event))}${a.event.missing ? ' · introuvable' : ''}</small></div>
      ${isNative ? `<button class="btn small" data-dt="openevent" data-id="${a.id}">Ouvrir</button>` : ''}</div>` : ''}
    <label class="f">Prochaines sonneries</label>
    ${nx.length ? `<div class="card occ">${nx.map(d => `<div>${capital(relDay(d))} ${fmtTime(d)}</div>`).join('')}</div>` : `<p class="note">${a.enabled ? 'Aucune sonnerie à venir.' : 'Alarme désactivée.'}</p>`}
  </div>`;
  showSheet();
}

/* ---------- Import de fichiers ---------- */
const COLS = [
  { k: 'date', label: 'Date', re: /^(date|jour\s*\/?\s*date|fecha|day)$/i, req: true },
  { k: 'time', label: 'Heure / créneau', re: /cr[ée]neau|heure|horaire|hora|time|d[ée]but/i },
  { k: 'title', label: 'Titre / séance', re: /^(s[ée]ance|titre|title|objet|summary|[ée]v[ée]nement|intitul[ée])$/i },
  { k: 'group', label: 'Classe / groupe', re: /^(classe|groupe|group|clase)$/i },
  { k: 'room', label: 'Salle / lieu', re: /^(salle|lieu|location|aula|room)$/i },
  { k: 'type', label: 'Type / éval.', re: /^([ée]val\.?|[ée]valuation|type|note)$/i },
  { k: 'desc', label: 'Description', re: /contenu|description|d[ée]tail|remarque|notes?$/i },
];

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return ymd(v);
  return String(v).trim();
}

/** Renvoie {y,m,d} ou null. yearFor(m) donne l'année quand elle manque. */
function parseDateCell(v, yearFor) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000 && window.XLSX) {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? { y: p.y, m: p.m, d: p.d } : null;
  }
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/);
  if (m) {
    const d = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let y = m[3] ? +m[3] : yearFor(mo);
    if (y < 100) y += 2000;
    return { y, m: mo, d };
  }
  return null;
}

function parseTimeCell(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const m = String(v).match(/(\d{1,2})\s*[h:H]\s*(\d{2})?/);
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const rows = [['Date', 'Heure', 'Titre', 'Lieu', 'Description']];
  let ev = null;
  const unesc = s => s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') ev = {};
    else if (l === 'END:VEVENT' && ev) {
      if (ev.date) rows.push([ev.date, ev.time || '', ev.title || '', ev.loc || '', ev.desc || '']);
      ev = null;
    } else if (ev) {
      const i = l.indexOf(':'); if (i < 0) continue;
      const key = l.slice(0, i).split(';')[0].toUpperCase(), val = l.slice(i + 1);
      if (key === 'DTSTART') {
        const m = val.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?(Z)?/);
        if (m) {
          let d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
          if (m[6]) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
          ev.date = ymd(d); if (m[4]) ev.time = fmtTime(d);
        }
      } else if (key === 'SUMMARY') ev.title = unesc(val);
      else if (key === 'LOCATION') ev.loc = unesc(val);
      else if (key === 'DESCRIPTION') ev.desc = unesc(val);
    }
  }
  return rows;
}

function defaultSchoolYear() {
  const d = new Date();
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
}

function guessHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = rows[i] || [];
    const texts = r.map(cellText);
    if (texts.some(t => COLS[0].re.test(t)) && texts.filter(Boolean).length >= 2) return i;
  }
  return 0;
}

function autoMap(header) {
  const map = {};
  header.forEach((h, i) => {
    const t = cellText(h);
    for (const c of COLS) if (map[c.k] === undefined && c.re.test(t)) { map[c.k] = i; break; }
  });
  return map;
}

function pickSheet(wb) {
  const names = wb.SheetNames;
  const pref = names.find(n => /^s[ée]ances$/i.test(n.trim()));
  if (pref) return pref;
  let best = names[0], bestScore = -1;
  for (const n of names) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
    const hi = guessHeaderRow(rows);
    const score = Object.keys(autoMap(rows[hi] || [])).length * 1000 + rows.length;
    if (score > bestScore) { best = n; bestScore = score; }
  }
  return best;
}

async function readImportFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || 'Import';
  if (/\.ics$/i.test(file.name) || file.type === 'text/calendar') {
    const rows = parseICS(await file.text());
    return { fileName: file.name, name, sheets: ['Agenda'], sheet: 'Agenda', rowsBySheet: { Agenda: rows } };
  }
  const isText = /\.(csv|tsv|txt)$/i.test(file.name) || /^text\//.test(file.type);
  const wb = isText
    ? XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false, raw: true });
  const rowsBySheet = {};
  for (const n of wb.SheetNames) rowsBySheet[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
  return { fileName: file.name, name, sheets: wb.SheetNames, sheet: pickSheet(wb), rowsBySheet };
}

function setupImportSheet() {
  const I = S.imp;
  const rows = I.rowsBySheet[I.sheet] || [];
  I.headerRow = guessHeaderRow(rows);
  I.header = (rows[I.headerRow] || []).map(cellText);
  I.map = autoMap(rows[I.headerRow] || []);
  I.dataRows = rows.slice(I.headerRow + 1).filter(r => r.some(c => cellText(c) !== ''));
  const gi = I.map.group;
  I.groups = gi !== undefined ? [...new Set(I.dataRows.map(r => cellText(r[gi])).filter(Boolean))].sort() : [];
  I.selGroups = new Set(I.groups);
  const ti = I.map.title;
  I.subjects = ti !== undefined ? [...new Set(I.dataRows.map(r => (cellText(r[ti]).match(/^[A-Za-zÀ-ÿ]+/) || [''])[0].toUpperCase()).filter(Boolean))].sort() : [];
  if (I.subjects.length > 8) I.subjects = [];
  I.selSubjects = new Set(I.subjects);
  const ty = I.map.type;
  I.types = ty !== undefined ? [...new Set(I.dataRows.map(r => cellText(r[ty])).filter(Boolean))] : [];
  I.filter = I.types.length ? 'marked' : 'all';
}

function newImportState(parsed) {
  S.imp = Object.assign(parsed, {
    schoolYear: defaultSchoolYear(),
    remind: 'veille', veilleTime: S.settings.veilleTime || '20:00', dayTime: '07:00', beforeMin: 30,
    skipPast: true, removeMissing: true,
    colors: { star: 'urgent', int: 'important', other: 'normal' },
    sourceName: parsed.name,
  });
  setupImportSheet();
}

function rowKind(t) {
  const s = (t || '').trim();
  if (!s) return 'other';
  if (/int/i.test(s)) return 'int';
  return 'star';
}

/** Construit les alarmes candidates à partir du fichier et des choix. */
function buildCandidates() {
  const I = S.imp, M = I.map;
  const yearFor = mo => (mo >= 8 ? I.schoolYear : I.schoolYear + 1);
  const g = (r, k) => (M[k] !== undefined ? r[M[k]] : '');
  const out = [], skipped = { nodate: 0, past: 0 };
  const now = new Date();
  for (const r of I.dataRows) {
    const kind = rowKind(cellText(g(r, 'type')));
    if (M.type !== undefined) {
      if (I.filter === 'marked' && kind === 'other') continue;
      if (I.filter === 'star' && kind !== 'star') continue;
      if (I.filter === 'int' && kind !== 'int') continue;
    }
    const grp = cellText(g(r, 'group'));
    if (I.groups.length && !I.selGroups.has(grp)) continue;
    const title = cellText(g(r, 'title'));
    if (I.subjects.length) {
      const subj = (title.match(/^[A-Za-zÀ-ÿ]+/) || [''])[0].toUpperCase();
      if (!I.selSubjects.has(subj)) continue;
    }
    const dt = parseDateCell(g(r, 'date'), yearFor);
    if (!dt) { skipped.nodate++; continue; }
    const eventDay = new Date(dt.y, dt.m - 1, dt.d);
    const slot = cellText(g(r, 'time'));
    const startTime = parseTimeCell(g(r, 'time'));
    const eventAt = startTime ? atTime(ymd(eventDay), startTime) : null;

    let ringDay = eventDay, ringTime, prefix;
    if (I.remind === 'veille') { ringDay = addDays(eventDay, -1); ringTime = I.veilleTime; prefix = 'Demain'; }
    else if (I.remind === 'day') { ringTime = I.dayTime; prefix = "Aujourd'hui"; }
    else {
      const base = eventAt || atTime(ymd(eventDay), I.dayTime);
      const t = new Date(base.getTime() - I.beforeMin * 60000);
      ringDay = new Date(t); ringDay.setHours(0, 0, 0, 0); ringTime = fmtTime(t); prefix = `Dans ${I.beforeMin} min`;
    }
    const ringAt = atTime(ymd(ringDay), ringTime);
    if (I.skipPast && ringAt < now) { skipped.past++; continue; }

    const room = cellText(g(r, 'room'));
    const desc = cellText(g(r, 'desc'));
    const what = kind === 'star' && M.type !== undefined ? 'évaluation' : kind === 'int' ? 'interrogation' : '';
    const label = [title, grp].filter(Boolean).join(' · ') || desc.slice(0, 50) || 'Rappel';
    const fullTitle = `${prefix} : ${what ? what + ' ' : ''}${label}`;
    const when = `${capital(fmtDate(eventDay))} ${eventDay.getFullYear()}${slot ? ' · ' + slot : ''}${room ? ' · salle ' + room.replace(/^salle\s*/i, '') : ''}`;
    const description = when + (desc ? '\n\n' + desc : '');
    const key = (title || grp) ? [grp, title, M.type !== undefined ? kind : ''].join('|') : ymd(eventDay) + '|' + label;
    const level = I.colors[kind] || 'normal';
    out.push({ key, title: fullTitle, description, date: ymd(ringDay), time: ringTime, level, place: room ? { label: /^\d/.test(room) ? 'Salle ' + room : room, url: '' } : null, eventDay: ymd(eventDay) });
  }
  // clés en double (même séance listée deux fois) : on rend la clé unique avec la date
  const seen = {};
  for (const c of out) { if (seen[c.key]) c.key += '|' + c.eventDay; seen[c.key] = 1; }
  return { list: out, skipped };
}

function diffImport(cands) {
  const src = S.imp.sourceName;
  const existing = S.alarms.filter(a => a.source && a.source.name === src);
  const byKey = new Map(existing.map(a => [a.source.key, a]));
  const res = { add: [], upd: [], same: [], del: [] };
  const seen = new Set();
  for (const c of cands) {
    const a = byKey.get(c.key);
    seen.add(c.key);
    if (!a) { res.add.push(c); continue; }
    const changed = a.schedule.dates[0] !== c.date || a.time !== c.time || a.title !== c.title || a.description !== c.description || a.level !== c.level;
    (changed ? res.upd : res.same).push({ c, a });
  }
  for (const a of existing) if (!seen.has(a.source.key)) res.del.push(a);
  return res;
}

async function applyImport() {
  const { list } = buildCandidates();
  const d = diffImport(list);
  const src = S.imp.sourceName;
  const mk = c => {
    const a = blankAlarm(c.date);
    Object.assign(a, { title: c.title, description: c.description, time: c.time, level: c.level, place: c.place, source: { name: src, key: c.key, file: S.imp.fileName } });
    return a;
  };
  for (const c of d.add) S.alarms.push(mk(c));
  for (const { c, a } of d.upd) {
    a.title = c.title; a.description = c.description; a.time = c.time; a.level = c.level; a.customColor = false; a.color = '';
    a.schedule = newSchedule('dates'); a.schedule.dates = [c.date];
    if (c.place && !a.place) a.place = c.place;
    a.updatedAt = Date.now();
  }
  let removed = 0;
  if (S.imp.removeMissing) {
    const now = new Date();
    const ids = new Set(d.del.filter(a => { const n = nextOcc(a, now); return n || !a.enabled; }).map(a => a.id));
    removed = ids.size;
    S.alarms = S.alarms.filter(a => !ids.has(a.id));
  }
  S.settings.veilleTime = S.imp.veilleTime;
  await DB.set('settings', S.settings);
  await saveAlarms();
  S.imp = null;
  S.listFilter = 'import';
  go('list');
  toast(`Import terminé : ${d.add.length} créées, ${d.upd.length} mises à jour${removed ? `, ${removed} supprimées` : ''}.`, 4000);
}

function renderImport(v) {
  const I = S.imp;
  const sources = {};
  for (const a of S.alarms) if (a.source) sources[a.source.name] = (sources[a.source.name] || 0) + 1;
  const srcList = Object.entries(sources);

  if (!I) {
    v.innerHTML = `
      <div class="card">
        <p style="margin-top:0">Importe un fichier contenant une colonne de dates : Excel (.xlsx, .xls, .ods), CSV ou agenda (.ics). L'appli crée une alarme par ligne retenue, avec la description complète.</p>
        <p class="note">Pour le calendrier des classes : choisis le fichier depuis Drive, l'onglet « Séances » est repéré tout seul. Tu pourras réimporter le fichier après chaque modification : les alarmes seront mises à jour sans doublon.</p>
        <div class="btns"><button class="btn primary" data-imp="pick">Choisir un fichier</button></div>
        <input type="file" id="impFile" accept=".xlsx,.xls,.ods,.csv,.ics,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/calendar" hidden>
      </div>
      ${srcList.length ? `<h2>Imports existants</h2>${srcList.map(([n, c]) => `<div class="card row"><div><b>${esc(n)}</b><div class="note">${c} alarme${c > 1 ? 's' : ''}</div></div><button class="btn small danger" style="flex:none" data-delsrc="${esc(n)}">Tout supprimer</button></div>`).join('')}` : ''}`;
    return;
  }

  const M = I.map;
  const colSel = c => `<select data-map="${c.k}"><option value="">— aucune —</option>${I.header.map((h, i) => `<option value="${i}" ${M[c.k] === i ? 'selected' : ''}>${esc(h || 'Colonne ' + (i + 1))}</option>`).join('')}</select>`;
  const { list, skipped } = buildCandidates();
  const diff = diffImport(list);
  const tag = c => diff.add.includes(c) ? '<span class="tag new">nouvelle</span>' : diff.upd.some(x => x.c === c) ? '<span class="tag upd">modifiée</span>' : '<span class="tag">inchangée</span>';
  const lvlSel = k => `<select data-color="${k}">${LEVELS.map(l => `<option value="${l.id}" ${I.colors[k] === l.id ? 'selected' : ''}>${l.label}</option>`).join('')}</select>`;
  const sy = I.schoolYear;

  v.innerHTML = `
  <div class="card row"><div><b>${esc(I.fileName)}</b><div class="note">${I.dataRows.length} lignes lues</div></div><button class="btn small" style="flex:none" data-imp="cancel">Annuler</button></div>
  <div class="steps">
    <div class="step card">
      <h4>Feuille et colonnes</h4>
      ${I.sheets.length > 1 ? `<label class="f">Feuille</label><select id="impSheet">${I.sheets.map(n => `<option ${n === I.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}
      <label class="f">Colonnes reconnues (modifiables)</label>
      <div class="map">${COLS.map(c => `<span>${c.label}${c.req ? ' *' : ''}</span>${colSel(c)}`).join('')}</div>
      <label class="f">Année scolaire (pour les dates sans année)</label>
      <select id="impYear">${[sy - 1, sy, sy + 1].map(y => `<option value="${y}" ${y === sy ? 'selected' : ''}>${y}-${y + 1} (sept.-déc. ${y}, janv.-août ${y + 1})</option>`).join('')}</select>
    </div>

    <div class="step card">
      <h4>Lignes à garder</h4>
      ${M.type !== undefined ? `<div class="seg" id="impFilter">
        <button data-f="marked" class="${I.filter === 'marked' ? 'on' : ''}">★ + INT</button>
        <button data-f="star" class="${I.filter === 'star' ? 'on' : ''}">★ seules</button>
        <button data-f="int" class="${I.filter === 'int' ? 'on' : ''}">INT seules</button>
        <button data-f="all" class="${I.filter === 'all' ? 'on' : ''}">Toutes</button>
      </div>` : '<p class="note">Pas de colonne « type » : toutes les lignes datées sont prises.</p>'}
      ${I.groups.length ? `<label class="f">Classes</label><div class="checks">${I.groups.map(gr => `<button class="chip ${I.selGroups.has(gr) ? 'on' : ''}" data-grp="${esc(gr)}">${esc(gr)}</button>`).join('')}</div>` : ''}
      ${I.subjects.length > 1 ? `<label class="f">Matières</label><div class="checks">${I.subjects.map(su => `<button class="chip ${I.selSubjects.has(su) ? 'on' : ''}" data-subj="${esc(su)}">${esc(su)}</button>`).join('')}</div>` : ''}
      <label class="custom-color" style="margin-top:12px"><input type="checkbox" id="impPast" ${I.skipPast ? 'checked' : ''} style="width:20px;height:20px"> Ignorer les dates déjà passées</label>
    </div>

    <div class="step card">
      <h4>Quand sonner</h4>
      <div class="seg" id="impRemind">
        <button data-rm="veille" class="${I.remind === 'veille' ? 'on' : ''}">La veille</button>
        <button data-rm="day" class="${I.remind === 'day' ? 'on' : ''}">Le jour même</button>
        <button data-rm="before" class="${I.remind === 'before' ? 'on' : ''}">Avant le cours</button>
      </div>
      <div style="margin-top:10px">
        ${I.remind === 'veille' ? `<label class="f">Heure, la veille</label><input type="time" id="impVeille" value="${I.veilleTime}">` : ''}
        ${I.remind === 'day' ? `<label class="f">Heure, le jour même</label><input type="time" id="impDay" value="${I.dayTime}">` : ''}
        ${I.remind === 'before' ? `<label class="f">Minutes avant le début du créneau</label><input type="number" id="impBefore" min="1" max="600" value="${I.beforeMin}">` : ''}
      </div>
    </div>

    <div class="step card">
      <h4>Couleurs</h4>
      ${M.type !== undefined ? `<div class="map"><span>★ évaluation</span>${lvlSel('star')}<span>INT</span>${lvlSel('int')}<span>Autres lignes</span>${lvlSel('other')}</div>` : `<div class="map"><span>Toutes</span>${lvlSel('other')}</div>`}
    </div>

    <div class="step card">
      <h4>Vérifier et créer</h4>
      <label class="f">Nom de l'import (sert à reconnaître le fichier au prochain import)</label>
      <input type="text" id="impName" value="${esc(I.sourceName)}">
      <div class="summary"><b>${list.length}</b> alarmes : ${diff.add.length} nouvelles, ${diff.upd.length} modifiées, ${diff.same.length} inchangées.
        ${skipped.past ? `<br>${skipped.past} lignes ignorées (dates passées).` : ''}${skipped.nodate ? `<br>${skipped.nodate} lignes sans date lisible.` : ''}</div>
      ${diff.del.length ? `<label class="custom-color"><input type="checkbox" id="impDel" ${I.removeMissing ? 'checked' : ''} style="width:20px;height:20px"> Supprimer ${diff.del.length} alarme(s) de cet import absente(s) du fichier ou des filtres</label>` : ''}
      <div class="preview" style="margin-top:8px">
        ${list.slice(0, 150).map(c => `<div style="--c:${LEVELS.find(l => l.id === c.level).color}"><span class="dot"></span><span style="flex:1"><b>${fmtShort(parseYmd(c.date))} ${c.time}</b> — ${esc(c.title)}</span>${tag(c)}</div>`).join('')}
        ${diff.del.map(a => `<div style="--c:#999"><span class="dot"></span><span style="flex:1;text-decoration:line-through">${esc(a.title)}</span><span class="tag del">retirée</span></div>`).join('')}
        ${list.length > 150 ? `<div class="note">… et ${list.length - 150} autres</div>` : ''}
        ${!list.length && !diff.del.length ? '<div class="note">Aucune ligne ne correspond aux choix.</div>' : ''}
      </div>
      <div class="btns"><button class="btn primary" data-imp="apply" ${(list.length || (diff.del.length && I.removeMissing)) && M.date !== undefined ? '' : 'disabled'}>Créer / mettre à jour les alarmes</button></div>
      ${M.date === undefined ? '<p class="note" style="color:var(--danger)">Indique quelle colonne contient les dates.</p>' : ''}
    </div>
  </div>`;
}

function bindImport() {
  const v = $('#view');
  v.addEventListener('click', async e => {
    if (S.tab !== 'import') return;
    const b = e.target.closest('button');
    if (!b) return;
    const I = S.imp;
    if (b.dataset.imp === 'pick') { $('#impFile').click(); return; }
    if (b.dataset.imp === 'cancel') { S.imp = null; render(); return; }
    if (b.dataset.imp === 'apply') { b.disabled = true; await applyImport(); return; }
    if (b.dataset.delsrc) {
      const n = b.dataset.delsrc;
      if (!confirm(`Supprimer toutes les alarmes de « ${n} » ?`)) return;
      S.alarms = S.alarms.filter(a => !(a.source && a.source.name === n));
      await saveAlarms(); render(); toast('Alarmes supprimées'); return;
    }
    if (!I) return;
    if (b.dataset.f) I.filter = b.dataset.f;
    else if (b.dataset.rm) I.remind = b.dataset.rm;
    else if (b.dataset.grp !== undefined) { const x = b.dataset.grp; I.selGroups.has(x) ? I.selGroups.delete(x) : I.selGroups.add(x); }
    else if (b.dataset.subj !== undefined) { const x = b.dataset.subj; I.selSubjects.has(x) ? I.selSubjects.delete(x) : I.selSubjects.add(x); }
    else return;
    keepScroll(render);
  });
  v.addEventListener('change', async e => {
    if (S.tab !== 'import') return;
    const t = e.target;
    if (t.id === 'impFile') {
      const f = t.files[0];
      if (!f) return;
      try {
        toast('Lecture du fichier…');
        newImportState(await readImportFile(f));
        render();
      } catch (err) { toast('Fichier illisible : ' + (err.message || err), 4000); }
      return;
    }
    const I = S.imp;
    if (!I) return;
    if (t.id === 'impSheet') { I.sheet = t.value; setupImportSheet(); }
    else if (t.dataset.map) { if (t.value === '') delete I.map[t.dataset.map]; else I.map[t.dataset.map] = Number(t.value); if (t.dataset.map === 'type' || t.dataset.map === 'group' || t.dataset.map === 'title') refreshDerived(); }
    else if (t.dataset.color) I.colors[t.dataset.color] = t.value;
    else if (t.id === 'impYear') I.schoolYear = Number(t.value);
    else if (t.id === 'impPast') I.skipPast = t.checked;
    else if (t.id === 'impDel') I.removeMissing = t.checked;
    else if (t.id === 'impVeille') I.veilleTime = t.value || '20:00';
    else if (t.id === 'impDay') I.dayTime = t.value || '07:00';
    else if (t.id === 'impBefore') I.beforeMin = Math.max(1, Number(t.value) || 30);
    else if (t.id === 'impName') I.sourceName = t.value.trim() || I.name;
    else return;
    keepScroll(render);
  });
}

function refreshDerived() {
  const I = S.imp;
  const gi = I.map.group, ti = I.map.title, ty = I.map.type;
  I.groups = gi !== undefined ? [...new Set(I.dataRows.map(r => cellText(r[gi])).filter(Boolean))].sort() : [];
  I.selGroups = new Set(I.groups);
  I.subjects = ti !== undefined ? [...new Set(I.dataRows.map(r => (cellText(r[ti]).match(/^[A-Za-zÀ-ÿ]+/) || [''])[0].toUpperCase()).filter(Boolean))].sort() : [];
  if (I.subjects.length > 8) I.subjects = [];
  I.selSubjects = new Set(I.subjects);
  I.types = ty !== undefined ? [...new Set(I.dataRows.map(r => cellText(r[ty])).filter(Boolean))] : [];
  if (ty === undefined) I.filter = 'all';
}

function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

/* ---------- Réglages ---------- */
const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function bulkMatches() {
  const w = norm(S.bulkWord).trim();
  if (w.length < 2) return [];
  return S.alarms.filter(a => norm(a.title + ' ' + a.description + ' ' + (a.source ? a.source.name : '')).includes(w));
}
function bulkResultHTML() {
  const w = (S.bulkWord || '').trim();
  if (w.length < 2) return 'Tape au moins 2 lettres. Les majuscules et les accents ne comptent pas.';
  const m = bulkMatches();
  if (!m.length) return `Aucune alarme ne contient « ${esc(w)} ».`;
  const list = m.slice(0, 8).map(a => `<div>• ${esc(a.title)}</div>`).join('');
  return `<b>${m.length}</b> alarme${m.length > 1 ? 's' : ''} contien${m.length > 1 ? 'nent' : 't'} « ${esc(w)} » :
    <div style="margin:6px 0">${list}${m.length > 8 ? `<div>… et ${m.length - 8} autres</div>` : ''}</div>
    <div class="btns"><button class="btn danger" data-set="bulkdel">Supprimer ${m.length > 1 ? 'les ' + m.length + ' alarmes' : 'cette alarme'}</button></div>`;
}

function backupStatus() {
  const t = S.settings.lastBackup;
  if (!t) return S.alarms.length ? '⚠️ Aucune sauvegarde pour l’instant.' : 'Aucune sauvegarde pour l’instant.';
  const days = Math.floor((Date.now() - t) / 86400000);
  return `Dernière sauvegarde : ${days === 0 ? 'aujourd’hui' : days === 1 ? 'hier' : 'il y a ' + days + ' jours'}${S.settings.lastBackupName ? ' (' + esc(S.settings.lastBackupName) + ')' : ''}.`;
}
function backupDue() {
  return S.alarms.length >= 5 && (!S.settings.lastBackup || Date.now() - S.settings.lastBackup > 30 * 86400000);
}

async function doBackup() {
  const settings = Object.assign({}, S.settings);
  delete settings.lastBackup; delete settings.lastBackupName; delete settings.lastBackupUri;
  const data = { app: 'alarmes', version: VERSION, exportedAt: new Date().toISOString(), alarms: S.alarms, settings };
  const content = JSON.stringify(data);
  const name = `alarmes-sauvegarde-${ymd(new Date())}.json`;
  let savedName = name, savedUri = '';
  if (Native) {
    try {
      const r = await Native.saveToDownloads({ name, content });
      savedName = 'Téléchargements/Alarmes/' + (r.name || name);
      savedUri = r.uri || '';
    } catch (e) {
      // Android ancien : repli sur le choix de l'emplacement
      try {
        const r = await Native.saveFile({ name, content, mime: 'application/json' });
        if (!r || r.cancelled) return;
        savedName = r.name || name;
      } catch (e2) { toast('Sauvegarde impossible : ' + (e2.message || e2), 4000); return; }
    }
  } else {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  S.settings.lastBackup = Date.now();
  S.settings.lastBackupName = savedName;
  S.settings.lastBackupUri = savedUri;
  await DB.set('settings', S.settings);
  keepScroll(render);
  if (savedUri) toastAction(`Sauvegardé (${S.alarms.length} alarmes) dans ${savedName}`, 'Envoyer vers Drive', shareBackup, 8000);
  else toast(`Sauvegarde enregistrée : ${S.alarms.length} alarme(s)`);
}

async function shareBackup() {
  if (!Native || !S.settings.lastBackupUri) { toast('Fais d’abord une sauvegarde'); return; }
  try { await Native.shareFile({ uri: S.settings.lastBackupUri, mime: 'application/json', title: 'Envoyer la sauvegarde' }); }
  catch (e) { toast('Envoi impossible : ' + (e.message || e)); }
}

async function doRestore(file, mode) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('Fichier illisible'); return; }
  if (!data || data.app !== 'alarmes' || !Array.isArray(data.alarms)) { toast('Ce fichier n’est pas une sauvegarde d’Alarmes'); return; }
  const incoming = data.alarms.filter(a => a && a.id && a.schedule);
  if (mode === 'replace') {
    if (!confirm(`Remplacer tes ${S.alarms.length} alarme(s) par les ${incoming.length} de la sauvegarde du ${(data.exportedAt || '').slice(0, 10)} ?`)) return;
    S.alarms = incoming;
    if (data.settings) Object.assign(S.settings, data.settings);
    await DB.set('settings', S.settings);
    await saveAlarms();
    toast(`${incoming.length} alarme(s) restaurée(s)`);
  } else {
    const ids = new Set(S.alarms.map(a => a.id));
    let added = 0, skipped = 0;
    for (const a of incoming) {
      if (ids.has(a.id)) { skipped++; continue; }
      S.alarms.push(a); added++;
    }
    await saveAlarms();
    toast(`${added} alarme(s) ajoutée(s)${skipped ? `, ${skipped} déjà présente(s)` : ''}`);
  }
  keepScroll(render);
}

async function renderSettings(v) {
  let st = null;
  if (Native) { try { st = await Native.status(); } catch (e) { st = null; } }
  if (S.tab !== 'settings') return;
  const row = (ok, title, sub, btn) => `<div class="perm"><span class="${ok ? 'ok' : 'ko'}">${ok ? '✓' : '!'}</span><div class="t">${title}<small>${sub}</small></div>${ok ? '' : btn}</div>`;
  v.innerHTML = `
    ${isNative ? `<h2>Fonctionnement des alarmes</h2>
    <div class="card">
      ${st ? row(st.notifications, 'Notifications', 'Indispensable pour que l’alarme s’affiche', `<button class="btn small" data-set="notif">Autoriser</button>`) +
        row(st.exact, 'Alarmes à l’heure exacte', 'Sinon Android peut retarder la sonnerie', `<button class="btn small" data-open="exact">Régler</button>`) +
        row(st.fullScreen, 'Écran plein sur téléphone verrouillé', 'Affiche la raison en grand quand ça sonne', `<button class="btn small" data-open="fullScreen">Régler</button>`) +
        row(st.overlay, 'Afficher par-dessus les autres applis', 'Ouvre l’écran d’alarme même quand tu utilises le téléphone', `<button class="btn small" data-open="overlay">Régler</button>`) +
        row(st.batteryFree, 'Pas d’économie de batterie', 'Sur realme/ColorOS, évite que l’appli soit endormie', `<button class="btn small" data-open="battery">Régler</button>`)
        : '<p class="note">État indisponible.</p>'}
      <div class="btns"><button class="btn primary" data-set="test">🔔 Tester une alarme dans 5 s</button></div>
      <p class="note">${lastSync.count} sonnerie(s) programmée(s) dans Android${lastSync.until ? `, jusqu'au ${fmtShort(lastSync.until)}` : ''}. Le programme est prolongé à chaque ouverture de l'appli : ouvre-la au moins une fois par mois.</p>
    </div>
    <h2>Réglages realme / ColorOS à vérifier</h2>
    <div class="card note">
      <div>• <b>Batterie</b> : Alarmes › « Autoriser l’activité en arrière-plan » et « Démarrage automatique ».</div>
      <div style="margin-top:6px">• <b>Notifications</b> : catégorie « Alarmes » avec Bannière et Écran de verrouillage cochés.</div>
      <div style="margin-top:6px">• <b>Accès spécial</b> (Paramètres › Applis) : « Afficher par-dessus d’autres applis » et, s’il existe, « Notifications plein écran » ou « Afficher sur l’écran de verrouillage ».</div>
      <div class="btns"><button class="btn small" data-open="app">Ouvrir la fiche de l’appli</button></div>
    </div>` : `<div class="card"><b>Mode navigateur</b><p class="note">Ici, les alarmes ne sonnent que si la page est ouverte. Installe l'APK Android pour de vraies alarmes, même téléphone verrouillé.</p>
      ${'Notification' in window && Notification.permission !== 'granted' ? '<div class="btns"><button class="btn small" data-set="webnotif">Autoriser les notifications</button></div>' : ''}</div>`}

    <h2>Sonnerie par défaut</h2>
    <div class="card">
      <div class="attach"><span>🎵</span><div class="t"><b>${esc(soundName(S.settings.sound))}</b><small>utilisé par toutes les alarmes sans son propre</small></div>
        ${isNative ? '<button class="btn small" data-set="preview">▶</button>' : ''}</div>
      ${isNative ? `<div class="btns" style="margin-top:0">
        <button class="btn small" data-set="sysSound">Sons du téléphone</button>
        <button class="btn small" data-set="fileSound">Fichier audio</button>
        ${S.settings.sound ? '<button class="btn small" data-set="defSound">Son d’alarme standard</button>' : ''}
      </div>` : '<p class="note">Choix du son : dans l’appli Android.</p>'}
      <div class="row">
        <div><label class="f">Durée de sonnerie</label>
          <select id="setDur">${DUR_CHOICES.map(n => `<option value="${n}" ${Number(S.settings.ringMin) === n ? 'selected' : ''}>${n} min</option>`).join('')}</select></div>
        <div><label class="f">Répétitions</label>
          <select id="setRep">${REP_CHOICES.map(n => `<option value="${n}" ${Number(S.settings.repeats) === n ? 'selected' : ''}>${n === 0 ? 'Aucune' : n + ' fois'}</option>`).join('')}</select></div>
      </div>
      <label class="f">Intervalle (snooze et répétitions)</label>
      <select id="setSnooze">${[5, 10, 15, 20, 30, 60].map(n => `<option value="${n}" ${Number(S.settings.snoozeMin) === n ? 'selected' : ''}>${n} minutes</option>`).join('')}</select>
      <p class="note">Sans réponse, l’alarme sonne pendant la durée choisie, s’arrête, puis resonne après l’intervalle, autant de fois que prévu. Chaque alarme peut avoir ses propres réglages.</p>
    </div>

    <h2>Modifier ou supprimer en groupe</h2>
    <div class="card note">Onglet Alarmes : cherche un mot, touche « Sélectionner », puis « Tout sélectionner ». Tu peux ensuite modifier, activer, désactiver ou supprimer toutes ces alarmes d’un coup.</div>

    <h2>Préférences</h2>
    <div class="card">
      <label class="f">Heure par défaut d'une nouvelle alarme</label>
      <input type="time" id="setDefTime" value="${S.settings.defaultTime}">
    </div>

    <h2>Sauvegarde</h2>
    <div class="card">
      <p class="note" style="margin-top:0">${backupStatus()}</p>
      <div class="btns" style="margin-top:0"><button class="btn primary" data-set="backup">💾 Sauvegarder maintenant</button></div>
      ${isNative && S.settings.lastBackupUri ? '<div class="btns"><button class="btn small" data-set="sharebackup">☁️ Envoyer la dernière sauvegarde vers Drive</button></div>' : ''}
      <div class="btns">
        <button class="btn small" data-set="restore">Restaurer (remplace tout)</button>
        <button class="btn small" data-set="merge">Ajouter depuis une sauvegarde</button>
      </div>
      <input type="file" id="restoreFile" accept=".json,application/json,text/plain" hidden>
      <p class="note">Le fichier est enregistré dans Téléchargements › Alarmes. Envoie-le vers Drive (choisis « Drive » dans le menu de partage) pour le retrouver après un changement de téléphone. Photos et réglages compris.</p>
    </div>

    <h2>À venir</h2>
    <div class="card note">Lecture directe d’un fichier sur Drive, sans passer par le sélecteur de fichiers.</div>
    <p class="note" style="text-align:center;margin-top:20px">Alarmes v${VERSION} · ${S.alarms.length} alarme(s)</p>`;
}

function bindSettings() {
  const v = $('#view');
  v.addEventListener('click', async e => {
    if (S.tab !== 'settings') return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.open && Native) { await Native.openSettings({ which: b.dataset.open }); return; }
    if (b.dataset.set === 'notif' && Native) { await Native.requestNotifications(); render(); return; }
    if (b.dataset.set === 'bulkdel') {
      const m = bulkMatches();
      if (!m.length) return;
      if (!confirm(`Supprimer définitivement ${m.length} alarme(s) contenant « ${S.bulkWord.trim()} » ?`)) return;
      const ids = new Set(m.map(a => a.id));
      S.alarms = S.alarms.filter(a => !ids.has(a.id));
      await saveAlarms();
      S.bulkWord = '';
      render();
      toast(`${ids.size} alarme(s) supprimée(s)`);
      return;
    }
    if (b.dataset.set === 'sysSound' || b.dataset.set === 'fileSound') {
      const snd = await pickSound(b.dataset.set === 'fileSound' ? 'file' : 'system', S.settings.sound);
      if (snd) { S.settings.sound = snd; await saveSettings(); keepScroll(render); toast('Son par défaut : ' + snd.name); }
      return;
    }
    if (b.dataset.set === 'defSound') { S.settings.sound = null; await saveSettings(); keepScroll(render); return; }
    if (b.dataset.set === 'preview') { togglePreview(S.settings.sound); return; }
    if (b.dataset.set === 'test' && Native) {
      const er = effRing({});
      await Native.test({ seconds: 5, soundUri: er.sound ? er.sound.uri : '', durationMin: er.durationMin, repeats: 0 });
      toast('Sonnerie dans 5 secondes… verrouille le téléphone pour voir l’écran plein.');
      return;
    }
    if (b.dataset.set === 'webnotif') { await Notification.requestPermission(); render(); }
    if (b.dataset.set === 'backup') { await doBackup(); return; }
    if (b.dataset.set === 'sharebackup') { await shareBackup(); return; }
    if (b.dataset.set === 'restore' || b.dataset.set === 'merge') {
      S.restoreMode = b.dataset.set === 'restore' ? 'replace' : 'merge';
      const inp = $('#restoreFile'); inp.value = ''; inp.click();
      return;
    }
  });
  v.addEventListener('change', async e => {
    if (S.tab !== 'settings') return;
    if (e.target.id === 'setSnooze') { S.settings.snoozeMin = Number(e.target.value); await saveSettings(); toast('Snooze : ' + e.target.value + ' min'); }
    if (e.target.id === 'setDefTime') { S.settings.defaultTime = e.target.value || '07:30'; await saveSettings(); }
    if (e.target.id === 'restoreFile' && e.target.files[0]) { await doRestore(e.target.files[0], S.restoreMode || 'merge'); return; }
    if (e.target.id === 'setDur') { S.settings.ringMin = Number(e.target.value); await saveSettings(); toast('Durée : ' + e.target.value + ' min'); }
    if (e.target.id === 'setRep') { S.settings.repeats = Number(e.target.value); await saveSettings(); toast('Répétitions : ' + repLabel(Number(e.target.value))); }
  });
  v.addEventListener('input', e => {
    if (S.tab !== 'settings' || e.target.id !== 'bulkWord') return;
    S.bulkWord = e.target.value;
    $('#bulkRes').innerHTML = bulkResultHTML();
  });
}

/* ---------- Liaisons générales ---------- */
function bindMain() {
  $$('.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#fab').addEventListener('click', () => openEditor(null, S.tab === 'calendar' ? S.calSel : null));
  const v = $('#view');
  // Appui long = sélection ; glisser vers la gauche = suppression
  let press = null, suppressClick = false;
  const inCards = () => S.tab === 'list' || S.tab === 'calendar';
  const noClick = () => { suppressClick = true; setTimeout(() => { suppressClick = false; }, 450); };
  const resetCard = c => { c.style.transition = 'transform .18s ease'; c.style.transform = ''; setTimeout(() => { c.style.transition = ''; c.classList.remove('swiping'); }, 200); };
  v.addEventListener('touchstart', e => {
    if (!inCards() || e.touches.length !== 1) { press = null; return; }
    const card = e.target.closest('.alarm');
    if (!card || e.target.closest('[data-stop]')) { press = null; return; }
    const t = e.touches[0];
    const id = card.dataset.open || card.dataset.pick;
    press = { card, id, x: t.clientX, y: t.clientY, dx: 0, swiping: false, long: false };
    press.timer = setTimeout(() => {
      if (!press || press.swiping) return;
      press.long = true;
      if (navigator.vibrate) navigator.vibrate(30);
      startSelectionWith(id);
    }, 550);
  }, { passive: true });
  v.addEventListener('touchmove', e => {
    if (!press) return;
    const t = e.touches[0];
    const dx = t.clientX - press.x, dy = t.clientY - press.y;
    if (!press.swiping) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(press.timer);
      if (S.selMode || press.long) return;
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { press = null; return; }
      if (dx > -14) return;
      press.swiping = true;
      press.card.classList.add('swiping');
    }
    press.dx = Math.min(0, dx);
    press.card.style.transform = `translateX(${press.dx}px)`;
  }, { passive: true });
  const endPress = () => {
    if (!press) return;
    clearTimeout(press.timer);
    const p = press; press = null;
    if (p.long) { noClick(); return; }
    if (!p.swiping) return;
    noClick();
    const w = p.card.offsetWidth;
    if (p.dx < -Math.min(130, w * 0.35)) {
      p.card.style.transition = 'transform .18s ease, opacity .18s ease';
      p.card.style.transform = `translateX(${-w}px)`;
      p.card.style.opacity = '0';
      setTimeout(() => deleteWithUndo(p.id), 180);
    } else resetCard(p.card);
  };
  v.addEventListener('touchend', endPress);
  v.addEventListener('touchcancel', () => { if (press) { clearTimeout(press.timer); if (press.swiping) resetCard(press.card); press = null; } });
  v.addEventListener('contextmenu', e => {
    const card = e.target.closest('.alarm');
    if (!card || !inCards()) return;
    e.preventDefault();
    if (!S.selMode || !S.sel.has(card.dataset.open || card.dataset.pick)) startSelectionWith(card.dataset.open || card.dataset.pick);
    noClick();
  });

  v.addEventListener('input', e => {
    if (e.target.id !== 'listSearch') return;
    S.search = e.target.value;
    renderListBody();
  });
  v.addEventListener('click', async e => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('[data-gobackup]')) { go('settings'); setTimeout(() => { const el = $('[data-set="backup"]'); if (el) el.scrollIntoView({ block: 'center' }); }, 300); return; }
    const sb = e.target.closest('[data-sel]');
    if (sb && (S.tab === 'list' || S.tab === 'calendar')) {
      const act = sb.dataset.sel;
      if (act === 'toggle') { S.selMode = !S.selMode; if (!S.selMode) S.sel.clear(); }
      if (act === 'all') S.visibleIds.forEach(id => S.sel.add(id));
      if (act === 'none') S.sel.clear();
      refreshView();
      return;
    }
    const pk = e.target.closest('[data-pick]');
    if (pk && S.selMode) {
      const id = pk.dataset.pick;
      S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
      pk.classList.toggle('picked', S.sel.has(id));
      $('.selbox', pk).textContent = S.sel.has(id) ? '✓' : '';
      updateSelBar();
      return;
    }
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      e.stopPropagation();
      const a = S.alarms.find(x => x.id === tg.dataset.toggle);
      if (a) {
        a.enabled = tg.checked; await saveAlarms();
        const n = a.enabled ? nextOcc(a) : null;
        toast(a.enabled ? (n ? `Activée · ${relDay(n)} ${fmtTime(n)}` : 'Activée (aucune date à venir)') : 'Désactivée');
        refreshView();
      }
      return;
    }
    if (e.target.closest('[data-stop]')) return;
    const f = e.target.closest('[data-filter]');
    if (f) { S.listFilter = f.dataset.filter; renderListBody(); return; }
    if (S.tab === 'calendar') {
      const c = e.target.closest('[data-cal]');
      if (c) { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + Number(c.dataset.cal), 1); render(); return; }
      const d = e.target.closest('[data-day]');
      if (d) { S.calSel = d.dataset.day; const dd = parseYmd(S.calSel); if (dd.getMonth() !== S.calMonth.getMonth()) S.calMonth = new Date(dd.getFullYear(), dd.getMonth(), 1); keepScroll(render); return; }
    }
    const o = e.target.closest('[data-open]');
    if (o && (S.tab === 'list' || S.tab === 'calendar')) openDetail(o.dataset.open);
  });
}

async function handleOpenAlarm(id) {
  if (!id) return;
  openDetail(id);
}

async function start() {
  await loadAll();
  bindMain(); bindSheet(); bindImport(); bindSettings();
  if (!isNative) {
    const b = $('#modeBadge'); b.hidden = false; b.textContent = 'navigateur';
  }
  go('list');
  if (await syncEvents()) render();
  await syncNative();
  if (Native) {
    try {
      const st = await Native.status();
      if (!st.notifications) await Native.requestNotifications();
    } catch (e) { /* ignore */ }
    try { const r = await Native.getLaunchAlarm(); if (r && r.alarmId) handleOpenAlarm(r.alarmId); } catch (e) { /* ignore */ }
    Native.addListener('openAlarm', r => handleOpenAlarm(r.alarmId));
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      await syncEvents();
      await syncNative();
      if (S.tab !== 'import' && $('#sheet').hidden) refreshView();
    });
  } else {
    setInterval(webTick, 15000);
    webTick();
  }
  // Retour Android : ferme la feuille ouverte au lieu de quitter
  window.addEventListener('popstate', () => { if (!$('#sheet').hidden) closeSheet(true); });
}

start();
