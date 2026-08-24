/**
 * scripts/declaration_cases.ts — جدولُ القوائم المعلنة وأداةُ نفخها (المرحلة 39، البندان T-129 و T-130)
 * المالك: القيّم على المستودع | المدخلات: مجلدُ تهيئةٍ منسوخٌ في tmpdir (لا يُلمس المستودع)
 * المخرجات: جدولُ حالاتٍ ودالّةُ نفخٍ ودالّةُ سياقٍ — لا يطبع شيئًا ولا يقيس
 * التبعيات: src/kernel/config/* | الصلاحيات: قراءةُ التهيئة وكتابةٌ في المسار المُعطى وحده
 * السجلات: لا يكتب في اليوميّة — الأداةُ لا تُدوّن
 * حالات الفشل: مفتاحٌ غيرُ موجودٍ للنفخ ⇒ استثناءٌ صريح (RULE-007: لا يُبتلع خطأ)
 * اختبارات الوحدة: tests/kernel/declaration_ceilings.test.ts · tests/kernel/declaration_ceilings_rest.test.ts
 *   · tests/kernel/config_budget.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0034-config-declaration-budget.md
 * ثوابت هذه الوحدة:
 *   1) **جدولٌ واحدٌ لمسبارَين**: كان الجدولُ ساكنًا `declaration_scope_probe.ts` وحده،
 *      فلمّا احتاجه مسبارُ الكلفة (T-130) أُخرِج إلى هنا **بلا تغييرِ حالةٍ ولا إضافةِ حالة**:
 *      جدولان متطابقان يفترقان بتعديلٍ واحدٍ يُفسدان القياسَ ولا يُكشف الفرق.
 *   2) **النفخُ صحيحُ البنية**: كلُّ عنصرٍ مصنوعٍ يُشبه ما هو معلنٌ اليوم ويشير إلى مراجعَ
 *      **قائمةٍ في التهيئة** ({@link readCtx}) — فالرفضُ إن جاء جاء من السقف لا من مرجعٍ مخترع.
 *   3) **العددُ مُعامِلٌ لا ثابت**: مسبارُ المدى ينفخ إلى ما يفوق كلَّ سقف، ومسبارُ الكلفة
 *      ينفخ إلى **حدِّ السقف بالضبط**. فالدالّةُ تأخذ العددَ ولا تُخبّئه.
 *   4) **الإزاحةُ تُقاس لا تُفترض**: تُقرأ من أوّلِ عنصرٍ قائمٍ تحت المفتاح، فتغييرُ تنسيقِ
 *      ملفِّ تهيئةٍ لا يُنتج نفخًا يفسده المحلّلُ فيُقرأ الفشلُ سقفًا.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SovereignViolation } from '../src/kernel/types';
import { loadChannels } from '../src/kernel/config/channels';
import { loadConfinement } from '../src/kernel/config/confinement';
import { loadContracts } from '../src/kernel/config/contracts';
import { loadEconomy } from '../src/kernel/config/economy';
import { loadEnterprises } from '../src/kernel/config/enterprises';
import { loadExternal } from '../src/kernel/config/external';
import { loadInference } from '../src/kernel/config/inference';
import { loadQuotas } from '../src/kernel/config/quotas';
import { loadRegions } from '../src/kernel/config/regions';
import { loadResearch } from '../src/kernel/config/research';
import { loadServices } from '../src/kernel/config/services';

/** ما يُقرأ من التهيئة القائمة ليكون النفخُ صحيحَ البنية (لا يخترع مرجعًا غيرَ معلن) */
export type Ctx = {
  readonly counterparty: string;
  readonly researchType: string;
  readonly serviceSource: string;
  readonly material: string;
  /** مادّةٌ مصدرُها داخليٌّ — مخرجُ منشأةٍ لا يكون مادّةً مصدرُها خارجيّ (CONFIG_ENTERPRISE_OUTPUT_EXTERNAL) */
  readonly internalMaterial: string;
  readonly resource: string;
};

/** قائمةٌ **مفتوحةُ العدد**: مُعرِّفٌ حرٌّ أو اسمٌ حرٌّ لا تعدادٌ مغلق */
export type OpenCase = {
  readonly ceiling: string;
  readonly file: string;
  readonly key: string;
  readonly load: (dir: string) => unknown;
  readonly entry: (index: number, ctx: Ctx) => readonly string[];
};

