# DigitalOcean droplet deployment

The droplet uses the same Supabase project and Cloudflare `racing` tunnel as the Pi. The site must have only one active tunnel connector while lobbies and the 15-browser admission limit live in one Node process. Do not run both connectors as replicas.

As of October 29, 2026, `racing.aryehlab.com` is served by the droplet. Its `racing.service` and `racing-cloudflared.service` are enabled and active. Both dedicated racing services on the Pi are disabled and stopped; its unrelated shared Cloudflare connector remains active.

## Layout

- Game: `/opt/racing/current` points to a release under `/opt/racing/releases/`.
- Private settings: `/etc/racing/server.env` (`root:racing`, mode `640`). The droplet's IPv4-only network uses Supabase's **session pooler** on port 5432. Never commit this file.
- Track-file backup: `/var/lib/racing/tracks-splines-v2.json` and `/var/lib/racing/tracks.json`. Current accounts, tracks, and lap results are in the existing Supabase project. Do not reset or re-import the database during a move.
- Tunnel credential: `/etc/racing/tunnel-token` (`root:racing`, mode `640`); the dedicated `racing-cloudflared.service` is now enabled on the droplet.
- The game listens on `127.0.0.1:3000`. Cloudflare Tunnel provides the public hostname; no inbound game port is needed.

The droplet installs `deploy/racing-droplet.service` as `/etc/systemd/system/racing.service` and `deploy/racing-cloudflared-droplet.service` as `/etc/systemd/system/racing-cloudflared.service`. These differ from the Pi units because Node and cloudflared are installed at `/usr/bin/` on the droplet.

## Verify current deployment

```sh
ssh -l root racing 'systemctl is-active racing.service; curl -fsS http://127.0.0.1:3000/healthz'
ssh -l root racing 'systemctl is-enabled racing-cloudflared.service; systemctl is-active racing-cloudflared.service'
ssh pi4-remote 'systemctl is-active racing.service racing-cloudflared.service'
```

The droplet game and tunnel should both report `active`. Browser sign-in, track selection, solo racing, and multiplayer still need a public smoke test after cutover.

## Cutover and rollback

The cutover has been performed. These are the commands used if a future move is needed. Plan a quiet time because in-memory lobbies and browser admission slots cannot transfer between servers. Stop the **Pi's dedicated racing tunnel only** and start the droplet's dedicated racing tunnel. Do not stop the Pi's shared `cloudflared` service or other applications. With the existing hostname route and token, no DNS or Google OAuth URL change is needed.

```sh
ssh pi4-remote 'sudo systemctl disable --now racing-cloudflared.service'
ssh pi4-remote 'sudo systemctl disable --now racing.service'
ssh -l root racing 'systemctl enable --now racing-cloudflared.service'
```

Check `https://racing.aryehlab.com/healthz` and load the login page in a private browser window. Then test account login, a ranked track and multiplayer with a second account. The existing Supabase records remain shared.

If the public site fails, reverse the two service actions:

```sh
ssh -l root racing 'systemctl disable --now racing-cloudflared.service'
ssh pi4-remote 'sudo systemctl enable --now racing.service'
ssh pi4-remote 'sudo systemctl enable --now racing-cloudflared.service'
```

Keep the Pi game service and track files intact until the droplet has passed real browser testing. Review `journalctl -u racing -u racing-cloudflared --no-pager -n 100` on the droplet if needed.
