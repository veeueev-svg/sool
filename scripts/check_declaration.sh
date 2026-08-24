#!/usr/bin/env bash
# scripts/check_declaration.sh — يمنع إعلانَ 100% وفي الدولة بندٌ مفتوح (البند T-127 · المرحلة 40)
# المالك: القيّم على المستودع (والإعلانُ نفسُه للملك — RULE-004)
# القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
# المدخلات: version.json + COMPLETION_CRITERIA.md + PROGRESS.md §2 + ROADMAP.md + docs/royal-orders/
# المخرجات: رمز 0 إن كانت دعوى الإصدار مطابقةً لحال الدولة، ورمز 1 عند أول تعارضٍ مع بيانه
# التبعيات: bash + grep + sed + awk (لا Node — ليعمل قبل البناء، كأخيه check_criteria_status.sh)
# الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يُرقّي نسبةً ولا يوقّع أمرًا ولا يُغلق بندًا
# السجلات: خرجٌ نصّي في البوابة
# حالات الفشل: نسبةٌ 100% وثمّ صفٌّ ليس ✅ · نسبةٌ 100% وثمّ بندٌ مفتوح في §2 ·
#   royal_approval ليس pending بلا أمرٍ موقَّعٍ مقيَّد بـauditId · المرحلة 40 في phases_complete
#   بلا أمر · حصيلةُ COMPLETION_CRITERIA.md لا تطابق صفوفَه · عددُ ROADMAP.md لا يطابق §2 ·
#   أمرٌ ملكيٌّ بلا auditId
# اختبار القبول: tests/governance/declaration_gate.test.ts + تشغيله في البوابة
# الوثيقة المرتبطة: docs/test-reports/phase-40.md · COMPLETION_CRITERIA.md §«قاعدة الإعلان»
#
# ثوابت هذا الفحص:
#
# 1) **الإعلانُ أثرٌ لا احتفال**: «فجوة واحدة مفتوحة = لا إعلان» مكتوبةٌ في
#    COMPLETION_CRITERIA.md وROADMAP.md وPROGRESS.md — وكانت **نصيحةً تُقرأ**: أخوه
#    check_criteria_status.sh يطبع «ℹ️ لا إعلان» ثم **يخرج بالرمز 0**. فهذا الملفُّ يجعلها
#    **قاعدةً تُسقط**. ومن كتب قاعدةً في ثلاث وثائق ولم يجعل لها حاجزًا كتب رجاءً لا حكمًا.
#
# 2) **الفحصُ لا يُعلن ولا يمنع الإعلانَ الصحيح**: لا يشترط أن تكون النسبةُ 100%، ولا يرقّيها
#    إن استُوفي كلُّ شيء — فالإعلانُ فعلُ الملك بأمرٍ موقَّع (C-20 · المرحلة 40)، وهذا الحاجزُ
#    يمنع **الدعوى بلا سند** في الاتجاهين: لا نسبةَ تسبق الاستيفاء، ولا استيفاءَ يُبتلع.
#
# 3) **الفارغُ ليس استيفاءً (RULE-001)**: وجودُ ملفِّ أمرٍ في docs/royal-orders/ لا يكفي —
#    يُشترط `auditId` غيرُ فارغ، أي أنّ الأمرَ **مُقيَّدٌ في السلسلة غير القابلة للمحو** لا
#    ملفُ نصٍّ في مجلد. فالأمرُ الذي لا أثرَ له في السجل احتفالٌ.
#
# 4) **الأرقامُ تُقاس لا تُنقل**: حصيلةُ COMPLETION_CRITERIA.md تُطابَق بصفوفه، وعددُ البنود
#    المفتوحة في ROADMAP.md يُطابَق بجدول PROGRESS.md §2 — لأنّ التأخّرَ في رقمٍ منقولٍ يدويًّا
#    هو ما يُبتلع به بندٌ مفتوحٌ في إعلان.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION_FILE="version.json"
CRITERIA_FILE="COMPLETION_CRITERIA.md"
PROGRESS_FILE="PROGRESS.md"
ROADMAP_FILE="ROADMAP.md"
ORDERS_DIR="docs/royal-orders"
fail=0

echo "فحص حاجز الإعلان: دعوى الإصدار مقابل حال الدولة (T-127)"

