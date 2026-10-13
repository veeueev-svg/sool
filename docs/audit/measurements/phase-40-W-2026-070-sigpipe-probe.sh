#!/usr/bin/env bash
# مسبار قياس PIPESTATUS مباشرة — W-2026-070
set -euo pipefail
closed_ids="$(printf 'T-16\nT-21\nT-23\nT-31\nT-110\n')"
for t in T-16 T-21 T-23 T-31 T-110; do
  set +e
  printf '%s\n' "$closed_ids" | grep -qx "$t"
  statuses=("${PIPESTATUS[@]}")
  set -e
  printf 't=%s printf=%s grep=%s\n' "$t" "${statuses[0]}" "${statuses[1]}"
done
