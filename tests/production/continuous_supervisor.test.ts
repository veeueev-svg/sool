/**
 * tests/production/continuous_supervisor.test.ts — مراقبة بلا مدة ولا نهاية (المرحلة 37)
 * المالك: ديوان التدقيق | المدخلات: ماسحات مُبدَلة معلنة + نقطة تفتيش في مجلد مؤقت
 * المخرجات: مسحات مقيَّدة، فجوات معلنة، خرق عند انهيار ماسح، توقف عند الحرج
 * التبعيات: ContinuousSupervisor, CheckpointStore, KillSwitch
 * الصلاحيات: قياس فقط — ولا يُعدّل الاختبار تسامح التهيئة
 * حالات الفشل المقيسة: ماسح مجهول، ماسح معلن بلا ماسحة، مراقب غير معلن، ماسح يرمي،
 *   نقطة تفتيش معدَّلة، وقفٌ من غير مشغّل، وقفٌ بلا سبب، تأخّر عن الإقلاع، صمت، فجوة عبور،
 *   وصمتٌ فسّره حجبُ المُشغّل يُسمّى ولا يُدان به المراقب، وصمتٌ زاد على الحجب يُدان (T-155)
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 * ملاحظة: «تبدأ مع الإقلاع» تُقاس بفارق أول مسحة عن لحظة الإقلاع لا ببدءٍ داخل
 *   bootstrapState — والسبب موثَّق في PROGRESS.md بندًا مفتوحًا T-109.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ContinuousSupervisor, CheckpointStore, resolveCheckpointPath, PRODUCTION_GUARD, SovereignViolation,
} from '../../src/index';
import {
  productionHarness, OPERATOR, OBSERVER, silentProbes, probesWith, fakeProbe, throwingProbe,
  countEvent, lastDetail, sleep, repoPolicy,
} from './helpers';

/** مراقبٌ ثانٍ على الدولة نفسها بماسحات معلنة مُبدَلة — للقياس المعزول */
function supervisorOn(
  h: ReturnType<typeof productionHarness>,
  probes: ReadonlyMap<never, never> | ReturnType<typeof silentProbes>,
  bootAt: number,
): ContinuousSupervisor {
  return new ContinuousSupervisor({
    audit: h.state.audit, killSwitch: h.state.killSwitch, policy: h.policy,
    observer: h.policy.observer_authority, probes: probes as ReturnType<typeof silentProbes>,
    bootAt, checkpoint: new CheckpointStore(resolveCheckpointPath(h.checkpointDir)),
  });
}

test('البناء يُرفض: ماسح مجهول، وماسح معلن بلا ماسحة، ومراقب غير معلن', () => {
  const now = Date.now();
  const h = productionHarness({ now, federate: false });
  try {
    const codes: string[] = [];
    const capture = (build: () => unknown): void => {
      try { build(); } catch (error) {
        assert.equal(error instanceof SovereignViolation, true, String(error));
        codes.push((error as SovereignViolation).code);
      }
    };
    // ماسح غير معروف في القائمة المعلنة
    capture(() => new ContinuousSupervisor({
      audit: h.state.audit, killSwitch: h.state.killSwitch,
      policy: { ...h.policy, scanners: ['telescope' as never] },
      observer: h.policy.observer_authority, probes: silentProbes(h.policy), bootAt: now,
      checkpoint: new CheckpointStore(resolveCheckpointPath(h.checkpointDir)),
    }));
    // قدرةٌ لا يناديها أحد لا توجد (T-105)
    const missing = new Map(silentProbes(h.policy));
    missing.delete(h.policy.scanners[0] as never);
    capture(() => supervisorOn(h, missing, now));
    // من يشهد يجب أن يكون جهة المراقبة المعلنة (RULE-004)
    capture(() => new ContinuousSupervisor({
      audit: h.state.audit, killSwitch: h.state.killSwitch, policy: h.policy,
      observer: OPERATOR, probes: silentProbes(h.policy), bootAt: now,
      checkpoint: new CheckpointStore(resolveCheckpointPath(h.checkpointDir)),
    }));
    assert.deepEqual(codes, [
      'SUPERVISOR_SCANNER_UNKNOWN', 'SUPERVISOR_SCANNER_UNPROBED', 'SUPERVISOR_OBSERVER_UNDECLARED',
    ]);
  } finally { h.dispose(); }
});

