/**
 * tests/economy/tax_rate_amendment_sink.test.ts — الوسيطُ الدائمُ لشاهدِ التعديلِ الملكيّ (T-53 · W-2026-065)
 * اختباراتُ علاقةِ الإضافةِ بالوسيطِ المُقيَّدِ: رميُه نتيجةٌ غير معلومة، وردُّه null رفضٌ مسمّى —
 * فُكِّكت هنا من tests/economy/tax_rate_amendment.test.ts لسقفِ الوحدةِ 400 سطرًا (الجلسة 133 ·
 * سابقةُ rehydrate_fiscal_rate) — الاختباراتُ نفسُها بلا تغييرٍ في المعيارِ أو القياس.
 * الجلسة 134 (علاجُ عيبَي الجلسة 37): 9ج صار يثبتُ الإقفالَ الدائمَ بعد المجهولةِ لا نجاحَ إعادةِ
 * المحاولةِ قبلَ الاستعادةِ (قيسَت مفسدةً للإقلاع: gpt شاهدانِ لأمرٍ واحد · grok تكرارُ تسلسلٍ مستهلك) —
 * وأُضيف 37أ و37ب بمشهدِ اليوميّةِ الحقيقيةِ (إقلاعٌ جديدٌ هو الاستئنافُ الوحيد).
 * الجلسة 136 (علاجُ عيبِ الجولة 38 · grok): 38أ — التقديرُ والإعفاءُ والتحصيلُ على الكائنِ المقفلِ تُرفضُ قبل
 * أيِّ أثرٍ دائم، ويُقاسُ بالإقلاعِ: outstanding() وشهودُ levy_assessed — لا رمزُ الرمي وحده.
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVENUE_TARGET, UNIT_TARGET, bootstrapState } from '../../src/index';
import type { DurableSink } from '../../src/data/persistence';

const NOW = Date.now();
const T1 = NOW + 10_000;

function revenueState() {
  const s = bootstrapState({ now: NOW });
  const royal = (target: string, at = NOW, base?: string, ratePerMille?: number) =>
    s.king.issueCommand('amend_policy', target,
      base === undefined ? { kind: 'economy' } : { kind: 'economy', base, ratePerMille: ratePerMille ?? 0 }, at);
  s.unit.issue(royal(UNIT_TARGET), 10_000_000, 'تمويل أولي', NOW);
  return { s, royal };
}

test('**T-53/مجلس 9ج** — RATE_AMENDMENT_DURABILITY_COMMIT_NONATOMIC: فشلُ كتابة الشاهد الدائم يُرجع الحال كاملًا', () => {
  const { s, royal } = revenueState();
  const cmd = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  const before = s.audit.length;
  // وسيطٌ دائمٌ يرفض كتابة قيد rate_amended وحده — عينُ مسبار الجلسة 9
  const refusingSink: DurableSink = {
    record: (kind, payload, at = 0) => {
      if ((payload as { kind?: string } | undefined)?.kind === 'rate_amended') throw new Error('PROBE_DURABILITY_REFUSAL');
      // غيرُ الشاهدِ يُدوَّن قيدًا صوريًّا: ردُّ null صار رفضًا مسمّى لا «التزامًا» صامتًا (الجلسة 11)
      return { seq: 0, at, kind, payload, prevHash: '0', hash: '0' };
    },
  };
  s.audit.attachSink(refusingSink);
  // رميُ الوسيط صار نتيجةً غير معلومةٍ (الجلسة 11): قد يكونُ دُوّنَ ثم رمى — والإرجاعُ الحَكَم
  assert.throws(() => s.revenue.amendRate(cmd, 'compute_usage', 40, T1),
    (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNKNOWN'
      && (e.cause as Error | undefined)?.message === 'PROBE_DURABILITY_REFUSAL',
    'رميُ الوسيط يُرمي «مجهولَ النتيجة» بعلةٍ لا يُبتلع');
  // الحالُ رُدَّ كاملًا: لا نسبةَ جديدة ولا تاريخَ زائد ولا أمرًا محروقًا ولا قيدًا في الذاكرة
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ الحاكمة لم تتغير');
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 1, 'التاريخُ لم يزدد');
  assert.equal(s.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديلٍ في الذاكرة');
  // قيدُ اعتمادِ البوابة (command_approved) وحده بقي — وهو أثرُ محاولةٍ مشروعةٌ لا شاهدُ تعديل؛
  // وقيدُ rate_amended نفسُه رُدَّ — فالإضافةُ ذرّيّة
  assert.equal(s.audit.length, before + 1, 'قيدُ rate_amended رُدّ ولم يبقَ إلا قيدُ البوابة');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةٌ بعد الرد');
  // الجلسة 37 · علاجُ الجلسة 134: بعد نتيجةٍ مجهولةٍ يقفلُ الإلحاقُ على الكائنِ إقفالًا دائمًا — فمتابعةُ
  // التشغيلِ على الغموضِ قيسَت مفسدةً للإقلاعِ مرتين (gpt: إعادةُ الأمرِ شاهدَينِ لأمرٍ واحد · grok: إلحاقٌ
  // لاحقٌ يعيدُ تسلسلًا مستهلكًا) — والاستئنافُ إقلاعٌ جديدٌ من اليوميّةِ لا نجاحُ محاولةٍ على الكائنِ المقفل.
  const okSink: DurableSink = {
    record: (kind, payload, at = 0) => ({ seq: 0, at, kind, payload, prevHash: '0', hash: '0' }),
  };
  s.audit.attachSink(okSink);
  assert.throws(() => s.revenue.amendRate(cmd, 'compute_usage', 40, T1),
    (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED',
    'إعادةُ الأمرِ قبلَ الاستعادةِ مرفوضةٌ مسمّاة — لا متابعةَ على غموض');
  assert.throws(() => s.audit.append('authority:audit_bureau', 'locked_probe', { probe: true }),
    (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED',
    'وأيُّ إلحاقٍ آخر على الكائنِ المقفلِ مرفوض');
  // وتبديلُ الوسيطِ لا يرفعُ الإقفالَ، واللقطةُ القديمةُ كذلك: سلامةُ سلسلةِ اللقطةِ لا تحسمُ الكتابةَ المجهولة
  const stale = JSON.stringify(s.audit.snapshot());
  s.audit.replaceFrom(stale);
  assert.throws(() => s.audit.append('authority:audit_bureau', 'locked_probe2', { probe: true }),
    (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED',
    'replaceFrom بلقطةٍ سليمةٍ لا يفتحُ الكائنَ المقفل');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةٌ والإقفالُ باقٍ عليها');
  // والتعديلُ نفسُه لم يُحرق: البرهانُ في 37ب — إقلاعٌ جديدٌ من يوميّةٍ لم تشهدْ ينجحُ فيه بأمرٍ ملكيٍّ جديد.
});

test('**T-53/مجلس 11ب** — RATE_AMENDMENT_SINK_NULL_ACCEPTED_AS_COMMIT: ردُّ الوسيطِ null رفضٌ مسمّى لا التزامٌ صامت (الجلسة 133)', () => {
  const { s, royal } = revenueState();
  const cmd = royal(REVENUE_TARGET, T1, 'compute_usage', 40);
  const before = s.audit.length;
  // وسيطٌ يردُّ null للشاهدِ الدائمِ وحده بلا رمي — عينُ مسبارِ الجلسة 11 المسدودِ سابقًا:
  // القبولُ الصامتُ كان يُمرِّرُ التعديلَ بلا شاهدٍ دائمٍ (ok=true · durableKept=[])
  const decliningSink: DurableSink = {
    record: (kind, payload, at = 0) => {
      if ((payload as { kind?: string } | undefined)?.kind === 'rate_amended') return null;
      // غيرُ الشاهدِ يُدوَّن قيدًا صوريًّا كما في 9ج — فالمقصودُ عينُ الرفضِ الصامتِ للشاهدِ
      return { seq: 0, at, kind, payload, prevHash: '0', hash: '0' };
    },
  };
  s.audit.attachSink(decliningSink);
  assert.throws(() => s.revenue.amendRate(cmd, 'compute_usage', 40, T1),
    (e: Error) => e.message === 'AUDIT_SINK_DECLINED_RECORD',
    'ردُّ null رفضٌ مسمّى لا التزامٌ صامت');
  // الحالُ رُدَّ كاملًا: لا نسبةَ جديدةَ ولا تاريخَ زائدًا ولا شاهدًا في الذاكرة
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ الحاكمة لم تتغير');
  assert.equal(s.revenue.rateHistoryOf('compute_usage').length, 1, 'التاريخُ لم يزدد');
  assert.equal(s.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديلٍ في الذاكرة');
  // قيدُ اعتمادِ البوابةِ وحده بقي — وقيدها رُدَّ، فالإضافةُ ذرّيّة
  assert.equal(s.audit.length, before + 1, 'قيدُ rate_amended رُدَّ ولم يبقَ إلا قيدُ البوابة');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمةٌ بعد الرد');
  // والأمرُ لم يُحرق: بعد وسيطٍ سليمٍ ينجحُ التعديلُ بالمعرّفِ نفسِه — فالرفضُ المسمّى لا يستهلكُ الأمر
  const okSink: DurableSink = {
    record: (kind, payload, at = 0) => ({ seq: 0, at, kind, payload, prevHash: '0', hash: '0' }),
  };
  s.audit.attachSink(okSink);
  const retry = s.revenue.amendRate(cmd, 'compute_usage', 40, T1);
  assert.equal(retry.ok, true, 'إعادةُ الأمرِ بعد وسيطٍ سليم تنجح');
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 40);
  assert.equal(s.audit.find('rate_amended').length, 1, 'وشاهدٌ واحدٌ لا اثنان');
});

/** مشهدُ اليوميّةِ الحقيقيةِ للجلسة 37: إقلاعٌ كاملٌ من مجلدِ حالةٍ مؤقت — كنمطِ rehydrate_fiscal_rate */
function journalScene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rate-sink-37-'));
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

