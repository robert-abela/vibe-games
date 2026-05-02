// ----------------------------
// Pick-a-Number Challenge Game
// Vanilla JS only
// Features:
// - Confetti (canvas)
// - Sound effects (Web Audio API)
// - Name input personalization
// - ALWAYS-ON No Repeats (numbers disable after pick)
// - Shuffle challenges on start so SAFE moves around
// ----------------------------

// ---- DOM ----
const steps = {
  start: document.getElementById("stepStart"),
  name: document.getElementById("stepName"),
  choose: document.getElementById("stepChoose"),
  numbers: document.getElementById("stepNumbers"),
  result: document.getElementById("stepResult")
};

const btnStart = document.getElementById("btnStart");
const btnSoundToggle = document.getElementById("btnSoundToggle");

const playerNameInput = document.getElementById("playerName");
const btnNameNext = document.getElementById("btnNameNext");

const btnBoy = document.getElementById("btnBoy");
const btnGirl = document.getElementById("btnGirl");

const btnResetNumbers = document.getElementById("btnResetNumbers");
const btnBackToChoose = document.getElementById("btnBackToChoose");
const btnAnother = document.getElementById("btnAnother");
const btnRestart = document.getElementById("btnRestart");

const numberGrid = document.getElementById("numberGrid");

const resultEmoji = document.getElementById("resultEmoji");
const resultText = document.getElementById("resultText");
const pickedInfo = document.getElementById("pickedInfo");
const repeatInfo = document.getElementById("repeatInfo");
const resultTitle = document.getElementById("resultTitle");

const chooseTitle = document.getElementById("chooseTitle");
const numbersTitle = document.getElementById("numbersTitle");

// ---- Challenges (base) ----
// We'll SHUFFLE a copy of these at game start.
const baseChallengesForBoys = [
  "🛡️ SAFE! No challenge — {name}, give a big smile and continue!",
  "🐸 Do 5 tiny frog jumps.",
  "🎈 Take 3 deep breaths like you’re blowing up a balloon.",
  "🦁 Make your best animal sound (any animal!).",
  "🧠 Spell your first name out loud.",
  "🛡️ SAFE! No challenge — {name}, do a little victory pose!",
  "🤹 Pretend to juggle 5 invisible balls.",
  "🕺 Do a 10‑second silly dance.",
  "🧍 Stand like a statue for 8 seconds (no laughing!).",
  "👏 Clap a rhythm: clap‑clap… pause… clap!"
];

const baseChallengesForGirls = [
  "🛡️ SAFE! No challenge — {name}, give a big smile and continue!",
  "🐰 Hop on one foot for 10 seconds (switch feet if you want).",
  "🎈 Take 3 deep breaths like you’re blowing up a balloon.",
  "🐵 Make your best animal sound (any animal!).",
  "🧠 Spell your first name out loud.",
  "🛡️ SAFE! No challenge — {name}, do a little victory pose!",
  "🎭 Make a funny face for 5 seconds.",
  "🕺 Do a 10‑second silly dance.",
  "🧍 Stand like a statue for 8 seconds (no laughing!).",
  "👏 Clap a rhythm: clap‑clap… pause… clap!"
];

// ---- State ----
let selectedGroup = null;          // "boy" | "girl"
let playerName = "";
let pickedSet = new Set();         // ALWAYS-ON no repeats
let soundOn = true;

// Shuffled challenge lists used for the current game session
let challengesForBoys = [];
let challengesForGirls = [];

// ---- Step helper ----
function showStep(which){
  Object.values(steps).forEach(s => s.classList.add("hidden"));
  steps[which].classList.remove("hidden");
}

// ----------------------------
// SOUND EFFECTS (Web Audio)
// ----------------------------
let audioCtx = null;

function ensureAudio(){
  if (!soundOn) return;
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended"){
    audioCtx.resume().catch(() => {});
  }
}

