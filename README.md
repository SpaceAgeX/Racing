# Driving prototype

A browser racing prototype using Three.js and TypeScript, served by Node.js and Express with Socket.IO race rooms. The scene contains rectangular cars, a track made from square tiles, a start/finish arch, sunlight, ambient light, and a smooth following camera.

## Run locally

Install Node.js 24 or newer, then run from this directory:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. In Windows PowerShell with script execution disabled, use `npm.cmd install` and `npm.cmd run dev`.

The development command builds the browser bundle with esbuild, serves it through Express, and watches TypeScript changes. Refresh the page after editing. Set `PORT` to change the port and `HOST` to change the bind address.

Express listens on all IPv4 network interfaces by default (`0.0.0.0`). Other devices on the same network can open **http://YOUR-COMPUTER-IP:3000**; startup prints the available network URLs. Keep the server running while they play. If Windows Firewall asks, allow Node.js on your private network. Players can create or join the same race room. To restrict access to this computer, set `HOST=127.0.0.1`. Devices outside your local network require additional router/network configuration.

For a production bundle:

```sh
npm run build
npm start
```

## Race rooms

The home screen lists open lobbies. Enter a player name, choose a preset or a shared saved track, and **Create lobby**, or join an existing lobby. The host can change the track and **Start race**; other players see the same room settings. The map and cars load when the host starts. A one-player room can be used for solo testing. **Leave lobby** or **Leave game** returns to the home screen. Rooms exist in memory and disappear when everyone leaves or the server restarts.

Map Builder is available from the home screen and race HUD. **Play track** publishes a custom/edited drawing to the shared library and returns home with that map selected for lobby creation. Saved or deleted maps update connected players' track selectors. Each room keeps its own map snapshot, so library changes do not replace a race in progress.

This multiplayer implementation relays client-simulated car states to other players in the same room. It is not yet server-authoritative and has no player-to-player collisions. The pure driving simulation remains reusable for that future step. Live Handling values affect the local player's simulation.

## Controls and tuning

- **W:** accelerate forward, or brake while reversing.
- **S:** brake while moving forward, then accelerate backward once stopped.
- **A / D:** steer left / right. Releasing the keys centers steering.
- **W + S:** brake to a stop.

Releasing both pedals coasts under drag. Held inputs clear when the window loses focus or the document becomes hidden.

The bottom-left minimap shows the current track, a green start/finish tile, and an orange arrow for the car's position and heading. It stays north-up (earlier rows at the top), fits the occupied map area, and tracks falls and respawns. The car indicator stays visible at the map edge if it travels outside that area. The minimap adapts to narrow and short windows alongside the driving hint.

All driving values are in `src/simulation/parameters.ts`: forward and reverse acceleration, braking, speed caps, drag, wheelbase, steering limits, steering speed, and centering speed. Default forward acceleration is **22 m/s²** and top speed is **62 m/s (223.2 km/h)**. Steering limits decrease with speed for stable arcade handling. Press **C** while racing to toggle between the follow camera and the hood-level first-person view. Camera offsets and smoothing rates are in `src/rendering/camera.ts`. Previously saved browser tuning keeps its values; use **Reset defaults** to adopt these source defaults.

The same parameters file contains `physicsParameters`: gravity, the one-second respawn delay, ground contact snap distance, collision bounce, spin damping, crash tire grip, and crash recovery time. The **Crashes** sliders in the Handling panel tune these collision values live.

The **Handling** panel on the right has live sliders for every driving and falling parameter. Changes apply immediately, including while a slider has focus and you use WASD. It shows current speed, remembers values in this browser, and offers **Reset defaults** and **Save settings** (downloads `racing-handling.json` with the current driving/physics values). Steering angles show radians and degrees; speed limits show m/s and km/h. High-speed steering is kept at or below the maximum steering angle. Use **Hide / Tuning** to collapse or open the panel; it starts collapsed on narrow screens. Browser tuning changes do not modify the source defaults.

## Track layout

Open **http://127.0.0.1:3000/map-builder/**, or use the **Map Builder** link in the game. The builder has a **64 × 64** canvas grid with **Track**, **Start / finish**, and **Erase** tools. The full square grid scales to the available width and height, keeping the controls visible without page scrolling on desktop, narrow, and short windows. Click or drag to paint. Placing a start/finish moves the previous marker, leaving a regular track tile behind. Saving and playing require exactly one start/finish tile.

Give the track a name and use **Save track**. Saved maps go into the **Shared tracks** library on the Express server, so anyone opening this server from another device or browser can load and play them. Saving the same name (ignoring case) updates that shared track. Choose an entry and use **Load track** to fetch its latest version, **Delete track** to remove it from the shared library, or **Play track** to load the current drawing into the game. The library refreshes every five seconds while visible and when returning to the page. A failed save keeps the drawing available for retry.

