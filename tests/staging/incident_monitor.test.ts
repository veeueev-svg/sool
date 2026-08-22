/**
 * tests/staging/incident_monitor.test.ts — المراقبة بمؤقّت لا بيد بشرية (المرحلة 36)
 * المالك: ديوان التدقيق | المدخلات: دولة مهيأة + ماسحات حقيقية وصورية
 * المخرجات: إثبات أن الحادث يُكشف بمرور الزمن وحده، وأن الحرج يوقف الدولة
 * التبعيات: IncidentMonitor + buildWatchProbes + RegionMonitor
 * الصلاحيات: القياس فقط | السجلات: incident_monitor_started / staging_tick /
 *   staging_incident / staging_watch_failed / staging_critical_halt
 * حالات الفشل: كلها مغلقة برموز وأحداث معلنة
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0020-limited-operation.md
 * ثوابت الاختبار: 1) القياس الفاصل ينتظر زمنًا حقيقيًّا ولا يُنادي المسح بيد؛
 *   2) الحادث يُقرأ من السجل لا من عائد الدالة وحده؛ 3) الشدّة من التهيئة لا من الاختبار.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncidentMonitor, SovereignViolation, WatchKind, WatchProbe, bootstrapState,
} from '../../src/index';
import { OBSERVER, countEvent, fakeProbe, monitorWith, throwingProbe } from './helpers';

const ROYAL_COURT = 'authority:royal_court';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** إقليم مفوَّض بمقعد حاكم خالٍ — حادث جسيم قائم فعلًا لا علمًا صوريًّا */
function delegatedWithoutGovernor(now: number): ReturnType<typeof bootstrapState> {
  const s = bootstrapState({ now, federation: { vacancyGraceMs: 50 } });
  // الإقليم معلن في config/regions.yaml — لا إقليم يخلق نفسه في اختبار
  const cmd = s.king.issueCommand('amend_policy', 'region:services', { kind: 'federation' }, now);
  s.regions.establish(cmd, { regionId: 'region:services', name: 'إقليم الخدمات', proposedBy: ROYAL_COURT }, now);
  s.regions.delegate(cmd, 'region:services', ['services'], now);
  return s;
}

test('حرس معلن بلا ماسح يُرفض عند البناء — حرسٌ لا يمسح زينةٌ لا مراقبة', () => {
  const s = bootstrapState({ now: Date.now() });
  assert.throws(() => new IncidentMonitor({
    audit: s.audit, killSwitch: s.killSwitch, policy: s.stagingConfig.policy,
    observer: OBSERVER, probes: new Map<WatchKind, WatchProbe>(),
  }), (error: unknown) => {
    assert.equal((error as SovereignViolation).code, 'MONITOR_WATCH_UNPROBED');
    return true;
  });
});

test('مراقب غير جهة المراقبة المعلنة يُرفض عند البناء (RULE-004)', () => {
  const s = bootstrapState({ now: Date.now() });
  assert.throws(() => new IncidentMonitor({
    audit: s.audit, killSwitch: s.killSwitch, policy: s.stagingConfig.policy,
    observer: ROYAL_COURT,
    probes: new Map<WatchKind, WatchProbe>(
      s.stagingConfig.policy.watches.map((w) => [w, fakeProbe([])]),
    ),
  }), (error: unknown) => {
    assert.equal((error as SovereignViolation).code, 'MONITOR_OBSERVER_UNDECLARED');
    return true;
  });
});

test('كل مسحة تُقيَّد staging_tick وتُحصى لكل حرس معلن', () => {
  const s = bootstrapState({ now: Date.now() });
  const monitor = monitorWith(s, new Map<WatchKind, WatchProbe>([['scope', fakeProbe([])]]), {
    watches: ['scope'], runbooks: [...s.stagingConfig.policy.runbooks],
  });
  monitor.tick(1);
  monitor.tick(2);
  const report = monitor.report();
  assert.equal(report.ticks, 2);
  assert.equal(report.watchTicks.scope, 2);
  assert.equal(report.incidents.length, 0);
  assert.equal(countEvent(s, 'staging_tick'), 2);
});