test('البدء يمسح فورًا ويُقيّد كل ماسح معلن ولا يُكرَّر بدؤه', () => {
  const now = Date.now();
  const h = productionHarness({ now, probes: silentProbes(productionHarness_policy()) });
  try {
    h.supervisor.start(now);
    h.supervisor.start(now + 1);
    const report = h.supervisor.report();
    assert.equal(report.sweeps, 1, 'مسحةٌ فورية واحدة — البدء الثاني بلا أثر');
    assert.equal(countEvent(h.state, 'continuous_supervision_started'), 1);
    assert.equal(report.running, true);
    assert.equal(report.firstSweepAt, now);
    for (const scanner of h.policy.scanners) {
      assert.equal(report.scannerSweeps[scanner], 1, `الماسح ${scanner} مُنادى`);
    }
  } finally { h.dispose(); }
});

/** السياسة الفعلية — تُقرأ مرة واحدة كي تُبنى ماسحات صامتة بعدد الماسحات المعلنة */
let cachedPolicy: ReturnType<typeof repoPolicy> | null = null;
function productionHarness_policy(): ReturnType<typeof repoPolicy> {
  if (!cachedPolicy) cachedPolicy = repoPolicy();
  return cachedPolicy;
}

test('التأخّر عن الإقلاع فجوةٌ تُقاس على مهلة البدء لا تُطوى', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const late = supervisorOn(h, silentProbes(h.policy), now);
    const lateBy = h.policy.supervision.start_grace_ms + 50;
    late.start(now + lateBy);
    const gaps = late.report().gaps.filter((g) => g.kind === 'start');
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.ms, lateBy);
    late.stop(OPERATOR, 'انتهى القياس', now + lateBy);
    // مراقبة بدأت في المهلة لا تُعلن فجوة بدء
    const timely = supervisorOn(h, silentProbes(h.policy), now);
    timely.start(now + 1);
    assert.equal(timely.report().gaps.filter((g) => g.kind === 'start').length, 0);
    timely.stop(OPERATOR, 'انتهى القياس', now + 2);
  } finally { h.dispose(); }
});

/**
 * ثابت 8 (T-155): مِجَسٌّ في موعده يعني «المُشغّل كان قادرًا على النداء»، فصمتُ
 * المراقبة صمتُها هي. تُنادى النبضاتُ صراحةً كي يُقاس التمييزُ لا حظُّ الجدولة.
 */
function tickProbe(s: ContinuousSupervisor, from: number, to: number, tick: number): void {
  for (let at = from + tick; at <= to; at += tick) s.observeProbe(at);
}

test('الصمت بين مسحتين يُقيَّد ويُحصى — والعودة بعد انقطاع ليست استمرارًا', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const s = supervisorOn(h, silentProbes(h.policy), now);
    s.start(now);
    const silence = h.policy.supervision.max_silence_ms + 100;
    tickProbe(s, now, now + silence, h.policy.supervision.tick_ms);
    s.sweep(now + silence);
    const gaps = s.report().gaps.filter((g) => g.kind === 'silence');
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.ms, silence);
    assert.equal(lastDetail(h.state, 'supervision_gap').limitMs, h.policy.supervision.max_silence_ms);
    assert.equal(lastDetail(h.state, 'supervision_gap').stallMs, 0, 'ولا حجبَ مُشغّلٍ يُعتذر به');
    assert.equal(s.report().hostStalls.length, 0);
    s.stop(OPERATOR, 'انتهى القياس', now + silence);
  } finally { h.dispose(); }
});