function beep(freq = 440, duration = 0.08, type = "sine", volume = 0.12){
  if (!soundOn) return;
  ensureAudio();
  if (!audioCtx) return;

  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  o.type = type;
  o.frequency.value = freq;
  g.gain.value = volume;

  o.connect(g);
  g.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  o.start(now);
  o.stop(now + duration);
}

function soundClick(){ beep(660, 0.05, "square", 0.06); }
function soundGood(){
  beep(523.25, 0.07, "sine", 0.12);
  setTimeout(() => beep(659.25, 0.09, "sine", 0.12), 80);
}
function soundSafe(){
  beep(784, 0.06, "triangle", 0.10);
  setTimeout(() => beep(988, 0.08, "triangle", 0.10), 70);
}

function setSoundButtonLabel(){
  btnSoundToggle.textContent = soundOn ? "🔊 Sound: ON" : "🔇 Sound: OFF";
}

// ----------------------------
// CONFETTI (Canvas)
// ----------------------------
const canvas = document.getElementById("confettiCanvas");
const ctx = canvas.getContext("2d");

let confettiParticles = [];
let confettiRunning = false;
let confettiRaf = null;

function resizeCanvas(){
  canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}
window.addEventListener("resize", resizeCanvas);

function confettiBurst(amount = 80){
  resizeCanvas();

  const colors = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#a855f7","#ec4899"];
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.25;

  for (let i = 0; i < amount; i++){
    confettiParticles.push({
      x: cx + rand(-40, 40),
      y: cy + rand(-10, 10),
      vx: rand(-4.5, 4.5),
      vy: rand(-9.5, -4.5),
      g: rand(0.18, 0.32),
      size: rand(6, 10),
      rot: rand(0, Math.PI),
      vr: rand(-0.15, 0.15),
      color: colors[Math.floor(Math.random() * colors.length)],
      life: rand(60, 105)
    });
  }

  if (!confettiRunning){
    confettiRunning = true;
    animateConfetti();
  }
}

function animateConfetti(){
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  confettiParticles = confettiParticles.filter(p => p.life > 0);

  for (const p of confettiParticles){
    p.life--;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.g;
    p.rot += p.vr;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
    ctx.restore();
  }

  if (confettiParticles.length > 0){
    confettiRaf = requestAnimationFrame(animateConfetti);
  } else {
    confettiRunning = false;
    if (confettiRaf) cancelAnimationFrame(confettiRaf);
  }
}

function rand(min, max){ return Math.random() * (max - min) + min; }

// ----------------------------
// ALWAYS-ON NO REPEATS
// ----------------------------
function resetPickedNumbers(){
  pickedSet = new Set();
  updateNumberButtonsDisabled();
  repeatInfo.textContent = "";
}

function updateNumberButtonsDisabled(){
  const buttons = numberGrid.querySelectorAll("button.numBtn");
  buttons.forEach(btn => {
    const n = Number(btn.dataset.n);
    btn.disabled = pickedSet.has(n);
  });
}

function allNumbersUsed(){
  return pickedSet.size >= 10;
}

