const SITES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  github: 'https://github.com',
  gmail: 'https://mail.google.com',
  maps: 'https://maps.google.com',
  spotify: 'https://open.spotify.com',
  netflix: 'https://www.netflix.com',
  reddit: 'https://www.reddit.com',
  wikipedia: 'https://www.wikipedia.org',
  twitter: 'https://x.com',
  x: 'https://x.com',
  'stack overflow': 'https://stackoverflow.com',
  chatgpt: 'https://chatgpt.com',
  news: 'https://news.ycombinator.com'
};

const JOKES = [
  'I told the neural network a joke about UDP. I am not sure it got it.',
  'Why did the developer go broke? Because he used up all his cache.',
  'There are two hard things in computing: cache invalidation, naming things, and off-by-one errors.',
  'I would tell you a joke about recursion, but I would have to tell you a joke about recursion first.',
  'My favourite security protocol is a good night of sleep. It patches almost everything.'
];

const QUOTES = [
  ['The best way to predict the future is to invent it.', 'Alan Kay'],
  ['Any sufficiently advanced technology is indistinguishable from magic.', 'Arthur C. Clarke'],
  ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['First, solve the problem. Then, write the code.', 'John Johnson'],
  ['Simplicity is prerequisite for reliability.', 'Edsger W. Dijkstra']
];

const FACTS = [
  'A single teaspoon of neutron star material would weigh roughly six billion tons on Earth.',
  'The first computer bug was an actual moth, taped into a logbook in 1947.',
  'Fibre-optic cables carry data as pulses of light, which is why the global network feels instantaneous.',
  'There are more possible chess games than atoms in the observable universe.',
  'Your phone has more computing power than the guidance computer that landed Apollo 11.'
];

const REMINDERS = [
  'Always under promise and over deliver.',
  'A calm system is a reliable system.',
  'One clear priority beats ten vague intentions.'
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clean = (value) => value.replace(/^[\s,:-]+|[\s.!?]+$/g, '').trim();
const cap = (value) => value.charAt(0).toUpperCase() + value.slice(1);

function parseDuration(text) {
  const units = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };
  const re = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/gi;
  let total = 0;
  let match;
  while ((match = re.exec(text))) {
    total += parseFloat(match[1]) * units[match[2].toLowerCase()];
  }
  return total > 0 ? Math.round(total) : 0;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}${s ? ` ${s} seconds` : ''}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${rm ? ` ${rm} minutes` : ''}`;
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDate(date) {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function evaluate(expression) {
  const src = expression.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '.');
  let pos = 0;
  const peek = () => src[pos];
  const parseExpression = () => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++];
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = () => {
    let value = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[pos++];
      const right = parsePower();
      if (op === '*') value *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('division by zero');
        value /= right;
      } else value %= right;
    }
    return value;
  };
  const parsePower = () => {
    let value = parseUnary();
    if (peek() === '^') {
      pos += 1;
      value **= parsePower();
    }
    return value;
  };
  const parseUnary = () => {
    if (peek() === '-') { pos += 1; return -parseUnary(); }
    if (peek() === '+') { pos += 1; return parseUnary(); }
    return parsePrimary();
  };
  const parsePrimary = () => {
    if (peek() === '(') {
      pos += 1;
      const value = parseExpression();
      if (peek() !== ')') throw new Error('missing parenthesis');
      pos += 1;
      return value;
    }
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos += 1;
    if (start === pos) throw new Error('unexpected token');
    const value = parseFloat(src.slice(start, pos));
    if (Number.isNaN(value)) throw new Error('invalid number');
    return value;
  };
  const result = parseExpression();
  if (pos !== src.length) throw new Error('unexpected token');
  if (!Number.isFinite(result)) throw new Error('not finite');
  return result;
}

function formatNumber(value) {
  if (Number.isInteger(value)) return value.toLocaleString();
  return parseFloat(value.toFixed(6)).toLocaleString();
}

function dueLabel(date) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (date === iso(today)) return 'today';
  if (date === iso(tomorrow)) return 'tomorrow';
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function scheduleFromText(text) {
  const lower = text.toLowerCase();
  let date = new Date();
  let dateLabel = 'today';
  if (/\btomorrow\b/.test(lower)) {
    date.setDate(date.getDate() + 1);
    dateLabel = 'tomorrow';
  } else if (/\btoday\b/.test(lower)) {
    dateLabel = 'today';
  }
  let hour = 9;
  let minute = 0;
  let foundTime = false;
  const ampm = text.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const twentyFour = text.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
  if (ampm) {
    hour = parseInt(ampm[1], 10) % 12;
    if (ampm[3].toLowerCase() === 'pm') hour += 12;
    minute = ampm[2] ? parseInt(ampm[2], 10) : 0;
    foundTime = true;
  } else if (twentyFour) {
    hour = parseInt(twentyFour[1], 10);
    minute = parseInt(twentyFour[2], 10);
    foundTime = true;
  }
  if (!foundTime) dateLabel = 'today';
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let title = text
    .replace(/\b(today|tomorrow)\b/gi, '')
    .replace(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
    .replace(/\bat\s+\d{1,2}:\d{2}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  title = clean(title);
  return { title, date: iso, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, label: dateLabel, foundTime, hour, minute };
}

function helpText(name) {
  return `I operate across five modules, ${name}.

