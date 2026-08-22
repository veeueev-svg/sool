/**
 * tests/chaos/channel_durability.test.ts — صمود قناة الأوامر عند قطع القرص (المرحلة 34، البند T-90)
 * المالك: ديوان التدقيق | المدخلات: قناة أوامر على قرص يُعطَّل فعلًا | المخرجات: رفض موثَّق لا أثر معلَّق
 * التبعيات: CommandChannel + سجل التدقيق + بوابة التاج
 * الصلاحيات: لا شيء غير الإدراج والمعالجة | السجلات: command_channel_persist_failed، command_channel_reconciled
 * حالات الفشل: فشل الحفظ في الإدراج ⇒ لا سجل شبح؛ في النية ⇒ لا تنفيذ؛ في المصير ⇒ تصعيد لا صمت
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت الاختبار: 1) الأثر لا يسبق النية المحفوظة؛ 2) لا تنفيذ مزدوج بعد العودة؛
 *                  3) السجل المُلحَق أعلى من اللقطة القابلة للكتابة (RULE-006).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  CHANNEL_PERSIST_FAILED, CHANNEL_RECONCILED_FROM_AUDIT, CHANNEL_RESTORE_FAILED, CommandChannel,
} from '../../src/index';
import { T0, Victim, countEvent, lastDetail } from './helpers';

/**
 * تعطيل القرص تعطيلًا حقيقيًا: يُحذف ملف اللقطة ويُنشأ مجلد باسمه، فتفشل الكتابة
 * بـ EISDIR أيًّا كان المستخدم — لا يُعتمد على منع الصلاحيات لأن الجذر يتجاوزه.
 */
function cutDisk(victim: Victim): void {
  rmSync(victim.statePath, { force: true });
  mkdirSync(victim.statePath, { recursive: true });
}

function healDisk(victim: Victim, snapshot: string | null): void {
  rmSync(victim.statePath, { recursive: true, force: true });
  if (snapshot !== null) writeFileSync(victim.statePath, snapshot, 'utf8');
}

test('فشل الحفظ في الإدراج ⇒ رفض برمزه ولا سجل شبح في الذاكرة ولا على القرص', () => {
  const v = new Victim('durability-submit');
  v.runOne();
  const snapshot = readFileSync(v.statePath, 'utf8');
  cutDisk(v);
  const ghost = v.issue();
  assert.throws(() => v.live.submit(ghost), (error: unknown) => {
    assert.ok((error as Error).message.startsWith(CHANNEL_PERSIST_FAILED));
    return true;
  });
  assert.equal(v.live.statusOf(ghost.payload.commandId), null, 'لا سجل شبح في الذاكرة');
  assert.equal(lastDetail(v.s, 'command_channel_persist_failed').stage, 'submit');
  healDisk(v, snapshot);
  const rebuilt = v.rebuild();
  assert.equal(rebuilt.statusOf(ghost.payload.commandId), null, 'ولا على القرص');
  assert.equal(rebuilt.list().length, 1);
});

test('لا يُلحق command_enqueued إلا بعد ثبوت الإدراج على القرص', () => {
  const v = new Victim('durability-enqueue');
  const before = countEvent(v.s, 'command_enqueued');
  v.runOne();
  assert.equal(countEvent(v.s, 'command_enqueued'), before + 1);
  const snapshot = readFileSync(v.statePath, 'utf8');
  cutDisk(v);
  assert.throws(() => v.live.submit(v.issue()));
  assert.equal(countEvent(v.s, 'command_enqueued'), before + 1, 'لا إدراج مُعلن بلا أثر محفوظ');
  healDisk(v, snapshot);
});

test('فشل حفظ النية ⇒ المنفّذ لم يُشغَّل قطعًا، والمحاولة لم تُحتسب', () => {
  const v = new Victim('durability-intent');
  const command = v.issue();
  v.live.submit(command);
  const snapshot = readFileSync(v.statePath, 'utf8');
  const attemptsBefore = v.live.attemptsOf(command.payload.commandId);
  cutDisk(v);
  assert.throws(() => v.live.process(v.executor, T0), (error: unknown) => {
    assert.ok((error as Error).message.startsWith(CHANNEL_PERSIST_FAILED));
    return true;
  });
  assert.deepEqual(v.effects, [], 'لا أثر في العالم قبل ثبوت النية');
  assert.equal(v.live.attemptsOf(command.payload.commandId), attemptsBefore, 'المحاولة أُرجعت');
  assert.equal(lastDetail(v.s, 'command_channel_persist_failed').stage, 'intent');
  healDisk(v, snapshot);
});

test('فشل حفظ النية يُصعَّد إلى الملك ولا يُسكَت', () => {
  const v = new Victim('durability-escalate');
  const command = v.issue();
  v.live.submit(command);
  const snapshot = readFileSync(v.statePath, 'utf8');
  const before = countEvent(v.s, 'escalated_to_king');
  cutDisk(v);
  assert.throws(() => v.live.process(v.executor, T0));
  assert.equal(countEvent(v.s, 'escalated_to_king'), before + 1);
  assert.equal(v.s.audit.verifyIntegrity().valid, true, 'السلسلة سليمة رغم القطع');
  healDisk(v, snapshot);
});

