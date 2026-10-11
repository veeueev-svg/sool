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

# حصيلةٌ معياريةُ الأسطر (الجلسة 10 · GN05_REGEX_EOL_BYPASS · والجلسات 12 · 13 · 14): الحصيلةُ
# تُقرأ في **منظرَين متوازيَين سطرًا بسطر** — والمعايرةُ على نصٍّ لا على ملف:
#
#   (1) **المنظرُ الخامّ** `TALLY_RAW`: الفواصلُ كلُّها فواصلُ أسطر — CR · VT · FF · FS/GS/RS
#       (0x1C–0x1E) · NEL (U+0085) · LS (U+2028) · PS (U+2029) ⇒ LF، ويُقصّ الذيلُ الحميد (فراغ ·
#       جدولة · NBSP C2 A0 تسلسلًا كاملًا). تُقرأ بايتاتٍ في `LC_ALL=C`: تسلسلاتُ UTF-8 الثلاثةُ
#       تبدأ ببايتٍ قائدٍ (C2 · E2) لا يقع تابعًا، فلا يُقطع حرفٌ عربيٌّ آخرُ بايتاته 0x85 («م» = D9 85).
#       **وNUL ليس فاصلًا بل علامةٌ خفيّة** (الجلسة 14 · GN05_INTRAWORD_INVISIBLE_BYPASS): كان يُحوَّل
#       إلى LF فيمزّق `te\0sts` كلمتين لا يراهما الكاشف، وقارئٌ يُسقطه يرى `tests`. فصار يُحوَّل إلى
#       SOH (0x01 — لا يحمل متغيّرُ bash بايتَ NUL) ثمّ يُحذف في المنظر الثاني كسائر الخفيّ.
#   (2) **المنظرُ المعروض** `TALLY_SHOWN`: ما تعرضه طرفيّةٌ أو محرّرٌ من المنظر الخامّ — يُحذف منه
#       ما لا يُرسم: تسلسلاتُ ESC (CSI `ESC [ … نهائيّ` · سلاسلُ OSC/DCS/PM/APC/SOS حتى BEL أو ST أو
#       نهايةِ السطر · ثنائيّاتُ ESC) وCSI/OSC بثمانية بتّات (C2 9B · C2 9D) — الجلسة 14 ·
#       GN05_CSI_COMMAND_SHAPE_BYPASS؛ ثمّ BS يمحو ما قبله (طرقٌ فوق حرف)؛ ثمّ بقيّةُ ضوابطِ C0 (عدا
#       الجدولة) وDEL وضوابطُ C1؛ ثمّ **كلُّ نقطةٍ من خاصّيّة Unicode `Default_Ignorable_Code_Point`**
#       (DerivedCoreProperties 18.0.0 — المجموعةُ المعرَّفةُ بأنها «لا تُرى» لا قائمةُ مسابير): U+00AD ·
#       034F · 061C · 115F–1160 · 17B4–17B5 · 180B–180F · 200B–200F · 202A–202E · 2060–206F · 3164 ·
#       FE00–FE0F · FEFF · FFA0 · FFF0–FFF8 · 1BCA0–1BCA3 · 1D173–1D17A · E0000–E0FFF.
#       والحذفُ داخلَ السطر وحده، فالمنظران متساويا الأسطر.
#
# وسطرُ الحصيلةِ **يُعرَّف بنحوِ TAP لا بقائمة شواذّ** (الجلسة 14 · GN05_VALID_TAP_COMMENT_FALSE_REJECT ·
#   والجلسة 15 · GN05_VALID_TAP_NUMERIC_COMMENT_FALSE_REJECT): «يُقرأ حصيلةً» = رمزُ `tests|pass|fail`
#   (بلا حسابِ حالة) كلمةً لا يسبقها حرفٌ أو رقم، **ثمّ لا حرفَ لاتينيًّا بعده إلى نهاية السطر** — أي أنّ
#   ما يتلوه عددٌ أو علاماتٌ أو بايتاتٌ فوق ASCII (أرقامُ نصٍّ آخر) أو لا شيء؛ وذلك (أ) بعد `#` تتلوه
#   غيرُ الحروف في أيّ موضعٍ من السطر، أو (ب) أوّلَ كلمةٍ في السطر بعد بادئةٍ ليست حروفًا. فتعليقٌ مشروعٌ
#   كـ`# tests completed without failures` أو `# tests 2435 completed without failures` لا يُقرأ حصيلةً
#   لأنّ بعد الرمز كلامًا؛ والحصيلةُ يختمها العدد.
# والشاذُّ = سطرٌ يُقرأ حصيلةً في المنظر المعروض، ثمّ (i) لا يطابق `^# (tests|pass|fail) [0-9]+$`
#   حرفًا، أو (ii) يطابقه معروضًا ويخالف خامَّه — أي أنّ فيه خفيًّا لا يُرى. والعدُّ والقيمُ من المنظر
#   المعروض، والطباعةُ من الخامّ مرئيًّا (`cat -v`).
# وصنفُ الوسيط في محو التسلسلات يُكتب `[ -/]` (0x20–0x2F) لا `[ -\/]` — فذاك عند GNU sed مدىً إلى
#   0x5C يبتلع النهائيَّ @–\ ويأكل أوّلَ حرفٍ من الكلمة (الجلسة 15 · GN05_ESCAPE_FINAL_EATEN_BYPASS).
# **حدُّه المعلن:** الرمزُ يُعرف بحروفه اللاتينية؛ رمزٌ بحروفٍ مشابهةٍ من نصٍّ آخر (مثل «е» السيريلية
#   في «tеsts») لا يُرى. وما تعرضه الطرفيّةُ بتسلسلاتٍ أخرى (كتحريك المؤشّر لكتابةٍ فوق سطرٍ سابق)
#   يُحذف ولا يُحاكى. **وسطرٌ يبدأ برمزٍ وعددٍ ثمّ كلامٌ لاتينيّ** (`# tests 2418 x`) تعليقٌ لا حصيلة —
#   فحصيلةٌ ثانيةٌ تُختم كلُّ أسطرها بكلمةٍ لا تُرى؛ وهذا ثمنُ ألّا يُرفض التعليقُ المشروع، ولا يكتبه
#   مُشغّلُ node. وما بعد الرمز بايتاتٌ فوق ASCII وحدها يُعدّ عددًا تحفّظًا، فـ`# tests ملاحظة` يُرفض.
#   ومقيسٌ على حصيلة `npm test` الحقيقيّة (انظر التقرير): لا شبيهَ فيها غيرُ الأسطرِ الثلاثةِ المطابقة.
TALLY_RAW="$(mktemp)"
TALLY_SHOWN="$(mktemp)"
TALLY_VERDICT="$(mktemp)"
trap 'rm -f "$DECLARED" "$MEASURED" "$TALLY_RAW" "$TALLY_SHOWN" "$TALLY_VERDICT"' EXIT

