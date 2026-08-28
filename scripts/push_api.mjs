#!/usr/bin/env node
// scripts/push_api.mjs — المحرّكُ الذي يُدفع به يُحكم عليه بما يَحكم به (T-153)
//
// العلّةُ التي وُلدت منها هذه الأداة، مقيسةً في الجلسة 65
// (docs/audit/measurements/phase-40-T153.txt §1..§3):
//   الأداةُ التي كان يُدفع بها إلى `main` **لم تكن في المستودع** — ولم تكن على القرصِ
//   أصلًا: تُعاد تأليفًا في /tmp في كلِّ جلسةٍ ثمّ تُحذف. فلا تُراجَع، ولا تُستنسخ،
//   ولا يحكم عليها حاجز، ولا يُقاس تباعدُ نسخةٍ عن نسخة. وفيها ثلاثٌ قيست:
//     1) **لا تُقابل أبًا**: تدفع بـparents=[رأسُ البعيد] بلا مقابلةٍ. فلمّا تقدَّم
//        البعيدُ في جذرِ قياسٍ أنتج الإجراءُ شجرةً فيها `both-LOCAL` — **تعديلُ
//        البعيدِ ضاع صامتًا** — **ورمزُ الخروج 0 ولا تحذير**.
//     2) **لا تُعبّر عن حذفِ ملفٍّ**: `git show HEAD:<محذوف>` يسقط برمز **128**،
//        و`git diff --name-only` لا يقول أيُّ مسارٍ محذوف. فبقي المحذوفُ في الشجرة.
//     3) **لا حكمَ لها برمزٍ يُقرأ**: فرفضُها من قبولِها لا يُميَّز في اختبار.
//
// القراراتُ المعلنة:
//   1) **الهويّةُ شجرةٌ لا هاش**: الدفعُ بالـAPI يُعيد كتابةَ المُلزِم فتختلف بصمةُ
//      الالتزامةِ بين المحلّيِّ والبعيدِ حتمًا (مقيسٌ في الجلسات 62..64). فمقابلةُ
//      الهاشِ تُنتج رفضًا كاذبًا دائمًا، ومقابلةُ **الشجرة** تُنتج الحكمَ الصحيح.
//   2) **مخطِّطٌ نقيٌّ وطبقةُ شبكةٍ رقيقةٌ فوقه**: `--plan` يقيس كلَّ الأحكامِ **بلا
//      نداءٍ خارجيّ**، فيُختبَر الرفضُ برمزِ الخروج في جذرٍ مؤقّت. وحالُ البعيدِ في
//      الخطّةِ تُقرأ من ملفٍّ **بانحرافٍ معلنٍ يُطبع** لا بصمت.
//   3) **لا سرَّ في مسارِ الأداة**: لا تأخذ توكنًا ولا تطبعه ولا تقرؤه؛ الإذنُ يأتي
//      من حقنِ الوسيطِ في بيئةِ النداء. ومُعامِلٌ يشبه السرَّ **يردُّ الدفعَ** قبل أيِّ
//      شبكةٍ — فما لا يدخل argv لا يظهر في سجلٍّ ولا في تاريخِ صدفة.
//   4) **الحصرُ الأعمى ردٌّ لا نجاح** (درسُ `[CI-05]`): صفرُ مسارٍ متغيّرٍ = لا مضمونَ
//      للدفع، فلا «✓».
//   5) كلُّ حكمٍ برمزٍ لاتينيٍّ ثابتٍ `[PA-NN]` قبل نصِّه العربيّ — عقدًا بين الأداةِ
//      واختبارِها، فلا ينكسر الاختبارُ على تنقيحِ صياغة.
//   6) **لا تستنسخ هذه الأداةُ أحكامَ `scripts/push_guard.sh`** ولا تحلُّ محلَّه: هو
//      بابٌ على طريقِ الدفعِ (T-151) وهذه محرّكُه. والحارسُ محجوزٌ لـW-2026-010.
//
// الاستخدام (لا أمرَ npm له: `package.json` محجوزٌ لـW-2026-009 — وذلك عينُ علّةِ T-152):
//   node scripts/push_api.mjs --plan            يقيس ويطبع الخطّةَ ولا يدفع
//   node scripts/push_api.mjs --push            يدفع ثمّ يقابل الشجرةَ بعد الدفع
//     --root=<مجلد>            جذرُ المستودعِ المقروء (افتراضُه .)
//     --repo=<مالك/اسم>        مستودعُ البعيد (افتراضُه veeueev-svg/sool)
//     --branch=<فرع>           الفرعُ المدفوعُ إليه (افتراضُه main)
//   SOOL_PUSH_REMOTE_FILE=<ملف JSON فيه {"sha","tree"}>
//     انحرافٌ **معلن** للاختبارِ وحدَه: يُبدل قراءةَ حالِ البعيدِ من الشبكة. ويُطبع.
// رمزُ الخروج: 0 إذا أُذن/أُنجز، و1 مع بيانِ الحكمِ الذي يمنعه.
//
// أحكامُ الرفض: PA-01 لا مستودع · PA-02 شجرةٌ غيرُ نظيفة · PA-03 أبٌ غيرُ واحد ·
// PA-04 حالُ البعيدِ لا يُقرأ · PA-05 تباعدٌ (شجرةُ البعيد ≠ شجرةُ الأب) · PA-06 نمطٌ
// لا يُحسَن · PA-07 سرٌّ أو `--force` في المسار · PA-08 حصرٌ أعمى · PA-09 شجرةُ
// المدفوعِ ≠ شجرةُ HEAD · PA-10 حالُ فرقٍ لا يُحسَن.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_HINT = /(^|[^a-z])(token|secret|password|ghp_|github_pat)/i;
const KNOWN_MODES = new Set(['100644', '100755', '120000']);

