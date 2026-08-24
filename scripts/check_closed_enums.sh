#!/usr/bin/env bash
# scripts/check_closed_enums.sh — يمنع تعدادًا مغلقًا غيرَ مُسجَّلٍ ولا محروس (البند T-131 · المرحلة 39)
# المالك: القيّم على المستودع
# القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
# المدخلات: src/kernel/config/*.ts + src/kernel/types.ts + src/kernel/config/closed_enums.ts
# المخرجات: رمز 0 إن كان كلُّ تعدادٍ مغلقٍ مُسجَّلًا، ورمز 1 عند أوّل تعدادٍ خارج السجل
# التبعيات: bash + grep + sed (لا Node — ليعمل قبل البناء، كأخيه check_declaration.sh)
# الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يُسجّل تعدادًا ولا يُعدّل رقمَ أعضاء
# السجلات: خرجٌ نصّي في البوابة
# حالات الفشل: تعدادٌ مصدَّرٌ باسمٍ مغلقٍ ولا صفَّ له في السجل · صفٌّ في السجل لا تعدادَ له
#   · تعدادٌ مغلقٌ معلنٌ بلا `Object.freeze`
# اختبار القبول: tests/kernel/closed_enum_bounds.test.ts + تشغيلُ هذا الفحص في البوابة
# الوثيقة المرتبطة: docs/decisions/ADR-0035-closed-enum-bounds.md
#   · القياسُ الخام: docs/audit/measurements/phase-39-T131.txt
#
# ثوابت هذا الفحص:
#
# 1) **الاختبارُ وحدَه لا يكفي**: اختبارُ T-131 يمرّ على ما في **السجل**، فمن أضاف تعدادًا
#    مغلقًا جديدًا ولم يُسجّله لم يسقط عليه اختبارٌ قطّ — «المهربُ بحذف الصفّ». وهذا الفحصُ
#    يُحصي التعداداتَ من **الشفرة** ويقارنها بالسجل، فلا يُفتح بابٌ بحذف سطرٍ من جدول.
#
# 2) **الاسمُ اصطلاحٌ مُعلن**: يُعدُّ تعدادًا مغلقًا كلُّ `export const` فيه `_KNOWN_`،
#    وزيادةً عليها اثنان لا يحملان النمطَ ويُسمَّيان صريحًا هنا (`DURABLE_KINDS` و
#    `KNOWN_SOVEREIGN_ACTIONS`). ومن سمّى تعدادَه بغير النمطَين فعليه أن يزيده في هذا السطر —
#    وهو **سطرٌ يُقرأ** لا حرسٌ خفيّ.
#
# 3) **قوائمُ الاشتراط ليست تعدادات**: `*_REQUIRED_*` و`*_MUST_BE_*` و`*_OPERATORS`
#    مجموعاتٌ فرعيّةٌ من تعدادٍ مُسجَّلٍ أصلًا، لا تحدُّ قيمًا في التهيئة بل تشترط وجودَها،
#    فحصرُها هنا تكرارٌ يُوهم بحرسٍ زائد (وهو عينُ ما رُفض في الجلسة 48).
#
# 4) **التجميدُ يُقرأ في الشفرة والتشغيل**: هذا الفحصُ يقرأ `Object.freeze` في سطر الإعلان،
#    والاختبارُ يقرأ `Object.isFrozen` في التشغيل. اثنان يقيسان الشيءَ نفسَه من جهتين،
#    لأنّ إعلانًا مجمَّدًا يُستنسخ في التشغيل بلا تجميدٍ يمرّ على أوّلهما ويسقط بالثاني.
set -euo pipefail

cd "$(dirname "$0")/.."
REGISTRY="src/kernel/config/closed_enums.ts"
SOURCES="src/kernel/types.ts $(ls src/kernel/config/*.ts | grep -v 'closed_enums.ts' | tr '\n' ' ')"
# ثابت 2: التعداداتُ التي لا تحمل النمط `_KNOWN_` وتُسمَّى صريحًا
EXTRA_ENUMS="DURABLE_KINDS KNOWN_SOVEREIGN_ACTIONS"
fail=0

echo "فحص التعدادات المغلقة: كلُّ تعدادٍ مغلقٍ مُسجَّلٌ ومجمَّد (T-131)"

if [ ! -f "$REGISTRY" ]; then
  echo "✗ لا سجلَّ تعدادات: $REGISTRY — وما لا سجلَّ له لا يُحرس"
  exit 1
fi

# ــــ 1) التعداداتُ كما هي في الشفرة ــــ
declared=""
for name in $(grep -ho 'export const [A-Za-z_0-9]*_KNOWN_[A-Za-z_0-9]*' $SOURCES \
    | sed 's/export const //' | sort -u); do
  declared="$declared $name"
done
for name in $EXTRA_ENUMS; do
  if grep -q "export const $name" $SOURCES; then declared="$declared $name"; fi
done

count_declared=0
for name in $declared; do count_declared=$((count_declared + 1)); done

# ــــ 2) الصفوفُ كما هي في السجل ــــ
registered="$(sed -n "s/^ *name: '\([A-Za-z_0-9]*\)'.*/\1/p" "$REGISTRY" | sort -u)"
count_registered=0
for name in $registered; do count_registered=$((count_registered + 1)); done

echo "  الشفرة: $count_declared تعدادًا مغلقًا · السجل: $count_registered صفًّا"

# ــــ 3) تعدادٌ في الشفرة بلا صفٍّ في السجل: بابٌ يُفتح في صمت ــــ
for name in $declared; do
  if ! printf '%s\n' $registered | grep -qx "$name"; then
    echo "✗ تعدادٌ مغلقٌ غيرُ مُسجَّل: $name"
    echo "  سجِّله في $REGISTRY بعددِ أعضائه ومواضعِ استعماله، أو أعلن سقفًا يقابله في"
    echo "  src/kernel/config/declaration_budget.ts — فتعدادٌ لا يُحرس قائمةٌ بلا سقف (T-131)"
    fail=1
  fi
done

# ــــ 4) صفٌّ في السجل بلا تعدادٍ في الشفرة: حرسٌ على معدوم (RULE-001) ــــ
for name in $registered; do
  if ! printf '%s\n' $declared | grep -qx "$name"; then
    echo "✗ صفٌّ في السجل لا تعدادَ له في الشفرة: $name — حرسٌ على معدومٍ يُوهم بحماية"
    fail=1
  fi
done

# ــــ 5) التجميدُ في سطر الإعلان (ثابت 4) ــــ
for name in $declared; do
  line="$(grep -h "export const $name" $SOURCES | head -1)"
  if ! printf '%s' "$line" | grep -q 'Object.freeze'; then
    echo "✗ تعدادٌ مغلقٌ بلا تجميدٍ في التشغيل: $name"
    echo '  readonly كلامُ الترجمة، وpush يعمل في التشغيل — لُفَّ الإعلانَ بـObject.freeze'
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "✗ فحصُ التعدادات المغلقة يرفض: تعدادٌ مغلقٌ بلا حرسٍ ولا سقف (T-131)"
  exit 1
fi

echo "✓ التعدادات المغلقة: $count_declared تعدادًا كلُّها مُسجَّلةٌ ومجمَّدة — والغلقُ مقيسٌ لا مُدَّعى"
