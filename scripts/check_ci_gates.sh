#!/usr/bin/env bash
# scripts/check_ci_gates.sh — بوابةُ الدمجِ يجب أن تُشغّل كلَّ ما تُشغّله سلسلةُ التحقّق (T-148)
# وإجراءاتُها يجب أن تُثبَّت على وسمٍ يُعلن زمنَ التشغيلِ الذي تُنفَّذ عليه (T-146)
#
# العلّةُ التي وُلد منها هذا الفحص، مقيسةً في الجلسة 62:
#   سلسلةُ `npm run verify` 13 خطوةً · خطوات `run:` في بيان CI 12 · وثلاثةُ حواجزَ في
#   الأولى لا تُشغَّل في الثانية، أحدُها الحاجزُ الذي أُعيدت كتابتُه في `W-2026-006` قبل ساعة.
#   فحاجزٌ يُبنى ويُختبر ويُوثَّق ولا يُشغَّل على الدمج حاجزٌ بالاسم وحدَه (RULE-001).
#
# القرارُ المعلن: المقابلةُ **بالمُعرَّف المُنتَزَع من الأمر** (مسارُ ملفِّ الحاجز) لا بنصِّ
# الأمر، لأنّ `npm run check:size` و`bash scripts/check_module_size.sh` أمرانِ مختلفانِ
# نصًّا وحاجزٌ واحدٌ فعلًا. وكلُّ حكمٍ يُطبع برمزٍ لاتينيٍّ ثابتٍ `[CI-NN]` قبل نصِّه العربيّ —
# عقدًا بين الفحصِ واختبارِه، فلا ينكسر الاختبارُ على تنقيحِ صياغة.
#
# الاستخدام: bash scripts/check_ci_gates.sh
#   SOOL_CHECK_ROOT=<مجلد>  يُغيّر الجذرَ المفحوص (تُحرَّف نسخةٌ لا أصل — درسُ W-2026-004)
# النتيجة: 0 إذا كانت البوابتان متطابقتَين بالمُعرَّف والإجراءاتُ مثبَّتةً على زمنٍ مُعلَن، و1 مع بيانِ الحكم

set -u

ROOT="${SOOL_CHECK_ROOT:-.}"
CI_FILE="$ROOT/.github/workflows/ci.yml"
PKG_FILE="$ROOT/package.json"

echo "بوابةُ الدمجِ مقابلَ سلسلةِ التحقّق: كلُّ حاجزٍ يُقاس عليه محلّيًّا يجب أن يُشغَّل على الدمج (T-148 · T-146)"

fail=0

# ── [CI-09] وجودُ المدخلَين: فحصٌ لا مدخلَ له لا يحكم ─────────────────────────────
for f in "$CI_FILE" "$PKG_FILE"; do
  if [ ! -f "$f" ]; then
    echo "✗ [CI-09] مدخلٌ غائب: ${f#$ROOT/} — فحصٌ بلا مدخلٍ لا يحكم، ولا يُقال «لا انحراف»"
    exit 1
  fi
done

# ── جدولُ الاستثناء: أمرٌ في CI ليس في verify، بسببٍ مكتوبٍ يُقرأ ─────────────────
# الصيغة: المُعرَّف|السببُ المكتوب      (والمُعرَّفُ كما يُنتزعه هذا الفحصُ لا كما يُشتهى)
EXCEPTIONS=$(cat <<'TABLE'
scripts/check_documentation.sh|يحكم على فَرقِ التزامةٍ (git diff HEAD~1 HEAD) فلا معنى له في شجرةِ عملٍ غيرِ ملتزَمة، وverify يعمل على الشجرة لا على الفَرق — فبقاؤه في CI وحدَه حكمٌ لا سهو، ومعناه أنّ خضرةَ verify محلّيًّا لم تكن قطُّ تعني خضرةَ CI
خامّ:npm ci|تهيئةُ بيئةٍ لا حاجزَ حكم: verify يفترض التبعيّاتَ مثبَّتةً في الجذرِ المحلّيّ، وCI يثبّتها من ملفِّ القفل في عارضٍ نظيف
scripts/t163_failure_summary.sh|خطوةٌ تشخيصيةٌ (T-163) تعملُ بـif: failure() فقط بعدَ سقوطِ خطوةٍ سابقةٍ، فلا تُغيّرُ الحكمَ (رمزُ خروجِها 0) ولا تُقاسُ عليه محلّيًّا لأنّها تُخرجُ معلومةً لا تحكمُ — أسطرُ الأحكامِ الساقطةِ تُقرأُ من dist/.tests.tap لا تُعادُ ولا تُخفى
TABLE
)

