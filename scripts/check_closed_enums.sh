#!/usr/bin/env bash
# scripts/check_closed_enums.sh — يمنع تعدادًا مغلقًا غيرَ مُسجَّلٍ ولا محروس (T-131 · المرحلة 39)
#   ويُحصيها **بالبنية** لا باصطلاحِ الاسم وحده (T-136 · `W-2026-006` · المرحلة 40)
# المالك: القيّم على المستودع
# القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
# المدخلات: src/kernel/types.ts + src/kernel/config/*.ts + src/kernel/config/closed_enums.ts
#   والجذرُ يُوجَّه بـ`SOOL_CHECK_ROOT` (درسُ W-2026-004: لا حالةَ اختبارٍ تلمس ملفًّا حقيقيًّا)
# المخرجات: رمز 0 إن كان كلُّ تعدادٍ مغلقٍ مُسجَّلًا أو مستثنًى بسببٍ مكتوب، ورمز 1 عند أوّل مخالفة
# التبعيات: bash + grep + sed + awk (لا Node — ليعمل قبل البناء، كأخيه check_declaration.sh)
# الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يُسجّل تعدادًا ولا يُعدّل رقمَ أعضاء
# السجلات: خرجٌ نصّي في البوابة
# حالات الفشل: تعدادٌ مرشَّحٌ بلا صفٍّ في السجل ولا سطرٍ في جدول الاستثناء · صفٌّ في السجل
#   لا تعدادَ له · تعدادٌ مُسجَّلٌ بلا `Object.freeze` · استثناءٌ بلا سبب · استثناءٌ لا وجودَ
#   لاسمه · اسمٌ مُسجَّلٌ ومستثنًى معًا · استثناءٌ يحمل اصطلاحَ الاسم المغلق · حصرٌ أعمى (صفرُ مرشَّح)
# اختبار القبول: tests/governance/closed_enums_gate.test.ts + tests/kernel/closed_enum_bounds.test.ts
# الوثيقة المرتبطة: docs/decisions/ADR-0035-closed-enum-bounds.md
#   · القياسُ الخام: docs/audit/measurements/phase-39-T131.txt · و phase-40-T136.txt
#
# ثوابت هذا الفحص:
#
# 1) **الاختبارُ وحدَه لا يكفي**: اختبارُ T-131 يمرّ على ما في **السجل**، فمن أضاف تعدادًا
#    مغلقًا جديدًا ولم يُسجّله لم يسقط عليه اختبارٌ قطّ — «المهربُ بحذف الصفّ». وهذا الفحصُ
#    يُحصي التعداداتَ من **الشفرة** ويقارنها بالسجل، فلا يُفتح بابٌ بحذف سطرٍ من جدول.
#
# 2) **المرشَّحُ يُعرَف بالبنية، والاسمُ بابٌ قائمٌ لا يُحذَف** (T-136): قبل هذا البند كان
#    المرشَّحُ **اصطلاحَ اسمٍ** وحدَه — كلُّ `export const` فيه `_KNOWN_` وزيادةً عليه اسمان
#    صريحان — والمقيسُ أنّ **12** تعدادَ قيمٍ في مدخلات هذا الفحص كانت تُخفيها التسميةُ عنه
#    (منها 8 غيرُ مجمَّدةٍ أصلًا). فصار المرشَّحُ **اتّحادَ** ما يراه الاسمُ وما تراه البنيةُ:
#    مصفوفةٌ مصدَّرةٌ عناصرُها **نصوصٌ حرفيّةٌ أو نشرٌ** لمصفوفةٍ أخرى. **ولم يُحذف بابُ الاسم**
#    لأنّ من سمّى `X_KNOWN_Y` بلا تجميدٍ يسقط اليومَ، ولا يجوز أن يمرَّ غدًا بحجّةِ بنية.
#
# 3) **ما ليس تعدادَ قيمٍ يسقط بالشكل، وما كان تعدادًا وليس تهيئةً يُستثنى بسببٍ يُقرأ**:
#    الكائناتُ والأزواجُ (`DECLARATION_READERS` · `POLICIES_MUST_HOLD`) ليست مرشَّحةً أصلًا —
#    **شكلُ عناصرها** يُخرجها لا اسمُها. وقوائمُ الاشتراط والجهاتُ (`*_REQUIRED_*` ·
#    `*_MUST_BE_*` · `*_OPERATORS` · المنفّذون) **مرشَّحةٌ بنيةً** فلا تُسكَت عنها، بل تُستثنى
#    في `EXCEPTIONS` أدناه **بسببٍ مكتوبٍ يُقرأ** — واستثناءٌ بلا سببٍ مهربٌ فيسقط.
#
# 4) **أربعةُ حرّاسٍ على جدول الاستثناء نفسِه** (T-136)، وإلّا كان الجدولُ بابًا جديدًا:
#    سببٌ فارغٌ ⇒ رفض · اسمٌ لا وجودَ له في الشفرة ⇒ رفض (حرسٌ على معدوم، RULE-001) ·
#    اسمٌ مُسجَّلٌ ومستثنًى معًا ⇒ رفض (حالٌ مزدوجةٌ تُخفي أيَّهما حكَم) · اسمٌ يحمل اصطلاحَ
#    الاسم المغلق ⇒ رفض (فلا يُفلت تعدادٌ من بابِ التجميدِ بسطرٍ في جدول).
#
# 5) **التجميدُ يُقرأ في الشفرة والتشغيل**: هذا الفحصُ يقرأ `Object.freeze` في إعلانِ كلِّ
#    **مُسجَّلٍ** (وهو تعدادُ تهيئةٍ يحدُّ قيمَ مفتاح)، والاختبارُ يقرأ `Object.isFrozen` في
#    التشغيل. والمستثنى **لا يُطالَب بالتجميد** لأنّه ليس تعدادَ تهيئةٍ — **وثمانيةٌ منها
#    مقيسةٌ غيرُ مجمَّدةٍ، وذلك دَينٌ مُعلَنٌ لا مسكوتٌ عنه** (T-136 · §8 من العقد).
#
# 6) **لكلِّ حكمٍ رمزٌ لاتينيٌّ ثابت** `[CE-NN]` (T-136): نصُّ البيانِ عربيٌّ مشكولٌ يُنقَّح،
#    فلو رُبط الاختبارُ به لانكسر على تحسينِ صياغة. والرمزُ عقدٌ بين البوابة واختبارها،
#    وبه يُقتل كلُّ حارسٍ **منفردًا** في التطفير — وقبل الرموز نجت خمسُ طفراتٍ لأنّ حارسًا
#    كان يُغطّي على أخيه في الخرج (المقيسُ في phase-40-T136.txt).
#    CE-01 حصرٌ أعمى · CE-02 استثناءٌ بلا سبب · CE-03 استثناءٌ لاسمٍ معدوم ·
#    CE-05 استثناءٌ باصطلاحِ الاسم المغلق (يُحكَم **قبل** CE-04 لأنّ كلَّ مُسجَّلٍ اليومَ
#    يحمل الاصطلاحَ أو هو من EXTRA_ENUMS، فلو تأخّر لَما بلغه اسمٌ وكان حكمًا لا يُنفَّذ) ·
#    CE-04 مُسجَّلٌ ومستثنًى معًا · CE-06 مرشَّحٌ بلا
#    صفٍّ ولا سبب · CE-07 صفٌّ بلا تعداد · CE-08 مُسجَّلٌ بلا تجميد · CE-09 لا سجلَّ أصلًا.
#
# 7) **الفحصُ يسقط إن عَمِي**: صفرُ مرشَّحٍ في مدخلاتٍ موجودةٍ يعني أنّ الصيغةَ تغيّرت وأنّ
#    الحصرَ لم يقرأ شيئًا — فيسقط برمزه ولا يطبع «✓» على حصرٍ فارغ.
set -euo pipefail