The server stores tracks in **`data/tracks.json`**, creates the directory on the first save, and loads the library again after a restart. Back up this file to preserve maps when moving or reinstalling the server; it is excluded from Git. Set **`TRACKS_FILE`** to choose another storage file. This file store is intended for one server process. Saves are serialized and replace the file atomically. Invalid track data is rejected; a corrupt existing library stops startup rather than being overwritten.

Each player's selected map and current playable copy remain in that browser's local storage, so choosing a track does not change another player's game. Clearing browser data does not delete the server library. Older browser-only saves appear under **Older browser tracks — save to share**: load one, then click **Save track** to publish it. These original local copies remain available. This prototype has no accounts or ownership rules: all users of this server can save, update, and delete shared tracks.

The permanent presets are **Default circuit**, a broad loop with an inward chicane, and **Simple loop track**, a rectangular loop with rounded corners approximated by square tiles. Presets cannot be deleted; edit and save a copy. The initial game uses the redesigned Default circuit. Both presets are generated in `src/track/presets.ts`.

The data remains a plain 2D array. `src/track/layout.ts` exports the default layout and shared dimensions; you can also replace its generated layout with a custom array:

- **0:** empty space, with no ground underneath.
- **1:** a square track tile.
- **2:** a track tile with a checkered start/finish line and an overhead arch through its center.

```ts
export const trackLayout: TrackLayout = [
  [1, 1, 1],
  [1, 0, 1],
  [2, 1, 1],
];
```

Each tile is `trackTileSize` meters wide and long (12 m by default), with a 0.5 m thick slab whose top sits at Y = 0. Tiles touch edge-to-edge. Columns increase along +X and rows along +Z; the grid is centered on the world origin. The car starts just behind the first `2`, facing toward earlier rows (-Z). Without a `2`, it starts on the first `1`; an entirely empty layout starts at the origin. Each `2` creates its own arch. Change the array and refresh the browser after the development bundle rebuilds.

The car remains stable while at least half of its footprint is supported. Once more than half extends over empty space, it tips toward the unsupported side and falls under gravity, keeping its takeoff momentum until a collision. Tiles are solid slabs: the rotated car can hit their top and side faces, and its roof can hit their undersides. Arch posts and beams are also solid. Side impacts apply an impulse at the contact offset: off-center hits spin the car, while centered head-on hits mostly stop or bounce it. Crash rotation and sideways momentum settle gradually through spin damping and tire grip. After one second falling or tipping, the car respawns at the start with all motion, tilt, spin, crash recovery, and steering reset. Side and underside impacts do not reset the fall timer; a stable landing does. The camera snaps back with the car. Held driving controls remain active after respawning.

## Lap timing

The first crossing of the line beneath the first `2` tile starts the timer. Every subsequent crossing completes a lap and immediately begins the next. Crossings count in either direction; there are no checkpoints or route validation in this version. Moving past the line elsewhere on the map or beneath the track does not touch the finish trigger.

The display at the upper left shows **Current**, **Best** for this session, and **Last**. After finishing, the last lap's difference from the previous best appears in green when faster, red when slower, or neutral when equal at displayed precision. The first completed lap shows "First lap". Times use minutes, seconds, and hundredths. Session results remain until the page reloads.

Timing uses the fixed simulation steps and interpolates the actual line-crossing instant within a step. Browser pauses follow the simulation's pause handling. Respawning resets the current attempt and waits for a new start-line crossing, retaining session best and last results. Respawn teleports do not count as line crossings. The timer is plain data in `src/simulation/lap-timer.ts`; its display is separate in `src/ui/lap-display.ts`.

## Simulation and rendering

Units are **meters, seconds, and radians**, with **Y-up**. At heading zero the vehicle faces **local -Z**. Positive heading is a positive rotation about Y, turning the nose toward -X. Positive steering means left. Speed is positive forward and negative backward. Position is the bottom-center car origin; Y follows the supporting surface or free fall, and the prism sits above it.

`src/simulation/vehicle.ts` advances plain vehicle data using explicit controls and a fixed timestep. Its kinematic bicycle model computes turning from signed speed, wheelbase, and the virtual steering angle. It has no browser, Express, or Three.js dependency and can run unchanged under Node.js. Ordinary driving remains grippy; collision recovery temporarily retains lateral motion.

`src/simulation/vehicle-world.ts` combines that grounded driving model with solid collisions, ground contact, airborne movement, gravity, tipping, and respawning. Vehicle state includes pitch, roll, angular speeds, support fraction, vertical speed, lateral speed following an impact, grounded status, and time airborne. Ground support clips the heading-rotated rectangular footprint against supporting tiles, summing area across seams. Below 50% support, gravity and the support centroid produce pitch/roll toward the edge. This is a lightweight tipping approximation rather than a complete rigid-body solver. The actual tilted prism participates in solid-box contacts. Pedals and steering do not change airborne momentum; collisions remove its inward component and preserve tangential movement. Grippy grounded driving restores alignment to the heading. A stable landing before the timeout cancels the respawn timer. All timers advance using the fixed simulation timestep.

