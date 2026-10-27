# Driving prototype

Pi deployment, the global 15-session admission limit, Cloudflare setup, and benchmark recorder commands are documented in [deploy/README.md](deploy/README.md).

A browser racing prototype using Three.js and TypeScript, served by Node.js and Express with Socket.IO race rooms. The scene contains animated car models, spline roads with elevation, a start/finish arch, sunlight, ambient light, and a smooth following camera. Wide red strips trace exposed road edges, and a continuous white line follows the road center in races and the 3D builder preview.

## Run locally with hosted Supabase

Docker is not required. Create a hosted Supabase project, copy `.env.example` to the ignored `.env.local`, and set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `DATABASE_URL`. The database URL comes from the project's **Connect** panel; use the direct connection when IPv6 works, or the **Session pooler** on port 5432 for IPv4. Keep the database password out of Git. Apply `supabase/migrations/` to a new project with `npx.cmd --no-install supabase db push --db-url "YOUR_DATABASE_URL" --skip-vault` (the CLI does not need Docker for this command), then run:

```sh
npm install
npm run dev
```

Open **http://localhost:3000**. In Windows PowerShell with script execution disabled, use `npm.cmd install` and `npm.cmd run dev`. This project's ignored `.env.local` already points to its hosted development database. The local Docker database, if still present, is separate and its test users are not copied.

For Google sign-in, enable **Google** under the hosted project's **Authentication → Providers** using the Web OAuth client ID and secret. Add `https://YOUR_PROJECT.supabase.co/auth/v1/callback` to that client's authorized redirect URIs in Google Cloud. In Supabase **Authentication → URL Configuration**, set the Site URL to `http://localhost:3000` while testing and allow `http://localhost:3000/**` (and `http://127.0.0.1:3000/**` if used). Set `GOOGLE_SIGN_IN_ENABLED=true` in `.env.local` only after the hosted provider is enabled, then restart the game. Add the production domain and its redirects when deploying.

## Optional Docker-based Supabase

Install Node.js 24 or newer and Docker Desktop. Start Docker Desktop, then run from this directory:

```sh
npm install
npx supabase start
npx supabase migration up --local
```

Open **http://127.0.0.1:3000** with a local Docker configuration. In Windows PowerShell with script execution disabled, use `npm.cmd install` and `npm.cmd run dev`.

On this Windows setup, `npx.cmd --no-install supabase start --network-id racing-supabase-local` starts the local database. If Supabase says `docker: command not found` even though Docker Desktop is installed, add its CLI to the current PowerShell session first: `$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"`. The repository needs a private `.env.local` with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `DATABASE_URL`; copy `.env.example` and use the values printed by `supabase start`. `.env.local` is ignored by Git. The account database schema is in `supabase/migrations/`; apply pending migrations with `npx.cmd --no-install supabase migration up --local`. Then run `npm.cmd run dev`. Supabase Studio is normally at **http://127.0.0.1:54323**, and Mailpit catches local account confirmation emails at **http://127.0.0.1:54324**. To stop this project's stack while keeping its data, run `npx.cmd --no-install supabase stop --project-id Racing`. Run every CLI command from this repository's root, not your home directory.

The development command builds the browser bundle with esbuild, serves it through Express, and watches browser TypeScript changes. Refresh after browser edits; restart `npm.cmd run dev` after changing server code. Set `PORT` to change the port and `HOST` to change the bind address.

Express listens on all IPv4 network interfaces by default (`0.0.0.0`). Other devices on the same network can open **http://YOUR-COMPUTER-IP:3000**; startup prints the available network URLs. Keep the server running while they play. If Windows Firewall asks, allow Node.js on your private network. Players can create or join the same race room. To restrict access to this computer, set `HOST=127.0.0.1`. Devices outside your local network require additional router/network configuration.

## Accounts and test data

Unauthenticated visitors are sent to `/login/`; `/signup/` is a separate create-account page. Email signup asks for a 3–20 character username, which is unique without regard to letter case. Returning sessions are restored by Supabase Auth. Existing accounts and new Google accounts without a username finish setup at `/signup/` before racing. The account dashboard is at `/account/`. Email/password signup works without an external provider. With local Docker Supabase, Mailpit catches confirmation emails; with hosted Supabase, check the mailbox you signed up with.

