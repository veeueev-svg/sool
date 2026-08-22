/**
 * src/composition/scale.ts — التوسع — الشرائح وسجل السكان والمجدول العادل
 * المالك: القيّم على المستودع | المراحل: 31
 * المدخلات: مخرجات طبقة السيادة
 * المخرجات: التشريح الحتمي وسجل السكان بحصص الموارد والمجدول العادل
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { SovereigntyParts } from './sovereignty';
import { PopulationRegistry } from '../scale/population';
import { Sharding } from '../scale/sharding';
import { FairScheduler } from '../scale/scheduler';

export function composeScale(parts: SovereigntyParts) {
  const { audit, gateway, killSwitch, resources, scaleConfig, terminationRoll } = parts;

  // 1) توسع السكان (المرحلة 31): هويات مسجلة بحصة مورد ومالك وشريحة حتمية، لا عمليات نظام.
  // قرار التسجيل أو عزل الشريحة يمر بالبوابة نفسها؛ لا بوابة فرعية ولا إعادة توازن صامتة.
  const sharding = new Sharding(
    audit, gateway, scaleConfig.policy.shard_count, scaleConfig.policy.per_shard_max,
  );
  const population = new PopulationRegistry(
    audit, gateway, killSwitch, sharding,
    scaleConfig.policy.population_max, scaleConfig.policy.spawn_rate_per_minute,
    resources, scaleConfig.policy.resource_name,
  );
  const scheduler = new FairScheduler(
    audit, killSwitch,
    scaleConfig.policy.scheduler_max_concurrent,
    scaleConfig.policy.scheduler_queue_max,
    scaleConfig.policy.scheduler_owner_queue_max,
    terminationRoll,
  );

  return {
    sharding, population, scheduler,
  };
}

/** ما تُخرجه طبقة التوسع */
export type ScaleParts = ReturnType<typeof composeScale>;