`src/simulation/collision.ts` handles plain-data ground planes and solid boxes, returning contact points, normalized normals, and impact fractions. `src/simulation/box.ts` performs swept collision detection between the entire car box, including pitch and roll, and solid colliders, covering all six faces and detecting fast movement through thin geometry. `src/simulation/body-motion.ts` resolves successive contacts at corners, retains sliding movement, and recovers existing penetration. Tangential contact with a slab top does not snag tile seams. `src/simulation/footprint.ts` provides footprint clipping and inclined-plane queries. A static spatial grid limits queries to nearby colliders. `src/track/collision.ts` builds solids from the same occupied cells and shared tile/arch dimensions as rendering. Box tops automatically provide ground support. Collider planes can describe inclined surfaces; current maps are flat. Static walls can use the same solid-box collision path; moving car-to-car contacts, general angular impulse responses, and tilted solid track pieces are not implemented yet. All collision and motion modules remain independent of Three.js and the DOM.

`src/track/model.ts` validates builder maps and applies paint strokes. `src/track/records.ts` defines shared track records and validation. `src/track/api.ts` connects the builder to the shared library; `src/track/storage.ts` retains each browser's active map and reads legacy local saves. The builder has its own browser entry point (`src/map-builder.ts`) and Express-served page (`public/map-builder/index.html`). Track surfaces render in 16-by-16 tile chunks with shared interior walls removed; adjacent flat tiles merge into larger collision boxes.

`server/track-store.ts` owns persistent shared map storage. `server/tracks-api.ts` exposes **GET /api/tracks**, **GET /api/tracks/:id**, **POST /api/tracks** with `{ name, layout }`, and **DELETE /api/tracks/:id**. The server validates names and requires a 64×64 grid with exactly one start/finish before accepting saves. Requests and failures return JSON; responses disable caching so players see current records.

`src/simulation/impact.ts` computes yaw impulses against static solids using contact velocity, contact offset, and box inertia. `vehicle-world.ts` integrates crash spin while preserving world momentum as the heading changes, then gradually restores normal grip. This remains an arcade collision response: general pitch/roll impact impulses and moving vehicle-to-vehicle collisions are future work. Rotation can generate penetration, which the existing solid-body recovery resolves each fixed step.

`src/simulation/fixed-step.ts` accumulates rendering time into **120 Hz** simulation steps. Catch-up is limited to 100 ms per frame; pauses longer than 250 ms are discarded. Visibility changes reset timing, and rendering interpolates previous/current snapshots, including heading across the angle boundary. Camera smoothing uses elapsed-time-based exponential damping.

Keyboard input, car visuals, camera behavior, track data, scene setup, and application wiring are in separate modules. `src/rendering/car.ts` loads `public/assets/car/race.fbx`, centers the four named wheel meshes on spin pivots, and steers the front-wheel pivots. Each multiplayer body gets a team-colored copy of the colormap with the original shading retained; the wheel meshes keep the original material. Keep `colormap.png` beside `race.fbx`, since the FBX references it by filename. Express serves these files with the browser app, shared track library, and Socket.IO room connections.

## Verification

```sh
npm test
npm run build
npm run test:browser
```

The Node tests cover driving, fixed-step timing, input clearing, camera following/reset, tile seams and holes, the 50% support threshold, tipping, rotated body geometry, solid contacts, gravity, respawn timing, inclined ground queries, arch collisions, lap timing, custom driving parameters, map validation/painting, preset connectivity, and track storage. Browser tests exercise keyboard driving, rendering, camera tracking, focus loss, long frame pauses, resizing, falling/tipping/respawning, solid side contacts, lap timing, live sliders, settings persistence/download/reset, panel collapse, and builder paint/save/load/play/delete flows on desktop and narrow screens.

Shared-library tests verify persistence across reopening, simultaneous saves, durable deletes, corrupt-file preservation, write failures, API validation, and separate HTTP clients. Browser tests verify sharing between independent browser contexts, publishing older local maps, and retaining drawings after a failed server save. Browser tests use a separate storage file under `test-results/` so they do not change the real library.

Driving browser checks enter a real one-player lobby and start it. Multiplayer browser checks cover live shared-track options, host/guest settings and race starts, remote car updates, leaving rooms, and isolation after switching rooms.

Browser tests use installed Microsoft Edge on Windows. On other platforms, install the test browser with `npx playwright install chromium`. Set `PLAYWRIGHT_CHANNEL=chrome` or `msedge` to select an installed browser explicitly. Browser tests start their own Express server on port 3100 and save desktop/narrow screenshots in `test-results/`.
