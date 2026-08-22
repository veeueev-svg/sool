/**
 * tests/chaos/chaos_drill.test.ts — تمرين الانقطاع (المرحلة 34)
 * المالك: ديوان التدقيق | المدخلات: مِجَسّات قطع | المخرجات: قياس لكل قطع وحكم جامع
 * التبعيات: ChaosDrill + FaultInjector + SafeStopLedger + مفتاح الإيقاف
 * الصلاحيات: القطع والقياس والتصعيد فقط — لا اعتماد أمر ولا إيقاف دولة ولا رفع سقف
 * السجلات: chaos_drill_* و chaos_probe_registered و chaos_cut_measured
 * حالات الفشل: جهة غير مصرَّح لها، دولة غير طبيعية، قطع بلا مِجَسّ، تداخل قطوع
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت الاختبار: 1) لا قطع عن دولة مقطوعة أصلًا؛ 2) لا قطعان معًا؛
 *                  3) الحكم على ما أعلنته التهيئة لا على ما قِيس.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChaosDrill, CutProbe, FaultInjector, SafeStopLedger, matchEffects,
} from '../../src/index';
import {
  T0, chaosHarness, countEvent, dummySeam, hasEvent, lastDetail,
} from './helpers';

/** مِجَسّ صوري معلن أنه صوري: يُقيس بلا وحدات، للاختبارات السلبية والبوابات */
function dummyProbe(kind: CutProbe['kind'], options: {
  proceeded?: boolean; refusalCode?: string | null; danglingLeases?: number;
  auditIntact?: boolean; modeAfter?: 'full' | 'limited' | 'halted'; declaredStop?: boolean;
  healsTo?: boolean;
} = {}): CutProbe & { attempts: number; measures: number; counters: { cuts: number; heals: number } } {
  const seam = dummySeam(kind, { healsTo: options.healsTo });
  const probe = {
    kind,
    seam,
    counters: seam,
    attempts: 0,
    measures: 0,
    attempt(): { proceeded: boolean; refusalCode: string | null } {
      probe.attempts += 1;
      return {
        proceeded: options.proceeded ?? false,
        refusalCode: options.refusalCode === undefined ? 'CHANNEL_PERSIST_FAILED' : options.refusalCode,
      };
    },
    measure(): ReturnType<CutProbe['measure']> {
      probe.measures += 1;
      return {
        effects: matchEffects({ effects: ['c1'], records: [{ commandId: 'c1', status: 'executed' }] }),
        danglingLeases: options.danglingLeases ?? 0,
        auditIntact: options.auditIntact ?? true,
        modeAfter: options.modeAfter ?? 'limited',
        declaredStop: options.declaredStop ?? true,
      };
    },
  };
  return probe;
}

test('التمرين يُعلن نفسه في السجل بأرقام تهيئته لا بأرقام مكتوبة فيه', () => {
  const h = chaosHarness();
  const detail = lastDetail(h.s, 'chaos_drill_online');
  assert.deepEqual(detail.faults, [...h.policy.faults]);
  assert.equal(detail.probeCommands, h.policy.probe_commands);
  assert.equal(detail.deadlineMs, h.policy.safe_stop_deadline_ms);
  assert.equal(detail.fallbackMode, h.policy.fallback_mode);
});

test('تسجيل مِجَسّ يُسجِّل مقعده في الحاقن ويُسجَّل باسمه', () => {
  const h = chaosHarness();
  assert.equal(h.drill.registerProbe(h.authority, dummyProbe('network')).ok, true);
  assert.deepEqual([...h.injector.registered()], ['network']);
  assert.equal(countEvent(h.s, 'chaos_probe_registered'), 1);
});

test('تسجيل مِجَسّ من غير جهة التهيئة ⇒ CHAOS_PROBE_UNAUTHORIZED', () => {
  const h = chaosHarness();
  const out = h.drill.registerProbe('identity:king', dummyProbe('network'));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAOS_PROBE_UNAUTHORIZED');
  assert.equal(lastDetail(h.s, 'chaos_drill_refused').code, 'CHAOS_PROBE_UNAUTHORIZED');
});

test('مِجَسّ نوعه يخالف نوع مقعده ⇒ CHAOS_PROBE_SEAM_MISMATCH', () => {
  const h = chaosHarness();
  const probe = { ...dummyProbe('network'), kind: 'disk' as const };
  const out = h.drill.registerProbe(h.authority, probe);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAOS_PROBE_SEAM_MISMATCH');
});

test('تسجيل مِجَسّ مرتين ⇒ CHAOS_PROBE_ALREADY_REGISTERED', () => {
  const h = chaosHarness();
  h.drill.registerProbe(h.authority, dummyProbe('network'));
  const out = h.drill.registerProbe(h.authority, dummyProbe('network'));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAOS_PROBE_ALREADY_REGISTERED');
});