function fail(code, text) {
  console.error(`✗ [${code}] ${text}`);
  process.exit(1);
}

function git(root, args, raw = false) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: raw ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitOk(root, args) {
  try {
    git(root, args);
    return true;
  } catch {
    return false;
  }
}

function api(method, path, body) {
  const args = ['-sS', '-X', method, '-w', '\n%{http_code}',
    '-H', 'Accept: application/vnd.github+json',
    `https://api.github.com${path}`];
  // **الجسدُ يُمرَّر بالمَدخلِ لا بالمُعامِلات**: قيس في أوّلِ دفعٍ حقيقيٍّ أنّ تمريرَ
  // محتوى ملفٍّ بـ`-d <نصّ>` يسقط بـ`spawnSync curl E2BIG` (حدُّ argv)، **فالحدُّ يُقاس ولا
  // يُفترض**. و`-d @-` يقرأ من stdin فلا سقفَ على حجمِ الملفّ.
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-d', '@-');
  let out;
  try {
    out = execFileSync('curl', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    fail('PA-04', `نداءُ ${method} ${path} لم يتمّ: ${String(e.message).split('\n')[0] ?? ''}`);
  }
  const cut = out.lastIndexOf('\n');
  const status = Number(out.slice(cut + 1).trim());
  if (status < 200 || status >= 300) {
    fail('PA-04', `${method} ${path} ⇒ رمزُ HTTP ${status} — وحالٌ لا يُقرأ لا يُدفع عليه`);
  }
  return JSON.parse(out.slice(0, cut) || '{}');
}

// ── الخطّةُ: تُقاس كلُّها بلا شبكةٍ ما دام حالُ البعيدِ معطًى ─────────────────────
function buildPlan(root, remote) {
  if (!existsSync(join(root, '.git'))) {
    fail('PA-01', `لا مستودعَ في «${root}»: لا مجلَّدَ .git — وما ليس مستودعًا لا يُدفع`);
  }
  if (git(root, ['status', '--porcelain']).trim() !== '') {
    fail('PA-02', 'شجرةُ العملِ غيرُ نظيفة: أداةُ الدفعِ تقرأ من HEAD، فالتعديلُ غيرُ '
      + 'الملتزَمِ لن يُدفع — ودفعٌ يُخالف ما يراه المنفّذُ على قرصِه غِشٌّ لا اختصار');
  }
  const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/).slice(1);
  if (parents.length !== 1) {
    fail('PA-03', `أبُ HEAD ليس واحدًا (عددُه ${parents.length}): `
      + 'ولا تُقابل هذه الأداةُ إلّا أبًا واحدًا، فما لا تُحسنه تردُّه ولا تخمّنه');
  }
  const parentTree = git(root, ['rev-parse', 'HEAD^^{tree}']).trim();
  const headTree = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
  if (remote.tree !== parentTree) {
    fail('PA-05', 'تباعدٌ: شجرةُ رأسِ البعيدِ لا تُطابق شجرةَ أبِ HEAD المحلّيّ.\n'
      + `    شجرةُ البعيد   : ${remote.tree} (عند ${remote.sha})\n`
      + `    شجرةُ HEAD^    : ${parentTree}\n`
      + '    فالالتزامةُ المحلّيّةُ حُسبت على أساسٍ لم يرَ تعديلَ البعيد، ودفعُها ينسبها '
      + 'إليه ويُسقطه صامتًا (قيس: ضياعُ both-REMOTE). اجلب البعيدَ وأعد البناءَ عليه.');
  }
  const raw = git(root, ['diff', '--name-status', '--no-renames', '-z', 'HEAD^', 'HEAD'])
    .split('\0').filter((s) => s !== '');
  const changes = [];
  for (let i = 0; i < raw.length; i += 2) {
    const status = (raw[i] ?? '').trim();
    const path = raw[i + 1] ?? '';
    if (path === '') fail('PA-10', `حالُ فرقٍ بلا مسار: «${status}»`);
    if (status === 'D') {
      // **الحذفُ يُعبَّر عنه**: sha=null، و`git show` لا يُنادى على مسارٍ محذوفٍ أصلًا
      // (قيس: رمزُ الخروج 128). والنمطُ لا يُقرأ من HEAD لأنّ المسارَ ليس فيه.
      changes.push({ status, path, mode: '100644', sha: null });
      continue;
    }
    if (!'AMT'.includes(status)) {
      fail('PA-10', `حالُ فرقٍ لا تُحسنه هذه الأداة: «${status}» على «${path}» — `
        + 'وما لا يُحسَن يُردُّ ولا يُدفع بتخمين');
    }
    const mode = (git(root, ['ls-tree', 'HEAD', '--', path]).trim().split(/\s+/)[0] ?? '');
    if (!KNOWN_MODES.has(mode)) {
      fail('PA-06', `نمطٌ لا تُحسنه هذه الأداةُ على «${path}»: «${mode || 'غائب'}» — `
        + 'والأنماطُ تُقرأ من git ولا تُفترض، فلا يُدفع بنمطٍ مخترَع');
    }
    changes.push({ status, path, mode, sha: undefined });
  }
  if (changes.length === 0) {
    fail('PA-08', 'حصرٌ أعمى: لا مسارَ متغيّرًا بين HEAD^ وHEAD — ودفعٌ بلا مضمونٍ '
      + 'ليس نجاحًا، فلا «✓» على لا شيء');
  }
  return { parentTree, headTree, changes };
}