ROOT="${SOOL_CHECK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || exit 1

REGISTRY="src/kernel/config/closed_enums.ts"
SOURCES="src/kernel/types.ts $(ls src/kernel/config/*.ts 2>/dev/null | grep -v 'closed_enums.ts' | tr '\n' ' ')"
# ثابت 2: التعداداتُ التي لا تحمل النمط `_KNOWN_` ويُسمَّيان صريحًا — بابُ الاسم القائم
EXTRA_ENUMS="DURABLE_KINDS KNOWN_SOVEREIGN_ACTIONS"

# ثابت 3 و4: جدولُ الاستثناء — `الاسم|السببُ مكتوبًا`. سطرٌ بلا سببٍ يُرفض، واسمٌ لا وجودَ
# له يُرفض، ومُسجَّلٌ مستثنًى يُرفض، وحاملُ اصطلاحِ الاسم المغلق يُرفض.
EXCEPTIONS="$(cat <<'TABLE'
CHAOS_REQUIRED_FAULTS|مجموعةٌ فرعيّةٌ مشترطةٌ من CHAOS_KNOWN_FAULTS المُسجَّل — تشترط وجودَ قطوعٍ في التمرين ولا تحدُّ قيمةَ مفتاحٍ في التهيئة
STOP_REQUIRED_PROBES|مجموعةٌ فرعيّةٌ مشترطةٌ من STOP_KNOWN_PROBES المُسجَّل — شرطُ قبولٍ لا حدُّ قيم
STAGING_REQUIRED_WATCHES|مجموعةٌ فرعيّةٌ مشترطةٌ من STAGING_KNOWN_WATCHES المُسجَّل
PRODUCTION_REQUIRED_SCANNERS|مجموعةٌ فرعيّةٌ مشترطةٌ من PRODUCTION_KNOWN_SCANNERS المُسجَّل
STAGING_MUST_BE_CRITICAL|مجموعةٌ فرعيّةٌ من STAGING_KNOWN_INCIDENTS المُسجَّل — تشترط تصنيفًا ولا تفتح قيمةً جديدة
PRODUCTION_MUST_BE_CRITICAL|مجموعةٌ فرعيّةٌ من PRODUCTION_KNOWN_INCIDENTS المُسجَّل — شرطُ تصنيفٍ لا تعدادُ تهيئة
CONFINEMENT_REQUIREMENTS|أسماءُ اشتراطاتٍ يُحقَّق منها في الإقلاع، ولا مفتاحَ تهيئةٍ قيمُه محدودةٌ بها
STAGING_OPERATORS|جهاتٌ مُشغّلةٌ مأخوذةٌ من أسماء الأدوار (ROLES_KNOWN_NAMES المُسجَّل) — لا تحدُّ مفتاحًا في ملفِّ تهيئة
TERMINATION_EXECUTORS|جهاتُ إنهاءٍ مأخوذةٌ من أسماء الأدوار — قائمةُ صلاحيّةٍ لا تعدادُ قيمِ تهيئة
LOAD_FORBIDDEN_DRILL_AUTHORITIES|قائمةُ منعٍ لجهاتٍ لا يجوز أن تُشغّل التمرين — منعٌ لا حدُّ قيمٍ مسموحة
ROLE_POWER_FIELDS|أسماءُ حقولٍ في نوعٍ برمجيّ (keyof RolePowers) تُقرأ لفحصِ الأدوار، لا قيمٌ تُكتب في ملفِّ تهيئة
DECLARATION_REACH|مدى الإعلان: لاحقتا امتدادٍ يُبنى منهما مسحُ المجلد، لا مفتاحٌ في تهيئةٍ قيمُه محدودةٌ بهما
TABLE
)"