/** القوائمُ التي فُتح بابُها في T-129 — ستةَ عشرَ سقفًا يقعُ كلُّ واحدٍ منها */
export const OPEN_CASES: readonly OpenCase[] = [
  {
    ceiling: 'regions', file: 'regions.yaml', key: 'regions', load: loadRegions,
    entry: (i) => [`- { id: "region:probe${i}", name: "إقليم قياس ${i}", autonomy_level: "limited" }`],
  },
  {
    ceiling: 'quota_resources', file: 'quotas.yaml', key: 'resources', load: loadQuotas,
    entry: (i) => [`probe${i}: { total: 8, per_agent_max: 1, lease_seconds: 60 }`],
  },
  {
    ceiling: 'revenue_rates', file: 'economy.yaml', key: 'rates', load: loadEconomy,
    entry: (i) => [`- { base: "probe${i}", rate_per_mille: 1, declared_at: "2026-01-01" }`],
  },
  {
    ceiling: 'counterparties', file: 'external.yaml', key: 'counterparties', load: loadExternal,
    entry: (i) => [`- { id: "external:probe${i}", name: "نظير قياس ${i}", host: "probe${i}.example",`
      + ' port: 443, purpose: "قياس سقف العدد", single_max: 1, daily_max: 1, total_cap: 1 }'],
  },
  {
    ceiling: 'suspend_authorities', file: 'external.yaml', key: 'suspend_authorities',
    load: loadExternal, entry: (i) => [`- "authority:probe${i}"`],
  },
  {
    ceiling: 'contract_risk_factors', file: 'contracts.yaml', key: 'risk_factors',
    load: loadContracts, entry: (i) => [`probe${i}: 1`],
  },
  {
    ceiling: 'contract_kinds', file: 'contracts.yaml', key: 'kinds', load: loadContracts,
    entry: (i, ctx) => [`- { id: "contract:probe${i}", name: "عقد قياس ${i}",`
      + ` purpose: "قياس سقف العدد", counterparty: "${ctx.counterparty}",`
      + ' max_value: 1, risk_weight: 1 }'],
  },
  {
    ceiling: 'service_sources', file: 'services.yaml', key: 'sources', load: loadServices,
    entry: (i) => [`- { id: "source:probe${i}", name: "مصدر قياس ${i}" }`],
  },
  {
    ceiling: 'quality_checks', file: 'services.yaml', key: 'quality_checks', load: loadServices,
    entry: (i) => [`probe${i}: 1`],
  },
  {
    ceiling: 'service_operations', file: 'services.yaml', key: 'operations', load: loadServices,
    entry: (i, ctx) => [
      `- id: "operation:probe${i}"`,
      '  minimum_mode: "full"',
      '  required_sources:',
      `    - "${ctx.serviceSource}"`,
    ],
  },
  {
    ceiling: 'research_sources', file: 'research.yaml', key: 'sources', load: loadResearch,
    entry: (i, ctx) => [`- { id: "source:probe${i}", type: "${ctx.researchType}",`
      + ` title: "وثيقة قياس ${i}" }`],
  },
  {
    ceiling: 'channels', file: 'channels.yaml', key: 'channels', load: loadChannels,
    entry: (i) => [
      `- id: "ch:probe${i}"`,
      '  purpose: "قياس سقف العدد"',
      '  kinds:',
      '    - "probe"',
      '  participants:',
      `    - "party:probe${i}a"`,
      `    - "party:probe${i}b"`,
    ],
  },
  {
    ceiling: 'channel_kinds', file: 'channels.yaml', key: 'kinds', load: loadChannels,
    entry: (i) => [`- "probe${i}"`],
  },
  {
    ceiling: 'channel_participants', file: 'channels.yaml', key: 'participants',
    load: loadChannels, entry: (i) => [`- "party:probe${i}"`],
  },
  {
    ceiling: 'safety_categories', file: 'inference.yaml', key: 'required_categories',
    load: loadInference, entry: (i) => [`- "probe${i}"`],
  },
  {
    ceiling: 'infrastructure_ports', file: 'confinement.yaml', key: 'infrastructure_ports',
    load: loadConfinement,
    entry: (i) => [`- { name: "probe${i}", port: 53, protocol: "UDP" }`],
  },
];

