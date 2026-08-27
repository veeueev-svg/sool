/**
 * tests/governance/work_control.test.ts — بوابةُ ضبط العمل (المرحلة 40، البند W-2026-001)
 * المالك: القيّم على المستودع
 * المدخلات: `scripts/check_work.mjs` وسجلٌّ حيٌّ مصنوعٌ في مجلدٍ مؤقّت (`SOOL_WORK_ROOT`)
 * المخرجات: تأكيدٌ أن البوابة تمرّ على سجلٍّ سليم، وتسقط بالرمز 1 على كل مخالفةٍ معلنة
 * التبعيات: `node:child_process` (تُشغّل الملفَّ عينَه الذي تشغّله البوابة) · `node:fs`
 * الصلاحيات (RULE-004): الاختبار يصنع سجلًّا مؤقّتًا ويقرأ رمزَ الخروج؛ لا يلمس سجلَّ المستودع
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: معرّفٌ مكرّرٌ أو مخالفُ الصيغة · حالٌ خارج المعجم · MERGED في السجل
 *   الحيّ · مالكٌ يراجع نفسَه · حقلٌ ناقص · نطاقان متداخلان · بندُ تقدّمٍ محجوزٌ مرّتين ·
 *   عقدٌ مفقودٌ أو ناقصُ قسمٍ أو لا يذكر نطاقَه · نطاقٌ مطلقٌ أو مستولٍ · BLOCKED بلا سبب ·
 *   VERIFIED بلا دليلِ تحقّق · معرّفٌ في السجلَّين · صفُّ سجلٍّ ناقصُ الخلايا · دمجٌ بلا مرجع ·
 *   تقريرٌ غيرُ موجود · معجمٌ مُحرَّفٌ في البيان · تبعيةٌ مجهولةٌ أو غيرُ مغلقة · تاريخٌ مقلوب ·
 *   وثيقةُ حالٍ محجوزةٌ في scope · وثيقةُ حالٍ لُمست بلا إعلانٍ في §6 · كتابةٌ في نطاقِ بندٍ آخر ·
 *   فَرقٌ بلا بندٍ مُعلَن · مِذيالٌ يشير إلى بندٍ لا وجودَ له (T-144) ·
 *   JSON معطوب · سجلٌّ تاريخيٌّ مفقود · تغييرٌ بلا حجز · تغييرٌ بلا أثرٍ في السجل
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/work/WORK_CONTROL.md · docs/test-reports/W-2026-001-work-control.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **يقيس البوابةَ لا يعيد كتابتها**: يُشغّل `scripts/check_work.mjs` عينَه الذي يشغّله
 *    `npm run verify` وبوابةُ CI (كأخيه generated_numbers.test.ts).
 *
 * 2) **المقيسُ رمزُ الخروج لا نصُّ الرسالة**: العلّةُ التي أوجبت البوابةَ أنّ التداخلَ كان
 *    يمرّ بلا أن يُسقط شيئًا — فالمقيسُ هو الإسقاط.
 *
 * 3) **السجلُّ الحقيقيُّ لا يُلمس**: كلُّ حالةٍ تُبنى في مجلدٍ مؤقّتٍ يُمرَّر بـ`SOOL_WORK_ROOT`،
 *    فلا يُعطب سجلُّ المستودع ولو سقط تأكيد. وغيابُ `.git` هناك يُسقط بابَ الفَرق وحده،
 *    فيُقاس بابُ الفَرق بتمريرِ `WORK_CHANGED_FILES` صراحةً (انحرافٌ معلن في رأس البوابة).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = 'scripts/check_work.mjs';
const TEMPLATE_SRC = 'docs/work/orders/TEMPLATE.md';
type Item = Record<string, unknown>;

/** بندٌ سليمٌ يُشتقّ منه كلُّ اختبارٍ بتغييرِ ما يُقصد فسادُه */
function item(over: Item = {}): Item {
  return {
    id: 'W-2026-001',
    title: 'بندُ اختبارٍ سليم',
    owner: 'جهةُ أ',
    reviewer: 'جهةُ ب',
    area: 'اختبار',
    phase: 40,
    status: 'IN_PROGRESS',
    progress_items: ['T-900'],
    dependencies: ['لا شيء'],
    scope: ['src/alpha/'],
    acceptance: ['شرطٌ يُقاس'],
    evidence: ['خرجٌ مقيس'],
    next_step: 'الفعلُ التالي',
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    ...over,
  };
}