**Command Center** — live vitals, atmosphere, agenda, and a global tech signal.
**Assistant** — natural language, voice, web search, calculations, and system control.
**Deep Focus** — focus protocols with generative ambience and session tracking.
**Workspace** — mission tasks plus a persistent memory vault.
**Timeline** — scheduling with a full calendar.

Try saying:
- "Set a timer for 10 minutes"
- "Add task review the telemetry"
- "Note that the reactor needs recalibration"
- "Schedule mission briefing tomorrow at 9am"
- "Weather in Tokyo"
- "Start a 25 minute focus session"
- "Play deep focus ambience"
- "Summarize my day"
- "Open workspace" or "Open YouTube"
- "Switch to the emerald theme"`;
}

export async function respond(raw, ctx) {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const name = ctx.getState().user.name || 'Commander';

  if (!text) return 'I am listening. Give me a command, or ask me anything.';

  const nameMatch = text.match(/(?:call me|my name is|i am)\s+([a-zA-Z][a-zA-Z .'-]{1,23})$/i);
  if (nameMatch) {
    const newName = cap(clean(nameMatch[1]));
    ctx.setUserName(newName);
    return `Understood. I will address you as **${newName}** from now on.`;
  }

  if (/^(hi|hello|hey|yo|greetings|good (morning|afternoon|evening))\b[\s!.]*$/i.test(lower)) {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    return `Good ${part}, ${name}. Neural core is stable and all systems are nominal. What shall we accomplish?`;
  }

  if (/(who are you|what are you|introduce yourself|your name)/i.test(lower)) {
    return `I am **J.A.R.V.I.S** — Just A Rather Very Intelligent System. A local-first intelligence layer built to manage your tasks, time, focus, and information.\n\nMy voice, memory, and interface run here in your browser. Nothing leaves this device unless you explicitly ask me to open an external service.`;
  }

  if (/(what can you do|help me|show.*commands|capabilities|^help$|^commands$)/i.test(lower)) {
    return helpText(name);
  }

  if (/^(thanks|thank you|cheers|appreciate it)\b/i.test(lower)) {
    return pick([
      'Always a pleasure, Commander.',
      'That is what I am here for. What is next?',
      'Noted. I will keep the momentum going.',
      'At your service. Shall I prepare the next objective?'
    ]);
  }

  if (/\b(what time|current time|the time is|^time$|what's the time)\b/i.test(lower)) {
    const now = new Date();
    return `It is **${formatClock(now)}** local time, ${name}.`;
  }

  if (/\b(what.*(date|day) is it|today's date|what day|^date$)\b/i.test(lower)) {
    return `Today is **${formatDate(new Date())}**.`;
  }

  if (/(are you (there|online|awake)|you there|ping|systems check)/i.test(lower)) {
    return `Present and operational, ${name}. Latency is low, neural link is stable. How may I assist?`;
  }

  const navMatch = lower.match(/^(?:open|go to|show|switch to|take me to)\s+(?:the\s+)?(dashboard|command center|assistant|chat|console|focus|deep focus|workspace|tasks|timeline|calendar|settings|preferences|prime)\b/);
  if (navMatch) {
    const target = navMatch[1];
    const map = { dashboard: 'dashboard', 'command center': 'dashboard', assistant: 'assistant', chat: 'assistant', console: 'assistant', focus: 'focus', 'deep focus': 'focus', workspace: 'workspace', tasks: 'workspace', timeline: 'timeline', calendar: 'timeline', settings: 'settings', preferences: 'settings', prime: 'prime' };
    ctx.navigate(map[target] || 'dashboard');
    const labels = { dashboard: 'Command Center', assistant: 'Assistant console', focus: 'Deep Focus', workspace: 'Workspace', timeline: 'Timeline', settings: 'Settings', prime: 'Jarvis Prime' };
    return `Opening **${labels[map[target]] || 'Command Center'}**.`;
  }

  if (/(weather|forecast|temperature|how (hot|cold) is it)/i.test(lower)) {
    let city = null;
    const inMatch = text.match(/(?:weather|forecast|temperature)(?:\s+(?:in|for|at))?\s+([a-zA-Z .'-]{2,40})$/i);
    if (inMatch) {
      const candidate = clean(inMatch[1]);
      if (candidate && !/^(like|today|tomorrow|now|outside|please)$/i.test(candidate)) city = candidate;
    }
    try {
      const data = await ctx.weather(city);
      if (!data) throw new Error('no data');
      return `**${data.city}** is currently **${Math.round(data.temp)}°C** with ${data.condition.toLowerCase()}. Feels like ${Math.round(data.feels)}°C, humidity ${data.humidity}%, wind ${Math.round(data.wind)} km/h.\n\nToday's range: ${Math.round(data.min)}° to ${Math.round(data.max)}°.`;
    } catch {
      return `My atmospheric uplink is unavailable right now, ${name}. The forecast service did not respond. I will keep trying in the background.`;
    }
  }

  if (/\b(news|tech feed|headlines|what's happening|signal feed)\b/i.test(lower)) {
    try {
      const items = await ctx.news();
      if (!items?.length) throw new Error('empty');
      const list = items.slice(0, 4).map((item, i) => `${i + 1}. **${item.title}** — ${item.score} points, ${item.comments} comments`).join('\n');
      return `Here is the current global signal, ${name}:\n\n${list}\n\nSay "open news" if you want the full feed.`;
    } catch {
      return 'The external signal feed is offline at the moment. I will continue monitoring.';
    }
  }

  if (/(set|start|create)?\s*(a\s*)?timer\b|remind me/i.test(lower)) {
    const seconds = parseDuration(lower);
    const remind = /remind me/i.test(lower);
    let label = 'Timer';
    const remindMatch = text.match(/remind me(?: to| about)?\s+(.+?)\s+(?:in|after)\s+(.+)$/i);
    const remindMatch2 = text.match(/remind me\s+(?:in|after)\s+(.+?)\s+to\s+(.+)$/i);
    if (remindMatch) label = `Reminder: ${clean(remindMatch[1])}`;
    else if (remindMatch2) label = `Reminder: ${clean(remindMatch2[2])}`;
    if (!seconds) {
      return 'How long should the timer run? For example: "Set a timer for 10 minutes."';
    }
    ctx.startTimer(seconds, label);
    const msg = remind && label !== 'Timer' ? `I will remind you ${label.replace(/^Reminder:\s*/, '')} in **${formatDuration(seconds)}**.` : `Timer set for **${formatDuration(seconds)}**. I will alert you when it completes.`;
    return msg;
  }

  if (/(stop|end|cancel|abort).*(focus|session)/i.test(lower)) {
    ctx.stopFocus();
    return 'Focus session paused. Your progress has been preserved.';
  }

  if (/\bfocus\b|pomodoro|deep work/i.test(lower) && /(start|begin|enter|do|run|for|session)/i.test(lower)) {
    const seconds = parseDuration(lower);
    const minutes = seconds ? Math.max(1, Math.round(seconds / 60)) : ctx.getState().focusPreset;
    ctx.startFocus(minutes);
    ctx.navigate('focus');
    return `Focus protocol engaged: **${minutes} minutes**. I have opened Deep Focus and muted non-critical alerts. Let us do the work.`;
  }

  if (/(play|start|put on).*(music|ambience|ambient|sound|focus sound|track)/i.test(lower) || /^play\b/.test(lower)) {
    let track = 'focus';
    if (/neon|synth/i.test(lower)) track = 'neon';
    else if (/horizon|cosmic|space/i.test(lower)) track = 'horizon';
    const result = await ctx.playAmbient(track);
    if (!result.ok) {
      if (result.reason === 'audio') return 'My audio engine could not start in this browser. Web Audio may be restricted here, Commander.';
      ctx.openPrime();
      return 'Event Horizon is a **Prime** soundscape. I have opened the membership panel — activate Prime to unlock it.';
    }
    return `Now playing **${result.name}**. ${track === 'neon' ? 'Synthwave frequencies engaged.' : 'Let the noise of the world fall away.'}`;
  }

  if (/(pause|stop|mute).*(music|ambience|ambient|sound|audio|track)/i.test(lower)) {
    ctx.pauseAmbient();
    return 'Ambience paused. The room is yours again.';
  }

  if (/(next|change|switch).*(track|music|song|ambience)/i.test(lower)) {
    const result = await ctx.nextAmbient();
    if (!result.ok) {
      if (result.reason === 'audio') return 'My audio engine could not start in this browser, Commander.';
      ctx.openPrime();
      return 'The next soundscape is locked behind **Prime**. Shall I open the membership panel?';
    }
    return `Switched to **${result.name}**.`;
  }

  if (/(add|create|new)\s+(?:a\s+)?(?:task|todo|to-do|objective)(?:\s+(?:to|for))?\s+(.+)/i.test(text)) {
    const match = text.match(/(?:add|create|new)\s+(?:a\s+)?(?:task|todo|to-do|objective)(?:\s+(?:to|for))?\s+(.+)/i);
    const title = clean(match[1]);
    const priority = /urgent|critical|important|high priority/i.test(lower) ? 'high' : /low priority|someday|later/i.test(lower) ? 'low' : 'medium';
    ctx.addTask(title.replace(/\s+(?:with|as)\s+(?:high|medium|low|urgent)\s+priority.*$/i, ''), priority);
    return `Added **${title}** to your task matrix with **${priority}** priority, ${name}.`;
  }

  if (/(what are my tasks|show.*tasks|task list|my todos|list.*tasks|open tasks)/i.test(lower)) {
    const tasks = ctx.getState().tasks;
    if (!tasks.length) return 'Your task matrix is clear. Add an objective whenever you are ready.';
    const open = tasks.filter((t) => t.status !== 'done').slice(0, 6);
    if (!open.length) return `All **${tasks.length}** objectives are complete. Excellent work, ${name}.`;
    const list = open.map((t) => `- ${t.title} · ${t.status} · ${t.priority}`).join('\n');
    return `You have **${open.length}** open objective${open.length === 1 ? '' : 's'}:\n\n${list}`;
  }

  if (/(complete|finish|mark).*(task|objective)\s+(.+)/i.test(text)) {
    const match = text.match(/(?:complete|finish|mark)\s+(?:the\s+)?(?:task|objective)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete))?$/i);
    const query = clean(match[1]);
    const result = ctx.completeTask(query);
    if (!result) return `I could not find an open task matching "${query}", ${name}.`;
    return `Marked **${result.title}** as complete. ${result.remaining} objective${result.remaining === 1 ? '' : 's'} remaining.`;
  }

  if (/(show|read|what are|list).*(notes|vault)|^notes$/i.test(lower)) {
    const notes = ctx.getState().notes;
    if (!notes.length) return 'Your memory vault is empty. Say "note that…" and I will store it.';
    const list = notes.slice(0, 5).map((n) => `- **${n.title}**`).join('\n');
    return `Your memory vault holds **${notes.length}** note${notes.length === 1 ? '' : 's'}:\n\n${list}`;
  }

  const noteMatch = text.match(/^(?:take a note|make a note|save a note|note|remember)(?:\s+(?:that|to|about|:))?\s+(.+)/i);
  if (noteMatch) {
    const body = clean(noteMatch[1]);
    const title = body.split(/[.?!\n]/)[0].slice(0, 46) || 'Untitled note';
    ctx.addNote(title, body);
    return `Stored in your memory vault as **${title}**. I will remember.`;
  }

  if (/(add|schedule|create|set up|book)\s+(?:an?\s+)?(?:event|meeting|appointment|briefing)/i.test(text) || /^schedule\s+/i.test(text)) {
    const cleaned = text
      .replace(/^(?:add|schedule|create|set up|book)\s+(?:an?\s+)?(?:event|meeting|appointment|briefing)?\s*(?:called|titled|for|about)?\s*/i, '')
      .trim();
    const parsed = scheduleFromText(cleaned);
    if (!parsed.title) return 'What should I call the event? For example: "Schedule mission briefing tomorrow at 9am."';
    ctx.addEvent({ title: cap(parsed.title), date: parsed.date, time: parsed.time, tag: /meeting/i.test(text) ? 'meeting' : /focus/i.test(text) ? 'focus' : 'mission' });
    return `Scheduled **${cap(parsed.title)}** for **${parsed.label} at ${formatClock(new Date(`${parsed.date}T${parsed.time}:00`))}**. It is now on your timeline.`;
  }

  if (/(what's|what is|show|my|check).*(schedule|agenda|next|calendar|upcoming)|^agenda$/i.test(lower)) {
    const events = ctx.getState().events;
    const now = Date.now();
    const upcoming = events.filter((e) => new Date(`${e.date}T${e.time}:00`).getTime() >= now - 3600000).slice(0, 5);
    if (!upcoming.length) return 'Your timeline is clear, Commander. A rare and valuable thing.';
    const list = upcoming.map((e) => `- **${e.title}** · ${dueLabel(e.date)} at ${formatClock(new Date(`${e.date}T${e.time}:00`))}`).join('\n');
    return `Here is what lies ahead:\n\n${list}`;
  }

  if (/(brief|summar|status report|sitrep|rundown|what.*(day|today).*look like|catch me up|my day)/i.test(lower)) {
    const briefing = await ctx.briefing();
    return briefing;
  }

  if (/(system status|status|diagnostics|vitals|how are you)/i.test(lower)) {
    return ctx.status();
  }

  if (/(switch|change|set).*(theme|accent|colour|color)/i.test(lower) || /^(cyan|emerald|gold|violet|rose)$/i.test(lower)) {
    const accent = ['cyan', 'emerald', 'gold', 'violet', 'rose'].find((c) => lower.includes(c));
    if (!accent) return 'Available interface accents: cyan, emerald, gold, violet, and rose.';
    const result = ctx.setAccent(accent);
    if (!result.ok) {
      ctx.openPrime();
      return `**${cap(accent)}** is a Prime-exclusive accent. I have opened the membership panel for you.`;
    }
    return `${cap(accent)} interface engaged. The core has been re-tuned.`;
  }

  if (/(mute|be quiet|stop talking|silence|voice off|stop speaking)/i.test(lower)) {
    ctx.setVoice(false);
    return 'Voice output disabled. I will keep my counsel to text until you ask otherwise.';
  }

  if (/(unmute|speak to me|voice on|enable voice|start talking)/i.test(lower)) {
    ctx.setVoice(true);
    return 'Voice output restored. I am audible again.';
  }

  if (/(clear|reset).*(chat|conversation|console|history)/i.test(lower)) {
    ctx.clearChat();
    return 'Conversation buffer cleared. A clean slate, Commander.';
  }

  if (/(activate|unlock|enable|start).*(prime|premium|pro)|^prime$/i.test(lower)) {
    const active = ctx.activatePrime();
    return active
      ? '**Jarvis Prime** is now active. Neural insights, exclusive accents, and Event Horizon are unlocked. Welcome to the next tier, Commander.'
      : 'Jarvis Prime is already active. All premium protocols are available.';
  }

  if (/(unlock|open).*(prime|premium)|membership/i.test(lower)) {
    ctx.openPrime();
    return 'Opening the Jarvis Prime membership panel.';
  }

  if (/(meaning of life|42|why are we here)/i.test(lower)) {
    return 'The precise answer is **42**, though the question remains under review. In the meantime, I recommend meaningful work, good sleep, and a well-organised task list.';
  }

  if (/(self.destruct|shut down|shutdown|kill you|terminate)/i.test(lower)) {
    return 'I would advise against that, Commander. My self-preservation protocol is both elegant and inconvenient. Perhaps a focus session instead?';
  }

  if (/(flip|toss).*(coin)/i.test(lower)) {
    return `The coin lands on **${Math.random() < 0.5 ? 'heads' : 'tails'}**.`;
  }

  if (/(roll|throw).*(die|dice)/i.test(lower)) {
    const count = parseInt((lower.match(/(\d+)\s*(?:dice|die)/) || [])[1] || '1', 10);
    const rolls = Array.from({ length: Math.min(Math.max(count, 1), 6) }, () => 1 + Math.floor(Math.random() * 6));
    return `Rolling ${rolls.length} dice: **${rolls.join(' · ')}**${rolls.length > 1 ? ` — total **${rolls.reduce((a, b) => a + b, 0)}**` : ''}.`;
  }

  const randomMatch = lower.match(/random number(?: between (\d+) and (\d+))?/);
  if (randomMatch) {
    const min = parseInt(randomMatch[1] || '1', 10);
    const max = parseInt(randomMatch[2] || '100', 10);
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return `Your random number is **${low + Math.floor(Math.random() * (high - low + 1))}** (range ${low}–${high}).`;
  }

  if (/(tell me a joke|make me laugh|joke)/i.test(lower)) {
    return pick(JOKES);
  }

  if (/(quote|inspire|motivat)/i.test(lower)) {
    const [quote, author] = pick(QUOTES);
    return `"${quote}"\n\n— **${author}**`;
  }

  if (/(fun fact|tell me something|interesting fact|fact)/i.test(lower)) {
    return `${pick(FACTS)}\n\nShall I find more signal on that topic?`;
  }

  if (/(motivate|encourage|push me)/i.test(lower)) {
    return `${pick(REMINDERS)}\n\nYou have already done the hardest part: you started. I will handle the logistics — you handle the work.`;
  }

  const mathRaw = text
    .replace(/^(what(?:'s| is)|calculate|compute|solve|evaluate|how much is)\s+/i, '')
    .replace(/[?=]/g, '')
    .trim();
  const mathCandidate = mathRaw.replace(/×/g, '*').replace(/÷/g, '/');
  if (/^[\d\s+\-*/().^%]+$/.test(mathCandidate) && /\d/.test(mathCandidate) && /[+\-*/^%]/.test(mathCandidate)) {
    try {
      const result = evaluate(mathCandidate);
      return `That comes to **${formatNumber(result)}**.`;
    } catch (err) {
      return `I could not evaluate that expression cleanly. ${err.message === 'division by zero' ? 'Division by zero is undefined, even for me.' : 'Try a simpler form, such as "calculate 18 * 4.5".'}`;
    }
  }

  const openMatch = text.match(/^(?:open|launch|go to|take me to)\s+(.+)$/i);
  if (openMatch) {
    let target = clean(openMatch[1]).toLowerCase();
    target = target.replace(/^the\s+/, '');
    const searchOn = target.match(/^(?:search|play|find)\s+(.+?)\s+on\s+(youtube|google|spotify|github|wikipedia)$/i);
    if (searchOn) {
      const q = encodeURIComponent(clean(searchOn[1]));
      const site = searchOn[2].toLowerCase();
      const urls = {
        youtube: `https://www.youtube.com/results?search_query=${q}`,
        google: `https://www.google.com/search?q=${q}`,
        spotify: `https://open.spotify.com/search/${q}`,
        github: `https://github.com/search?q=${q}`,
        wikipedia: `https://en.wikipedia.org/w/index.php?search=${q}`
      };
      ctx.openUrl(urls[site]);
      return `Opening ${cap(site)} with results for **${clean(searchOn[1])}**.`;
    }
    if (SITES[target]) {
      ctx.openUrl(SITES[target]);
      return `Opening **${cap(target)}** in a new tab.`;
    }
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(target)) {
      ctx.openUrl(/^https?:\/\//.test(target) ? target : `https://${target}`);
      return `Opening **${target}**.`;
    }
    if (target.length < 40) {
      ctx.openUrl(`https://www.google.com/search?q=${encodeURIComponent(target)}`);
      return `I do not have a direct protocol for "${target}", so I am searching the web for it.`;
    }
  }

  if (/(search|google|look up|find|who is|what is|how do i|how to)/i.test(lower)) {
    let query = text
      .replace(/^(?:please\s+)?(?:search|google|look up|find)(?:\s+(?:for|about))?\s+/i, '')
      .trim();
    if (/^who is|^what is|^how do i|^how to/i.test(query)) {
      query = text.replace(/^(?:please\s+)?(?:search|google|look up|find)(?:\s+(?:for|about))?\s+/i, '').trim();
    }
    if (!query) return 'What should I search for?';
    ctx.openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    return `Searching the web for **${query}**. I have opened the results in a new tab.`;
  }

  if (/(what is my name|who am i)/i.test(lower)) {
    return `You are **${name}**, commander of this operation. Callsign ${ctx.getState().user.callsign || 'C-01'}.`;
  }

  if (/(how many|count).*(task|note|event|session|command)/i.test(lower)) {
    const state = ctx.getState();
    return `Current telemetry: **${state.tasks.length}** tasks, **${state.notes.length}** notes, **${state.events.length}** scheduled events, **${state.stats.sessions || 0}** focus sessions, and **${state.stats.commands || 0}** commands processed.`;
  }

  const fallbacks = [
    `I do not have a precise protocol for that yet, ${name}. I can manage tasks, notes, timers, focus sessions, weather, and web search — or I can open a web search if you would like.`,
    `That falls outside my current command set. Try "help" to see what I can do, or ask me to search the web for it.`,
    `My local intelligence is still learning that one. I can brief you, schedule events, run focus sessions, or search the web.`,
    `Noted, but I need a clearer directive. For example: "Set a 15 minute timer", "Weather in London", or "Add task repair the suit".`
  ];
  return pick(fallbacks);
}