# ── جدولُ زمنِ التشغيلِ المُعلَن للإجراءات (T-146) ────────────────────────────────
# الصيغة: الإجراء|أدنى وسمٍ يُعلن node24|السببُ المقيس
# وهو جدولٌ ساكنٌ يُقرأ بلا شبكة — وحدُّه مُعلَنٌ في عقد W-2026-009 §8: إجراءٌ غيرُ مذكورٍ
# فيه لا يراه بابُ [CI-07]، ولا يُغلق ذلك إلّا بقراءةِ action.yml من الشبكة وهو ما لا يجوز هنا.
ACTION_RUNTIMES=$(cat <<'TABLE'
actions/checkout|5|قيس من action.yml على الأوسمة: v4 يقول runs.using = node20 · v5 وv7 يقولان node24
actions/setup-node|5|قيس من action.yml على الأوسمة: v4 يقول runs.using = node20 · v5 وv7 يقولان node24
TABLE
)

# ── انتزاعُ المُعرَّف من أمرٍ واحد ────────────────────────────────────────────────
# TESTS = مُشغّلُ الاختبارات · BUILD = المترجم · وإلّا مسارُ ملفِّ الحاجز · وإلّا «خامّ:الأمر»
gate_id() {
  local c="$1"
  c="$(printf '%s' "$c" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$c" in
    *--test*dist/tests*) printf 'TESTS'; return 0 ;;
    *tsc*)               printf 'BUILD'; return 0 ;;
  esac
  local p
  p="$(printf '%s' "$c" | grep -oE '(dist/)?scripts/[A-Za-z0-9_./-]+\.(sh|mjs|js)' | head -n1)"
  if [ -n "$p" ]; then printf '%s' "$p"; return 0; fi
  printf 'خامّ:%s' "$c"
}

# ── حواجزُ سلسلةِ verify، ونداءاتُ `npm run X` تُفتح من package.json ──────────────
# القراءةُ بـawk من الأسطر المفردة `"الاسم": "الجسم"` — والحصرُ الأعمى محروسٌ بـ[CI-05].
scripts_of_pkg() {
  awk '
    match($0, /^[[:space:]]*"[A-Za-z0-9:_-]+"[[:space:]]*:[[:space:]]*".*"[,]?[[:space:]]*$/) {
      name=$0; sub(/^[[:space:]]*"/,"",name); sub(/".*$/,"",name)
      # الجسمُ يُقصّ بعد الاسمِ المُقتبَسِ كاملًا لا بعد أوّلِ نقطتَين: أسماءٌ مثل "check:size" تحوي نقطتَين
      body=$0; sub(/^[[:space:]]*"[^"]*"[[:space:]]*:[[:space:]]*"/,"",body); sub(/"[,]?[[:space:]]*$/,"",body)
      if (name != "" && body != "") print name "\t" body
    }
  ' "$PKG_FILE"
}

PKG_SCRIPTS="$(scripts_of_pkg)"

script_body() {
  printf '%s\n' "$PKG_SCRIPTS" | awk -F'\t' -v n="$1" '$1==n {print $2; exit}'
}

# يفتح `npm run X` و`npm test` تكرارًا حتى تبقى أوامرُ التشغيلِ الحقيقيّة
expand_commands() {
  local body="$1" depth="${2:-0}"
  [ "$depth" -gt 6 ] && { printf '%s\n' "$body"; return 0; }
  local IFS='&'
  printf '%s\n' "$body" | tr '&' '\n' | while IFS= read -r part; do
    part="$(printf '%s' "$part" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "$part" ] && continue
    local sub=""
    case "$part" in
      "npm run "*) sub="$(script_body "${part#npm run }")" ;;
      "npm test")  sub="$(script_body test)" ;;
    esac
    if [ -n "$sub" ]; then expand_commands "$sub" "$((depth+1))"; else printf '%s\n' "$part"; fi
  done
}

