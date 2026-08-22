/**
 * tests/scale/scheduler.test.ts — عدالة المجدول وسقوفه وإيقافه (المرحلة 31)
 * المالك: وزارة البنية | المدخلات: مهمات وملاك | المخرجات: دور عادل أو رمز رفض
 * التبعيات: FairScheduler ومفتاح الإيقاف | الصلاحيات: تنفيذ مجدول لا اعتماد سيادي
 * السجلات: scale_task_* | حالات الفشل: طابور زائد أو تكرار أو إيقاف لا ينسى مهمة
 * اختبار القبول: scale_lifecycle.test.ts | الوثيقة: ADR-0015-scale.md
 * ثوابت الاختبار: 1) دور الملاك؛ 2) سقفان؛ 3) مرة واحدة؛ 4) تجميد قاطع.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FairScheduler } from '../../src/index';
import { scaleState } from './helpers';
function scheduler(maxConcurrent = 2, queueMax = 4, ownerMax = 2) { const h = scaleState(); return { h, q: new FairScheduler(h.s.audit, h.s.killSwitch, maxConcurrent, queueMax, ownerMax) }; }
test('يقبل مهمة معلنة', () => { const { q } = scheduler(); assert.equal(q.enqueue('task:1', 'owner:a').ok, true); });
test('يرفض مهمة بلا معرف', () => { const { q } = scheduler(); const r = q.enqueue('', 'owner:a'); assert.equal(r.ok, false); });
test('يرفض مهمة بلا مالك', () => { const { q } = scheduler(); const r = q.enqueue('task:1', ''); assert.equal(r.ok, false); });
test('ينفذ بالتناوب بين مالكين', () => { const { q } = scheduler(); q.enqueue('a1', 'a'); q.enqueue('a2', 'a'); q.enqueue('b1', 'b'); assert.equal(q.next()?.taskId, 'a1'); q.complete('a1'); assert.equal(q.next()?.taskId, 'b1'); });
test('لا يجوع المالك الثاني أمام طابور الأول', () => { const { q } = scheduler(1, 6, 4); for (const id of ['a1', 'a2', 'a3']) q.enqueue(id, 'a'); q.enqueue('b1', 'b'); assert.equal(q.next()?.owner, 'a'); q.complete('a1'); assert.equal(q.next()?.owner, 'b'); });
test('يمارس سقف التزامن', () => { const { q } = scheduler(1); q.enqueue('a', 'a'); q.enqueue('b', 'b'); assert.notEqual(q.next(), null); assert.equal(q.next(), null); });
test('الإقفال يحرر مقعد التزامن', () => { const { q } = scheduler(1); q.enqueue('a', 'a'); q.enqueue('b', 'b'); q.next(); assert.equal(q.complete('a'), true); assert.equal(q.next()?.taskId, 'b'); });
test('لا يقفل إلا الجاري', () => { const { q } = scheduler(); q.enqueue('a', 'a'); assert.equal(q.complete('a'), false); });
test('يرفض إعادة نفس المهمة مرة واحدة فقط', () => { const { q } = scheduler(); q.enqueue('a', 'a'); const r = q.enqueue('a', 'a'); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'SCHEDULER_DUPLICATE_TASK'); });
test('يمارس سقف الطابور الكلي عند الحد وفوقه', () => { const { q } = scheduler(2, 2, 2); assert.equal(q.enqueue('a', 'a').ok, true); assert.equal(q.enqueue('b', 'b').ok, true); const r = q.enqueue('c', 'c'); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'SCHEDULER_QUEUE_FULL'); });
test('يمارس سقف طابور المالك فلا يحتكر الكل', () => { const { q } = scheduler(2, 4, 1); q.enqueue('a', 'a'); const r = q.enqueue('b', 'a'); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'SCHEDULER_OWNER_QUEUE_FULL'); });
test('الإيقاف يجمد المنتظر والجاري معا', () => { const { h, q } = scheduler(); q.enqueue('a', 'a'); q.enqueue('b', 'b'); q.next(); h.s.killSwitch.engage(h.s.king.kingId, 'all', 'test'); q.freezeIfHalted(); assert.equal(q.statusOf('a'), 'frozen'); assert.equal(q.statusOf('b'), 'frozen'); });
test('الإيقاف يرفض الإدراج اللاحق', () => { const { h, q } = scheduler(); h.s.killSwitch.engage(h.s.king.kingId, 'all', 'test'); const r = q.enqueue('a', 'a'); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'SCHEDULER_HALTED'); });
test('المجمد لا يعيد التنفيذ ولا يقبل الإقفال', () => { const { h, q } = scheduler(); q.enqueue('a', 'a'); q.next(); h.s.killSwitch.engage(h.s.king.kingId, 'all', 'test'); assert.equal(q.next(), null); assert.equal(q.complete('a'), false); });
test('يعرض عدد المهام المنتظرة الحقيقي', () => { const { q } = scheduler(); q.enqueue('a', 'a'); q.enqueue('b', 'b'); assert.equal(q.queued(), 2); });
test('لا يعيد المهمة المكتملة إلى الطابور', () => { const { q } = scheduler(); q.enqueue('a', 'a'); q.next(); q.complete('a'); assert.equal(q.queued(), 0); assert.equal(q.statusOf('a'), 'completed'); });
