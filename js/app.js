import {
  getState, update, subscribe, uid, isoDate, addDays, timeGreeting,
  bumpCommand, persist, emit, pushNotification, addTask as storeAddTask,
  addNote as storeAddNote, addEvent as storeAddEvent,
  markNotificationsRead, clearNotifications, resetState, exportState
} from './store.js';
import { respond } from './assistant.js';
import { AudioEngine, VoiceInput, TRACKS } from './audio.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = getState();

const audio = new AudioEngine();
window.__jarvisAudio = audio;
const micInput = new VoiceInput();
const wakeInput = new VoiceInput();
let orb = null;

const VIEW_LABELS = {
  dashboard: 'Command Center',
  assistant: 'Assistant',
  focus: 'Deep Focus',
  workspace: 'Workspace',
  timeline: 'Timeline'
};

const MODAL_IDS = ['paletteModal', 'settingsModal', 'primeModal', 'noteModal', 'eventModal'];
const WEATHER_CODES = {
  0: ['Clear sky', 'sun'],
  1: ['Mostly clear', 'sun'],
  2: ['Partly cloudy', 'cloud'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'],
  53: ['Drizzle', 'rain'],
  55: ['Heavy drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'],
  57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'],
  96: ['Thunderstorm', 'storm'],
  99: ['Severe thunderstorm', 'storm']
};

const focus = {
  duration: (state.focusPreset || 25) * 60,
  remaining: (state.focusPreset || 25) * 60,
  running: false,
  endAt: 0
};

const session = {
  started: Date.now(),
  lastMinute: '',
  battery: { level: null, charging: false }
};

const weatherCache = { data: null, at: 0, city: null };
const feedCache = { items: [], at: 0 };
let activeView = 'dashboard';
let taskFilter = 'all';
let selectedDate = null;
let calView = { year: new Date().getFullYear(), month: new Date().getMonth() };
let editingNoteId = null;
let typingEl = null;
let currentOrb = 'idle';
let selectedPaletteIndex = 0;
let paletteFlat = [];
let booted = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatText(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function initials(name) {
  const value = String(name || '').trim();
  if (!value) return 'CM';
  const parts = value.split(/\s+/);
  return parts.map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function relativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function dateFromEvent(event) {
  return new Date(`${event.date}T${event.time || '00:00'}:00`);
}

function formatEventTime(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDayLabel(iso) {
  const date = new Date(`${iso}T12:00:00`);
  const today = isoDate();
  if (iso === today) return 'Today';
  if (iso === isoDate(addDays(new Date(), 1))) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimerLabel(seconds) {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h${mins ? ` ${mins}m` : ''}`;
  }
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds} sec`;
}

function scrollChat() {
  const log = $('#chatLog');
  if (log) log.scrollTop = log.scrollHeight;
}

function accentRgb() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '53, 230, 255';
}

function toast(title, body = '', kind = 'info') {
  const icons = { ok: 'check', warn: 'bell', timer: 'clock', info: 'spark' };
  const container = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon"><svg><use href="#i-${icons[kind] || 'spark'}"></use></svg></span><div class="toast-body"><strong>${formatText(title)}</strong>${body ? `<p>${formatText(body)}</p>` : ''}</div>`;
  container.appendChild(el);
  const remove = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 320);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, 4600);
}

function setOrbState(next) {
  currentOrb = next;
  orb?.setState(next);
  if (next === 'listening') {
    setChatStatus('Listening');
    setVoiceUi('listening');
  } else if (next === 'working') {
    setChatStatus('Processing');
    setVoiceUi('thinking');
  } else if (next === 'speaking') {
    setChatStatus('Speaking');
    setVoiceUi('speaking');
  } else {
    setChatStatus('Neural link active');
    setVoiceUi('standby');
  }
}

function setChatStatus(text) {
  const el = $('#chatStatus');
  if (el) el.innerHTML = `<span class="pulse-dot"></span> ${escapeHtml(text)}`;
}

function setVoiceUi(mode) {
  const tag = $('#voiceStateTag');
  const copy = $('#voiceCopy');
  if (!tag || !copy) return;
  const map = {
    standby: ['Standby', 'Tap the microphone and speak naturally. Jarvis understands intent, not just keywords.'],
    listening: ['Listening', 'I am listening. Speak naturally — I will capture your command.'],
    thinking: ['Processing', 'Hold that thought. I am assembling the response.'],
    speaking: ['Speaking', 'Voice link active. Jarvis is responding.'],
    unsupported: ['Unsupported', 'This browser does not expose speech recognition. Try Chrome or Edge for voice commands.']
  };
  const [label, text] = map[mode] || map.standby;
  tag.textContent = label;
  copy.textContent = text;
}

function syncIdentity() {
  const name = state.user.name || 'Commander';
  const short = initials(name);
  const heroName = $('#heroName');
  if (heroName) heroName.textContent = name;
  $('#profileNameLabel').textContent = name;
  $('#avatarInitials').textContent = short;
  $('#topAvatar').textContent = short;
  const input = $('#profileName');
  if (input && document.activeElement !== input) input.value = name;
}

function syncSettingToggles() {
  $$('[data-setting]').forEach((input) => {
    input.checked = !!state.settings[input.dataset.setting];
  });
  const wake = $('#wakeSwitch');
  const voice = $('#voiceSwitch');
  if (wake) wake.checked = !!state.settings.wake;
  if (voice) voice.checked = !!state.settings.voice;
  $('#voiceToggle')?.classList.toggle('is-active', !!state.settings.voice);
  $('#chatVoice')?.classList.toggle('is-active', !!state.settings.voice);
  if (!micInput.supported) setVoiceUi('unsupported');
}

function applyAccent(name, { save = true } = {}) {
  document.documentElement.dataset.accent = name;
  state.settings.accent = name;
  $$('.accent-swatch').forEach((swatch) => {
    swatch.classList.toggle('is-active', swatch.dataset.accent === name);
  });
  if (save) persist();
}

function applyPrime() {
  const app = $('#app');
  app.classList.toggle('is-prime', state.prime);
  document.body.classList.toggle('is-prime', state.prime);
  const badge = $('#primeNavBadge');
  badge.textContent = state.prime ? 'ON' : 'PRO';
  const cardText = $('#primeCardText');
  const cardBtn = $('#primeCardBtn');
  if (state.prime) {
    cardText.textContent = 'Prime protocols active. Neural insights, premium themes, and cinematic ambience unlocked.';
    cardBtn.innerHTML = 'Manage membership <svg><use href="#i-arrow-right"></use></svg>';
  } else {
    cardText.textContent = 'Neural insights, cinematic ambience, and exclusive interface themes.';
    cardBtn.innerHTML = 'Explore Prime <svg><use href="#i-arrow-right"></use></svg>';
  }
  $('#insightCard').classList.toggle('is-locked', !state.prime);
  $('#settingsPrimeState').textContent = state.prime ? 'Jarvis Prime' : 'Jarvis Core';
  $('#settingsPrimeHint').textContent = state.prime ? 'All premium protocols active' : 'Free tier · upgrade for deeper insight';
  const activate = $('#activatePrime');
  if (state.prime) {
    activate.innerHTML = '<svg><use href="#i-check"></use></svg> Prime active';
    activate.disabled = true;
    $('#primeFinePrint').textContent = 'Your demo membership is active. All premium protocols are unlocked.';
  } else {
    activate.innerHTML = '<svg><use href="#i-crown"></use></svg> Start free trial';
    activate.disabled = false;
    $('#primeFinePrint').textContent = 'Demo membership — activation is instant and no payment is collected.';
  }
  $$('.accent-swatch[data-premium]').forEach((swatch) => {
    swatch.classList.toggle('is-locked', !state.prime);
  });
  renderMusicState();
}

function syncSettingsUI() {
  $('#profileName').value = state.user.name || '';
  $$('#accentGrid .accent-swatch').forEach((swatch) => {
    swatch.classList.toggle('is-active', swatch.dataset.accent === state.settings.accent);
  });
  syncSettingToggles();
  document.body.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  applyPrime();
}

function renderDashboardAgenda() {
  const now = Date.now();
  const upcoming = state.events
    .filter((event) => dateFromEvent(event).getTime() >= now - 1800000)
    .sort((a, b) => dateFromEvent(a) - dateFromEvent(b))
    .slice(0, 3);
  const container = $('#dashAgenda');
  if (!upcoming.length) {
    container.innerHTML = '<div class="agenda-empty"><svg><use href="#i-calendar"></use></svg><span>No events scheduled. A clear horizon.</span></div>';
  } else {
    container.innerHTML = upcoming.map((event) => {
      const date = new Date(`${event.date}T12:00:00`);
      return `<div class="agenda-item">
        <div class="agenda-date"><strong>${date.getDate()}</strong><span>${date.toLocaleDateString([], { month: 'short' })}</span></div>
        <div class="agenda-line"></div>
        <div class="agenda-info"><strong>${escapeHtml(event.title)}</strong><small>${formatEventTime(event.time)} · ${escapeHtml(event.tag)}</small></div>
        <div class="agenda-time">${event.date === isoDate() ? 'TODAY' : formatDayLabel(event.date).split(',')[0].toUpperCase()}</div>
      </div>`;
    }).join('');
  }
  const name = state.user.name || 'Commander';
  const todayEvents = state.events.filter((event) => event.date === isoDate());
  const openTasks = state.tasks.filter((task) => task.status !== 'done').length;
  const heading = document.querySelector('.hero-card h1');
  if (heading) heading.innerHTML = `${timeGreeting()}, <span id="heroName">${escapeHtml(name)}</span>.`;
  const weather = weatherCache.data;
  const pieces = [];
  if (todayEvents.length) pieces.push(`You have ${todayEvents.length} event${todayEvents.length === 1 ? '' : 's'} on today's timeline`);
  if (openTasks) pieces.push(`${openTasks} open objective${openTasks === 1 ? '' : 's'}`);
  if (weather) pieces.push(`${Math.round(weather.temp)}°C and ${weather.condition.toLowerCase()} in ${weather.city}`);
  $('#heroSub').textContent = pieces.length
    ? `${pieces.join(' · ')}. All systems nominal, ${name}.`
    : `All systems nominal. I have prepared your workspace and synced the latest intelligence, ${name}.`;
}

function renderStats() {
  const stats = state.stats;
  $('#statCommands').textContent = (stats.commands || 0).toLocaleString();
  $('#statFocus').textContent = (stats.focusMinutes || 0).toLocaleString();
  $('#statTasks').textContent = (stats.tasksDone || 0).toLocaleString();
  const history = stats.history || {};
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = addDays(new Date(), -i);
    const key = isoDate(date);
    days.push({ key, label: date.toLocaleDateString([], { weekday: 'short' }), count: history[key] || 0 });
  }
  const max = Math.max(1, ...days.map((day) => day.count));
  $('#insightSpark').innerHTML = days.map((day, index) => `<i class="${index === days.length - 1 ? 'today' : ''}" style="height:${Math.max(4, Math.round((day.count / max) * 100))}%" title="${day.label}: ${day.count} commands"></i>`).join('');
  const peak = days.reduce((best, day) => (day.count > best.count ? day : best), days[0]);
  $('#insightCopy').textContent = stats.commands
    ? `Peak signal on ${peak.label} with ${peak.count} command${peak.count === 1 ? '' : 's'}. Your weekly rhythm is taking shape.`
    : 'Your weekly rhythm will appear here as you use Jarvis.';
}

function renderTasks() {
  const counts = {
    all: state.tasks.length,
    backlog: state.tasks.filter((task) => task.status === 'backlog').length,
    active: state.tasks.filter((task) => task.status === 'active').length,
    done: state.tasks.filter((task) => task.status === 'done').length
  };
  $('#countAll').textContent = counts.all;
  $('#countBacklog').textContent = counts.backlog;
  $('#countActive').textContent = counts.active;
  $('#countDone').textContent = counts.done;
  $$('#taskFilters button').forEach((button) => button.classList.toggle('is-active', button.dataset.taskFilter === taskFilter));
  const tasks = taskFilter === 'all' ? state.tasks : state.tasks.filter((task) => task.status === taskFilter);
  const list = $('#taskList');
  if (!tasks.length) {
    list.innerHTML = '<div class="list-empty">No objectives in this lane. Add one above or ask Jarvis.</div>';
    return;
  }
  list.innerHTML = tasks.map((task) => `
    <div class="task-item ${task.status === 'done' ? 'is-done' : ''}" data-id="${task.id}">
      <button type="button" class="task-check" data-action="toggle" aria-label="Toggle task"><svg><use href="#i-check"></use></svg></button>
      <div class="task-info">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="task-meta"><span class="task-priority ${task.priority}">${task.priority}</span><span>${task.status}</span></span>
      </div>
      <button type="button" class="task-status" data-action="cycle">${task.status === 'done' ? 'done' : task.status}</button>
      <button type="button" class="task-delete" data-action="delete" aria-label="Delete task"><svg><use href="#i-trash"></use></svg></button>
    </div>`).join('');
}

function renderNotes() {
  const grid = $('#notesGrid');
  const cards = state.notes.map((note) => `
    <div class="note" data-id="${note.id}" role="button" tabindex="0">
      <strong>${escapeHtml(note.title)}</strong>
      <p>${escapeHtml(note.body)}</p>
      <time>${relativeTime(note.updated)}</time>
      <button type="button" class="note-del" data-action="delete-note" aria-label="Delete note"><svg><use href="#i-trash"></use></svg></button>
    </div>`).join('');
  grid.innerHTML = `${cards}<button type="button" class="note-add" id="noteAddInline"><svg><use href="#i-plus"></use></svg><span>New memory</span></button>`;
}

function renderNotifications() {
  const list = $('#notifList');
  const unread = state.notifications.filter((notification) => !notification.read).length;
  const badge = $('#notifBadge');
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  if (!state.notifications.length) {
    list.innerHTML = '<div class="list-empty">No notifications. The signal is quiet.</div>';
    return;
  }
  list.innerHTML = state.notifications.map((notification) => {
    const icon = notification.kind === 'ok' ? 'check' : notification.kind === 'warn' ? 'bell' : 'spark';
    const cls = notification.kind === 'ok' ? 'ok' : notification.kind === 'warn' ? 'warn' : '';
    return `<div class="notif-item ${notification.read ? '' : 'unread'}">
      <span class="notif-icon ${cls}"><svg><use href="#i-${icon}"></use></svg></span>
      <div class="notif-body"><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.body)}</p><time>${relativeTime(notification.time)}</time></div>
    </div>`;
  }).join('');
}

function focusRemaining() {
  if (focus.running) return Math.max(0, focus.endAt - Date.now()) / 1000;
  return focus.remaining;
}

function focusProgress() {
  return 1 - Math.min(1, Math.max(0, focusRemaining() / focus.duration));
}

function focusStreak() {
  const history = state.stats.focusHistory || {};
  let cursor = new Date();
  if (!history[isoDate(cursor)]) cursor = addDays(cursor, -1);
  let streak = 0;
  while (history[isoDate(cursor)]) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function renderFocus() {
  const remaining = focusRemaining();
  const minutes = Math.floor(remaining / 60);
  const seconds = Math.ceil(remaining % 60);
  const clock = `${pad(minutes)}:${pad(seconds === 60 ? 0 : seconds)}`;
  const circumference = 2 * Math.PI * 112;
  const miniCircumference = 2 * Math.PI * 50;
  const progress = focusProgress();
  $('#focusCircle').style.strokeDasharray = String(circumference);
  $('#focusCircle').style.strokeDashoffset = String(circumference * progress);
  $('#dashFocusCircle').style.strokeDasharray = String(miniCircumference);
  $('#dashFocusCircle').style.strokeDashoffset = String(miniCircumference * progress);
  $('#focusClock').textContent = clock;
  $('#dashFocusTime').textContent = clock;
  const phase = focus.running ? 'IN SESSION' : progress > 0 ? 'PAUSED' : 'FOCUS SESSION';
  $('#focusLabel').textContent = phase;
  $('#focusStateTag').textContent = focus.running ? 'Active' : progress > 0 ? 'Paused' : 'Ready';
  $('#focusMainTag').textContent = focus.running ? 'In session' : progress > 0 ? 'Paused' : 'Ready';
  $('#focusStateTag').className = `tag ${focus.running ? 'tag-live' : ''}`;
  $('#focusMainTag').className = `tag ${focus.running ? 'tag-live' : ''}`;
  $('#focusToggle').innerHTML = focus.running
    ? '<svg><use href="#i-pause"></use></svg> Pause session'
    : `<svg><use href="#i-play"></use></svg> ${progress > 0 ? 'Resume session' : 'Begin session'}`;
  $('#dashFocusBtn').textContent = focus.running ? 'Pause focus' : progress > 0 ? 'Resume focus' : 'Begin focus';
  $$('#presetRow button').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.preset) * 60 === focus.duration);
  });
  $('#focusMiniCopy').textContent = focus.running
    ? 'Guardrails up. Non-critical alerts are muted while you work.'
    : progress > 0
      ? 'Session paused. Resume when you are ready — momentum is preserved.'
      : 'One session is all it takes to shift momentum.';
  $('#dashFocusSessions').textContent = state.stats.sessions || 0;
  $('#dashFocusMinutes').textContent = state.stats.focusMinutes || 0;
  $('#focusSessions').textContent = state.stats.sessions || 0;
  $('#focusMinutes').textContent = state.stats.focusMinutes || 0;
  $('#focusStreak').textContent = focusStreak();
}

