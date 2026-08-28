/**
 * tests/governance/push_api.test.ts — أحكامُ أداةِ الدفع (المرحلة 40، البند T-153 · `W-2026-014`)
 * المالك: المساعد الآلي — Perplexity Computer (الجلسة 65) | المراجع: القيّم على المستودع
 * المدخلات: `scripts/push_api.mjs` · جذورٌ مؤقّتةٌ تُبنى بـ`git init` وتُحذف · ملفُّ حالِ بعيدٍ
 *   يُعطى بـ`SOOL_PUSH_REMOTE_FILE` (انحرافٌ معلنٌ تطبعه الأداةُ نفسُها)
 * المخرجات: تأكيدٌ أنّ كلَّ حكمٍ من أحكامِ الأداةِ يُسقط رمزَ الخروج 1 برمزِه `[PA-NN]`، وأنّ
 *   المسارَ الموجَبَ يُذن برمز 0 معبِّرًا عن الحذفِ وحافظًا للأنماط
 * التبعيات: `node:child_process` · `node:fs` · `node:os` — **لا شبكةَ ولا شفرةَ إنتاج**
 * الصلاحيات (RULE-004): يقرأ الأداةَ ويكتب في `tmpdir` وحدَه؛ لا يلمس المستودعَ الحقيقيَّ
 *   ولا يدفع شيئًا ولا يوقّع حكمًا
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: لا مستودع · شجرةٌ غيرُ نظيفة · أبٌ غيرُ واحد (دمج) · ملفُّ حالِ
 *   بعيدٍ غائبٌ أو ناقص · **تباعدٌ صامت** · حصرٌ أعمى · `--force` · مُعامِلٌ يشبه السرَّ ·
 *   فعلٌ غيرُ معلن · دفعٌ حقيقيٌّ على حالٍ من ملفّ
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-T153.md · docs/work/orders/W-2026-014.md §4
 *
 * ثوابت هذا الملف:
 *
 * 1) **المقيسُ رمزُ الخروجِ ثمّ الرمزُ اللاتينيّ**: لو طبعت الأداةُ حكمًا ولم تُسقط الرمزَ
 *    لمضى الدفعُ — وتلك عينُ علّةِ الجلسة 62 التي وُلد منها حارسُ الدفع. والرمزُ `[PA-NN]`
 *    عقدٌ، فلا ينكسر الاختبارُ على تنقيحِ صياغةٍ عربيّة.
 *
 * 2) **لا حالةَ تلمس المستودعَ الحقيقيّ** (درسُ `W-2026-004`): node يشغّل ملفّاتِ الاختبار
 *    بالتوازي، فعبثٌ في المستودع يجعل البوابةَ تسقط بالاحتمال. فكلُّ حالةٍ في جذرٍ يُبنى
 *    بـ`git init` في `tmpdir` ويُحذف في `finally` ولو سقط التأكيد.
 *
 * 3) **لا شبكةَ في اختبارٍ**: حالُ البعيدِ يُعطى من ملفٍّ، فالأحكامُ كلُّها تُقاس في المخطِّط.
 *    والدفعُ الحقيقيُّ على حالٍ من ملفٍّ **مرفوضٌ بحكمٍ مُختبَرٍ هنا** — فلا يُخلط الانحرافُ
 *    بالإنتاج.
 *
 * 4) **العلّةُ الأصليّةُ تُصطنع لا تُوصف**: حالةُ التباعدِ تبني بعيدًا تقدَّم فعلًا ومحلّيًّا
 *    من الأساسِ نفسِه — وهي عينُ الصورةِ التي أنتجت ضياعَ `both-REMOTE` في القياسِ الخامّ
 *    (`docs/audit/measurements/phase-40-T153.txt` §3). فالحكمُ يُقاس على ما وقع لا على شبهِه.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const TOOL = join(ROOT, 'scripts/push_api.mjs');

interface Run { code: number; out: string }

function git(dir: string, args: readonly string[]): void {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr ?? ''}`);
}

function gitOut(dir: string, args: readonly string[]): string {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr ?? ''}`);
  return (r.stdout ?? '').trim();
}

/** يشغّل الأداةَ كما تُشغَّل: عمليّةٌ منفصلةٌ يُقرأ رمزُ خروجِها */
function runTool(dir: string, args: readonly string[], remoteFile?: string): Run {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (remoteFile !== undefined) env['SOOL_PUSH_REMOTE_FILE'] = remoteFile;
  else delete env['SOOL_PUSH_REMOTE_FILE'];
  const r = spawnSync('node', [TOOL, `--root=${dir}`, ...args], { encoding: 'utf8', env });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * مسارُ ملفٍّ مساعدٍ **خارجَ** شجرةِ العمل: لو كُتب حالُ البعيدِ داخلَ الجذرِ لَجعل الشجرةَ
 * غيرَ نظيفةٍ فسقط كلُّ حكمٍ بـ`[PA-02]` — قيس: 7 من 13 تأكيدًا سقطت هكذا في أوّلِ تشغيل.
 */
function statePath(dir: string, name: string): string {
  return join(dir, '..', name);
}

/** جذرٌ مؤقّتٌ فيه أساسٌ ملتزَم: نصٌّ ومحذوفٌ مرتقَبٌ وملفٌّ تنفيذيّ */
function makeRepo(): string {
  const base = mkdtempSync(join(tmpdir(), 'sool-push-'));
  const dir = join(base, 'repo');
  mkdirSync(dir);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'user.name', 'اختبار']);
  writeFileSync(join(dir, 'keep.txt'), 'one\n');
  writeFileSync(join(dir, 'gone.txt'), 'gone\n');
  writeFileSync(join(dir, 'both.txt'), 'both\n');
  writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\necho x\n');
  chmodSync(join(dir, 'run.sh'), 0o755);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'أساس']);
  return dir;
}