// ----------------------------
// Randomize challenges at Start
// ----------------------------
// Fisher–Yates shuffle (in-place)
function shuffleArray(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleChallengesForNewGame(){
  // Make copies then shuffle so SAFE positions move around
  challengesForBoys = shuffleArray([...baseChallengesForBoys]);
  challengesForGirls = shuffleArray([...baseChallengesForGirls]);
}

// ----------------------------
// Game flow helpers
// ----------------------------
function getChallengeList(){
  return selectedGroup === "boy" ? challengesForBoys : challengesForGirls;
}

function niceName(){
  const trimmed = (playerName || "").trim();
  return trimmed.length ? trimmed : "friend";
}

function personalize(text){
  return text.replaceAll("{name}", niceName());
}

function buildNumberButtons(){
  numberGrid.innerHTML = "";
  for (let i = 1; i <= 10; i++){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "numBtn";
    btn.textContent = String(i);
    btn.dataset.n = String(i);
    btn.setAttribute("aria-label", `Pick number ${i}`);
    btn.addEventListener("click", () => pickNumber(i));
    numberGrid.appendChild(btn);
  }
}

function setPersonalTitles(){
  const namePart = niceName();
  chooseTitle.textContent = `Hi ${namePart}! Are you a boy or a girl?`;
  numbersTitle.textContent = `${namePart}, pick a number!`;
}

function pickNumber(n){
  soundClick();

  // ALWAYS no repeats: block if already used
  if (pickedSet.has(n)){
    resultTitle.textContent = "Oops!";
    resultEmoji.textContent = "🙂";
    resultText.textContent = "That number was already used. Try a different one!";
    showStep("result");
    return;
  }

  pickedSet.add(n);
  updateNumberButtonsDisabled();

  const list = getChallengeList();
  const raw = list[n - 1] || "✨ Oops! That number has no challenge yet.";
  const challenge = personalize(raw);

  const isSafe = challenge.startsWith("🛡️");
  resultEmoji.textContent = isSafe ? "🛡️" : "⭐";
  resultTitle.textContent = isSafe ? "Safe Pick!" : "Your Challenge!";
  resultText.textContent = challenge;

  const groupLabel = selectedGroup === "boy" ? "Boy" : "Girl";
  pickedInfo.textContent = `You chose: ${groupLabel} • Number: ${n}`;

  const remaining = 10 - pickedSet.size;
  repeatInfo.textContent = `Numbers left: ${remaining}`;

  if (isSafe){
    confettiBurst(140);
    soundSafe();
  } else {
    confettiBurst(80);
    soundGood();
  }

  // If all used, auto-reset AND reshuffle for a new round
  if (allNumbersUsed()){
    setTimeout(() => {
      resetPickedNumbers();
      shuffleChallengesForNewGame();
      repeatInfo.textContent = "All numbers were used — I reset and mixed them again! ♻🎲";
    }, 900);
  }

  showStep("result");
}

// ----------------------------
// Events
// ----------------------------
btnSoundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  setSoundButtonLabel();
  soundClick();
});

btnStart.addEventListener("click", () => {
  ensureAudio();
  soundClick();

  // NEW: shuffle challenges at the beginning of a game
  shuffleChallengesForNewGame();

  // Also reset numbers so it's always fresh
  resetPickedNumbers();

  showStep("name");
  setTimeout(() => playerNameInput.focus(), 50);
});

btnNameNext.addEventListener("click", () => {
  ensureAudio();
  soundClick();
  playerName = playerNameInput.value.trim();
  setPersonalTitles();
  showStep("choose");
});

playerNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnNameNext.click();
});

btnBoy.addEventListener("click", () => {
  ensureAudio();
  soundClick();
  selectedGroup = "boy";
  showStep("numbers");
});

btnGirl.addEventListener("click", () => {
  ensureAudio();
  soundClick();
  selectedGroup = "girl";
  showStep("numbers");
});

btnBackToChoose.addEventListener("click", () => {
  soundClick();
  selectedGroup = null;
  showStep("choose");
});

btnAnother.addEventListener("click", () => {
  soundClick();
  showStep("numbers");
});

btnRestart.addEventListener("click", () => {
  soundClick();
  selectedGroup = null;
  playerName = "";
  playerNameInput.value = "";

  // Fresh start means fresh shuffle + fresh numbers
  shuffleChallengesForNewGame();
  resetPickedNumbers();

  showStep("start");
});

btnResetNumbers.addEventListener("click", () => {
  soundClick();
  resetPickedNumbers();

  // Also reshuffle when resetting numbers (so SAFE moves again)
  shuffleChallengesForNewGame();

  confettiBurst(40);
  soundSafe();
});

// ----------------------------
// Init
// ----------------------------
resizeCanvas();
buildNumberButtons();
shuffleChallengesForNewGame(); // first load
resetPickedNumbers();
setSoundButtonLabel();
showStep("start");