(function () {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    const world = { groundY: H - 70 };

    // Input with rising-edge detection for Space
    const input = { left: false, right: false, jump: false, jumpPressed: false };
    window.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') input.left = true;
        if (e.key === 'ArrowRight') input.right = true;
        if (e.code === 'Space') { if (!input.jump) input.jumpPressed = true; input.jump = true; }
    });
    window.addEventListener('keyup', e => {
        if (e.key === 'ArrowLeft') input.left = false;
        if (e.key === 'ArrowRight') input.right = false;
        if (e.code === 'Space') input.jump = false;
    });

    // Player
    class Player {
        constructor() { this.x = 100; this.y = world.groundY - 30; this.w = 40; this.h = 40; this.vy = 0; this.onGround = true; this.walkAnim = 0; }
        update() {
            // basic gravity and ground
            this.vy += 0.8; this.y += this.vy;
            if (this.y + this.h / 2 >= world.groundY) { this.y = world.groundY - this.h / 2; this.vy = 0; this.onGround = true; }
        }
        draw(state, cameraX, opts = {}) {
            // If in bus, draw only the head peeking out of the chosen window
            if (state === 'inBus' && opts.bus) {
                const wc = opts.windowCenter;
                let hx, hy;
                if (wc) { hx = Math.round(wc.x); hy = Math.round(wc.y); }
                else { hx = Math.round(this.x - cameraX); hy = Math.round(opts.bus.y) - 26; }
                // draw head centered in the window and linked to bus movement (wc already accounts for camera)
                ctx.fillStyle = '#ffd8b1'; ctx.beginPath(); ctx.arc(hx + 2, hy, 10, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#6b3f2b'; ctx.fillRect(hx - 8, hy - 8, 24, 8);
                return;
            }
            const sx = Math.round(this.x - cameraX), sy = Math.round(this.y);
            // body (uniform)
            ctx.fillStyle = '#001f5b'; ctx.fillRect(sx - 10, sy - 18, 20, 18);
            ctx.fillStyle = '#800000'; ctx.fillRect(sx - 10, sy, 20, 8);
            // head
            ctx.fillStyle = '#ffd8b1'; ctx.beginPath(); ctx.arc(sx + 2, sy - 26, 10, 0, Math.PI * 2); ctx.fill();
            // hair
            ctx.fillStyle = '#6b3f2b'; ctx.fillRect(sx - 8, sy - 34, 24, 8);
            // backpack
            ctx.fillStyle = '#800000'; ctx.fillRect(sx + 12, sy - 12, 10, 18);

            // legs: only visible and animated while walking/not in bus
            const moving = (state === 'walkToBus' || state === 'walkToSchool' || state === 'onStairs');
            if (moving) { this.walkAnim += 0.22; }
            const legSwing = Math.sin(this.walkAnim) * 0.6;
            ctx.save(); ctx.translate(sx + 2, sy + 12);
            ctx.fillStyle = '#ffd8b1';
            ctx.save(); ctx.translate(-8, 0); ctx.rotate(legSwing * 0.35); ctx.fillRect(-2, 0, 6, 14); ctx.restore();
            ctx.save(); ctx.translate(8, 0); ctx.rotate(-legSwing * 0.35); ctx.fillRect(-2, 0, 6, 14); ctx.restore();
            ctx.restore();
        }
    }

    const player = new Player();

    // Bus
    const bus = { x: 360, width: 240, height: 90, wheelRadius: 18, color: '#444444', stripe: '#c7b98b', speed: 5, doorOpen: false, doorProg: 0, stopOffset: 60, boarding: false, arrivalPlayed: false };
    bus.y = world.groundY - Math.round(bus.height / 2);

    // Level
    const level = { width: 2600, schoolX: 2400 };
    const schoolWidth = 360;
    const schoolStories = 3;
    
    const storyH = 100;
    const stairs = { x: level.schoolX - 180, steps: 6, w: 22, h: 12 };

    // Traffic cars
    const trafficCars = [];
    const carColors = ['#e74c3c', '#3498db', '#f1c40f', '#27ae60', '#9b59b6'];
    function spawnTrafficCars() {
        trafficCars.length = 0;
        // Place cars ahead of the bus, spaced out, all on the same plane as the bus
        let carStart = bus.x + bus.width + 120;
        for (let i = 0; i < 3; i++) {
            trafficCars.push({
                x: carStart + i * 260 + Math.random() * 60,
                y: bus.y,
                w: 110 + Math.random() * 40,
                h: 48 + Math.random() * 12,
                color: carColors[i % carColors.length],
                speed: 2.2 + Math.random() * 1.2
            });
        }
    }
    spawnTrafficCars();

    // States: startPrompt -> walkToBus -> waitingBoard -> inBus -> waitingExit -> walkToSchool -> onStairs -> atSchool -> level2
    let state = 'startPrompt';
    let cameraX = 0; let finished = false; let boardTime = 0, arrivalTime = 0;

    // ===================== LEVEL 2 =====================
    // Inside the school: 3 floors all visible at once (no scroll).
    // Enter bottom-right (ground floor). Goal: reach classroom "year3.3" top-left (floor 2).
    //
    // Layout (world coords = screen coords, no camera):
    //   Floor 0 (ground): y=340..400  (floor surface at y=400, ceiling at y=340)
    //   Floor 1:          y=220..280
    //   Floor 2:          y=100..160
    //   Staircase A (ground->floor1): x=100..160, left side
    //   Staircase B (floor1->floor2): x=560..620, right side
    //
    // Hazards:
    //   Wet floor on floor 1 at x=300..380 → slides player rightward
    //   Gap on floor 2 at x=430..490 → fall = game over
    //   (gap is to the RIGHT of staircase B exit so safe path goes LEFT to classroom)
    //
    // Safe path: enter(x=740,fl0) → walk left → stairA up → floor1 → walk right (avoid wet) → stairB up
    //            → floor2 → walk LEFT to classroom at x=40 (gap is far right, easy to avoid)

    const L2 = {
        active: false,
        playerDead: false,
        won: false,
        flashTimer: 0,
        deathReason: '',
    };

    // Floor definitions: { surfaceY, ceilY }
    // surfaceY = top of the floor slab (where player stands)
    // ceilY    = bottom of ceiling slab
    const l2Floors = [
        { surfaceY: 395, ceilY: 310 },  // ground floor
        { surfaceY: 270, ceilY: 185 },  // floor 1
        { surfaceY: 145, ceilY:  60 },  // floor 2
    ];

    // Staircase definitions
    // Each staircase is a ramp region: { x, w, fromFloor, toFloor }
    // Player standing in x range on fromFloor and pressing toward the stair climbs up.
    // Standing on toFloor in same x range and pressing away descends.
    // Stairs slant from base (x, lower floor) up to top (x+w, upper floor).
    // Player presses [Space] at base to go UP, or at top to go DOWN.
    const l2StairDefs = [
        { x: 80,  w: 90, fromFloor: 0, toFloor: 1 }, // left stair: ground -> fl1
        { x: 530, w: 90, fromFloor: 1, toFloor: 2 }, // right stair: fl1 -> fl2
    ];
    let l2NearStair = -1; // index of nearest stair (-1 = none)

    // Hazards
    const l2WetFloor = { x: 290, w: 85, floor: 1 }; // wet patch, floor 1 — slides you right
    // One gap on left side (floor 1), one on right side (floor 2)
    // Left gap: floor 1, x=15..55 — left wall area, avoid going too far left after stairA exit (x=170)
    // Right gap: floor 2, x=720..765 — right wall area, don't wander right after stairB exit (x=620)
    const l2Gaps = [
        { x: 15,  w: 45, floor: 1 }, // LEFT gap — floor 1, near left wall
        { x: 720, w: 50, floor: 2 }, // RIGHT gap — floor 2, near right wall
    ];

    // Classroom
    const l2Classroom = { x: 30, floor: 2, w: 50, h: 70 };

    // Player state
    const l2P = {
        x: 740, floor: 0,
        y: 0,           // screen y (set in init)
        vy: 0,
        onGround: true,
        walkAnim: 0,
        sliding: false,
        slideVx: 0,
        // stair animation
        onStair: false,   // true while climbing/descending animation plays
        stairStep: 0,     // current step index (0..stairSteps-1)
        stairSteps: 8,    // total steps on stair
        stairDir: 0,      // +1 going up, -1 going down
        stairIdx: -1,     // which stairDef
        stairTimer: 0,    // frames remaining on current step
    };

    // ── Level 2 helper functions ──────────────────────────────────────────────
    function shadeColor(hex, amount) {
        // Lighten a hex colour by amount (0-255)
        return hex.replace(/[0-9a-f]{2}/gi, (m) => {
            const v = Math.min(255, parseInt(m, 16) + amount);
            return v.toString(16).padStart(2, '0');
        });
    }

    function drawPlant(x, floorSurfaceY) {
        const base = floorSurfaceY; // top of floor slab = where pot sits
        // Pot
        ctx.fillStyle = '#c06030';
        ctx.beginPath();
        ctx.moveTo(x - 7, base);
        ctx.lineTo(x - 5, base - 14);
        ctx.lineTo(x + 5, base - 14);
        ctx.lineTo(x + 7, base);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#a04020';
        ctx.fillRect(x - 8, base - 16, 16, 3);
        // Soil
        ctx.fillStyle = '#5a3010';
        ctx.fillRect(x - 5, base - 14, 10, 4);
        // Stems
        ctx.strokeStyle = '#2e7d32';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, base - 14); ctx.lineTo(x - 8, base - 30); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, base - 14); ctx.lineTo(x + 6, base - 28); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, base - 14); ctx.lineTo(x, base - 32); ctx.stroke();
        // Leaves
        ctx.fillStyle = '#43a047';
        ctx.beginPath(); ctx.ellipse(x - 12, base - 33, 8, 5, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 9,  base - 31, 7, 4,  0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#66bb6a';
        ctx.beginPath(); ctx.ellipse(x,      base - 36, 6, 4,  0.0, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1;
    }

    function l2Init() {
        L2.active = true;
        L2.playerDead = false;
        L2.won = false;
        L2.flashTimer = 0;
        L2.deathReason = '';
        l2P.x = 740;
        l2P.floor = 0;
        l2P.y = l2Floors[0].surfaceY - 20;
        l2P.vy = 0;
        l2P.onGround = true;
        l2P.sliding = false;
        l2P.slideVx = 0;
        l2P.onStair = false;
        l2P.stairStep = 0;
        l2P.stairDir = 0;
        l2P.stairIdx = -1;
        l2P.stairTimer = 0;
    }

    function l2Update() {
        if (L2.playerDead || L2.won) return;
        L2.flashTimer = Math.max(0, L2.flashTimer - 1);

        const p = l2P;
        const speed = 2.4;
        let moved = false;

        // Horizontal movement
        if (p.sliding) {
            p.x += p.slideVx;
            p.slideVx *= 0.96;
            if (Math.abs(p.slideVx) < 0.3) { p.sliding = false; p.slideVx = 0; }
            moved = true;
        } else {
            if (input.right) { p.x += speed; moved = true; }
            if (input.left)  { p.x -= speed; moved = true; }
        }
        if (moved) {
            p.walkAnim += 0.22;
            if (Math.abs(p.x - lastStepX) > 14) { playStep(); lastStepX = p.x; }
        }

        // Clamp to interior walls (10px margins)
        p.x = Math.max(10, Math.min(W - 10, p.x));

        // ── Staircase animation ──────────────────────────────────────────────
        if (p.onStair) {
            // Advance step timer
            p.stairTimer--;
            const st = l2StairDefs[p.stairIdx];
            const STEPS = p.stairSteps;
            const FRAMES_PER_STEP = 7; // frames to pause on each step
            if (p.stairTimer <= 0) {
                p.stairStep += p.stairDir;
                // Play a step beep
                const pitch = p.stairDir > 0
                    ? 300 + p.stairStep * 40
                    : 300 + (STEPS - p.stairStep) * 40;
                beep(pitch, 55);
                p.stairTimer = FRAMES_PER_STEP;
                // Check if reached the end
                if (p.stairDir > 0 && p.stairStep >= STEPS) {
                    // Finished going UP — land on upper floor
                    p.onStair = false;
                    p.floor = st.toFloor;
                    p.x = st.x + st.w + 14;
                    p.y = l2Floors[p.floor].surfaceY - 20;
                    p.onGround = true;
                } else if (p.stairDir < 0 && p.stairStep < 0) {
                    // Finished going DOWN — land on lower floor
                    p.onStair = false;
                    p.floor = st.fromFloor;
                    p.x = st.x - 14;
                    p.y = l2Floors[p.floor].surfaceY - 20;
                    p.onGround = true;
                } else {
                    // Interpolate position along the slant
                    const t = p.stairStep / STEPS;
                    p.x = st.x + (st.x + st.w - st.x) * t;
                    const fromY = l2Floors[st.fromFloor].surfaceY - 20;
                    const toY   = l2Floors[st.toFloor].surfaceY   - 20;
                    p.y = fromY + (toY - fromY) * t;
                    p.walkAnim += 0.35; // faster leg swing on stairs
                }
            }
            return; // block other input while on stair
        }

        // Staircase: detect proximity, show prompt, use Space to start animation
        l2NearStair = -1;
        if (!p.sliding) {
            for (let si = 0; si < l2StairDefs.length; si++) {
                const st = l2StairDefs[si];
                const nearBase = p.floor === st.fromFloor && Math.abs(p.x - st.x) < 28;
                const nearTop  = p.floor === st.toFloor  && Math.abs(p.x - (st.x + st.w)) < 28;
                if (nearBase || nearTop) {
                    l2NearStair = si;
                    if (input.jumpPressed) {
                        input.jumpPressed = false;
                        p.onStair = true;
                        p.stairIdx = si;
                        p.stairSteps = 8;
                        p.stairTimer = 7;
                        p.onGround = false;
                        if (nearBase) {
                            // Going UP: start at step 0 (bottom)
                            p.stairDir = 1;
                            p.stairStep = 0;
                            p.x = st.x;
                            p.y = l2Floors[st.fromFloor].surfaceY - 20;
                        } else {
                            // Going DOWN: start at step 8 (top)
                            p.stairDir = -1;
                            p.stairStep = p.stairSteps;
                            p.x = st.x + st.w;
                            p.y = l2Floors[st.toFloor].surfaceY - 20;
                        }
                        break;
                    }
                }
            }
        }

        // Snap y to current floor surface when on ground
        if (p.onGround) {
            p.y = l2Floors[p.floor].surfaceY - 20;
            p.vy = 0;
        }

        // Wet floor check (floor 1 only)
        if (p.floor === l2WetFloor.floor && !p.sliding) {
            if (p.x > l2WetFloor.x && p.x < l2WetFloor.x + l2WetFloor.w) {
                // slide rightward (away from stairA, toward stairB — adds challenge but still passable)
                const dir = (input.right || (!input.left)) ? 1 : -1;
                p.sliding = true;
                p.slideVx = dir * speed * 3.8;
                L2.flashTimer = 35;
                beep(280, 220);
            }
        }

        // Gap checks
        for (const gap of l2Gaps) {
            if (p.floor === gap.floor && p.x > gap.x && p.x < gap.x + gap.w) {
                L2.playerDead = true;
                L2.deathReason = gap.floor === 2 ? 'You fell through a gap on floor 2!' : 'You fell through a gap on floor 1!';
                L2.flashTimer = 60;
                beep(160, 800);
                return;
            }
        }

        // Win check
        if (p.floor === l2Classroom.floor && p.x <= l2Classroom.x + l2Classroom.w) {
            L2.won = true;
            finished = true;
            if (!trumpetPlayed) { playTrumpet(); trumpetPlayed = true; }
        }
    }

    function l2Draw() {
        const p = l2P;
        const flashOn = L2.flashTimer > 0 && Math.floor(L2.flashTimer / 5) % 2 === 0;

        // ---- Background ----
        ctx.fillStyle = flashOn ? '#ffe0e0' : '#f0ece4';
        ctx.fillRect(0, 0, W, H);

        // ---- Draw 3 floors ----
        const floorColors  = ['#c8b896', '#d4c9a8', '#ddd4bc'];
        const ceilColors   = ['#b8b0a0', '#c0b8a8', '#ccc4b0'];
        const wallColor    = '#a09078';

        // ── Layout constants ──
        // StairA: base x=80, top exit x=170 (floor 0→1)
        // StairB: base x=530, top exit x=620 (floor 1→2)
        // Left gap:  x=15..60,  floor 1
        // Right gap: x=720..770, floor 2
        // year3.3 classroom: x=30, floor 2

        // Doors per floor — carefully spaced to avoid stairs, gaps, windows, each other
        // dw=36, so each door occupies [x, x+36]. Label sits above frame (outside door bounds).
        // Floor 0: stairA base at 80. Keep clear of x=70-180.
        //   Door 1: Office  x=230  (230-266)
        //   Door 2: Hall    x=450  (450-486)
        //   Window: x=380 (center) — clear of all
        // Floor 1: stairA top x=170, stairB base x=530. Left gap x=15-60. Wet x=290-375.
        //   Door 1: year1.1 x=195  (195-231) — just right of stairA exit
        //   Door 2: year2.2 x=400  (400-436) — between wet floor end and stairB
        //   Window: x=480 — clear of wet(290-375) and doors
        // Floor 2: stairB top x=620. Right gap x=720-770. year3.3 at x=30.
        //   Door 1: year3.1 x=220  (220-256)
        //   Door 2: year3.2 x=390  (390-426)
        //   Window: x=490 — clear of doors, clear of gap (720+)

        const allDoors = [
            // floor 0
            { x: 230, floor: 0, label: 'Office',   color: '#3a6a1a' },
            { x: 450, floor: 0, label: 'Hall',     color: '#1a4a6a' },
            // floor 1
            { x: 195, floor: 1, label: 'year 1.1', color: '#6a1a4a' },
            { x: 400, floor: 1, label: 'year 2.2', color: '#6a3a1a' },
            // floor 2
            { x: 220, floor: 2, label: 'year 3.1', color: '#1a5a4a' },
            { x: 390, floor: 2, label: 'year 3.2', color: '#3a1a6a' },
            // year 3.3 — the goal, floor 2, x=30 (drawn separately later)
        ];

        // Plants: { x, floor } — placed in corners / between doors, away from hazards
        const plants = [
            { x: 70,  floor: 0 },  // left of office, ground
            { x: 700, floor: 0 },  // right corner, ground
            { x: 480, floor: 1 },  // between year2.2 and stairB
            { x: 170, floor: 2 },  // left of year3.1
            { x: 580, floor: 2 },  // right of year3.2, left of gap
        ];

        // Window x per floor (one per floor, centered in a gap between doors)
        const winXPerFloor = [380, 480, 490];

        for (let fl = 0; fl < 3; fl++) {
            const { surfaceY, ceilY } = l2Floors[fl];
            const slabH = 14;
            const roomTop = ceilY + slabH;
            const roomBot = surfaceY;
            const roomColors = ['#faf6ee', '#f5f0e6', '#f0ece0'];

            // Walking area background
            ctx.fillStyle = roomColors[fl];
            ctx.fillRect(0, roomTop, W, roomBot - roomTop);

            // Floor slab + tile lines
            ctx.fillStyle = floorColors[fl];
            ctx.fillRect(0, surfaceY, W, slabH);
            ctx.strokeStyle = 'rgba(0,0,0,0.07)';
            ctx.lineWidth = 1;
            for (let tx = 0; tx < W; tx += 44) {
                ctx.beginPath(); ctx.moveTo(tx, surfaceY); ctx.lineTo(tx, surfaceY + slabH); ctx.stroke();
            }

            // Ceiling slab
            ctx.fillStyle = ceilColors[fl];
            ctx.fillRect(0, ceilY, W, slabH);

            // Walls
            ctx.fillStyle = wallColor;
            ctx.fillRect(0, roomTop, 8, roomBot - roomTop);
            ctx.fillRect(W - 8, roomTop, 8, roomBot - roomTop);

            // One window per floor — high up, clear of doors
            const wx = winXPerFloor[fl];
            const winW = 32, winH = 22;
            const winY = roomTop + 5;
            ctx.fillStyle = '#cce8ff';
            ctx.fillRect(wx - winW/2, winY, winW, winH);
            ctx.strokeStyle = '#90b8d8'; ctx.lineWidth = 2;
            ctx.strokeRect(wx - winW/2, winY, winW, winH);
            ctx.strokeStyle = '#80a8c8'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(wx, winY); ctx.lineTo(wx, winY + winH);
            ctx.moveTo(wx - winW/2, winY + winH/2); ctx.lineTo(wx + winW/2, winY + winH/2);
            ctx.stroke();

            // Doors for this floor
            const dh = Math.min(58, roomBot - roomTop - 2);
            const dw = 36;
            for (const d of allDoors) {
                if (d.floor !== fl) continue;
                const dx = d.x, dy = roomBot - dh;
                // Frame (slightly larger box behind door)
                ctx.fillStyle = d.color;
                ctx.fillRect(dx - 3, dy - 3, dw + 6, dh + 3);
                // Door panel (lighter shade)
                ctx.fillStyle = shadeColor(d.color, 55);
                ctx.fillRect(dx, dy, dw, dh);
                // Small window pane on door
                ctx.fillStyle = '#cce8ff';
                ctx.fillRect(dx + 6, dy + 6, dw - 12, 15);
                ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5;
                ctx.strokeRect(dx + 6, dy + 6, dw - 12, 15);
                // Handle
                ctx.fillStyle = '#d4b040';
                ctx.beginPath(); ctx.arc(dx + dw - 7, dy + dh * 0.55, 3, 0, Math.PI*2); ctx.fill();
                // Label ABOVE the frame (not on door)
                ctx.fillStyle = '#222';
                ctx.font = 'bold 9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(d.label, dx + dw/2, dy - 6);
            }

            // Plants for this floor
            for (const pl of plants) {
                if (pl.floor !== fl) continue;
                drawPlant(pl.x, surfaceY);
            }
        }

        // ---- Front entrance door (interior view, ground floor, far right) ----
        {
            const fl = l2Floors[0];
            const roomBot = fl.surfaceY;
            const roomTop = fl.ceilY + 14;
            const dw = 48, dh = Math.min(68, roomBot - roomTop - 2);
            const dx = W - 8 - dw - 2; // flush against right wall
            const dy = roomBot - dh;
            // Wall patch behind door (same as room colour)
            ctx.fillStyle = '#faf6ee';
            ctx.fillRect(dx - 4, dy - 4, dw + 14, dh + 8);
            // Door frame — thick dark wood
            ctx.fillStyle = '#4a2e10';
            ctx.fillRect(dx - 5, dy - 5, dw + 10, dh + 5);
            // Door panel — lighter wood
            ctx.fillStyle = '#8b5c2a';
            ctx.fillRect(dx, dy, dw, dh);
            // Two door panels (raised rectangles)
            ctx.fillStyle = '#9e6a38';
            ctx.fillRect(dx + 4,  dy + 4,  dw - 8,  dh / 2 - 6);
            ctx.fillRect(dx + 4,  dy + dh / 2 + 2, dw - 8, dh / 2 - 8);
            // Panel bevels (dark edge lines)
            ctx.strokeStyle = '#5a3a10'; ctx.lineWidth = 1;
            ctx.strokeRect(dx + 4,  dy + 4,  dw - 8, dh / 2 - 6);
            ctx.strokeRect(dx + 4,  dy + dh / 2 + 2, dw - 8, dh / 2 - 8);
            // Push bar (horizontal metal bar across middle)
            ctx.fillStyle = '#c8c0a0';
            ctx.fillRect(dx + 3, dy + dh * 0.48, dw - 6, 6);
            ctx.strokeStyle = '#909080'; ctx.lineWidth = 1;
            ctx.strokeRect(dx + 3, dy + dh * 0.48, dw - 6, 6);
            // Small rectangular window at top of door
            ctx.fillStyle = '#b8dcf8';
            ctx.fillRect(dx + 8, dy + 6, dw - 16, 16);
            ctx.strokeStyle = '#4a2e10'; ctx.lineWidth = 1.5;
            ctx.strokeRect(dx + 8, dy + 6, dw - 16, 16);
            // EXIT sign above frame
            ctx.fillStyle = '#27ae60';
            ctx.fillRect(dx - 2, dy - 22, dw + 4, 16);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('EXIT', dx + dw / 2, dy - 10);
            // Running person icon (simple)
            ctx.fillStyle = '#fff';
            ctx.font = '9px sans-serif';
            ctx.fillText('🚪', dx + dw / 2 - 18, dy - 10);
            ctx.lineWidth = 1;
        }

        // ---- Staircases (slanted ~45deg, Space to use) ----
        for (let si = 0; si < l2StairDefs.length; si++) {
            const st = l2StairDefs[si];
            const fromFloor = l2Floors[st.fromFloor];
            const toFloor   = l2Floors[st.toFloor];
            const bx = st.x,  by = fromFloor.surfaceY; // base (bottom-left)
            const tx = st.x + st.w, ty = toFloor.surfaceY; // top (top-right)
            const steps = 8;

            // Filled staircase shape (parallelogram-ish background)
            ctx.fillStyle = '#d4c09a';
            ctx.beginPath();
            ctx.moveTo(bx, by + 14);
            ctx.lineTo(tx, ty + 14);
            ctx.lineTo(tx, ty);
            ctx.lineTo(bx, by);
            ctx.closePath();
            ctx.fill();

            // Draw individual slanted steps
            for (let s = 0; s < steps; s++) {
                const t0 = s / steps, t1 = (s + 1) / steps;
                const sx0 = bx + (tx - bx) * t0, sy0 = by + (ty - by) * t0;
                const sx1 = bx + (tx - bx) * t1, sy1 = by + (ty - by) * t1;
                ctx.fillStyle = s % 2 === 0 ? '#c8a464' : '#b8924e';
                ctx.beginPath();
                ctx.moveTo(sx0, sy0);
                ctx.lineTo(sx1, sy1);
                ctx.lineTo(sx1, sy1 + 14);
                ctx.lineTo(sx0, sy0 + 14);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#8a6030';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }

            // Handrail (slanted line above stair)
            ctx.strokeStyle = '#6a4020';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(bx, by - 22);
            ctx.lineTo(tx, ty - 22);
            ctx.stroke();
            // Balusters
            ctx.lineWidth = 1.5;
            for (let b = 0; b <= 4; b++) {
                const t = b / 4;
                const bsx = bx + (tx - bx) * t;
                const bsy = by + (ty - by) * t;
                ctx.beginPath();
                ctx.moveTo(bsx, bsy);
                ctx.lineTo(bsx, bsy - 22);
                ctx.stroke();
            }
            ctx.lineWidth = 1;

            // Prompt: SPACE to go up/down
            const isNear = l2NearStair === si;
            if (isNear) {
                const p = l2P;
                const nearBase = p.floor === st.fromFloor;
                const promptX = nearBase ? bx - 10 : tx + 10;
                const promptY = nearBase ? fromFloor.surfaceY - 50 : toFloor.surfaceY - 50;
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                ctx.beginPath();
                ctx.roundRect(promptX - 42, promptY - 16, 84, 24, 6);
                ctx.fill();
                ctx.fillStyle = '#f1c40f';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(nearBase ? '[Space] Go up' : '[Space] Go down', promptX, promptY);
            }
        }

        // ---- Wet floor patch (floor 1) ----
        {
            const fl = l2Floors[l2WetFloor.floor];
            const wy = fl.surfaceY;
            // Water sheen
            ctx.fillStyle = 'rgba(80,160,255,0.30)';
            ctx.fillRect(l2WetFloor.x, wy - 2, l2WetFloor.w, 12);
            ctx.fillStyle = 'rgba(120,200,255,0.45)';
            ctx.fillRect(l2WetFloor.x + 5, wy, l2WetFloor.w - 10, 4);
            // Sign (yellow triangle)
            const signX = l2WetFloor.x + l2WetFloor.w / 2;
            const signY = wy - 36;
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.moveTo(signX, signY);
            ctx.lineTo(signX - 14, signY + 24);
            ctx.lineTo(signX + 14, signY + 24);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#333';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('!', signX, signY + 18);
            ctx.fillStyle = '#1a6bb5';
            ctx.font = '9px sans-serif';
            ctx.fillText('WET FLOOR', signX, signY - 4);
        }

        // ---- Gaps (dark void + warning sign above) ----
        for (const gap of l2Gaps) {
            const fl = l2Floors[gap.floor];
            const gx = gap.x, gw = gap.w, gy = fl.surfaceY;
            // Dark void
            ctx.fillStyle = '#1a1008';
            ctx.fillRect(gx, gy, gw, H - gy);
            // Subtle depth gradient inside
            const vg = ctx.createLinearGradient(gx, gy, gx + gw, gy + 40);
            vg.addColorStop(0, 'rgba(80,40,0,0.4)');
            vg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = vg;
            ctx.fillRect(gx, gy, gw, 40);
            // Jagged broken-floor edges
            ctx.fillStyle = '#8b6a3a';
            ctx.beginPath();
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + 6, gy + 7); ctx.lineTo(gx + 2, gy + 13);
            ctx.lineTo(gx - 4, gy); ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(gx + gw, gy);
            ctx.lineTo(gx + gw - 5, gy + 8); ctx.lineTo(gx + gw - 1, gy + 14);
            ctx.lineTo(gx + gw + 4, gy); ctx.closePath(); ctx.fill();
            // Warning sign above the gap
            const scx = gx + gw / 2, scy = gy - 14;
            const sh = 26, sw2 = 22;
            // Red/white striped post
            ctx.fillStyle = '#cc2222';
            ctx.fillRect(scx - 2, scy - sh, 4, sh);
            // Triangle warning sign
            ctx.fillStyle = '#f1c40f';
            ctx.strokeStyle = '#c00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(scx, scy - sh - 20);
            ctx.lineTo(scx - sw2, scy - sh);
            ctx.lineTo(scx + sw2, scy - sh);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            // Exclamation mark
            ctx.fillStyle = '#c00';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('!', scx, scy - sh - 4);
            ctx.lineWidth = 1;
        }

        // ---- Classroom door year3.3 (floor 2, left side — the GOAL) ----
        {
            const fl = l2Floors[l2Classroom.floor];
            const dw = l2Classroom.w, dh = l2Classroom.h;
            const dx = l2Classroom.x;
            const dy = fl.surfaceY - dh;
            // Frame
            ctx.fillStyle = '#5a3a1a';
            ctx.fillRect(dx - 4, dy - 4, dw + 8, dh + 4);
            // Door panel
            ctx.fillStyle = '#8b5c2a';
            ctx.fillRect(dx, dy, dw, dh);
            // Door window pane
            ctx.fillStyle = '#cce8ff';
            ctx.fillRect(dx + 8, dy + 8, dw - 16, 22);
            // Handle
            ctx.fillStyle = '#e0c060';
            ctx.beginPath();
            ctx.arc(dx + dw - 10, dy + dh * 0.55, 5, 0, Math.PI * 2);
            ctx.fill();
            // Label ABOVE the frame
            ctx.fillStyle = '#222';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('year 3.3', dx + dw / 2, dy - 7);
            // GOAL arrow
            ctx.fillStyle = '#27ae60';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText('◀ GOAL', dx + dw / 2 + 52, dy + dh / 2 + 4);
        }

        // ---- Entry arrow (ground floor, right) ----
        if (!L2.playerDead && !L2.won && l2P.floor === 0 && l2P.x > 680) {
            ctx.fillStyle = '#27ae60';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('← Walk left to stairs', W / 2, l2Floors[0].surfaceY - 55);
        }

        // ---- Player ----
        if (!L2.playerDead) {
            const px = Math.round(p.x);
            const py = Math.round(p.y);
            ctx.fillStyle = '#001f5b'; ctx.fillRect(px - 10, py - 18, 20, 18);
            ctx.fillStyle = '#800000'; ctx.fillRect(px - 10, py, 20, 8);
            ctx.fillStyle = '#ffd8b1'; ctx.beginPath(); ctx.arc(px + 2, py - 26, 10, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#6b3f2b'; ctx.fillRect(px - 8, py - 34, 24, 8);
            ctx.fillStyle = '#800000'; ctx.fillRect(px + 12, py - 12, 10, 18);
            const legSwing = Math.sin(p.walkAnim) * 0.6;
            ctx.save(); ctx.translate(px + 2, py + 12); ctx.fillStyle = '#ffd8b1';
            ctx.save(); ctx.translate(-8, 0); ctx.rotate(legSwing * 0.35); ctx.fillRect(-2, 0, 6, 14); ctx.restore();
            ctx.save(); ctx.translate(8, 0); ctx.rotate(-legSwing * 0.35); ctx.fillRect(-2, 0, 6, 14); ctx.restore();
            ctx.restore();
        }

        // ---- HUD ----
        ctx.fillStyle = 'rgba(20,10,5,0.7)';
        ctx.fillRect(0, 0, W, 34);
        ctx.fillStyle = '#f0e8d8';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Level 2 — Get to classroom  year3.3  on Floor 2!', 10, 22);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#f1c40f';
        ctx.fillText('← → move  |  [Space] use stairs  |  Avoid gaps & wet floor!', W - 10, 22);

        // ---- Game Over overlay ----
        if (L2.playerDead) {
            ctx.fillStyle = 'rgba(0,0,0,0.68)';
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#ff4444';
            ctx.font = 'bold 34px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('GAME OVER', W / 2, H / 2 - 28);
            ctx.fillStyle = '#fff';
            ctx.font = '17px sans-serif';
            ctx.fillText(L2.deathReason, W / 2, H / 2 + 8);
            ctx.fillStyle = '#aaa';
            ctx.font = '13px sans-serif';
            ctx.fillText('Press  [Space]  to try Level 2 again', W / 2, H / 2 + 38);
        }

        // ---- Win overlay ----
        if (L2.won) {
            ctx.fillStyle = 'rgba(0,0,0,0.62)';
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#f1c40f';
            ctx.font = 'bold 34px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🎉  Made it to class!', W / 2, H / 2 - 28);
            ctx.fillStyle = '#fff';
            ctx.font = '18px sans-serif';
            ctx.fillText('You reached Year 3.3 — well done!', W / 2, H / 2 + 10);
            ctx.fillStyle = '#aaa';
            ctx.font = '13px sans-serif';
            ctx.fillText('Refresh to play again', W / 2, H / 2 + 40);
        }
    }

    // ===================== END LEVEL 2 =====================

    // Audio (simple beeps)
    let audioCtx = null; 
    function ensureAudio() { 
        if (!audioCtx) { 
            try { 
                audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
            } catch (e) { 
                audioCtx = null; 
            } 
        } 
    }

    function beep(freq, dur) { 
        ensureAudio(); 
        if (!audioCtx) 
            return; 
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(); 
        o.type = 'sine'; 
        o.frequency.value = freq; 
        o.connect(g); 
        g.connect(audioCtx.destination); 
        const now = audioCtx.currentTime; 
        g.gain.setValueAtTime(0.0001, now); 
        g.gain.exponentialRampToValueAtTime(0.08, now + 0.01); 
        o.start(now); 
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur / 1000); 
        o.stop(now + dur / 1000 + 0.02); 
    }

    // Engine, step and trumpet sounds
    let engineOsc = null, engineGain = null; let engineRunning = false;
    function startEngine() { 
        ensureAudio(); 
        if (!audioCtx || engineRunning) 
            return; 
        engineOsc = audioCtx.createOscillator(); 
        engineGain = audioCtx.createGain(); 
        engineOsc.type = 'sawtooth'; 
        engineOsc.frequency.value = 60; 
        engineGain.gain.value = 0.0001; 
        engineOsc.connect(engineGain); 
        engineGain.connect(audioCtx.destination); 
        engineOsc.start(); 
        engineGain.gain.exponentialRampToValueAtTime(0.04, audioCtx.currentTime + 0.05); 
        engineRunning = true; 
    }
    function setEngineTone(speedFactor) { 
        if (!engineRunning || !engineOsc) 
            return; 
        const f = 60 + Math.min(220, Math.max(0, speedFactor * 220)); 
        engineOsc.frequency.setTargetAtTime(f, audioCtx.currentTime, 0.05); 
    }
    function stopEngine() { 
        if (!audioCtx || !engineRunning) 
            return; 
        try { 
            engineGain.gain.setValueAtTime(0.0001, audioCtx.currentTime); 
            engineOsc.stop(audioCtx.currentTime + 0.01); 
        } catch (e) { } 
        engineOsc = null; 
        engineGain = null; 
        engineRunning = false; 
    }

    let lastStepX = 0; 
    function playStep() { 
        ensureAudio(); 
        if (!audioCtx) 
            return; 
        const o = audioCtx.createOscillator(), g = audioCtx.createGain(); 
        o.type = 'square'; 
        o.frequency.value = 520; 
        g.gain.value = 0.0001; 
        o.connect(g); 
        g.connect(audioCtx.destination); 
        const now = audioCtx.currentTime; 
        g.gain.exponentialRampToValueAtTime(0.06, now + 0.01); 
        o.start(now); 
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08); 
        o.stop(now + 0.12);
    }

    let trumpetPlayed = false; 
    function playTrumpet() {
        ensureAudio(); 
        if (!audioCtx) 
            return; 
        const now = audioCtx.currentTime; 
        const o1 = audioCtx.createOscillator(), 
        g1 = audioCtx.createGain(); 
        o1.type = 'triangle'; 
        o1.frequency.value = 880; 
        o1.connect(g1); 
        g1.connect(audioCtx.destination); 
        g1.gain.setValueAtTime(0.0001, now); 
        g1.gain.exponentialRampToValueAtTime(0.12, now + 0.01); 
        o1.start(now); 
        o1.frequency.linearRampToValueAtTime(660, now + 0.2); 
        g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.45); 
        o1.stop(now + 0.5);
    }

    function update() {
        // Check for collision between player and traffic cars (only when walking, not in bus)
        if (state === 'walkToBus' || state === 'walkToSchool' || state === 'onStairs') {
            for (const car of trafficCars) {
                // Simple AABB collision
                const px = player.x, py = player.y;
                const pw = player.w, ph = player.h;
                const cx = car.x, cy = car.y;
                const cw = car.w, ch = car.h;
                if (
                    px + pw / 2 > cx && px - pw / 2 < cx + cw &&
                    py + ph / 2 > cy && py - ph / 2 < cy + ch
                ) {
                    finished = true;
                    state = 'gameOver';
                    stopEngine();
                    break;
                }
            }
        }
        // Move traffic cars (all move right, like the bus)
        for (const car of trafficCars) {
            car.x += car.speed;
            // Wrap cars to the left if they go off screen
            if (car.x > level.width + 60) car.x = -car.w - 60;
        }
        if (state === 'startPrompt') {
            if (input.jumpPressed) {
                input.jumpPressed = false;
                state = 'walkToBus';
            }
            return;
        }
        // animate door
        if (bus.doorOpen) 
            bus.doorProg += 0.06; 
        else 
            bus.doorProg -= 0.06; 
        
        bus.doorProg = Math.max(0, Math.min(1, bus.doorProg));

        // state machine
        if (state === 'walkToBus' || state === 'waitingBoard') {
            // player movement controlled by arrows
            let moved = false;
            if (input.right) { 
                player.x += 1.8; 
                player.walkAnim += 0.18; 
                moved = true; 
            }
            if (input.left) { 
                player.x -= 1.8; 
                player.walkAnim += 0.12;
                moved = true; 
            }
            // play walking sound when moving on the ground
            if (moved && Math.abs(player.x - lastStepX) > 12) { 
                playStep(); 
                lastStepX = player.x; 
            }
            // if near bus door, enter waitingBoard state and allow boarding
            const doorX = bus.x + bus.width - 62; 
            const boardSpot = doorX - 20;
            if (player.x + 10 >= boardSpot) { 
                player.x = boardSpot; 
                state = 'waitingBoard'; 
                bus.doorOpen = true; 
            }
            if (state === 'waitingBoard' && input.jumpPressed) { 
                state = 'inBus'; 
                input.jumpPressed = false; 
                player.x = bus.x + 40; 
                player.y = bus.y; 
                bus.doorOpen = false; 
                boardTime = performance.now(); 
                beep(880, 140); 
            }
            if (!moved) { /* idle */ }
        }
        else if (state === 'inBus') {
            // bus movement controlled by arrows, but blocked by car in front
            let busMoved = false;
            let canMoveRight = true;
            // Check for car in front
            for (const car of trafficCars) {
                if (
                    car.x > bus.x + bus.width - 10 &&
                    car.x < bus.x + bus.width + 80 &&
                    Math.abs(car.y - bus.y) < 30
                ) {
                    canMoveRight = false;
                    break;
                }
            }
            if (input.right && canMoveRight) { 
                bus.x += bus.speed; busMoved = true; 
            }
            if (input.left) { bus.x -= bus.speed; busMoved = true; }
            // clamp bus
            bus.x = Math.max(0, Math.min(level.width - bus.width, bus.x));
            player.x = bus.x + 40; player.y = bus.y;
            const dropX = stairs.x - (bus.width - 62) - bus.stopOffset;
            if (bus.x >= dropX) { 
                bus.x = dropX; 
                bus.doorOpen = true; 
                state = 'waitingExit'; 
                arrivalTime = performance.now(); 
                if (!bus.arrivalPlayed) { 
                    beep(440, 300); 
                    bus.arrivalPlayed = true; 
                } 
            }
            // engine sound
            if (busMoved) { 
                startEngine(); 
                setEngineTone(1.0); 
            } else { 
                stopEngine(); 
            }
        }
        else if (state === 'waitingExit') {
            stopEngine();
            if (input.jumpPressed) { 
                input.jumpPressed = false; 
                state = 'walkToSchool'; 
                player.x = bus.x + bus.width - 80; 
                bus.doorOpen = false; 
            }
        }
        else if (state === 'walkToSchool') {
            // user-controlled walking toward stairs and door
            const bigDoorW = 54;
            const bigDoorX = level.schoolX + schoolWidth - bigDoorW - 18;
            if (input.right) { player.x += 1.6; player.walkAnim += 0.18; }
            if (input.left) { player.x -= 1.6; player.walkAnim += 0.12; }
            if ((input.right || input.left) && Math.abs(player.x - lastStepX) > 12) { 
                playStep(); 
                lastStepX = player.x; 
            }
            // If player is past the stairs, allow her to walk all the way to the door
            if (player.x >= stairs.x + stairs.steps * stairs.w - 4) {
                // move to door on ground
                player.y = world.groundY - player.h / 2;
                if (player.x >= bigDoorX - 10) {
                    state = 'atSchool';
                    // Level 2 will be triggered from atSchool state
                }
            } else if (player.x >= stairs.x) {
                state = 'onStairs';
            }
        }
        else if (state === 'onStairs') {
            // step through stairs left->right descending, controlled by arrows
            if (input.right) { 
                player.x += 1.0; 
                player.walkAnim += 0.18;
            }
            if (input.left) { 
                player.x -= 1.0; 
                player.walkAnim += 0.12; 
            }
            const rel = Math.max(0, Math.min(player.x - stairs.x, stairs.steps * stairs.w - 1));
            const idx = Math.floor(rel / stairs.w);
            const topY = world.groundY; const stepY = topY + idx * stairs.h;
            player.y = stepY - player.h / 2;
            // play step sound per step distance
            if (Math.abs(player.x - lastStepX) > Math.max(8, stairs.w * 0.45)) { 
                playStep(); 
                lastStepX = player.x; 
            }
            // check if player reached the big door
            const bigDoorW = 54;
            const bigDoorX = level.schoolX + schoolWidth - bigDoorW - 18;
            if (idx === stairs.steps - 1 && player.x >= bigDoorX - 10) {
                state = 'atSchool';
                // Level 2 will be triggered from atSchool state
            }
        }
        else if (state === 'atSchool') {
            // Brief pause then launch level 2
            if (!L2.active) {
                l2Init();
            }
        }
        else { 
            player.update(); 
        }

        // clamp
        if (player.x < 20) player.x = 20;
        // Allow player.x to go slightly past level.width so camera can show the school door
        const maxPlayerX = level.schoolX + schoolWidth - 10;
        if (player.x > maxPlayerX) player.x = maxPlayerX;
        // Camera: always allow scrolling to show the rightmost part of the school and door
        const maxCameraX = Math.max(0, level.schoolX + schoolWidth - W + 40);
        cameraX = Math.max(0, player.x - W / 2);
        cameraX = Math.min(maxCameraX, cameraX);
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        // sky
        ctx.fillStyle = '#d7f0d7'; ctx.fillRect(0, 0, W, world.groundY - 120);

        // distant buildings (parallax)
        const cityParallax = cameraX * 0.25;
        for (let bx = -600; bx < level.width + 600; bx += 300) {
            const idx = Math.abs(Math.floor(bx / 300)) % 4;
            const bW = 180; const bh = 80 + idx * 18;
            const bxScreen = Math.round(bx - cityParallax);
            const byTop = Math.round(world.groundY - 40 - bh);
            // skip off-screen clusters for performance
            if (bxScreen + bW < -100 || bxScreen > W + 100) continue;
            // building body
            const colors = ['#b3cde0', '#c7d7b9', '#d3b6c6', '#cfcfcf']; ctx.fillStyle = colors[idx % colors.length]; ctx.fillRect(bxScreen, byTop, bW, bh);
            // windows
            ctx.fillStyle = '#ffee88';
            const cols = 3, rows = Math.max(2, Math.floor(bh / 28));
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const wx = bxScreen + 14 + c * Math.round((bW - 28) / cols);
                    const wy = byTop + 12 + r * 22;
                    ctx.fillRect(wx, wy, Math.round(bW * 0.16), 12);
                }
            }
        }

        // trees in foreground along the road
        const treeParallax = cameraX * 0.5;
        for (let tx = -200; tx < level.width + 200; tx += 360) {
            const txScreen = Math.round(tx - treeParallax);
            if (txScreen < -80 || txScreen > W + 80) continue;
            // trunk
            const trunkH = 20; ctx.fillStyle = '#7b5a2a'; ctx.fillRect(txScreen + 8, world.groundY - 26, 8, trunkH);
            // foliage
            ctx.fillStyle = '#2f8b3b'; ctx.beginPath(); ctx.arc(txScreen + 12, world.groundY - 34, 18, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(txScreen - 2, world.groundY - 22, 14, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(txScreen + 26, world.groundY - 22, 14, 0, Math.PI * 2); ctx.fill();
        }

        // ground and road
        ctx.fillStyle = '#6aa84f'; ctx.fillRect(0, world.groundY, W, H - world.groundY);
        ctx.fillStyle = '#7f7f7f'; ctx.fillRect(0, world.groundY + 22, W, 28);

        // Draw traffic cars (behind bus and player)
        for (const car of trafficCars) {
            const cx = Math.round(car.x - cameraX);
            // Draw cars on the same plane as the bus
            const cy = Math.round(bus.y);
            ctx.save();
            ctx.fillStyle = car.color;
            ctx.fillRect(cx, cy, car.w, car.h);
            // windows
            ctx.fillStyle = '#e0e6f7';
            ctx.fillRect(cx + 8, cy + 5, car.w - 16, car.h / 2 - 2);
            // wheels
            ctx.fillStyle = '#222';
            ctx.beginPath(); ctx.arc(cx + 18, cy + car.h, 10, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + car.w - 18, cy + car.h, 10, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        // stairs (start at street level and descend)
        for (let s = 0; s < stairs.steps; s++) { 
            const sx = Math.round(stairs.x + s * stairs.w - cameraX); 
            const sy = Math.round(world.groundY + s * stairs.h); 
            ctx.fillStyle = '#bdbdbd'; 
            ctx.fillRect(sx, sy, stairs.w, stairs.h); 
            ctx.strokeStyle = '#777'; 
            ctx.strokeRect(sx, sy, stairs.w, stairs.h); 
        }

        // school below stairs (3 levels, all pink)
        const schoolX = Math.round(level.schoolX - cameraX);
        const schoolTop = world.groundY + stairs.steps * stairs.h + 8;
        // Draw school name background above all stories
        const nameBarHeight = 36;
        ctx.fillStyle = '#ffc0d0';
        ctx.fillRect(schoolX, schoolTop - (schoolStories * storyH) - nameBarHeight, schoolWidth, nameBarHeight);
        // Draw school name (centered, above windows)
        ctx.fillStyle = '#333';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('St. Francis Cospicua', schoolX + Math.round(schoolWidth / 2), schoolTop - (schoolStories * storyH) - nameBarHeight / 2 + 8);
        // draw stories stacked upwards
        for (let s = 0; s < schoolStories; s++) {
            const y = schoolTop - (schoolStories - s) * storyH;
            ctx.fillStyle = '#ffc0d0';
            ctx.fillRect(schoolX, y, schoolWidth, storyH);
            // windows per story
            ctx.fillStyle = '#fff'; const cols = 4;
            for (let c = 0; c < cols; c++) {
                const wx = schoolX + 18 + c * Math.round((schoolWidth - 36) / cols);
                const wy = y + 18;
                const wW = Math.round(schoolWidth * 0.09), wH = Math.round(storyH * 0.25);
                ctx.fillRect(wx, wy, wW, wH); 
                ctx.strokeStyle = '#c88'; 
                ctx.strokeRect(wx, wy, wW, wH);
            }
        }
        // big wooden door at bottom right
        // Draw the bus and player first
        // ...existing code for bus drawing...
        const bx = Math.round(bus.x - cameraX), by = Math.round(bus.y);
        ctx.fillStyle = bus.color; ctx.fillRect(bx, by - bus.height / 2, bus.width, bus.height);
        ctx.fillStyle = bus.stripe; ctx.fillRect(bx, by - bus.height / 2 + Math.round(bus.height * 0.18), bus.width, Math.round(bus.height * 0.16));
        ctx.fillStyle = '#333'; ctx.fillRect(bx, by - 6, bus.width, 6);
        // windows (computed to fit smaller bus)
        ctx.fillStyle = '#77aaff';
        const winW = Math.max(28, Math.round(bus.width * 0.13));
        const winH = Math.max(20, Math.round(bus.height * 0.28));
        const winStart = bx + 12;
        const winGap = Math.max(6, Math.round((bus.width - 24 - winW * 3) / 2));
        const windowCenters = [];
        for (let i = 0; i < 3; i++) {
            const wx = winStart + i * (winW + winGap);
            ctx.fillRect(wx, by - 18, winW, winH);
            windowCenters.push({ x: wx + Math.round(winW / 2), y: (by - 18) + Math.round(winH / 2) });
        }
        // wheels (bigger)
        const wheelCY = Math.round(by + (bus.height / 2) - Math.round(bus.wheelRadius / 2)); 
        ctx.fillStyle = '#222'; 
        ctx.beginPath(); 
        ctx.arc(bx + 24, wheelCY, bus.wheelRadius, 0, Math.PI * 2); 
        ctx.fill(); ctx.beginPath(); 
        ctx.arc(bx + bus.width - 34, wheelCY, bus.wheelRadius, 0, Math.PI * 2); 
        ctx.fill();
        // door animation (slides right when opening)
        const doorX = bx + bus.width - 52; 
        const doorW = 28, doorH = 30; 
        const openOffset = Math.round(bus.doorProg * 28); 
        ctx.fillStyle = '#222'; 
        ctx.fillRect(doorX + openOffset, by - 10, doorW, doorH);
        ctx.fillStyle = '#fff'; 
        ctx.font = '14px sans-serif'; 
        ctx.textAlign = 'left'; 
        ctx.fillText('School Transport', bx + 10, by - bus.height / 2 + 16);

        // player (pass window center for head-in-window)
        const preferredWindow = windowCenters.length ? windowCenters[1] : null;
        player.draw(state, cameraX, { bus, windowCenter: preferredWindow });

        // Draw the big wooden school door at the bottom right of the school, always in the foreground
        let bigDoorW = 54, bigDoorH = 80;
        let bigDoorX = schoolX + schoolWidth - bigDoorW - 5;
        let bigDoorY = schoolTop - bigDoorH - 10;
        ctx.save();
        ctx.fillStyle = '#8b5c2a';
        ctx.fillRect(bigDoorX, bigDoorY, bigDoorW, bigDoorH);
        ctx.strokeStyle = '#6b3f2b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(bigDoorX + bigDoorW - 12, bigDoorY + bigDoorH / 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#e0c080';
        ctx.fill();
        ctx.restore();

        // prompts
        ctx.textAlign = 'center'; ctx.fillStyle = '#111'; ctx.font = '16px sans-serif';
        if (state === 'startPrompt') {
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#222';
            ctx.font = '28px sans-serif';
            ctx.fillText('Press [Space] to Start', W / 2, H / 2);
            ctx.font = '16px sans-serif';
            ctx.fillText('Use arrow keys to move', W / 2, H / 2 + 32);
        }
        if (state === 'waitingBoard') ctx.fillText('Press [Space] to board', W / 2, 40);
        if (state === 'waitingExit') ctx.fillText('Press [Space] to exit the bus', W / 2, 40);
        
        if (finished) { 
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; 
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#fff';
            ctx.font = '28px sans-serif';
            if (state === 'gameOver') {
                ctx.fillText('Game Over!', W / 2, H / 2 - 8);
                ctx.font = '16px sans-serif';
                ctx.fillText('You were hit by a car.', W / 2, H / 2 + 18);
                ctx.fillText('Refresh to try again.', W / 2, H / 2 + 38);
            } else {
                ctx.fillText('You made it to school!', W / 2, H / 2 - 8);
                ctx.font = '16px sans-serif';
                ctx.fillText('Refresh to play again.', W / 2, H / 2 + 18);
            }
        }
    }

    function loop() {
        // handle rising-edge reset for jumpPressed
        // Level 2 restart
        if (L2.active && L2.playerDead && input.jumpPressed) {
            input.jumpPressed = false;
            l2Init();
        }
        if (L2.active) {
            l2Update();
            l2Draw();
        } else {
            update(); draw();
        }
        input.jumpPressed = false;
        requestAnimationFrame(loop);
    }

    loop();

})();