/** يبني سجلًّا حيًّا وتاريخيًّا وعقودًا في مجلدٍ مؤقّت، ويُعيد جذرَه */
function fixture(items: Item[], logRows: string[] = [], opts: { queueRaw?: string; noLog?: boolean; statuses?: unknown; skipOrders?: string[]; impact?: Record<string, string> } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'sool-work-'));
  mkdirSync(join(root, 'docs/work/orders'), { recursive: true });
  mkdirSync(join(root, 'docs/test-reports'), { recursive: true });
  writeFileSync(join(root, 'docs/test-reports/r.md'), 'تقريرٌ موجود\n');
  writeFileSync(join(root, TEMPLATE_SRC.replace('docs/work/orders/TEMPLATE.md', 'docs/work/orders/TEMPLATE.md')), readFileSync(TEMPLATE_SRC, 'utf8'));
  const queue = {
    schema_version: 1,
    updated_at: '2026-01-02',
    statuses: opts.statuses ?? ['PROPOSED', 'CLAIMED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'VERIFIED'],
    work_items: items,
  };
  writeFileSync(join(root, 'docs/work/WORK_QUEUE.json'), opts.queueRaw ?? JSON.stringify(queue, null, 2));
  if (opts.noLog !== true) {
    const head = '| المعرّف | العنوان | المالك | المراجع | النطاق | النتيجة | الدمج | التقرير | تاريخ الإغلاق | ما بقي |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
    writeFileSync(join(root, 'docs/work/WORK_LOG.md'), `# سجل\n\n${head}${logRows.join('\n')}\n`);
  }
  for (const it of items) {
    const id = String(it.id ?? '');
    if ((opts.skipOrders ?? []).includes(id)) continue;
    const scope = (it.scope as string[] ?? []).map((s) => `- \`${s}\``).join('\n');
    const sections = ['## 1) المسألة', '## 2) النطاق المحجوز', '## 3) خارج النطاق', '## 4) معيار القبول', '## 5) الدليل', '## 6) الأثر في الوثائق', '## 7) الخطوة التالية'];
    const body = `# ${id} — ${String(it.title ?? '')}\n\n${sections.map((s) => {
      if (s.startsWith('## 2')) return `${s}\n\n${scope}\n`;
      if (s.startsWith('## 6')) return `${s}\n\n${(opts.impact ?? {})[id] ?? 'نصٌّ'}\n`;
      return `${s}\n\nنصٌّ\n`;
    }).join('\n')}`;
    writeFileSync(join(root, `docs/work/orders/${id}.md`), body);
  }
  return root;
}

/**
 * يُشغّل البوابةَ على جذرٍ مصنوع؛ وبابُ الفَرق يُقاس بتمريرِ المسارات صراحةً.
 * و`workItem` هو البندُ المُعلَنُ لهذا الفَرق (الثابت 6 في البوابة): في المستودع الحقيقيِّ
 * يأتي من مِذيال `Work:` في رسالة الالتزام، وفي الاختبار من `WORK_ITEM` — ومن مرّره فارغًا
 * قاس **حالَ من لم يُعلن بندَه**، وهي حالةٌ مقصودةٌ تُختبر كغيرها.
 */
function run(root: string, changed = '', workItem = 'W-2026-001'): number {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, SOOL_WORK_ROOT: root, WORK_CHANGED_FILES: changed, WORK_ITEM: workItem },
  });
  return r.status ?? -1;
}