# ــــ 1) دعوى الإصدار كما في version.json ــــ
percent="$(sed -n 's/.*"completion_percent": *\([0-9.]*\).*/\1/p' "$VERSION_FILE" | head -1)"
approval="$(sed -n 's/.*"royal_approval": *"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -1)"
if [ -z "$percent" ] || [ -z "$approval" ]; then
  echo "✗ $VERSION_FILE: لا يُقرأ منه completion_percent أو royal_approval"
  exit 1
fi
# هل المرحلة 40 معلنةٌ مكتملةً؟ (تُقرأ من كتلة phases_complete وحدها لا من كل الملف)
phase40="$(awk '/"phases_complete"/{f=1} f&&/\]/{f=0} f' "$VERSION_FILE" | grep -c '^ *40,\? *$' || true)"

# ــــ 2) حال الدولة مقيسًا ــــ
met=$(grep -c '| ✅ مستوفى |' "$CRITERIA_FILE" || true)
gap=$(grep -c '| ⚠️ فجوة |' "$CRITERIA_FILE" || true)
rep=$(grep -c '| 🟡 اكتُفي بتقرير المنفّذ |' "$CRITERIA_FILE" || true)
# «اكتُفي بتقرير المنفّذ» تُحسب فجوةً حتى تُقاس (قاعدة الإعلان)
not_met=$((gap + rep))

# البنود المفتوحة في PROGRESS.md §2: صفوفٌ تبدأ بـ«| T-» — والمُغلق يُشطب «| ~~T-»
s2_start=$(grep -n '^## 2) ما تبقّى' "$PROGRESS_FILE" | head -1 | cut -d: -f1)
s2_end=$(grep -n '^## 3) ' "$PROGRESS_FILE" | head -1 | cut -d: -f1)
if [ -z "$s2_start" ] || [ -z "$s2_end" ]; then
  echo "✗ $PROGRESS_FILE: لا يُعرف حدُّ §2 (البنود المفتوحة) — العنوانان §2 و§3 شرطُ القياس"
  exit 1
fi
open_items=$(awk -v a="$s2_start" -v b="$s2_end" 'NR>a && NR<b && /^\| T-/' "$PROGRESS_FILE" | wc -l | tr -d ' ')

# الأوامر الملكية المقيَّدة فعلًا: ملفٌّ غير README وفيه auditId غيرُ فارغ
orders=0
orders_unrecorded=""
for f in "$ORDERS_DIR"/*.md; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in README.md) continue ;; esac
  aid="$(sed -n 's/^معرّف السجل في سلسلة التدقيق (auditId): *//p' "$f" | head -1)"
  [ -n "$aid" ] || aid="$(sed -n 's/^auditId: *//p' "$f" | head -1)"
  if [ -n "$aid" ]; then
    orders=$((orders + 1))
  else
    orders_unrecorded="$orders_unrecorded $(basename "$f")"
  fi
done

echo "  الدعوى: النسبة $percent% · royal_approval=$approval · المرحلة 40 في phases_complete: $phase40"
echo "  الحال:  مستوفى $met · فجوة $gap · اكتُفي $rep (فما ليس ✅: $not_met) · بنود §2 المفتوحة: $open_items · أوامر ملكية مقيَّدة: $orders"

# ــــ 3) الأمرُ الذي لا أثرَ له في السجل ليس أمرًا (RULE-001) ــــ
if [ -n "$orders_unrecorded" ]; then
  echo "✗ أمرٌ ملكيٌّ بلا auditId — لا يُعتدُّ به:$orders_unrecorded"
  echo "  فالأمرُ يُقيَّد في السلسلة غير القابلة للمحو، وملفُ النصِّ وحدَه احتفالٌ ($ORDERS_DIR/README.md)"
  fail=1
fi

# ــــ 4) قفلُ الإعلان: دعوى الاكتمال تُوجب استيفاءً مقيسًا ــــ
claims=0
claim_why=""
if awk -v p="$percent" 'BEGIN{exit !(p+0 >= 100)}'; then claims=1; claim_why="completion_percent=$percent"; fi
if [ "$approval" != "pending" ]; then claims=1; claim_why="$claim_why royal_approval=$approval"; fi
if [ "$phase40" -gt 0 ]; then claims=1; claim_why="$claim_why phases_complete∋40"; fi

