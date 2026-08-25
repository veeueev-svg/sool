#!/usr/bin/env bash
# scripts/check_declaration.sh — يمنع إعلانَ 100% وفي الدولة عائقٌ مسمّى، ويمنع دَينًا يُبتلع صمتًا
#   (البند T-127 · المرحلة 40 · وأُعيد بابُه على التصنيف في W-2026-005)
# المالك: القيّم على المستودع (والإعلانُ نفسُه للملك — RULE-004)
# القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
# المدخلات: version.json + COMPLETION_CRITERIA.md + PROGRESS.md §2 + ROADMAP.md + docs/royal-orders/
#   والجذرُ افتراضًا مجلدُ المستودع، ويُوجَّه بـ`SOOL_DECL_ROOT` للاختبار بلا عبثٍ بملفٍّ حقيقيّ
# المخرجات: رمز 0 إن كانت دعوى الإصدار مطابقةً لحال الدولة، ورمز 1 عند أول تعارضٍ مع بيانه
# التبعيات: bash + grep + sed + awk (لا Node — ليعمل قبل البناء، كأخيه check_criteria_status.sh)
# الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يُرقّي نسبةً ولا يوقّع أمرًا ولا يُغلق بندًا
# السجلات: خرجٌ نصّي في البوابة
# حالات الفشل: نسبةٌ 100% وثمّ صفٌّ ليس ✅ · نسبةٌ 100% وثمّ **عائقٌ مسمّى** مفتوحٌ في §2 ·
#   دعوى اكتمالٍ ودَينٌ معلنٌ لم يُذكر عددُه في الأمر الملكيّ · royal_approval ليس pending بلا
#   أمرٍ موقَّعٍ مقيَّدٍ بـauditId · المرحلة 40 في phases_complete بلا أمر · حصيلةُ
#   COMPLETION_CRITERIA.md لا تطابق صفوفَه · عددُ ROADMAP.md لا يطابق §2 · أمرٌ ملكيٌّ بلا
#   auditId · صفُّ شرطٍ خارجيٍّ ناقصُ خانةٍ أو بلا جهةٍ من غير المنفّذين · النسبةُ المعلنة لا
#   تساوي مجموعَ أوزان phases_complete · مرحلةٌ في phases_partial وهي في phases_complete
# اختبار القبول: tests/governance/declaration_gate.test.ts + تشغيله في البوابة
# الوثيقة المرتبطة: docs/test-reports/phase-40.md · docs/test-reports/W-2026-005-declaration-convergence.md
#   · COMPLETION_CRITERIA.md §«قاعدة الإعلان»
#
# ثوابت هذا الفحص:
#
# 1) **الإعلانُ أثرٌ لا احتفال**: «فجوة واحدة مفتوحة = لا إعلان» مكتوبةٌ في
#    COMPLETION_CRITERIA.md وROADMAP.md وPROGRESS.md — وكانت **نصيحةً تُقرأ**: أخوه
#    check_criteria_status.sh يطبع «ℹ️ لا إعلان» ثم **يخرج بالرمز 0**. فهذا الملفُّ يجعلها
#    **قاعدةً تُسقط**. ومن كتب قاعدةً في ثلاث وثائق ولم يجعل لها حاجزًا كتب رجاءً لا حكمًا.
#
# 2) **البابُ يُقارب بالبناء الصحيح لا بالتصفير**: كان الشرطُ «صفرُ بندٍ مفتوحٍ في §2»،
#    والقاعدةُ نفسُها (RULE-011) تُوجب فتحَ بندٍ لكلِّ حدٍّ يُكتشف — فكلُّ عملٍ صحيحٍ يزيد
#    المقامَ المشترطَ تصفيرُه، وبابٌ لا يُفتح ببناءٍ سليمٍ يُغري بتفريغ السجل صمتًا أو بتعطيل
#    الحاجز. فصار المشترطُ **صفرَ عائقٍ مسمّى**: بندٌ يذكره صفٌّ غيرُ ✅ في معايير القبول.
#    وما بقي **دَينٌ معلن**: لا يمنع الإعلانَ، ولكنّه **يُذكر عددُه في الأمر الملكيّ** —
#    فالفرقُ بين دَينٍ معلنٍ ودَينٍ مبتلعٍ سطرٌ في الأمر لا نيّةٌ في صدر كاتب.
#
# 3) **الفحصُ لا يُعلن ولا يمنع الإعلانَ الصحيح**: لا يشترط أن تكون النسبةُ 100%، ولا يرقّيها
#    إن استُوفي كلُّ شيء — فالإعلانُ فعلُ الملك بأمرٍ موقَّع (C-20 · المرحلة 40)، وهذا الحاجزُ
#    يمنع **الدعوى بلا سند** في الاتجاهين: لا نسبةَ تسبق الاستيفاء، ولا استيفاءَ يُبتلع.
#
# 4) **الفارغُ ليس استيفاءً (RULE-001)**: وجودُ ملفِّ أمرٍ في docs/royal-orders/ لا يكفي —
#    يُشترط `auditId` غيرُ فارغ، أي أنّ الأمرَ **مُقيَّدٌ في السلسلة غير القابلة للمحو** لا
#    ملفُ نصٍّ في مجلد. فالأمرُ الذي لا أثرَ له في السجل احتفالٌ. وكذلك **الشرطُ الخارجيّ**:
#    بندٌ خارجَ مقدور المنفّذ لا يكون عذرًا مفتوحًا، بل صفًّا معلنًا فيه: ما يلزمه · مَن
#    يستوفيه · كيف يُثبت الاستيفاء. والصفُّ الناقصُ يُسقط الحاجزَ ولو لم تُدَّعَ نسبة.
#
# 5) **الأرقامُ تُقاس لا تُنقل**: حصيلةُ COMPLETION_CRITERIA.md تُطابَق بصفوفه، وعددُ البنود
#    المفتوحة في ROADMAP.md يُطابَق بجدول PROGRESS.md §2، **والنسبةُ المعلنةُ تُطابَق بمجموع
#    أوزان المراحل المُغلقة** في جدول ROADMAP.md — لأنّ التأخّرَ في رقمٍ منقولٍ يدويًّا هو ما
#    يُبتلع به بندٌ مفتوحٌ في إعلان، ولأنّ نموذجَ وزنٍ لا يحرسه حسابٌ يفترق عن حسابه بصمت.
set -euo pipefail

