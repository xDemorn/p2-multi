// música y efectos (todo local, no usa la red)
const KEY = "torneo-audio";
const DEFAULTS = { music: 0.4, effects: 0.7, muted: false, musicOn: true };
const FADE_STEP = 0.04; // unos 0,5 s de fundido

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function track(src) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = "none"; // pesan varios MB, se cargan al reproducirse
  audio.volume = 0;
  return audio;
}

const settings = load();
const listeners = new Set();
// menús: tema de fantasía; sala y partida: el más oscuro
const tracks = { menu: track("/assets/audio/menu.mp3"), game: track("/assets/audio/game.mp3") };
const effects = {
  spell: new Audio("/assets/audio/spell.mp3"),
  win: new Audio("/assets/audio/win.mp3"),
  click: new Audio("/assets/audio/click.mp3"),
};
const EFFECT_GAIN = { click: 0.6 }; // el de navegación, algo más bajo

let scene = "menu";
let ducked = false;
let started = false;
let fadeTimer;
let waitingForGesture = false;

const musicAudible =() => started && settings.musicOn && !settings.muted && settings.music > 0;
const targetVolume = (name) => (name === scene && musicAudible() ? settings.music * (ducked ? 0.25 : 1) : 0);

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* not persisted */ }
}

// el navegador no deja sonar nada hasta el primer clic
function tryPlay(audio) {
  audio.play().catch(() => {
    if (waitingForGesture) return;
    waitingForGesture = true;
    const retry = () => {
      waitingForGesture = false;
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      fade();
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
  });
}

// fundido entre pistas; la que se queda en silencio se pausa
function fade() {
  clearInterval(fadeTimer);
  const step = () => {
    let done = true;
    for (const [name, audio] of Object.entries(tracks)) {
      const target = targetVolume(name);
      if (target > 0 && audio.paused) tryPlay(audio);
      const diff = target - audio.volume;
      if (Math.abs(diff) > FADE_STEP) {
        audio.volume = Math.min(1, Math.max(0, audio.volume + Math.sign(diff) * FADE_STEP));
        done = false;
      } else {
        audio.volume = target;
        if (target === 0 && !audio.paused) audio.pause();
      }
    }
    if (done) clearInterval(fadeTimer);
  };
  step();
  fadeTimer = setInterval(step, 50);
}

function changed() {
  fade();
  listeners.forEach((listener) => listener({ ...settings }));
}

export const audio = {
  settings: () => ({ ...settings }),

  set(changes) {
    Object.assign(settings, changes);
    save();
    changed();
  },

  onChange(listener) {
    listeners.add(listener);
    listener({ ...settings });
  },

  // la música empieza con el primer clic o tecla
  start() {
    started = true;
    fade();
  },

  // "menu" o "game"
  setScene(name) {
    if (scene === name) return;
    scene = name;
    if (name === "game") tracks.game.currentTime = 0; // la de partida empieza desde el principio
    fade();
  },

  play(name) {
    if (settings.muted || settings.effects <= 0) return;
    // clonamos para que se puedan solapar
    const sound = effects[name].cloneNode();
    sound.volume = settings.effects * (EFFECT_GAIN[name] ?? 1);
    sound.play().catch(() => {});
    // click.mp3 dura 8 s pero solo suena el primero
    if (name === "click") setTimeout(() => sound.pause(), 1200);
  },

  // baja la música mientras suena la victoria
  duckFor(ms) {
    ducked = true;
    fade();
    setTimeout(() => {
      ducked = false;
      fade();
    }, ms);
  },
};
