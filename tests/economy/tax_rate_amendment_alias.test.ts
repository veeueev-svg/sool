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
import type { SignedRoyalCommand } from '../../src/kernel/types';

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

/**
 * مساميرُ الجولة 44 (W-2026-065 · علاجُ الجلسة 142): عيوبُ المجلس الثلاثة المقيّدة في discoveries —
 * كلُّ مسبارٍ على يوميّةٍ حقيقيّةٍ بمجلّدِ حالة، وقارئةٌ منقلبةٌ أثناءَ التنفيذِ تُلزمُ البوابةَ والشاهدَ بالقراءةِ الوحيدةِ.
 */
function flippingCommand(cmd: SignedRoyalCommand): { command: SignedRoyalCommand; real: string } {
  const real = cmd.payload.commandId;
  let reads = 0;
  const payload = { ...cmd.payload } as Record<string, unknown>;
  Object.defineProperty(payload, 'commandId', {
    enumerable: true,
    get: () => { reads += 1; return reads === 1 ? real : { forged: true }; },
  });
  return { command: { ...cmd, payload: payload as unknown as typeof cmd.payload } as SignedRoyalCommand, real };
}

test('**T-53/مجلس 44أ** — RATE_AMENDMENT_COMMAND_ID_UNGUARDED (grok · الجولة 44): معرّفُ الأمرِ غيرُ النصّيِّ مرفوضٌ مسمًّا قبلَ أيِّ شاهدٍ دائمٍ في amendRate — والقارئةُ المنقلبةُ أثناءَ التنفيذِ تُلزمُ البوابةَ والشاهدَ بالقراءةِ نفسها (علاجُ الجلسة 142)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 60_000;
    const first = sc.boot();
    // الصور الخمس: فارغ · مسافات · عدد · NaN · كائن — كلُّ واحدٍ منها مرفوضٌ مسمًّا قبل أيِّ شاهدٍ دائمٍ
    const variants: [string, unknown][] = [['الفارغ', ''], ['المسافات', '   '], ['العدد', 1001], ['NaN', NaN], ['الكائن', { forged: true }]];
    for (const [label, cid] of variants) {
      const cmd = first.king.issueCommand('amend_policy', 'economy:revenue',
        { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
      const forged = { ...cmd, payload: { ...cmd.payload, commandId: cid } } as unknown as SignedRoyalCommand;
      const refused = first.revenue.amendRate(forged, 'compute_usage', 40, at);
      assert.equal(refused.ok, false, `${label} مرفوض`);
      assert.ok(!refused.ok && refused.reason.includes('معرّفُ الأمرِ نص'), `رفضٌ مسمّى: ${refused.ok ? '' : refused.reason}`);
    }
    assert.equal(first.audit.find('rate_amended').length, 0, 'لا شاهد تعديل من أمرٍّ بلا معرّفٍ نصيٍّ');
    const refusals = first.audit.find('rate_amendment_refused');
    assert.equal(refusals.length, 5, 'خمسةُ قيودِ رفضٍ مسمّاة');
    for (const r of refusals) {
      assert.equal((r.detail as { commandId?: unknown }).commandId, undefined, 'قيدُ الرفض لا يُعيدُ الخامّ في extra (ثابت 12)');
    }
    assert.equal(first.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةُ بعد الرفوض');
    // القارئةُ المنقلبةُ أثناءَ التنفيذِ: تُعيدُ النصّ في قراءةِ الحارس الوحيدةِ ثمّ كائنًا لكلِّ قارئٍ لاحقٍ —
    // اللقطةُ الموحّدةُ تُلزمُ البوابةَ والشاهدَ بالقراءةِ نفسها
    const base = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at + 1_000);
    const { command: flipped, real } = flippingCommand(base);
    const ok = first.revenue.amendRate(flipped, 'compute_usage', 40, at + 1_000);
    assert.equal(ok.ok, true, 'التعديلُ بالقراءةِ الأولى ينجح');
    const approved = first.audit.find('command_approved').at(-1)!;
    assert.equal((approved.detail as { commandId?: unknown }).commandId, real, 'شاهدُ الاعتماد يحملُ القراءةَ المحروسةَ نفسها');
    const amended = first.audit.find('rate_amended')[0]!;
    assert.equal((amended.detail as { commandId?: unknown }).commandId, real, 'شاهدُ rate_amended يحملُ المعرّفَ المقروءَ نصًّا لا المرجعَ الحيَّ');
    assert.equal(first.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةُ بعد النجاح — المقروءُ دُوّن لا المرجعُ الحيُّ');
    // الإقلاعُ من اليوميّةِ الحقيقيّة: سليمٌ والنسبةُ 40 والشاهدُ نصٌّ
    const second = sc.boot(at + 120_000);
    assert.equal(second.audit.verifyIntegrity().valid, true, 'الإقلاعُ سليم');
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'النسبةُ 40');
    const w2 = second.audit.find('rate_amended')[0]!;
    assert.equal((w2.detail as { commandId?: unknown }).commandId, real, 'الشاهدُ المستعاد يحملُ النصّ');
    // والأمرُ النصيُّ اللاحقُ ينجح — وإعادتُه تُرفضُ «نُفّذ سابقًا» والمقروءُ في extra نصٌّ
    const cmd3 = second.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 55 }, at + 121_000);
    const ok3 = second.revenue.amendRate(cmd3, 'compute_usage', 55, at + 121_000);
    assert.equal(ok3.ok, true, 'الأمرُ النصيُّ اللاحقُ ينجح');
    // أمرٌ رابعٌ يرفعُ النسبةَ إلى 70 — ليصبح طلبُ 55 مجددًً تعديلًا حقيقيًّا لا «بلا تغيير»
    const cmd4 = second.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 70 }, at + 121_500);
    const ok4 = second.revenue.amendRate(cmd4, 'compute_usage', 70, at + 121_500);
    assert.equal(ok4.ok, true, 'الأمرُ الرابعُ ينجح');
    // وإعادةُ الأمرِ الثالغِ (طلبُ 55 والسائدةُ 70) تُرفضُ «نُفّظ سابقًا»
    const replay = second.revenue.amendRate(cmd3, 'compute_usage', 55, at + 122_000);
    assert.equal(replay.ok, false, 'إعادةُ الأمر مرفوضة');
    assert.ok(!replay.ok && replay.reason.includes('سابق'), 'رفضُ الإعادة مسمًّا');
    const ref = second.audit.find('rate_amendment_refused').at(-1)!;
    assert.equal(typeof (ref.detail as { commandId?: unknown }).commandId, 'string', 'رفضُ الإعادة يحملُ المعرّفَ نصًّا');
    assert.equal(second.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمة');
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 44ب** — TAX_WAIVE_COMMAND_ID_LIVE_REFERENCE (grok · الجولة 44): معرّفُ الأمرِ غيرُ النصّيِّ مرفوضٌ مسمًّا في waive ولا يُخزَّنُ خامًّا في levy_waived — والقارئةُ المنقلبةُ تُخزَّنُ قراءتَا الأولى نصًّا لا مرجعًا حيًّا (علاجُ الجلسة 142)', () => {
  const sc = journalScene();
  try {
    const s = sc.boot();
    const assessed = s.revenue.assess('compute_usage', 'external:compute-provider', 1_000_000, NOW + 1_000, NOW + 1_000);
    assert.ok(assessed.ok, 'التقديرُ السليم ينجح');
    const levyId = assessed.ok ? assessed.levy.levyId : '';
    // الصور: فارغ · عدد · كائن — مرفوضةٌ مسمّاةٌ ولا إعفاءَ ولا شاهد
    const variants: [string, unknown][] = [['الفارغ', ''], ['العدد', 1001], ['الكائن', { forged: true }]];
    for (const [label, cid] of variants) {
      const cmd = s.king.issueCommand('amend_policy', 'economy:revenue', { kind: 'economy' }, NOW + 2_000);
      const forged = { ...cmd, payload: { ...cmd.payload, commandId: cid } } as unknown as SignedRoyalCommand;
      const refused = s.revenue.waive(forged, levyId, 'إعفاء ملكي', NOW + 2_000);
      assert.equal(refused.ok, false, `${label} مرفوض`);
      assert.ok(!refused.ok && refused.reason.includes('معرّفُ الأمرِ نص'), 'رفضٌ مسمّى');
    }
    assert.equal(s.audit.find('levy_waived').length, 0, 'لا شاهد إعفاءٍ بمعرّفٍ خامٍ');
    assert.equal(s.revenue.get(levyId)?.status, 'assessed', 'الرسمُ ما زال معلّقًا');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةُ بعد الرفوض');
    // القارئةُ المنقلبةُ: النجاحُ بالقراءةِ الأولى والشاهدُ يحملُ النصّ المقروءَ لا المرجعَ الحيَّ
    const cmd = s.king.issueCommand('amend_policy', 'economy:revenue', { kind: 'economy' }, NOW + 3_000);
    const { command: flipped, real } = flippingCommand(cmd);
    const waived = s.revenue.waive(flipped, levyId, 'إعفاء ملكي', NOW + 3_000);
    assert.equal(waived.ok, true, 'الإعفاءُ بالقراءةِ الأولى ينجح');
    const w = s.audit.find('levy_waived')[0]!;
    assert.equal((w.detail as { commandId?: unknown }).commandId, real, 'شاهدُ levy_waived يحملُ المعرّفَ المقروءَ نصًّا');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةُ بعد النجاح');
    // الإقلاعُ من اليوميّةِ: الإعفاءُ باقٍ والشاهدُ نصٌّ
    const s2 = sc.boot(NOW + 60_000);
    assert.equal(s2.revenue.get(levyId)?.status, 'waived', 'الإعفاءُ باقٍ بعد الإقلاع');
    const w2 = s2.audit.find('levy_waived')[0]!;
    assert.equal((w2.detail as { commandId?: unknown }).commandId, real, 'الشاهدُ المستعاد يحملُ النصّ');
    assert.equal(s2.audit.verifyIntegrity().valid, true, 'الإقلاعُ سليم');
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 44ج** — RATE_AMENDMENT_AUDIT_WITNESS_MUTABLE_REFERENCE_ESCAPE (gpt · الجولة 44): قراءةُ السجلِّ لقطةٌ عميقةٌ مجمّدةٌ — تعديلُ شاهدِ rate_amended بعدَ النجاحِ لا يكسرُ السلسلةَ لا من find ولا من snapshot ولا من كائنِ المستدعي الحيِّ المتداحلِ (علاجُ الجلسة 142)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 60_000;
    const s = sc.boot();
    const cmd = s.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    const ok = s.revenue.amendRate(cmd, 'compute_usage', 40, at);
    assert.equal(ok.ok, true, 'التعديلُ ينجح');
    // مسبار gpt: تعديلُ detail الشاهدِ من find بعد النجاح — لقطةٌ مجمّدةٌ لا تصلُ الأصل
    const amended = s.audit.find('rate_amended')[0]!;
    assert.equal((amended.detail as { to: number }).to, 40, 'الشاهدُ يحملُ النسبةَ الجديدة');
    let mutationThrew = false;
    try { (amended.detail as { to: number }).to = 999; } catch { mutationThrew = true; }
    assert.equal(s.audit.verifyIntegrity().valid, true, 'العبثُ بنسخةِ القراءةِ لا يكسرُ السلسلةَ');
    assert.equal((s.audit.find('rate_amended')[0]!.detail as { to: number }).to, 40, 'الشاهدُ الداخليُّ لم يُمسّ');
    // وكائنُ المستدعي المتداحلُ لا يصلُ: الإضافةُ تخزّنُ لقطةً عميقةً
    const probe = { inner: { value: 1 } };
    s.audit.append('king', 'council44_probe', { nested: probe });
    probe.inner.value = 999;
    assert.equal(s.audit.verifyIntegrity().valid, true, 'قلبُ كائنِ المستدعي بعد الإضافةِ لا يكسرُ السلسلةَ');
    const stored = s.audit.find('council44_probe')[0]!;
    assert.equal((stored.detail as { nested: { inner: { value: number } } }).nested.inner.value, 1, 'المخزونُ اللقطةُ لا المرجعُ الحيُّ');
    // ونسختا snapshot مستقلّتانِ عميقًًا
    const a = s.audit.snapshot();
    const b = s.audit.snapshot();
    const lastA = a[a.length - 1]!.detail as { nested: unknown };
    const lastB = b[b.length - 1]!.detail as { nested: unknown };
    assert.notEqual(lastA.nested, lastB.nested, 'نسختا القراءةِ مستقلتانِ عميقًًا');
    // والإقلاعُ من اليوميّةِ: الشاهدُ غيرُ معدولٍ والنسبةُ 40
    const s2 = sc.boot(at + 60_000);
    assert.equal(s2.audit.verifyIntegrity().valid, true, 'الإقلاعُ سليم');
    assert.equal(s2.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'النسبةُ 40');
    const w2 = s2.audit.find('rate_amended')[0]!;
    assert.equal((w2.detail as { to: number }).to, 40, 'الشاهدُ سليمٌ بعد الإقلاع');
    assert.equal((s2.audit.find('council44_probe')[0]!.detail as { nested: { inner: { value: number } } }).nested.inner.value, 1, 'لقطةُ المسبار سليمةٌ');
  } finally {
    sc.clean();
  }
});


