/**
 * tests/economy/tax_rate_amendment_alias.test.ts — حارسُ بدائيّةِ مداخلِ الرسومِ (T-53 · W-2026-065)
 * الجولة 40 (الجلسة 138 · علاج عيب grok TAX_LEVY_NONPRIMITIVE_FIELD_ALIAS): لا كائنٌ يُقرأُ مرارًا
 * فيُخزَّنَ مرجعُه الحيُّ — من جنس حارسِ الجلسة 9 في amendRate (RATE_AMENDMENT_EFFECTIVE_AT_MUTABLE_OBJECT_ESCAPE).
 * فُكِّكت هنا في ملفٍّ جديدٍ معلنٍ لسقفِ الوحدةِ 400 سطرًا (سابقةُ الجلسة 133 · rehydrate_fiscal_rate ·
 * توسيعُ نطاقٍ معلنٌ في §2 من عقدِ البند).
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVENUE_TARGET, bootstrapState } from '../../src/index';

const NOW = Date.now();

test('**T-53/مجلس 40ب** — TAX_LEVY_NONPRIMITIVE_FIELD_ALIAS: الكائنُ في المدخلِ مرفوضٌ مسمّى — لا مرجعٌ حيٌّ يُخزَّنُ في الحالِ ولا في الشاهد (علاجُ الجولة 40 · الجلسة 138)', () => {
  const s = bootstrapState({ now: NOW });
  const before = s.audit.length;
  // مسبارُ grok بحرفه: payer كائنٌ بـtrim يقرأُ متغيّرًا وoccurredAt/now كائنانِ بـvalueOf
  let who = 'external:compute-provider';
  const payerProbe = { trim: () => who, toString: () => who, valueOf: () => 1 } as unknown as string;
  const clock = { valueOf: () => NOW + 1_000 } as unknown as number;
  const refused = s.revenue.assess('compute_usage', payerProbe, 1_000_000, clock, clock);
  assert.equal(refused.ok, false, 'الكائنُ في المدخلِ مرفوضٌ لا يُخزَّنُ مرجعًا حيًّا');
  assert.match(refused.reason, /المدخلُ بدائيٌّ محدد/);
  // لا أثرَ إطلاقًا: لا تقديرَ في الحالِ ولا شاهدَ levy_assessed — ورفضٌ مسمًّى بقيدٍ واحد
  assert.equal(s.revenue.outstanding().length, 0, 'لا تقديرَ خُزِّن');
  assert.equal(s.audit.find('levy_assessed').length, 0, 'لا شاهدَ تقدير');
  assert.equal(s.audit.length, before + 1, 'قيدُ الرفضِ وحده');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمة');
  // وقلبُ الصناديقِ بعدَ الرفضِ لا يجدُ شيئًا يُزوَّر: لا حالَ ولا شاهدَ يُمسكُ المرجعَ أصلًا
  who = 'forged:after';
  assert.equal(s.revenue.outstanding().length, 0, 'قلبُ الصناديقِ بعدَ الرفضِ بلا أثر');
  // والمدخلُ البدائيُّ السليمُ يُقبَل — الحارسُ لا يعطّلُ الطريقَ القويم
  const ok = s.revenue.assess('compute_usage', 'external:compute-provider', 1_000_000, NOW + 1_000, NOW + 1_000);
  assert.equal(ok.ok, true, 'التقديرُ البدائيُّ السليمُ ينجح');
  // ومن الجنسِ نفسِه في الوحدةِ نفسِها: لحظةُ التحصيلِ الكائنةُ مرفوضةٌ مسمّاة (collectedAt لا يُخزَّنُ مرجعًا)
  const refusedCollect = s.revenue.collect(ok.ok ? ok.levy.levyId : '', { valueOf: () => NOW + 2_000 } as unknown as number);
  assert.equal(refusedCollect.ok, false, 'لحظةُ التحصيلِ الكائنةُ مرفوضة');
  assert.match(refusedCollect.reason, /لحظةُ التحصيلِ رقمٌ محدد/);
  // وسببُ الإعفاءِ الكائنُ ولحظتُه الكائنةُ مرفوضانِ مسمّيين (البابُ الثالثُ من الوحدةِ نفسِها)
  const waiveCmd = s.king.issueCommand('amend_policy', REVENUE_TARGET, { kind: 'economy' }, NOW + 3_000);
  const refusedWaive = s.revenue.waive(waiveCmd, ok.ok ? ok.levy.levyId : '',
    { trim: () => 'إعفاء' } as unknown as string, { valueOf: () => NOW + 3_000 } as unknown as number);
  assert.equal(refusedWaive.ok, false, 'سببُ الإعفاءِ الكائنُ مرفوض');
  assert.match(refusedWaive.reason, /سببُ الإعفاءِ نص/);
  // والتحصيلُ البدائيُّ السليمُ يعملُ بالمبلغِ الكنونيّ — والسلسلةُ سليمة
  const good = s.revenue.collect(ok.ok ? ok.levy.levyId : '', NOW + 4_000);
  assert.equal(good.ok, true, 'التحصيلُ البدائيُّ ينجح');
  assert.equal(good.ok ? good.levy.levied : 0, 25_000, 'وبالمبلغِ الكنونيّ');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمة');
});

/** عدةُ المشهدِ ليوميّةٍ حقيقيةٍ بمجلدِ حالةٍ — عينُ عدةِ sink (مجالس 37–42) للاختبارِ الذي يليه */
function journalScene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rate-issued-43-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = NOW) => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('**T-53/مجلس 43** — RATE_AMENDMENT_COMMAND_ISSUED_AT_UNGUARDED (grok · الجولة 43): لحظةُ إصدارِ الأمرِ غيرُ العدديةِ مرفوضةٌ مسمّاةً قبلَ أيِّ شاهدٍ دائم — الكائنُ ذا valueOf يمرُّ بوابةَ التاجِ (العمرُ بالطرحِ) فلا يُدوَّنَ مرجعًا حيًّا في rate_amended، والعبثُ بعدَ الرفضِ لا يكسرُ السلسلةَ، والإقلاعُ من اليوميّةِ الحقيقيةِ بعدَ الرفوضِ سليم، والأمرُ العدديُّ اللاحقُ ينجح (علاجُ الجلسة 141)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 60_000;
    const first = sc.boot();
    // مسبارُ grok الصورةُ الأولى: كائنٌ ذا valueOf — يمرُّ البوابةَ ويرفضُه الحارسُ قبلَ الشاهدِ الدائم
    const issued = { valueOf: () => at } as unknown as number;
    const cmdObj = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, issued);
    const refusedObj = first.revenue.amendRate(cmdObj, 'compute_usage', 40, at);
    assert.equal(refusedObj.ok, false, 'لحظةُ الإصدارِ الكائنةُ مرفوضةٌ — الحارسُ قبلَ أيِّ شاهدٍ دائم');
    assert.equal(first.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةٌ قبلَ العبث');
    (issued as unknown as { valueOf: () => number }).valueOf = () => at + 1_000_000;
    assert.equal(first.audit.verifyIntegrity().valid, true, 'قلبُ الكائنِ بعدَ الرفضِ لا يكسرُ السلسلة — لا مرجعَ حيًّا في القيد');
    assert.equal(first.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديلٍ من أمرٍ لحظتُهُ كائنة');
    assert.equal(first.audit.find('rate_amendment_refused').length, 1, 'قيدُ رفضٍ واحدٌ مسمّى');
    // الصورةُ الثانيةُ: NaN — يمرُّ البوابةَ (لا يفوقُ السقفَ ولا يستبقُ) ويرفضُه الحارسُ قبلَ الشاهدِ
    const cmdNaN = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, NaN);
    const refusedNaN = first.revenue.amendRate(cmdNaN, 'compute_usage', 40, at);
    assert.equal(refusedNaN.ok, false, 'NaN مرفوضةٌ في الحارس');
    // الصورةُ الثالثةُ: سلسلةٌ رقميّةٌ — البوابةُ تطرحُها فتُمرَّرُ والحارسُ يرفضُها قبلَ الشاهدِ
    const cmdStr = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, String(at) as unknown as number);
    const refusedStr = first.revenue.amendRate(cmdStr, 'compute_usage', 40, at);
    assert.equal(refusedStr.ok, false, 'السلسلةُ الرقميّةُ مرفوضةٌ في الحارس');
    assert.equal(first.audit.find('rate_amendment_refused').length, 3, 'ثلاثةُ قيودِ رفضٍ ولا شاهدَ تعديل');
    // الإقلاعُ من اليوميّةِ الحقيقيةِ بعدَ الرفوضِ الثلاثةِ — سليمٌ لا رميَ ولا «نسخةَ سجلٍّ فاسدة»
    const second = sc.boot(at + 60_000);
    assert.equal(second.audit.verifyIntegrity().valid, true, 'الإقلاعُ بعدَ الرفوضِ الكائنةِ سليم');
    assert.equal(second.audit.find('rate_amendment_refused').length, 3, 'قيودُ الرفضِ الثلاثةُ مستعادة');
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ الأصليةُ 25 — لا إعلانَ زائفًا');
    // شاهدُ الضبطِ على البابِ نفسِه: أمرٌ عدديٌّ سليمٌ ينجحُ بعدَ الرفوضِ — الحارسُ لا يُقفلُ الباب
    const cmdOk = second.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at + 61_000);
    const ok = second.revenue.amendRate(cmdOk, 'compute_usage', 40, at + 61_000);
    assert.equal(ok.ok, true, 'الأمرُ العدديُّ السليمُ ينجحُ بعدَ الرفوضِ');
    // والشاهدُ الدائمُ يحملُ العددَ المقروءَ لا مرجعًا حيًّا — والإقلاعُ الثالثُ يشهدُهُ من اليوميّةِ
    const third = sc.boot(at + 120_000);
    const amended = third.audit.find('rate_amended')[0]!;
    assert.equal((amended.detail as { commandIssuedAt?: unknown }).commandIssuedAt, at + 61_000,
      'شاهدُ rate_amended يحملُ لحظةَ الإصدارِ عددًا مقروءًا');
    assert.equal(third.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'النسبةُ 40 بعدَ الإقلاعِ من اليوميّة');
    assert.equal(third.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةٌ في الإقلاعِ الثالث');
  } finally {
    sc.clean();
  }
});
