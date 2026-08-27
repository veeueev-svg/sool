/**
 * tests/governance/push_guard_gate.test.ts — حارسُ الدفعِ ومثبِّتُ خطّافِه (المرحلة 40، البند T-151)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/push_guard.sh` و`scripts/install_git_hooks.sh` كما يُنادَيان في الدفعِ
 *   الحقيقيّ + مستودعاتُ git حقيقيّةٌ **مُنشأةٌ في tmpdir** لكلِّ حالة
 * المخرجات: تأكيدُ أنّ الحارسَ يمنع الدفعَ برمزٍ مسمًّى على كلِّ علّة، ويأذن حين لا علّة
 * التبعيات: `node:child_process` (يشغّل الملفَّ الصدفيَّ عينَه) · `node:fs` · `node:os` · `node:path`
 * الصلاحيات (RULE-004): لا يلمس المستودعَ الحقيقيَّ بحرف — كلُّ حالةٍ في مستودعٍ مؤقّتٍ
 *   يُنشأ بـ`git init`، ولا حالةَ تدفع إلى بعيدٍ حقيقيّ
 * السجلات: خرجُ الحارسِ يُقرأ ويُرفَق في رسالة التأكيد عند السقوط
 * حالات الفشل المُغطّاة: شجرةٌ غيرُ نظيفة · رسالةٌ ناقصةُ الحقول · رسالةٌ بلا مِذيال Work ·
 *   فَرقٌ فارغ · حاجزٌ ردَّ · حاجزٌ مُعلَنٌ ملفُّه مفقود · حصرٌ أعمى · لا مستودعَ · وتثبيتُ
 *   الخطّافِ في غيرِ مستودع · وأنّ الخطّافَ المثبَّتَ **يمنع دفعًا حقيقيًّا** إلى بعيدٍ مؤقّت
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/work/orders/W-2026-010.md
 *   · القياسُ الخام: docs/audit/measurements/phase-40-T151.txt
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس الحارسَ لا يعيد كتابته**: يشغّل `scripts/push_guard.sh` عينَه الذي تناديه أداةُ
 *    الدفعِ وخطّافُ `pre-push` — فلا يمرّ اختبارٌ على منطقِ نسخةٍ ثانيةٍ ثمّ يمضي دفعٌ بلا حكم.
 *
 * 2) **جدولُ الحواجزِ يُبدَل بانحرافٍ معلن** (`SOOL_GUARD_GATES`): المرادُ قياسُ **أحكامِ
 *    الحارس** لا إعادةُ تشغيلِ السلسلةِ الحقيقيّةِ في كلِّ حالة (ثمنُها نحو 3.7 ثانية لكلِّ
 *    نداء). فتُمرَّر أوامرُ `true`/`false` وتُقاس القراءةُ نفسُها.
 *
 * 3) **لا حالةَ تلمس المستودعَ الحقيقيّ (درسُ W-2026-004)**: node يشغّل ملفّاتِ الاختبار
 *    بالتوازي، فكلُّ حالةٍ تُنشئ مستودعًا بـ`git init` في tmpdir وتُوجّه إليه الحارسَ
 *    بـ`SOOL_GUARD_ROOT`.
 *
 * 4) **المقيسُ رمزُ الخروجِ مع رمزِ الحكمِ `[PG-NN]` — لا نصٌّ عربيٌّ مشكول**: النصُّ يُنقَّح
 *    ويُشكَل، ومطابقتُه تكسر الاختبارَ على تحسينِ صياغةٍ لا على انفتاحِ باب. والحارسُ يجمع
 *    أحكامَه ثمّ يخرج بـ1، فطفرةٌ تُسقط حكمًا آخرَ تُنتج الرمزَ نفسَه — فكلُّ تأكيدٍ يشترط
 *    **رمزَ حارسِه** بعينه (درسُ T-136).
 *
 * 5) **الإذنُ يُختبَر كما يُختبَر المنع**: حالةٌ موجَبةٌ تؤكّد أنّ الحارسَ **يأذن** حين لا علّة
 *    — فحارسٌ يمنع كلَّ شيءٍ ليس حارسًا بل قفلٌ، وكان يمرّ على تأكيداتِ المنعِ وحدَها.
 *
 * 6) **الخطّافُ يُقاس بدفعٍ حقيقيّ**: لا يكفي وجودُ الملفِّ ولا كونُه قابلًا للتنفيذ —
 *    تُنشأ نسخةٌ عاريةٌ (`git init --bare`) في tmpdir ويُحاول `git push` إليها، فيُقاس أنّ
 *    الدفعَ **يُردّ** وأنّ البعيدَ **بقي بلا مرجع**. ودفعٌ يُظنُّ محروسًا وهو ماضٍ أخطرُ من
 *    دفعٍ مكشوفٍ معلوم.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const GUARD = 'scripts/push_guard.sh';
const INSTALLER = 'scripts/install_git_hooks.sh';

/** جدولُ حواجزَ يمرّ كلُّه — لقياسِ أحكامِ الحارسِ بلا ثمنِ السلسلةِ الحقيقيّة (الثابت 2). */
const PASSING_GATES = 'حاجزٌ أوّل|true\nحاجزٌ ثانٍ|true';
const MSG_OK = [
  'إصلاح(40): رسالةٌ مستوفيةُ الصيغة',
  '',
  'تم: شيءٌ قيس',
  'لم يتم: شيءٌ أُعلن',
  'التالي: خطوةٌ مسمّاة',
  'الاختبارات: أمرٌ → نتيجة',
  'التوثيق: ملفّات',
  'Work: W-2026-010',
].join('\n');