test('الأمر المعلَّق بعد فشل النية يُعالَج سليمًا حين يعود القرص — مرة واحدة', () => {
  const v = new Victim('durability-retry');
  const command = v.issue();
  v.live.submit(command);
  const snapshot = readFileSync(v.statePath, 'utf8');
  cutDisk(v);
  assert.throws(() => v.live.process(v.executor, T0));
  healDisk(v, snapshot);
  const rebuilt = v.rebuild();
  rebuilt.process(v.executor, T0);
  assert.deepEqual(v.effects, [command.payload.commandId]);
  assert.equal(rebuilt.statusOf(command.payload.commandId), 'executed');
  assert.equal(v.measure().effects.sound, true);
});

test('فشل حفظ المصير: الأثر وقع فعلًا فلا تراجع — تصعيد ورفض بلا كذب', () => {
  const v = new Victim('durability-outcome');
  const command = v.issue();
  v.live.submit(command);
  const escalations = countEvent(v.s, 'escalated_to_king');
  const snapshot = readFileSync(v.statePath, 'utf8');
  // النية تُحفظ ثم يُعطَّل القرص من داخل المنفّذ، فيفشل حفظ المصير وحده
  assert.throws(() => v.live.process((cmd) => {
    v.effects.push(cmd.payload.commandId);
    cutDisk(v);
  }, T0));
  assert.deepEqual(v.effects, [command.payload.commandId], 'الأثر وقع ولا يُنكَر');
  assert.equal(lastDetail(v.s, 'command_channel_persist_failed').stage, 'outcome');
  assert.equal(countEvent(v.s, 'escalated_to_king'), escalations + 1);
  healDisk(v, snapshot);
});

test('العودة تُصالِح اللقطة على السجل: منفَّذ في السجل لا يُنفَّذ ثانيًا', () => {
  const v = new Victim('durability-reconcile');
  const command = v.issue();
  v.live.submit(command);
  const snapshot = readFileSync(v.statePath, 'utf8'); // لقطة تقول «معلَّق»
  v.live.process(v.executor, T0); // نُفِّذ فعلًا وأُلحق في السجل
  assert.equal(v.live.statusOf(command.payload.commandId), 'executed');
  // ثم تعود اللقطة القديمة كما يحدث حين يُفقد آخر حفظ
  writeFileSync(v.statePath, snapshot, 'utf8');
  const rebuilt = v.rebuild();
  assert.equal(rebuilt.statusOf(command.payload.commandId), 'executed', 'السجل أعلى من اللقطة');
  const record = rebuilt.list().find((r) => r.commandId === command.payload.commandId);
  assert.equal(record?.lastError, CHANNEL_RECONCILED_FROM_AUDIT);
  rebuilt.process(v.executor, T0);
  assert.deepEqual(v.effects, [command.payload.commandId], 'لا تنفيذ مزدوج بعد العودة');
  assert.equal(v.measure().effects.doubleExecuted.length, 0);
});

test('المصالحة تُعلن نفسها في السجل بعددها ومعرّفاتها', () => {
  const v = new Victim('durability-reconcile-audit');
  const command = v.issue();
  v.live.submit(command);
  const snapshot = readFileSync(v.statePath, 'utf8');
  v.live.process(v.executor, T0);
  writeFileSync(v.statePath, snapshot, 'utf8');
  v.rebuild();
  const detail = lastDetail(v.s, 'command_channel_reconciled');
  assert.equal(detail.count, 1);
  assert.deepEqual(detail.commandIds, [command.payload.commandId]);
});

test('لا مصالحة حين لا حاجة إليها: لا حدث ولا تغيير حالات', () => {
  const v = new Victim('durability-no-reconcile');
  const id = v.runOne();
  const before = countEvent(v.s, 'command_channel_reconciled');
  const rebuilt = v.rebuild();
  assert.equal(countEvent(v.s, 'command_channel_reconciled'), before);
  assert.equal(rebuilt.statusOf(id), 'executed');
  assert.equal(rebuilt.list().length, 1);
});

test('مسار حالة لا يُقرأ ⇒ CHANNEL_RESTORE_FAILED عند البناء لا خطأ نظام خامًا', () => {
  const v = new Victim('durability-birth');
  const statePath = `${v.statePath}.locked`;
  mkdirSync(statePath, { recursive: true });
  assert.throws(() => new CommandChannel(v.s.audit, v.s.gateway, statePath), (error: unknown) => {
    assert.ok((error as Error).message.startsWith(CHANNEL_RESTORE_FAILED));
    return true;
  });
  assert.equal(existsSync(statePath), true, 'لم يُحذف شيء أثناء الرفض');
  rmSync(statePath, { recursive: true, force: true });
});

test('يوميّة بلا لقطة ⇒ رفض عند البناء: أثرٌ بلا أصل لا يُخمَّن', () => {
  const v = new Victim('durability-orphan-journal');
  const statePath = `${v.statePath}.orphan`;
  writeFileSync(`${statePath}.journal`, '{}\n', 'utf8');
  assert.throws(() => new CommandChannel(v.s.audit, v.s.gateway, statePath));
  rmSync(`${statePath}.journal`, { force: true });
});
