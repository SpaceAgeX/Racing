#!/bin/bash
set -euo pipefail
export RACING_RECORDINGS_DIR=/var/lib/racing/recordings
cd /opt/racing/current
exec /opt/racing/node/bin/node scripts/record.ts "$@"