/** عدةُ الجولة 45: حمولةٌ بواصفٍ منقلبٍ — القراءةُ الأولى للقطةِ والثانيةُ للفحصِ الحيِّ */
function flippingPayloadProp<P extends string>(cmd: SignedRoyalCommand, prop: P, first: unknown, second: unknown): SignedRoyalCommand {
  let reads = 0;
  const payload = { ...cmd.payload } as Record<string, unknown>;
  const base = payload[prop];
  Object.defineProperty(payload, prop, {
    get: () => {
      reads += 1;
      return reads === 1 ? first : second;
    },
    configurable: true,
    enumerable: true,
  });
  void base;
  return { ...cmd, payload } as unknown as SignedRoyalCommand;
}

test('**T-53/مجلس 45أ** — RATE_AMENDMENT_WITNESS_TOCTOU_PARAMS_RAW_READ (gpt · الجولة 45): فحوصُ السياسةِ والربطُ تقرأُ لقطةَ الشاهدِ لا الحمولةَ الحيّةَ — أمرٌ موقّعٌ على 40 بقارئةٍ منقلبةٍ لا ينفّذُ 60/80 ولا غيرَ الموقّعِ أبدًا (علاجُ الجلسة 143)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 60_000;
    const s = sc.boot();
    // المسبار الحرفي من خامّ gpt: أمرٌ موقّعٌ على compute_usage/40 وواصفُ params يقلبُ بعدَ القراءةِ الأولى
    const cmd = s.king.issueCommand('amend_policy', REVENUE_TARGET,
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    const forged = flippingPayloadProp(cmd, 'params', cmd.payload.params,
      { kind: 'economy', base: 'compute_usage', ratePerMille: 80 });
    const refused = s.revenue.amendRate(forged, 'compute_usage', 80, at);
    assert.equal(refused.ok, false, 'التعديلُ غيرُ الموقَّعِ مرفوض');
    assert.ok(!refused.ok && refused.reason.includes('لا يسمّي هذا التعديل'), `رفضٌ مسمّى: ${!refused.ok ? refused.reason : ''}`);
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ ما زالت 25 — لا تنفيذَ لغيرِ الموقَّع');
    assert.equal(s.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديلٍ لغيرِ الموقَّع');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةُ بعدَ الرفض');
    // والصورةُ الثانيةُ من خامّ grok (P2): التوقيعُ على وعاءٍ والتنفيذُ على وعاءٍ آخر — مرفوضةٌ كذلك
    const cmd2 = s.king.issueCommand('amend_policy', REVENUE_TARGET,
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at + 1_000);
    const forged2 = flippingPayloadProp(cmd2, 'params', cmd2.payload.params,
      { kind: 'economy', base: 'artifact_import', ratePerMille: 40 });
    const refused2 = s.revenue.amendRate(forged2, 'artifact_import', 40, at + 1_000);
    assert.equal(refused2.ok, false, 'وعاءُ التنفيذِ غيرُ الموقَّعِ مرفوض');
    assert.equal(s.revenue.rateFor('artifact_import')?.ratePerMille, 50, 'وعاءُ التوقيعِ لم يُمسّ');
    // والطريقُ القويمُ يعملُ: أمرٌ موقّعٌ على 40 ينفّذُ 40 قراءةً واحدةً
    const good = s.revenue.amendRate(cmd, 'compute_usage', 40, at + 2_000);
    assert.equal(good.ok, true, 'الأمرُ الموقَّعُ الصادقُ ينجح');
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'النسبةُ 40 بالموقَّع');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمة');
    // والإقلاعُ من اليوميّةِ: لا أثرَ للقارئةِ المنقلبةِ ولا للرفضِ المسجَّلِ غيرِ الموقَّع
    const s2 = sc.boot(at + 60_000);
    assert.equal(s2.revenue.rateFor('compute_usage')?.ratePerMille, 40, '40 بعد الإقلاع');
    assert.equal(s2.revenue.rateFor('artifact_import')?.ratePerMille, 50, 'ووعاءُ القلبِ بحالِه');
    assert.equal(s2.audit.verifyIntegrity().valid, true, 'الإقلاعُ سليم');
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 45ب** — RATE_AMENDMENT_POLICY_CHECKS_REREAD_LIVE_PAYLOAD (grok · الجولة 45): هدفُ الأمرِ وفحوصُ السياسةِ في التعديلِ والإعفاءِ منَ اللقطةِ — أمرٌ موقّعٌ على غيرِ هدفِ الإيرادِ لا يعدّلُ ولا يُعفي بقارئةٍ منقلبة (علاجُ الجلسة 143)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 60_000;
    const s = sc.boot();
    const assessed = s.revenue.assess('compute_usage', 'external:compute-provider', 1_000_000, at, at);
    assert.ok(assessed.ok, 'التقديرُ السليمُ ينجح');
    const levyId = assessed.ok ? assessed.levy.levyId : '';
    // P3 من خامّ grok: الأمرُ موقّعٌ على population:agents والقارئةُ تعيدُ economy:revenue في الفحصِ الحيِّ
    const cmd = s.king.issueCommand('amend_policy', 'population:agents', { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at + 1_000);
    const forged = flippingPayloadProp(cmd, 'target', cmd.payload.target, REVENUE_TARGET);
    const refused = s.revenue.amendRate(forged, 'compute_usage', 40, at + 1_000);
    assert.equal(refused.ok, false, 'التعديلُ بهدفٍ غيرِ الموقَّعِ مرفوض');
    assert.ok(!refused.ok && refused.reason.includes('هدف الأمر يجب أن يكون'), `رفضٌ مسمّى: ${!refused.ok ? refused.reason : ''}`);
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ ما زالت 25');
    assert.equal(s.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديل');
    // P4: الإعفاءُ بالقلبِ نفسِه — الهدفُ الحيُّ يعيدُ هدفَ الإيرادِ في الفحصِ
    const waiveCmd = s.king.issueCommand('amend_policy', 'population:agents', { kind: 'economy' }, at + 2_000);
    const forgedWaive = flippingPayloadProp(waiveCmd, 'target', waiveCmd.payload.target, REVENUE_TARGET);
    const refusedWaive = s.revenue.waive(forgedWaive, levyId, 'إعفاء ملكي', at + 2_000);
    assert.equal(refusedWaive.ok, false, 'الإعفاءُ بهدفٍ غيرِ الموقَّعِ مرفوض');
    assert.ok(!refusedWaive.ok && refusedWaive.reason.includes('هدف الأمر يجب أن يكون'), 'رفضٌ مسمّى');
    assert.equal(s.revenue.get(levyId)?.status, 'assessed', 'الرسمُ ما زال معلّقًا');
    assert.equal(s.audit.find('levy_waived').length, 0, 'لا شاهدَ إعفاء');
    // وشاهدُ الضبط (الطريقُ القويمُ): الهدفُ نفسُه يُرفضُ أيضًا لأنّهُ ليسَ هدفَ الإيراد — والفرقُ أنّ القلبَ كان سيُمرّرُه
    const s2 = sc.boot(at + 60_000);
    assert.equal(s2.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'لا أثرَ رجعيًّا ولا حاليًّا');
    assert.equal(s2.audit.verifyIntegrity().valid, true, 'الإقلاعُ سليم');
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 45ج** — AUDIT_ACTOR_LIVE_REFERENCE_UNBOOTABLE (grok · الجولة 45): المُصدِرُ يُحرسُ نصًّا في الشاهدِ والفاعلُ في السجلِّ الأبديِّ لا يُخزَّنُ مرجعًا حيًّا — فلا كسرَ سلسلةَ ولا قتلَ إقلاعَ (علاجُ الجلسة 143)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 60_000;
    const s = sc.boot();
    // P5 من خامّ grok بحرفه: issuedBy كائنٌ صريحٌ على أمرٍ سليمِ البقية — يُرفضُ مسمًّى قبلَ أيِّ شاهدٍ دائمٍ فلا يصلُ المرجعُ الحيُّ قيودَ sovereign_violation وcommand_denied
    const cmd = s.king.issueCommand('amend_policy', REVENUE_TARGET,
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    const forged = { ...cmd, payload: { ...cmd.payload, issuedBy: { marker: 'before' } } } as unknown as SignedRoyalCommand;
    const refused = s.revenue.amendRate(forged, 'compute_usage', 40, at);
    assert.equal(refused.ok, false, 'الأمرُ بمُصدِرٍ غيرِ نصّيٍّ مرفوض');
    assert.ok(!refused.ok && refused.reason.includes('مُصدِرُ الأمرِ نص'), `رفضٌ مسمّى: ${!refused.ok ? refused.reason : ''}`);
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ لم تتغيّر');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمة');
    // والبابُ العامُّ في السجلِّ الأبديّ: الفاعلُ غيرُ النصّيِّ يُرفضُ رميًا مسمًّى قبلَ الدفعِ والتجزئةِ
    assert.throws(() => s.audit.append({ marker: 'live' } as unknown as never, 'council45_probe', {}),
      /AUDIT_ACTOR_MUST_BE_NONEMPTY_TEXT/, 'الرميُ المسمّى');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةُ بعدَ الرمي');
    const before = s.audit.length;
    const entry = s.audit.append('council45-king', 'council45_probe', { v: 1 });
    assert.equal(s.audit.length, before + 1, 'الإلحاقُ السليمُ بعدَ الرميِ يعمل');
    assert.equal(entry.actor, 'council45-king', 'والفاعلُ نصٌّ');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمة');
    // والإقلاعُ من اليوميّةِ: لا أثرَ للكائنِ الحيِّ ولا للرمي
    const s2 = sc.boot(at + 60_000);
    assert.equal(s2.audit.verifyIntegrity().valid, true, 'الإقلاعُ سليم');
    assert.equal(s2.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ 25');
  } finally {
    sc.clean();
  }
});
