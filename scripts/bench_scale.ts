/**
 * scripts/bench_scale.ts — قياس توسع السكان وزمن بوابة التاج (المرحلة 31)
 * المالك: وزارة البنية | المدخلات: تهيئة scale ودولة محلية | المخرجات: أرقام عربية مقاسة
 * التبعيات: bootstrapState ووحدات scale | الصلاحيات: قياس محلي لا يغير سياسة
 * السجلات: دفعات السكان واعتمادات البوابة | حالات الفشل: تجاوز التهيئة يطبع فشلا ويرمي
 * اختبارات الوحدة: tests/scale/* | اختبار القبول: scale_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-31.md
 * ثوابت هذه الوحدة: 1) هوياتٌ فعليةٌ في السجل بعدد `population_max` من التهيئة المقروءة؛ 2) عينات بوابة مستقلة؛
 *   3) الأرقام لا تخمن؛ 4) كلُّ قرارٍ مقيسٍ يجب أن يكون **معتمدًا** — قرارُ رفضٍ واحدٌ يُسقط القياس (W-2026-059)،
 *   فلا يُقاس زمنُ رفضٍ سريعٍ ويُنسب إلى الاعتماد.
 *
 * المرحلة 39 (T-85): يقبل مسارَ تهيئةٍ اختياريًّا في `process.argv[2]` ليقاس السقفُ نفسه من
 * تهيئةٍ أخرى **معلنة في خرج القياس**، فلا يُقاس سقفٌ ويُنسب إلى `config/scale.yaml`.
 * وبلا وسيطٍ يبقى السلوك كما كان: تهيئةُ المستودع.
 */
import { bootstrapState } from '../src/index';
function percentile(values: number[], p: number): number { return values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]!; }
const configDirArg = process.argv[2];
const state = configDirArg ? bootstrapState({ configDir: configDirArg }) : bootstrapState();
const total = state.scaleConfig.policy.population_max;
const batch = 62_500;
const now = Date.now();
const distributionBegan = process.hrtime.bigint();
for (let start = 0; start < total; start += batch) {
  const inputs = Array.from({ length: batch }, (_, i) => ({
    agentId: `agent:bench-${start + i}`, owner: `ministry:bench-${i % 16}`, resourceQuota: 'identity_slots:1',
  }));
  const result = state.population.registerBatch(
    state.king.issueCommand('create_agent', `scale:bench-${start}`, { batch }, now), inputs, now,
  );
  if (!result.ok) throw new Error(`فشل تسجيل القياس: ${result.code}`);
}
const distributionMs = Number(process.hrtime.bigint() - distributionBegan) / 1_000_000;
// الإحماء مفصح عنه: لا يدخل عينة القياس كي لا يخلط تهيئة JIT الأولى بزمن البوابة المستقر.
for (let i = 0; i < 100; i += 1) {
  const warm = state.gateway.authorize(state.king.issueCommand('create_agent', `gateway:warmup-${i}`, { sample: i }, now), now);
  if (!warm.allowed) throw new Error(`قرارُ إحماءٍ مرفوض (${i}): ${warm.reason} — القياسُ يقيس الاعتمادَ لا الرفض`);
}
const timings: number[] = [];
let approved = 0;
for (let i = 0; i < 1000; i += 1) {
  const began = process.hrtime.bigint();
  const decision = state.gateway.authorize(state.king.issueCommand('create_agent', `gateway:bench-${i}`, { sample: i }, now), now);
  timings.push(Number(process.hrtime.bigint() - began) / 1_000_000);
  if (!decision.allowed) throw new Error(`قرارٌ مقيسٌ مرفوض (${i}): ${decision.reason} — القياسُ يقيس الاعتمادَ لا الرفض`);
  approved += 1;
}
timings.sort((a, b) => a - b);
const memory = process.memoryUsage();
console.log(`تهيئة القياس: ${configDirArg ?? 'config/ (تهيئة المستودع)'} · السقف المعلن فيها: ${total}`);
console.log(`عدد الهويات المسجلة: ${state.population.population}`);
console.log(`زمن اعتماد البوابة (مللي ثانية): وسيط=${percentile(timings, 0.5).toFixed(3)} p95=${percentile(timings, 0.95).toFixed(3)} p99=${percentile(timings, 0.99).toFixed(3)} أقصى=${timings.at(-1)!.toFixed(3)}`);
console.log(`زمن التوزيع (مللي ثانية): ${distributionMs.toFixed(3)}؛ حتمي داخل التسجيل؛ الشرائح=${state.scaleConfig.policy.shard_count} والسقف/شريحة=${state.scaleConfig.policy.per_shard_max}`);
console.log('عينات البوابة: 100 إحماء مستبعدة ثم 1000 عينة مقيسة');
console.log(`قرارات البوابة المقيسة: معتمدة=${approved} من ${timings.length} (رفضٌ واحدٌ يُسقط القياس)`);
console.log(`ذاكرة العملية (MiB): RSS=${(memory.rss / 1048576).toFixed(1)} heapUsed=${(memory.heapUsed / 1048576).toFixed(1)}`);
