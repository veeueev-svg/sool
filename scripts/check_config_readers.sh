#!/usr/bin/env bash
# scripts/check_config_readers.sh — لا ملفَّ إعلانٍ بلا قارئٍ مسجَّل، ولا قارئَ بلا ملف (البند T-137 · المرحلة 40)
# المالك: القيّم على المستودع
# القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
# المدخلات: config/*.yaml + src/kernel/config/declaration_readers.ts + وحداتُ المحمّلات
# المخرجات: رمز 0 إن تقابل الجانبان حرفًا، ورمز 1 مع بيانِ كلِّ فارقٍ باسمه
# التبعيات: bash + grep + sed فقط — لا Node ولا بناء، فيُنادى قبل البناء وبعده
# الصلاحيات (RULE-004): فحصٌ يقرأ ويحكم؛ لا يكتب صفًّا ولا يُنشئ محمّلًا
# السجلات: خرجُه في البوابة · وقيدُ الحصر يكتبه الإقلاعُ نفسُه
# حالات الفشل: ملفٌّ بلا صفّ · صفٌّ بلا ملفّ · صفٌّ يسمّي دالّةً لا تُصدَّر من وحدتها
#   · وحدةٌ مذكورةٌ غيرُ موجودة · سجلٌّ لا يُقرأ منه صفٌّ واحد (فحصٌ أعمى)
# اختبار القبول: tests/governance/config_readers_gate.test.ts
# الوثيقة المرتبطة: docs/decisions/ADR-0042-declaration-readers.md
#
# ثوابت هذا الفحص:
#
# 1) **الاتّجاهانِ معًا**: الإقلاعُ يفحص اتّجاهًا واحدًا (ملفٌّ موجودٌ ⇒ له قارئ) لأنّ مجلدَ
#    إعلانٍ منسوخٍ ناقصٍ في اختبارٍ ليس علّةً في الدولة. وهذا الفحصُ يفحص الاتّجاهَ المقابلَ
#    **على المستودع الحقيقيّ**: صفٌّ يسمّي ملفًّا محذوفًا سجلٌّ يكذب، وسجلٌّ يكذب أسوأُ من
#    غيابه لأنّه يُقرأ ويُصدَّق.
#
# 2) **اسمُ الدالّةِ يُتحقَّق لا يُصدَّق**: صفٌّ يقول «قارئي loadX في الوحدة Y» يُفحص بالبحث عن
#    `export function loadX` في Y فعلًا. فسجلٌّ يسمّي دالّةً لا وجودَ لها هو الكذبُ نفسُه في
#    صورةٍ أرقى: لا ملفَّ تهيئةٍ بلا قارئ، بل قارئٌ بلا وجود.
#
# 3) **الفحصُ يسقط إن عَمِي**: إن لم يُقرأ صفٌّ واحدٌ من السجل فالصيغةُ تغيّرت والفحصُ صار
#    زينةً — فيسقط برمزه لا يمرّ بصمت.
set -u
ROOT="${SOOL_CHECK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 1

REGISTRY="src/kernel/config/declaration_readers.ts"
CONFIG_DIR="config"
fail=0

echo "فحصُ قُرّاءِ الإعلان: كلُّ ملفٍّ في $CONFIG_DIR له قارئٌ مسجَّل، وكلُّ قارئٍ له ملف (T-137)"

if [ ! -f "$REGISTRY" ]; then
  echo "✗ فشل مغلق: $REGISTRY غير موجود — ولا يُفحص ما لا يُقرأ"
  exit 1
fi
if [ ! -d "$CONFIG_DIR" ]; then
  echo "✗ فشل مغلق: مجلد الإعلان $CONFIG_DIR غير موجود"
  exit 1
fi

ROWS="$(sed -n "s/.*{ *file: *'\([^']*\)' *, *reader: *'\([^']*\)' *, *module: *'\([^']*\)' *, *site: *'\([^']*\)' *}.*/\1|\2|\3|\4/p" "$REGISTRY")"
ROW_COUNT="$(printf '%s\n' "$ROWS" | grep -c '|' || true)"
if [ "$ROW_COUNT" -eq 0 ]; then
  echo "✗ لم يُقرأ صفٌّ واحدٌ من $REGISTRY — فالصيغةُ تغيّرت والفحصُ صار أعمى (الثابت 3)"
  exit 1
fi

# 1) كلُّ ملفٍّ في مجلد الإعلان (وفرعيّاته) له صفٌّ باسمه
FILE_COUNT=0
while IFS= read -r path; do
  [ -z "$path" ] && continue
  rel="${path#"$CONFIG_DIR"/}"
  FILE_COUNT=$((FILE_COUNT + 1))
  if ! printf '%s\n' "$ROWS" | grep -q "^${rel}|"; then
    echo "✗ ملفُّ إعلانٍ بلا قارئٍ مسجَّل: $CONFIG_DIR/$rel — إمّا محمّلٌ في الدولة وصفٌّ في $REGISTRY، وإمّا يُخرَج إلى موضعٍ يُعلن أنّه إعلانُ أدواتٍ لا إعلانُ دولة"
    fail=1
  fi
done < <(find "$CONFIG_DIR" -type f \( -name '*.yaml' -o -name '*.yml' \) | sort)

if [ "$FILE_COUNT" -eq 0 ]; then
  echo "✗ لا ملفَّ إعلانٍ واحدٌ في $CONFIG_DIR — والحصرُ الفارغُ لا يُحرس"
  fail=1
fi

# 2) كلُّ صفٍّ له ملفٌّ موجود، ودالّةٌ مُصدَّرةٌ فعلًا من وحدةٍ موجودة (الثابتان 1 و2)
while IFS='|' read -r file reader module site; do
  [ -z "${file:-}" ] && continue
  if [ ! -f "$CONFIG_DIR/$file" ]; then
    echo "✗ قارئٌ مسجَّلٌ لملفٍّ غائب: الصفُّ «$file» يشير إلى $CONFIG_DIR/$file ولا وجودَ له — نظّف $REGISTRY"
    fail=1
  fi
  if [ ! -f "$module" ]; then
    echo "✗ صفٌّ يسمّي وحدةً غيرَ موجودة: «$file» ⇒ $module"
    fail=1
    continue
  fi
  if ! grep -q "^export function ${reader}" "$module"; then
    echo "✗ صفٌّ يسمّي دالّةً لا تُصدَّر من وحدتها: «$file» ⇒ ${reader} في $module (الثابت 2)"
    fail=1
  fi
  case "$site" in
    read_at_guard|read_in_domain) ;;
    *) echo "✗ موضعُ نداءٍ مجهول في الصفّ «$file»: $site — المعروفُ read_at_guard أو read_in_domain"; fail=1 ;;
  esac
done < <(printf '%s\n' "$ROWS")

# 3) العددان يتقابلان — فصفٌّ زائدٌ أو ملفٌّ ناقصٌ يُقرأ بعدده لا بالبحث اليدويّ
if [ "$fail" -eq 0 ] && [ "$FILE_COUNT" -ne "$ROW_COUNT" ]; then
  echo "✗ العددان لا يتقابلان: $FILE_COUNT ملفًّا في $CONFIG_DIR مقابل $ROW_COUNT صفًّا في السجل"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ $FILE_COUNT ملفَّ إعلانٍ و$ROW_COUNT قارئًا مسجَّلًا يتقابلان حرفًا — لا إعلانَ بلا قارئ (T-137)"
fi
exit "$fail"
