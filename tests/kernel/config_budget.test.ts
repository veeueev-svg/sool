/**
 * tests/kernel/config_budget.test.ts — ميزانيّةُ الإعلان: سقفُ المجموع وسقفُ بايتات الملف (T-130)
 * المالك: القيّم على المستودع | المدخلات: نسخةٌ من `config/` تُنفخ في مجلد مؤقت | المخرجات: رفضُ إقلاع
 * التبعيات: guardConfigFileBytes · guardDeclarationTotals · guardDeclarationBudget · loadYamlFile
 * الصلاحيات: لا تعديل على تهيئة المستودع الفعليّة | السجلات: قيدُ `declaration_budget_measured`
 * حالات الفشل: `CONFIG_FILE_OVER_BYTE_CEILING` · `CONFIG_DECLARATION_TOTAL_BYTES_OVER_CEILING`
 *   · `CONFIG_DECLARATION_NODES_OVER_CEILING` · `CONFIG_DECLARATION_COUNT_UNMEASURED`
 * الوثيقة: docs/test-reports/T-130-config-declaration-budget.md
 *   · القياسُ الخام: docs/audit/measurements/phase-39-T130.txt
 * ثوابت الاختبار:
 *   1) **المحوران يُختبران منفصلَين**: بايتاتُ الملف الواحد ومجموعُ العُقد بابانِ مختلفان،
 *      فمن أسقط أحدَهما لا يُقال إنّه أسقط الآخر — لكلٍّ حالتُه ورمزُ رفضه.
 *   2) **الحدُّ يُقبل عنده ويُرفض فوقه بواحد** — حدٌّ لا يُقبل عنده منعٌ لا سقف.
 *   3) **الحرَسُ يقع في مسار الإقلاع فعلًا** لا في دالّةٍ تُنادى في اختبارٍ وحدَها:
 *      تُنفخ نسخةٌ من التهيئة ويُنادى `bootstrapState` عليها فيُرفض.
 *   4) **الأثرُ يُقرأ في الدفتر**: الإقلاعُ السليمُ يُدوّن القياسَ المقيس (RULE-009).
 *   5) **سطرٌ في الملف المحكوم لا يوسّع الميزانيّة** (RULE-005).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SovereignViolation, bootstrapState } from '../../src/index';
import {
  CONFIG_DECLARATION_BUDGET, censusDeclaration, countNodes, guardConfigFileBytes,
  guardDeclarationBudget, guardDeclarationTotals, loadExternal, loadYamlFile, resolveConfigDir,
} from '../../src/kernel/config';

const REAL_CONFIG = resolveConfigDir();
const OVER_FILE = 'CONFIG_FILE_OVER_BYTE_CEILING';
const OVER_BYTES = 'CONFIG_DECLARATION_TOTAL_BYTES_OVER_CEILING';
const OVER_NODES = 'CONFIG_DECLARATION_NODES_OVER_CEILING';
const UNMEASURED = 'CONFIG_DECLARATION_COUNT_UNMEASURED';

/** نسخةٌ من التهيئة الفعليّة يُعمل فيها ما يُطلب — والأصلُ لا يُمسّ */
function withCopy(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'budget-'));
  try {
    cpSync(REAL_CONFIG, dir, { recursive: true });
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** يُكبِّر ملفًا بتعليقاتٍ حتى يبلغ الحجمَ المطلوب — تعليقٌ يُكبر البايتاتَ ولا يُكبر العُقد */
function padTo(path: string, bytes: number): void {
  const line = `# ${'ح'.repeat(60)}\n`;
  while (readFileSync(path).length < bytes) appendFileSync(path, line);
}

function code(error: unknown): string {
  assert.ok(error instanceof SovereignViolation, `رفضٌ غيرُ سياديّ: ${String(error)}`);
  return (error as SovereignViolation).code;
}

test('الميزانيّةُ ثلاثةُ سقوفٍ صالحةٍ ومجمَّدةٍ لا تُعدَّل في التشغيل', () => {
  const keys = Object.keys(CONFIG_DECLARATION_BUDGET);
  assert.equal(keys.length, 3);
  for (const key of keys) {
    const value = CONFIG_DECLARATION_BUDGET[key as keyof typeof CONFIG_DECLARATION_BUDGET];
    assert.ok(Number.isSafeInteger(value) && value > 0, `سقفٌ غيرُ صالح: ${key}`);
  }
  assert.ok(Object.isFrozen(CONFIG_DECLARATION_BUDGET));
  // سقفُ الملفِّ الواحد أدنى من سقفِ المجموع بالضرورة: وإلّا كان أحدُهما لا يقع
  assert.ok(CONFIG_DECLARATION_BUDGET.file_bytes < CONFIG_DECLARATION_BUDGET.total_bytes);
});

test('الإعلانُ القائمُ اليوم يمرّ بالميزانيّة، والقياسُ يُقرأ بأرقامه', () => {
  const census = guardDeclarationBudget(REAL_CONFIG);
  assert.equal(census.files, 25);
  assert.ok(census.bytes > 0 && census.nodes > 0);
  assert.ok(census.largestBytes > 0 && census.largestFile.endsWith('.yaml'));
  // مدًى مُعلن: القياسُ اليومَ 73479B و804 عُقدٍ (phase-39-T130.txt). والتثبيتُ هنا مدًى
  // لا رقمًا بالضبط — فتعليقٌ يُضاف في `config/` لا يُسقط اختبارًا، وقفزةُ مرتبةٍ تُسقطه.
  assert.ok(census.bytes > 40_000 && census.bytes < 150_000, `بايتاتٌ خارجَ المدى: ${census.bytes}`);
  assert.ok(census.nodes > 400 && census.nodes < 2_000, `عُقدٌ خارجَ المدى: ${census.nodes}`);
  assert.ok(census.largestBytes <= CONFIG_DECLARATION_BUDGET.file_bytes);
});

test('حدُّ بايتات الملف: يُقبل عنده ويُرفض فوقه بواحد', () => {
  const max = CONFIG_DECLARATION_BUDGET.file_bytes;
  guardConfigFileBytes('probe.yaml', max);
  assert.throws(() => guardConfigFileBytes('probe.yaml', max + 1), (e) => code(e) === OVER_FILE);
});

test('حدُّ المجموع: يُقبل عند الحدَّين ويُرفض فوق كلٍّ منهما برمزه', () => {
  const { total_bytes: b, declared_nodes: n } = CONFIG_DECLARATION_BUDGET;
  guardDeclarationTotals(b, n);
  assert.throws(() => guardDeclarationTotals(b + 1, n), (e) => code(e) === OVER_BYTES);
  assert.throws(() => guardDeclarationTotals(b, n + 1), (e) => code(e) === OVER_NODES);
});

test('ما لم يُقس لا يُحرس: قدرٌ غيرُ صحيحٍ أو سالبٌ يُردّ لا يُمرَّر', () => {
  assert.throws(() => guardConfigFileBytes('p.yaml', -1), (e) => code(e) === UNMEASURED);
  assert.throws(() => guardConfigFileBytes('p.yaml', 1.5), (e) => code(e) === UNMEASURED);
  assert.throws(() => guardDeclarationTotals(Number.NaN, 1), (e) => code(e) === UNMEASURED);
  assert.throws(() => guardDeclarationTotals(1, -3), (e) => code(e) === UNMEASURED);
});

test('كلُّ قراءةِ ملفِّ تهيئةٍ تمرّ بحاجز البايتات — لا مسارُ الإقلاع وحده', () => {
  withCopy((dir) => {
    const path = join(dir, 'external.yaml');
    padTo(path, CONFIG_DECLARATION_BUDGET.file_bytes + 1);
    assert.throws(() => loadYamlFile(path), (e) => code(e) === OVER_FILE);
    // والمحمّلُ نفسُه يُردّ بالرمز ذاته: الحاجزُ قبل التحليل لا بعد بناءِ الكائن
    assert.throws(() => loadExternal(dir), (e) => code(e) === OVER_FILE);
  });
});

test('نفخُ T-129 المقيس (1024 نظيرًا ⇒ 188703B) يُردّ اليومَ بسقفِ البايتات', () => {
  withCopy((dir) => {
    const path = join(dir, 'external.yaml');
    const lines = readFileSync(path, 'utf8').split('\n');
    const at = lines.findIndex((l) => /^\s*counterparties:\s*$/.test(l));
    assert.notEqual(at, -1);
    const added: string[] = [];
    for (let i = 0; i < 1024; i += 1) {
      added.push(`  - { id: "external:probe${i}", name: "نظير ${i}", host: "p${i}.example",`
        + ' port: 443, purpose: "قياس", single_max: 1, daily_max: 1, total_cap: 1 }');
    }
    lines.splice(at + 1, 0, ...added);
    writeFileSync(path, lines.join('\n'));
    assert.throws(() => loadExternal(dir), (e) => code(e) === OVER_FILE);
  });
});

test('مجموعُ البايتات يُحرس ولو كان كلُّ ملفٍ تحت سقفه', () => {
  withCopy((dir) => {
    // كلُّ ملفٍ يُكبَّر إلى ما دون سقفه بقليل، فلا يقع حاجزُ الملف — ويقع حاجزُ المجموع
    const under = CONFIG_DECLARATION_BUDGET.file_bytes - 1_024;
    for (const name of ['external.yaml', 'channels.yaml', 'research.yaml', 'regions.yaml']) {
      padTo(join(dir, name), under);
    }
    const census = censusDeclaration(dir);
    assert.ok(census.largestBytes <= CONFIG_DECLARATION_BUDGET.file_bytes, 'لا ملفَ فوق سقفه');
    assert.throws(() => guardDeclarationBudget(dir), (e) => code(e) === OVER_BYTES);
  });
});

test('مجموعُ العُقد يُحرس ولو لم تتجاوز قائمةٌ واحدةٌ سقفَها', () => {
  withCopy((dir) => {
    // تهيئةٌ إضافيّةٌ لا تُقرأ بمحمّلٍ لكنّها **إعلانٌ في المجلد**: العُقدُ تُحصى ولا تُستثنى
    const rows: string[] = ['extra:'];
    for (let i = 0; i < CONFIG_DECLARATION_BUDGET.declared_nodes; i += 1) rows.push(`  k${i}: ${i}`);
    writeFileSync(join(dir, 'zz-extra.yaml'), `${rows.join('\n')}\n`);
    assert.throws(() => guardDeclarationBudget(dir), (e) => code(e) === OVER_NODES);
  });
});

test('الحرَسُ يقع في مسار الإقلاع الحقيقيّ لا في دالّةٍ تُنادى وحدَها', () => {
  withCopy((dir) => {
    const rows: string[] = ['extra:'];
    for (let i = 0; i < CONFIG_DECLARATION_BUDGET.declared_nodes; i += 1) rows.push(`  k${i}: ${i}`);
    writeFileSync(join(dir, 'zz-extra.yaml'), `${rows.join('\n')}\n`);
    assert.throws(() => bootstrapState({ configDir: dir }), (e) => code(e) === OVER_NODES);
  });
});

test('سطرٌ في الملف المحكوم لا يوسّع الميزانيّة (RULE-005)', () => {
  withCopy((dir) => {
    const path = join(dir, 'external.yaml');
    // دعوى توسيعٍ مكتوبةٌ في البيانات: لا أثرَ لها — السقفُ يسكن النواةَ
    appendFileSync(path, '\nmax_config_bytes: 99999999\nmax_declared_nodes: 99999999\n');
    padTo(path, CONFIG_DECLARATION_BUDGET.file_bytes + 1);
    assert.throws(() => loadYamlFile(path), (e) => code(e) === OVER_FILE);
  });
});

test('عدُّ العُقد بنيويٌّ: مفتاحٌ في خريطةٍ وعنصرٌ في قائمةٍ يُعدَّان، والقيمُ لا', () => {
  assert.equal(countNodes(null), 0);
  assert.equal(countNodes(7), 0);
  assert.equal(countNodes('نصّ'), 0);
  assert.equal(countNodes([1, 2, 3]), 3);
  assert.equal(countNodes({ a: 1, b: 2 }), 2);
  // خريطةٌ فيها قائمةٌ من خريطتَين: 1 (المفتاح) + 2 (عنصران) + 2 (مفتاحان) = 5
  assert.equal(countNodes({ xs: [{ a: 1 }, { b: 2 }] }), 5);
});

test('الإقلاعُ السليمُ يُدوّن القياسَ المقيس في الدفتر (RULE-009)', () => {
  const state = bootstrapState();
  const entries = state.audit.find('declaration_budget_measured');
  assert.equal(entries.length, 1);
  const detail = entries[0]!.detail as Record<string, number | string>;
  const census = censusDeclaration(REAL_CONFIG);
  assert.equal(detail.files, census.files);
  assert.equal(detail.bytes, census.bytes);
  assert.equal(detail.nodes, census.nodes);
  assert.equal(detail.largest, census.largestFile);
  // القيدُ أوّلُ ما يُدوَّن: لا خطوةَ تأسيسٍ قبل حرَسِ الميزانيّة
  assert.equal(state.audit.snapshot()[0]!.kind, 'declaration_budget_measured');
});