VERIFY_BODY="$(script_body verify)"
VERIFY_IDS=""
if [ -n "$VERIFY_BODY" ]; then
  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    VERIFY_IDS="$VERIFY_IDS$(gate_id "$cmd")"$'\n'
  done < <(expand_commands "$VERIFY_BODY")
fi
VERIFY_IDS="$(printf '%s' "$VERIFY_IDS" | grep -v '^$' | sort -u || true)"

# ── حواجزُ بيان CI: كلُّ `run:` (سطرًا واحدًا أو كتلةً) ───────────────────────────
CI_CMDS="$(awk '
  /^[[:space:]]*run:[[:space:]]*\|/ { inblock=1; next }
  /^[[:space:]]*run:[[:space:]]*[^|[:space:]]/ {
    line=$0; sub(/^[[:space:]]*run:[[:space:]]*/,"",line); print line; inblock=0; next
  }
  inblock==1 {
    if ($0 ~ /^[[:space:]]*-[[:space:]]/ || $0 ~ /^[[:space:]]*[a-zA-Z-]+:[[:space:]]/) { inblock=0; next }
    line=$0; gsub(/^[[:space:]]+/,"",line); if (line != "") print line
  }
' "$CI_FILE")"

CI_IDS=""
while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  while IFS= read -r one; do
    [ -z "$one" ] && continue
    CI_IDS="$CI_IDS$(gate_id "$one")"$'\n'
  done < <(expand_commands "$cmd")
done < <(printf '%s\n' "$CI_CMDS")
CI_IDS="$(printf '%s' "$CI_IDS" | grep -v '^$' | sort -u || true)"

v_count=$(printf '%s\n' "$VERIFY_IDS" | grep -c . || true)
c_count=$(printf '%s\n' "$CI_IDS" | grep -c . || true)
x_count=$(printf '%s\n' "$EXCEPTIONS" | grep -c . || true)
echo "  المقيس: سلسلةُ التحقّق $v_count مُعرَّفًا · بيانُ الدمج $c_count مُعرَّفًا · مستثنًى بسببٍ: $x_count"

# ── [CI-05] الحصرُ الأعمى: مدخلٌ موجودٌ وحصيلتُه صفر ⇒ الصيغةُ تغيّرت والفحصُ عَمِي ──
if [ "$v_count" -eq 0 ] || [ "$c_count" -eq 0 ]; then
  echo "✗ [CI-05] حصرٌ أعمى: قُرئ $v_count من سلسلةِ التحقّق و$c_count من بيانِ الدمج — والمدخلانِ موجودان."
  echo "         فالصيغةُ تغيّرت والفحصُ لم يعد يرى ما يحكم عليه. لا يُطبع «✓» على حصرٍ فارغ."
  exit 1
fi

# ── [CI-01] حاجزٌ في سلسلةِ التحقّق غائبٌ عن بيانِ الدمج ─────────────────────────
while IFS= read -r id; do
  [ -z "$id" ] && continue
  if ! printf '%s\n' "$CI_IDS" | grep -qxF "$id"; then
    echo "✗ [CI-01] حاجزٌ يُقاس عليه محلّيًّا ولا يُشغَّل على الدمج: $id"
    echo "         فهو حاجزٌ بالاسم وحدَه (RULE-001) — يُضاف خطوةً في .github/workflows/ci.yml أو يُنزع من سلسلة verify بإعلان."
    fail=1
  fi
done < <(printf '%s\n' "$VERIFY_IDS")

# ── حرّاسُ جدولِ الاستثناء نفسِه: وإلّا كان بابًا يُفتح بسطر ─────────────────────
while IFS= read -r row; do
  [ -z "$row" ] && continue
  name="${row%%|*}"; reason="${row#*|}"
  # [CI-03] استثناءٌ بلا سببٍ مكتوب
  if [ -z "$(printf '%s' "$reason" | tr -d '[:space:]')" ] || [ "$reason" = "$name" ]; then
    echo "✗ [CI-03] استثناءٌ بلا سببٍ مكتوب: $name — والاستثناءُ بلا سببٍ مهربٌ لا حكم."
    fail=1; continue
  fi
  # [CI-04] استثناءٌ لاسمٍ لا وجودَ له في بيانِ الدمج
  if ! printf '%s\n' "$CI_IDS" | grep -qxF "$name"; then
    echo "✗ [CI-04] استثناءٌ لمُعرَّفٍ لا وجودَ له في بيانِ الدمج: $name — لا يُستثنى ما ليس هناك (RULE-001)."
    fail=1; continue
  fi
  # [CI-08] استثناءٌ لا حاجةَ له: المُعرَّفُ في سلسلةِ التحقّق أصلًا
  if printf '%s\n' "$VERIFY_IDS" | grep -qxF "$name"; then
    echo "✗ [CI-08] استثناءٌ لا موضعَ له: $name موجودٌ في سلسلةِ التحقّق فلا يُستثنى منها — سببٌ مكتوبٌ لبابٍ غيرِ مفتوح."
    fail=1
  fi