fail=0

echo "فحص التعدادات المغلقة: الحصرُ بالبنية والاسم، وكلُّ مرشَّحٍ مُسجَّلٌ أو مستثنًى بسبب (T-131 · T-136)"

if [ ! -f "$REGISTRY" ]; then
  echo "✗ [CE-09] لا سجلَّ تعدادات: $REGISTRY — وما لا سجلَّ له لا يُحرس"
  exit 1
fi

# ــــ 1) المرشَّحُ اسمًا: بابُ الاصطلاح القائم (ثابت 2) ــــ
# ملحوظةٌ مقيسة: `|| true` ليست تجميلًا. بلا هي يُسقط `set -e` الفحصَ **بلا حكمٍ ولا سطرِ
# بيان** حين لا يجد الحصرُ شيئًا — فيصير رمزُ الخروجِ 1 عن **انهيارٍ** لا عن حكم، وذلك
# مقيسٌ في phase-40-T136.txt (حالة «ح» قبل الإصلاح). فرمزُ الخروجِ لا يُقرأ معزولًا عن خرجِه.
by_name=""
for name in $(grep -ho 'export const [A-Za-z_0-9]*_KNOWN_[A-Za-z_0-9]*' $SOURCES 2>/dev/null \
    | sed 's/export const //' | sort -u || true); do
  by_name="$by_name $name"