cd "${SOOL_DECL_ROOT:-$(dirname "$0")/..}"
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
complete_phases="$(awk '/"phases_complete"/{f=1;next} f&&/\]/{f=0} f' "$VERSION_FILE" | grep -o '[0-9]\+' | sort -n | uniq || true)"
partial_phases="$(awk '/"phases_partial"/{f=1} f{print} f&&/\]/{f=0}' "$VERSION_FILE" | grep -o '[0-9]\+' | sort -n | uniq || true)"

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
open_ids="$(awk -v a="$s2_start" -v b="$s2_end" 'NR>a && NR<b && /^\| T-/' "$PROGRESS_FILE" \
  | sed -n 's/^| *\(T-[0-9]*[^ |]*\).*/\1/p')"
open_items=$(printf '%s\n' "$open_ids" | grep -c 'T-' || true)

# ــــ 2ب) العائقُ المسمّى: بندٌ يذكره صفٌّ غيرُ ✅ في معايير القبول وهو مفتوحٌ في §2 ــــ
# (والخانةُ الخامسةُ «البند المفتوح» وحدَها تُقرأ — لا كلُّ نصِّ الصفّ، فلا يُصطاد رقمٌ من عنوان)
named_ids="$(awk -F'|' '/^\| C-/ && $0 !~ /\| ✅ مستوفى \|/ {print $6}' "$CRITERIA_FILE" \
  | grep -o 'T-[0-9]\+' | sort -u || true)"
# والمطابقةُ تحتمل لاحقةً غيرَ رقمٍ (`T-115` في المعايير = `T-115أ`/`T-115ب` في §2)،
# ولا تحتمل لاحقةً رقميّةً فلا يُصطاد `T-11` بـ`T-115`
blocking=""
for t in $named_ids; do
  if printf '%s\n' "$open_ids" | awk -v t="$t" '
      $0 == t { found = 1 }
      index($0, t) == 1 && length($0) > length(t) {
        rest = substr($0, length(t) + 1);
        if (rest !~ /^[0-9]/) { found = 1 }
      }
      END { exit !found }'; then
    blocking="$blocking $t"
  fi
done
blocking_n=$(printf '%s' "$blocking" | wc -w | tr -d ' ')
debt_n=$((open_items - blocking_n))