/** يكتب حالَ البعيدِ: بصمةُ التزامةٍ وشجرتُها */
function remoteAt(dir: string, commitish: string): string {
  const file = statePath(dir, 'remote-state.json');
  const sha = gitOut(dir, ['rev-parse', commitish]);
  const tree = gitOut(dir, ['rev-parse', `${commitish}^{tree}`]);
  writeFileSync(file, `${JSON.stringify({ sha, tree })}\n`);
  return file;
}

function withRepo(body: (dir: string) => void): void {
  const dir = makeRepo();
  try {
    body(dir);
  } finally {
    // يُحذف الجذرُ **وما حوله** من ملفّاتِ الحالِ (RULE-001: ما أُنشئ يُحذف)
    rmSync(join(dir, '..'), { recursive: true, force: true });
  }
}

// ── المسارُ الموجَب: الحذفُ يُعبَّر عنه والأنماطُ تُقرأ من git ────────────────────────
test('T-153: خطّةٌ مأذونةٌ تُعبّر عن الحذفِ بـsha=null وتحفظ نمطَ 100755', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'both.txt'), 'both-LOCAL\n');
    writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\necho y\n');
    git(dir, ['rm', '-q', 'gone.txt']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'عملٌ محلّيّ']);
    const remote = remoteAt(dir, 'HEAD^');
    const r = runTool(dir, ['--plan'], remote);
    assert.equal(r.code, 0, r.out);
    // الحذفُ مُعبَّرٌ عنه: هذه هي العلّةُ التي كانت تُسقط `git show` برمز 128
    assert.match(r.out, /D {2}100644 {2}gone\.txt {2}sha=null/, r.out);
    assert.match(r.out, /M {2}100755 {2}run\.sh {2}sha=محتوًى/, r.out);
    assert.match(r.out, /M {2}100644 {2}both\.txt {2}sha=محتوًى/, r.out);
    assert.match(r.out, /لا تباعد/, r.out);
    // الملفُّ الذي لم يتغيّرْ لا يدخل الخطّةَ: base_tree يحمله
    assert.doesNotMatch(r.out, /keep\.txt/, r.out);
  });
});

test('T-153: المسارُ المحذوفُ لا يُقرأ محتواه أصلًا — ولا يُسقط الخطّةَ برمز 128', () => {
  withRepo((dir) => {
    git(dir, ['rm', '-q', 'gone.txt']);
    git(dir, ['commit', '-qm', 'حذفٌ وحدَه']);
    // برهانُ العلّةِ الأصليّة في الجذرِ نفسِه: قراءةُ المحذوفِ تسقط
    const show = spawnSync('git', ['-C', dir, 'show', 'HEAD:gone.txt'], { encoding: 'utf8' });
    assert.equal(show.status, 128, 'يُنتظر سقوطُ git show على مسارٍ محذوف');
    const r = runTool(dir, ['--plan'], remoteAt(dir, 'HEAD^'));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /D {2}100644 {2}gone\.txt {2}sha=null/, r.out);
  });
});

