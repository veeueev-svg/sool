#!/usr/bin/env bash
# scripts/check_criteria_status.sh — يمنع تعارضَ حالة معيارٍ مع حكم تدقيقه (البند T-116)
# المالك: ديوان التاج للتدقيق
# القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
# المدخلات: COMPLETION_CRITERIA.md + docs/audit/criteria/C-*.md
# المخرجات: رمز 0 إن تطابق كل صفٍّ مع حكم ملفه، ورمز 1 عند أول اختلاف مع بيانه
# التبعيات: bash + grep + sed (لا Node — ليعمل قبل البناء)
# الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يكتب في ملفٍّ ولا يرقّي حالة
# السجلات: خرجٌ نصّي في البوابة
# حالات الفشل: حكمٌ بلا صفّ · صفٌّ بلا حكم · حالةٌ تخالف الحكم · حالةٌ ⬜ أو «جاري» ·
#   بندٌ مفتوح مذكور في الحكم ومحذوف من الصفّ
# اختبار القبول: tests/governance/criteria_status.test.ts + تشغيله في البوابة
# الوثيقة المرتبطة: docs/test-reports/phase-39.md · COMPLETION_CRITERIA.md
#
# ثوابت هذا الفحص:
#
# 1) **مصدر الحقيقة هو ملفُّ الحكم** لا الجدول: `docs/audit/criteria/C-XX.md` يكتبه المدقّق،
#    و`COMPLETION_CRITERIA.md` يرقّيه القيّم بما فيه (RULE-004). فإن اختلفا سقطت البوابة،
#    ولا يُصلح الفحصُ الاختلافَ من عنده — الإصلاح فعلُ جهةٍ لا فعلُ أداة.
#
# 2) **لا حالة خارج المفردات الثلاث**: «مستوفى» و«فجوة» و«اكتُفي بتقرير المنفّذ». وكل ⬜
#    أو «جاري» أو «جزئي» تُسقط الفحص — لأن غموض الحالة هو ما أوجب البند T-108.
#
# 3) **البند المفتوح يُقرأ أيضًا**: لا يكفي أن تتطابق الحالة ويُحذف اسمُ البند، فالفجوةُ
#    بلا اسمٍ لا تُطالَب.
set -euo pipefail

# جذرُ الفحص. الافتراضُ جذرُ المستودع، ويُبدَّل بـ`SOOL_CHECK_ROOT` ليُختبر الفاحصُ على
# **جذرٍ منسوخٍ** لا على ملفّات المستودع الحقيقيّة (W-2026-004): إذ يشغّل node ملفّاتِ
# الاختبار بالتوازي، فتحريفُ ملفٍّ حقيقيٍّ في اختبارٍ يُقرأ حكمًا في آخر.
cd "${SOOL_CHECK_ROOT:-$(dirname "$0")/..}"
CRITERIA_FILE="COMPLETION_CRITERIA.md"
CRITERIA_DIR="docs/audit/criteria"
fail=0

echo "فحص تطابق حالات المعايير مع أحكام التدقيق (T-116)"

for f in "$CRITERIA_DIR"/C-*.md; do
  id="$(basename "$f" .md)"

  verdict="$(sed -n 's/^- الحكم: \*\*\(.*\)\*\*.*/\1/p' "$f" | head -1)"
  item="$(sed -n 's/^- البند المفتوح إن كان فجوة: //p' "$f" | head -1)"
  if [ -z "$verdict" ]; then
    echo "✗ $id: ملفُّ الحكم بلا سطر «- الحكم: **…**»"
    fail=1
    continue
  fi

  row="$(grep -m1 "^| $id |" "$CRITERIA_FILE" || true)"
  if [ -z "$row" ]; then
    echo "✗ $id: له حكمٌ في $CRITERIA_DIR ولا صفَّ له في $CRITERIA_FILE"
    fail=1
    continue
  fi

  # الأعمدة: | # | المعيار | السند | الحالة | البند المفتوح |
  status="$(printf '%s' "$row" | awk -F'|' '{print $5}' | sed 's/^ *//;s/ *$//')"
  row_item="$(printf '%s' "$row" | awk -F'|' '{print $6}' | sed 's/^ *//;s/ *$//')"

  case "$status" in
    "✅ مستوفى") row_verdict="مستوفى" ;;
    "⚠️ فجوة") row_verdict="فجوة" ;;
    "🟡 اكتُفي بتقرير المنفّذ") row_verdict="اكتُفي بتقرير المنفّذ" ;;
    *)
      echo "✗ $id: حالةٌ غير معلنة «$status» — المسموح: «✅ مستوفى» أو «⚠️ فجوة» أو «🟡 اكتُفي بتقرير المنفّذ»"
      fail=1
      continue
      ;;
  esac

  if [ "$row_verdict" != "$verdict" ]; then
    echo "✗ $id: الجدول يقول «$row_verdict» وحكمُ التدقيق يقول «$verdict» — الحكم أولى ($f)"
    fail=1
    continue
  fi

  if [ "$verdict" != "مستوفى" ] && [ "$row_item" = "—" ] && [ "$item" != "—" ]; then
    echo "✗ $id: فجوةٌ بلا اسم بند في الجدول، وحكمُها يذكر «$item»"
    fail=1
    continue
  fi
done

# لا صفَّ في الجدول بلا ملفِّ حكم
while read -r id; do
  [ -f "$CRITERIA_DIR/$id.md" ] || { echo "✗ $id: صفٌّ في $CRITERIA_FILE بلا ملفِّ حكم في $CRITERIA_DIR"; fail=1; }
done < <(sed -n 's/^| \(C-[0-9][0-9]\) |.*/\1/p' "$CRITERIA_FILE")

if [ "$fail" -ne 0 ]; then
  echo "✗ تعارضٌ بين حالات المعايير وأحكام التدقيق — راجع $CRITERIA_FILE و$CRITERIA_DIR (T-116)"
  exit 1
fi

met=$(grep -c '| ✅ مستوفى |' "$CRITERIA_FILE" || true)
gap=$(grep -c '| ⚠️ فجوة |' "$CRITERIA_FILE" || true)
rep=$(grep -c '| 🟡 اكتُفي بتقرير المنفّذ |' "$CRITERIA_FILE" || true)
echo "✓ كل حالةٍ مطابقةٌ لحكم تدقيقها — مستوفى $met · فجوة $gap · اكتُفي $rep"
if [ "$gap" -ne 0 ] || [ "$rep" -ne 0 ]; then
  echo "ℹ️ لا إعلان: $((gap + rep)) معيارًا ليس ✅ (قاعدة الإعلان في $CRITERIA_FILE)"
fi
