(() => {
  // ---------- Canvas ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // ---------- UI ----------
  const levelPill = document.getElementById("levelPill");
  const goalPill = document.getElementById("goalPill");
  const distancePill = document.getElementById("distancePill");
  const startBtn = document.getElementById("startBtn");

  // ---------- Colors ----------
  const ROAD_COLOR = "#3a3a3a";

  // ---------- Sound (WebAudio) ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) 
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") 
      audioCtx.resume();
  }
  function beep(freq=440, dur=0.08, type="sine", vol=0.06) {
    if (!audioCtx || audioCtx.state !== "running") 
      return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; 
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); 
    g.connect(audioCtx.destination);
    o.start(t0); 
    o.stop(t0 + dur + 0.02);
  }
  function jingle() {
    const notes = [659, 784, 988, 784, 880];
    notes.forEach((f, i) => setTimeout(() => beep(f, 0.11, "triangle", 0.07), i * 120));
  }
  function crashSound() {
    [220, 180, 140].forEach((f, i) => setTimeout(() => beep(f, 0.12, "sawtooth", 0.05), i * 85));
  }

  // Continuous siren while police present
  const siren = { osc:null, gain:null, on:false, t:0 };
  function startSiren() {
    if (!audioCtx || audioCtx.state !== "running" || siren.on) 
      return;

    siren.on = true; 
    siren.t = 0;
    siren.osc = audioCtx.createOscillator();
    siren.gain = audioCtx.createGain();
    siren.osc.type = "square";
    siren.gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    siren.gain.gain.linearRampToValueAtTime(0.020, audioCtx.currentTime + 0.06);
    siren.osc.connect(siren.gain);
    siren.gain.connect(audioCtx.destination);
    siren.osc.start();
  }
  function stopSiren() {
    if (!siren.on) 
      return;
    siren.on = false;
    if (audioCtx && siren.gain) {
      siren.gain.gain.cancelScheduledValues(audioCtx.currentTime);
      siren.gain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.10);
    }
    if (siren.osc) {
      const o = siren.osc;
      setTimeout(() => { try { o.stop(); } catch(e) {} }, 140);
    }
    siren.osc = null; siren.gain = null;
  }
  function updateSiren(dt) {
    if (!siren.on || !audioCtx || audioCtx.state !== "running" || !siren.osc) 
      return;

    siren.t += dt;
    const base = 520, span = 260;
    const w = (Math.sin(siren.t * 6.0) + 1) / 2;
    siren.osc.frequency.setValueAtTime(base + span * w, audioCtx.currentTime);
    const trem = 0.024 + 0.010 * ((Math.sin(siren.t * 24) + 1) / 2);
    siren.gain.gain.setValueAtTime(trem, audioCtx.currentTime);
  }

  // ---------- Game Layout ----------
  const LANES = 4; // ✅ 4 lanes now
  const road = { x: 95, y: 0, w: 290, h: H }; // slightly wider so lanes don’t feel cramped

  function laneCenter(laneIndex) {
    const laneW = road.w / LANES;
    return road.x + laneW * (laneIndex + 0.5);
  }

  const levels = [
    { name: "Level 1", goal: "Anne",     exitSide: "right", baseSpeed: 220, distanceTarget: 1200*5, carEvery: 900, policeChance: 0.10, greetSeconds: 6.5 },
    { name: "Level 2", goal: "Marianne", exitSide: "left",  baseSpeed: 240, distanceTarget: 1400*5, carEvery: 850, policeChance: 0.13, greetSeconds: 7.0 },
    { name: "Level 3", goal: "Home",     exitSide: "right", baseSpeed: 260, distanceTarget: 1600*5, carEvery: 820, policeChance: 0.16, greetSeconds: 5.0 },
  ];

  // ---------- State ----------
  let state = "title"; // title | playing | greet | gameover
  let levelIndex = 0;
  let lastCrashType = "car"; // "car" | "police"

  const player = {
    lane: 1, // starts near middle-left
    x: laneCenter(1),
    y: H - 110,
    w: 54,
    h: 72,
    cooldown: 0
  };

  let obstacles = [];
  let stripesY = 0;
  let distance = 0;
  let spawnTimer = 0;
  let exitActive = false;
  let missedExitMessageTimer = 0;
  let missedExitLatched = false;   // only true AFTER the exit is actually missed
  let greetElapsed = 0;

  // ---------- Input ----------
  const keys = { left:false, right:false };
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") 
      keys.left = true;
    if (e.key === "ArrowRight") 
      keys.right = true;

    // Space starts/restarts
    if (e.code === "Space") {
      e.preventDefault();          // stops page scrolling
      ensureAudio();               // unlocks sound on first press
      if (state === "title") {
        resetLevel(0, false);      // start from level 1
      } else if (state === "gameover") {
        resetLevel(levelIndex, true); // restart current level
      }
    }

    if (["ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault();
  }, { passive:false });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") 
      keys.left = false;
    if (e.key === "ArrowRight") 
      keys.right = false;
  });

  // ---------- Helpers ----------
  function clamp(v, a, b) { 
    return Math.max(a, Math.min(b, v)); 
  }
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
  }
  function fillRoundRect(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    roundRectPath(x, y, w, h, r);
    ctx.fill();
  }

  function resetLevel(i, keepLevel=true) {
    if (!keepLevel) 
      levelIndex = i;
    const lvl = levels[levelIndex];
    state = "playing";
    distance = 0;
    spawnTimer = 0;
    obstacles = [];
    stripesY = 0;
    exitActive = false;
    missedExitMessageTimer = 0;
    greetElapsed = 0;

    player.lane = 1;
    player.x = laneCenter(player.lane);
    player.cooldown = 0;

    stopSiren();

    levelPill.textContent = lvl.name;
    goalPill.textContent = "Goal: " + lvl.goal;
    distancePill.textContent = "Progress: 0%";
  }

  function nextLevelOrWin() {
    jingle();
    state = "greet";
    greetElapsed = 0;
  }

  function advanceAfterGreet() {
    levelIndex++;
    if (levelIndex >= levels.length) 
      levelIndex = 0;
    resetLevel(levelIndex, true);
  }

  function gameOver(crashType) {
    lastCrashType = crashType || "car";
    crashSound();
    stopSiren();
    state = "gameover";
  }

  // ---------- Spawning ----------
  function spawnObstacle(lvl, speed) {
    let lane = Math.floor(Math.random() * LANES);
    const last = obstacles[obstacles.length - 1];
    if (last && last.lane === lane && last.y < 150) 
      lane = (lane + 1) % LANES;

    const isPolice = Math.random() < lvl.policeChance && distance > 260;
    const w = 46, h = 74;

    obstacles.push({
      type: isPolice ? "police" : "car",
      lane,
      x: laneCenter(lane) - w/2,
      y: -h - 10,
      w, h,
      speed: speed * (0.85 + Math.random()*0.25),
      color: isPolice ? "#2f6bff" : ["#ffd166","#06d6a0","#a78bfa","#f59e0b"][Math.floor(Math.random()*4)],
      flash: 0
    });

    if (isPolice) beep(880, 0.05, "square", 0.03);
  }

  // ---------- Drawing ----------
  function drawBackground() {
    ctx.fillStyle = "#cfefff";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#6fd36f";
    ctx.fillRect(0,0,road.x, H);
    ctx.fillRect(road.x + road.w,0, W-(road.x+road.w), H);

    // simple trees
    for (let i=0;i<6;i++) {
      let x = 20 + (i%2)*55;
      drawTree(x, 0, i);    //left side
      drawTree(W-x, 20, i); //right side
    }
  }

  function drawTree(x, y_offset, i) {
      const y = y_offset + 40 + i*95;
      ctx.fillStyle = "#2e7d32";
      ctx.beginPath(); 
      ctx.arc(x,y,18,0,Math.PI*2); 
      ctx.fill();
      ctx.fillStyle = "#8d5a3b";
      ctx.fillRect(x-4,y+14,8,18);
  }

  function drawRoad(lvl, speed, dt) {
    ctx.fillStyle = ROAD_COLOR;
    ctx.fillRect(road.x, road.y, road.w, road.h);

    // faint lane separators
    const laneW = road.w / LANES;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let i=1;i<LANES;i+=2) { //1,3
      ctx.beginPath();
      ctx.moveTo(road.x + laneW*i, 0);
      ctx.lineTo(road.x + laneW*i, H);
      ctx.stroke();
    }

    // center dashes
    stripesY += speed * dt;
    stripesY %= 60;
    ctx.fillStyle = "#f2f2f2";
    for (let y = -60; y < H + 60; y += 60) {
      const yy = y + stripesY;
      const cx = road.x + road.w/2;
      ctx.fillRect(cx - 4, yy, 8, 28);
    }

    if (exitActive) {
      const signX = lvl.exitSide === "right" ? road.x + road.w + 10 : 10;
      const arrow = lvl.exitSide === "right" ? "→" : "←";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(signX, 44, 120, 70);
      ctx.fillStyle = "#111";
      ctx.font = "bold 18px system-ui";
      ctx.fillText("EXIT " + arrow, signX + 12, 72);
      ctx.font = "bold 14px system-ui";
      ctx.fillText(lvl.goal, signX + 12, 96);

      // upward-pointing ramp
      ctx.fillStyle = "#2f2f2f";
      ctx.beginPath();
      if (lvl.exitSide === "right") {
        ctx.moveTo(road.x + road.w, 260);
        ctx.lineTo(W, 170);
        ctx.lineTo(W, 0);
        ctx.lineTo(road.x + road.w, 0);
      } else {
        ctx.moveTo(road.x, 260);
        ctx.lineTo(0, 170);
        ctx.lineTo(0, 0);
        ctx.lineTo(road.x, 0);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // rider: round shapes, no phallic silhouette
  function drawPlayer() {
    const px = player.x;
    const py = player.y;

    // scooter deck (vertical pill)
    fillRoundRect(px - 14, py - 28, 28, 60, 12, "#4b5563");

    // wheels (top/bottom)
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(px, py - 24, 10, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py + 26, 10, 0, Math.PI*2); ctx.fill();

    // deck stripe
    fillRoundRect(px - 6, py - 10, 12, 28, 6, "#9ca3af");

    // body (oval)
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath(); ctx.ellipse(px, py + 2, 14, 18, 0, 0, Math.PI*2); ctx.fill();

    // head (circle)
    ctx.fillStyle = "#ffd6a5";
    ctx.beginPath(); ctx.arc(px, py - 16, 12, 0, Math.PI*2); ctx.fill();

    // helmet (top half)
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.arc(px, py - 18, 13, Math.PI, 0);
    ctx.closePath();
    ctx.fill();

    // tiny arms (top-down look)
    ctx.strokeStyle = "#ffd6a5";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(px - 10, py - 1);
    ctx.lineTo(px - 18, py + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 10, py - 1);
    ctx.lineTo(px + 18, py + 8);
    ctx.stroke();

    // backpack (small rounded square)
    fillRoundRect(px - 18, py + 10, 12, 14, 5, "#60a5fa");
  }

  function drawObstacle(o) {
    const x = o.x, y = o.y, w = o.w, h = o.h;

    // Car body (rounded rectangle)
    fillRoundRect(x, y, w, h, 10, o.color);

    // Windows
    fillRoundRect(x + 7, y + 12, w - 14, 18, 8, "rgba(255,255,255,0.70)");

    // Bumpers (simple detail, kid-friendly)
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x + 8, y + 5,  w - 16, 4);
    ctx.fillRect(x + 8, y + h - 9, w - 16, 4);

    // Tiny headlights/taillights
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(x + 6, y + 8, 6, 8);
    ctx.fillRect(x + w - 12, y + 8, 6, 8);

    // Police extras stay (lights + badge)
    if (o.type === "police") {
      o.flash += 0.28;
      const on = Math.sin(o.flash) > 0;

      // Flashing light bar
      ctx.fillStyle = on ? "#ff2d2d" : "#2d7bff";
      ctx.fillRect(x + w/2 - 10, y + 2, 20, 8);

      // Badge dot
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(x + w/2, y + h/2 + 10, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawOverlayText(lines, sublines=[]) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0,0,W,H);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "900 42px system-ui";
    ctx.fillText(lines[0], W/2, 210);

    if (lines[1]) {
      ctx.font = "800 28px system-ui";
      ctx.fillText(lines[1], W/2, 258);
    }

    ctx.font = "700 18px system-ui";
    let y = 310;
    sublines.forEach(s => { ctx.fillText(s, W/2, y); y += 26; });

    ctx.textAlign = "start";
  }

  // ---------- Game Over Props ----------
  function drawAmbulance(x, y) {
    fillRoundRect(x, y, 170, 70, 14, "rgba(255,255,255,0.95)");
    fillRoundRect(x, y+30, 170, 12, 6, "#ef4444");
    fillRoundRect(x+18, y+14, 44, 18, 6, "rgba(96,165,250,0.8)");
    fillRoundRect(x+70, y+14, 28, 18, 6, "rgba(96,165,250,0.8)");
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(x+122, y+18, 10, 34);
    ctx.fillRect(x+110, y+30, 34, 10);
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(x+40, y+72, 12, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x+130, y+72, 12, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(x+76, y-6, 18, 10);
  }

  function drawJail(x, y) {
    fillRoundRect(x, y, 180, 160, 16, "rgba(148,163,184,0.95)");
    ctx.fillStyle = "rgba(71,85,105,0.95)";
    ctx.beginPath();
    ctx.moveTo(x+18, y+20);
    ctx.lineTo(x+90, y-18);
    ctx.lineTo(x+162, y+20);
    ctx.closePath();
    ctx.fill();
    fillRoundRect(x+72, y+86, 36, 60, 10, "rgba(51,65,85,0.95)");
    fillRoundRect(x+32, y+60, 44, 30, 8, "rgba(203,213,225,0.95)");
    ctx.strokeStyle = "rgba(30,41,59,0.95)";
    ctx.lineWidth = 3;
    for (let i=0;i<5;i++) {
      const xx = x+38+i*8;
      ctx.beginPath(); ctx.moveTo(xx, y+62); ctx.lineTo(xx, y+88); ctx.stroke();
    }
    fillRoundRect(x+52, y+30, 76, 22, 8, "rgba(15,23,42,0.95)");
    ctx.fillStyle = "#fff";
    ctx.font = "900 14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("JAIL", x+90, y+46);
    ctx.textAlign = "start";
  }

  // ---------- Greeting ----------
  function drawHeart(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - s, y - s, x - 2*s, y + s/3, x, y + 1.6*s);
    ctx.bezierCurveTo(x + 2*s, y + s/3, x + s, y - s, x, y);
    ctx.fill();
  }

  function drawGreeting(lvl, t) {
    ctx.fillStyle = "#cfefff";
    ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#6fd36f";
    ctx.fillRect(0, H-220, W, 220);

    ctx.fillStyle = "#8c8c8c";
    ctx.fillRect(W/2 - 45, H-220, 90, 220);

    const isHome = lvl.goal === "Home";
    ctx.fillStyle = isHome ? "#ffcc4d" : "#f7a8b8";
    ctx.fillRect(150, 230, 180, 160);

    ctx.fillStyle = "#d45d5d";
    ctx.beginPath();
    ctx.moveTo(140, 230);
    ctx.lineTo(240, 170);
    ctx.lineTo(340, 230);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#8d5a3b";
    ctx.fillRect(230, 320, 40, 70);

    // rider rolls up (mini bird’s-eye)
    const arrive = clamp(t / 2.2, 0, 1);
    const px = W/2;
    const py = (H - 60) - arrive * 190;

    // mini deck + wheels
    fillRoundRect(px - 10, py - 20, 20, 44, 10, "#4b5563");
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(px, py - 16, 7, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py + 20, 7, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#ffd6a5";
    ctx.beginPath(); ctx.arc(px, py - 6, 9, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#22c55e";
    ctx.beginPath(); ctx.arc(px, py - 7, 10, Math.PI, 0); ctx.closePath(); ctx.fill();

    // grandma wave
    const grandmaName = lvl.goal;
    const sway = Math.sin(t*1.8) * 10;
    const gx = 240 + sway;
    const gy = 308;

    ctx.fillStyle = isHome ? "#2563eb" : "#7c3aed";
    ctx.fillRect(gx-10, gy, 20, 30);
    ctx.fillStyle = "#ffd6a5";
    ctx.beginPath(); ctx.arc(gx, gy-10, 12, 0, Math.PI*2); ctx.fill();

    const wave = Math.sin(t*5.0);
    ctx.strokeStyle = "#ffd6a5";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(gx+8, gy+8);
    ctx.lineTo(gx + 26, gy - 2 - wave*10);
    ctx.stroke();

    if (arrive > 0.85) {
      for (let i=0;i<6;i++) {
        const x = 120 + i*60;
        const y = 120 + (i%2)*25 + Math.sin(t*2 + i)*6;
        ctx.fillStyle = ["#ff4d6d","#ff8fab","#ffd166"][i%3];
        drawHeart(x, y, 15);
      }
    }

    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.font = "900 40px system-ui";
    ctx.fillText("Hello!", W/2, 86);
    ctx.font = "800 26px system-ui";
    ctx.fillText(isHome ? "Welcome Home!" : ("Hi GrandMa " + grandmaName + "!"), W/2, 126);
    ctx.font = "700 18px system-ui";
    ctx.fillText("So happy to see you 👋", W/2, 160);
    ctx.textAlign = "start";
  }

  // ---------- Main Loop ----------
  let lastTs = performance.now();
  function tick(ts) {
    if (state !== "playing") 
      stopSiren();

    const dt = Math.min(0.033, (ts - lastTs) / 1000);
    lastTs = ts;

    ctx.clearRect(0,0,W,H);

    const lvl = levels[levelIndex];
    const ramp = Math.min(140, distance * 0.02);
    const speed = lvl.baseSpeed + ramp;

    if (state === "title") {
      drawBackground();
      drawRoad(lvl, 140, dt);
      drawPlayer();
      drawOverlayText(
        ["Bike Around", "Visit your GrandMa!"],
        ["Avoid hitting cars & police", "Take the exits to visit GrandMas", " ", "Use ⬅️ ➡️ to change lanes", "Use [Space] to start"]
      );
      requestAnimationFrame(tick);
      return;
    }

    if (state === "greet") {
      stopSiren();
      greetElapsed += dt;
      drawGreeting(lvl, greetElapsed);
      if (greetElapsed >= lvl.greetSeconds) 
        advanceAfterGreet();
      requestAnimationFrame(tick);
      return;
    }

    if (state === "gameover") {
      drawBackground();
      drawRoad(lvl, 140, dt);
      obstacles.forEach(drawObstacle);
      drawPlayer();

      const crashTitle = (lastCrashType === "police") ? "Police crash!" : "Car crash!";
      const crashSub   = (lastCrashType === "police") ? "Jail time (game over)" : "Ambulance is here!";
      drawOverlayText(["Oh no!", crashTitle], [crashSub, "Press [Space] to try again"]);

      if (lastCrashType === "police") 
        drawJail(W/2 - 90, 360);
      else 
        drawAmbulance(W/2 - 85, 390);

      requestAnimationFrame(tick);
      return;
    }

    // ---------- Playing ----------
    distance += speed * dt;
    const pct = Math.floor((distance / lvl.distanceTarget) * 100);
    distancePill.textContent = "Progress: " +clamp(pct, 0, 100) + "%";

    const exitStartsAt = lvl.distanceTarget - 420;
    if (distance >= exitStartsAt) 
      exitActive = true;
    if (missedExitMessageTimer > 0) {
      missedExitMessageTimer -= dt;
      if (missedExitMessageTimer <= 0) {
        missedExitMessageTimer = 0;
        missedExitLatched = false;  // unlock once message duration ends
      }
    }
    // lane change (kid-friendly cooldown)
    player.cooldown -= dt;
    if (player.cooldown < 0) 
      player.cooldown = 0;

    if (player.cooldown === 0) {
      if (keys.left) {
        const old = player.lane;
        player.lane = clamp(player.lane - 1, 0, LANES-1);
        if (player.lane !== old) { beep(520, 0.05, "triangle", 0.05); player.cooldown = 0.14; }
      } else if (keys.right) {
        const old = player.lane;
        player.lane = clamp(player.lane + 1, 0, LANES-1);
        if (player.lane !== old) { beep(520, 0.05, "triangle", 0.05); player.cooldown = 0.14; }
      }
    }

    const targetX = laneCenter(player.lane);
    player.x += (targetX - player.x) * Math.min(1, dt * 12);

    // spawn obstacles
    spawnTimer += dt * 1000;
    if (spawnTimer >= lvl.carEvery) {
      spawnTimer = 0;
      if (!(exitActive && distance > lvl.distanceTarget - 160)) 
        spawnObstacle(lvl, speed);
    }

    // move obstacles
    obstacles.forEach(o => { o.y += o.speed * dt; });
    obstacles = obstacles.filter(o => o.y < H + 140);

    // siren management
    const policePresent = obstacles.some(o => o.type === "police");
    if (policePresent) 
      startSiren(); 
    else 
      stopSiren();
    updateSiren(dt);

    // collisions (slightly smaller hitbox for top-down sprite)
    const hitbox = {
      x: player.x - 16,
      y: player.y - 26,
      w: 32,
      h: 52
    };

    for (const o of obstacles) {
      const ob = { x:o.x+6, y:o.y+8, w:o.w-12, h:o.h-16 };
      if (rectsOverlap(hitbox, ob)) {
        gameOver(o.type);
        break;
      }
    }

    // draw world
    drawBackground();
    drawRoad(lvl, speed, dt);
    obstacles.forEach(drawObstacle);
    drawPlayer();

    // exit logic (4 lanes => leftmost lane 0, rightmost lane 3)
    if (exitActive) {
      const requiredLane = (lvl.exitSide === "right") ? (LANES-1) : 0;

      ctx.fillStyle = "rgba(255,255,255,0.87)";
      ctx.fillRect(road.x, 10, road.w, 34);
      ctx.fillStyle = "#111";
      ctx.font = "900 18px system-ui";
      const arrow = (lvl.exitSide === "right") ? "→" : "←";
      ctx.fillText("EXIT " + arrow + " to " + lvl.goal + "!", road.x + 12, 34);

      // highlight required lane near top (because ramp is up)
      ctx.fillStyle = "rgba(255, 204, 77, 0.22)";
      const laneW = road.w / LANES;
      ctx.fillRect(road.x + laneW*requiredLane, 0, laneW, 260);

      if (distance >= lvl.distanceTarget) {
        if (player.lane === requiredLane) {
          nextLevelOrWin();
        } else {
          // Exit was truly missed (finish line reached in wrong lane)
          missedExitLatched = true;
          missedExitMessageTimer = 1.8;

          // Friendly rewind so they can try again
          distance = exitStartsAt - 120;

          beep(330, 0.10, "sine", 0.05);
          beep(280, 0.12, "sine", 0.05);
        }
      }

      if (missedExitLatched && missedExitMessageTimer > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, H-120, W, 60);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = "900 22px system-ui";
        ctx.fillText("Oops! Missed the EXIT — try again!", W/2, H-82);
        ctx.textAlign = "start";
      }
    }

    requestAnimationFrame(tick);
  }

  // ---------- Start ----------
  startBtn.addEventListener("click", () => {
    ensureAudio();
    if (state === "playing") 
      return;
    if (state === "gameover") { 
      resetLevel(levelIndex, true); 
      return; 
    }
    if (state === "title") { 
      resetLevel(0, false); 
      return; 
    }
  });

  canvas.addEventListener("pointerdown", () => {
    ensureAudio();
    if (state === "title") 
      resetLevel(0, false);
    else if (state === "gameover") 
      resetLevel(levelIndex, true);
  });

  // init
  levelPill.textContent = levels[0].name;
  goalPill.textContent = "Goal: " + levels[0].goal;
  requestAnimationFrame(tick);
})();