test('ثابت 8: صمتٌ فسّره حجبُ المُشغّل يُسمّى `supervision_host_stall` ولا يُحسب فجوةَ مراقبة', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const tick = h.policy.supervision.tick_ms;
    const s = supervisorOn(h, silentProbes(h.policy), now);
    // نبضةُ البدايةِ تُسجّل مباشرةً لا بمؤقّتٍ حقيقي: موقِتٌ لا يُوقَف يكتب بعد
    // انتهاءِ الاختبارِ في مجلّدٍ محذوفٍ (ENOENT)، والمقيسُ هنا حسابٌ لا جدولة.
    s.observeProbe(now);
    s.sweep(now);
    // المِجَسُّ نفسُه محجوبٌ فلم يُنادَ قطًّا خلالَ النافذة: فالحجبُ من المُشغّلِ لا من المراقبة
    const silence = h.policy.supervision.max_silence_ms + 300;
    s.sweep(now + silence);
    const report = s.report();
    assert.equal(report.gaps.filter((g) => g.kind === 'silence').length, 0, 'لا فجوةَ مراقبة');
    assert.equal(report.hostStalls.length, 1, 'بل حالةُ حجبٍ واحدةٌ معلنة');
    assert.equal(report.hostStalls[0]?.silenceMs, silence);
    assert.equal(report.hostStalls[0]?.stallMs, silence - tick);
    assert.equal(countEvent(h.state, 'supervision_host_stall'), 1, 'مقيَّدةٌ في السجل لا مطويّة');
    assert.equal(lastDetail(h.state, 'supervision_host_stall').toleranceMs, 2 * tick);
  } finally { h.dispose(); }
});

test('ثابت 8: حجبُ المُشغّلِ لا يعتذر عمّا زاد عليه — الفارقُ فوق النبضةِ فجوةٌ تُدان', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const tick = h.policy.supervision.tick_ms;
    const s = supervisorOn(h, silentProbes(h.policy), now);
    s.observeProbe(now);
    s.sweep(now);
    // مِجَسٌّ منتظمٌ حتّى now+1440 ثمّ حجبٌ مقدارُه 440ms، والصمتُ 2000ms:
    // الزائدُ على الحجبِ (1560ms) يبقى خرقًا يُدان
    const silence = 2_000;
    const lastProbe = 1_440;
    const stall = silence - lastProbe - tick;
    tickProbe(s, now, now + lastProbe, tick);
    s.sweep(now + silence);
    const gaps = s.report().gaps.filter((g) => g.kind === 'silence');
    assert.equal(gaps.length, 1, 'الفجوةُ تُدان ولو وقع حجبٌ');
    assert.equal(gaps[0]?.ms, silence);
    assert.equal(lastDetail(h.state, 'supervision_gap').stallMs, stall, 'والحجبُ يُدوّن بمقداره');
    assert.equal(s.report().hostStalls.length, 0);
  } finally { h.dispose(); }
});

test('ثابت 8: حدُّ التسامحِ نبضتانِ بالضبط — ونبضتانِ وواحدٌ تُدان', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const tick = h.policy.supervision.tick_ms;
    const silence = h.policy.supervision.max_silence_ms + 300;
    const at = (excess: number): { gaps: number; stalls: number } => {
      const s = supervisorOn(h, silentProbes(h.policy), now);
      s.observeProbe(now);
      s.sweep(now);
      // أخيرُ نبضةٍ للمِجَسِّ عند now+excess: فالحجبُ = silence − excess − tick،
      // والفارقُ = tick + excess ⇒ يُحتمل حتّى excess = tick ويُدان عند tick+1
      s.observeProbe(now + excess);
      s.sweep(now + silence);
      const r = s.report();
      return { gaps: r.gaps.filter((g) => g.kind === 'silence').length, stalls: r.hostStalls.length };
    };
    assert.deepEqual(at(tick), { gaps: 0, stalls: 1 }, 'الفارقُ = نبضتان ⇒ حجبٌ معلن');
    assert.deepEqual(at(tick + 1), { gaps: 1, stalls: 0 }, 'ونبضتانِ وواحدٌ ⇒ فجوةٌ تُدان');
  } finally { h.dispose(); }
});