function startFocus(minutes = state.focusPreset || 25) {
  focus.duration = Math.max(60, Math.round(minutes * 60));
  focus.remaining = focus.duration;
  focus.running = true;
  focus.endAt = Date.now() + focus.duration * 1000;
  update((s) => { s.focusPreset = Math.round(focus.duration / 60); });
  renderFocus();
  audio.sfx('success');
  toast('Focus protocol engaged', `${Math.round(focus.duration / 60)} minute session started.`, 'ok');
}

function pauseFocus() {
  if (!focus.running) return;
  focus.remaining = Math.max(0, (focus.endAt - Date.now()) / 1000);
  focus.running = false;
  renderFocus();
  audio.sfx('click');
}

function toggleFocus() {
  if (focus.running) {
    pauseFocus();
    return;
  }
  if (focus.remaining >= focus.duration) {
    startFocus(Math.round((focus.duration || 1500) / 60));
    return;
  }
  focus.running = true;
  focus.endAt = Date.now() + focus.remaining * 1000;
  renderFocus();
  audio.sfx('success');
  toast('Focus resumed', 'Non-critical alerts are muted.', 'ok');
}

function stopFocus() {
  if (focus.running) focus.remaining = Math.max(0, (focus.endAt - Date.now()) / 1000);
  focus.running = false;
  renderFocus();
}

function resetFocus() {
  focus.running = false;
  focus.remaining = focus.duration;
  renderFocus();
  audio.sfx('click');
}

function setFocusPreset(minutes) {
  focus.running = false;
  focus.duration = minutes * 60;
  focus.remaining = focus.duration;
  update((s) => { s.focusPreset = minutes; });
  renderFocus();
  audio.sfx('click');
}

