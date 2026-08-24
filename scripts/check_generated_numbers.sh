#!/usr/bin/env bash
# ==============================================================================
# فحصُ الأرقام المنقولة يدويًّا — T-128
#
# العلّة المقيسة: بعضُ أرقام التوثيق كانت تُنقل بانتباه كاتب، فتأخّرت.
#   · جدولُ المجلدات في ARCHITECTURE.md: تبيّن في الجلسة 43 أنّ 18 صفًّا من 25
#     متأخّرٌ عن الشجرة، أكبرُها src/data/ (4 · 928 مكتوبًا، و10 · 2390 مقيسًا).
#   · version.json → tests.total: رقمٌ يُكتب بيدٍ بعد قراءة خرج المُشغّل.
#   وحاجزُ الإعلان (T-127) حرس رقمَين وترك هذَين — فهذا الملفُّ يحرسهما.
#
# حدُّه المُعلن (مثل أخيه T-127): يقرأ ولا يُصلح. لا يعدّل جدولًا ولا رقمًا في
# version.json — الإصلاحُ فعلُ جهةٍ لا فعلُ أداة (RULE-004).
#
# عقدُ الجدول المفحوص: كلُّ صفٍّ يملك مجلدَه، **وكلَّ مجلدٍ تحته لا صفَّ له**.
#   فـ src/kernel/ لا يشمل src/kernel/config/ (لأنّ له صفًّا)، و src/services/
#   يشمل src/services/research/ (لأنّه لا صفَّ له). ومجلدٌ لا يغطّيه صفٌّ = رفض.
#
# أبوابُ الرفض: (1) عددُ ملفاتٍ متأخّر · (2) عددُ أسطرٍ متأخّر · (3) مجلدٌ في
# الشجرة لا صفَّ يغطّيه · (4) صفٌّ لمجلدٍ غيرِ موجود · (5) tests.total يخالف خرجَ
# المُشغّل · (6) tests.total ≠ tests.passing أو ثمّ اختبارٌ فاشل.
# ==============================================================================
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

ARCH="ARCHITECTURE.md"
VERSION_FILE="version.json"
# مسارُ حصيلة المُشغّل. يُغيَّر بـSOOL_TESTS_TALLY لاختبارِ الفاحص نفسِه — إذ لا تكتمل
# الحصيلةُ الحقيقيّةُ إلا بعد انتهاء المُشغّل، فلا تُقرأ من داخله (انحرافٌ معلن).
TALLY="${SOOL_TESTS_TALLY:-dist/.tests.tap}"
FAIL=0

echo "فحصُ الأرقام المنقولة يدويًّا: التوثيق مقابل الشجرة والمُشغّل (T-128)"

# ------------------------------------------------------------------------------
# 1) جدولُ المجلدات في ARCHITECTURE.md مقابل الشجرة
# ------------------------------------------------------------------------------
if [ ! -f "$ARCH" ]; then
  echo "✗ $ARCH غير موجود — ولا يُفحص ما لا يُقرأ"
  exit 1
fi

DECLARED="$(mktemp)"
MEASURED="$(mktemp)"
trap 'rm -f "$DECLARED" "$MEASURED"' EXIT

# صفوفُ الجدول: | `src/…/` | ملفات | أسطر | … |
# يُستخرج المسارُ من بين أوّلِ علامتَي اقتباسٍ خلفيّتَين، ثم الحقلان الرقميّان.
awk -F'|' '
  /^\| *`src\// {
    cell = $2
    if (match(cell, /`[^`]+`/)) {
      path = substr(cell, RSTART + 1, RLENGTH - 2)
      sub(/\/$/, "", path)
      files = $3; lines = $4
      gsub(/[^0-9]/, "", files); gsub(/[^0-9]/, "", lines)
      if (files != "" && lines != "") print path, files, lines
    }
  }
' "$ARCH" | sort > "$DECLARED"

DECLARED_ROWS=$(wc -l < "$DECLARED" | tr -d ' ')
if [ "$DECLARED_ROWS" -eq 0 ]; then
  echo "✗ لم يُقرأ صفٌّ واحدٌ من جدول المجلدات — فالصيغةُ تغيّرت والفحصُ صار أعمى"
  exit 1
