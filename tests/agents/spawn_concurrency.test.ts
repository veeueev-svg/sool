/**
 * tests/agents/spawn_concurrency.test.ts — نافذةُ «فحصٌ ثم فعل» (المرحلة 39، T-25)
 * المالك: وزارة الداخلية (بمراجعة وزارة الأمن السيبراني) | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: دولةٌ مُقلعةٌ حقيقيّة + مُنادون متزامنون بانتظارٍ فعليٍّ بين الحكم والفعل
 * المخرجات: خرقُ سقفٍ مقيسٌ — يجب أن يكون صفرًا | التبعيات: bootstrapState
 * الصلاحيات: القياسُ وحده | السجلات: سجلُّ التدقيق في الدولة المُقلعة
 * حالات الفشل: تُقرأ بعددِ النسخ المُثبَّتة لا بنصِّ سببٍ
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 * ثوابتُ هذا الملف:
 *   1) **الانتظارُ الفعليُّ شرطُ القياس.** بلا `await` بين الحكم والتقييد لا تُرى
 *      النافذةُ أصلًا في محرّكٍ ذي خيطٍ واحد — ولهذا بقيت الفجوةُ كامنةً لا مُستغلّة:
 *      `AgentFactory.spawn()` متزامنٌ فحماه ذلك عرضًا، أما عقدُ السياسة فلم يكن محميًّا.
 *   2) **القياسُ قبل الإصلاح** (محفوظٌ في docs/audit/measurements/phase-39-T25.txt):
 *      سقفٌ خمسٌ وأربعُ دفعاتٍ متزامنةٍ سُمح لها كلُّها ⇒ عشرون نسخة، خرقٌ خمسةَ عشر.
 *   3) **الخرقُ المقبولُ صفرٌ** — لا «قليلٌ مقبول» في سقفٍ سكّاني.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import type { AgentBlueprint } from '../../src/index';

type State = ReturnType<typeof bootstrapState>;

function scene(cap: number, id = 'bp:race'): State {
  const s = bootstrapState();
  const blueprint: AgentBlueprint = {
    blueprintId: id, template: 'limited_worker', maxInstances: cap,
    generation: 1, purpose: 'قياسُ نافذةِ التزامن بين الحكم والتقييد',
  };
  const declared = s.spawnPolicy.declareBlueprint(
    s.king.issueCommand('amend_policy', id), blueprint,
  );
  assert.equal(declared.allowed, true);
  return s;
}

function facts(id: string, count: number) {
  return {
    blueprintId: id, count, requestedBy: 'ministry:interior',
    population: 0, populationMax: 1_000_000,
  };
}

const pause = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

test('حكمٌ ثم انتظارٌ ثم تقييد: التقييدُ نفسُه ذرّيٌّ فلا يمرُّ فوقَ السقف', async () => {
  const s = scene(5);
  const allowed = await Promise.all([1, 2, 3, 4].map(async (): Promise<number> => {
    const verdict = s.spawnPolicy.evaluate(facts('bp:race', 5));
    if (!verdict.allowed) return 0;
    await pause();
    return s.spawnPolicy.recordSpawn('bp:race', 5) ? 5 : 0;
  }));
  assert.equal(s.spawnPolicy.instancesOf('bp:race'), 5);
  assert.equal(allowed.reduce((a: number, b: number) => a + b, 0), 5);
});

test('تقييدٌ فوق السقف يُرفض بقيمةٍ لا بصمت — والرفضُ يُسجَّل', async () => {
  const s = scene(2);
  assert.equal(s.spawnPolicy.recordSpawn('bp:race', 2), true);
  assert.equal(s.spawnPolicy.recordSpawn('bp:race', 1), false);
  assert.equal(s.spawnPolicy.instancesOf('bp:race'), 2);
  const refusals = s.audit.snapshot().filter((e) => e.kind === 'spawn_record_refused');
  assert.equal(refusals.length, 1);
  await pause();
});

test('حجزٌ ثم انتظارٌ ثم تثبيت: النصيبُ المحجوزُ لا يُرى متاحًا لغير حاجزه', async () => {
  const s = scene(6, 'bp:reserve');
  const outcomes = await Promise.all([1, 2, 3, 4].map(async (): Promise<boolean> => {
    const held = s.spawnPolicy.reserveBatch(facts('bp:reserve', 3));
    if (!held.allowed) return false;
    await pause();
    return s.spawnPolicy.commitReservation(held.reservation.reservationId);
  }));
  assert.equal(outcomes.filter(Boolean).length, 2);
  assert.equal(s.spawnPolicy.instancesOf('bp:reserve'), 6);
});

test('ستّون طالبًا متزامنًا على سقفِ عشرين: الخرقُ صفرٌ والمُثبَّتُ عشرون', async () => {
  const s = scene(20, 'bp:swarm');
  let granted = 0;
  await Promise.all(Array.from({ length: 60 }, async () => {
    await pause();
    const held = s.spawnPolicy.reserveBatch(facts('bp:swarm', 4));
    if (!held.allowed) return;
    granted += 1;
    await pause();
    s.spawnPolicy.commitReservation(held.reservation.reservationId);
  }));
  assert.equal(granted, 5);
  assert.equal(s.spawnPolicy.instancesOf('bp:swarm'), 20);
  assert.equal(s.spawnPolicy.report().outstandingReservations, 0);
});

test('حجزٌ مُفرَجٌ عنه يُعيد نصيبَه لطالبٍ لاحقٍ في الدورة نفسها', async () => {
  const s = scene(4, 'bp:release');
  const first = s.spawnPolicy.reserveBatch(facts('bp:release', 4));
  assert.equal(first.allowed, true);
  const blocked = s.spawnPolicy.reserveBatch(facts('bp:release', 1));
  assert.equal(blocked.allowed, false);
  await pause();
  if (first.allowed) {
    assert.equal(s.spawnPolicy.releaseReservation(first.reservation.reservationId), true);
  }
  assert.equal(s.spawnPolicy.reserveBatch(facts('bp:release', 4)).allowed, true);
  assert.equal(s.spawnPolicy.instancesOf('bp:release'), 0);
});

test('دفعتان متزامنتان عبر المصنع: لا وكيلَ فوق السقف ولا حجزَ يتسرّب', async () => {
  const s = scene(4, 'bp:factory');
  const results = await Promise.all([0, 1].map(async () => {
    await pause();
    return s.factory.spawn(
      s.king.issueCommand('create_agent', `batch-${Math.random()}`),
      {
        blueprintId: 'bp:factory', count: 4,
        requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
      },
    );
  }));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(s.spawnPolicy.instancesOf('bp:factory'), 4);
  assert.equal(s.spawnPolicy.report().outstandingReservations, 0);
  assert.equal(s.spawnPolicy.report().unreservedRecords, 0);
});

test('دفعةٌ ملغاةٌ تُفرِج عن حجزها كاملًا — لا نصيبَ محبوسٌ بإلغاء', () => {
  const s = scene(4, 'bp:rollback');
  // قالبٌ غيرُ معلنٍ في سجل الصلاحيات يُفشل الدفعةَ بعد الحجز وقبل تمامها
  const s2 = bootstrapState();
  s2.spawnPolicy.declareBlueprint(s2.king.issueCommand('amend_policy', 'bp:rollback'), {
    blueprintId: 'bp:rollback', template: 'قالب-غير-معلن', maxInstances: 4,
    generation: 1, purpose: 'قياسُ الإفراج عند الإلغاء',
  });
  const result = s2.factory.spawn(s2.king.issueCommand('create_agent', 'roll'), {
    blueprintId: 'bp:rollback', count: 2,
    requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  assert.equal(result.ok, false);
  assert.equal(s2.spawnPolicy.instancesOf('bp:rollback'), 0);
  assert.equal(s2.spawnPolicy.report().outstandingReservations, 0);
  assert.equal(s.spawnPolicy.instancesOf('bp:rollback'), 0);
});

test('حجزٌ يسقط بمهلته فيعود نصيبُه — ولا يُثبَّت بعد سقوطه', () => {
  const s = scene(2, 'bp:ttl');
  const ttl = s.spawnPolicy.limits.reservationTtlMs;
  const t0 = 1_000_000;
  const held = s.spawnPolicy.reserveBatch(facts('bp:ttl', 2), t0);
  assert.equal(held.allowed, true);
  assert.equal(s.spawnPolicy.reserveBatch(facts('bp:ttl', 1), t0 + ttl - 1).allowed, false);
  assert.equal(s.spawnPolicy.reserveBatch(facts('bp:ttl', 2), t0 + ttl).allowed, true);
  if (held.allowed) {
    assert.equal(s.spawnPolicy.commitReservation(held.reservation.reservationId, t0 + ttl), false);
  }
  assert.equal(s.spawnPolicy.report().expiredReservations >= 1, true);
});

test('حجزٌ يتجاوز سقفَ الدفعة يُرفض قبل أي خصمٍ للنصيب', () => {
  const s = scene(100, 'bp:big');
  const over = s.spawnPolicy.limits.batchMax + 1;
  const held = s.spawnPolicy.reserveBatch(facts('bp:big', over));
  assert.equal(held.allowed, false);
  assert.equal(s.spawnPolicy.report().outstandingReservations, 0);
  assert.equal(s.spawnPolicy.instancesOf('bp:big'), 0);
});

test('التجميدُ يمنع الحجزَ نفسَه لا التقييدَ وحده', () => {
  const s = scene(8, 'bp:frozen');
  s.spawnPolicy.freeze('ministry:cyber', 'قياسٌ');
  const held = s.spawnPolicy.reserveBatch(facts('bp:frozen', 2));
  assert.equal(held.allowed, false);
  assert.equal(s.spawnPolicy.report().outstandingReservations, 0);
});