# ــــ 2ج) الشروطُ الخارجيّةُ المعلنة: بابٌ مقفلٌ بجهةٍ مسمّاةٍ ودليلِ استيفاء، لا عذرٌ مفتوح ــــ
ext_start=$(grep -n '^### شروطٌ خارجيّة معلنة' "$CRITERIA_FILE" | head -1 | cut -d: -f1 || true)
ext_rows=0
if [ -z "$ext_start" ]; then
  echo "✗ $CRITERIA_FILE: لا قسمَ «### شروطٌ خارجيّة معلنة» — والبندُ الخارجُ عن مقدور المنفّذ إن لم يُعلن صار عذرًا"
  fail=1
else
  ext_block="$(awk -v a="$ext_start" 'NR>a { if ($0 ~ /^## /) exit; print }' "$CRITERIA_FILE" | grep '^| T-' || true)"
  ext_rows=$(printf '%s\n' "$ext_block" | grep -c '^| T-' || true)
  if [ "$ext_rows" -eq 0 ]; then
    echo "✗ $CRITERIA_FILE: قسمُ الشروط الخارجيّة بلا صفٍّ واحد — والقسمُ الفارغُ ليس إعلانًا (RULE-001)"
    fail=1
  fi
  while IFS= read -r row; do
    [ -n "$row" ] || continue
    item="$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$2); print $2}')"
    n_empty=0
    for i in 2 3 4 5 6; do
      cell="$(printf '%s' "$row" | awk -F'|' -v i="$i" '{gsub(/^ +| +$/,"",$i); print $i}')"
      [ -n "$cell" ] || n_empty=$((n_empty + 1))
    done
    if [ "$n_empty" -ne 0 ]; then
      echo "✗ شرطٌ خارجيٌّ ناقصُ خانةٍ ($item): الخمسُ واجبةٌ — البند · ما يلزمه · مَن يستوفيه · كيف يُثبت · المعيار المرتبط"
      fail=1
    fi
    party="$(printf '%s' "$row" | awk -F'|' '{gsub(/^ +| +$/,"",$4); print $4}')"
    case "$party" in
      *"القيّم على المستودع"*|*"المساعد الآلي"*|*"المنفّذ"*)
        echo "✗ شرطٌ خارجيٌّ ($item) جهتُه «$party» — ومن يستوفيه منفّذُ المستودع فهو بندُ عملٍ لا شرطًا خارجيًّا"
        fail=1 ;;
    esac
  done <<EOF
$ext_block
EOF
fi

# الأوامر الملكية المقيَّدة فعلًا: ملفٌّ غير README وفيه auditId غيرُ فارغ
orders=0
orders_unrecorded=""
debt_declared=-1
for f in "$ORDERS_DIR"/*.md; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in README.md) continue ;; esac
  aid="$(sed -n 's/^معرّف السجل في سلسلة التدقيق (auditId): *//p' "$f" | head -1)"
  [ -n "$aid" ] || aid="$(sed -n 's/^auditId: *//p' "$f" | head -1)"
  if [ -n "$aid" ]; then
    orders=$((orders + 1))
    d="$(sed -n 's/^الدَّينُ المعلن عند الإعلان: *\([0-9]*\).*/\1/p' "$f" | head -1)"
    [ -z "$d" ] || debt_declared="$d"
  else
    orders_unrecorded="$orders_unrecorded $(basename "$f")"
  fi
done

echo "  الدعوى: النسبة $percent% · royal_approval=$approval · المرحلة 40 في phases_complete: $phase40"
echo "  الحال:  مستوفى $met · فجوة $gap · اكتُفي $rep (فما ليس ✅: $not_met) · بنود §2 المفتوحة: $open_items"
echo "          منها عائقٌ مسمّى:$([ "$blocking_n" -eq 0 ] && echo ' لا شيء' || echo "$blocking") ($blocking_n) · ودَينٌ معلن: $debt_n · شروطٌ خارجيّة معلنة: $ext_rows · أوامر ملكية مقيَّدة: $orders"

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
  echo "  ⚑ الإصدارُ يدّعي الاكتمال ($claim_why) — فتُشترط أربعةٌ مقيسة:"
  if [ "$not_met" -ne 0 ]; then
    echo "✗ دعوى اكتمالٍ و$not_met صفًّا ليس ✅ في $CRITERIA_FILE — «فجوة واحدة مفتوحة = لا إعلان»"
    fail=1
  fi
  if [ "$blocking_n" -ne 0 ]; then
    echo "✗ دعوى اكتمالٍ و$blocking_n بندًا مفتوحًا يذكره صفٌّ غيرُ ✅ ($blocking) — والعائقُ المسمّى يُغلق قبل الإعلان"
    fail=1
  fi
  if [ "$debt_n" -gt 0 ] && [ "$debt_declared" != "$debt_n" ]; then
    said="$([ "$debt_declared" = "-1" ] && echo 'لا أمرَ يذكره' || echo "المعلنُ فيه: $debt_declared")"
    echo "✗ دعوى اكتمالٍ و$debt_n بندًا معلنًا في §2 لم يُذكر عددُه في أمرٍ ملكيٍّ مقيَّد ($said)"
    echo "  فالأمرُ يقول حرفًا «الدَّينُ المعلن عند الإعلان: $debt_n بندًا» — ولا بندَ مفتوحًا يُبتلع في صمت"
    fail=1
  fi
  if [ "$orders" -eq 0 ]; then
    echo "✗ دعوى اكتمالٍ بلا أمرٍ ملكيٍّ موقَّعٍ مقيَّدٍ في $ORDERS_DIR (C-20 · المرحلة 40)"
    fail=1
  fi
  [ "$fail" -eq 0 ] && echo "  ✓ الأربعةُ مستوفاة: لا صفَّ غيرَ ✅، ولا عائقَ مسمًّى، والدَّينُ معلنٌ في الأمر، وأمرٌ مقيَّدٌ في السلسلة"