test('**T-53/مجلس 37أ** — RATE_AMENDMENT_POSTCOMMIT_SEQ_REUSE_UNBOOTABLE: الإقفالُ يمنعُ إعادةَ التسلسلِ المستهلكِ — والإقلاعُ من اليوميّةِ الحقيقيةِ حَكَم (علاجُ الجلسة 134)', () => {
  const sc = journalScene();
  try {
    const first = sc.boot();
    const journal = first.journal;
    assert.ok(journal, 'اليوميّةُ الحقيقيةُ شرطُ المسبار');
    const at = NOW + 60_000;
    const cmd = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    // وسيطٌ يلفّ اليوميّةَ الحقيقيةَ: يُتمُّ التدوينَ ثم يرمي لقيد rate_amended وحده — عينُ مسبارِ grok
    first.audit.attachSink({
      record: (kind, payload, at = 0) => {
        const rec = journal.record(kind, payload, at);
        if ((payload as { kind?: string } | undefined)?.kind === 'rate_amended') throw new Error('PROBE_POST_COMMIT_THROW');
        return rec;
      },
    });
    assert.throws(() => first.revenue.amendRate(cmd, 'compute_usage', 40, at),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNKNOWN'
        && (e.cause as Error | undefined)?.message === 'PROBE_POST_COMMIT_THROW');
    assert.equal(first.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'الحالُ الحيُّ لم يتغيّر');
    assert.equal(first.audit.find('rate_amended').length, 0, 'لا شاهدَ في الذاكرة');
    // الإقفال: لا إلحاقَ بعدها — لا تقييمَ ولا إعادةَ أمرٍ (فإعادةُ التسلسلِ المستهلكِ مستحيلة)
    assert.throws(() => first.revenue.assess('compute_usage', 'external:compute-provider', 2_000_000, at + 1, at + 1),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED',
      'تقييمٌ بعد المجهولةِ مرفوضٌ مسمّى — لا كسرَ إقلاعٍ صامت');
    assert.throws(() => first.revenue.amendRate(cmd, 'compute_usage', 40, at + 2),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED',
      'وإعادةُ الأمرِ الملكيِّ قبلَ الاستعادةِ مرفوضة — لا شاهدَينِ لأمرٍ واحد');
    // وتبديلُ الوسيطِ لا يرفعُ الإقفال: الغموضُ على ما قد تحملُه اليوميّةُ لا على الوسيطِ وحده
    first.audit.attachSink(journal);
    assert.throws(() => first.revenue.amendRate(cmd, 'compute_usage', 40, at + 3),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED',
      'إعادةُ ربطِ اليوميّةِ نفسِها لا يفتحُ الكائنَ المقفل');
    // الإقلاعُ الجديدُ من اليوميّةِ الحقيقية: الشاهدُ المكتوبُ يُسترجَعُ مرةً واحدةً والسلسلةُ سليمة
    const second = sc.boot(NOW + 24 * 60 * 60_000);
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'الإرجاعُ حَكَم: التعديلُ التزم');
    assert.equal(second.rehydratedFiscal?.rateAmendments, 1, 'استرجاعٌ واحدٌ لا اثنان');
    assert.equal(second.audit.verifyIntegrity().valid, true, 'سلسلةُ الإقلاعِ سليمة — لا تكرارَ تسلسل');
    assert.equal(second.audit.find('rate_amended').length, 1, 'شاهدٌ واحدٌ في السلسلةِ المستعادة');
    // وإعادةُ الأمرِ بعدَ الاستعادةِ لا تنشئُ شاهدًا ثانيًا: الأمرُ مُنعَ بمعرّفِه — كنمطِ «مجلس 2»:
    // تعديلٌ لاحقٌ جديدٌ (50‰) يُغيّرُ الحالَ أولًا، ثمّ إعادةُ الأمرِ القديمِ (40) تُرفض بـ«نُفّذ سابقًا».
    const at3 = NOW + 24 * 60 * 60_000 + 90_000;
    const cmd50 = second.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 50 }, at3);
    assert.equal(second.revenue.amendRate(cmd50, 'compute_usage', 50, at3).ok, true, 'تعديلٌ لاحقٌ بعد الإقلاع');
    const replay = second.revenue.amendRate(cmd, 'compute_usage', 40, NOW + 24 * 60 * 60_000 + 120_000);
    assert.equal(replay.ok, false, 'إعادةُ الأمرِ المسترجَعِ مرفوضة');
    assert.match(replay.ok ? '' : replay.reason, /نُفّذ سابقًا/);
    assert.equal(second.audit.find('rate_amended').length, 2, 'شاهدانِ فقط: المسترجَعُ واللاحقُ — لا ثالثَ لإعادةِ الأمر');
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 50);
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 37ب** — RATE_AMENDMENT_OUTCOME_UNKNOWN_RETRY_CORRUPTS_AUDIT_RECOVERY: رميٌ قبلَ التدوينِ يقفلُ أيضًا — والتعديلُ نفسُه يبقى ممكنًا بعدَ إقلاعٍ من يوميّةٍ لم تشهدْ (علاجُ الجلسة 134)', () => {
  const sc = journalScene();
  try {
    const first = sc.boot();
    const journal = first.journal;
    assert.ok(journal, 'اليوميّةُ الحقيقيةُ شرطُ المسبار');
    const at = NOW + 60_000;
    const cmd = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    // وسيطٌ يرمي قبلَ التدوينِ لقيد rate_amended وحده — عينُ مسبارِ gpt في حالةِ «لم يُدوَّن»
    first.audit.attachSink({
      record: (kind, payload, at = 0) => {
        if ((payload as { kind?: string } | undefined)?.kind === 'rate_amended') throw new Error('PROBE_PRE_COMMIT_THROW');
        return journal.record(kind, payload, at);
      },
    });
    assert.throws(() => first.revenue.amendRate(cmd, 'compute_usage', 40, at),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNKNOWN'
        && (e.cause as Error | undefined)?.message === 'PROBE_PRE_COMMIT_THROW');
    assert.equal(first.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'الحالُ الحيُّ لم يتغيّر');
    assert.equal(first.audit.find('rate_amended').length, 0, 'لا شاهدَ في الذاكرة');
    // الإقفالُ دائمٌ وإن لم يُدوَّن: الغموضُ لا يُميَّز — فالاستئنافُ إقلاعٌ جديدٌ فقط
    assert.throws(() => first.revenue.amendRate(cmd, 'compute_usage', 40, at + 2),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED',
      'إعادةُ الأمرِ قبلَ الاستعادةِ مرفوضةٌ وإن كان الوسيطُ لم يُدوّن');
    // الإقلاعُ الجديدُ من يوميّةٍ لم تشهدْ للتعديل: لا استرجاعَ والسلسلةُ سليمة — لا فجوةَ تسلسل
    const second = sc.boot(NOW + 24 * 60 * 60_000);
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'لا تعديلَ في اليوميّةِ فلا استرجاع');
    assert.equal(second.rehydratedFiscal?.rateAmendments, 0);
    assert.equal(second.audit.verifyIntegrity().valid, true, 'سلسلةُ الإقلاعِ سليمة');
    // والتعديلُ لم يُحرق: الهويّةُ الملكيّةُ مفاتيحُها لكلِّ إقلاعٍ (فالأمرُ القديمُ لا يوقِّعُه ملكُ
    // الإقلاعِ الجديدِ أصلًا) — والبرهانُ أنّ الغامضةَ لم تترك أثرًا يمنعُ التعديلَ نفسَه: أمرٌ ملكيٌّ
    // جديدٌ بالوعاءِ والنسبةِ نفسيهما ينجحُ بعدَ إقلاعٍ من يوميّةٍ لم تشهدْ، وشاهدٌ واحدٌ لا اثنان.
    const atNew = NOW + 24 * 60 * 60_000 + 60_000;
    const cmdNew = second.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, atNew);
    const retry = second.revenue.amendRate(cmdNew, 'compute_usage', 40, atNew);
    assert.equal(retry.ok, true, 'التعديلُ نفسُه ينجحُ بعدَ إقلاعٍ من يوميّةٍ لم تشهد — لا أثرَ يمنعُه');
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 40);
    assert.equal(second.audit.find('rate_amended').length, 1, 'وشاهدٌ واحدٌ لا اثنان');
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 38أ** — RATE_AMENDMENT_LOCKED_ASSESS_DURABLE_STALE_LEVY: الكائنُ المقفلُ يرفضُ التقديرَ والإعفاءَ قبلَ أيِّ أثرٍ دائم — لا تقديرَ بائدًا يُعادُ بالإقلاع (الجلسة 136)', () => {
  const sc = journalScene();
  try {
    const first = sc.boot();
    const journal = first.journal;
    assert.ok(journal, 'اليوميّةُ الحقيقيةُ شرطُ المسبار');
    const payer = 'external:compute-provider';
    // تقديرٌ سليمٌ قبل المجهولة — ليُمتحنَ الإعفاءُ على الكائنِ المقفلِ أيضًا
    const pre = first.revenue.assess('compute_usage', payer, 1_000_000, NOW + 1_000, NOW + 1_000);
    assert.equal(pre.ok, true);
    const at = NOW + 60_000;
    const cmd = first.king.issueCommand('amend_policy', 'economy:revenue',
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at);
    first.audit.attachSink({
      record: (kind, payload, t = 0) => {
        const rec = journal.record(kind, payload, t);
        if ((payload as { kind?: string } | undefined)?.kind === 'rate_amended') throw new Error('PROBE_POST_COMMIT_THROW');
        return rec;
      },
    });
    assert.throws(() => first.revenue.amendRate(cmd, 'compute_usage', 40, at),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNKNOWN');
    const before = first.revenue.outstanding().length;
    // عينُ مسبارِ grok: واقعةٌ بعد سريانِ 40 — والحيُّ 25 بائد
    assert.throws(() => first.revenue.assess('compute_usage', payer, 2_000_000, at + 1, at + 1),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED');
    assert.equal(first.revenue.outstanding().length, before, 'لا تقديرَ في الذاكرةِ بعد الرفض');
    const waive = first.king.issueCommand('amend_policy', 'economy:revenue', { kind: 'economy' }, at + 2);
    assert.throws(() => first.revenue.waive(waive, pre.ok ? pre.levy.levyId : '', 'إعفاء', at + 2),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED');
    assert.equal(first.revenue.outstanding().length, before, 'الإعفاءُ المرفوضُ لم يغيّر الحالَ الحيّ');
    assert.throws(() => first.revenue.collect(pre.ok ? pre.levy.levyId : '', at + 3),
      (e: Error) => e.message === 'AUDIT_APPEND_OUTCOME_UNRESOLVED', 'والتحصيلُ مرفوضٌ مسمّى على الكائنِ المقفل');
    assert.equal(first.revenue.outstanding()[0]?.status, 'assessed', 'والتقديرُ السابقُ لم يُحصَّل في الذاكرة');
    // الإقلاعُ حَكَم: لا تقديرَ بائدًا ولا إعفاءَ بلا شاهد — التقديرُ السابقُ وحدَه قائم
    const second = sc.boot(NOW + 24 * 60 * 60_000);
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 40);
    const open = second.revenue.outstanding();
    assert.equal(open.length, 1, 'تقديرٌ واحدٌ قائم: السابقُ للمجهولة — لا تقديرَ بائدًا مُعادًا');
    assert.equal(open[0]?.amountBase, 1_000_000);
    assert.equal(open[0]?.status, 'assessed', 'ولا إعفاءَ كُتب على الكائنِ المقفل');
    assert.equal(second.audit.find('levy_assessed').length, 1, 'شاهدٌ واحدٌ لتقديرٍ واحد');
    assert.equal(second.audit.verifyIntegrity().valid, true);
  } finally {
    sc.clean();
  }
});
