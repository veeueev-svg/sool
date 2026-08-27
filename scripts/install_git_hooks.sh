#!/usr/bin/env bash
# scripts/install_git_hooks.sh — الخطّافُ يُثبَّت من المستودعِ لا من الذاكرة (T-151)
#
# لماذا مثبِّتٌ ولا يكفي ملفٌّ في الشجرة: مجلَّدُ `.git/hooks` **ليس محكومًا بالنسخ** —
# لا يُستنسخ مع المستودعِ ولا يُراجَع في فَرق. وقيس في الجلسة 62 أنّه **كان فارغًا من كلِّ
# خطّافٍ فعّال** (لا شيءَ غيرَ `*.sample`)، فحتّى `git push` المعتاد مضى بلا فحص.
#
# وحدٌّ يُعلَن ولا يُطوى: **خطّافُ `pre-push` لا يُستدعى في طريقِ الدفعِ بواجهةِ GitHub**
# (blobs ⇒ tree ⇒ commit ⇒ PATCH ref بـcurl، بلا `git push` أصلًا). فمن اكتفى بالخطّافِ
# حرس بابًا لا يُمَرُّ منه. ولذلك **بابانِ لمحرّكٍ واحد**: هذا الخطّافُ لطريقِ `git push`،
# وأداةُ الدفعِ تنادي `scripts/push_guard.sh` بنفسِها لطريقِ الواجهة.
#
# الاستخدام: bash scripts/install_git_hooks.sh
#   SOOL_GUARD_ROOT=<مجلد>  يُغيّر الجذرَ المثبَّتَ فيه (تُحرَّف نسخةٌ لا أصل)
# النتيجة: 0 مع بيانِ ما ثُبِّت، و1 إذا لم يُمكن التثبيت — والفشلُ يُعلَن ولا يُسكت عنه

set -u

ROOT="${SOOL_GUARD_ROOT:-.}"
HOOK_DIR="$ROOT/.git/hooks"
HOOK="$HOOK_DIR/pre-push"

if [ ! -d "$ROOT/.git" ]; then
  echo "✗ [IH-01] لا مستودعَ في «$ROOT»: لا مجلَّدَ .git — ولا يُثبَّت خطّافٌ في غير مستودع"
  exit 1
fi

mkdir -p "$HOOK_DIR" || { echo "✗ [IH-02] تعذّر إنشاءُ «$HOOK_DIR» — والتثبيتُ الفاشلُ يُعلَن ولا يُفترض نجاحُه"; exit 1; }

cat > "$HOOK" <<'HOOK_BODY'
#!/usr/bin/env bash
# خطّافٌ مولَّدٌ من scripts/install_git_hooks.sh — لا يُحرَّر هنا (التحريرُ في المستودع)
# يمنع `git push` إن ردَّ حارسُ الدفع (T-151)
set -u
ROOT="$(git rev-parse --show-toplevel)"
if [ ! -f "$ROOT/scripts/push_guard.sh" ]; then
  echo "✗ خطّافُ pre-push: لا يوجد scripts/push_guard.sh — ولا يُؤذن بالدفعِ بحارسٍ مفقود"
  exit 1
fi
bash "$ROOT/scripts/push_guard.sh" || {
  echo "✗ خطّافُ pre-push: حارسُ الدفعِ منع — والحكمُ أعلاه قُرئ (T-151)"
  exit 1
}
HOOK_BODY

chmod +x "$HOOK" || { echo "✗ [IH-03] تعذّر جعلُ «$HOOK» قابلًا للتنفيذ — وخطّافٌ غيرُ منفَّذٍ خطّافٌ بالاسم وحدَه"; exit 1; }

if [ ! -x "$HOOK" ]; then
  echo "✗ [IH-03] «$HOOK» ليس قابلًا للتنفيذ بعد التثبيت — ولا يُقال ثُبِّت"
  exit 1
fi

echo "✓ ثُبِّت خطّافُ pre-push في «$HOOK» ينادي scripts/push_guard.sh"
echo "ℹ حدٌّ مُعلَن: هذا الخطّافُ يحرس طريقَ git push وحدَه — ودفعُ الواجهةِ (curl) لا يستدعي خطّافًا،"
echo "  فيَجب أن ينادي الحارسَ بنفسِه. بابانِ لمحرّكٍ واحدٍ لا بابٌ يُظنُّ كافيًا."
exit 0