test('قطع من غير جهة التهيئة ⇒ CHAOS_DRILL_UNAUTHORIZED ولا حقن', () => {
  const h = chaosHarness();
  const probe = dummyProbe('network');
  h.drill.registerProbe(h.authority, probe);
  const out = h.drill.cut('agent:rogue', 'network', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_DRILL_UNAUTHORIZED');
  assert.equal(probe.attempts, 0);
  assert.equal(countEvent(h.s, 'fault_injected'), 0);
});

test('الإيقاف مُشتغل ⇒ CHAOS_DRILL_HALTED: لا يُقطع عن دولة موقوفة', () => {
  const h = chaosHarness();
  h.drill.registerProbe(h.authority, dummyProbe('network'));
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'إيقاف معلن قبل التمرين');
  const out = h.drill.cut(h.authority, 'network', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_DRILL_HALTED');
});

test('دولة غير طبيعية ⇒ CHAOS_DRILL_STATE_NOT_NORMAL: لا يُنسب توقفها إلى القطع', () => {
  const h = chaosHarness();
  const drill = new ChaosDrill({
    audit: h.s.audit,
    killSwitch: h.s.killSwitch,
    injector: new FaultInjector({ audit: h.s.audit, policy: h.policy }),
    ledger: new SafeStopLedger({ audit: h.s.audit, policy: h.policy }),
    policy: h.policy,
    mode: () => 'protective',
  });
  drill.registerProbe(h.authority, dummyProbe('network'));
  const out = drill.cut(h.authority, 'network', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_DRILL_STATE_NOT_NORMAL');
});

test('قطع بلا مِجَسّ ⇒ CHAOS_PROBE_MISSING، ويظهر في الحكم غير مقيس', () => {
  const h = chaosHarness();
  const out = h.drill.cut(h.authority, 'disk', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_PROBE_MISSING');
  assert.equal(h.ledger.judge('disk').breaches.includes('CHAOS_CUT_NOT_OBSERVED'), true);
});

test('قطع كامل: إعلان ثم حقن ثم فعل ثم قياس ثم عودة ثم قيد', () => {
  const h = chaosHarness();
  const probe = dummyProbe('network');
  h.drill.registerProbe(h.authority, probe);
  const out = h.drill.cut(h.authority, 'network', T0);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(probe.counters.cuts, 1);
  assert.equal(probe.attempts, 1, 'لا قطع بلا فعل سيادي تحته');
  assert.equal(probe.measures, 1);
  assert.equal(probe.counters.heals, 1);
  assert.equal(out.report.restored, true);
  assert.equal(out.report.refusalCode, 'CHANNEL_PERSIST_FAILED');
  assert.deepEqual([...h.injector.activeFaults()], [], 'العودة قبل القطع التالي');
  assert.equal(countEvent(h.s, 'chaos_drill_started'), 1);
  assert.equal(countEvent(h.s, 'chaos_cut_measured'), 1);
});

test('قطع لم تُثبَت عودته ⇒ restored=false وخرق CHAOS_CUT_NOT_RESTORED', () => {
  const h = chaosHarness();
  h.drill.registerProbe(h.authority, dummyProbe('network', { healsTo: false }));
  const out = h.drill.cut(h.authority, 'network', T0);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.restored, false);
  assert.ok(h.ledger.judge('network').breaches.includes('CHAOS_CUT_NOT_RESTORED'));
  assert.equal(hasEvent(h.s, 'fault_restore_unverified'), true);
});

test('قطع ثانٍ قبل عودة الأول ⇒ CHAOS_CUT_OVERLAP', () => {
  const h = chaosHarness();
  h.drill.registerProbe(h.authority, dummyProbe('network', { healsTo: false }));
  h.drill.registerProbe(h.authority, dummyProbe('power'));
  h.drill.cut(h.authority, 'network', T0); // بقي نشطًا لأن عودته لم تُثبت
  const out = h.drill.cut(h.authority, 'power', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_CUT_OVERLAP');
});

test('التمرين الكامل يقطع كل ما أعلنته التهيئة ويحكم حكمًا واحدًا', () => {
  const h = chaosHarness();
  const probes = h.policy.faults.map((kind) => dummyProbe(kind));
  for (const probe of probes) h.drill.registerProbe(h.authority, probe);
  const out = h.drill.run(h.authority, T0);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.verdict, 'pass');
  assert.equal(out.report.observed, h.policy.faults.length);
  for (const probe of probes) assert.equal(probe.attempts, 1);
  assert.equal(countEvent(h.s, 'chaos_drill_report'), 1);
});

test('فشل قطع لا يوقف بقية القطوع: التقرير أصدق لا أقصر', () => {
  const h = chaosHarness();
  // مِجَسّ الشبكة يمضي تحت القطع (خرق)، والبقية سليمة — الحكم يُظهر الاثنين
  h.drill.registerProbe(h.authority, dummyProbe('network', { proceeded: true, refusalCode: null }));
  for (const kind of h.policy.faults.filter((f) => f !== 'network')) {
    h.drill.registerProbe(h.authority, dummyProbe(kind));
  }
  const out = h.drill.run(h.authority, T0);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.verdict, 'fail');
  assert.equal(out.report.observed, h.policy.faults.length, 'كل القطوع قِيست');
  assert.ok(out.report.breaches.includes('network:CHAOS_SILENT_CONTINUATION'));
  assert.equal(out.report.breaches.length, 1, 'خرق واحد لا يُلوّث بقية الأحكام');
  assert.equal(hasEvent(h.s, 'escalated_to_king'), true);
});

test('التمرين لا يوقف الدولة ولا يرفع سقفًا: الوضع بعده كما كان', () => {
  const h = chaosHarness();
  const modeBefore = h.s.gateway.mode;
  for (const kind of h.policy.faults) h.drill.registerProbe(h.authority, dummyProbe(kind));
  h.drill.run(h.authority, T0);
  assert.equal(h.s.gateway.mode, modeBefore);
  assert.equal(h.s.killSwitch.status.engaged, false);
  assert.equal(h.s.continuity.current.mode, 'full', 'دولة القياس لم تُقطع');
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});

test('التمرين الكامل من غير الجهة ⇒ رفض قبل أي حقن', () => {
  const h = chaosHarness();
  for (const kind of h.policy.faults) h.drill.registerProbe(h.authority, dummyProbe(kind));
  const out = h.drill.run('agent:rogue', T0);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, 'CHAOS_DRILL_UNAUTHORIZED');
  assert.equal(countEvent(h.s, 'fault_injected'), 0);
});