function readRemote(repo, branch) {
  const file = process.env.SOOL_PUSH_REMOTE_FILE;
  if (file !== undefined && file !== '') {
    console.log(`ℹ انحرافٌ معلن: حالُ البعيدِ يُقرأ من «${file}» لا من الشبكة (اختبارٌ لا دفعٌ حقيقيّ)`);
    if (!existsSync(file)) fail('PA-04', `ملفُّ حالِ البعيدِ غائب: «${file}»`);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      fail('PA-04', `ملفُّ حالِ البعيدِ لا يُقرأ JSONًا: ${String(e.message).split('\n')[0] ?? ''}`);
    }
    const sha = parsed?.sha;
    const tree = parsed?.tree;
    if (typeof sha !== 'string' || typeof tree !== 'string' || sha === '' || tree === '') {
      fail('PA-04', 'حالُ البعيدِ ناقص: يلزم حقلا «sha» و«tree» نصَّين غيرَ فارغَين');
    }
    return { sha, tree, offline: true };
  }
  const ref = api('GET', `/repos/${repo}/git/ref/heads/${branch}`);
  const sha = ref?.object?.sha;
  if (typeof sha !== 'string') fail('PA-04', `مرجعُ heads/${branch} بلا بصمةٍ مقروءة`);
  const commit = api('GET', `/repos/${repo}/git/commits/${sha}`);
  const tree = commit?.tree?.sha;
  if (typeof tree !== 'string') fail('PA-04', `التزامةُ ${sha} بلا شجرةٍ مقروءة`);
  return { sha, tree, offline: false };
}

function printPlan(plan, remote) {
  console.log(`  رأسُ البعيد : ${remote.sha} · شجرتُه ${remote.tree}`);
  console.log(`  شجرةُ HEAD^ : ${plan.parentTree}  ✓ تُطابق شجرةَ البعيد — لا تباعد`);
  console.log(`  شجرةُ HEAD  : ${plan.headTree}`);
  console.log(`  المساراتُ المتغيّرة: ${plan.changes.length}`);
  for (const c of plan.changes) {
    console.log(`    ${c.status}  ${c.mode}  ${c.path}  sha=${c.sha === null ? 'null' : 'محتوًى'}`);
  }
}