function git(root: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function runGuard(root: string, gates: string | null = PASSING_GATES): { code: number; out: string } {
  const env: Record<string, string> = { ...process.env, SOOL_GUARD_ROOT: root } as Record<string, string>;
  if (gates === null) delete env.SOOL_GUARD_GATES;
  else env.SOOL_GUARD_GATES = gates;
  const r = spawnSync('bash', [join(root, GUARD)], { cwd: root, encoding: 'utf8', env });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * مستودعٌ مؤقّتٌ بالتزامتَين (فالفَرقُ `HEAD~1..HEAD` غيرُ فارغ) ونسخةٌ من الحارسِ ومثبِّته.
 * والهُويّةُ تُمرَّر بـ`-c` لأنّ بيئةَ الاختبارِ قد تكون بلا هُويّةٍ مضبوطة.
 */
function makeRepo(message: string = MSG_OK): string {
  const root = mkdtempSync(join(tmpdir(), 'sool-push-guard-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, GUARD), join(root, GUARD));
  cpSync(join(ROOT, INSTALLER), join(root, INSTALLER));
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'أوّل.txt'), 'أوّل\n');
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=اختبار', 'commit', '-q', '-m', 'أوّل: أساسٌ للفَرق']);
  writeFileSync(join(root, 'ثانٍ.txt'), 'ثانٍ\n');
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=اختبار', 'commit', '-q', '-m', message]);
  return root;
}

// ── المسارُ الموجَب: الحارسُ يأذن حين لا علّة (الثابت 5) ─────────────────────────
test('حارسُ الدفع: يأذن على شجرةٍ نظيفةٍ ورسالةٍ مستوفيةٍ وحواجزَ تمرّ', () => {
  const root = makeRepo();
  const { code, out } = runGuard(root);
  assert.equal(code, 0, `كان يجب أن يأذن:\n${out}`);
  assert.match(out, /✓ حارسُ الدفع يأذن/);
  assert.doesNotMatch(out, /\[PG-0/);
});

test('حارسُ الدفع: يُعلن صراحةً ما لا يُشغّله — فلا يوهم أنّه السلسلةُ كلُّها', () => {
  const root = makeRepo();
  const { out } = runGuard(root);
  assert.match(out, /npm test/);
  assert.match(out, /لا يُشغّله هذا الحارس/);
});

// ── [PG-01] شجرةٌ غيرُ نظيفة: المدفوعُ يُقرأ من الملفّات ─────────────────────────
test('[PG-01] تعديلٌ غيرُ ملتزَمٍ يمنع الدفعَ — فالمدفوعُ ليس ما حُكم عليه', () => {
  const root = makeRepo();
  writeFileSync(join(root, 'أوّل.txt'), 'تعديلٌ لم يُلتزَم ولم يُحكَم عليه\n');
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-01\]/);
});

test('[PG-01] ملفٌّ غيرُ متعقَّبٍ يمنع الدفعَ كذلك — والجديدُ غيرُ الملتزَمِ يُدفع كما هو', () => {
  const root = makeRepo();
  writeFileSync(join(root, 'دخيل.txt'), 'ملفٌّ لم يُلتزَم\n');
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-01\]/);
});

// ── [PG-02] الرسالةُ الإلزاميّة ────────────────────────────────────────────────
test('[PG-02] رسالةٌ بلا مِذيال Work تمنع الدفعَ — والالتزامةُ بلا بندٍ مُعلَنٍ لا تُراجَع', () => {
  const root = makeRepo(MSG_OK.replace('\nWork: W-2026-010', ''));
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-02\]/);
  assert.match(out, /Work:/);
});

test('[PG-02] حقلٌ إلزاميٌّ غائبٌ («لم يتم:») يمنع الدفعَ ويُسمّى في الحكم', () => {
  const root = makeRepo(MSG_OK.replace('لم يتم: شيءٌ أُعلن\n', ''));
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-02\]/);
  assert.match(out, /لم يتم:/);
});

