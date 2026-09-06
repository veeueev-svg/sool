/**
 * tests/governance/work_control_keys.test.ts — بابُ دخولِ المفاتيح ونصُّ القالب (T-164 · W-2026-024)
 * المالك: القيّم على المستودع | المرحلة: 40
 *
 * مقصورٌ على علّتَي T-164 وحدهما: (أ) مفتاحٌ لا وجودَ له في بيانِ السجلِّ يمرّ بلا سؤال،
 * (ب) نصُّ قالبٍ («يُملأ...») يُحتسب جوابًا على بندٍ فُرغَ منه. ويُشغّل `scripts/check_work.mjs`
 * عينَه على سجلٍّ مصنوعٍ في مجلّدٍ مؤقّتٍ (`SOOL_WORK_ROOT`) — كأخيه work_control.test.ts،
 * لكنّه مقصورٌ هنا حتّى لا يتجاوز ملفُّ الاختبارِ سقفَ 400 سطرًا.
 *
 * المساعداتُ أدناه نسخةٌ مصغّرةٌ من نظيراتها في work_control.test.ts — يقصدنَ قياسَ
 * البوابةِ لا إعادةَ كتابتها. وغيابُ `.git` في الجذرِ المؤقّتِ يُسقط بابَ الفَرقِ وحده،
 * فيُمرَّر `WORK_CHANGED_FILES` صراحةً بعلامةِ `WORK_DIFF_SOURCE=declared` (انحرافٌ معلن).
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

function item(over: Item = {}): Item {
  return {
    id: 'W-2026-001', title: 'بندُ اختبارٍ سليم', owner: 'جهةُ أ', reviewer: 'جهةُ ب',
    area: 'اختبار', phase: 40, status: 'IN_PROGRESS', progress_items: ['T-900'],
    dependencies: ['لا شيء'], scope: ['src/alpha/'], acceptance: ['شرطٌ يُقاس'],
    evidence: ['خرجٌ مقيس'], next_step: 'الفعلُ التالي',
    created_at: '2026-01-01', updated_at: '2026-01-02', ...over,
  };
}

function fixture(items: Item[], opts: { itemKeys?: string[] } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'sool-work-keys-'));
  mkdirSync(join(root, 'docs/work/orders'), { recursive: true });
  mkdirSync(join(root, 'docs/test-reports'), { recursive: true });
  writeFileSync(join(root, 'docs/test-reports/r.md'), 'تقريرٌ موجود\n');
  writeFileSync(join(root, TEMPLATE_SRC), readFileSync(TEMPLATE_SRC, 'utf8'));
  const queue = {
    schema_version: 1, updated_at: '2026-01-02',
    item_keys: opts.itemKeys ?? [
      'id', 'title', 'owner', 'reviewer', 'area', 'phase', 'status', 'progress_items',
      'dependencies', 'scope', 'excluded', 'acceptance', 'evidence', 'next_step',
      'created_at', 'updated_at', 'blocked_reason', 'verification',
      'progress', 'documentation_impact', 'discoveries',
    ],
    statuses: ['PROPOSED', 'CLAIMED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'VERIFIED'],
    work_items: items,
  };
  writeFileSync(join(root, 'docs/work/WORK_QUEUE.json'), JSON.stringify(queue, null, 2));
  const head = '| المعرّف | العنوان | المالك | المراجع | النطاق | النتيجة | الدمج | التقرير | تاريخ الإغلاق | ما بقي |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
  writeFileSync(join(root, 'docs/work/WORK_LOG.md'), `# سجل\n\n${head}\n`);
  for (const it of items) {
    const id = String(it.id ?? '');
    const scope = (it.scope as string[] ?? []).map((s) => `- \`${s}\``).join('\n');
    const sections = ['## 1) المسألة', '## 2) النطاق المحجوز', '## 3) خارج النطاق', '## 4) معيار القبول', '## 5) الدليل', '## 6) الأثر في الوثائق', '## 7) الخطوة التالية'];
    const body = `# ${id} — ${String(it.title ?? '')}\n\n${sections.map((s) => s.startsWith('## 2') ? `${s}\n\n${scope}\n` : `${s}\n\nنصٌّ\n`).join('\n')}`;
    writeFileSync(join(root, `docs/work/orders/${id}.md`), body);
  }
  return root;
}

function run(root: string, changed = 'docs/work/WORK_QUEUE.json', workItem = 'W-2026-001'): number {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, SOOL_WORK_ROOT: root, WORK_CHANGED_FILES: changed, WORK_ITEM: workItem, WORK_DIFF_SOURCE: 'declared' },
  });
  return r.status ?? -1;
}

// ── القبول: سجلٌّ سليمٌ يمرّ ────────────────────────────────────────────────
test('T-164: سجلٌّ سليمٌ بمفاتيحَ معلنةٍ يمرّ بالرمز 0', () => {
  assert.equal(run(fixture([item()])), 0);
});

// ── التجربة (أ): مفاتيحُ لا وجودَ لها في البيان ─────────────────────────────
test('T-164: مفتاحٌ لا وجودَ له في بيانِ السجلِّ يُسقط البوابة ولو سُمّي بأيِّ اسمٍ', () => {
  // «state» و«حال» و«stattus» (خطأُ إصبعٍ في مفتاحٍ حقيقيّ) — ثلاثتُها ليست من بيانِ
  // WORK_QUEUE.json، فبابُ الدخولِ لا بابُ القيمةِ هو المُدانُ.
  const tainted = item({ state: 'VERIFIED', حال: 'MERGED', stattus: 'PROPOSED' });
  assert.equal(run(fixture([tainted])), 1);
});

test('T-164: بيانٌ بلا item_keys يُسقط البوابة — فلا يُصدَّقُ مدخلٌ بلا بيانٍ يُحكم به', () => {
  assert.equal(run(fixture([item()], { itemKeys: [] })), 1);
});

// ── التجربة (ب): نصُّ القالبِ يُحتسب جوابًا ─────────────────────────────────
test('T-164: نصُّ القالبِ في خانةٍ واجبةٍ على بندٍ في REVIEW يُسقطه — فالحضورُ اسمًا والغيابُ فعلًا', () => {
  const templated = item({
    status: 'REVIEW', verification: 'دليلٌ مقيس',
    acceptance: ['يُملأ في العقد §4 قبل أوّلِ سطرٍ من العمل'],
    evidence: ['يُملأ عند التشغيل: خرج npm test بعددٍ صريح'],
    next_step: 'يُملأ عند الاستلام',
  });
  assert.equal(run(fixture([templated])), 1);
});

test('T-164: محتوى صحيحٌ («لا شيء») لا يُسقط البوابة — فالقالبُ وحده يُرفض', () => {
  const ok = item({ status: 'REVIEW', verification: 'دليلٌ', excluded: ['لا شيء'] });
  assert.equal(run(fixture([ok])), 0);
});
