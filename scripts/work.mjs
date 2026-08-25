#!/usr/bin/env node
/**
 * scripts/work.mjs — أداةُ السجلّ الحيّ: `list` تقرأ، و`new` تفتح بندًا بالعقد
 * المالك: القيّم على المستودع | المرحلة: 40
 * المدخلات: docs/work/WORK_QUEUE.json · docs/work/orders/TEMPLATE.md · معاملاتُ السطر
 * المخرجات: جدولُ العمل الحيّ (list) | بندٌ جديدٌ بعقدِه (new) | الرمز 1 مع بيانِ المنع
 * الصلاحيات (RULE-004): تكتب بندًا مقترحًا وعقدَه فقط. لا تُرقّي حالًا، ولا تُغلق بندًا،
 *   ولا تلمس WORK_LOG.md — الإغلاقُ فعلُ جهةٍ بيدها في التزامة الدمج.
 * حالات الفشل المُغطّاة: معاملٌ ناقص · مالكٌ يراجع نفسَه · نطاقٌ مستولٍ · تداخلٌ مع بندٍ حيّ ·
 *   عقدٌ موجودٌ سلفًا · قالبٌ مفقود
 * اختبار القبول: tests/governance/work_control.test.ts (بابُ `new` يُسقط التداخل)
 * الوثيقة المرتبطة: docs/work/WORK_CONTROL.md §4 · §9
 *
 * ثابتُ هذا الملف: **الأداةُ تمنع قبل أن تكتب**. فمن استعملها لا يستطيع فتحَ بندٍ يتداخل
 * نطاقُه مع بندٍ حيّ — فلا يُعرف التداخلُ عند البوابة بعد العمل، بل عند الحجز قبله.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SOOL_WORK_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));
const QUEUE = join(ROOT, 'docs/work/WORK_QUEUE.json');
const TEMPLATE = join(ROOT, 'docs/work/orders/TEMPLATE.md');
const LOCKING = ['CLAIMED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'VERIFIED'];

const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const queue = JSON.parse(readFileSync(QUEUE, 'utf8'));
const items = queue.work_items;
const cmd = process.argv[2] ?? 'list';

if (cmd === 'list') {
  console.log(`العملُ الحيُّ في ${queue.updated_at} — ${items.length} بندًا`);
  console.log('| المعرّف | الحال | المالك | المراجع | بندُ التقدّم | النطاق |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const it of items) {
    const t = (it.progress_items ?? ['—']).join(' · ');
    console.log(`| ${it.id} | ${it.status} | ${it.owner} | ${it.reviewer} | ${t} | ${(it.scope ?? []).join(' · ')} |`);
  }
  const locked = items.filter((i) => LOCKING.includes(i.status));
  console.log(`\nالنطاقُ المحجوزُ الآن (${locked.length} بندًا): ${locked.flatMap((i) => i.scope).join(' · ') || 'لا شيء'}`);
  console.log('الطريقُ الإلزاميّ: docs/work/WORK_CONTROL.md');
  process.exit(0);
}

if (cmd !== 'new') die(`أمرٌ غيرُ معروف: «${cmd}» — الأمران: list | new`);

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const title = arg('title');
const owner = arg('owner');
const reviewer = arg('reviewer');
const area = arg('area');
const scope = (arg('scope') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
const phase = Number(arg('phase') ?? 40);
const progress = (arg('progress') ?? 'لا ينطبق').split(',').map((s) => s.trim()).filter((s) => s !== '');
const claim = process.argv.includes('--claim');

for (const [n, v] of [['title', title], ['owner', owner], ['reviewer', reviewer], ['area', area]]) {
  if (!v) die(`معاملٌ واجبٌ ناقص: --${n}`);
}
if (scope.length === 0) die('معاملٌ واجبٌ ناقص: --scope (مسارٌ أو أكثرُ مفصولةٌ بفاصلة)');
if (owner.trim() === reviewer.trim()) die('المالكُ والمراجعُ جهةٌ واحدة — والفصلُ شرطٌ (RULE-004)');
for (const s of scope) {
  if (s.startsWith('/') || s.includes('..')) die(`نطاقٌ غيرُ مسموح: «${s}» — المساراتُ نسبيّةٌ داخل المستودع`);
  if (['.', '*', '**', '**/*', '/'].includes(s)) die(`نطاقٌ يستولي على المستودع كلِّه: «${s}» — الحجزُ يُسمّى ولا يُعمّم`);
}