const logRow = (over: Partial<Record<'id' | 'scope' | 'result' | 'merge' | 'report' | 'closed' | 'rest', string>> = {}): string => {
  const c = { id: 'W-2026-090', scope: '`src/gamma/`', result: 'MERGED', merge: 'abc1234', report: '[تقرير](docs/test-reports/r.md)', closed: '2026-01-01', rest: 'لا شيء', ...over };
  return `| ${c.id} | عنوانٌ | جهةُ ج | جهةُ د | ${c.scope} | ${c.result} | ${c.merge} | ${c.report} | ${c.closed} | ${c.rest} |`;
};

// ── القبول: سجلٌّ سليمٌ يمرّ ────────────────────────────────────────────────
test('سجلٌّ سليمٌ يمرّ بالرمز 0، ومعه سطرُ إغلاقٍ تامّ', () => {
  assert.equal(run(fixture([item()], [logRow()])), 0);
});

test('بندان حيّان بنطاقَين أخوَين لا يتلامسان يمرّان — فالتوازي مأمونٌ بالقسمة لا بالثقة', () => {
  const a = item({ id: 'W-2026-001', scope: ['src/alpha/one.ts'], progress_items: ['T-900'] });
  const b = item({ id: 'W-2026-002', scope: ['src/alpha/two.ts'], progress_items: ['T-901'] });
  assert.equal(run(fixture([a, b])), 0);
});

// ── الهويّة والحقول ──────────────────────────────────────────────────────────
test('معرّفٌ مكرّرٌ يُسقط البوابة', () => {
  assert.equal(run(fixture([item(), item({ scope: ['src/beta/'], progress_items: ['T-901'] })])), 1);
});

test('معرّفٌ مخالفُ الصيغة W-YYYY-NNN يُسقط البوابة', () => {
  assert.equal(run(fixture([item({ id: 'W-1' })], [], { skipOrders: [] })), 1);
});

test('حقلٌ واجبٌ فارغٌ (next_step) يُسقط البوابة', () => {
  assert.equal(run(fixture([item({ next_step: '' })])), 1);
});

test('تاريخٌ مقلوب (updated_at قبل created_at) يُسقط البوابة', () => {
  assert.equal(run(fixture([item({ created_at: '2026-02-01', updated_at: '2026-01-01' })])), 1);
});

// ── المعجم المغلق والفصل بين الصلاحيات ──────────────────────────────────────
test('حالٌ خارج المعجم المغلق يُسقط البوابة', () => {
  assert.equal(run(fixture([item({ status: 'جارٍ' })])), 1);
});

test('MERGED باقيًا في السجل الحيّ يُسقط البوابة — الإغلاقُ نقلٌ لا نسخ', () => {
  assert.equal(run(fixture([item({ status: 'MERGED' })])), 1);
});

test('معجمٌ مُحرَّفٌ في البيان يخالف قانونَ البوابة يُسقطها', () => {
  assert.equal(run(fixture([item()], [], { statuses: ['PROPOSED', 'DONE'] })), 1);
});

test('المالكُ يراجع نفسَه يُسقط البوابة (RULE-004)', () => {
  assert.equal(run(fixture([item({ reviewer: 'جهةُ أ' })])), 1);
});

test('BLOCKED بلا سببٍ مسمّى يُسقط البوابة', () => {
  assert.equal(run(fixture([item({ status: 'BLOCKED' })])), 1);
});

test('VERIFIED بلا دليلِ تحقّقٍ يُسقط البوابة', () => {
  assert.equal(run(fixture([item({ status: 'VERIFIED' })])), 1);
});

// ── منعُ التكرار: النطاق وبندُ التقدّم ───────────────────────────────────────
test('نطاقان متداخلان بين بندَين حيَّين يُسقطان البوابة (RULE-012)', () => {
  const a = item({ id: 'W-2026-001', scope: ['src/alpha/'], progress_items: ['T-900'] });
  const b = item({ id: 'W-2026-002', scope: ['src/alpha/one.ts'], progress_items: ['T-901'] });
  assert.equal(run(fixture([a, b])), 1);
});