done < <(printf '%s\n' "$EXCEPTIONS")

# ── [CI-02] أمرٌ في بيانِ الدمج ليس في سلسلةِ التحقّق ولا في جدولِ الاستثناء ─────
while IFS= read -r id; do
  [ -z "$id" ] && continue
  printf '%s\n' "$VERIFY_IDS" | grep -qxF "$id" && continue
  if printf '%s\n' "$EXCEPTIONS" | grep -qF "$id|"; then continue; fi
  echo "✗ [CI-02] أمرٌ يُشغَّل على الدمج ولا يُقاس عليه محلّيًّا ولا سببَ مكتوبًا له: $id"
  echo "         فمن سقط عليه في CI لا يستطيع إعادةَ إسقاطِه قبل الدفع — يُضاف إلى verify أو يُستثنى بسببٍ يُقرأ."
  fail=1
done < <(printf '%s\n' "$CI_IDS")

# ── بابُ T-146: الإجراءاتُ تُثبَّت على وسمٍ يُعلن زمنَ التشغيل ────────────────────
uses_count=0
while IFS= read -r u; do
  [ -z "$u" ] && continue
  uses_count=$((uses_count+1))
  action="${u%@*}"; tag="${u##*@}"
  # [CI-06] وسمٌ غيرُ صريح
  if ! printf '%s' "$u" | grep -qE '@v[0-9]+'; then
    echo "✗ [CI-06] إجراءٌ بلا وسمٍ صريح: $u — فما يُنفَّذ غيرُ معلومٍ من البيان."
    fail=1; continue
  fi
  major="$(printf '%s' "$tag" | sed -e 's/^v//' -e 's/[^0-9].*$//')"
  row="$(printf '%s\n' "$ACTION_RUNTIMES" | grep -F "$action|" | head -n1 || true)"
  if [ -z "$row" ]; then
    echo "  ℹ إجراءٌ غيرُ مذكورٍ في جدولِ زمنِ التشغيل: $u — لا يراه بابُ [CI-07]، وهو حدٌّ مُعلَنٌ في عقد W-2026-009 §8"
    continue
  fi
  min="$(printf '%s' "$row" | cut -d'|' -f2)"
  why="$(printf '%s' "$row" | cut -d'|' -f3)"
  if [ "$major" -lt "$min" ]; then
    echo "✗ [CI-07] إجراءٌ يُعلن زمنًا غيرَ الذي يُنفَّذ عليه: $u — أدنى وسمٍ يُعلن node24 هو v$min."
    echo "         $why"
    echo "         فالعارضُ يرفعه قسرًا، واختلافُ سلوكٍ بين المحلّيِّ والدمجِ يصير غيرَ قابلٍ للنسبة إلى سببٍ واحد (T-146)."
    fail=1
  fi
done < <(grep -oE 'uses:[[:space:]]*[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+' "$CI_FILE" | sed -E 's/^uses:[[:space:]]*//' | sort -u)

# ── [CI-05ب] حصرٌ أعمى على الإجراءات: بيانٌ بلا `uses:` واحدٍ ────────────────────
if [ "$uses_count" -eq 0 ]; then
  echo "✗ [CI-05] حصرٌ أعمى: لا `uses:` واحدًا في بيانِ الدمج — والبيانُ لا يخلو منها، فالصيغةُ تغيّرت والفحصُ عَمِي."
  exit 1
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ بوابةُ الدمج: $v_count حاجزًا في سلسلةِ التحقّق كلُّها تُشغَّل على الدمج · $x_count مستثنًى بسببٍ مكتوب · $uses_count إجراءً مثبَّتًا على وسمٍ يُعلن زمنَه"
fi
exit "$fail"