LC_ALL=C tr '\000\r\v\f\034\035\036' '\001\n\n\n\n\n\n' < "$TALLY" \
  | LC_ALL=C sed -e 's/\xc2\x85/\n/g' -e 's/\xe2\x80\xa8/\n/g' -e 's/\xe2\x80\xa9/\n/g' \
  | LC_ALL=C sed -E -e 's/([ \t]|\xc2\xa0)+$//' > "$TALLY_RAW"

LC_ALL=C sed -E \
  -e 's/\x1b\[[0-?]*[ -/]*[@-~]//g' \
  -e 's/\x1b[]PX^_][^\x07\x1b]*(\x07|\x1b\\)//g' \
  -e 's/\x1b[]PX^_].*$//' \
  -e 's/\x1b[ -/]*[0-~]//g' \
  -e 's/\xc2\x9b[0-?]*[ -/]*[@-~]//g' \
  -e 's/\xc2[\x90\x98\x9d\x9e\x9f]([^\x07\xc2]|\xc2[^\x9c])*(\x07|\xc2\x9c)//g' \
  -e ':bs' -e 's/[^\x08]\x08//' -e 'tbs' \
  -e 's/[\x01-\x08\x0e-\x1f\x7f]//g' \
  -e 's/\xc2[\x80-\x9f]//g' \
  -e 's/\xc2\xad|\xcd\x8f|\xd8\x9c|\xe1\x85[\x9f\xa0]|\xe1\x9e[\xb4\xb5]|\xe1\xa0[\x8b-\x8f]//g' \
  -e 's/\xe2\x80[\x8b-\x8f\xaa-\xae]|\xe2\x81[\xa0-\xaf]|\xe3\x85\xa4//g' \
  -e 's/\xef\xb8[\x80-\x8f]|\xef\xbb\xbf|\xef\xbe\xa0|\xef\xbf[\xb0-\xb8]//g' \
  -e 's/\xf0\x9b\xb2[\xa0-\xa3]|\xf0\x9d\x85[\xb3-\xba]|\xf3\xa0[\x80-\xbf][\x80-\xbf]//g' \
  -e 's/([ \t]|\xc2\xa0)+$//' \
  "$TALLY_RAW" > "$TALLY_SHOWN"

