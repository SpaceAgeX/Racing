# Pi deployment and recording

The game runs as the dedicated `racing` user on `127.0.0.1:3000`, through `racing.service`.
Code: `/opt/racing/current` (release symlink). Isolated Node 24: `/opt/racing/node`.
Spline maps: `/var/lib/racing/tracks-splines-v2.json` with the existing `TRACKS_FILE=/var/lib/racing/tracks.json` setting. Legacy tile data remains untouched. Set `SPLINE_TRACKS_FILE` to choose a different spline store. Recordings: `/var/lib/racing/recordings`.
The existing applications and existing cloudflared service are separate.

## Finish Cloudflare setup

1. In Cloudflare Zero Trust, create a **new Cloudflare Tunnel** named `racing`.
2. Add a published application route: hostname `racing.aryehlab.com`, service `http://127.0.0.1:3000`.
3. On the Pi run `sudo bash /opt/racing/current/deploy/configure-tunnel.sh`. Paste ONLY the new tunnel's token when prompted. It is stored outside Git, readable by root and the racing group.
4. If Access covers racing through a wildcard/default-deny policy, create an exact-hostname application for `racing.aryehlab.com` with **Bypass / Include Everyone**. Keep the other applications' policies unchanged.
5. Test in a private browser window without signing into Access.

The separate `racing-cloudflared.service` remains stopped until you supply its token.
Do not run `cloudflared service install`: that would target the existing shared service.

## Admission

Production permits 15 active anonymous **browser sessions across the site**, not 15 per room.
The 16th browser receives HTTP 503 and a Server full page. APIs, assets, and multiplayer require an admitted cookie.
The health endpoint is accessible without a slot. Tabs in one browser profile share one session; only one multiplayer
connection is allowed per session. This cannot identify distinct humans without login.
Heartbeats cover menus, solo races and map builder. Places expire after 120 seconds without requests/heartbeats.
Long-suspended tabs can expire and must reload. Restarting the server clears sessions and lobbies.
`MAX_BROWSER_SESSIONS=0` disables admission for isolated automated tests; production uses 15.

## Record a benchmark

Run on the Pi. The CLI updates local control files; the game server must remain running.
`--tomorrow` uses the Pi timezone (America/New_York), from the next midnight to the following midnight, including DST changes.

```sh
sudo -u racing bash /opt/racing/current/deploy/recorder.sh schedule --tomorrow
sudo -u racing bash /opt/racing/current/deploy/recorder.sh status
```

Explicit window (timezone required):

```sh
sudo -u racing bash /opt/racing/current/deploy/recorder.sh schedule --start 2026-10-14T08:00:00-04:00 --stop 2026-10-15T00:00:00-04:00
```

Start now until local midnight, stop early, and analyze the latest selected run:

```sh
sudo -u racing bash /opt/racing/current/deploy/recorder.sh start
sudo -u racing bash /opt/racing/current/deploy/recorder.sh stop
sudo -u racing bash /opt/racing/current/deploy/recorder.sh analyze latest
```

Logs rotate hourly inside `run-*` directories. Schedules survive server restarts; recording resumes if still in the window.
Analysis streams files using bounded histograms and writes `analysis.json` plus a terminal summary of averages,
approximate p95s, maxima, disconnects, probe timeouts and the worst server-stall timestamps.
Logs are not served publicly or committed. Copy a run directory and analysis.json back for review.

CPU is percent of one core. Position traffic is estimated JSON payload bytes, excluding TLS/framing/retransmissions.
HTTP content-length totals are separate; missing lengths are counted. RTT uses Socket.IO acknowledgement probes,
including browser scheduling; timeouts do not prove packet loss. Client diagnostics come from connected multiplayer
clients, with hidden-tab FPS excluded. The server relays positions rather than simulating authoritative physics.
CPU scheduling weight and memory limits are part of the benchmark environment. Host load averages are logged;
temperature sensor collection is not included.

## Operations

```sh
sudo systemctl status racing racing-cloudflared
sudo journalctl -u racing -n 50 --no-pager
curl http://127.0.0.1:3000/healthz
```

Rollback: point `/opt/racing/current` to a previous tested release and restart only `racing.service`.
Stop public racing by stopping only `racing-cloudflared.service`.
Updates use a new release directory, `npm ci`, `npm run build`, then switch the symlink.
Never overwrite `/var/lib/racing` when updating code.