test('[PG-02] مِذيالٌ بصيغةٍ غيرِ المُعلنةِ (Work: 2026-10) لا يُقبل — والصيغةُ عقدٌ لا زينة', () => {
  const root = makeRepo(MSG_OK.replace('Work: W-2026-010', 'Work: 2026-10'));
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-02\]/);
});

test('[PG-02] مِذيالٌ مدفونٌ في جسدِ الرسالةِ لا يُقبل — والموضعُ من الصيغةِ لا زينةٌ فيها', () => {
  // طفرةٌ خصوميّةٌ نجت أوّلًا هنا: كان الفحصُ يقبل المِذيالَ في أيِّ موضع، ومِذيالٌ مدفونٌ
  // لا يقرأه git ولا قارئُ السجل. فسُدَّ بالفحصِ وبهذا التأكيدِ معًا.
  const buried = [
    'إصلاح(40): مِذيالٌ في الجسد',
    '',
    'تم: شيءٌ قيس',
    'Work: W-2026-010',
    'لم يتم: شيءٌ أُعلن',
    'التالي: خطوةٌ مسمّاة',
    'الاختبارات: أمرٌ → نتيجة',
    'التوثيق: ملفّات',
  ].join('\n');
  const root = makeRepo(buried);
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-02\]/);
});

// ── [PG-03] حكمُ حاجزٍ يُقرأ فيمنع — وهي علّةُ T-151 عينُها ─────────────────────
test('[PG-03] حاجزٌ يردُّ يمنع الدفعَ — وهذا هو الحكمُ الذي كان يُنتَج ولا يُقرأ', () => {
  const root = makeRepo();
  const { code, out } = runGuard(root, 'حاجزٌ يمرّ|true\nحاجزٌ يردّ|false');
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-03\]/);
  assert.match(out, /حاجزٌ يردّ/);
});

test('[PG-03] خرجُ الحاجزِ الرادِّ يُرفَق لا يُطوى — فالحكمُ يُقرأ لا يُعَدُّ', () => {
  const root = makeRepo();
  const { out } = runGuard(root, 'حاجزٌ يردّ|bash -c "echo عِلّةٌ مسمّاةٌ في الخرج; exit 3"');
  assert.match(out, /\[PG-03\]/);
  assert.match(out, /عِلّةٌ مسمّاةٌ في الخرج/);
  assert.match(out, /3/);
});

// ── [PG-05] حاجزٌ مُعلَنٌ لا ملفَّ له: لا يُفترض نجاحُه ───────────────────────────
test('[PG-05] حاجزٌ مُعلَنٌ ملفُّه مفقودٌ يمنع الدفعَ ولا يُتخطّى بصمت', () => {
  const root = makeRepo();
  const { code, out } = runGuard(root, 'حاجزٌ يمرّ|true\nحاجزٌ مفقود|bash scripts/لا_وجود_له.sh');
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-05\]/);
  assert.match(out, /لا_وجود_له\.sh/);
});

// ── [PG-04] الحصرُ الأعمى: صفرُ أحكامٍ ليس إذنًا (درسُ CI-05) ────────────────────
test('[PG-04] جدولٌ فارغٌ لا يُنتج إذنًا — وصفرُ حواجزَ شُغِّلت ليس خضرة', () => {
  const root = makeRepo();
  const { code, out } = runGuard(root, '');
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-04\]/);
});

test('[PG-04] وحكمُ الحصرِ الأعمى يُطبع مع الرمزِ لا رمزُ خروجٍ وحدَه — فالانهيارُ لا يُقرأ نجاحًا', () => {
  const root = makeRepo();
  const { out } = runGuard(root, '');
  assert.match(out, /\[PG-04\][^\n]*حاجز/);
});

// ── [PG-06] لا مستودع: حارسٌ بلا مدخلٍ لا يأذن ──────────────────────────────────
test('[PG-06] جذرٌ بلا .git يمنع الدفعَ فورًا ولا يُصدر حكمًا ثانيًا مُضِلًّا', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-push-guard-bare-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, GUARD), join(root, GUARD));
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-06\]/);
  assert.doesNotMatch(out, /\[PG-04\]/);
});

