/**
 * tests/data/rehydrate_fiscal_rate.test.ts — إرجاعُ تعديلاتِ نسبةِ الجباية من السجلِ الأبديّ (T-53 · W-2026-065)
 * المالك: وزارة البيانات | المدخلات: تهيئةٌ مؤقتة ومجلدُ يوميّة | المخرجات: سجلُّ نِسَبٍ ينجو أو رفضٌ مسمًّى
 * التبعيات: bootstrapState · rehydrateFiscalFromJournal
 * الصلاحيات: الكتابة عبر الواجهات العامة وحدها
 * السجلات: rate_amended · rate_amendments_restored
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir ولا يكتب في المستودع
 * اختبار القبول: هذا الملف | الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-065.md
 *
 * نُقلت هذه الاختبارات حرفًا من tests/data/rehydrate_fiscal.test.ts (الجلسة 98) لأنّ ذاك بلغ سقفَ
 * الوحدة 400 سطر (check:size) — لا حذفَ ولا إضعاف: العددُ نفسُه والتأكيداتُ نفسُها، وأُضيف إليها
 * مسبارا الجلسة 6. والمهادُ نسخةٌ من مهادِ ذاك الملف بلا بذرٍ ماليّ.
 *
 * ثوابت هذا الاختبار:
 *   1) **`T0` مُقيَّدٌ بتاريخِ إعلانِ نِسَبِ الجباية** في `config/economy.yaml` (RULE-005).
 *   2) الإقلاعُ الثاني دولةٌ جديدةٌ بالكامل — لا كائنَ مشتركًا بين الإقلاعين.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { rehydrateFiscalFromJournal } from '../../src/data/rehydrate_fiscal';
import type { DurableRecord } from '../../src/data/persistence';

const T0 = Date.parse('2026-08-23T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function scene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rehydrate-fiscal-rate-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = T0) => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('T-53/مجلس 2: سجلُّ نِسَبِ الجبايةِ ينجو الإقلاع — من قيودِ السجلِ الأبديِّ لا من الذاكرة (RATE_AMENDMENT_HISTORY_NOT_DURABLE)', () => {
  const sc = scene();
  try {
    const first = sc.boot();
    const at = T0 + 3 * 60 * 1000;
    const cmd = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    const amended = first.revenue.amendRate(cmd, 'compute_usage', 40, at);
    assert.equal(amended.ok, true, 'التعديل شرطُ القياس');
    // واقعةٌ تُقدَّرُ بالنسبةِ الجديدةِ فتشهدُ السجلُّ أثرَه
    const levy = first.revenue.assess('compute_usage', 'external:compute-provider', 2_000_000, at + 1, at + 1);
    assert.equal(levy.ok, true, 'التقدير بالنسبة الجديدة شرطُ الشاهد');

    const second = sc.boot(T0 + DAY);
    const history = second.revenue.rateHistoryOf('compute_usage');
    assert.equal(history.length, 2, 'إعلانُ التهيئة + التعديل');
    assert.equal(history[1]?.ratePerMille, 40, 'الإعلانُ التشغيليُّ 40‰ لم يُمحَ بالإقلاع');
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'النسبةُ الحاكمةُ بعد الإقلاع');
    assert.equal(second.rehydratedFiscal?.rateAmendments, 1, 'تقريرُ الإرجاعِ يشهدُ بالتعديل');
    // والأمرُ المنفَّذُ قبلَ الإقلاعِ لا يُنفَّذُ ثانيةً بعدَ تعديلٍ لاحق
    const at2 = T0 + DAY + 60_000;
    const cmd60 = second.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 60 }, at2);
    assert.equal(second.revenue.amendRate(cmd60, 'compute_usage', 60, at2).ok, true, 'تعديلٌ لاحقٌ بعد الإقلاع');
    const replay = second.revenue.amendRate(cmd, 'compute_usage', 40, T0 + DAY + 120_000);
    assert.equal(replay.ok, false, 'إعادةُ الأمرِ القديمِ مرفوضة');
    assert.match(replay.ok ? '' : replay.reason, /نُفّذ سابقًا/);
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 60, 'لا رجوعَ بالأمر المُعاد');
    // الجلسة 6 · مسبارُ grok (RATE_AMENDMENT_LIVE_EXECUTED_CONFLICT_SILENT_SKIP): الأمرُ المنفَّذُ حيًّا (60‰) له حمولتُه،
    // فشاهدٌ بمعرّفِه عند 90‰ يُرفض ولا يُتخطّى
    const forged = { seq: 1, at: at2, kind: 'audit_entry', prevHash: '0', hash: '1', payload: { kind: 'rate_amended', detail: {
      base: 'compute_usage', from: 40, to: 90, previousDeclaredAt: at, effectiveFrom: at2 + 1, commandId: cmd60.payload.commandId } } } as DurableRecord;
    assert.throws(() => rehydrateFiscalFromJournal([forged], { revenue: second.revenue }, 'ministry:data'),
      (e: Error) => e.message === `RECOVERY_RATE_COMMAND_CONFLICT:${cmd60.payload.commandId}`);
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 60, 'الشاهدُ المخالفُ لم يُطبَّق');
  } finally {
    sc.clean();
  }
});

test('T-53/مجلس 3: شاهدُ rate_amended التالفُ يُسقط الإرجاعَ برمزٍ مسمًّى ولا يُسقَطُ صمتًا (RATE_AMENDMENT_MALFORMED_AUDIT_BYPASS)', () => {
  const sc = scene();
  try {
    const s = sc.boot();
    const at = T0 + 60_000;
    const D0 = s.revenue.rateFor('compute_usage')!.declaredAt;
    const good = { base: 'compute_usage', from: 25, to: 40, previousDeclaredAt: D0, effectiveFrom: at, commandId: 'cmd:probe-1' };
    const entry = (detail: unknown): DurableRecord => ({
      seq: 1, at, kind: 'audit_entry', prevHash: '0', hash: '1',
      payload: { kind: 'rate_amended', detail },
    });
    const run = (detail: unknown) => rehydrateFiscalFromJournal([entry(detail)], { revenue: s.revenue }, 'ministry:data');
    // مسبارُ gpt في الجلسة 3 بحرفه — كان RESULT { rateAmendments: 0 } بلا رمي
    assert.throws(() => run({ ...good, to: 'not-a-number' }), (e: Error) => e.message === 'RECOVERY_RATE_INVALID');
    // مسبارُ grok: قيدٌ بلا commandId
    const { commandId: _drop, ...noCommand } = good;
    assert.throws(() => run(noCommand), (e: Error) => e.message === 'RECOVERY_RATE_COMMAND_ID_MISSING');
    assert.throws(() => run({ ...good, effectiveFrom: 'أمس' }), (e: Error) => e.message === 'RECOVERY_RATE_DECLARED_AT_INVALID');
    assert.throws(() => run(null), (e: Error) => e.message.startsWith('RECOVERY_RATE_BASE_UNDECLARED'));
    assert.throws(() => run({ ...good, base: 'لا-وعاء' }), (e: Error) => e.message === 'RECOVERY_RATE_BASE_UNDECLARED:لا-وعاء');
    assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 1, 'الرفضُ لا يُغيّر السجل');
    // سالبةُ الضبط: الشاهدُ السليمُ نفسُه يُرجَع
    assert.equal(run(good).rateAmendments, 1);
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40);
  } finally {
    sc.clean();
  }
});

test('T-53/مجلس 5: شاهدان بمعرّفِ أمرٍ واحدٍ ونسبتَين مختلفتَين يُرفضان برمزٍ مسمًّى — لا يُمحى الثاني بصمت (RATE_AMENDMENT_DUPLICATE_COMMAND_CONFLICT_SILENT_SKIP)', () => {
  const sc = scene();
  try {
    const s = sc.boot();
    const at = T0 + 60_000;
    const D0 = s.revenue.rateFor('compute_usage')!.declaredAt;
    const first = { base: 'compute_usage', from: 25, to: 80, previousDeclaredAt: D0, effectiveFrom: at, commandId: 'cmd:dup-1' };
    const second = { base: 'compute_usage', from: 25, to: 90, previousDeclaredAt: D0, effectiveFrom: at + 60_000, commandId: 'cmd:dup-1' };
    const entry = (detail: unknown, seq: number): DurableRecord => ({
      seq, at, kind: 'audit_entry', prevHash: String(seq - 1), hash: String(seq),
      payload: { kind: 'rate_amended', detail },
    });
    // شاهدان بمعرّفٍ واحد وحمولتَين مختلفتَين — كان يُمحى الثاني بلا رمز
    assert.throws(
      () => rehydrateFiscalFromJournal([entry(first, 1), entry(second, 2)], { revenue: s.revenue }, 'ministry:data'),
      (e: Error) => e.message === 'RECOVERY_RATE_COMMAND_CONFLICT:cmd:dup-1',
    );
    // الشاهدُ الأول طُبِّق والثاني رُفض — فالنسبةُ 80‰ لا 90‰
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 80, 'الشاهدُ المرفوضُ لم يُطبَّق');
    const same = { base: 'compute_usage', from: 25, to: 80, previousDeclaredAt: D0, effectiveFrom: at, commandId: 'cmd:dup-1' };
    const report = rehydrateFiscalFromJournal([entry(first, 1), entry(same, 2)], { revenue: s.revenue }, 'ministry:data');
    assert.equal(report.rateAmendments, 2, 'الإعادةُ الأمينةُ: شاهدان شُوهِدا ولا رميَ');
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 80, 'والإعادةُ لم تُكرَّر');
    // الجلسة 6 · مسبارُ gpt (RATE_AMENDMENT_DUPLICATE_COMMAND_CONFLICT_FROM_FIELD_SILENT_SKIP): الوجهةُ نفسُها
    // ويخالف في from وحده (أو previousDeclaredAt أو commandIssuedAt) ⇒ تعارض — الحقولُ تُنقل من الشاهد فتُقارن
    for (const o of [{ from: 999 }, { previousDeclaredAt: D0 + 1 }, { commandIssuedAt: at }]) {
      assert.throws(() => rehydrateFiscalFromJournal([entry({ ...first, ...o }, 3)], { revenue: s.revenue }, 'ministry:data'),
        (e: Error) => e.message === 'RECOVERY_RATE_COMMAND_CONFLICT:cmd:dup-1', JSON.stringify(o));
    }
  } finally {
    sc.clean();
  }
});