done
for name in $EXTRA_ENUMS; do
  if grep -q "export const $name" $SOURCES; then by_name="$by_name $name"; fi
done

# ــــ 2) المرشَّحُ بنيةً: مصفوفةٌ مصدَّرةٌ عناصرُها نصوصٌ حرفيّةٌ أو نشر (ثابت 2) ــــ
# يُقرأ الإعلانُ من `export const` إلى فاصلةِ نهايةِ الجملة، فيُقبل التجميدُ في السطر التالي
# كما في سطرِ الإعلان؛ ثمّ تُحذف التعليقاتُ ونداءاتُ الدوالِّ بأقواسها، فما بقي فيه `{` أو
# `[` داخليٌّ فليس تعدادَ قيمٍ — والقرارُ على **شكلِ العناصر** لا على الاسم.
by_shape="$(awk '
  function classify(text,   body, i, n, parts, tok, prev) {
    gsub(/\/\/[^\n]*/, "", text)
    i = index(text, "=")
    if (i == 0) return ""
    text = substr(text, i + 1)
    i = index(text, "[")
    if (i == 0) return ""
    body = substr(text, i + 1)
    n = 0
    for (i = length(body); i > 0; i--) { if (substr(body, i, 1) == "]") { n = i; break } }
    if (n == 0) return ""
    body = substr(body, 1, n - 1)
    do { prev = body; gsub(/\([^()]*\)/, "", body) } while (body != prev)
    if (body ~ /[{[]/) return ""
    gsub(/[ \t\n]+/, " ", body)
    n = split(body, parts, ",")
    for (i = 1; i <= n; i++) {
      tok = parts[i]
      gsub(/^ +| +$/, "", tok)
      if (tok == "") continue
      if (tok !~ /^'"'"'[^'"'"']*'"'"'$/ && tok !~ /^\.\.\.[A-Za-z_0-9.]+$/) return ""
    }
    return "yes"
  }
  /^export const [A-Za-z_0-9]+/ {
    name = $3; sub(/:.*/, "", name); sub(/=.*/, "", name)
    decl = $0; collecting = 1
    while (collecting && (index(decl, ";") == 0)) {
      if ((getline nxt) <= 0) break
      decl = decl "\n" nxt
    }
    if (classify(decl) == "yes") print name
  }
' $SOURCES 2>/dev/null | sort -u || true)"

# ــــ 3) المرشَّحون: اتّحادُ البابَين ــــ
candidates="$(printf '%s\n%s\n' "$by_name" "$by_shape" | tr ' ' '\n' | grep -v '^$' | sort -u || true)"
count_candidates=0
for name in $candidates; do count_candidates=$((count_candidates + 1)); done
count_shape=0
for name in $by_shape; do count_shape=$((count_shape + 1)); done
count_name=0
for name in $by_name; do count_name=$((count_name + 1)); done

# ثابت 6: حصرٌ فارغٌ في مدخلاتٍ موجودةٍ حصرٌ أعمى
if [ "$count_candidates" -eq 0 ]; then
  echo "✗ [CE-01] الحصرُ لم يقرأ مرشَّحًا واحدًا في مدخلاتٍ موجودة — الصيغةُ تغيّرت والفحصُ صار أعمى"
  exit 1
fi

# ــــ 4) الصفوفُ كما هي في السجل ــــ
registered="$(sed -n "s/^ *name: '\([A-Za-z_0-9]*\)'.*/\1/p" "$REGISTRY" | sort -u || true)"
count_registered=0
for name in $registered; do count_registered=$((count_registered + 1)); done

# ــــ 5) جدولُ الاستثناء وحرّاسُه الأربعة (ثابت 4) ــــ
excepted=""
count_excepted=0
while IFS= read -r row; do
  [ -z "$row" ] && continue
  name="${row%%|*}"
  reason="${row#*|}"
  [ "$reason" = "$row" ] && reason=""
  if [ -z "$(printf '%s' "$reason" | tr -d '[:space:]')" ]; then
    echo "✗ [CE-02] استثناءٌ بلا سببٍ مكتوب: $name — واستثناءٌ لا يُقرأ سببُه مهربٌ لا حكم (T-136)"
    fail=1
    continue
  fi
  if ! printf '%s\n' $candidates | grep -qx "$name"; then
    echo "✗ [CE-03] استثناءٌ لا وجودَ لاسمه في الشفرة: $name — حرسٌ على معدومٍ يُوهم بحماية (RULE-001)"
    fail=1
    continue
  fi
  case " $EXTRA_ENUMS " in *" $name "*) is_extra=1 ;; *) is_extra=0 ;; esac
  if [ "$is_extra" -eq 1 ] || printf '%s' "$name" | grep -q '_KNOWN_'; then
    echo "✗ [CE-05] استثناءٌ يحمل اصطلاحَ الاسم المغلق: $name — لا يُفلت تعدادٌ من بابِ التجميدِ بسطرٍ في جدول"
    fail=1
    continue
  fi
  if printf '%s\n' $registered | grep -qx "$name"; then
    echo "✗ [CE-04] اسمٌ مُسجَّلٌ ومستثنًى معًا: $name — حالٌ مزدوجةٌ تُخفي أيُّهما حكَم (T-136)"
    fail=1
    continue
  fi
  excepted="$excepted $name"
  count_excepted=$((count_excepted + 1))
