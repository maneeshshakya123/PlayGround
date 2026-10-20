export const TRACKS = {
  focus: {
    id: 'focus',
    name: 'Deep Focus',
    genre: 'Ambient · 60 BPM',
    bpm: 60,
    root: 110,
    scale: [0, 3, 5, 7, 10, 12, 15],
    density: 0.42,
    release: 1.9,
    wave: 'sine',
    filter: 620,
    premium: false
  },
  neon: {
    id: 'neon',
    name: 'Neon Skyline',
    genre: 'Synthwave · 92 BPM',
    bpm: 92,
    root: 82.41,
    scale: [0, 3, 7, 10, 12, 15, 19],
    density: 0.85,
    release: 0.55,
    wave: 'triangle',
    filter: 1350,
    premium: false
  },
  horizon: {
    id: 'horizon',
    name: 'Event Horizon',
    genre: 'Cosmic · 48 BPM',
    bpm: 48,
    root: 73.42,
    scale: [0, 2, 5, 7, 9, 12, 16],
    density: 0.32,
    release: 3.4,
    wave: 'sine',
    filter: 420,
    premium: true
  }
};

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferred = [
    /Daniel/i, /Google UK English Male/i, /Ryan/i, /Guy/i, /Alex/i,
    /Microsoft.*(Guy|Ryan|Christopher)/i, /en-GB/i, /en_US/i, /^en/i
  ];
  for (const test of preferred) {
    const found = voices.find((v) => test.test(v.name) || test.test(v.lang));
    if (found) return found;
  }
  return voices[0];
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.analyser = null;
    this.nodes = [];
    this.scheduler = null;
    this.playing = false;
    this.trackId = 'focus';
    this.volume = 0.45;
    this.onState = () => {};
    this.onSpeak = () => {};
    this.data = null;
    this.voice = null;
  }

  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio unavailable');
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.84;
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.16;
      this.sfxGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  track() {
    return TRACKS[this.trackId] || TRACKS.focus;
  }

  register(...nodes) {
    for (const node of nodes) if (node) this.nodes.push(node);
  }

  cleanup() {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = null;
    }
    for (const node of this.nodes) {
      try { node.stop?.(); } catch {}
      try { node.disconnect?.(); } catch {}
    }
    this.nodes = [];
  }

  makeNoise(ctx) {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  build() {
    const ctx = this.ctx;
    const config = this.track();
    this.cleanup();

    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(this.master);
    this.register(bus);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = config.filter;
    filter.Q.value = 0.8;
    filter.connect(bus);
    this.register(filter);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoGain.gain.value = config.filter * 0.32;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    this.register(lfo, lfoGain);

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.14;
    droneGain.connect(filter);
    this.register(droneGain);

    const ratios = [1, 1.5, 2, 2.997];
    ratios.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 3 ? 'sine' : 'triangle';
      osc.frequency.value = config.root * ratio;
      osc.detune.value = (i - 1.5) * 6;
      gain.gain.value = i === 3 ? 0.12 : 0.22 / (i + 1);
      osc.connect(gain);
      gain.connect(droneGain);
      osc.start();
      this.register(osc, gain);
    });

    const noise = this.makeNoise(ctx);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 780;
    noiseFilter.Q.value = 0.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.05;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start();
    this.register(noise, noiseFilter, noiseGain);

    const delay = ctx.createDelay(1.2);
    delay.delayTime.value = config.id === 'neon' ? 0.31 : 0.52;
    const feedback = ctx.createGain();
    feedback.gain.value = config.id === 'neon' ? 0.34 : 0.24;
    const wet = ctx.createGain();
    wet.gain.value = config.id === 'horizon' ? 0.32 : 0.2;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(this.master);
    this.register(delay, feedback, wet);

    const stepMs = (60000 / config.bpm) / 2;
    let step = 0;
    const scheduleNote = () => {
      if (!this.playing) return;
      step += 1;
      if (Math.random() > config.density) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const noteFilter = ctx.createBiquadFilter();
      const degree = config.scale[Math.floor(Math.random() * config.scale.length)];
      const octave = Math.random() > 0.72 ? 2 : 1;
      osc.type = config.wave;
      osc.frequency.value = config.root * 2 * Math.pow(2, degree / 12) * octave;
      noteFilter.type = 'lowpass';
      noteFilter.frequency.value = config.filter * 2.2;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, now + config.release);
      osc.connect(noteFilter);
      noteFilter.connect(env);
      env.connect(bus);
      env.connect(delay);
      osc.start(now);
      osc.stop(now + config.release + 0.1);
      osc.onended = () => {
        try { osc.disconnect(); noteFilter.disconnect(); env.disconnect(); } catch {}
      };
      this.register(osc, noteFilter, env);
    };

    this.scheduler = setInterval(scheduleNote, stepMs);
    scheduleNote();
  }

  async play(id = this.trackId) {
    if (TRACKS[id]?.premium) throw new Error('prime-required');
    await this.ensure();
    this.trackId = id;
    this.playing = true;
    this.build();
    this.onState({ playing: true, track: this.track() });
    this.sfx('toggle');
  }

  pause() {
    this.cleanup();
    this.playing = false;
    this.onState({ playing: false, track: this.track() });
    this.sfx('toggle');
  }

  async toggle(id = this.trackId) {
    if (this.playing && id === this.trackId) return this.pause();
    return this.play(id);
  }

  async setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value / 100));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.06);
    }
  }

  getLevel() {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteFrequencyData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i += 1) sum += this.data[i];
    return sum / this.data.length / 255;
  }

  getData() {
    if (!this.analyser || !this.data) return null;
    this.analyser.getByteFrequencyData(this.data);
    return this.data;
  }

  tone(freq, when, dur, type = 'sine', gain = 0.5, slide = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    osc.onended = () => {
      try { osc.disconnect(); env.disconnect(); } catch {}
    };
  }

  async sfx(name) {
    try {
      await this.ensure();
    } catch {
      return;
    }
    const map = {
      click: () => this.tone(1180, 0, 0.05, 'sine', 0.3),
      toggle: () => { this.tone(720, 0, 0.06, 'sine', 0.28); this.tone(1080, 0.05, 0.08, 'sine', 0.24); },
      listen: () => { this.tone(880, 0, 0.09, 'sine', 0.3); this.tone(1320, 0.08, 0.12, 'sine', 0.24); },
      success: () => { this.tone(523.25, 0, 0.16, 'sine', 0.32); this.tone(659.25, 0.1, 0.18, 'sine', 0.3); this.tone(783.99, 0.21, 0.3, 'sine', 0.28); },
      error: () => { this.tone(220, 0, 0.16, 'sawtooth', 0.2, 170); this.tone(164, 0.14, 0.22, 'sawtooth', 0.18, 120); },
      timer: () => { this.tone(659.25, 0, 0.2, 'sine', 0.4); this.tone(783.99, 0.18, 0.2, 'sine', 0.36); this.tone(1046.5, 0.36, 0.55, 'sine', 0.3); },
      boot: () => { this.tone(120, 0, 1.4, 'sine', 0.26, 620); this.tone(240, 0.2, 1.2, 'triangle', 0.12, 920); }
    };
    (map[name] || map.click)();
  }

  speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    const clean = String(text)
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/[*_`#>]/g, '')
      .replace(/https?:\/\/\S+/g, 'link')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 650);
    if (!clean) return;
    window.speechSynthesis.cancel();
    if (!this.voice) this.voice = pickVoice();
    const utter = new SpeechSynthesisUtterance(clean);
    if (this.voice) utter.voice = this.voice;
    utter.rate = 1.02;
    utter.pitch = 0.9;
    utter.volume = 1;
    utter.onstart = () => this.onSpeak(true);
    utter.onend = () => this.onSpeak(false);
    utter.onerror = () => this.onSpeak(false);
    window.speechSynthesis.speak(utter);
  }

  stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.onSpeak(false);
  }
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    const engine = window.__jarvisAudio;
    if (engine) engine.voice = pickVoice();
  };
}

export class VoiceInput {
  constructor() {
    this.recognition = null;
    this.listening = false;
    this.continuous = false;
    this.stoppedForSpeech = false;
    this.handlers = {};
    this.restartTimer = null;
    this.unsupported = !(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  get supported() {
    return !this.unsupported;
  }

  start(handlers = {}, { continuous = false } = {}) {
    if (this.unsupported) return false;
    this.handlers = handlers;
    this.continuous = continuous;
    this.listening = true;
    this.stoppedForSpeech = false;
    this.spawn();
    return true;
  }

  spawn() {
    if (!this.listening) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    try { this.recognition?.abort(); } catch {}
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = this.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.recognition = rec;

    rec.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) this.handlers.onPartial?.(interim.trim());
      if (final) this.handlers.onFinal?.(final.trim());
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.listening = false;
        this.handlers.onError?.(event.error);
      }
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.handlers.onError?.(event.error);
    };
    rec.onend = () => {
      if (!this.listening) return;
      if (this.stoppedForSpeech) return;
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => this.spawn(), this.continuous ? 350 : 100);
    };
    try {
      rec.start();
    } catch {
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => this.spawn(), 400);
    }
  }

  pauseForSpeech() {
    if (!this.listening) return;
    this.stoppedForSpeech = true;
    try { this.recognition?.stop(); } catch {}
  }

  resumeAfterSpeech() {
    if (!this.listening) return;
    this.stoppedForSpeech = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.spawn(), 700);
  }

  stop() {
    this.listening = false;
    this.stoppedForSpeech = false;
    clearTimeout(this.restartTimer);
    try { this.recognition?.abort(); } catch {}
    this.recognition = null;
  }
}
