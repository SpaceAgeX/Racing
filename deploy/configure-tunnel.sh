#!/bin/bash
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo "Run with sudo."; exit 1; fi
echo "Paste the token for the NEW racing tunnel (input is hidden)."
IFS= read -r -s token
echo
if [ -z "$token" ]; then echo "No token supplied."; exit 1; fi
umask 077
temporary=$(mktemp /etc/racing/tunnel-token.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT
printf '%s' "$token" > "$temporary"
unset token
chown root:racing "$temporary"
chmod 640 "$temporary"
mv -- "$temporary" /etc/racing/tunnel-token
systemctl enable --now racing-cloudflared.service
systemctl is-active racing-cloudflared.service