// ── [PA-05] التباعدُ الصامت: الحكمُ الذي وُلد منه هذا البند ─────────────────────────
test('T-153 [PA-05]: تقدُّمُ البعيدِ يردُّ الدفعَ ويطبع الشجرتَين — فلا ضياعَ صامت', () => {
  withRepo((dir) => {
    const base = gitOut(dir, ['rev-parse', 'HEAD']);
    // البعيدُ تقدَّم: عدّل both.txt وأضاف ملفًّا
    git(dir, ['checkout', '-q', '-b', 'remote']);
    writeFileSync(join(dir, 'both.txt'), 'both-REMOTE\n');
    writeFileSync(join(dir, 'onlyremote.txt'), 'new\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'تقدُّمُ البعيد']);
    const remote = remoteAt(dir, 'remote');
    const remoteTree = gitOut(dir, ['rev-parse', 'remote^{tree}']);
    // والمحلّيُّ من الأساسِ نفسِه: عدّل both.txt وحذف gone.txt
    git(dir, ['checkout', '-q', '-b', 'local', base]);
    writeFileSync(join(dir, 'both.txt'), 'both-LOCAL\n');
    git(dir, ['rm', '-q', 'gone.txt']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'عملٌ محلّيّ']);
    const parentTree = gitOut(dir, ['rev-parse', 'HEAD^^{tree}']);
    assert.notEqual(parentTree, remoteTree, 'يُنتظر اختلافُ الشجرتَين');

    const r = runTool(dir, ['--plan'], remote);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-05\]/, r.out);
    // الشجرتان تُطبعان معًا: حكمٌ بلا مقيسٍ لا يُصلَح عليه شيء
    assert.match(r.out, new RegExp(remoteTree), r.out);
    assert.match(r.out, new RegExp(parentTree), r.out);
    // ولا يُطبع «✓» ولا خطّةٌ مأذونة
    assert.doesNotMatch(r.out, /الخطّةُ مأذونة/, r.out);
  });
});

test('T-153 [PA-05]: مقابلةُ الشجرةِ لا الهاش — بصمةٌ مختلفةٌ بشجرةٍ مطابقةٍ تُذن', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'both.txt'), 'both-LOCAL\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'عملٌ محلّيّ']);
    const parent = gitOut(dir, ['rev-parse', 'HEAD^']);
    const parentTree = gitOut(dir, ['rev-parse', 'HEAD^^{tree}']);
    // بصمةٌ لا توجد في الجذرِ أصلًا وشجرتُها هي شجرةُ الأب: كما يفعل الـAPI حين
    // يُعيد كتابةَ المُلزِم. فلو قابلت الأداةُ الهاشَ لَرُدَّ كلُّ دفعٍ صحيح.
    const file = statePath(dir, 'remote-state.json');
    writeFileSync(file, `${JSON.stringify({ sha: 'f'.repeat(40), tree: parentTree })}\n`);
    assert.notEqual('f'.repeat(40), parent);
    const r = runTool(dir, ['--plan'], file);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /لا تباعد/, r.out);
  });
});

// ── بقيّةُ الأحكام: كلُّ واحدٍ برمزِه ─────────────────────────────────────────────
test('T-153 [PA-01]: ما ليس مستودعًا لا يُدفع', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-push-bare-'));
  try {
    const file = statePath(dir, 'remote-state.json');
    writeFileSync(file, `${JSON.stringify({ sha: 'a'.repeat(40), tree: 'b'.repeat(40) })}\n`);
    const r = runTool(dir, ['--plan'], file);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-01\]/, r.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-153 [PA-02]: شجرةٌ غيرُ نظيفةٍ تردُّ الدفعَ — فلا يُدفع ما لم يُلتزم', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'both.txt'), 'both-LOCAL\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'عملٌ محلّيّ']);
    const remote = remoteAt(dir, 'HEAD^');
    writeFileSync(join(dir, 'keep.txt'), 'تعديلٌ غيرُ ملتزَم\n');
    const r = runTool(dir, ['--plan'], remote);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-02\]/, r.out);
  });
});