function completeFocus() {
  const minutes = Math.round(focus.duration / 60);
  focus.running = false;
  focus.remaining = focus.duration;
  update((s) => {
    s.stats.sessions = (s.stats.sessions || 0) + 1;
    s.stats.focusMinutes = (s.stats.focusMinutes || 0) + minutes;
    s.stats.focusHistory = s.stats.focusHistory || {};
    s.stats.focusHistory[isoDate()] = (s.stats.focusHistory[isoDate()] || 0) + minutes;
  });
  pushNotification('Focus session complete', `${minutes} minutes of deep work logged. Take a short recovery break.`, 'ok');
  toast('Session complete', `${minutes} minutes of deep work logged. Well done, Commander.`, 'ok');
  audio.sfx('timer');
  if (state.settings.voice) audio.speak(`Focus session complete. ${minutes} minutes of deep work logged. Well done, Commander.`);
  renderFocus();
}

function renderTimers() {
  const pill = $('#timerPill');
  const now = Date.now();
  const active = state.timers.filter((timer) => timer.endAt > now).sort((a, b) => a.endAt - b.endAt);
  if (!active.length) {
    pill.hidden = true;
  } else {
    pill.hidden = false;
    const remaining = Math.max(0, Math.ceil((active[0].endAt - now) / 1000));
    $('#timerPillText').textContent = `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}`;
    pill.title = active[0].label;
  }
}

function tickTimers() {
  const now = Date.now();
  const expired = state.timers.filter((timer) => timer.endAt <= now);
  if (expired.length) {
    state.timers = state.timers.filter((timer) => timer.endAt > now);
    persist();
    for (const timer of expired) {
      pushNotification('Timer complete', timer.label || 'Your timer has finished.', 'warn');
      toast('Timer complete', timer.label || 'Your timer has finished.', 'timer');
      audio.sfx('timer');
      if (state.settings.voice) audio.speak(timer.label || 'Your timer is complete.');
    }
  }
  renderTimers();
}

function startTimer(seconds, label = 'Timer') {
  state.timers.push({ id: uid('timer'), label, duration: seconds, endAt: Date.now() + seconds * 1000 });
  persist();
  emit();
  renderTimers();
  toast('Timer armed', `${label} · ${formatTimerLabel(seconds)}`, 'timer');
  audio.sfx('toggle');
}

function weatherIcon(code, isDay = true) {
  if (code === 0 || code === 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return isDay ? 'cloud' : 'moon';
  return (WEATHER_CODES[code] || ['Cloudy', 'cloud'])[1];
}

function weatherLabel(code) {
  return (WEATHER_CODES[code] || ['Cloudy', 'cloud'])[0];
}

function renderWeather(data) {
  $('#weatherTemp').innerHTML = `${Math.round(data.temp)}<span>°</span>`;
  $('#weatherCond').textContent = data.condition;
  $('#weatherCity').innerHTML = `<svg><use href="#i-pin"></use></svg> ${escapeHtml(data.city)}`;
  $('#weatherHumidity').textContent = `${data.humidity}%`;
  $('#weatherWind').textContent = `${Math.round(data.wind)} km/h`;
  $('#weatherFeels').textContent = `${Math.round(data.feels)}°`;
  $('#weatherIcon').innerHTML = `<svg><use href="#i-${weatherIcon(data.code, data.isDay)}"></use></svg>`;
  const days = (data.days || []).slice(0, 3);
  $('#weatherDays').innerHTML = days.map((day) => {
    const date = new Date(`${day.date}T12:00:00`);
    return `<div class="weather-day">
      <span>${date.toLocaleDateString([], { weekday: 'short' })}</span>
      <svg><use href="#i-${weatherIcon(day.code, true)}"></use></svg>
      <strong>${Math.round(day.max)}° <i>${Math.round(day.min)}°</i></strong>
    </div>`;
  }).join('');
}

function renderWeatherError() {
  $('#weatherTemp').innerHTML = '--<span>°</span>';
  $('#weatherCond').textContent = 'Weather uplink unavailable';
  $('#weatherCity').innerHTML = '<svg><use href="#i-pin"></use></svg> Offline';
  $('#weatherHumidity').textContent = '—';
  $('#weatherWind').textContent = '—';
  $('#weatherFeels').textContent = '—';
  $('#weatherIcon').innerHTML = '<svg><use href="#i-cloud"></use></svg>';
  $('#weatherDays').innerHTML = '<div class="feed-empty" style="grid-column:1/-1;padding:8px 0">No atmospheric telemetry.</div>';
}

async function fetchJson(url, ms = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWeather(city) {
  const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  const location = geo.results?.[0];
  if (!location) throw new Error('location not found');
  const forecast = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`);
  const current = forecast.current;
  if (!current) throw new Error('no current weather');
  const days = (forecast.daily?.time || []).map((date, index) => ({
    date,
    code: forecast.daily.weather_code[index],
    max: forecast.daily.temperature_2m_max[index],
    min: forecast.daily.temperature_2m_min[index]
  }));
  return {
    city: [location.name, location.country_code].filter(Boolean).join(', '),
    cityInput: location.name,
    temp: current.temperature_2m,
    feels: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    wind: current.wind_speed_10m,
    code: current.weather_code,
    condition: weatherLabel(current.weather_code),
    isDay: current.is_day === 1,
    min: days[0]?.min ?? current.temperature_2m,
    max: days[0]?.max ?? current.temperature_2m,
    days: days.slice(1)
  };
}

async function loadWeather(city = state.weatherCity, { force = false, silent = false } = {}) {
  if (!city) city = 'New Delhi';
  const fresh = weatherCache.at && Date.now() - weatherCache.at < 600000 && weatherCache.city === city;
  if (!force && fresh) {
    renderWeather(weatherCache.data);
    return weatherCache.data;
  }
  if (!silent) {
    $('#weatherCond').textContent = 'Syncing atmosphere…';
    $('#weatherRefresh').classList.add('spin');
  }
  try {
    const data = await fetchWeather(city);
    weatherCache.data = data;
    weatherCache.at = Date.now();
    weatherCache.city = city;
    state.weatherCity = data.cityInput || city;
    persist();
    renderWeather(data);
    renderDashboardAgenda();
    return data;
  } catch (error) {
    if (!silent) renderWeatherError();
    throw error;
  } finally {
    $('#weatherRefresh').classList.remove('spin');
  }
}

function renderFeed() {
  const list = $('#feedList');
  if (!feedCache.items.length) {
    list.innerHTML = '<div class="feed-empty">Signal feed unavailable.<br><button type="button" class="mini-btn" id="feedRetry">Retry uplink</button></div>';
    return;
  }
  list.innerHTML = feedCache.items.map((item, index) => {
    const age = item.time ? relativeTime(item.time * 1000) : 'recent';
    return `<a class="feed-item" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer">
      <span class="feed-rank">${pad(index + 1)}</span>
      <span class="feed-content"><strong>${escapeHtml(item.title)}</strong><small><i>${item.score} pts</i><span>${item.comments} comments</span><span>${age}</span></small></span>
      <svg><use href="#i-external"></use></svg>
    </a>`;
  }).join('');
}

async function loadFeed(force = false) {
  if (!force && feedCache.items.length && Date.now() - feedCache.at < 600000) {
    renderFeed();
    return feedCache.items;
  }
  $('#feedRefresh').classList.add('spin');
  try {
    const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
    const chosen = ids.slice(0, 6);
    const items = await Promise.all(chosen.map((id) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
    feedCache.items = items.filter(Boolean).map((item) => ({
      title: item.title,
      score: item.score || 0,
      comments: item.descendants || 0,
      time: item.time,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`
    }));
    feedCache.at = Date.now();
    renderFeed();
    return feedCache.items;
  } catch {
    renderFeed();
    throw new Error('feed offline');
  } finally {
    $('#feedRefresh').classList.remove('spin');
  }
}

function renderCalendar() {
  const first = new Date(calView.year, calView.month, 1);
  $('#calendarMonth').textContent = first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const start = addDays(first, -first.getDay());
  const today = isoDate();
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i);
    const iso = isoDate(date);
    const inMonth = date.getMonth() === calView.month;
    const hasEvents = state.events.some((event) => event.date === iso);
    const classes = ['cal-day'];
    if (!inMonth) classes.push('is-out');
    if (iso === today) classes.push('is-today');
    if (iso === selectedDate) classes.push('is-selected');
    cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${iso}">${date.getDate()}${hasEvents ? '<span class="dot"></span>' : ''}</button>`);
  }
  $('#calendarGrid').innerHTML = cells.join('');
  const title = $('#timelineTitle');
  if (title) title.textContent = selectedDate ? formatDayLabel(selectedDate) : 'Upcoming';
}

function renderTimeline() {
  let events = state.events.slice().sort((a, b) => dateFromEvent(a) - dateFromEvent(b));
  if (selectedDate) {
    events = events.filter((event) => event.date === selectedDate);
    $('#timelineTitle').textContent = formatDayLabel(selectedDate);
  } else {
    events = events.filter((event) => dateFromEvent(event).getTime() >= Date.now() - 3600000);
    $('#timelineTitle').textContent = 'Upcoming';
  }
  const list = $('#timelineList');
  if (!events.length) {
    list.innerHTML = '<div class="agenda-empty"><svg><use href="#i-calendar"></use></svg><span>No events here. The timeline is clear.</span></div>';
    return;
  }
  list.innerHTML = events.map((event) => {
    const date = new Date(`${event.date}T12:00:00`);
    return `<div class="event-item" data-id="${event.id}">
      <div class="event-date"><strong>${date.getDate()}</strong><span>${date.toLocaleDateString([], { month: 'short' })}</span></div>
      <div class="event-info"><strong>${escapeHtml(event.title)}</strong><small><span>${formatEventTime(event.time)}</span><span class="event-tag ${escapeHtml(event.tag)}">${escapeHtml(event.tag)}</span><span>${formatDayLabel(event.date)}</span></small></div>
      <button type="button" class="event-del" data-action="delete-event" aria-label="Delete event"><svg><use href="#i-trash"></use></svg></button>
    </div>`;
  }).join('');
}

