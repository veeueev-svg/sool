#!/usr/bin/env bash
# scripts/check_module_size.sh — إنفاذ حدود حجم الوحدة المعلنة في config/module_limits.yaml
# المالك: القيّم على المستودع | المرحلة: ورشة الهيكلة (0.24.0)
# المدخلات: config/module_limits.yaml + ملفات src/ و tests/ و scripts/
# المخرجات: 0 إذا لم يتجاوز ملفٌ سقفه | 1 مع بيان المتجاوز
# حالات الفشل: ملف التهيئة ناقص ⇒ فشل مغلق (لا يُفترض سقفٌ من الشفرة)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIMITS="$ROOT/config/module_limits.yaml"

if [ ! -f "$LIMITS" ]; then
  echo "✗ فشل مغلق: config/module_limits.yaml غير موجود — السقف لا يُفترض من الشفرة"
  exit 1
fi

CEILING="$(grep -E '^ceiling_lines:' "$LIMITS" | head -1 | tr -dc '0-9')"
if [ -z "$CEILING" ]; then
  echo "✗ فشل مغلق: ceiling_lines غير معلن في config/module_limits.yaml"
  exit 1
fi

# استثناءات معلنة: path|max_lines|item
EXC="$(grep -E '^\s*-\s*\{path:' "$LIMITS" \
  | sed -E 's/.*path:[[:space:]]*([^,}]+),[[:space:]]*max_lines:[[:space:]]*([0-9]+),[[:space:]]*item:[[:space:]]*([^}]+)\}.*/\1|\2|\3/' \
  | tr -d ' ')"

fail=0
echo "سقف الوحدة المعلن: ${CEILING} سطرًا"

# 1) كل ملف مشمول يُقاس على سقفه
while IFS= read -r file; do
  [ -z "$file" ] && continue
  n="$(wc -l < "$ROOT/$file" | tr -dc '0-9')"
  row="$(echo "$EXC" | grep -E "^${file//\//\\/}\|" || true)"
  if [ -n "$row" ]; then
    cap="$(echo "$row" | cut -d'|' -f2)"
    item="$(echo "$row" | cut -d'|' -f3)"
    if [ "$n" -gt "$cap" ]; then
      echo "✗ دَينٌ معلن ينمو: $file = $n سطرًا > سقفه الخاص $cap (البند $item) — الدَّين ينقص ولا يزيد"
      fail=1
    elif [ "$n" -le "$CEILING" ]; then
      echo "✗ استثناء لم يعد له مبرّر: $file = $n سطرًا ≤ $CEILING — احذف صفَّه من config/module_limits.yaml وأغلق البند $item"
      fail=1
    fi
  elif [ "$n" -gt "$CEILING" ]; then
    echo "✗ تجاوز السقف بلا إعلان: $file = $n سطرًا > $CEILING — فكّكه أو أعلنه دَينًا ببنده في PROGRESS.md §2"
    fail=1
  fi
done < <(cd "$ROOT" && find src tests scripts -type f -name '*.ts' | sort)

# 2) كل استثناء معلن يجب أن يوجد فعلًا
while IFS= read -r row; do
  [ -z "$row" ] && continue
  p="$(echo "$row" | cut -d'|' -f1)"
  if [ ! -f "$ROOT/$p" ]; then
    echo "✗ استثناء يشير إلى ملف غير موجود: $p — نظّف config/module_limits.yaml"
    fail=1
  fi
done < <(echo "$EXC")

if [ "$fail" -eq 0 ]; then
  echo "✓ لا وحدة تتجاوز سقفها — الاستثناءات المعلنة: $(echo "$EXC" | grep -c '|')"
fi
exit "$fail"
