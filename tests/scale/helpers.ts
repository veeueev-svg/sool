/**
 * tests/scale/helpers.ts — مهاد اختبارات توسع السكان (المرحلة 31)
 * المالك: وزارة البنية | المدخلات: دولة مهيأة وأوامر الملك | المخرجات: دفعات هوية قانونية
 * التبعيات: bootstrapState ووحدات scale | الصلاحيات: لا حقن لتسجيل ناجح خارج بوابة التاج
 * السجلات: تصدرها الوحدات المختبرة | حالات الفشل: يصغر السقف في الوحدة لا في السياسة الفعلية
 * اختبارات الوحدة: ملفات scale الثلاثة | اختبار القبول: scale_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-31.md
 * ثوابت هذا المهاد: 1) كل هوية agent:*؛ 2) كل حصة identity_slots:1؛ 3) الملك يوقع كل دفعة.
 */
import { bootstrapState, PopulationInput, PopulationRegistry, Sharding } from '../../src/index';

export const T0 = Date.now();
export function identity(n: number, owner = `ministry:owner-${n % 3}`): PopulationInput {
  return { agentId: `agent:scale-${n}`, owner, resourceQuota: 'identity_slots:1' };
}
export function scaleState() {
  const s = bootstrapState({ now: T0 });
  const command = (target: string, at = T0) => s.king.issueCommand('create_agent', target, { scale: true }, at);
  const emergency = (target: string, at = T0) => s.king.issueCommand('declare_emergency', target, { scale: true }, at);
  return { s, command, emergency };
}
export function smallPopulation(
  h: ReturnType<typeof scaleState>, options: { max?: number; rate?: number; shards?: number; perShard?: number } = {},
) {
  const sharding = new Sharding(h.s.audit, h.s.gateway, options.shards ?? 4, options.perShard ?? 4);
  const population = new PopulationRegistry(
    h.s.audit, h.s.gateway, h.s.killSwitch, sharding, options.max ?? 12, options.rate ?? 12,
    h.s.resources, 'identity_slots',
  );
  return { sharding, population };
}
