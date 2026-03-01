# Ride to School – 2D Canvas Game

A small browser game where you help a student board a school transport, make it safely to the school entrance, and then navigate through the school corridors to reach the correct classroom. Built with plain HTML5 Canvas and vanilla JavaScript — no frameworks.

Play at: https://robert-abela.github.io/ride_to_school.

---

## Quick Start

1. **Project structure (expected by `index.html`):**
   ```text
   /
   ├─ index.html
   ├─ css/
   │  └─ style.css        # optional; not required for gameplay
   └─ js/
      └─ game.js          # the main game logic
   ```

2. **Run locally:**
   - Easiest: just open `index.html` in a modern desktop browser (Chrome/Edge/Firefox/Safari).
   - Some browsers restrict audio without a user gesture; press **Space** once to start.

3. **Play:**
   - **Start:** Press **Space** at the start screen.
   - **Move:** **← / →** arrow keys.
   - **Board/Exit the bus / Use stairs:** Press **Space** when prompted.

---

## Objective

### Level 1
Start on the left, walk to the school transport, **board**, drive forward while avoiding getting blocked, **exit** near the stairs, descend and walk to the big entrance door of the school.

### Level 2
Enter the school and navigate three floors of corridors to reach classroom **year3.3** on the top floor. Avoid wet floors (which send you sliding) and open gaps in the floor. Use the staircases to move between floors.

---

## Core Features

### Level 1
- **State-driven flow**: `startPrompt → walkToBus → waitingBoard → inBus → waitingExit → walkToSchool → onStairs → atSchool`.
- **Player**: Simple animated character with leg swing while moving; head shown in a bus window when on board.
- **School transport**: Smaller black bus with stripe, sliding door animation, engine sound that reacts to movement, arrival beep, and window placement for the player.
- **Traffic**: Colorful cars drive in the same direction. Contact while walking triggers **Game Over**.
- **Environment**: Parallax city backdrop, trees, road, descending stairs, and a three-storey school labeled **"St. Francis Cospicua"** with windows and a large wooden entrance door.
- **Audio**: WebAudio beeps for boarding/arrival, step ticks while walking, a trumpet flourish on victory, and a simple engine hum when the bus moves. Audio is created programmatically — no external files required.
- **Camera**: Horizontal scrolling that keeps the action centered and frames the school facade when you arrive.

### Level 2
- **State**: Triggered automatically when the player reaches the school entrance door at the end of Level 1.
- **Layout**: Three floors displayed simultaneously on screen (no scrolling). The student enters on the **ground floor, bottom-right**, and must reach **year3.3** on the **top floor, top-left**.
- **Staircases**: Two slanted staircases connect the floors. Staircase A (left side) links ground to Floor 1; Staircase B (right side) links Floor 1 to Floor 2. Pressing **Space** near the base or top of a staircase triggers a step-by-step climb/descent animation — the player visibly walks up or down the slant one step at a time, with ascending/descending audio tones.
- **Hazards**:
  - **Wet floor** (Floor 1, centre) — stepping on it causes the player to slide. Sliding into an open gap results in Game Over.
  - **Open gap, left side** (Floor 1) — a broken section of flooring near the left wall. Falling in is Game Over.
  - **Open gap, right side** (Floor 2) — a broken section near the right wall. Falling in is Game Over. Each gap has a yellow warning triangle on a post above it and jagged broken-floor edges.
- **Classrooms**: Each floor has labelled classroom and room doors (Office, Hall, year 1.1, year 2.2, year 3.1, year 3.2, year 3.3). Door labels appear above the door frame. **year3.3** is the goal and is marked with a **◀ GOAL** arrow.
- **Front entrance door**: Visible on the ground floor far right as an interior view — a panelled wooden door with a push-bar, frosted window, and a green EXIT sign above it.
- **Plants**: Decorative potted plants placed throughout the corridors on all three floors.
- **Restart**: On Game Over in Level 2, press **Space** to retry from the school entrance without replaying Level 1.