test('ثابت 8: الحجبُ لا يُعطّل الحرسَ لِما بعده — صمتٌ تالٍ بمِجَسٍّ في موعده يُدان', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const tick = h.policy.supervision.tick_ms;
    const s = supervisorOn(h, silentProbes(h.policy), now);
    s.observeProbe(now);
    s.sweep(now);
    const first = h.policy.supervision.max_silence_ms + 300;
    s.sweep(now + first);
    assert.equal(s.report().hostStalls.length, 1, 'الأولى حجبٌ');
    const second = first + h.policy.supervision.max_silence_ms + 300;
    tickProbe(s, now + first, now + second, tick);
    s.sweep(now + second);
    assert.equal(s.report().gaps.filter((g) => g.kind === 'silence').length, 1, 'والثانيةُ فجوةٌ');
    assert.equal(s.report().hostStalls.length, 1, 'ولا يُضاعف الحجبُ نفسُه');
  } finally { h.dispose(); }
});

test('ثابت 8: تجويعُ حلقةِ الحدثِ الحقيقيُّ يُسمّى حجبًا ولا يُدان به المراقب', async () => {
  const now = Date.now();
  const h = productionHarness({ now, probes: silentProbes(productionHarness_policy()) });
  try {
    const start = Date.now();
    h.supervisor.start(start);
    await sleep(h.policy.supervision.tick_ms * 2);
    // حجبٌ صناعيٌّ محسوب: حبسُ حلقةِ الحدثِ فوق حدِّ الصمتِ المعلن
    const until = Date.now() + h.policy.supervision.max_silence_ms + 400;
    while (Date.now() < until) { /* حبسٌ مقصودٌ يُحاكي مُشغّلًا مزدحمًا */ }
    await sleep(h.policy.supervision.tick_ms * 3);
    const report = h.supervisor.report();
    assert.equal(
      report.gaps.filter((g) => g.kind === 'silence').length, 0,
      `فجواتٌ ${JSON.stringify(report.gaps)} — والحجبُ ${JSON.stringify(report.hostStalls)}`,
    );
    assert.ok(report.hostStalls.length >= 1, 'والحجبُ يُعلن لا يُطوى');
  } finally { h.dispose(); }
});

test('إعادة التشغيل تُعلن فجوة العبور من نقطة التفتيش ولا تبدأ من صفر', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const first = supervisorOn(h, silentProbes(h.policy), now);
    first.start(now);
    assert.equal(countEvent(h.state, 'production_checkpoint_written') >= 1, true);
    first.stop(OPERATOR, 'إعادة تشغيل مُعلنة', now + 1);
    // إقلاعٌ ثانٍ متأخّر عن آخر نقطة تفتيش بأكثر من الحدّ المعلن
    const gapMs = h.policy.supervision.restart_gap_max_ms + 500;
    const second = supervisorOn(h, silentProbes(h.policy), now + gapMs);
    second.start(now + gapMs);
    const report = second.report();
    assert.equal(report.restartGapMs, gapMs);
    assert.equal(report.gaps.filter((g) => g.kind === 'restart').length, 1);
    second.stop(OPERATOR, 'انتهى القياس', now + gapMs);
    // إقلاعٌ أول بلا نقطة تفتيش يُعلن غيابًا لا فجوةً صفرية
    const fresh = productionHarness({ now, federate: false });
    try {
      const s = supervisorOn(fresh, silentProbes(fresh.policy), now);
      s.start(now);
      assert.equal(s.report().restartGapMs, null, 'الغياب ليس صفرًا');
      s.stop(OPERATOR, 'انتهى القياس', now);
    } finally { fresh.dispose(); }
  } finally { h.dispose(); }
});

test('نقطة تفتيش عُدّلت من الخارج تُرفض ولا تُقرأ إقلاعًا أول', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const s = supervisorOn(h, silentProbes(h.policy), now);
    s.start(now);
    s.stop(OPERATOR, 'انتهى القياس', now);
    const path = resolveCheckpointPath(h.checkpointDir);
    const file = JSON.parse(readFileSync(path, 'utf8')) as { checkpoint: { at: number } };
    file.checkpoint.at = now - 999999;
    writeFileSync(path, JSON.stringify(file), 'utf8');
    assert.throws(() => new CheckpointStore(path).read(), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'CHECKPOINT_TAMPERED');
      return true;
    });
    writeFileSync(path, '{ليس', 'utf8');
    assert.throws(() => new CheckpointStore(path).read(), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'CHECKPOINT_UNREADABLE');
      return true;
    });
  } finally { h.dispose(); }
});