# حكمُ كلِّ سطر: «M <الخامّ>» للشاذّ، و«T|P|F <العدد>» للمطابق حرفًا. awk يقرأ المنظرين متوازيَين.
LC_ALL=C awk '
  NR == FNR { raw[FNR] = $0; next }
  {
    low = tolower($0)
    tally = 0
    if (match(low, /#[^a-z0-9]*(tests|pass|fail)[^a-z]*$/)) tally = 1
    else if (match(low, /^[^a-z0-9]*(tests|pass|fail)[^a-z]*$/)) tally = 1
    if (!tally) next
    if ($0 ~ /^# (tests|pass|fail) [0-9]+$/ && $0 == raw[FNR]) {
      split($0, w, " ")
      print (w[2] == "tests" ? "T" : (w[2] == "pass" ? "P" : "F")), w[3]
    } else {
      print "M", raw[FNR]
    }
  }
' "$TALLY_RAW" "$TALLY_SHOWN" > "$TALLY_VERDICT"

RUN_TESTS=$(LC_ALL=C awk '$1 == "T" { v = $2 } END { print v }' "$TALLY_VERDICT")
RUN_PASS=$(LC_ALL=C awk '$1 == "P" { v = $2 } END { print v }' "$TALLY_VERDICT")
RUN_FAIL=$(LC_ALL=C awk '$1 == "F" { v = $2 } END { print v }' "$TALLY_VERDICT")
[ -z "$RUN_TESTS" ] && RUN_TESTS=-1
[ -z "$RUN_PASS" ] && RUN_PASS=-1
[ -z "$RUN_FAIL" ] && RUN_FAIL=-1

echo "  الدعوى: tests.total=$DEC_TOTAL · tests.passing=$DEC_PASSING"
echo "  المُشغّل: tests=$RUN_TESTS · pass=$RUN_PASS · fail=$RUN_FAIL"

# [GN-05] (TEST_TALLY_APPEND_RACE · الجلسة 7): حصيلةُ المُشغّل يجب أن تكون حصيلةَ تشغيلٍ واحد
# موثوقًا. تشغيلان متزامنان يكتبان في ملفٍّ واحد فيُقرأ آخرُهما — والرقمُ المقروء من
# اثنين يكذب. فلا يُختارُ واحدٌ بل يُرفض الفحصُ. والحصيلةُ الواحدةُ تتطلب سطر `# tests`
# واحدًا وسطر `# pass` واحدًا وسطر `# fail` واحدًا — لا أكثر.
TALLY_TESTS_LINES=$(LC_ALL=C grep -a -c '^T ' "$TALLY_VERDICT" || true)
TALLY_PASS_LINES=$(LC_ALL=C grep -a -c '^P ' "$TALLY_VERDICT" || true)
TALLY_FAIL_LINES=$(LC_ALL=C grep -a -c '^F ' "$TALLY_VERDICT" || true)
TALLY_MALFORMED=$(LC_ALL=C sed -n 's/^M //p' "$TALLY_VERDICT")
TALLY_MALFORMED_LINES=$(LC_ALL=C grep -a -c '^M ' "$TALLY_VERDICT" || true)

if [ "$TALLY_MALFORMED_LINES" -gt 0 ]; then
  echo "✗ [GN-05] حصيلةُ المُشغّل في $TALLY تحوي $TALLY_MALFORMED_LINES سطرًا يشبه رمزَ الحصيلة ولا يطابق شكلها المعلن (\`# tests N\`) — حصيلةٌ بصيغةٍ شاذةٍ لا تُقرأ بثباتٍ فلا تُصدَّق (GN05_TOKEN_SHAPE_BYPASS)"
  printf '%s\n' "$TALLY_MALFORMED" | head -n 5 | LC_ALL=C cat -v | sed 's/^/    ✗ /'
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
