const KEY = 'jarvis-os-v1';
const listeners = new Set();
let saveTimer = null;

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isoDate(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function timeGreeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function makeSeed() {
  const now = new Date();
  const today = isoDate(now);
  const tomorrow = isoDate(addDays(now, 1));
  const inTwo = isoDate(addDays(now, 2));
  return {
    version: 1,
    user: { name: 'Commander', callsign: 'C-01' },
    settings: { accent: 'cyan', voice: true, sfx: true, wake: false, reduceMotion: false },
    prime: false,
    weatherCity: 'New Delhi',
    focusPreset: 25,
    chat: [
      {
        id: uid('msg'),
        role: 'jarvis',
        text: `${timeGreeting()}, Commander. Neural core online, all systems nominal.\n\nI can manage your agenda, run focus sessions, set timers, take notes, and brief you on the day. Tap the microphone or type below — I am listening.`,
        time: Date.now()
      }
    ],
    tasks: [
      { id: uid('task'), title: 'Calibrate neural uplink', priority: 'high', status: 'active', created: Date.now() - 7200000 },
      { id: uid('task'), title: 'Review quarterly defence protocol', priority: 'medium', status: 'backlog', created: Date.now() - 5400000 },
      { id: uid('task'), title: 'Deploy holographic dashboard', priority: 'high', status: 'active', created: Date.now() - 3600000 },
      { id: uid('task'), title: 'Archive mission logs', priority: 'low', status: 'done', created: Date.now() - 86400000 }
    ],
    notes: [
      { id: uid('note'), title: 'Project Nightfall', body: 'Stealth architecture review on Friday. Prioritise low-latency comms, offline resilience, and the new encryption layer.', updated: Date.now() - 3600000 },
      { id: uid('note'), title: 'Ideas', body: 'Voice-first briefings at 07:00. Ambient focus engine with adaptive soundscapes. Personal telemetry dashboard.', updated: Date.now() - 86400000 }
    ],
    events: [
      { id: uid('evt'), title: 'Systems review', date: today, time: '16:30', tag: 'mission' },
      { id: uid('evt'), title: 'Briefing with command', date: tomorrow, time: '09:00', tag: 'meeting' },
      { id: uid('evt'), title: 'Secure comms window', date: inTwo, time: '14:00', tag: 'personal' }
    ],
    notifications: [
      { id: uid('notif'), title: 'Neural core online', body: 'All subsystems are operating within normal parameters.', kind: 'ok', time: Date.now(), read: false }
    ],
    stats: { commands: 0, focusMinutes: 0, sessions: 0, tasksDone: 0, history: {} },
    timers: []
  };
}

function merge(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  const out = Array.isArray(base) ? saved : { ...base };
  if (Array.isArray(base)) return Array.isArray(saved) ? saved : base;
  for (const key of Object.keys(saved)) {
    const value = saved[key];
    if (Array.isArray(value)) out[key] = value;
    else if (value && typeof value === 'object') out[key] = merge(base[key] || {}, value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

let state = load();

function load() {
  const seed = makeSeed();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw);
    const merged = merge(seed, parsed);
    merged.timers = (merged.timers || []).filter((t) => t && t.endAt > Date.now());
    merged.settings = { ...seed.settings, ...(merged.settings || {}) };
    merged.stats = { ...seed.stats, ...(merged.stats || {}) };
    merged.stats.history = merged.stats.history || {};
    return merged;
  } catch {
    return seed;
  }
}

export function getState() {
  return state;
}

export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, 180);
}

export function emit() {
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}

export function update(mutator) {
  mutator(state);
  persist();
  emit();
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetState() {
  try { localStorage.removeItem(KEY); } catch {}
  state = makeSeed();
  persist();
  emit();
  return state;
}

export function exportState() {
  return JSON.stringify(state, null, 2);
}

export function bumpCommand() {
  const s = state.stats;
  s.commands = (s.commands || 0) + 1;
  const key = isoDate();
  s.history[key] = (s.history[key] || 0) + 1;
  persist();
}

export function pushNotification(title, body, kind = 'info') {
  const notif = { id: uid('notif'), title, body, kind, time: Date.now(), read: false };
  state.notifications.unshift(notif);
  state.notifications = state.notifications.slice(0, 40);
  persist();
  emit();
  return notif;
}

export function addTask(title, priority = 'medium') {
  const task = { id: uid('task'), title: title.trim(), priority, status: 'backlog', created: Date.now() };
  state.tasks.unshift(task);
  persist();
  emit();
  return task;
}

export function addNote(title, body) {
  const note = { id: uid('note'), title: title.trim(), body: body.trim(), updated: Date.now() };
  state.notes.unshift(note);
  persist();
  emit();
  return note;
}

export function addEvent(event) {
  const evt = { id: uid('evt'), ...event };
  state.events.push(evt);
  state.events.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  persist();
  emit();
  return evt;
}

export function markNotificationsRead() {
  state.notifications.forEach((n) => { n.read = true; });
  persist();
  emit();
}

export function clearNotifications() {
  state.notifications = [];
  persist();
  emit();
}

window.addEventListener('beforeunload', () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
});