For the optional Docker-based provider, create a **Web application** OAuth client in Google Cloud. Add `http://localhost:3000` (and `http://127.0.0.1:3000` if used) as authorized JavaScript origins and `http://127.0.0.1:54321/auth/v1/callback` as the authorized redirect URI. Add your Google test account to the OAuth audience if the app is in testing mode. In an ignored repository-root `.env`, set `GOOGLE_OAUTH_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`. Set `enabled = true` in `[auth.external.google]` in `supabase/config.toml`, and set `GOOGLE_SIGN_IN_ENABLED=true` in `.env.local`. Restart the local Supabase stack (`supabase stop --project-id Racing`, then `supabase start --network-id racing-supabase-local`) and restart the game. Do not commit either secret. The Google button stays disabled until the game setting is enabled. See the [Supabase Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google) and [local configuration guide](https://supabase.com/docs/guides/local-development/managing-config). The hosted project later needs its own Supabase callback, Site URL `https://racing.aryehlab.com`, and allowed login/signup redirects.

The browser uses only the publishable key. Express checks the user's access token for every account/track API call and Socket.IO connection; its private Postgres connection writes tracks and results. The database rejects duplicate usernames, direct browser writes to lap results, and permission changes. The account dashboard shows server-recorded laps, ranked laps, race starts, play time, distance, tracks created, personal bests by track, and recent times. Everyone can build private, unranked tracks for solo play. Only accounts with `public.profiles.can_publish_ranked_tracks=true` can publish ranked tracks; those tracks appear in multiplayer and on leaderboards. The account page displays the user's approval status. Existing accounts are approved and existing database tracks ranked by the migration; new accounts start unapproved.

The Pi's existing spline JSON library can be imported into Supabase with `scripts/import-tracks.ts`. The import preserves IDs and layouts, makes those legacy maps system-owned and ranked, and never overwrites a conflicting database record. Keep a backup of the Pi's JSON file before importing it.

For a production bundle:

```sh
npm run build
npm start
```

## Race rooms

The home screen lists open lobbies. Create a lobby or join an existing one. The server uses each signed-in account's username as the player's name and names new rooms **[Username]'s Lobby**. The host can change the track and **Start race**; other players see the same room settings. The map and cars load when the host starts. A one-player room can be used for solo testing. **Leave lobby** or **Leave game** returns to the home screen. Rooms exist in memory and disappear when everyone leaves or the server restarts.

The home menu offers Time Trial, Multiplayer Race, Map Builder, and an account dashboard. Choose a track and color before a time trial; multiplayer hosts choose the track and can expand advanced handling in the lobby. Guests see the chosen track and ranked status but cannot edit the track or handling. Each race keeps its own spline-layout snapshot, so edits to the library do not replace a race in progress.

Multiplayer races and solo time trials use a 60 Hz server simulation. Browsers send numbered controls, predict their own car, and correct it from 20 Hz server snapshots; remote cars interpolate on the server tick timeline. The server owns car positions, track contacts, checkpoint progress, respawns, and lap decisions for each isolated room or solo session. Reliable transition events confirm respawns, timer starts, and completed laps between ordinary snapshots. Networked clients keep predicting motion while falling, but wait for server confirmation before teleporting and resetting the timer together. The `[` diagnostics console shows actual server ticks per second, pending inputs, and the latest position correction. Cars do not collide with one another and may pass through each other. Solo time trials start with default handling. Changing handling during a solo session makes its laps unranked. Multiplayer laps on ranked tracks count when the lobby races with default handling; custom lobby handling makes them unranked. The leaderboard uses the best verified lap per account for the current track layout and default handling version.

## Controls and tuning

- **W:** accelerate forward, or brake while reversing.
- **S:** brake while moving forward, then accelerate backward once stopped.
- **A / D:** steer left / right. Releasing the keys centers steering.
- **W + S:** brake to a stop.

Releasing both pedals coasts under drag. Held inputs clear when the window loses focus or the document becomes hidden.

The bottom-left minimap shows the road footprint, a white finish line, blue checkpoints, and car arrows in player colors. It stays north-up, fits the occupied area, and tracks falls and respawns. Time-trial and lobby previews use the same 2D map without player arrows.

All driving values are in `src/simulation/parameters.ts`: forward and reverse acceleration, braking, speed caps, drag, wheelbase, steering limits, steering speed, and centering speed. Default forward acceleration is **40 m/s²**, reverse acceleration is **25 m/s²**, top speed is **70.5 m/s (253.8 km/h)**, and reverse speed is **30 m/s (108 km/h)**. Steering limits decrease with speed for stable arcade handling. The follow camera's offsets and smoothing rates are in `src/rendering/camera.ts`. Each new time trial starts with source defaults.

The same parameters file contains `physicsParameters`: gravity, the one-second respawn delay, ground contact snap distance, collision bounce, spin damping, crash tire grip, and crash recovery time. The **Crashes** sliders in the Handling panel tune these collision values live.

The **Handling** panel on the right has live sliders for every driving and falling parameter. It starts hidden; open it with **Tuning**. Changes apply immediately and mark the entire time-trial session unranked, even if you reset the sliders later. It shows current speed and offers **Reset defaults** and **Save settings** (downloads `racing-handling.json`). Steering angles show radians and degrees; speed limits show m/s and km/h. High-speed steering is kept at or below the maximum steering angle. The next time trial starts with default handling again. Browser tuning changes do not modify the source defaults.

## Track layout

Open **http://127.0.0.1:3000/map-builder/**, or use **Map Builder** on the main menu. The cubic B?zier road-graph editor has six tools. Steps 1-4 are the top-down phase: **Add points**, **Connect points**, **Edit curves**, and **Set widths**. Place independent points, then explicitly connect any two existing points. Connect Points never creates points; clicking empty canvas space clears its active selection so another connection can start elsewhere. Consecutive point clicks still chain connections, and several connections can branch from the same point. In Edit Curves, selecting a point reveals the handles for all curves attached to it. Smooth handles remain aligned, Symmetric handles are also equal in length, and Corner handles move independently; junctions with more than two connections use Corner because there is no unambiguous opposite handle. Set Widths provides a default measured in meters and a per-point override; connections render as 2D road ribbons that interpolate between endpoint widths by distance. Default changes continue to update points that have not been individually customized. Moving points slides them around a small exclusion radius instead of allowing overlap.

Step 5 is **Finish line**. Click a connection to place the finish line and preview the space reserved behind it for ten cars in five rows of two, with each car receiving a distinct spawn position. Every row follows the Bézier centerline and its local direction when the finish is on a curve. Placement requires 29 m of the selected connection between the line and either endpoint so the full section fits in both directions. The connection's start-to-end direction defines forward and can be flipped. Up to three optional, unordered checkpoints can also be placed on connections for lap validation; racers may cross them in any order. Step 6 is **Set heights**. Select a point to assign a height from -50 m to +50 m and a steepness value; the transition between point heights always rounds off automatically. Its 3D view includes the checkered line and overhead finish arch used by playable races, plus blue checkpoint strips conformed to the spline track's elevation. Checkpoints are omitted from the 2D inset during this 3D step to keep it uncluttered. Curves are adaptively sampled into variable-width road pieces, quantized to fixed-precision coordinates, and combined with a polygon union before triangulation. The footprint is triangulated in small shared-edge cells, with elevation taken from the nearest sampled centerline, then the top, bottom, and perimeter walls are built as one constant-thickness solid mesh. This keeps turns, branches, and overlapping widths free of internal faces or coplanar seams. Drag to orbit and scroll to zoom; panning is disabled. Tight-radius and degenerate curves produce non-blocking warnings rather than preventing editing. Editor previews, races, and collisions use the same solid geometry. Continuous offset edges replace per-sample caps, avoiding serrated boundaries on curves. True overpasses are not represented yet because crossing footprints are deliberately unioned into one surface. The editor adapts to desktop, short, and phone-sized windows.

A track can be saved only when it has at least two points, valid connections, and one valid finish line. It need not be a closed loop, and checkpoints are optional. Both the editor and server validate this. Name the track, choose **Personal** or (if approved) **Ranked**, then use **Save** or **Save & play**. Personal tracks are visible only to their creator and can be raced solo without leaderboard times. Ranked tracks are shared and playable in multiplayer. Saving under an existing name updates that owner's track; drafts are not saved when you refresh.

The server writes version-2 spline graphs to **data/tracks-splines-v2.json**. Set **SPLINE_TRACKS_FILE** to override the path. If only the older **TRACKS_FILE** variable is set, the spline store uses a sibling ending in **-splines-v2.json**. Old tile files remain untouched but are not listed as playable spline tracks. There is no automatic tile-to-spline conversion. Browser selections also use separate version-2 storage keys.

Permanent presets are **Default circuit**, a loop with an inward chicane, and **Simple loop track**, a rounded rectangular loop. They are generated in **src/track/spline-presets.ts** and cannot be deleted; save a named copy to customize them. Graph coordinates map onto the editor's world area, with X to the right and Z down on the 2D map. Height is Y in meters; the road solid is 1.5 m thick. Ten starting slots follow the finish-line direction and road elevation.

The car remains stable while at least half of its footprint is supported. Once more than half extends over empty space, it tips toward the unsupported side and falls under gravity, keeping its takeoff momentum until a collision. Roads are solid meshes: the rotated car can hit their top and exposed side faces, and its roof can hit their undersides. Arch posts and beams are also solid. Side impacts apply an impulse at the contact offset: off-center hits spin the car, while centered head-on hits mostly stop or bounce it. Crash rotation and sideways momentum settle gradually through spin damping and tire grip. After one second falling or tipping, the car respawns at the start with all motion, tilt, spin, crash recovery, and steering reset. Side and underside impacts do not reset the fall timer; a stable landing does. The camera snaps back with the car. Held driving controls remain active after respawning.

## Lap timing

The first crossing of the finish line starts the timer. A subsequent crossing completes a lap only after every checkpoint has been crossed, in any order. Repeated crossings of one checkpoint count once. An incomplete finish crossing keeps the timer and checkpoint progress running; a completed lap clears progress for the next lap. Tracks without checkpoints count each finish crossing as before. Gates follow the road direction and elevation; passing beside or below them does not count.

The display at the upper left shows **Current**, **Best**, and **Last**. In time trials, Best includes the signed-in player's server-recorded laps on that track across sessions; in multiplayer, it shows the current race's best. After finishing, the last lap's difference from the previous best appears in green when faster, red when slower, or neutral when equal at displayed precision. Times use minutes, seconds, and hundredths. Multiplayer also shows each room member's best lap and completed-lap count in a live board on the left.

Timing uses the server's fixed simulation steps and interpolates the actual line-crossing instant within a step. Hiding or pausing a browser does not change the server timer. Respawning resets the current attempt and waits for a new start-line crossing, retaining session best and last results. Respawn teleports do not count as line crossings. The timer is plain data in `src/simulation/lap-timer.ts`; its display is separate in `src/ui/lap-display.ts`.

## Simulation and rendering

Units are **meters, seconds, and radians**, with **Y-up**. At heading zero the vehicle faces **local -Z**. Positive heading is a positive rotation about Y, turning the nose toward -X. Positive steering means left. Speed is positive forward and negative backward. Position is the bottom-center car origin; Y follows the supporting surface or free fall, and the car model sits above it.

`src/simulation/vehicle.ts` advances plain vehicle data using explicit controls and a fixed timestep. Its kinematic bicycle model computes turning from signed speed, wheelbase, and the virtual steering angle. It has no browser, Express, or Three.js dependency and can run unchanged under Node.js. Ordinary driving remains grippy; collision recovery temporarily retains lateral motion.

`src/simulation/spline-vehicle.ts` combines that grounded driving model with solid collisions, ground contact, airborne movement, gravity, tipping, and respawning. Vehicle state includes pitch, roll, angular speeds, support fraction, vertical speed, lateral speed following an impact, grounded status, and time airborne. Ground support clips the heading-rotated rectangular footprint against supporting road triangles, summing area across seams. Below 50% support, gravity and the support centroid produce pitch/roll toward the edge. This is a lightweight tipping approximation rather than a complete rigid-body solver. The actual tilted prism participates in mesh contacts. Pedals and steering do not change airborne momentum; collisions remove its inward component and preserve tangential movement. Grippy grounded driving restores alignment to the heading. A stable landing before the timeout cancels the respawn timer. All timers advance using the fixed simulation timestep.

**src/track/road-geometry.ts** builds the shared top, underside, perimeter walls, finish posts, and starting positions. **src/rendering/road.ts** batches these into road meshes. **src/simulation/road-world.ts** uses a spatial grid and swept oriented-box/triangle tests for full-body contacts. Only exposed boundaries have walls, and touching a road top while driving outward does not collide with its side. Ground support sums the footprint area clipped against nearby top triangles. Driving follows surface height and normal; leaving an edge retains momentum. **src/simulation/body-motion.ts** resolves successive contacts and penetrations. These modules use plain data, without Three.js or DOM dependencies. True overpasses and moving vehicle-to-vehicle contacts remain future work.

**src/track/spline.ts** defines nodes, connections, B?zier handles, width and height interpolation. **src/track/spline-records.ts** validates the versioned save format. The builder has a separate browser entry point (**src/map-builder.ts**). Legacy tile helpers remain only for their existing regression tests; playable races use spline geometry.

**server/accounts.ts** uses Supabase Auth to verify access tokens and Postgres to store profiles, tracks, activity, and completed laps. **server/accounts-tracks-api.ts** exposes the account-scoped track API. The server validates names, graph references, bounds, finish placement, checkpoints, ownership, and ranked publishing approval before writing. New accounts can save personal maps but cannot publish ranked multiplayer maps until `public.profiles.can_publish_ranked_tracks` is granted by an administrator. Existing JSON tracks are not deleted or imported automatically; the one-time `scripts/import-tracks.ts` tool imports them as ranked maps during the later Pi migration.

`src/simulation/impact.ts` computes yaw impulses against static solids using contact velocity, contact offset, and box inertia. `spline-vehicle.ts` integrates crash spin while preserving world momentum as the heading changes, then gradually restores normal grip. This remains an arcade collision response: general pitch/roll impact impulses and moving vehicle-to-vehicle collisions are future work. Rotation can generate penetration, which the existing solid-body recovery resolves each fixed step.

`src/simulation/fixed-step.ts` accumulates rendering time into **60 Hz** prediction steps for races. Catch-up is limited to 100 ms per frame; pauses longer than 250 ms are discarded. Visibility changes reset timing, and rendering interpolates previous/current snapshots, including heading across the angle boundary. Camera smoothing uses elapsed-time-based exponential damping.

Keyboard input, car visuals, camera behavior, track data, scene setup, and application wiring are in separate modules. `src/rendering/car.ts` loads `public/assets/car/race.fbx`, centers the four named wheel meshes on spin pivots, and steers the front-wheel pivots. Each multiplayer body gets a team-colored copy of the colormap with the original shading retained; the wheel meshes keep the original material. Keep `colormap.png` beside `race.fbx`, since the FBX references it by filename. Express serves these files with the browser app, shared track library, and Socket.IO room connections.

## Verification

```sh
npm test
npm run build
npm run test:browser
```

The Node tests cover driving, fixed-step timing, input clearing, camera following/reset, tile seams and holes, the 50% support threshold, tipping, rotated body geometry, solid contacts, gravity, respawn timing, inclined ground queries, arch collisions, lap timing, custom driving parameters, legacy map validation, spline graphs and spacing, preset connectivity, and track storage. Browser tests exercise keyboard driving, rendering, camera tracking, focus loss, long frame pauses, resizing, falling/tipping/respawning, solid side contacts, lap timing, live sliders, settings persistence/download/reset, panel collapse, and spline-graph editing on desktop, narrow, and short screens.

Legacy JSON-store unit tests still verify persistence across reopening, simultaneous saves, durable deletes, corrupt-file preservation, write failures, API validation, and separate HTTP clients. Browser tests create a temporary local Supabase account, approve it for map building, and delete its tracks and account afterward. They do not touch the hosted database or Pi maps.

Spline tests cover save validation, full solid geometry, slopes, edge departure, arch impacts, distinct starting slots, and unordered checkpoints. Browser checks cover editing, saving, loading, playing, and deleting a shared spline track. Multiplayer browser checks cover live shared-track options, host/guest settings and race starts, remote car updates, leaving rooms, and isolation after switching rooms.

Browser tests use installed Microsoft Edge on Windows. On other platforms, install the test browser with `npx playwright install chromium`. Set `PLAYWRIGHT_CHANNEL=chrome` or `msedge` to select an installed browser explicitly. Browser tests start their own Express server on port 3100 and save desktop/narrow screenshots in `test-results/`.