test('T-153 [PA-03]: أبٌ غيرُ واحدٍ (التزامةُ دمج) يُردُّ ولا يُخمَّن', () => {
  withRepo((dir) => {
    const base = gitOut(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(dir, 'side.txt'), 'side\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'جانبيّ']);
    git(dir, ['checkout', '-q', '-b', 'main2', base]);
    writeFileSync(join(dir, 'keep.txt'), 'main\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'رئيسيّ']);
    git(dir, ['merge', '-q', '--no-ff', '-m', 'دمج', 'side']);
    const file = statePath(dir, 'remote-state.json');
    writeFileSync(file, `${JSON.stringify({ sha: 'a'.repeat(40), tree: 'b'.repeat(40) })}\n`);
    const r = runTool(dir, ['--plan'], file);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-03\]/, r.out);
  });
});

test('T-153 [PA-04]: حالُ بعيدٍ غائبٌ أو ناقصٌ لا يُدفع عليه', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'both.txt'), 'x\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'عملٌ']);
    const missing = runTool(dir, ['--plan'], statePath(dir, 'لا-يوجد.json'));
    assert.equal(missing.code, 1, missing.out);
    assert.match(missing.out, /\[PA-04\]/, missing.out);
    const half = statePath(dir, 'half.json');
    writeFileSync(half, `${JSON.stringify({ sha: 'a'.repeat(40) })}\n`);
    const r = runTool(dir, ['--plan'], half);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-04\]/, r.out);
  });
});

test('T-153 [PA-08]: الحصرُ الأعمى ردٌّ لا نجاح — صفرُ مسارٍ متغيّرٍ يُردّ', () => {
  withRepo((dir) => {
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'التزامةٌ بلا مضمون']);
    const r = runTool(dir, ['--plan'], remoteAt(dir, 'HEAD^'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-08\]/, r.out);
    assert.doesNotMatch(r.out, /الخطّةُ مأذونة/, r.out);
  });
});

test('T-153 [PA-07]: `--force` مرفوضٌ بحكمٍ لا بعُرف', () => {
  withRepo((dir) => {
    const r = runTool(dir, ['--plan', '--force'], remoteAt(dir, 'HEAD'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-07\]/, r.out);
  });
});

test('T-153 [PA-07]: مُعامِلٌ يشبه السرَّ يُردُّ **ولا تُطبع قيمتُه**', () => {
  withRepo((dir) => {
    const value = 'QIMAT-SIRRIN-LA-TUTBA3';
    const r = runTool(dir, ['--plan', `--token=${value}`], remoteAt(dir, 'HEAD'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[PA-07\]/, r.out);
    // الحكمُ الأهمُّ: القيمةُ لا تظهر في خرجٍ ولا في سجلّ
    assert.doesNotMatch(r.out, new RegExp(value), 'القيمةُ ظهرت في الخرج');
  });
});

test('T-153 [PA-07]: فعلٌ غيرُ معلنٍ لا يُنفَّذ، ودفعٌ حقيقيٌّ على حالٍ من ملفٍّ يُردّ', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'both.txt'), 'x\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'عملٌ']);
    const remote = remoteAt(dir, 'HEAD^');
    const silent = runTool(dir, [], remote);
    assert.equal(silent.code, 1, silent.out);
    assert.match(silent.out, /\[PA-07\]/, silent.out);
    const offlinePush = runTool(dir, ['--push'], remote);
    assert.equal(offlinePush.code, 1, offlinePush.out);
    assert.match(offlinePush.out, /\[PA-07\]/, offlinePush.out);
    assert.match(offlinePush.out, /SOOL_PUSH_REMOTE_FILE/, offlinePush.out);
  });
});

test('T-153: الانحرافُ عن الشبكةِ يُطبع ولا يُسكت عنه', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, 'both.txt'), 'x\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'عملٌ']);
    const r = runTool(dir, ['--plan'], remoteAt(dir, 'HEAD^'));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /انحرافٌ معلن/, r.out);
  });
});