/**
 * السقفان اللذان سبقا T-129 في `config/enterprises.yaml` (البند T-75).
 * يُقاسان في مسبار الكلفة لأنّ T-132 يطلب كلفةَ **كلِّ** السقوف الثمانيةَ عشرَ لا الجديدةَ وحدها.
 */
export const PRIOR_CASES: readonly OpenCase[] = [
  {
    ceiling: 'materials', file: 'enterprises.yaml', key: 'materials', load: loadEnterprises,
    entry: (i) => [`- { id: "material:probe${i}", name: "مادة قياس ${i}", unit: "unit",`
      + ' source: "internal" }'],
  },
  {
    ceiling: 'enterprise_kinds', file: 'enterprises.yaml', key: 'kinds', load: loadEnterprises,
    entry: (i, ctx) => [
      `- id: "facility:probe${i}"`,
      `  name: "منشأة قياس ${i}"`,
      '  sector: "data_processing"',
      '  inputs:',
      `    - { material: "${ctx.material}", quantity: 1 }`,
      `  output: { material: "${ctx.internalMaterial}", quantity: 1 }`,
      `  resource_cost: { resource: "${ctx.resource}", amount: 1 }`,
      '  required_checks:',
      '    - "input_provenance"',
      '    - "output_integrity"',
      '    - "waste_within_tolerance"',
      '    - "resource_within_limit"',
    ],
  },
];

/** قوائمُ كلُّ عنصرٍ فيها يُقابل تعدادًا مغلقًا في النواة — محدودةٌ بحجمه لا بسقفٍ يُكتب */
export const CLOSED_ENUM_CASES: readonly (readonly [string, string, string])[] = [
  ['chaos.yaml', 'policy.faults', 'CHAOS_KNOWN_FAULTS'],
  ['persistence.yaml', 'policy.scope', 'DURABLE_KINDS'],
  ['production.yaml', 'severity.critical + severity.high', 'PRODUCTION_KNOWN_INCIDENTS'],
  ['production.yaml', 'policy.scanners', 'PRODUCTION_KNOWN_SCANNERS'],
  ['production.yaml', 'policy.runbooks', 'PRODUCTION_KNOWN_RUNBOOKS'],
  ['production.yaml', 'regions.required', 'config/regions.yaml (محدودٌ بسقف regions)'],
  ['royal-authority.yaml', 'sovereign_actions', 'KNOWN_SOVEREIGN_ACTIONS'],
  ['research.yaml', 'allowed_source_types', 'ثلاثةُ أنواعٍ مغلقةٌ في المحمّل'],
  ['staging.yaml', 'scope.permitted_actions', 'KNOWN_SOVEREIGN_ACTIONS'],
  ['staging.yaml', 'scope.forbidden_actions', 'KNOWN_SOVEREIGN_ACTIONS'],
  ['staging.yaml', 'severity.critical + severity.high', 'STAGING_KNOWN_INCIDENTS'],
  ['staging.yaml', 'policy.watches', 'STAGING_KNOWN_WATCHES'],
  ['staging.yaml', 'policy.runbooks', 'STAGING_KNOWN_RUNBOOKS'],
  ['termination.yaml', 'policy.probes', 'STOP_KNOWN_PROBES'],
  ['services.yaml', 'services', 'نوعان مغلقان (hospital · lab) ولا يُكرَّر نوع'],
  ['services.yaml', 'operations[].required_sources', 'sources (محدودٌ بسقف service_sources)'],
  ['services.yaml', 'modes[].required_sources', 'sources (محدودٌ بسقف service_sources)'],
];

/**
 * جذرُ المستودع: يُبحث عنه صعودًا من موقع التنفيذ، فيُقاس المصدرُ لا ما بُني منه.
 * المزلق الذي وقع أوّلَ تشغيلٍ في T-129: `__dirname/../src` من `dist/scripts` يشير إلى
 * `dist/src`، فقُرئت ملفاتُ `.d.ts` وأُعلن أنّ مواضعَ رفضِ الفراغ صفرٌ — عدٌّ على غير المقصود.
 */
export function repoRoot(): string {
  let dir = resolve(__dirname);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('جذرُ المستودع غيرُ موجود — لا يُقاس مصدرٌ لا يُرى');
}