done <<EOF
$EXCEPTIONS
EOF

echo "  المرشَّحون: $count_candidates (بنيةً $count_shape · اسمًا $count_name) · السجل: $count_registered صفًّا · مستثنًى بسببٍ: $count_excepted"

# ــــ 6) مرشَّحٌ بلا صفٍّ ولا سببٍ: بابٌ يُفتح في صمت ــــ
for name in $candidates; do
  if printf '%s\n' $registered | grep -qx "$name"; then continue; fi
  if printf '%s\n' $excepted | grep -qx "$name"; then continue; fi
  echo "✗ [CE-06] تعدادٌ مرشَّحٌ بلا صفٍّ في السجل ولا سببٍ في جدول الاستثناء: $name"
  echo "  سجِّله في $REGISTRY بعددِ أعضائه ومواضعِ استعماله، أو اكتب سببَ استثنائه في"
  echo "  جدول EXCEPTIONS من هذا الفحص — فتعدادٌ لا يُحرس ولا يُعلَّل قائمةٌ بلا سقف (T-131 · T-136)"
  fail=1
done

# ــــ 7) صفٌّ في السجل بلا تعدادٍ في الشفرة: حرسٌ على معدوم (RULE-001) ــــ
for name in $registered; do
  if ! printf '%s\n' $candidates | grep -qx "$name"; then
    echo "✗ [CE-07] صفٌّ في السجل لا تعدادَ له في الشفرة: $name — حرسٌ على معدومٍ يُوهم بحماية"
    fail=1
  fi
done

# ــــ 8) التجميدُ في إعلانِ كلِّ مُسجَّل (ثابت 5) ــــ
for name in $registered; do
  decl="$(grep -h -A1 "export const $name" $SOURCES | head -2 || true)"
  if ! printf '%s' "$decl" | grep -q 'Object.freeze'; then
    echo "✗ [CE-08] تعدادٌ مغلقٌ بلا تجميدٍ في التشغيل: $name"
    echo '  readonly كلامُ الترجمة، وpush يعمل في التشغيل — لُفَّ الإعلانَ بـObject.freeze'
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "✗ فحصُ التعدادات المغلقة يرفض: تعدادٌ بلا حرسٍ ولا سببٍ مكتوب (T-131 · T-136)"
  exit 1
fi

echo "✓ التعدادات المغلقة: $count_candidates مرشَّحًا = $count_registered مُسجَّلًا + $count_excepted مستثنًى بسببٍ يُقرأ — والحصرُ بالبنية لا بالتسمية"