test('انهيار ماسح خرقٌ مقيَّد لا سلامة — ولا يمنع بقية الماسحات', () => {
  const now = Date.now();
  const base = productionHarness_policy();
  const h = productionHarness({
    now,
    probes: probesWith(silentProbes(base), { [base.scanners[0] as string]: throwingProbe() }),
  });
  try {
    h.supervisor.start(now);
    const report = h.supervisor.report();
    assert.equal(report.failedSweeps >= 1, true);
    assert.equal(countEvent(h.state, 'production_scanner_failed') >= 1, true);
    assert.equal(report.scannerSweeps[base.scanners[0] as string], 0, 'الماسح المنهار لا يُحسب ممسوحًا');
    assert.equal(report.scannerSweeps[base.scanners[1] as string], 1, 'وبقيةُ الماسحات نُوديت');
    assert.equal(h.policy.tolerance.max_failed_sweeps, 0, 'والتسامح صفر — فالخرق يُسقط الحكم');
  } finally { h.dispose(); }
});

test('الشدّة تُقرأ من التهيئة، والحادث الحرج يوقف الدولة بتوقيع حرس التاج', () => {
  const now = Date.now();
  const base = productionHarness_policy();
  const critical = base.severity.critical[0] as string;
  const high = base.severity.high[0] as string;
  const h = productionHarness({
    now,
    probes: probesWith(silentProbes(base), {
      [base.scanners[0] as string]: fakeProbe([
        { kind: high, detail: 'حادث عالٍ مزروع' },
        { kind: critical, detail: 'حادث حرج مزروع' },
      ]),
    }),
  });
  try {
    h.supervisor.start(now);
    const report = h.supervisor.report();
    assert.equal(report.critical, 1);
    assert.equal(report.high, 1);
    assert.equal(report.halted, true);
    assert.equal(h.state.killSwitch.status.engaged, true, 'الحرج يوقف (RULE-007)');
    assert.equal(h.state.audit.find('production_critical_halt').at(-1)?.actor, PRODUCTION_GUARD);
    // ولا يُوقف مرتين: الإيقاف حالةٌ لا حدثٌ متكرر
    h.supervisor.sweep(now + h.policy.supervision.tick_ms);
    assert.equal(countEvent(h.state, 'production_critical_halt'), 1);
  } finally { h.dispose(); }
});

test('الوقف قرارٌ مقيَّد: لا من غير مشغّل، ولا بلا سبب، ولا لمراقبةٍ لم تجرِ', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const s = supervisorOn(h, silentProbes(h.policy), now);
    assert.equal(s.stop(OPERATOR, 'لا مراقبة جارية', now).ok, false);
    s.start(now);
    assert.equal(s.stop(OBSERVER, 'المراقب يوقف', now).ok, false, 'المراقب لا يوقف (RULE-004)');
    assert.equal(s.stop(OPERATOR, 'x', now).ok, false, 'لا وقف بلا سبب معلن');
    assert.equal(s.running, true, 'ورفضُ الوقف لا يوقف');
    assert.equal(s.stop(OPERATOR, 'انتهى القياس المُعلن', now).ok, true);
    assert.equal(s.running, false);
    assert.equal(countEvent(h.state, 'supervision_stop_refused'), 3);
    assert.equal(countEvent(h.state, 'supervision_stopped'), 1);
  } finally { h.dispose(); }
});

test('الاستمرار يُقاس بمؤقّت حقيقي: مسحاتٌ متعدّدة بلا نداءٍ يدوي', async () => {
  const now = Date.now();
  const h = productionHarness({ now, probes: silentProbes(productionHarness_policy()) });
  try {
    const start = Date.now();
    h.supervisor.start(start);
    await sleep(h.policy.supervision.tick_ms * (h.policy.supervision.min_sweeps + 1));
    const report = h.supervisor.report();
    assert.ok(
      report.sweeps >= h.policy.supervision.min_sweeps,
      `مسحاتٌ ${report.sweeps} ≥ الحدّ ${h.policy.supervision.min_sweeps}`,
    );
    assert.equal(report.gaps.filter((g) => g.kind === 'silence').length, 0, 'ولا صمتَ بينها');
  } finally { h.dispose(); }
});