---

## Controls

| Action                        | Key(s)           |
|-------------------------------|------------------|
| Start game                    | Space            |
| Walk left / right             | ← / → arrows    |
| Board / Exit vehicle          | Space (prompted) |
| Use staircase (up or down)    | Space (prompted) |

---

## Full State Flow

```
startPrompt → walkToBus → waitingBoard → inBus → waitingExit
    → walkToSchool → onStairs → atSchool
        → [Level 2] stair animation → win overlay
```

---

## Files

- `index.html` — Bootstraps the canvas and loads `js/game.js`.
- `js/game.js` — All gameplay, rendering, audio, and state logic for both levels (no external assets).
- `css/style.css` — A stylesheet link exists in `index.html` (gameplay does not depend on it).

---

## How It Works (High Level)

### Level 1
- **Input**: Keyboard listeners maintain `input.left`, `input.right`, and a *rising-edge* `input.jumpPressed` for Space so prompts don't double-trigger.
- **Physics/Movement**: Minimal gravity and ground clamp for the player when not inside the bus; stair descent computes the current step index from horizontal position.
- **State Machine**: Each state handles input differently (e.g., bus movement only while in `inBus` and only if not blocked by a car ahead).
- **Rendering**: Single `draw()` pass renders background, road, cars, stairs, school, bus, prompts, and overlays. The camera clamps so the rightmost school entrance is visible.

### Level 2
- **Floor layout**: Three `l2Floors` objects define `surfaceY` and `ceilY` for each storey. All rendering is in fixed screen coordinates — no camera scrolling.
- **Stair animation**: `l2P.onStair` flag activates a frame-counted step loop. Each step advances `stairStep` by `stairDir` (+1 up, −1 down), interpolates `l2P.x` and `l2P.y` along the stair slant, plays a pitch-shifted beep, and blocks all other input until complete.
- **Hazards**: Wet floor triggers a `slideVx` impulse. Gap checks run every frame against `l2Gaps`; a hit sets `L2.playerDead` and shows the Game Over overlay.
- **Helper functions**: `shadeColor()` lightens hex colours for door panels; `drawPlant()` renders a procedural potted plant at any floor position.
- **Win condition**: When `l2P.floor === 2` and `l2P.x` reaches the year3.3 door, the trumpet flourish plays and the win overlay is shown.

---

## Browser Compatibility

Works in current versions of Chromium, Firefox, and Safari. WebAudio requires a user interaction on page load in some browsers (press **Space**). Mobile is not targeted.

---

## Customization Hooks

Adjust these in `js/game.js` if you want to tweak the feel:

**Level 1**
- `bus.speed` — Vehicle movement speed.
- Traffic spawn in `spawnTrafficCars()` — Count, spacing, and speed range.
- `schoolStories`, `storyH`, `stairs.steps` — School/stair proportions.
- Colors (bus, stripe, environment) and labels (school name) directly in draw routines.

**Level 2**
- `l2Floors` — Adjust `surfaceY` / `ceilY` to change floor heights and spacing.
- `l2StairDefs` — Move or resize staircases (`x`, `w`, `fromFloor`, `toFloor`).
- `l2WetFloor` — Change position and width of the wet floor patch.
- `l2Gaps` — Reposition or resize the open gaps.
- `allDoors` — Add, remove, or reposition classroom doors and change their colours.
- `plants` — Add or reposition decorative plants.
- `FRAMES_PER_STEP` (inside `l2Update`) — Controls the speed of the stair-climbing animation.

---

## Known Limitations & Next Ideas

- No pause/menu; refresh to restart from Level 1 (Space restarts Level 2 only).
- No touch controls.
- Basic collision and art (shapes only, no sprites).

**Potential enhancements**: sprite art for characters/vehicles, a Level 3 (inside the classroom), simple level timer, difficulty modes, scoreboard, mobile touch controls, and accessibility options (rebindable keys, reduced-motion mode).

---

## License

MIT.