const covers = (claimPath, p) => p === claimPath || p.startsWith(claimPath.endsWith('/') ? claimPath : `${claimPath}/`);
for (const it of items.filter((i) => LOCKING.includes(i.status))) {
  for (const a of it.scope ?? []) {
    for (const b of scope) {
      if (a === b || covers(a, b) || covers(b, a)) {
        die(`النطاقُ «${b}» يتداخل مع «${a}» المحجوز لبند ${it.id} (${it.owner} · ${it.status}) — راجع docs/work/WORK_CONTROL.md §6`);
      }
    }
  }
}
for (const it of items.filter((i) => LOCKING.includes(i.status))) {
  for (const t of it.progress_items ?? []) {
    if (t !== 'لا ينطبق' && progress.includes(t)) die(`بندُ التقدّم «${t}» محجوزٌ سلفًا لبند ${it.id} — لا يُعمل بندٌ واحدٌ مرّتين`);
  }
}

const year = new Date().toISOString().slice(0, 4);
const used = items.map((i) => i.id).filter((i) => i.startsWith(`W-${year}-`)).map((i) => Number(i.slice(-3)));
const logText = existsSync(join(ROOT, 'docs/work/WORK_LOG.md')) ? readFileSync(join(ROOT, 'docs/work/WORK_LOG.md'), 'utf8') : '';
for (const m of logText.matchAll(new RegExp(`W-${year}-(\\d{3})`, 'g'))) used.push(Number(m[1]));
const id = `W-${year}-${String(Math.max(0, ...used) + 1).padStart(3, '0')}`;
const today = new Date().toISOString().slice(0, 10);
const orderPath = join(ROOT, `docs/work/orders/${id}.md`);
if (existsSync(orderPath)) die(`عقدٌ موجودٌ سلفًا: docs/work/orders/${id}.md — المعرّفُ لا يُعاد استعماله`);
if (!existsSync(TEMPLATE)) die('القالبُ مفقود: docs/work/orders/TEMPLATE.md');

const status = claim ? 'CLAIMED' : 'PROPOSED';
items.push({
  id, title, owner, reviewer, area, phase, status,
  progress_items: progress,
  dependencies: ['لا شيء'],
  scope,
  excluded: ['يُملأ عند الاستلام: ما لن يُلمس ولو بدا قريبًا'],
  acceptance: ['يُملأ في العقد §4 قبل أوّلِ سطرٍ من العمل'],
  evidence: ['يُملأ عند التشغيل: خرج npm test بعددٍ صريح · تقريرٌ في docs/test-reports/'],
  next_step: claim ? 'ملءُ العقد §1..§4 ثمّ الانتقال إلى IN_PROGRESS' : 'جهةٌ تستلمه فتنقله إلى CLAIMED',
  created_at: today,
  updated_at: today,
});
queue.updated_at = today;
writeFileSync(QUEUE, `${JSON.stringify(queue, null, 2)}\n`);

const order = readFileSync(TEMPLATE, 'utf8')
  .replace('# W-YYYY-NNN — عنوانُ البند كما هو حرفًا في WORK_QUEUE.json', `# ${id} — ${title}`)
  .replace('> **المالك:** … · **المراجع:** (غيرُ المالك حتمًا — RULE-004) · **المجال:** … · **المرحلة:** …', `> **المالك:** ${owner} · **المراجع:** ${reviewer} · **المجال:** ${area} · **المرحلة:** ${phase}`)
  .replace('> **الحال:** PROPOSED | CLAIMED | IN_PROGRESS | BLOCKED | REVIEW | VERIFIED', `> **الحال:** ${status}`)
  .replace('> **بندُ التقدّم:** `T-###` أو «لا ينطبق» · **فُتح:** YYYY-MM-DD · **آخر تحديث:** YYYY-MM-DD', `> **بندُ التقدّم:** ${progress.join(' · ')} · **فُتح:** ${today} · **آخر تحديث:** ${today}`)
  .replace('- `path/to/dir/`\n- `path/to/file.ts`', scope.map((s) => `- \`${s}\``).join('\n'));
writeFileSync(orderPath, order);

console.log(`✓ فُتح ${id} بحالِ ${status} · المالك: ${owner} · المراجع: ${reviewer}`);
console.log(`  النطاقُ المحجوز: ${scope.join(' · ')}`);
console.log(`  العقد: docs/work/orders/${id}.md — املأ أقسامه السبعة قبل أوّلِ سطرٍ من العمل`);
console.log('  ثمّ: npm run check:work');