/** المراجعُ القائمةُ في التهيئة، تُقرأ لا تُخترع */
export function readCtx(configDir: string): Ctx {
  const external = loadExternal(configDir);
  const research = loadResearch(configDir);
  const services = loadServices(configDir);
  const enterprises = loadEnterprises(configDir);
  return {
    counterparty: external.counterparties[0]!.id,
    researchType: String(research.allowed_source_types[0]),
    serviceSource: String(services.services[0]!.operations[0]!.required_sources[0]),
    material: String(enterprises.materials[0]!.id),
    internalMaterial: String(
      (enterprises.materials.find((m) => m.source === 'internal') ?? enterprises.materials[0]!).id,
    ),
    resource: String(enterprises.kinds[0]!.resource_cost.resource),
  };
}

/**
 * نفخُ قائمةٍ في نسخةٍ من التهيئة: تُحشر العناصرُ تحت المفتاح بإزاحةِ أوّلِ عنصرٍ قائم.
 * @param count عددُ العناصر المُضافة — لا يُخبّأ في ثابتٍ، فلكلِّ مسبارٍ مقصدُه
 * @returns عددُ الأسطر المُضافة (لا عددُ العناصر: عنصرٌ قد يكون أسطرًا)
 */
export function inflate(
  path: string, key: string, entry: OpenCase['entry'], ctx: Ctx, count: number,
): number {
  const lines = readFileSync(path, 'utf8').split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  if (at === -1) throw new Error(`مفتاحٌ غيرُ موجود للنفخ: ${key} في ${path}`);
  let childIndent = -1;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    childIndent = line.length - line.trimStart().length;
    break;
  }
  if (childIndent <= 0) throw new Error(`لا عنصرَ قائمًا تُقاس عليه الإزاحة: ${key}`);
  const pad = ' '.repeat(childIndent);
  const added: string[] = [];
  for (let i = 0; i < count; i += 1) {
    for (const raw of entry(i, ctx)) added.push(pad + raw);
  }
  lines.splice(at + 1, 0, ...added);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return added.length;
}

/**
 * عددُ العناصر المعلنة اليومَ تحت مفتاحٍ في ملفٍ — يُقاس من الملف بالبنية لا يُكتب رقمًا.
 * ولِمَ لا يُقرأ من المُحمَّل؟ لأنّ ثمانيةَ عشرَ شكلًا مُحمَّلًا تحتاج ثمانيةَ عشرَ قارئًا،
 * وكلُّ واحدٍ منها رقمٌ يمكن أن يبيت خاطئًا. والبنيةُ واحدةٌ: عنصرٌ في قائمةٍ يبدأ بـ`- `
 * وعنصرٌ في خريطةٍ يحمل `:`، وكلاهما يقع على إزاحةِ الابن بالضبط.
 * @returns العددُ المقيس، أو `-1` إن لم يوجد المفتاح (فلا يُدَّعى صفرٌ عن غيابٍ)
 */
export function declaredCount(path: string, key: string): number {
  const lines = readFileSync(path, 'utf8').split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  if (at === -1) return -1;
  let childIndent = -1;
  let count = 0;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (childIndent === -1) childIndent = indent;
    if (indent < childIndent) break;
    if (indent !== childIndent) continue;
    if (line.trim().startsWith('- ') || line.includes(':')) count += 1;
  }
  return count;
}

/**
 * مجموعُ العُقد المعلنة في مستندٍ مُحلَّل: كلُّ مفتاحٍ في خريطةٍ وكلُّ عنصرٍ في قائمة.
 * ليس قياسًا لحجمِ الذاكرة بل لعددِ ما أُعلن — وهو ما يحرسه سقفُ المجموع (T-130).
 */
export function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    let n = value.length;
    for (const item of value) n += countNodes(item);
    return n;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>);
    let n = entries.length;
    for (const item of entries) n += countNodes(item);
    return n;
  }
  return 0;
}

/** وصفُ نتيجةٍ فاشلةٍ: رمزُ الرفض السياديّ إن كان، وإلّا فالخطأُ كما هو (لا يُبتلع) */
export function refusal(error: unknown): string {
  if (error instanceof SovereignViolation) return `مرفوض ${error.code}`;
  return `خطأٌ غيرُ سياديّ: ${(error as Error).message.slice(0, 80)}`;
}