fi

# قياسُ الشجرة: كلُّ مجلدٍ يُنسَب إلى أقربِ صفٍّ يغطّيه (نفسُه أو أحدُ آبائه)
: > "$MEASURED"
UNCOVERED=""
for dir in $(find src -type d 2>/dev/null | sed 's:/*$::' | sort); do
  owner=""
  probe="$dir"
  while [ -n "$probe" ]; do
    if awk -v p="$probe" '$1 == p { found = 1 } END { exit !found }' "$DECLARED"; then
      owner="$probe"
      break
    fi
    case "$probe" in
      */*) probe="${probe%/*}" ;;
      *)   probe="" ;;
    esac
  done
  n=$(find "$dir" -maxdepth 1 -type f -name '*.ts' | wc -l | tr -d ' ')
  l=$(find "$dir" -maxdepth 1 -type f -name '*.ts' -exec cat {} + 2>/dev/null | wc -l | tr -d ' ')
  if [ -z "$owner" ]; then
    if [ "$n" -gt 0 ]; then
      UNCOVERED="$UNCOVERED $dir"
    fi
    continue
  fi
  echo "$owner $n $l $dir" >> "$MEASURED"
done

# الجمعُ لكل مالك
MEASURED_SUM="$(mktemp)"
awk '{ f[$1] += $2; l[$1] += $3 } END { for (k in f) print k, f[k], l[k] }' \
  "$MEASURED" | sort > "$MEASURED_SUM"

DRIFT=0
while read -r path files lines; do
  [ -z "$path" ] && continue
  if [ ! -d "$path" ]; then
    echo "✗ $ARCH فيه صفٌّ لمجلدٍ غير موجود: \`$path/\` — والصفُّ الذي لا مجلدَ له وهمٌ لا وصف"
    DRIFT=$((DRIFT + 1))
    continue
  fi
  m_files=$(awk -v p="$path" '$1 == p { print $2 }' "$MEASURED_SUM")
  m_lines=$(awk -v p="$path" '$1 == p { print $3 }' "$MEASURED_SUM")
  [ -z "$m_files" ] && m_files=0
  [ -z "$m_lines" ] && m_lines=0
  if [ "$files" -ne "$m_files" ] || [ "$lines" -ne "$m_lines" ]; then
    echo "✗ \`$path/\`: الجدولُ يقول $files ملفًا و$lines سطرًا، والشجرةُ $m_files و$m_lines"
    # إن كان الصفُّ يرِث مجلداتٍ لا صفَّ لها، فقد يكون التأخّرُ منها — فيُسمّى المُتّهم
    inherited=$(awk -v p="$path" '$1 == p && $4 != p && $2 > 0 { printf "%s/ ", $4 }' "$MEASURED")
    if [ -n "$inherited" ]; then
      echo "    ويرِث هذا الصفُّ مجلداتٍ لا صفَّ لها: $inherited— فإمّا أُفرد لها صفٌّ، وإمّا صُحّح المجموع"
    fi
    DRIFT=$((DRIFT + 1))
  fi
done < "$DECLARED"

if [ -n "$UNCOVERED" ]; then
  for d in $UNCOVERED; do
    echo "✗ مجلدٌ فيه شفرةٌ ولا صفَّ يغطّيه في $ARCH: \`$d/\` — والمجلدُ الذي لا يُذكر لا يُراجَع"
    DRIFT=$((DRIFT + 1))
  done
fi

rm -f "$MEASURED_SUM"

if [ "$DRIFT" -eq 0 ]; then
  echo "✓ جدولُ المجلدات: $DECLARED_ROWS صفًّا كلُّها مطابقةٌ للشجرة (ملفاتٍ وأسطرًا)"
else
  echo "  التصحيحُ فعلُ جهةٍ لا فعلُ أداة: يُقاس ويُكتب، ولا يُصحَّح الصفُّ المعمولُ فيه وحدَه"
  FAIL=1
fi

# ------------------------------------------------------------------------------
# 2) version.json → tests.total مقابل خرجِ المُشغّل
# ------------------------------------------------------------------------------
if [ ! -f "$VERSION_FILE" ]; then
  echo "✗ $VERSION_FILE غير موجود"
  exit 1
fi

read_num() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$VERSION_FILE" | head -1
}
DEC_TOTAL="$(read_num total)"
DEC_PASSING="$(read_num passing)"
[ -z "$DEC_TOTAL" ] && DEC_TOTAL=-1
[ -z "$DEC_PASSING" ] && DEC_PASSING=-1

# الحصيلةُ تُكتب كأثرٍ جانبيٍّ لتشغيلِ `npm test`. فإن غابت أو تأخّرت عن المبنى،
# شُغّلت هنا — ولا يُقبل رقمٌ لا مصدرَ له.
tally_is_fresh() {
  [ -f "$TALLY" ] || return 1
  newer=$(find dist/tests -type f -name '*.js' -newer "$TALLY" 2>/dev/null | head -1)
  [ -z "$newer" ]
}

if [ -z "${SOOL_TESTS_TALLY:-}" ] && ! tally_is_fresh; then
  echo "  ℹ حصيلةُ المُشغّل غائبةٌ أو أقدمُ من المبنى — تُقاس الآن بتشغيل الاختبارات"
  if ! npm test > /dev/null 2>&1; then
    echo "✗ تشغيلُ الاختبارات فشل — فلا رقمَ يُقارَن به"
    exit 1
  fi
fi

if [ ! -f "$TALLY" ]; then
  echo "✗ لم تُكتب حصيلةُ المُشغّل في $TALLY — وnpm test هو من يكتبها"
  exit 1
fi

RUN_TESTS=$(sed -n 's/^# tests \([0-9][0-9]*\)$/\1/p' "$TALLY" | tail -1)
RUN_PASS=$(sed -n 's/^# pass \([0-9][0-9]*\)$/\1/p' "$TALLY" | tail -1)
RUN_FAIL=$(sed -n 's/^# fail \([0-9][0-9]*\)$/\1/p' "$TALLY" | tail -1)
[ -z "$RUN_TESTS" ] && RUN_TESTS=-1
[ -z "$RUN_PASS" ] && RUN_PASS=-1
[ -z "$RUN_FAIL" ] && RUN_FAIL=-1

echo "  الدعوى: tests.total=$DEC_TOTAL · tests.passing=$DEC_PASSING"
echo "  المُشغّل: tests=$RUN_TESTS · pass=$RUN_PASS · fail=$RUN_FAIL"

if [ "$RUN_TESTS" -lt 0 ] || [ "$RUN_PASS" -lt 0 ] || [ "$RUN_FAIL" -lt 0 ]; then
  echo "✗ حصيلةُ المُشغّل غيرُ مقروءة في $TALLY — والرقمُ الذي لا يُقرأ لا يُصدَّق"
  FAIL=1
elif [ "$RUN_FAIL" -ne 0 ]; then
  echo "✗ المُشغّلُ يقول $RUN_FAIL اختبارًا فاشلًا — ولا يُعلن عددٌ فوق فشل"
  FAIL=1
elif [ "$DEC_TOTAL" -ne "$RUN_TESTS" ] || [ "$DEC_PASSING" -ne "$RUN_PASS" ]; then
  echo "✗ $VERSION_FILE يقول $DEC_TOTAL/$DEC_PASSING، والمُشغّلُ يقول $RUN_TESTS/$RUN_PASS — والرقمُ المنقولُ يدويًّا يتأخّر"
  FAIL=1
else
  echo "✓ عددُ الاختبارات: $DEC_TOTAL مطابقٌ لخرجِ المُشغّل، ولا فشلَ فيه"
fi

# ------------------------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
  echo "✗ فاحصُ الأرقام يرفض: رقمٌ في التوثيق لا يطابق ما قِيس (T-128)"
  exit 1
fi

echo "✓ فاحصُ الأرقام: كلُّ رقمٍ مفحوصٍ مولَّدٌ من مصدره — فما لا يُقاس آليًّا يتأخّر حتمًا"
exit 0
