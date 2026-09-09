#!/usr/bin/env bash
# scripts/check_rehydrate_census.sh — حاجزُ حصرِ إرجاعِ أصنافِ اليوميّة (المرحلة 39 · W-2026-040)
# المالك: وزارة البيانات
# القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
# المدخلات: config/persistence.yaml · src/data/rehydrate_census.ts · src/kernel/config/persistence.ts
#   · src/index.ts · src/**  والجذرُ يُوجَّه بـ`SOOL_CHECK_ROOT` (درسُ W-2026-004: لا حالةَ
#   اختبارٍ تلمس ملفًّا حقيقيًّا)
# المخرجات: رمز 0 إن كان كلُّ صنفٍ في النطاق مُدَّعًى ودعواه مبرهنةً في الشفرة، و1 مع بيانِ الحكم
# التبعيات: bash + grep + sed (لا Node — ليعمل قبل البناء)
# الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يُضيف دعوى ولا يُعدّل نطاقًا
# السجلات: خرجٌ نصّي في البوابة
# حالات الفشل: صنفٌ في النطاق بلا صفٍّ · صفٌّ لصنفٍ لا وجودَ له · مستهلكٌ مُدَّعًى لا يذكر
#   الصنفَ في شفرته · إعفاءُ «لا مُنتِجَ له» وله مُنتِج · إعفاءُ «علامةُ ضغطٍ» بلا ضاغطٍ يذكره
#   · الحاجزُ غيرُ منادًى في مسار الإقلاع · حصرٌ أعمى (صفرُ صنفٍ مقروء)
# اختبار القبول: tests/data/rehydrate_census.test.ts
# الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
#   · القياسُ الخام: docs/test-reports/phase-39-W-2026-040-measurements.txt
#
# ثوابت هذا الفحص:
#
# 1) **الحاجزُ في التشغيل لا يكفي**: `assertRehydrateCensus` يسقط عند الإقلاع، لكنّه يُصدّق
#    الدعوى كما كُتبت. فمن كتب صفًّا يقول «يستهلكه rehydrate_fiscal.ts» ولا ذكرَ للصنف هناك
#    مرّ في التشغيل ولم يمرّ هنا: هذا الفحصُ يفتح ملفَّ المستهلكِ ويطلب ذكرَ الصنف.
#
# 2) **الإعفاءُ دعوى وبرهانُها هنا**: `declared_without_producer` يُسقط إن ظهر للصنفِ مُنتِجٌ
#    في `src/**` — فالإعفاءُ لا يبقى بعد زوالِ موجبه، وإلّا صار بابًا يُفتح بسطر.
#
# 3) **لكلِّ حكمٍ رمزٌ لاتينيٌّ ثابت** `[RC-NN]` قبل نصِّه العربيّ: النصُّ يُنقَّح والرمزُ عقدٌ
#    بين الفحصِ واختباره، فلا ينكسر اختبارٌ على تحسينِ صياغة.
#
# 4) **الحصرُ الأعمى يسقط**: مدخلٌ موجودٌ وحصيلتُه صفرُ صنفٍ يعني أنّ الصيغةَ تغيّرت والفحصُ
#    عَمِي. لا يُطبع «✓» على حصرٍ فارغ (RULE-001).
#
# الاستخدام: bash scripts/check_rehydrate_census.sh

set -u

ROOT="${SOOL_CHECK_ROOT:-.}"
CFG="$ROOT/config/persistence.yaml"
CENSUS="$ROOT/src/data/rehydrate_census.ts"
KINDS="$ROOT/src/kernel/config/persistence.ts"
BOOT="$ROOT/src/index.ts"

echo "حاجزُ حصرِ الإرجاع: لكلِّ صنفٍ في نطاق التدوين دعوى مبرهنةٌ في الشفرة (W-2026-040)"

for f in "$CFG" "$CENSUS" "$KINDS" "$BOOT"; do
  if [ ! -f "$f" ]; then
    echo "✗ [RC-09] مدخلٌ غائب: ${f#$ROOT/} — فحصٌ بلا مدخلٍ لا يحكم، ولا يُقال «لا انحراف»"
    exit 1
  fi
done

fail=0

