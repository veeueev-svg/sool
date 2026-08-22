/**
 * tests/chaos/effect_matcher.test.ts — مطابقة الأثر بالمصير (المرحلة 34)
 * المالك: ديوان التدقيق | المدخلات: آثار وسجلات | المخرجات: تقرير مطابقة
 * التبعيات: matchEffects وحدها — لا دولة ولا قرص، كي يُقاس المنطق لا التكامل
 * الصلاحيات: لا شيء: دالة نقية | السجلات: لا شيء
 * حالات الفشل: لا استثناءات — الوحدة تُبلّغ بكل الخرق ولا تتوقف عند أوّله
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت الاختبار: 1) الأثر والمصير مصدران مستقلان؛ 2) نصف التنفيذ في الاتجاهين؛
 *                  3) `sound` لا تُصدَّق إلا إذا خلا الاتجاهان والتكرار.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEffects } from '../../src/index';

test('تطابق تام: كل منفَّذ له أثر واحد، والحكم سليم', () => {
  const report = matchEffects({
    effects: ['c1', 'c2'],
    records: [{ commandId: 'c1', status: 'executed' }, { commandId: 'c2', status: 'executed' }],
  });
  assert.equal(report.halfExecuted, 0);
  assert.equal(report.executed, 2);
  assert.equal(report.effects, 2);
  assert.deepEqual([...report.doubleExecuted], []);
  assert.equal(report.sound, true);
});

test('سجل يقول نُفِّذ ولا أثر ⇒ executedWithoutEffect ونصف تنفيذ', () => {
  const report = matchEffects({
    effects: [],
    records: [{ commandId: 'c1', status: 'executed' }],
  });
  assert.deepEqual([...report.executedWithoutEffect], ['c1']);
  assert.equal(report.halfExecuted, 1);
  assert.equal(report.sound, false);
});

test('أثر بلا سجل نُفِّذ ⇒ effectWithoutExecuted ونصف تنفيذ', () => {
  const report = matchEffects({
    effects: ['c1'],
    records: [{ commandId: 'c1', status: 'pending' }],
  });
  assert.deepEqual([...report.effectWithoutExecuted], ['c1']);
  assert.equal(report.pending, 1);
  assert.equal(report.halfExecuted, 1);
  assert.equal(report.sound, false);
});

test('أثر لأمر لا سجل له إطلاقًا ⇒ نصف تنفيذ لا صمت', () => {
  const report = matchEffects({ effects: ['ghost'], records: [] });
  assert.deepEqual([...report.effectWithoutExecuted], ['ghost']);
  assert.equal(report.sound, false);
});

test('أثر لأمر مرفوض ⇒ نصف تنفيذ: الرفض لا يُبرّر أثرًا', () => {
  const report = matchEffects({
    effects: ['c1'],
    records: [{ commandId: 'c1', status: 'denied' }],
  });
  assert.deepEqual([...report.effectWithoutExecuted], ['c1']);
  assert.equal(report.sound, false);
});

test('أثر مكرر لأمر واحد ⇒ doubleExecuted وخرق «مرة واحدة فقط»', () => {
  const report = matchEffects({
    effects: ['c1', 'c1'],
    records: [{ commandId: 'c1', status: 'executed' }],
  });
  assert.deepEqual([...report.doubleExecuted], ['c1']);
  assert.equal(report.halfExecuted, 0, 'التكرار ليس نصف تنفيذ بل خرق آخر');
  assert.equal(report.sound, false);
});

test('الخرق في الاتجاهين يُعدّ معًا ولا يُلغي أحدهما الآخر', () => {
  const report = matchEffects({
    effects: ['c1'],
    records: [{ commandId: 'c1', status: 'pending' }, { commandId: 'c2', status: 'executed' }],
  });
  assert.equal(report.halfExecuted, 2);
  assert.deepEqual([...report.effectWithoutExecuted], ['c1']);
  assert.deepEqual([...report.executedWithoutEffect], ['c2']);
  assert.equal(report.sound, false);
});

test('الوحدة تُبلّغ بكل الخرق ولا ترمي استثناءً عند أوّله', () => {
  assert.doesNotThrow(() => matchEffects({
    effects: ['a', 'a', 'b'],
    records: [{ commandId: 'b', status: 'pending' }, { commandId: 'c', status: 'executed' }],
  }));
  const report = matchEffects({
    effects: ['a', 'a', 'b'],
    records: [{ commandId: 'b', status: 'pending' }, { commandId: 'c', status: 'executed' }],
  });
  assert.deepEqual([...report.doubleExecuted], ['a']);
  assert.deepEqual([...report.effectWithoutExecuted], ['a', 'b']);
  assert.deepEqual([...report.executedWithoutEffect], ['c']);
});

test('حالة فارغة سليمة: لا أثر ولا سجل لا يعني خرقًا', () => {
  const report = matchEffects({ effects: [], records: [] });
  assert.equal(report.sound, true);
  assert.equal(report.executed, 0);
  assert.equal(report.pending, 0);
});

test('السجل الفاشل لا يُطالَب بأثر، والأثر له يُعدّ خرقًا', () => {
  const clean = matchEffects({ effects: [], records: [{ commandId: 'c1', status: 'failed' }] });
  assert.equal(clean.sound, true);
  const dirty = matchEffects({ effects: ['c1'], records: [{ commandId: 'c1', status: 'failed' }] });
  assert.equal(dirty.sound, false);
});

test('القوائم مرتبة كي يكون التقرير قابلًا للمقارنة لا متقلبًا', () => {
  const report = matchEffects({
    effects: ['z', 'y'],
    records: [{ commandId: 'q', status: 'executed' }, { commandId: 'a', status: 'executed' }],
  });
  assert.deepEqual([...report.effectWithoutExecuted], ['y', 'z']);
  assert.deepEqual([...report.executedWithoutEffect], ['a', 'q']);
});