test('انهيار الماسح خرقٌ مقيَّد لا تجاوز صامت — وصمته أخطر من فشله', () => {
  const s = bootstrapState({ now: Date.now() });
  const monitor = monitorWith(s, new Map<WatchKind, WatchProbe>([['scope', throwingProbe()]]), {
    watches: ['scope'],
  });
  monitor.tick(1);
  const report = monitor.report();
  assert.equal(report.failedTicks, 1);
  assert.equal(report.watchTicks.scope, 0);
  assert.equal(countEvent(s, 'staging_watch_failed'), 1);
});

test('الشدّة من التهيئة لا من الماسح: الجسيم لا يوقف والحرج يوقف ويُصعَّد (RULE-007)', () => {
  const s = bootstrapState({ now: Date.now() });
  const high = monitorWith(s, new Map<WatchKind, WatchProbe>([
    ['scope', fakeProbe([{ kind: 'overdue_batch', detail: 'دفعة متأخرة' }])],
  ]), { watches: ['scope'] });
  high.tick(1);
  assert.equal(high.report().high, 1);
  assert.equal(high.report().critical, 0);
  assert.equal(high.report().halted, false);
  assert.equal(s.killSwitch.status.engaged, false);

  const critical = monitorWith(s, new Map<WatchKind, WatchProbe>([
    ['scope', fakeProbe([{ kind: 'scope_violation', detail: 'خرق نطاق' }])],
  ]), { watches: ['scope'] });
  critical.tick(2);
  assert.equal(critical.report().critical, 1);
  assert.equal(critical.report().halted, true);
  assert.equal(s.killSwitch.status.engaged, true);
  assert.equal(countEvent(s, 'staging_critical_halt'), 1);
});

test('قياس فاصل: الحادث القائم يُكشف بمرور الزمن وحده بلا نداء يدوي', async () => {
  const now = Date.now();
  const s = delegatedWithoutGovernor(now);
  // قبل المؤقّت: الحادث قائم والدولة لا تعلمه — هذا ثقب المرحلة المُقاس
  assert.equal(s.regionMonitor.history().length, 0);
  const timed = new IncidentMonitor({
    audit: s.audit, killSwitch: s.killSwitch,
    policy: { ...s.stagingConfig.policy, watches: ['regions'], window: { duration_ms: 400, tick_ms: 60, min_ticks: 3 } },
    observer: OBSERVER,
    probes: new Map<WatchKind, WatchProbe>([['regions', (at) => {
      s.regionMonitor.sweep(at);
      return s.regionMonitor.history().slice(-1)
        .filter((f) => f.kind === 'delegated_without_governor')
        .map((f) => ({ kind: 'authority_without_holder' as const, detail: f.detail }));
    }]]),
  });
  timed.start();
  timed.start(); // البدء مرتين لا يُشغّل مؤقّتين
  assert.equal(timed.running, true);
  assert.equal(countEvent(s, 'incident_monitor_started'), 1);
  await sleep(260);
  timed.stop();
  assert.equal(timed.running, false);
  assert.equal(countEvent(s, 'incident_monitor_stopped'), 1);
  const report = timed.report();
  assert.equal(report.ticks >= 3, true, `عدد المسحات ${report.ticks}`);
  assert.equal(report.incidents.length >= 1, true);
  assert.equal(report.incidents[0]?.kind, 'authority_without_holder');
  assert.equal(s.regionMonitor.history().length >= 1, true);
});

test('ماسحات الدولة الحقيقية كلها مبنية ولا تُقيّد حادثًا على دولة سليمة', () => {
  const s = bootstrapState({ now: Date.now() });
  for (const watch of s.stagingConfig.policy.watches) {
    assert.equal(typeof watch, 'string');
  }
  s.incidentMonitor.tick(Date.now());
  const report = s.incidentMonitor.report();
  assert.equal(report.failedTicks, 0);
  assert.equal(report.critical, 0);
  for (const watch of s.stagingConfig.policy.watches) {
    assert.equal(report.watchTicks[watch], 1, `الحرس ${watch} لم يمسح`);
  }
});
