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
#
# ------------------------------------------------------------------------------
# T-154 (W-2026-011): الفشلُ يُسمّى ولا يُعَدُّ فقط
#
# العلّةُ المقيسة: كان هذا الملفُّ يشغّل المجموعةَ بـ`npm test > /dev/null 2>&1`،
#   فإن سقط تأكيدٌ أعلن «تشغيلُ الاختبارات فشل» **بلا اسمِ الساقطِ ولا موضعِه ولا
#   خرجٍ محفوظٍ يُرجَع إليه** — والخرجُ قد رُمي وقتَ وقوعِه فلا يُستعاد. وقيس في
#   الجلسة 63 أنّ المجموعةَ تسقط على هذه الآلةِ مشيتَين من ثلاث بتأكيدٍ واحدٍ بعينِه
#   (`قبول 37: تشغيل اتحادي دائم`) لمزاحمةِ تشغيلٍ متوازٍ على عتبةٍ زمنيّةٍ مطلقة —
#   فسقوطٌ متقلّبٌ كهذا **لا يُشخَّص بنيةً** ما دام الخرجُ يُرمى.
#
# فأُضيفت أحكامٌ مسمّاةٌ أربعة:
#   [GN-01] المشيةُ سقطت ⇒ يُطبع مسارُ خرجِها المحفوظِ وكلُّ سطرِ `not ok` باسمِه وموضعِه.
#   [GN-02] المشيةُ سقطت ولا سطرَ `not ok` واحدٌ في خرجِها ⇒ **حصرٌ أعمى**: يُعلن أنّ
#           السقوطَ غيرُ مُسمًّى ويُطبع آخرُ ما قاله المُشغّل — ولا يُطبع `✓` قطُّ.
#   [GN-03] الحصيلةُ تقول `fail > 0` ⇒ تُسمّى التأكيداتُ الساقطةُ من الحصيلةِ نفسِها.
#   [GN-04] الحصيلةُ تقول `fail > 0` ولا اسمَ ساقطٍ فيها ⇒ **حصرٌ أعمى** ثانٍ يُسمّى.
#   [GN-05] الحصيلةُ تحتوي على أكثر من نتيجة متتابعة (`# tests` أكثر من مرة) ⇒ ليست
#           حصيلةَ تشغيلٍ واحد موثوقًا: تشغيلان متزامنان يكتبان في ملفٍّ واحد فيُقرأ
#           آخرُهما. والرقمُ المقروء من اثنين يكذب. تُرفض الفاحصُ ولا يُختارُ واحدٌ.
#
# وحدُّه المُعلن: **التسميةُ ليست إصلاحًا**. لا يُخفَّض حدٌّ زمنيٌّ، ولا يُتخطّى اختبارٌ،
#   ولا تُعاد مشيةٌ آليًّا حتّى تخضرَّ — فإعادةُ المشيةِ تُخفي التقلّبَ بدل أن تسمّيه،
#   والتقلّبُ نفسُه دَينُ `W-2026-004` (`BLOCKED`) لا هذا البند.
# ==============================================================================
set -u

# جذرُ الفحص. الافتراضُ جذرُ المستودع، ويُبدَّل بـ`SOOL_CHECK_ROOT` ليُختبر الفاحصُ على
# **جذرٍ منسوخٍ** لا على `ARCHITECTURE.md` و`version.json` الحقيقيَّين (W-2026-004):
# إذ يشغّل node ملفّاتِ الاختبار بالتوازي، فتحريفُ ملفٍّ حقيقيٍّ يُقرأ حكمًا في اختبارٍ آخر.
ROOT="${SOOL_CHECK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 1

ARCH="ARCHITECTURE.md"
VERSION_FILE="version.json"
# مسارُ حصيلة المُشغّل. يُغيَّر بـSOOL_TESTS_TALLY لاختبارِ الفاحص نفسِه — إذ لا تكتمل
# الحصيلةُ الحقيقيّةُ إلا بعد انتهاء المُشغّل، فلا تُقرأ من داخله (انحرافٌ معلن).
TALLY="${SOOL_TESTS_TALLY:-dist/.tests.tap}"
# سجلُّ مشيةِ المُشغّل حين يشغّلها هذا الحاجزُ بنفسه: خرجٌ محفوظٌ كما وقع، لا مرميٌّ في
# `/dev/null` (T-154). يُبدَّل المسارُ بـ`SOOL_TESTS_RUN_LOG` ليُختبر الحاجزُ في جذرٍ مؤقّت.
RUN_LOG="${SOOL_TESTS_RUN_LOG:-dist/.tests.run.log}"
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