test('بندُ تقدّمٍ واحدٌ محجوزٌ لبندَي عملٍ حيَّين يُسقط البوابة (RULE-013)', () => {
  const a = item({ id: 'W-2026-001', scope: ['src/alpha/'], progress_items: ['T-900'] });
  const b = item({ id: 'W-2026-002', scope: ['src/beta/'], progress_items: ['T-900'] });
  assert.equal(run(fixture([a, b])), 1);
});

test('نطاقٌ مطلقٌ أو مستولٍ على الجذر يُسقط البوابة', () => {
  assert.equal(run(fixture([item({ scope: ['/etc/passwd'] })])), 1);
  assert.equal(run(fixture([item({ scope: ['.'] })])), 1);
});

// ── العقدُ الورقيّ ───────────────────────────────────────────────────────────
test('بندٌ بلا عقدٍ في docs/work/orders/ يُسقط البوابة (RULE-014)', () => {
  assert.equal(run(fixture([item()], [], { skipOrders: ['W-2026-001'] })), 1);
});

test('عقدٌ ناقصُ قسمٍ واجبٍ يُسقط البوابة', () => {
  const root = fixture([item()]);
  const p = join(root, 'docs/work/orders/W-2026-001.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace('## 5) الدليل', '## خامسًا'));
  assert.equal(run(root), 1);
});

test('عقدٌ لا يذكر نطاقَه المحجوز يُسقط البوابة — والعقدُ الذي لا يذكر نطاقَه لا يُلزم', () => {
  const root = fixture([item()]);
  const p = join(root, 'docs/work/orders/W-2026-001.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace('src/alpha/', 'src/omega/'));
  assert.equal(run(root), 1);
});

// ── التبعيات ────────────────────────────────────────────────────────────────
test('تبعيةٌ إلى معرّفٍ لا وجودَ له تُسقط البوابة', () => {
  assert.equal(run(fixture([item({ dependencies: ['W-2026-777'] })])), 1);
});

test('مراجعةٌ فوق تبعيةٍ لم تُدمج تُسقط البوابة', () => {
  const a = item({ id: 'W-2026-001', scope: ['src/alpha/'], progress_items: ['T-900'] });
  const b = item({
    id: 'W-2026-002', scope: ['src/beta/'], progress_items: ['T-901'],
    status: 'REVIEW', verification: 'شُغّل', dependencies: ['W-2026-001'],
  });
  assert.equal(run(fixture([a, b])), 1);
});

// ── السجلُّ التاريخيّ ────────────────────────────────────────────────────────
test('معرّفٌ مقيمٌ في السجلَّين معًا يُسقط البوابة', () => {
  assert.equal(run(fixture([item()], [logRow({ id: 'W-2026-001' })])), 1);
});

test('صفُّ إغلاقٍ ناقصُ الخلايا يُسقط البوابة', () => {
  assert.equal(run(fixture([item()], ['| W-2026-090 | عنوانٌ | جهةُ ج | MERGED | abc | 2026-01-01 |'])), 1);
});

test('دمجٌ بلا مرجعٍ، أو بتقريرٍ غيرِ موجودٍ على القرص، يُسقط البوابة', () => {
  assert.equal(run(fixture([item()], [logRow({ merge: '—' })])), 1);
  assert.equal(run(fixture([item()], [logRow({ report: '[تقرير](docs/test-reports/ghost.md)' })])), 1);
});

test('نتيجةٌ خارج معجم الإغلاق تُسقط البوابة', () => {
  assert.equal(run(fixture([item()], [logRow({ result: 'أُغلق' })])), 1);
});

// ── الفشلُ المغلق ────────────────────────────────────────────────────────────
test('JSON معطوبٌ أو سجلٌّ تاريخيٌّ مفقودٌ يُسقط البوابة — ما لا يُقرأ لا يُفترض صحيحًا', () => {
  assert.equal(run(fixture([item()], [], { queueRaw: '{ ليس JSON' })), 1);
  assert.equal(run(fixture([item()], [], { noLog: true })), 1);
});

// ── بابُ الفَرق: الحاجزُ الأقوى ──────────────────────────────────────────────
test('مسارٌ محكومٌ تغيّر ولا بندَ يحجزه يُسقط البوابة (RULE-011)', () => {
  const root = fixture([item()]);
  assert.equal(run(root, 'src/omega/x.ts,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-001.md'), 1);
});

test('مسارٌ داخل نطاقٍ محجوزٍ مع أثرٍ في السجل والعقد يمرّ', () => {
  const root = fixture([item()]);
  assert.equal(run(root, 'src/alpha/x.ts,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-001.md'), 0);
});

test('تغييرٌ محكومٌ بلا أثرٍ في السجل يُسقط البوابة (RULE-015)', () => {
  const root = fixture([item()]);
  assert.equal(run(root, 'src/alpha/x.ts'), 1);
});

// ── T-144: وثائقُ الحالِ مشتركةٌ بإعلان، والحجزُ يُقاس بالهويّة لا بالوجود ──────
test('T-144: بندٌ يحجز وثيقةَ حالٍ في scope يُسقط البوابة — فالحجزُ المانعُ يُجمّد المستودعَ على بندٍ واحد', () => {
  for (const doc of ['PROGRESS.md', 'ROADMAP.md', 'CHANGELOG.md', 'version.json']) {
    assert.equal(run(fixture([item({ scope: ['src/alpha/', doc] })])), 1, doc);
  }
});

test('T-144: لمسُ وثيقةِ حالٍ يذكرها §6 من العقد يمرّ بلا حجزٍ لها — وهو ما كان مستحيلًا قبل البند', () => {
  const root = fixture([item()], [], { impact: { 'W-2026-001': '`PROGRESS.md` · `CHANGELOG.md`' } });
  assert.equal(run(root, 'src/alpha/x.ts,PROGRESS.md,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-001.md'), 0);
});

test('T-144: لمسُ وثيقةِ حالٍ لا يذكرها §6 يُسقط البوابة — فالمشتركُ بإعلانٍ لا مباح', () => {
  const root = fixture([item()], [], { impact: { 'W-2026-001': '`CHANGELOG.md`' } });
  assert.equal(run(root, 'src/alpha/x.ts,PROGRESS.md,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-001.md'), 1);
});

test('T-144: الكتابةُ في نطاقٍ محجوزٍ لبندٍ آخرَ تُسقط البوابة — ووجودُ حاجزٍ ليس إذنًا لغير صاحبِه', () => {
  const a = item({ id: 'W-2026-001', scope: ['src/alpha/'], progress_items: ['T-900'] });
  const b = item({ id: 'W-2026-002', scope: ['src/beta/'], owner: 'جهةُ هـ', progress_items: ['T-901'] });
  const changed = 'src/beta/x.ts,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-001.md';
  assert.equal(run(fixture([a, b]), changed, 'W-2026-001'), 1);
  // وصاحبُه يمرّ في الفَرقِ نفسِه — فالمقيسُ الهويّةُ لا المسار
  assert.equal(run(fixture([a, b]), 'src/beta/x.ts,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-002.md', 'W-2026-002'), 0);
});

test('T-144: فَرقٌ محكومٌ بلا بندٍ مُعلَنٍ يُسقط البوابة — ومن لم يُعلن بندَه لم يُقَس عملُه', () => {
  assert.equal(run(fixture([item()]), 'src/alpha/x.ts,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-001.md', ''), 1);
});

test('T-144: مِذيالٌ يشير إلى بندٍ لا وجودَ له يُسقط البوابة', () => {
  assert.equal(run(fixture([item()]), 'src/alpha/x.ts,docs/work/WORK_QUEUE.json,docs/work/orders/W-2026-001.md', 'W-2026-777'), 1);
});

test('التزامةُ الإغلاق تمرّ بنطاقٍ صار تاريخًا في السجل نفسِه', () => {
  const root = fixture([item()], [logRow()]);
  assert.equal(run(root, 'src/gamma/x.ts,docs/work/WORK_LOG.md', 'W-2026-090'), 0);
});