function renderMusicState() {
  const playing = audio.playing;
  const track = TRACKS[audio.trackId] || TRACKS.focus;
  $('#musicStateTag').textContent = playing ? 'Live' : 'Idle';
  $('#musicStateTag').className = `tag ${playing ? 'tag-live' : ''}`;
  $('#nowPlaying').textContent = track.name;
  $('#nowGenre').textContent = track.genre;
  $('#musicToggle').innerHTML = playing ? '<svg><use href="#i-pause"></use></svg>' : '<svg><use href="#i-play"></use></svg>';
  $('#musicToggle').setAttribute('aria-label', playing ? 'Pause ambience' : 'Play ambience');
  $('#trackList').innerHTML = Object.values(TRACKS).map((item, index) => {
    const active = item.id === audio.trackId;
    const locked = item.premium && !state.prime;
    let indicator = '<span class="track-play"><svg><use href="#i-play"></use></svg></span>';
    if (locked) indicator = '<span class="track-lock"><svg><use href="#i-lock"></use></svg></span>';
    else if (active && playing) indicator = '<span class="track-eq"><i></i><i></i><i></i></span>';
    else if (active) indicator = '<span class="track-play"><svg><use href="#i-play"></use></svg></span>';
    return `<button type="button" class="track ${active ? 'is-active' : ''}" data-track="${item.id}">
      <span class="track-index">${pad(index + 1)}</span>
      <span class="track-meta"><strong>${item.name}</strong><small>${item.genre}${locked ? ' · Prime only' : ''}</small></span>
      ${indicator}
    </button>`;
  }).join('');
}

async function playAmbient(id) {
  const track = TRACKS[id];
  if (!track) return { ok: false, reason: 'missing' };
  if (track.premium && !state.prime) return { ok: false, reason: 'prime' };
  try {
    await audio.play(id);
    renderMusicState();
    return { ok: true, name: track.name };
  } catch {
    toast('Audio engine unavailable', 'Web Audio could not start in this browser.', 'warn');
    return { ok: false, reason: 'audio' };
  }
}

function pauseAmbient() {
  audio.pause();
  renderMusicState();
}

async function nextAmbient() {
  const order = ['focus', 'neon', 'horizon'];
  const nextId = order[(order.indexOf(audio.trackId) + 1) % order.length];
  return playAmbient(nextId);
}

function systemStatus() {
  const stats = state.stats;
  const openTasks = state.tasks.filter((task) => task.status !== 'done').length;
  const nextEvent = state.events.slice().sort((a, b) => dateFromEvent(a) - dateFromEvent(b)).find((event) => dateFromEvent(event).getTime() >= Date.now() - 3600000);
  const battery = session.battery.level === null ? 'Unknown' : `${Math.round(session.battery.level * 100)}%${session.battery.charging ? ' · charging' : ''}`;
  const connection = navigator.connection;
  const network = connection ? `${connection.effectiveType || 'online'}${connection.downlink ? ` · ${connection.downlink} Mbps` : ''}` : (navigator.onLine ? 'Online' : 'Offline');
  return [
    `All primary systems nominal, ${state.user.name}.`,
    '',
    `- Power: ${battery}`,
    `- Uplink: ${network}`,
    `- Threads: ${navigator.hardwareConcurrency || 'Unknown'}`,
    `- Open objectives: ${openTasks}`,
    `- Focus: ${stats.sessions || 0} sessions · ${stats.focusMinutes || 0} minutes`,
    `- Next event: ${nextEvent ? `${nextEvent.title} at ${formatEventTime(nextEvent.time)}` : 'None scheduled'}`
  ].join('\n');
}

async function buildBriefing() {
  const today = isoDate();
  const events = state.events
    .filter((event) => dateFromEvent(event).getTime() >= Date.now() - 1800000)
    .sort((a, b) => dateFromEvent(a) - dateFromEvent(b))
    .slice(0, 4);
  const todayEvents = events.filter((event) => event.date === today);
  const openTasks = state.tasks.filter((task) => task.status !== 'done').slice(0, 4);
  let weatherLine = 'Atmospheric uplink is offline.';
  try {
    const weather = weatherCache.data || await loadWeather(state.weatherCity, { silent: true });
    if (weather) weatherLine = `${weather.city}: ${Math.round(weather.temp)}°C, ${weather.condition.toLowerCase()}. Today ranges ${Math.round(weather.min)}° to ${Math.round(weather.max)}°.`;
  } catch {}
  const lines = [
    `**Daily briefing — ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}**`,
    '',
    weatherLine,
    '',
    '**Agenda**',
    todayEvents.length ? todayEvents.map((event) => `- ${formatEventTime(event.time)} · ${event.title}`).join('\n') : '- No events on today\'s timeline.',
    '',
    '**Open objectives**',
    openTasks.length ? openTasks.map((task) => `- ${task.title} · ${task.priority}`).join('\n') : '- Task matrix is clear.',
    '',
    '**Focus**',
    `${state.stats.sessions || 0} sessions and ${state.stats.focusMinutes || 0} minutes logged.${state.timers.length ? ` ${state.timers.length} timer active.` : ''}`
  ];
  const upcoming = events.find((event) => event.date !== today);
  if (upcoming) lines.push('', `${todayEvents.length ? 'Looking ahead' : 'Next up'}: **${upcoming.title}** ${formatDayLabel(upcoming.date)} at ${formatEventTime(upcoming.time)}.`);
  return lines.join('\n');
}

function completeTaskByQuery(query) {
  const needle = query.toLowerCase().trim();
  const open = state.tasks.filter((task) => task.status !== 'done');
  const match = open.find((task) => task.title.toLowerCase().includes(needle))
    || open.find((task) => needle.split(/\s+/).every((word) => task.title.toLowerCase().includes(word)));
  if (!match) return null;
  update((s) => {
    const task = s.tasks.find((item) => item.id === match.id);
    if (task) task.status = 'done';
    s.stats.tasksDone = (s.stats.tasksDone || 0) + 1;
  });
  return { title: match.title, remaining: state.tasks.filter((task) => task.status !== 'done').length };
}

function setUserName(name) {
  const next = String(name || '').trim().slice(0, 24);
  if (!next) return;
  update((s) => { s.user.name = next; });
  syncIdentity();
}

function clearChat() {
  state.chat = [];
  persist();
  renderChat();
}

function setVoice(value, { silent = false } = {}) {
  state.settings.voice = !!value;
  persist();
  syncSettingToggles();
  if (!value) {
    audio.stopSpeaking();
    if (!silent) toast('Voice muted', 'Text responses remain active.');
  } else if (!silent) {
    toast('Voice enabled', 'Jarvis will speak replies aloud.');
  }
}

function setWake(value) {
  state.settings.wake = !!value;
  persist();
  if (value) {
    if (!wakeInput.supported) {
      state.settings.wake = false;
      persist();
      syncSettingToggles();
      toast('Wake word unavailable', 'Speech recognition is not supported in this browser.', 'warn');
      return;
    }
    wakeInput.start({
      onFinal: (transcript) => {
        const match = transcript.match(/\b(?:hey\s+)?jarvis\b[,:]?\s*([\s\S]*)$/i);
        if (!match) return;
        const command = match[1].trim();
        audio.sfx('listen');
        if (command) {
          sendMessage(command, { viaVoice: true });
        } else {
          navigate('assistant');
          setOrbState('listening');
          setChatStatus('Wake word detected');
          toast('I am listening', 'Speak your command.');
          setTimeout(() => setOrbState('idle'), 2200);
        }
      },
      onError: (error) => {
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          state.settings.wake = false;
          persist();
          syncSettingToggles();
          toast('Microphone blocked', 'Allow microphone access to use the wake word.', 'warn');
        }
      }
    }, { continuous: true });
    toast('Wake word armed', 'Say “Hey Jarvis” followed by a command.');
  } else {
    wakeInput.stop();
    toast('Wake word disabled', 'Jarvis will only listen when asked.');
  }
  syncSettingToggles();
}

function navigate(view) {
  if (view === 'settings') { openModal('settingsModal'); return; }
  if (view === 'prime') { openModal('primeModal'); return; }
  if (!VIEW_LABELS[view]) return;
  activeView = view;
  $$('.view').forEach((section) => section.classList.toggle('is-active', section.id === `view-${view}`));
  $$('.nav-item[data-view]').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
  $('#crumbLabel').textContent = VIEW_LABELS[view];
  $('#views').scrollTop = 0;
  closeSidebar();
  if (view === 'workspace') { renderTasks(); renderNotes(); }
  if (view === 'timeline') { renderCalendar(); renderTimeline(); }
  if (view === 'focus') renderFocus();
  if (view === 'assistant') setTimeout(scrollChat, 60);
}

function openSidebar() {
  $('#sidebar').classList.add('is-open');
  $('#scrim').classList.add('is-open');
}

function closeSidebar() {
  $('#sidebar').classList.remove('is-open');
  if (!$('#notifPanel').classList.contains('is-open')) $('#scrim').classList.remove('is-open');
}