# يسمّي التأكيداتَ الساقطةَ من خرجٍ بصيغة TAP: الاسمَ ثمّ موضعَه إن أعلنه المُشغّل.
# ويردُّ 1 إن لم يجد سطرَ `not ok` واحدًا — فالعدُّ بلا تسميةٍ حصرٌ أعمى، والنداءُ يقرأ رمزَه
# ولا يفترض أنّه سمّى (T-154).
name_failures() {
  named=$(awk '
    /^[[:space:]]*not ok [0-9]+/ {
      name = $0
      sub(/^[[:space:]]*not ok [0-9]+[[:space:]]*-?[[:space:]]*/, "", name)
      n += 1
      if (n <= 40) printf "    ✗ %s\n", name
      want = 1
      next
    }
    want && /^[[:space:]]*location:/ {
      loc = $0
      sub(/^[[:space:]]*location:[[:space:]]*/, "", loc)
      gsub(/^\047|\047$/, "", loc)
      if (n <= 40) printf "      الموضع: %s\n", loc
      want = 0
      next
    }
    END {
      if (n > 40) printf "    … وبقيّةُ الساقطين %d، وكلُّهم في الخرجِ المحفوظ\n", n - 40
      exit (n > 0 ? 0 : 1)
    }
  ' "$1" 2>/dev/null)
  named_status=$?
  [ -n "$named" ] && echo "$named"
  return $named_status
}

if [ -z "${SOOL_TESTS_TALLY:-}" ] && ! tally_is_fresh; then
  echo "  ℹ حصيلةُ المُشغّل غائبةٌ أو أقدمُ من المبنى — تُقاس الآن بتشغيل الاختبارات"
  mkdir -p "$(dirname "$RUN_LOG")" 2>/dev/null
  if ! npm test > "$RUN_LOG" 2>&1; then
    echo "✗ [GN-01] تشغيلُ الاختبارات فشل — فلا رقمَ يُقارَن به"
    echo "  والخرجُ محفوظٌ كما وقع في: $RUN_LOG — فما سقط يُسمّى ولا يُرمى"
    if ! name_failures "$RUN_LOG"; then
      echo "✗ [GN-02] المشيةُ سقطت ولا سطرَ \`not ok\` واحدٌ في خرجِها — فالسقوطُ معدودٌ ولا مُسمًّى، وحصرٌ أعمى لا يُقبل"
      echo "    وآخرُ ما قاله المُشغّل (فلعلّه سقط قبل الاختبارات أو تغيّرت صيغةُ خرجِه):"
      tail -n 5 "$RUN_LOG" 2>/dev/null | sed 's/^/      /'
    fi
    exit 1
  fi
  echo "  ℹ خرجُ المشيةِ محفوظٌ في: $RUN_LOG"
fi

if [ ! -f "$TALLY" ]; then
  echo "✗ لم تُكتب حصيلةُ المُشغّل في $TALLY — وnpm test هو من يكتبها"
  exit 1
fi

# حصيلةٌ معياريةُ الأسطر (الجلسة 10 · GN05_REGEX_EOL_BYPASS · والجلسة 12): الأسطرُ تُقرأ
# بعدَ تطبيعِ الفواصلِ والذيول — فسطرُ `# tests N` الذي يفرّقه كاتبٌ عن سابقه بـCR وحدها أو
# يختمه بـVT أو FF أو NBSP سطرُ حصيلةٍ كاملُ الحقِّ يُعَدُّ ولا يُغفل (لا حذفَ للـCR يلحم
# سطرين، ولا ذيلَ للفراغاتِ يُعمي المرساة)، فلا يُصدَّقُ رقمُ نتيجةٍ أولى لأنّ الثانية
# «لا تطابق النمط». والمعايرةُ على نصٍّ لا على ملف — فلا يُلمس الملفُ الأصلي.
TALLY_TEXT=$(tr '\r\v\f' '\n' < "$TALLY" | sed -e 's/[ \t\xc2\xa0]*$//')

RUN_TESTS=$(printf '%s\n' "$TALLY_TEXT" | sed -n 's/^# tests \([0-9][0-9]*\)$/\1/p' | tail -1)
RUN_PASS=$(printf '%s\n' "$TALLY_TEXT" | sed -n 's/^# pass \([0-9][0-9]*\)$/\1/p' | tail -1)
RUN_FAIL=$(printf '%s\n' "$TALLY_TEXT" | sed -n 's/^# fail \([0-9][0-9]*\)$/\1/p' | tail -1)
[ -z "$RUN_TESTS" ] && RUN_TESTS=-1
[ -z "$RUN_PASS" ] && RUN_PASS=-1
[ -z "$RUN_FAIL" ] && RUN_FAIL=-1

echo "  الدعوى: tests.total=$DEC_TOTAL · tests.passing=$DEC_PASSING"
echo "  المُشغّل: tests=$RUN_TESTS · pass=$RUN_PASS · fail=$RUN_FAIL"

# [GN-05] (TEST_TALLY_APPEND_RACE · الجلسة 7): حصيلةُ المُشغّل يجب أن تكون حصيلةَ تشغيلٍ واحد
# موثوقًا. تشغيلان متزامنان يكتبان في ملفٍّ واحد فيُقرأ آخرُهما — والرقمُ المقروء من
# اثنين يكذب. فلا يُختارُ واحدٌ بل يُرفض الفحصُ. والحصيلةُ الواحدةُ تتطلب سطر `# tests`
# واحدًا وسطر `# pass` واحدًا وسطر `# fail` واحدًا — لا أكثر.
TALLY_TESTS_LINES=$(printf '%s\n' "$TALLY_TEXT" | sed -n 's/^# tests \([0-9][0-9]*\)$/\1/p' | wc -l | tr -d ' ')
TALLY_PASS_LINES=$(printf '%s\n' "$TALLY_TEXT" | sed -n 's/^# pass \([0-9][0-9]*\)$/\1/p' | wc -l | tr -d ' ')
TALLY_FAIL_LINES=$(printf '%s\n' "$TALLY_TEXT" | sed -n 's/^# fail \([0-9][0-9]*\)$/\1/p' | wc -l | tr -d ' ')

# سطرٌ يشبه رمزَ الحصيلةِ ولا يطابقُ شكلَه المعلن (`# tests N`) يُرى ويُرفض — لا يُغفل
# فتُصدَّقَ نتيجةُ أولى (الجلسة 12 · GN05_TOKEN_SHAPE_BYPASS): مسافةٌ قائدة أو مسافتان بين
# الرمزِ والعددِ شكلٌ شاذٌّ يُسمّى لا صمتٌ يُتغاضى — فالحصيلةُ التي لا تُقرأ بثباتٍ لا تُصدَّق.
TALLY_MALFORMED_LINES=$(printf '%s\n' "$TALLY_TEXT" | sed -n -E '/^[ \t]*#[ \t]*(tests|pass|fail)\b/{/^# (tests|pass|fail) [0-9]+$/!p}' | wc -l | tr -d ' ')

if [ "$TALLY_MALFORMED_LINES" -gt 0 ]; then
  echo "✗ [GN-05] حصيلةُ المُشغّل في $TALLY تحوي $TALLY_MALFORMED_LINES سطرًا يشبه رمزَ الحصيلة ولا يطابق شكلها المعلن (\`# tests N\`) — حصيلةٌ بصيغةٍ شاذةٍ لا تُقرأ بثباتٍ فلا تُصدَّق (GN05_TOKEN_SHAPE_BYPASS)"
  FAIL=1
elif [ "$TALLY_TESTS_LINES" -gt 1 ] || [ "$TALLY_PASS_LINES" -gt 1 ] || [ "$TALLY_FAIL_LINES" -gt 1 ]; then
  echo "✗ [GN-05] حصيلةُ المُشغّل في $TALLY ليست حصيلةَ تشغيلٍ واحد موثوقًا: $TALLY_TESTS_LINES سطر tests · $TALLY_PASS_LINES سطر pass · $TALLY_FAIL_LINES سطر fail — والرقمُ المقروء من تشغيلين متزامنين يكذب (TEST_TALLY_APPEND_RACE)"
  FAIL=1
elif [ "$RUN_TESTS" -lt 0 ] || [ "$RUN_PASS" -lt 0 ] || [ "$RUN_FAIL" -lt 0 ]; then
  echo "✗ حصيلةُ المُشغّل غيرُ مقروءة في $TALLY — والرقمُ الذي لا يُقرأ لا يُصدَّق"
  FAIL=1
elif [ "$RUN_FAIL" -ne 0 ]; then
  echo "✗ [GN-03] المُشغّلُ يقول $RUN_FAIL اختبارًا فاشلًا — ولا يُعلن عددٌ فوق فشل"
  if ! name_failures "$TALLY"; then
    echo "✗ [GN-04] الحصيلةُ تقول $RUN_FAIL فاشلًا ولا اسمَ تأكيدٍ ساقطٍ فيها — فالفشلُ معدودٌ ولا مُسمًّى، وحصرٌ أعمى لا يُقبل"
    if [ -f "$RUN_LOG" ]; then
      echo "    ويُنظر في خرجِ المشيةِ المحفوظ: $RUN_LOG"
    else
      echo "    ولا خرجَ محفوظًا هنا: الحصيلةُ كُتبت في مشيةٍ لم يُشغّلها هذا الحاجز — فيُشغّل \`npm test\` ويُحفظ خرجُه"
    fi
  fi
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
