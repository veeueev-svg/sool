/**
 * tests/crown/king_monitor.test.ts — اختبار قبول المرحلة 8 (مؤقّت حقيقي)
 * المالك: حرس التاج | يوثّق في: docs/test-reports/phase-05-09.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { RoyalHeartbeat } from '../../src/crown/royal_heartbeat';
import { KingMonitor } from '../../src/crown/king_monitor';
import { KillSwitch } from '../../src/security/kill_switch';
import { StateMode } from '../../src/kernel/types';

const KING = 'king:sool:001';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('المؤقّت الحقيقي يدخل حالة الحماية بلا تدخّل خارجي', async () => {
  const audit = new AppendOnlyLog();
  const hb = new RoyalHeartbeat(audit, KING, 30, Date.now());
  const seen: StateMode[] = [];
  const monitor = new KingMonitor(audit, hb, { tickMs: 5 }, (m) => seen.push(m));

  monitor.start();
  assert.equal(monitor.running, true);
  await sleep(120);
  monitor.stop();

  assert.ok(monitor.tickCount >= 3, 'المؤقّت نبض فعليًا');
  assert.equal(monitor.currentMode, 'protective');
  assert.ok(seen.includes('protective'));
  assert.equal(audit.find('king_absence_detected').length, 1);
});

test('نبضة الملك تُعيد الدولة إلى الوضع الطبيعي وتُغلق نوبة الغياب', () => {
  const audit = new AppendOnlyLog();
  const t0 = 1_000_000;
  const hb = new RoyalHeartbeat(audit, KING, 100, t0);
  const monitor = new KingMonitor(audit, hb, { tickMs: 1000 });

  assert.equal(monitor.tick(t0 + 50), 'normal');
  assert.equal(monitor.tick(t0 + 500), 'protective');
  hb.beat(KING, t0 + 600);
  assert.equal(monitor.tick(t0 + 610), 'normal');

  const report = monitor.report();
  assert.equal(report.length, 1);
  assert.equal(report[0]!.endedAt, t0 + 610);
  assert.equal(report[0]!.durationMs, 110);
  assert.equal(audit.find('king_presence_restored').length, 1);
});

test('كل نوبة غياب تُسجَّل منفصلة بمدتها', () => {
  const audit = new AppendOnlyLog();
  const t0 = 2_000_000;
  const hb = new RoyalHeartbeat(audit, KING, 100, t0);
  const monitor = new KingMonitor(audit, hb, { tickMs: 1000 });

  monitor.tick(t0 + 300);          // غياب 1
  hb.beat(KING, t0 + 400);
  monitor.tick(t0 + 410);          // عودة
  monitor.tick(t0 + 900);          // غياب 2
  hb.beat(KING, t0 + 950);
  monitor.tick(t0 + 960);          // عودة

  const report = monitor.report();
  assert.equal(report.length, 2);
  assert.ok(report.every((e) => e.durationMs !== null && e.durationMs > 0));
});

test('الغياب الممتد فوق العتبة يُصعَّد ويُشغّل إيقافًا وقائيًا', () => {
  const audit = new AppendOnlyLog();
  const t0 = 3_000_000;
  const hb = new RoyalHeartbeat(audit, KING, 100, t0);
  const kill = new KillSwitch(audit, KING);
  const monitor = new KingMonitor(audit, hb, { tickMs: 1000, maxAbsenceMs: 500, killSwitch: kill });

  monitor.tick(t0 + 200);   // بدء الغياب
  assert.equal(kill.status.engaged, false);
  monitor.tick(t0 + 800);   // الغياب تجاوز 500ms من بدايته
  assert.equal(kill.status.engaged, true);
  assert.equal(kill.status.scope, 'agents');
  assert.equal(audit.find('king_absence_escalated').length, 1);

  monitor.tick(t0 + 1500);  // لا تصعيد مكرر لنفس النوبة
  assert.equal(audit.find('king_absence_escalated').length, 1);
});

test('تعذّر تقييم النبض يُعامل غيابًا لا حضورًا (فشل مغلق)', () => {
  const audit = new AppendOnlyLog();
  const broken = {
    evaluate: () => { throw new Error('تعذّر قراءة النبض'); },
    mode: () => 'normal' as StateMode,
    isPresent: () => true,
    beat: () => undefined,
    lastBeatAt: 1000,
  } as unknown as RoyalHeartbeat;
  const monitor = new KingMonitor(audit, broken, { tickMs: 1000 });
  assert.equal(monitor.tick(1100), 'protective');
});

test('إيقاف المراقب يُسجَّل ولا يترك مؤقّتًا معلّقًا', async () => {
  const audit = new AppendOnlyLog();
  const hb = new RoyalHeartbeat(audit, KING, 10_000, Date.now());
  const monitor = new KingMonitor(audit, hb, { tickMs: 5 });
  monitor.start();
  await sleep(30);
  monitor.stop();
  assert.equal(monitor.running, false);
  assert.equal(audit.find('king_monitor_stopped').length, 1);
});