function toggleNotifications(force) {
  const panel = $('#notifPanel');
  const open = force ?? !panel.classList.contains('is-open');
  panel.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  $('#scrim').classList.toggle('is-open', open);
  if (open) {
    markNotificationsRead();
    setTimeout(renderNotifications, 350);
  } else {
    closeSidebar();
  }
}

function closeModal(modal) {
  if (typeof modal === 'string') modal = document.getElementById(modal);
  modal?.classList.remove('is-open');
}

function closeAllModals() {
  MODAL_IDS.forEach((id) => closeModal(id));
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  closeAllModals();
  el.classList.add('is-open');
  if (id === 'settingsModal') syncSettingsUI();
  if (id === 'eventModal') {
    $('#eventDate').value = selectedDate || isoDate();
    $('#eventTime').value = '09:00';
    $('#eventTitle').value = '';
  }
  if (id === 'paletteModal') {
    $('#paletteInput').value = '';
    renderPalette('');
    setTimeout(() => $('#paletteInput').focus(), 60);
  }
  if (id === 'primeModal') applyPrime();
}

function paletteActions() {
  const accent = state.settings.accent;
  return [
    { group: 'Navigate', label: 'Command Center', icon: 'grid', hint: 'Module', run: () => navigate('dashboard') },
    { group: 'Navigate', label: 'Assistant console', icon: 'spark', hint: 'Module', run: () => navigate('assistant') },
    { group: 'Navigate', label: 'Deep Focus', icon: 'target', hint: 'Module', run: () => navigate('focus') },
    { group: 'Navigate', label: 'Workspace', icon: 'layers', hint: 'Module', run: () => navigate('workspace') },
    { group: 'Navigate', label: 'Timeline', icon: 'calendar', hint: 'Module', run: () => navigate('timeline') },
    { group: 'Actions', label: 'Set a 10 minute timer', icon: 'clock', hint: 'Timer', run: () => sendMessage('Set a timer for 10 minutes') },
    { group: 'Actions', label: 'Start a 25 minute focus session', icon: 'target', hint: 'Focus', run: () => sendMessage('Start a 25 minute focus session') },
    { group: 'Actions', label: 'Play Deep Focus ambience', icon: 'wave', hint: 'Audio', run: () => sendMessage('Play deep focus ambience') },
    { group: 'Actions', label: 'Pause ambience', icon: 'pause', hint: 'Audio', run: () => { pauseAmbient(); toast('Ambience paused'); } },
    { group: 'Actions', label: 'Brief me on the day', icon: 'spark', hint: 'Briefing', run: () => sendMessage('Summarize my day') },
    { group: 'Actions', label: 'What is the weather?', icon: 'cloud', hint: 'Weather', run: () => sendMessage('What is the weather?') },
    { group: 'Actions', label: 'Show the global tech feed', icon: 'wave', hint: 'Signal', run: () => sendMessage('Show me the news') },
    { group: 'System', label: `Toggle voice responses (${state.settings.voice ? 'on' : 'off'})`, icon: 'volume', hint: 'Voice', run: () => setVoice(!state.settings.voice) },
    { group: 'System', label: `Toggle wake word (${state.settings.wake ? 'on' : 'off'})`, icon: 'mic', hint: 'Voice', run: () => setWake(!state.settings.wake) },
    { group: 'System', label: `Cycle interface accent (${accent})`, icon: 'spark', hint: 'Theme', run: () => {
      const accents = state.prime ? ['cyan', 'emerald', 'gold', 'violet', 'rose'] : ['cyan', 'emerald'];
      const next = accents[(accents.indexOf(accent) + 1) % accents.length];
      applyAccent(next);
      toast('Accent updated', `${next.charAt(0).toUpperCase()}${next.slice(1)} interface engaged.`);
    } },
    { group: 'System', label: 'Open settings', icon: 'settings', hint: 'Preferences', run: () => openModal('settingsModal') },
    { group: 'System', label: state.prime ? 'Manage Jarvis Prime' : 'Explore Jarvis Prime', icon: 'crown', hint: 'Membership', run: () => openModal('primeModal') }
  ];
}

function renderPalette(query) {
  const actions = paletteActions();
  const needle = query.trim().toLowerCase();
  const filtered = actions.filter((action) => !needle || action.label.toLowerCase().includes(needle) || action.group.toLowerCase().includes(needle));
  const results = $('#paletteResults');
  paletteFlat = [];
  const blocks = [];
  if (needle) {
    paletteFlat.push({ label: `Ask Jarvis: “${query.trim()}”`, icon: 'spark', hint: 'AI', run: () => sendMessage(query.trim()) });
    blocks.push(`<div class="palette-group">Ask Jarvis</div><button type="button" class="palette-item is-selected" data-palette-index="0"><svg><use href="#i-spark"></use></svg><span>Ask Jarvis: “${escapeHtml(query.trim())}”</span><small>AI</small></button>`);
  }
  let lastGroup = '';
  let index = paletteFlat.length;
  for (const action of filtered) {
    if (action.group !== lastGroup) {
      blocks.push(`<div class="palette-group">${escapeHtml(action.group)}</div>`);
      lastGroup = action.group;
    }
    paletteFlat.push(action);
    blocks.push(`<button type="button" class="palette-item" data-palette-index="${index}"><svg><use href="#i-${action.icon}"></use></svg><span>${escapeHtml(action.label)}</span><small>${escapeHtml(action.hint)}</small></button>`);
    index += 1;
  }
  if (!paletteFlat.length) blocks.push('<div class="palette-empty">No protocols matched. Try a broader command.</div>');
  results.innerHTML = blocks.join('');
  selectedPaletteIndex = 0;
  updatePaletteSelection();
}

function updatePaletteSelection() {
  $$('#paletteResults .palette-item').forEach((item) => {
    item.classList.toggle('is-selected', Number(item.dataset.paletteIndex) === selectedPaletteIndex);
  });
  const selected = $(`#paletteResults .palette-item[data-palette-index="${selectedPaletteIndex}"]`);
  selected?.scrollIntoView({ block: 'nearest' });
}

function runPaletteSelection() {
  const action = paletteFlat[selectedPaletteIndex];
  if (!action) return;
  closeModal('paletteModal');
  setTimeout(() => action.run(), 40);
}

function showTyping() {
  hideTyping();
  const el = document.createElement('div');
  el.className = 'msg msg-jarvis';
  el.id = 'typingMsg';
  el.innerHTML = '<span class="msg-avatar">J</span><div class="msg-body"><div class="typing"><i></i><i></i><i></i></div></div>';
  $('#chatLog').appendChild(el);
  typingEl = el;
  scrollChat();
}

function hideTyping() {
  typingEl?.remove();
  typingEl = null;
}

function messageHtml(message) {
  const time = new Date(message.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (message.role === 'user') {
    return `<div class="msg msg-user"><span class="msg-avatar">${escapeHtml(initials(state.user.name))}</span><div class="msg-body"><div class="msg-meta"><time>${time}</time><strong>${escapeHtml(state.user.name)}</strong></div><div class="msg-text">${formatText(message.text)}</div></div></div>`;
  }
  return `<div class="msg msg-jarvis"><span class="msg-avatar">J</span><div class="msg-body"><div class="msg-meta"><strong>Jarvis</strong><time>${time}</time></div><div class="msg-text">${formatText(message.text)}</div></div></div>`;
}

function renderChat() {
  const log = $('#chatLog');
  log.innerHTML = state.chat.map(messageHtml).join('');
  scrollChat();
}

async function sendMessage(raw, { viaVoice = false } = {}) {
  const text = String(raw || '').trim();
  if (!text) return;
  if (activeView !== 'assistant') navigate('assistant');
  $('#chatInput').value = '';
  hideTyping();
  state.chat.push({ id: uid('msg'), role: 'user', text, time: Date.now() });
  if (state.chat.length > 120) state.chat = state.chat.slice(-120);
  persist();
  renderChat();
  bumpCommand();
  renderStats();
  if (state.settings.sfx) audio.sfx('click');
  showTyping();
  setOrbState('working');
  let reply;
  try {
    reply = await respond(text, ctx);
  } catch (error) {
    console.error(error);
    reply = 'My neural link encountered an unexpected fault. The command was not completed — please try again.';
    audio.sfx('error');
  }
  await sleep(420);
  hideTyping();
  state.chat.push({ id: uid('msg'), role: 'jarvis', text: reply, time: Date.now() });
  if (state.chat.length > 120) state.chat = state.chat.slice(-120);
  persist();
  renderChat();
  renderStats();
  setOrbState('idle');
  if (state.settings.voice) audio.speak(reply);
  if (viaVoice) setVoiceUi('standby');
}

function startMic({ viaWake = false } = {}) {
  if (!micInput.supported) {
    setVoiceUi('unsupported');
    toast('Voice input unavailable', 'Speech recognition is not supported here. Chrome or Edge is recommended.', 'warn');
    return;
  }
  if (micInput.listening) {
    stopMic();
    return;
  }
  if (viaWake) navigate('assistant');
  audio.sfx('listen');
  setOrbState('listening');
  setVoiceUi('listening');
  $('#micBtn').classList.add('is-listening');
  micInput.start({
    onPartial: (transcript) => {
      $('#chatInput').value = transcript;
    },
    onFinal: (transcript) => {
      stopMic();
      const value = transcript.trim();
      if (value) sendMessage(value, { viaVoice: true });
      else toast('No speech detected', 'Try again a little closer to the microphone.', 'warn');
    },
    onError: (error) => {
      stopMic();
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        toast('Microphone blocked', 'Allow microphone access in your browser settings.', 'warn');
      }
    }
  });
}

function stopMic() {
  micInput.stop();
  $('#micBtn')?.classList.remove('is-listening');
  if (!audio.playing) setOrbState('idle');
  setVoiceUi('standby');
}