function doPush(root, repo, branch, plan, remote) {
  const items = plan.changes.map((c) => {
    if (c.sha === null) return { path: c.path, mode: c.mode, type: 'blob', sha: null };
    const content = git(root, ['cat-file', 'blob', `HEAD:${c.path}`], true).toString('base64');
    const blob = api('POST', `/repos/${repo}/git/blobs`, { content, encoding: 'base64' });
    if (typeof blob?.sha !== 'string') fail('PA-04', `رفعُ «${c.path}» بلا بصمةٍ مقروءة`);
    return { path: c.path, mode: c.mode, type: 'blob', sha: blob.sha };
  });
  const tree = api('POST', `/repos/${repo}/git/trees`, { base_tree: remote.tree, tree: items });
  if (typeof tree?.sha !== 'string') fail('PA-04', 'الشجرةُ المُنشأةُ بلا بصمةٍ مقروءة');
  const message = git(root, ['log', '-1', '--pretty=%B']).replace(/\n+$/, '\n');
  const author = {
    name: git(root, ['log', '-1', '--pretty=%an']).trim(),
    email: git(root, ['log', '-1', '--pretty=%ae']).trim(),
    date: git(root, ['log', '-1', '--pretty=%aI']).trim(),
  };
  const commit = api('POST', `/repos/${repo}/git/commits`,
    { message, tree: tree.sha, parents: [remote.sha], author });
  if (typeof commit?.sha !== 'string') fail('PA-04', 'الالتزامةُ المُنشأةُ بلا بصمةٍ مقروءة');
  // `force: false` حكمٌ لا عُرف: الرفضُ من البعيدِ أرحمُ من كتابةِ تاريخِ غيرِنا.
  api('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  const pushed = api('GET', `/repos/${repo}/git/commits/${commit.sha}`);
  const pushedTree = pushed?.tree?.sha;
  if (pushedTree !== plan.headTree) {
    fail('PA-09', 'شجرةُ المدفوعِ لا تُطابق شجرةَ HEAD المحلّيّ ولو تحرّك المرجع:\n'
      + `    شجرةُ المدفوع : ${String(pushedTree)}\n`
      + `    شجرةُ HEAD    : ${plan.headTree}\n`
      + '    فالمدفوعُ ليس هو المحكومَ عليه — راجع البعيدَ قبل أيِّ عملٍ فوقه');
  }
  console.log(`✓ دُفع: ${commit.sha} · الشجرةُ ${pushedTree} تُطابق شجرةَ HEAD المحلّيّ`
    + '\n  (البصمةُ تختلف عن المحلّيّةِ حتمًا: الـAPI يُعيد كتابةَ المُلزِم — فالهويّةُ شجرةٌ لا هاش)');
}

function main(argv) {
  for (const a of argv) {
    if (a === '--force' || a.startsWith('--force=')) {
      fail('PA-07', '`--force` مرفوض: كتابةُ تاريخِ البعيدِ فوقَ عملِ غيرِنا لا تُتاح '
        + 'بمُعامِل، والطلبُ يُرسَل بـforce=false دائمًا');
    }
    if (SECRET_HINT.test(a)) {
      fail('PA-07', 'مُعامِلٌ يشبه السرَّ في مسارِ الأداة: لا تأخذ هذه الأداةُ توكنًا ولا '
        + 'تقرؤه ولا تطبعه — الإذنُ يأتي من حقنِ الوسيط. (والقيمةُ لم تُطبع.)');
    }
  }
  const root = (argv.find((a) => a.startsWith('--root=')) ?? '--root=.').slice(7);
  const repo = (argv.find((a) => a.startsWith('--repo=')) ?? '--repo=veeueev-svg/sool').slice(7);
  const branch = (argv.find((a) => a.startsWith('--branch=')) ?? '--branch=main').slice(9);
  const wantPush = argv.includes('--push');
  if (!wantPush && !argv.includes('--plan')) {
    fail('PA-07', 'لا فعلَ معلنًا: يلزم `--plan` أو `--push` — وأداةُ الدفعِ لا تدفع بالسكوت');
  }
  console.log(`أداةُ الدفع: المحرّكُ يُحكم عليه بما يَحكم به (T-153) · ${repo}@${branch}`);
  const remote = readRemote(repo, branch);
  const plan = buildPlan(root, remote);
  printPlan(plan, remote);
  if (!wantPush) {
    console.log('✓ الخطّةُ مأذونة: لا تباعدَ، والحذفُ مُعبَّرٌ عنه، والأنماطُ مقروءةٌ من git (خطّةٌ لا دفع)');
    return;
  }
  if (remote.offline) {
    fail('PA-07', 'دفعٌ حقيقيٌّ مع حالِ بعيدٍ من ملفّ: SOOL_PUSH_REMOTE_FILE انحرافُ اختبارٍ '
      + 'لا يُدفع به — فلا يُكتب البعيدُ اعتمادًا على حالٍ لم يُقرأ منه');
  }
  doPush(root, repo, branch, plan, remote);
}

main(process.argv.slice(2));