# ── نطاقُ التدوين المعلن: أسطرُ `    - kind` تحت `  scope:` حتى أوّلِ مفتاحٍ بعدها ──────
SCOPE="$(awk '
  /^[[:space:]]{2}scope:[[:space:]]*$/ { inscope=1; next }
  inscope==1 {
    if ($0 ~ /^[[:space:]]{4}-[[:space:]]+[a-z_]+[[:space:]]*$/) {
      line=$0; sub(/^[[:space:]]*-[[:space:]]*/,"",line); sub(/[[:space:]]*$/,"",line); print line; next
    }
    if ($0 ~ /^[[:space:]]*$/ || $0 ~ /^[[:space:]]*#/) { next }
    inscope=0
  }
' "$CFG" | sort -u)"

# ── صفوفُ الدعاوى: `{ kind: 'x', consumer: 'p'|null, exemption: 'r'|null, ...}` ─────────
CLAIMS="$(grep -oE "\{ kind: '[a-z_]+', consumer: (null|'[^']+'), exemption: (null|'[a-z_]+')" "$CENSUS" \
  | sed -E "s/\{ kind: '([a-z_]+)', consumer: (null|'([^']+)'), exemption: (null|'([a-z_]+)')/\1|\3|\5/")"

# ── التعدادُ المغلق ─────────────────────────────────────────────────────────────────
DECLARED="$(sed -n "/DURABLE_KINDS = Object.freeze(\[/,/\] as const)/p" "$KINDS" \
  | grep -oE "'[a-z_]+'" | tr -d "'" | sort -u)"

scope_n=$(printf '%s\n' "$SCOPE" | grep -c . || true)
claims_n=$(printf '%s\n' "$CLAIMS" | grep -c . || true)
declared_n=$(printf '%s\n' "$DECLARED" | grep -c . || true)
echo "  المقيس: نطاقُ التدوين $scope_n صنفًا · جدولُ الدعاوى $claims_n صفًّا · التعدادُ المغلق $declared_n صنفًا"

# ── [RC-06] حصرٌ أعمى ────────────────────────────────────────────────────────────────
if [ "$scope_n" -eq 0 ] || [ "$claims_n" -eq 0 ] || [ "$declared_n" -eq 0 ]; then
  echo "✗ [RC-06] حصرٌ أعمى: قُرئ $scope_n من النطاق و$claims_n من الجدول و$declared_n من التعداد — والمدخلاتُ موجودة."
  echo "         فالصيغةُ تغيّرت والفحصُ لم يعد يرى ما يحكم عليه. لا يُطبع «✓» على حصرٍ فارغ."
  exit 1
fi

# ── [RC-10] أمانةُ المُحلِّل: ما قرأه حاصرُ الكتلةِ يجب أن يساوي كلَّ عنصرِ قائمةٍ في الملف ──
#    وهذا حرسٌ على الفحصِ نفسِه: كتلةُ `scope` هي القائمةُ الوحيدةُ في هذا الملف، فلو توقّف
#    المُحلِّلُ عند أوّلِ تعليقٍ مُزاحٍ لقرأ خمسةً من ثلاثةٍ وعشرين — وأخبر بخضرةٍ كاذبة.
all_items=$(grep -cE "^    - [a-z_]+$" "$CFG" || true)
if [ "$scope_n" -ne "$all_items" ]; then
  echo "✗ [RC-10] المُحلِّلُ قرأ $scope_n صنفًا وفي الملفّ $all_items عنصرَ قائمة — توقّفَ الحصرُ قبل نهايةِ الكتلة."
  echo "         خضرةٌ على حصرٍ ناقصٍ أسوأُ من حمرة: يُصلَح المُحلِّل، ولا يُخفَّض العددُ المتوقَّع."
  exit 1
fi

# ── [RC-01] صنفٌ في النطاق بلا صفٍّ في الجدول ────────────────────────────────────────
while IFS= read -r kind; do
  [ -z "$kind" ] && continue
  if ! printf '%s\n' "$CLAIMS" | grep -qE "^${kind}\|"; then
    echo "✗ [RC-01] صنفٌ في نطاق التدوين بلا دعوى إرجاع: $kind"
    echo "         يُدوَّن على القرص ويُسقَط صمتًا عند الإقلاع — يُضاف صفٌّ في REHYDRATE_CLAIMS أو يُنزع من scope."
    fail=1
  fi
done < <(printf '%s\n' "$SCOPE")

# ── فحصُ كلِّ صفٍّ: وجودُ الصنفِ في التعداد، وبرهانُ المستهلكِ أو الإعفاء ──────────────
while IFS='|' read -r kind consumer exemption; do
  [ -z "$kind" ] && continue

  # [RC-02] صفٌّ لصنفٍ ليس في التعداد المغلق
  if ! printf '%s\n' "$DECLARED" | grep -qxF "$kind"; then
    echo "✗ [RC-02] صفٌّ لصنفٍ ليس في التعداد المغلق: $kind — لا حرسَ على معدوم (RULE-001)."
    fail=1; continue
  fi

  if [ -n "$consumer" ]; then
    # [RC-03] المستهلكُ المُدَّعى موجودٌ ويذكر الصنفَ في شفرته
    if [ ! -f "$ROOT/$consumer" ]; then
      echo "✗ [RC-03] مستهلكٌ مُدَّعًى لا وجودَ لملفّه: $kind ⇐ $consumer"
      fail=1
    elif ! grep -qF "'$kind'" "$ROOT/$consumer"; then
      echo "✗ [RC-03] مستهلكٌ مُدَّعًى لا يذكر الصنفَ في شفرته: $kind ⇐ $consumer"
      echo "         دعوى استهلاكٍ لا برهانَ لها في الملفّ المُسمّى — وهي أخطرُ من غياب الدعوى لأنّها تُطمئن."
      fail=1
    fi
    continue
  fi

  # المُنتِجونَ: أيُّ ملفٍّ في src/** يُدوّن هذا الصنف
  producers="$(grep -rlE "\.record\('${kind}'" "$ROOT/src" 2>/dev/null | sed "s|^$ROOT/||" | sort -u)"

  case "$exemption" in
    declared_without_producer)
      # [RC-04] الإعفاءُ لا يبقى بعد زوال موجبه
      if [ -n "$producers" ]; then
        echo "✗ [RC-04] إعفاءٌ بطل موجبُه: $kind مُعفًى بحجّة «لا مُنتِجَ له» وله مُنتِجٌ في: $(printf '%s' "$producers" | tr '\n' ' ')"
        echo "         صارت له حالةٌ تُدوَّن ولا تُستعاد — يُكتب له مستهلكُ إرجاعٍ أو يُنزع من scope."
        fail=1
      fi
      ;;
    compaction_marker)
      # [RC-05] علامةُ الضغطِ يُنتجها الضاغطُ ويستهلكها — لا تُترك بلا ضاغطٍ يذكرها
      if ! grep -qF "'$kind'" "$ROOT/src/data/journal_compaction.ts" 2>/dev/null; then
        echo "✗ [RC-05] إعفاءٌ بحجّة «علامةُ ضغط» ولا ذكرَ للصنفِ في src/data/journal_compaction.ts: $kind"
        fail=1
      fi
      ;;
    *)
      echo "✗ [RC-08] صفٌّ بلا مستهلكٍ ولا إعفاءٍ معروف: $kind (الإعفاء: '${exemption}')"
      fail=1
      ;;
  esac
done < <(printf '%s\n' "$CLAIMS")

# ── [RC-07] الحاجزُ منادًى في مسار الإقلاع ───────────────────────────────────────────
if ! grep -qF 'assertRehydrateCensus(' "$BOOT"; then
  echo "✗ [RC-07] حاجزُ الحصر غيرُ منادًى في مسار الإقلاع (src/index.ts) — حاجزٌ لا يُنادى حاجزٌ بالاسم وحدَه (RULE-001)."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  claimed=$(printf '%s\n' "$CLAIMS" | awk -F'|' '$2!=""' | grep -c . || true)
  exempt=$(printf '%s\n' "$CLAIMS" | awk -F'|' '$2==""' | grep -c . || true)
  echo "✓ حصرُ الإرجاع: $scope_n صنفًا في النطاق كلُّها مُدَّعاة · $claimed بمستهلكٍ مبرهنٍ في شفرته · $exempt بإعفاءٍ قائمِ الموجب · والحاجزُ منادًى عند الإقلاع"
fi
exit "$fail"