const ctx = {
  getState: () => state,
  navigate,
  addTask: (title, priority) => {
    if (!title) return null;
    const task = storeAddTask(title, priority);
    toast('Objective added', title, 'ok');
    return task;
  },
  addNote: (title, body) => {
    const note = storeAddNote(title, body);
    toast('Memory stored', title, 'ok');
    return note;
  },
  addEvent: (event) => {
    const created = storeAddEvent(event);
    const date = new Date(`${event.date}T12:00:00`);
    calView = { year: date.getFullYear(), month: date.getMonth() };
    selectedDate = event.date;
    renderCalendar();
    renderTimeline();
    toast('Event scheduled', `${event.title} · ${formatDayLabel(event.date)}`, 'ok');
    return created;
  },
  completeTask: completeTaskByQuery,
  startTimer,
  startFocus: (minutes) => startFocus(minutes),
  stopFocus,
  playAmbient,
  pauseAmbient,
  nextAmbient,
  setAccent: (accent) => {
    if (!['cyan', 'emerald', 'gold', 'violet', 'rose'].includes(accent)) return { ok: false };
    if (['gold', 'violet', 'rose'].includes(accent) && !state.prime) return { ok: false, reason: 'prime' };
    applyAccent(accent);
    return { ok: true };
  },
  setVoice,
  activatePrime: () => activatePrime(),
  openPrime: () => openModal('primeModal'),
  openSettings: () => openModal('settingsModal'),
  openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  weather: (city) => loadWeather(city || state.weatherCity, { force: !!city }),
  news: () => {
    if (feedCache.items.length && Date.now() - feedCache.at < 600000) return Promise.resolve(feedCache.items);
    return loadFeed(true);
  },
  status: systemStatus,
  briefing: buildBriefing,
  setUserName,
  clearChat,
  notify: (title, body, kind) => { pushNotification(title, body, kind); toast(title, body, kind); }
};

function activatePrime() {
  if (state.prime) return false;
  update((s) => { s.prime = true; });
  applyAccent('gold');
  applyPrime();
  pushNotification('Jarvis Prime activated', 'Neural insights, premium accents, and Event Horizon are now unlocked.', 'ok');
  toast('Jarvis Prime activated', 'All premium protocols are now available, Commander.', 'ok');
  audio.sfx('success');
  return true;
}

function setMetric(id, value, barId, percent) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
  const bar = document.getElementById(barId);
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

async function updateVitals() {
  const cores = navigator.hardwareConcurrency || 0;
  setMetric('vitalCores', cores ? `${cores} threads` : 'Unknown', 'barCores', cores ? Math.min(100, (cores / 16) * 100) : 0);
  const memory = performance.memory;
  if (memory) {
    const used = memory.usedJSHeapSize / 1048576;
    const total = memory.jsHeapSizeLimit / 1048576;
    const label = used >= 1024 ? `${(used / 1024).toFixed(1)} GB` : `${Math.round(used)} MB`;
    setMetric('vitalMemory', label, 'barMemory', (used / total) * 100);
  } else {
    setMetric('vitalMemory', 'Protected', 'barMemory', 0);
  }
  const connection = navigator.connection;
  if (connection) {
    const label = `${String(connection.effectiveType || 'online').toUpperCase()}${connection.downlink ? ` · ${connection.downlink} Mbps` : ''}`;
    setMetric('vitalNetwork', label, 'barNetwork', Math.min(100, ((connection.downlink || 1) / 20) * 100));
  } else {
    setMetric('vitalNetwork', navigator.onLine ? 'Online' : 'Offline', 'barNetwork', navigator.onLine ? 100 : 0);
  }
  setMetric('vitalBattery', session.battery.level === null ? 'Unavailable' : `${Math.round(session.battery.level * 100)}%${session.battery.charging ? ' · charging' : ''}`, 'barBattery', session.battery.level === null ? 0 : session.battery.level * 100);
}

async function setupBattery() {
  try {
    if (!navigator.getBattery) {
      setMetric('vitalBattery', 'Unavailable', 'barBattery', 0);
      return;
    }
    const battery = await navigator.getBattery();
    const sync = () => {
      session.battery.level = battery.level;
      session.battery.charging = battery.charging;
      updateVitals();
    };
    sync();
    battery.addEventListener('levelchange', sync);
    battery.addEventListener('chargingchange', sync);
  } catch {
    session.battery.level = null;
    updateVitals();
  }
}

function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const clock = $('#topClock');
  if (clock) clock.innerHTML = `<svg><use href="#i-clock"></use></svg><span>${time}</span>`;
  const uptime = Math.floor((Date.now() - session.started) / 1000);
  const el = $('#sessionUptime');
  if (el) el.textContent = `${pad(Math.floor(uptime / 3600))}:${pad(Math.floor((uptime % 3600) / 60))}:${pad(uptime % 60)}`;
  const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
  if (minuteKey !== session.lastMinute) {
    session.lastMinute = minuteKey;
    renderDashboardAgenda();
  }
}

function tick() {
  updateClock();
  tickTimers();
  if (focus.running) {
    const remaining = Math.max(0, (focus.endAt - Date.now()) / 1000);
    focus.remaining = remaining;
    if (remaining <= 0) completeFocus();
  }
  renderFocus();
}