if [ "$claims" -eq 1 ]; then
  echo "  ⚑ الإصدارُ يدّعي الاكتمال ($claim_why) — فتُشترط ثلاثةٌ مقيسة:"
  if [ "$not_met" -ne 0 ]; then
    echo "✗ دعوى اكتمالٍ و$not_met صفًّا ليس ✅ في $CRITERIA_FILE — «فجوة واحدة مفتوحة = لا إعلان»"
    fail=1
  fi
  if [ "$open_items" -ne 0 ]; then
    echo "✗ دعوى اكتمالٍ و$open_items بندًا مفتوحًا في $PROGRESS_FILE §2 — ولا بندَ مفتوحًا يُبتلع في إعلان"
    fail=1
  fi
  if [ "$orders" -eq 0 ]; then
    echo "✗ دعوى اكتمالٍ بلا أمرٍ ملكيٍّ موقَّعٍ مقيَّدٍ في $ORDERS_DIR (C-20 · المرحلة 40)"
    fail=1
  fi
  [ "$fail" -eq 0 ] && echo "  ✓ الثلاثةُ مستوفاة: لا صفَّ غيرَ ✅، ولا بندَ مفتوحًا، وأمرٌ مقيَّدٌ في السلسلة"
else
  # ــــ 5) والعكس: ما دام ثمّ ما ليس ✅، فلا نسبةَ تسبقه ولا مرحلةَ 40 تُدَّعى ــــ
  if [ "$not_met" -eq 0 ] && [ "$open_items" -eq 0 ]; then
    echo "ℹ️ استُوفي كلُّ صفٍّ وأُغلق كلُّ بند، والنسبةُ $percent% — **والترقيةُ فعلُ الملك بأمرٍ موقَّع لا فعلُ منفّذ** (RULE-004 · C-20)"
  else
    echo "✓ لا دعوى إعلانٍ في $VERSION_FILE، وثمّ $not_met صفًّا ليس ✅ و$open_items بندًا مفتوحًا — فالنسبةُ $percent% صادقةٌ في وصف حالها"
  fi
fi

# ــــ 6) الأرقامُ المنقولةُ يدويًّا تُطابَق بالمقيس ــــ
summary="$(grep -m1 '^\*\*الحصيلة اليوم:\*\*' "$CRITERIA_FILE" || true)"
if [ -z "$summary" ]; then
  echo "✗ $CRITERIA_FILE: لا سطرَ «**الحصيلة اليوم:**» — والحصيلةُ غيرُ المعلنة لا تُطابَق"
  fail=1
else
  s_met="$(printf '%s' "$summary" | sed -n 's/.*مستوفى \*\*\([0-9]*\)\*\*.*/\1/p')"
  s_gap="$(printf '%s' "$summary" | sed -n 's/.*فجوة \*\*\([0-9]*\)\*\*.*/\1/p')"
  s_rep="$(printf '%s' "$summary" | sed -n 's/.*المنفّذ \*\*\([0-9]*\)\*\*.*/\1/p')"
  if [ "$s_met" != "$met" ] || [ "$s_gap" != "$gap" ] || [ "$s_rep" != "$rep" ]; then
    echo "✗ حصيلةُ $CRITERIA_FILE تقول (مستوفى $s_met · فجوة $s_gap · اكتُفي $s_rep) والصفوفُ تقول (مستوفى $met · فجوة $gap · اكتُفي $rep)"
    fail=1
  fi
fi

roadmap_open="$(grep -m1 '^| بنود مفتوحة معلنة |' "$ROADMAP_FILE" | sed -n 's/^| بنود مفتوحة معلنة | \*\*\([0-9]*\)\*\*.*/\1/p' || true)"
if [ -z "$roadmap_open" ]; then
  echo "✗ $ROADMAP_FILE: لا يُقرأ منه صفُّ «بنود مفتوحة معلنة | **N** بندًا»"
  fail=1
elif [ "$roadmap_open" != "$open_items" ]; then
  echo "✗ $ROADMAP_FILE يقول **$roadmap_open** بندًا مفتوحًا، و$PROGRESS_FILE §2 فيه $open_items — والرقمُ المنقولُ يدويًّا يتأخّر"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "✗ حاجزُ الإعلان يرفض: دعوى الإصدار لا تطابق حال الدولة (T-127)"
  exit 1
fi

echo "✓ حاجزُ الإعلان: دعوى الإصدار مطابقةٌ لحال الدولة — والإعلانُ أثرٌ لا احتفال"
