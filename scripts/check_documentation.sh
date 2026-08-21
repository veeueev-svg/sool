#!/usr/bin/env bash
# scripts/check_documentation.sh — إنفاذ القاعدة الحاكمة RULE-000 قبل أي دفع
# الاستخدام: bash scripts/check_documentation.sh [مرجع-المقارنة]
# النتيجة: 0 إذا كان التوثيق مرافقًا للتغيير، 1 مع بيان الناقص
set -u
BASE="${1:-HEAD~1}"
CHANGED="$(git diff --name-only "$BASE" HEAD 2>/dev/null || echo '')"
if [ -z "$CHANGED" ]; then echo "لا تغييرات للمقارنة."; exit 0; fi

code_changed=$(echo "$CHANGED" | grep -E '^(src/|tests/|config/|scripts/)' || true)
progress_changed=$(echo "$CHANGED" | grep -E '^PROGRESS\.md$' || true)
report_changed=$(echo "$CHANGED" | grep -E '^docs/test-reports/' || true)

fail=0
if [ -n "$code_changed" ] && [ -z "$progress_changed" ]; then
  echo "✗ مخالفة RULE-000: تغيّر الكود بلا تحديث PROGRESS.md"; fail=1
fi
if [ -n "$code_changed" ] && [ -z "$report_changed" ]; then
  echo "✗ مخالفة RULE-008: تغيّر الكود بلا تقرير اختبار في docs/test-reports/"; fail=1
fi
if [ "$fail" -eq 0 ]; then echo "✓ التوثيق مرافق للتغيير — RULE-000 مستوفاة"; fi
exit "$fail"
