/**
 * tests/load/load_ledger.test.ts — دفتر الحمل: مصير معلن ومطابقة لا تُصلِح (المرحلة 33)
 * المالك: ديوان التدقيق | المدخلات: إدراجات ومصائر ومشاهدات قناة | المخرجات: تقرير مطابقة
 * التبعيات: LoadLedger + سجل التدقيق | الصلاحيات: قياس لا اعتماد
 * السجلات: load_command_declared / load_command_settled / load_reconciled / load_loss_detected
 * حالات الفشل: مصير بلا إدراج، مصير ثانٍ، فقد، اختلاف دفترين — كلها معلنة لا مُسوّاة
 * اختبار القبول: tests/load/load_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت الاختبار: 1) الفقد لا يُرخَّص؛ 2) لا مصير من العدم؛ 3) المطابقة تُعلن ولا تُصلِح.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadLedger } from '../../src/index';
import { countEvent, hasEvent, ledgerOnly, lastDetail } from './helpers';

test('يُدرج أمرًا ويُسجّل الإدراج', () => {
  const { s, ledger } = ledgerOnly();
  assert.equal(ledger.declare('cmd:1'), true);
  assert.equal(ledger.declaredCount, 1);
  assert.equal(countEvent(s, 'load_command_declared'), 1);
});

test('يرفض معرّف أمر فارغ ولا يُنشئ سجلًا', () => {
  const { s, ledger } = ledgerOnly();
  assert.equal(ledger.declare(''), false);
  assert.equal(ledger.declaredCount, 0);
  assert.equal(lastDetail(s, 'load_command_duplicate_declaration').reason, 'LOAD_COMMAND_ID_EMPTY');
});

test('يرفض الإدراج المكرر ولا يضاعف العدد', () => {
  const { s, ledger } = ledgerOnly();
  ledger.declare('cmd:1');
  assert.equal(ledger.declare('cmd:1'), false);
  assert.equal(ledger.declaredCount, 1);
  assert.equal(countEvent(s, 'load_command_duplicate_declaration'), 1);
});

test('يثبّت مصير أمر مُدرج ويعيده', () => {
  const { s, ledger } = ledgerOnly();
  ledger.declare('cmd:1');
  assert.equal(ledger.settle('cmd:1', 'executed'), true);
  assert.equal(ledger.fateOf('cmd:1'), 'executed');
  assert.equal(countEvent(s, 'load_command_settled'), 1);
});

test('لا مصير لأمر غير مُدرج — لا يُنشأ سجل من العدم', () => {
  const { s, ledger } = ledgerOnly();
  assert.equal(ledger.settle('cmd:ghost', 'executed'), false);
  assert.equal(ledger.declaredCount, 0);
  assert.equal(countEvent(s, 'load_settlement_unknown_command'), 1);
});

test('لا مصير ثانٍ لأمر مستقرّ، والأول يبقى', () => {
  const { s, ledger } = ledgerOnly();
  ledger.declare('cmd:1');
  ledger.settle('cmd:1', 'denied');
  assert.equal(ledger.settle('cmd:1', 'executed'), false);
  assert.equal(ledger.fateOf('cmd:1'), 'denied');
  assert.equal(lastDetail(s, 'load_settlement_repeated').kept, 'denied');
});

test('مصير أمر غير مُدرج يبقى null', () => {
  const { ledger } = ledgerOnly();
  assert.equal(ledger.fateOf('cmd:absent'), null);
});

test('المُدرج بلا مصير مصيره null لا executed', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('cmd:1');
  assert.equal(ledger.fateOf('cmd:1'), null);
});

test('سقف فقد غير صحيح يمنع بناء الدفتر أصلًا', () => {
  const { s } = ledgerOnly();
  assert.throws(
    () => new LoadLedger({ audit: s.audit, authority: 'authority:audit_bureau', maxLoss: -1 }),
    /LOAD_LEDGER_MAX_LOSS_INVALID/,
  );
  assert.throws(
    () => new LoadLedger({ audit: s.audit, authority: 'authority:audit_bureau', maxLoss: 1.5 }),
    /LOAD_LEDGER_MAX_LOSS_INVALID/,
  );
});

test('مطابقة تامة: صفر فقد وصفر اختلاف وتقرير سليم', () => {
  const { s, ledger } = ledgerOnly();
  for (const id of ['a', 'b', 'c']) { ledger.declare(id); ledger.settle(id, 'executed'); }
  const report = ledger.reconcile([
    { commandId: 'a', status: 'executed' }, { commandId: 'b', status: 'executed' },
    { commandId: 'c', status: 'executed' },
  ]);
  assert.equal(report.declared, 3);
  assert.equal(report.settled, 3);
  assert.equal(report.observed, 3);
  assert.equal(report.lost, 0);
  assert.equal(report.mismatches.length, 0);
  assert.equal(report.sound, true);
  assert.equal(hasEvent(s, 'load_reconciled'), true);
});

test('التقرير يفصّل المصائر الثلاثة كلًا باسمه', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('a'); ledger.settle('a', 'executed');
  ledger.declare('b'); ledger.settle('b', 'denied');
  ledger.declare('c'); ledger.settle('c', 'failed');
  const report = ledger.reconcile([
    { commandId: 'a', status: 'executed' }, { commandId: 'b', status: 'denied' },
    { commandId: 'c', status: 'failed' },
  ]);
  assert.deepEqual(report.byFate, { executed: 1, denied: 1, failed: 1 });
});

test('مُدرج لا سجل له في القناة يُحتسب فقدًا باسمه', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('a'); ledger.settle('a', 'executed');
  ledger.declare('b');
  const report = ledger.reconcile([{ commandId: 'a', status: 'executed' }]);
  assert.equal(report.lost, 1);
  assert.equal(report.mismatches.some((m) => m.code === 'BOOK_WITHOUT_COMMAND'), true);
  assert.equal(report.sound, false);
});

test('سجل في القناة بلا إدراج في الدفتر اختلافٌ معلن', () => {
  const { ledger } = ledgerOnly();
  const report = ledger.reconcile([{ commandId: 'ghost', status: 'executed' }]);
  assert.equal(report.mismatches.some((m) => m.code === 'COMMAND_WITHOUT_BOOK'), true);
  assert.equal(report.sound, false);
});

test('سجل بقي معلّقًا يُحتسب فقدًا لا نجاحًا', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('a');
  const report = ledger.reconcile([{ commandId: 'a', status: 'pending' }]);
  assert.equal(report.pendingInChannel, 1);
  assert.equal(report.lost, 1);
  assert.equal(report.sound, false);
});

test('معلّق في القناة ومستقرّ في الدفتر تناقضٌ باسمه', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('a'); ledger.settle('a', 'executed');
  const report = ledger.reconcile([{ commandId: 'a', status: 'pending' }]);
  assert.equal(report.mismatches.some((m) => m.code === 'SETTLED_WHILE_PENDING'), true);
});

test('مصير نهائي في القناة بلا مصير في الدفتر يُكشف', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('a');
  const report = ledger.reconcile([{ commandId: 'a', status: 'executed' }]);
  assert.equal(report.mismatches.some((m) => m.code === 'UNSETTLED_TERMINAL'), true);
  assert.equal(report.sound, false);
});

test('اختلاف المصير بين الدفترين لا يُرجَّح فيه طرف', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('a'); ledger.settle('a', 'executed');
  const report = ledger.reconcile([{ commandId: 'a', status: 'failed' }]);
  assert.equal(report.mismatches.some((m) => m.code === 'FATE_MISMATCH'), true);
  assert.equal(ledger.fateOf('a'), 'executed', 'المطابقة لا تُصلِح أحد الطرفين');
});

test('سجل قناة مكرر يُكشف ولا يُحتسب مرتين', () => {
  const { ledger } = ledgerOnly();
  ledger.declare('a'); ledger.settle('a', 'executed');
  const report = ledger.reconcile([
    { commandId: 'a', status: 'executed' }, { commandId: 'a', status: 'executed' },
  ]);
  assert.equal(report.observed, 1);
  assert.equal(report.mismatches.some((m) => m.code === 'DUPLICATE_CHANNEL_RECORD'), true);
});

test('الفقد غير السليم يُصعَّد إلى الملك ولا يُسوّى صامتًا', () => {
  const { s, ledger } = ledgerOnly();
  ledger.declare('a');
  ledger.reconcile([]);
  assert.equal(hasEvent(s, 'load_loss_detected'), true);
  assert.equal(hasEvent(s, 'escalated_to_king'), true);
});

test('التقرير السليم لا يُصعَّد', () => {
  const { s, ledger } = ledgerOnly();
  ledger.declare('a'); ledger.settle('a', 'executed');
  ledger.reconcile([{ commandId: 'a', status: 'executed' }]);
  assert.equal(hasEvent(s, 'load_loss_detected'), false);
});

test('سقف الفقد المرفوع يغيّر الحكم فعلًا — التهيئة تُقرأ لا تُزيَّن', () => {
  const strict = ledgerOnly(0);
  strict.ledger.declare('a');
  assert.equal(strict.ledger.reconcile([]).sound, false);
  const lax = ledgerOnly(1);
  lax.ledger.declare('a');
  const report = lax.ledger.reconcile([]);
  assert.equal(report.lost, 1);
  assert.equal(report.maxLoss, 1);
  assert.equal(report.sound, false, 'الاختلاف يبقى خللًا ولو اتّسع سقف الفقد');
});

test('الفقد يُقارن بـ > لا بـ >= : الفقد المساوي للسقف لا يُنجّح وحده', () => {
  const { ledger } = ledgerOnly(2);
  ledger.declare('a'); ledger.declare('b');
  const report = ledger.reconcile([]);
  assert.equal(report.lost, 2);
  assert.equal(report.maxLoss, 2);
  assert.equal(report.mismatches.length, 2, 'كل مفقود يحمل اسمه');
});

test('كل مطابقة تُسجَّل مرة واحدة بأرقامها', () => {
  const { s, ledger } = ledgerOnly();
  ledger.declare('a'); ledger.settle('a', 'executed');
  ledger.reconcile([{ commandId: 'a', status: 'executed' }]);
  assert.equal(countEvent(s, 'load_reconciled'), 1);
  assert.equal(lastDetail(s, 'load_reconciled').declared, 1);
});

test('دفتر فارغ ومطابقة فارغة: سليم بلا ادعاء عمل', () => {
  const { ledger } = ledgerOnly();
  const report = ledger.reconcile([]);
  assert.equal(report.declared, 0);
  assert.equal(report.sound, true);
  assert.equal(report.settled, 0);
});

test('بناء الدفتر يُسجَّل بسقف فقده — لا سياسة صامتة', () => {
  const { s } = ledgerOnly();
  assert.equal(lastDetail(s, 'load_ledger_online').maxLoss, 0);
});
