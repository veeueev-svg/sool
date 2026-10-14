#!/usr/bin/env bash
# مُشغّل قياس SCALE_P99 — يُشغَّل من جذر المستودع بعد npm run build
# الاستعمال: bash run.sh <probe.mjs> <out.txt>
set -u
PROBE="$1"; OUT="$2"
PIDS=""
busy_start() { PIDS=""; for i in $(seq "$1"); do (while :; do :; done) >/dev/null 2>&1 & PIDS="$PIDS $!"; done; }
busy_stop() { kill $PIDS 2>/dev/null; wait $PIDS 2>/dev/null; PIDS=""; }
trap busy_stop EXIT
{
echo "# head: $(git rev-parse HEAD) · node $(node -v) · nproc $(nproc) · start $(date -u +%FT%TZ)"
echo "## A) probe — load=0 (10 trials)"; node "$PROBE" . 10
for L in 2 4 8; do echo "## B) probe — load=$L busy loops (3 trials)"; busy_start "$L"; node "$PROBE" . 3; busy_stop; done
echo "## C) real test file dist/tests/scale/scale_lifecycle.test.js — isolated x10 (rc captured directly, not via pipe)"
r=""; for i in $(seq 10); do node --test dist/tests/scale/scale_lifecycle.test.js >/dev/null 2>&1; r="$r $?"; done; echo "rc:$r"
echo "## D) real test file — load=8 busy loops x10"
busy_start 8; r=""; for i in $(seq 10); do node --test dist/tests/scale/scale_lifecycle.test.js >/dev/null 2>&1; r="$r $?"; done; busy_stop; echo "rc:$r"
echo "# end $(date -u +%FT%TZ)"
} > "$OUT" 2>&1