class Orb {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.phase = Math.random() * Math.PI * 2;
    this.particles = Array.from({ length: 46 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 0.72 + Math.random() * 1.15,
      speed: 0.05 + Math.random() * 0.22,
      size: 0.6 + Math.random() * 1.6,
      offset: Math.random() * Math.PI * 2
    }));
    this.width = 0;
    this.height = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setState(next) {
    this.state = next;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  draw(now) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || rect.height < 10) return;
    if (Math.abs(rect.width - this.width) > 2) this.resize();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;
    const t = now / 1000;
    const rgb = accentRgb();
    let energy = 0.5 + 0.5 * Math.sin(t * 1.35 + this.phase);
    if (this.state === 'listening') energy = 0.55 + 0.45 * Math.sin(t * 5.2);
    else if (this.state === 'speaking') energy = 0.5 + 0.45 * Math.sin(t * 7.5) * Math.sin(t * 2.8);
    else if (this.state === 'working') energy = 0.45 + 0.35 * Math.sin(t * 2.4);
    const base = Math.min(w, h) * 0.185;
    ctx.clearRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, base * 2.5);
    glow.addColorStop(0, `rgba(${rgb}, ${0.16 + energy * 0.14})`);
    glow.addColorStop(0.45, `rgba(${rgb}, 0.07)`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 3; i += 1) {
      const radius = base * (1.32 + i * 0.28);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${rgb}, ${0.16 - i * 0.03})`;
      ctx.lineWidth = 1;
      ctx.setLineDash(i % 2 === 0 ? [2, 9] : [18, 14]);
      ctx.lineDashOffset = (i % 2 === 0 ? -1 : 1) * t * (6 + i * 5);
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let i = 0; i < 3; i += 1) {
      const radius = base * (1.2 + i * 0.26);
      const start = t * (0.55 + i * 0.25) + i * 2.1;
      const length = 0.55 + energy * 0.7;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${rgb}, ${0.55 - i * 0.12})`;
      ctx.lineWidth = 1.4 + (1 - i) * 0.6;
      ctx.lineCap = 'round';
      ctx.arc(0, 0, radius, start, start + length);
      ctx.stroke();
    }
    ctx.restore();

    const coreRadius = base * (0.58 + energy * 0.1);
    const core = ctx.createRadialGradient(cx - coreRadius * 0.22, cy - coreRadius * 0.28, 1, cx, cy, coreRadius);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    core.addColorStop(0.18, `rgba(${rgb}, 0.9)`);
    core.addColorStop(0.55, `rgba(${rgb}, 0.28)`);
    core.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = `rgba(${rgb}, 0.1)`;
    ctx.arc(cx, cy, base * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${rgb}, ${0.4 + energy * 0.25})`;
    ctx.lineWidth = 1.3;
    ctx.arc(cx, cy, base * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    const dot = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, base * 0.18);
    dot.addColorStop(0, '#ffffff');
    dot.addColorStop(0.45, `rgba(${rgb}, 0.9)`);
    dot.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 0.18, 0, Math.PI * 2);
    ctx.fill();

    for (const particle of this.particles) {
      const speed = this.state === 'listening' ? 1.9 : this.state === 'speaking' ? 1.6 : 1;
      const angle = particle.angle + t * particle.speed * speed;
      const radius = base * particle.radius * (1 + 0.045 * Math.sin(t * 1.5 + particle.offset));
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.92;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${rgb}, ${0.22 + energy * 0.55})`;
      ctx.arc(x, y, particle.size * (0.7 + energy * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const starCanvas = $('#starfield');
const starCtx = starCanvas.getContext('2d');
let stars = [];
let starWidth = 0;
let starHeight = 0;

function initStars() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  starWidth = window.innerWidth;
  starHeight = window.innerHeight;
  starCanvas.width = Math.round(starWidth * dpr);
  starCanvas.height = Math.round(starHeight * dpr);
  starCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stars = Array.from({ length: 110 }, () => ({
    x: Math.random() * starWidth,
    y: Math.random() * starHeight,
    radius: Math.random() * 1.1 + 0.3,
    speed: Math.random() * 4 + 1.2,
    alpha: Math.random() * 0.5 + 0.15,
    twinkle: Math.random() * Math.PI * 2
  }));
}

function drawStars(now, dt) {
  if (!stars.length || Math.abs(window.innerWidth - starWidth) > 4 || Math.abs(window.innerHeight - starHeight) > 4) initStars();
  starCtx.clearRect(0, 0, starWidth, starHeight);
  const rgb = accentRgb();
  for (const star of stars) {
    star.y += (star.speed * dt) / 1000;
    if (star.y > starHeight + 4) {
      star.y = -4;
      star.x = Math.random() * starWidth;
    }
    const alpha = star.alpha * (0.55 + 0.45 * Math.sin(now * 0.0008 + star.twinkle));
    starCtx.beginPath();
    starCtx.fillStyle = `rgba(${rgb}, ${Math.max(0.04, alpha)})`;
    starCtx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    starCtx.fill();
  }
}

const waveCanvas = $('#voiceWave');
const waveCtx = waveCanvas.getContext('2d');

function drawWave(now) {
  const w = waveCanvas.width;
  const h = waveCanvas.height;
  waveCtx.clearRect(0, 0, w, h);
  const speaking = currentOrb === 'speaking';
  const listening = currentOrb === 'listening' || micInput.listening;
  const amplitude = listening ? 34 : speaking ? 26 : 7;
  const rgb = accentRgb();
  for (let layer = 0; layer < 3; layer += 1) {
    waveCtx.beginPath();
    waveCtx.lineWidth = 1.6 - layer * 0.3;
    waveCtx.strokeStyle = `rgba(${rgb}, ${0.55 - layer * 0.15})`;
    for (let x = 0; x <= w; x += 4) {
      const envelope = Math.sin((x / w) * Math.PI);
      const y = h / 2
        + Math.sin(x * 0.028 + now * 0.0016 * (layer + 1) + layer) * amplitude * envelope
        + Math.sin(x * 0.011 - now * 0.0012 + layer * 2) * amplitude * 0.4 * envelope;
      if (x === 0) waveCtx.moveTo(x, y);
      else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
  }
  waveCtx.beginPath();
  waveCtx.strokeStyle = `rgba(${rgb}, 0.12)`;
  waveCtx.lineWidth = 1;
  waveCtx.moveTo(0, h / 2);
  waveCtx.lineTo(w, h / 2);
  waveCtx.stroke();
}

const visCanvas = $('#visualizer');
const visCtx = visCanvas.getContext('2d');

function drawVisualizer(now) {
  const w = visCanvas.width;
  const h = visCanvas.height;
  visCtx.clearRect(0, 0, w, h);
  const rgb = accentRgb();
  const data = audio.getData();
  const bars = 52;
  const gap = 3;
  const barWidth = (w - gap * (bars - 1)) / bars;
  for (let i = 0; i < bars; i += 1) {
    let value;
    if (data && audio.playing) {
      value = data[Math.floor((i / bars) * (data.length * 0.7))] / 255;
    } else {
      value = 0.12 + 0.08 * Math.sin(now * 0.0012 + i * 0.45) + 0.05 * Math.sin(now * 0.0023 + i * 0.2);
    }
    const height = Math.max(3, Math.pow(Math.max(0.04, value), 1.35) * h * 0.78);
    const x = i * (barWidth + gap);
    const gradient = visCtx.createLinearGradient(0, h, 0, h - height);
    gradient.addColorStop(0, `rgba(${rgb}, 0.16)`);
    gradient.addColorStop(0.6, `rgba(${rgb}, 0.55)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0.95)`);
    visCtx.fillStyle = gradient;
    visCtx.beginPath();
    const radius = Math.min(2, barWidth / 2);
    const y = h - height - 8;
    visCtx.roundRect(x, y, barWidth, height, [radius, radius, 0, 0]);
    visCtx.fill();
  }
}

let lastFrame = performance.now();
let visualAccumulator = 0;

function frame(now) {
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  orb?.draw(now);
  drawStars(now, dt);
  visualAccumulator += dt;
  if (visualAccumulator > 48) {
    visualAccumulator = 0;
    drawWave(now);
    drawVisualizer(now);
  }
  requestAnimationFrame(frame);
}

function openNoteEditor(id) {
  editingNoteId = id || null;
  const note = id ? state.notes.find((item) => item.id === id) : null;
  $('#noteModalTitle').textContent = id ? 'Edit memory' : 'New note';
  $('#noteTitle').value = note?.title || '';
  $('#noteBody').value = note?.body || '';
  openModal('noteModal');
  setTimeout(() => $('#noteTitle').focus(), 80);
}

function resetChatView() {
  clearChat();
  state.chat.push({
    id: uid('msg'),
    role: 'jarvis',
    text: 'Conversation buffer cleared. A clean slate, Commander. What shall we do next?',
    time: Date.now()
  });
  persist();
  renderChat();
  audio.sfx('toggle');
  toast('Console cleared', 'A fresh conversation buffer is ready.');
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      navigate(viewButton.dataset.view);
      audio.sfx('click');
      return;
    }
    const promptButton = event.target.closest('[data-prompt]');
    if (promptButton) {
      sendMessage(promptButton.dataset.prompt);
      return;
    }
    const openButton = event.target.closest('[data-open]');
    if (openButton) {
      const map = { settings: 'settingsModal', prime: 'primeModal', event: 'eventModal', note: 'noteModal' };
      openModal(map[openButton.dataset.open] || `${openButton.dataset.open}Modal`);
      audio.sfx('click');
      return;
    }
    const closeButton = event.target.closest('[data-close]');
    if (closeButton) {
      closeModal(closeButton.closest('.modal'));
      return;
    }
  });

  MODAL_IDS.forEach((id) => {
    const modal = document.getElementById(id);
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  $('#menuBtn').addEventListener('click', openSidebar);
  $('#scrim').addEventListener('click', () => {
    toggleNotifications(false);
    closeSidebar();
  });
  $('#notifBtn').addEventListener('click', () => toggleNotifications());
  $('#clearNotifs').addEventListener('click', () => {
    clearNotifications();
    toast('Notifications cleared');
  });
  $('#openSettingsProfile').addEventListener('click', () => openModal('settingsModal'));
  $('#topAvatar').addEventListener('click', () => openModal('settingsModal'));

  $('#openPalette').addEventListener('click', () => openModal('paletteModal'));
  $('#paletteInput').addEventListener('input', (event) => renderPalette(event.target.value));
  $('#paletteInput').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedPaletteIndex = Math.min(paletteFlat.length - 1, selectedPaletteIndex + 1);
      updatePaletteSelection();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedPaletteIndex = Math.max(0, selectedPaletteIndex - 1);
      updatePaletteSelection();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runPaletteSelection();
    }
  });
  $('#paletteResults').addEventListener('click', (event) => {
    const item = event.target.closest('[data-palette-index]');
    if (!item) return;
    selectedPaletteIndex = Number(item.dataset.paletteIndex);
    runPaletteSelection();
  });

  $('#chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage($('#chatInput').value);
  });
  $('#micBtn').addEventListener('click', () => startMic());
  $('#heroTalk').addEventListener('click', () => {
    navigate('assistant');
    startMic();
  });
  $('#clearChat').addEventListener('click', resetChatView);
  $('#chatVoice').addEventListener('click', () => setVoice(!state.settings.voice));
  $('#voiceToggle').addEventListener('click', () => setVoice(!state.settings.voice));
  $('#wakeSwitch').addEventListener('change', (event) => setWake(event.target.checked));
  $('#voiceSwitch').addEventListener('change', (event) => setVoice(event.target.checked, { silent: true }));

  $$('[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.setting;
      if (key === 'voice') setVoice(input.checked, { silent: true });
      else if (key === 'wake') setWake(input.checked);
      else {
        state.settings[key] = input.checked;
        persist();
        document.body.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
        syncSettingToggles();
      }
    });
  });

  $('#accentGrid').addEventListener('click', (event) => {
    const swatch = event.target.closest('.accent-swatch');
    if (!swatch) return;
    if (swatch.dataset.premium && !state.prime) {
      openModal('primeModal');
      toast('Prime accent', `${swatch.dataset.accent.charAt(0).toUpperCase()}${swatch.dataset.accent.slice(1)} requires Jarvis Prime.`, 'warn');
      return;
    }
    applyAccent(swatch.dataset.accent);
    toast('Accent updated', `${swatch.dataset.accent.charAt(0).toUpperCase()}${swatch.dataset.accent.slice(1)} interface engaged.`);
    audio.sfx('click');
  });

  $('#profileName').addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      event.target.value = state.user.name;
      return;
    }
    setUserName(value);
    renderChat();
    toast('Identity updated', `I will address you as ${state.user.name}.`);
  });

  $('#exportData').addEventListener('click', () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jarvis-archive-${isoDate()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast('Archive exported', 'Your complete intelligence archive has been downloaded.', 'ok');
  });

  $('#resetData').addEventListener('click', () => {
    if (!window.confirm('Reset the entire Jarvis system? All tasks, notes, events, and preferences will be erased.')) return;
    resetState();
    window.location.reload();
  });

  $('#activatePrime').addEventListener('click', () => {
    if (state.prime) return;
    activatePrime();
  });

  $('#focusToggle').addEventListener('click', toggleFocus);
  $('#dashFocusBtn').addEventListener('click', () => {
    if (focus.running) pauseFocus();
    else {
      toggleFocus();
      if (activeView !== 'focus') navigate('focus');
    }
  });
  $('#focusReset').addEventListener('click', resetFocus);
  $('#presetRow').addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset]');
    if (button) setFocusPreset(Number(button.dataset.preset));
  });

  $('#musicToggle').addEventListener('click', () => {
    if (audio.playing) pauseAmbient();
    else playAmbient(audio.trackId);
  });
  $('#trackList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-track]');
    if (!button) return;
    const id = button.dataset.track;
    if (id === audio.trackId && audio.playing) {
      pauseAmbient();
      return;
    }
    playAmbient(id).then((result) => {
      if (!result.ok && result.reason === 'prime') {
        openModal('primeModal');
        toast('Prime soundscape', 'Event Horizon requires Jarvis Prime.', 'warn');
      }
    });
  });
  const volume = $('#volume');
  const initialVolume = state.settings.volume ?? 45;
  volume.value = initialVolume;
  $('#volumeValue').textContent = initialVolume;
  audio.setVolume(initialVolume);
  volume.addEventListener('input', () => {
    const value = Number(volume.value);
    audio.setVolume(value);
    $('#volumeValue').textContent = value;
    state.settings.volume = value;
    persist();
  });

  $('#taskForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('#taskInput').value.trim();
    if (!title) return;
    storeAddTask(title, $('#taskPriority').value);
    $('#taskInput').value = '';
    audio.sfx('success');
    renderTasks();
    toast('Objective added', title, 'ok');
  });
  $('#taskAddBtn').addEventListener('click', () => {
    navigate('workspace');
    $('#taskInput').focus();
  });
  $('#taskFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-task-filter]');
    if (!button) return;
    taskFilter = button.dataset.taskFilter;
    renderTasks();
    audio.sfx('click');
  });
  $('#taskList').addEventListener('click', (event) => {
    const item = event.target.closest('.task-item');
    if (!item) return;
    const id = item.dataset.id;
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const task = state.tasks.find((entry) => entry.id === id);
    if (!task) return;
    if (action === 'delete') {
      update((s) => { s.tasks = s.tasks.filter((entry) => entry.id !== id); });
      toast('Objective removed', task.title);
      audio.sfx('click');
      return;
    }
    if (action === 'toggle') {
      const done = task.status !== 'done';
      update((s) => {
        const entry = s.tasks.find((candidate) => candidate.id === id);
        if (!entry) return;
        entry.status = done ? 'done' : 'active';
        if (done) s.stats.tasksDone = (s.stats.tasksDone || 0) + 1;
      });
      if (done) {
        audio.sfx('success');
        toast('Objective complete', task.title, 'ok');
      }
      return;
    }
    if (action === 'cycle') {
      const order = ['backlog', 'active', 'done'];
      const nextStatus = order[(order.indexOf(task.status) + 1) % order.length];
      update((s) => {
        const entry = s.tasks.find((candidate) => candidate.id === id);
        if (!entry) return;
        entry.status = nextStatus;
        if (nextStatus === 'done' && task.status !== 'done') s.stats.tasksDone = (s.stats.tasksDone || 0) + 1;
      });
      audio.sfx('click');
    }
  });

  $('#noteAddBtn').addEventListener('click', () => openNoteEditor(null));
  $('#notesGrid').addEventListener('click', (event) => {
    if (event.target.closest('#noteAddInline')) {
      openNoteEditor(null);
      return;
    }
    const card = event.target.closest('.note');
    if (!card) return;
    if (event.target.closest('[data-action="delete-note"]')) {
      update((s) => { s.notes = s.notes.filter((note) => note.id !== card.dataset.id); });
      toast('Memory erased');
      return;
    }
    openNoteEditor(card.dataset.id);
  });
  $('#notesGrid').addEventListener('keydown', (event) => {
    const card = event.target.closest('.note');
    if (card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openNoteEditor(card.dataset.id);
    }
  });
  $('#noteForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('#noteTitle').value.trim();
    const body = $('#noteBody').value.trim();
    if (!title || !body) return;
    if (editingNoteId) {
      update((s) => {
        const note = s.notes.find((item) => item.id === editingNoteId);
        if (note) {
          note.title = title;
          note.body = body;
          note.updated = Date.now();
        }
      });
      toast('Memory updated', title, 'ok');
    } else {
      storeAddNote(title, body);
      toast('Memory stored', title, 'ok');
    }
    audio.sfx('success');
    editingNoteId = null;
    closeModal('noteModal');
    renderNotes();
  });

  $('#eventForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('#eventTitle').value.trim();
    const date = $('#eventDate').value;
    const time = $('#eventTime').value;
    if (!title || !date || !time) return;
    ctx.addEvent({ title, date, time, tag: $('#eventTag').value });
    audio.sfx('success');
    closeModal('eventModal');
    renderCalendar();
    renderTimeline();
  });
  $('#calPrev').addEventListener('click', () => {
    calView.month -= 1;
    if (calView.month < 0) { calView.month = 11; calView.year -= 1; }
    selectedDate = null;
    renderCalendar();
    renderTimeline();
  });
  $('#calNext').addEventListener('click', () => {
    calView.month += 1;
    if (calView.month > 11) { calView.month = 0; calView.year += 1; }
    selectedDate = null;
    renderCalendar();
    renderTimeline();
  });
  $('#calToday').addEventListener('click', () => {
    const now = new Date();
    calView = { year: now.getFullYear(), month: now.getMonth() };
    selectedDate = isoDate(now);
    renderCalendar();
    renderTimeline();
  });
  $('#calendarGrid').addEventListener('click', (event) => {
    const cell = event.target.closest('[data-date]');
    if (!cell) return;
    selectedDate = cell.dataset.date;
    const date = new Date(`${selectedDate}T12:00:00`);
    calView = { year: date.getFullYear(), month: date.getMonth() };
    renderCalendar();
    renderTimeline();
    audio.sfx('click');
  });
  $('#timelineList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="delete-event"]');
    if (!button) return;
    const item = button.closest('.event-item');
    update((s) => { s.events = s.events.filter((entry) => entry.id !== item.dataset.id); });
    toast('Event removed');
  });
  $('#showAllEvents').addEventListener('click', () => {
    selectedDate = null;
    renderCalendar();
    renderTimeline();
  });

  $('#weatherRefresh').addEventListener('click', () => {
    loadWeather(state.weatherCity, { force: true }).catch(() => toast('Weather uplink unavailable', 'Try again in a moment.', 'warn'));
  });
  $('#feedRefresh').addEventListener('click', () => {
    loadFeed(true).catch(() => toast('Signal feed unavailable', 'The network may be restricted.', 'warn'));
  });
  $('#feedList').addEventListener('click', (event) => {
    if (event.target.closest('#feedRetry')) {
      loadFeed(true).catch(() => toast('Signal feed unavailable', 'The network may be restricted.', 'warn'));
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openModal('paletteModal');
      return;
    }
    if (event.key === 'Escape') {
      closeAllModals();
      toggleNotifications(false);
      closeSidebar();
      return;
    }
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (typing) return;
    if (/^[1-5]$/.test(event.key)) {
      navigate(['dashboard', 'assistant', 'focus', 'workspace', 'timeline'][Number(event.key) - 1]);
    }
    if (event.key === '/') {
      event.preventDefault();
      openModal('paletteModal');
    }
  });

  window.addEventListener('online', () => {
    toast('Uplink restored', 'Global sensors are back online.', 'ok');
    updateVitals();
  });
  window.addEventListener('offline', () => {
    toast('Uplink lost', 'You are offline. Local systems remain operational.', 'warn');
    updateVitals();
  });
}