// ── [PG-07] فَرقٌ فارغ: لا يُدفع فراغٌ ليُقال دُفع ───────────────────────────────
test('[PG-07] التزامةٌ بلا فَرقٍ عن أمِّها تمنع الدفعَ', () => {
  const root = makeRepo();
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=اختبار', 'revert', '--no-edit', 'HEAD']);
  // الالتزامةُ الأخيرةُ الآن نقضٌ، ثمّ تُنشأ التزامةٌ بلا تغيير:
  const msgFile = join(root, '.msg');
  writeFileSync(msgFile, MSG_OK);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=اختبار', 'commit', '-q', '--allow-empty', '-F', msgFile]);
  git(root, ['rm', '-q', '--cached', '.msg']);
  writeFileSync(join(root, '.gitignore'), '.msg\n');
  git(root, ['add', '.gitignore']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=اختبار', 'commit', '-q', '--amend', '--allow-empty', '-F', msgFile]);
  // الفَرقُ الآن يحمل .gitignore، فتُضاف التزامةٌ فارغةٌ صريحةٌ فوقَه:
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=اختبار', 'commit', '-q', '--allow-empty', '-F', msgFile]);
  const { code, out } = runGuard(root);
  assert.equal(code, 1, `كان يجب أن يمنع:\n${out}`);
  assert.match(out, /\[PG-07\]/);
});

// ── مثبِّتُ الخطّاف: بابٌ ثانٍ لمحرّكٍ واحد ──────────────────────────────────────
test('مثبِّتُ الخطّاف: يُثبّت pre-push قابلًا للتنفيذ ويُعلن حدَّه', () => {
  const root = makeRepo();
  const r = spawnSync('bash', [join(root, INSTALLER)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOOL_GUARD_ROOT: root } as Record<string, string>,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 0, `كان يجب أن يُثبّت:\n${out}`);
  assert.match(out, /pre-push/);
  assert.match(out, /curl|الواجهة/, 'يجب أن يُعلن أنّ دفعَ الواجهةِ لا يستدعي خطّافًا');
  const hook = spawnSync('test', ['-x', join(root, '.git/hooks/pre-push')]);
  assert.equal(hook.status, 0, 'الخطّافُ المثبَّتُ يجب أن يكون قابلًا للتنفيذ — وغيرُ المنفَّذِ خطّافٌ بالاسم');
});

test('[IH-01] مثبِّتُ الخطّاف: لا يدّعي تثبيتًا في غيرِ مستودع', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-hooks-bare-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, INSTALLER), join(root, INSTALLER));
  const r = spawnSync('bash', [join(root, INSTALLER)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOOL_GUARD_ROOT: root } as Record<string, string>,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 1, `كان يجب أن يرفض:\n${out}`);
  assert.match(out, /\[IH-01\]/);
});

// ── والخطّافُ يُقاس بدفعٍ حقيقيّ إلى بعيدٍ مؤقّت (الثابت 6) ──────────────────────
test('الخطّافُ المثبَّت: يردُّ دفعًا حقيقيًّا حين يمنع الحارسُ، ويبقى البعيدُ بلا مرجع', () => {
  const root = makeRepo();
  spawnSync('bash', [join(root, INSTALLER)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOOL_GUARD_ROOT: root } as Record<string, string>,
  });
  const bare = mkdtempSync(join(tmpdir(), 'sool-bare-'));
  spawnSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
  writeFileSync(join(root, 'دخيل.txt'), 'غيرُ ملتزَمٍ فيمنع [PG-01]\n');
  const push = spawnSync('git', ['-C', root, 'push', bare, 'main'], {
    encoding: 'utf8',
    env: { ...process.env, SOOL_GUARD_GATES: PASSING_GATES } as Record<string, string>,
  });
  const out = `${push.stdout ?? ''}${push.stderr ?? ''}`;
  assert.notEqual(push.status, 0, `كان يجب أن يُردَّ الدفع:\n${out}`);
  assert.match(out, /\[PG-01\]/);
  const remote = spawnSync('git', ['--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/main'], { encoding: 'utf8' });
  assert.notEqual(remote.status, 0, 'البعيدُ يجب أن يبقى بلا مرجعٍ — وإلّا فالمنعُ كلامٌ');
});

test('الخطّافُ المثبَّت: يأذن بدفعٍ حقيقيٍّ حين لا علّة — فحارسٌ يمنع كلَّ شيءٍ قفلٌ لا حارس', () => {
  const root = makeRepo();
  spawnSync('bash', [join(root, INSTALLER)], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SOOL_GUARD_ROOT: root } as Record<string, string>,
  });
  const bare = mkdtempSync(join(tmpdir(), 'sool-bare-ok-'));
  spawnSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
  const push = spawnSync('git', ['-C', root, 'push', bare, 'main'], {
    encoding: 'utf8',
    env: { ...process.env, SOOL_GUARD_GATES: PASSING_GATES } as Record<string, string>,
  });
  const out = `${push.stdout ?? ''}${push.stderr ?? ''}`;
  assert.equal(push.status, 0, `كان يجب أن يمضي الدفع:\n${out}`);
  const remote = spawnSync('git', ['--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/main'], { encoding: 'utf8' });
  assert.equal(remote.status, 0, `البعيدُ يجب أن يحمل المرجعَ بعد إذنٍ:\n${out}`);
});