else
  # ــــ 5) والعكس: ما دام ثمّ ما ليس ✅، فلا نسبةَ تسبقه ولا مرحلةَ 40 تُدَّعى ــــ
  if [ "$not_met" -eq 0 ] && [ "$blocking_n" -eq 0 ]; then
    echo "ℹ️ استُوفي كلُّ صفٍّ ولا عائقَ مسمًّى، والنسبةُ $percent% — **والترقيةُ فعلُ الملك بأمرٍ موقَّع لا فعلُ منفّذ** (RULE-004 · C-20)"
  else
    echo "✓ لا دعوى إعلانٍ في $VERSION_FILE، وثمّ $not_met صفًّا ليس ✅ و$blocking_n عائقًا مسمًّى — فالنسبةُ $percent% صادقةٌ في وصف حالها"
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

# ــــ 7) النسبةُ المعلنةُ = مجموعُ أوزان المراحل المُغلقة، والمرحلةُ الجارية بلا وزن ــــ
# (جدولُ ROADMAP.md: «| # | المرحلة | الحزمة | الوزن | التراكمي | الحالة | المالك |»)
weights_sum="$(printf '%s\n' "$complete_phases" | awk -v RM="$ROADMAP_FILE" '
  BEGIN {
    while ((getline line < RM) > 0) {
      if (line ~ /^\| *[0-9]+ *\|/) {
        n = split(line, c, "|");
        if (n >= 5) { id = c[2]; w = c[5]; gsub(/[^0-9]/, "", id); gsub(/[^0-9.]/, "", w); W[id] = w + 0; }
      }
    }
  }
  /^[0-9]+$/ { if (!($0 in W)) { miss = miss " " $0 } else { s += W[$0] } }
  END { printf "%.2f|%s", s, miss }
')"
w_total="${weights_sum%%|*}"
w_missing="${weights_sum#*|}"
if [ -n "$w_missing" ]; then
  echo "✗ مرحلةٌ في phases_complete لا صفَّ لها في جدول $ROADMAP_FILE:$w_missing"
  fail=1
elif ! awk -v a="$w_total" -v b="$percent" 'BEGIN{exit !((a-b < 0.01) && (b-a < 0.01))}'; then
  echo "✗ النسبةُ المعلنة $percent% ومجموعُ أوزان phases_complete $w_total% — والنموذجُ الذي لا يحرسه حسابٌ يفترق بصمت"
  fail=1
fi
for p in $partial_phases; do
  if printf '%s\n' "$complete_phases" | grep -qx "$p"; then
    echo "✗ المرحلة $p في phases_partial وphases_complete معًا — والجزئيُّ لا يكون مُغلقًا"
    fail=1
  fi
done
if [ -n "$partial_phases" ]; then
  echo "  ℹ️ مرحلةٌ جارية:$(printf ' %s' $partial_phases) — **بلا وزنٍ محتسبٍ حتى تُغلق بتقرير قبول** (ROADMAP.md §«حساب النسبة»)"
fi

if [ "$fail" -ne 0 ]; then
  echo "✗ حاجزُ الإعلان يرفض: دعوى الإصدار لا تطابق حال الدولة (T-127)"
  exit 1
fi

echo "✓ حاجزُ الإعلان: دعوى الإصدار مطابقةٌ لحال الدولة — والإعلانُ أثرٌ لا احتفال"