const BOOT_LINES = [
  'Initialising neural core',
  'Loading personality matrix',
  'Calibrating voice interface',
  'Syncing global sensors',
  'Establishing secure uplink',
  'J.A.R.V.I.S online'
];

function runBoot() {
  const boot = $('#boot');
  if (sessionStorage.getItem('jarvis-booted') === '1') {
    boot.classList.add('is-done');
    return;
  }
  const log = $('#bootLog');
  const bar = $('#bootBar');
  let index = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    bar.style.width = '100%';
    sessionStorage.setItem('jarvis-booted', '1');
    setTimeout(() => boot.classList.add('is-done'), 340);
  };
  const timer = setInterval(() => {
    if (index >= BOOT_LINES.length) {
      finish();
      return;
    }
    const line = document.createElement('span');
    line.innerHTML = `${BOOT_LINES[index]} <b>OK</b>`;
    log.appendChild(line);
    bar.style.width = `${Math.round(((index + 1) / BOOT_LINES.length) * 100)}%`;
    index += 1;
  }, 240);
  $('#bootSkip').addEventListener('click', finish);
  setTimeout(finish, 4600);
}

function init() {
  applyAccent(state.settings.accent, { save: false });
  syncIdentity();
  syncSettingsUI();
  renderChat();
  renderTasks();
  renderNotes();
  renderDashboardAgenda();
  renderCalendar();
  renderTimeline();
  renderNotifications();
  renderStats();
  renderFocus();
  renderTimers();
  renderMusicState();

  orb = new Orb($('#orbCanvas'));
  setupBattery();
  updateVitals();
  updateClock();
  bindEvents();
  initStars();
  requestAnimationFrame(frame);

  loadWeather().catch(() => {});
  loadFeed().catch(() => {});
  setInterval(tick, 1000);

  if (state.settings.wake) {
    document.addEventListener('pointerdown', () => {
      if (state.settings.wake && !wakeInput.listening) setWake(true);
    }, { once: true });
  }

  runBoot();
}

subscribe(() => {
  syncIdentity();
  renderNotifications();
  renderStats();
  renderTasks();
  renderNotes();
  renderDashboardAgenda();
  renderCalendar();
  renderTimeline();
  renderFocus();
  renderTimers();
  applyPrime();
});

audio.onState = () => renderMusicState();
audio.onSpeak = (speaking) => {
  if (speaking) {
    setOrbState('speaking');
    wakeInput.pauseForSpeech();
  } else {
    if (micInput.listening) setOrbState('listening');
    else setOrbState('idle');
    wakeInput.resumeAfterSpeech();
  }
};

init();
