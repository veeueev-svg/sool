/**
 * scripts/declaration_scope_probe.ts — مسبارُ سقوفِ العدد المعلن في محمّلات النواة (المرحلة 39، البند T-129)
 * المالك: القيّم على المستودع | المدخلات: مجلدُ تهيئةٍ منسوخٌ في tmpdir (لا يُلمس المستودع)
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًا في docs/audit/measurements/phase-39-T129.txt
 * التبعيات: src/kernel/config/* | الصلاحيات: قراءةُ `config/` وكتابةٌ في tmpdir وحده
 * السجلات: لا يكتب في اليوميّة — القياسُ لا يُلوّث الدفتر
 * حالات الفشل: أيُّ خطأٍ غيرِ سياديّ يخرج بشفرة 1 — ولا يُبتلع خطأ (RULE-007)
 * اختبارات الوحدة: tests/kernel/declaration_ceilings.test.ts · tests/kernel/declaration_ceilings_rest.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0033-declared-count-ceilings.md
 * ثوابت هذا الملف:
 *   1) **الدعوى تُقاس لا تُصدَّق**: دعوى T-129 أنّ في المحمّلات مواضعَ ترفض القائمةَ الفارغة
 *      ولا موضعَ يرفض اللانهائية. فتُعَدُّ المواضعُ من الشفرة نفسها بمسحٍ نصّيّ، ويُطبع العددُ
 *      كما قيس — لا كما رُوي في تقريرٍ سابق.
 *   2) **الفجوةُ تُبرهن بحمولةٍ لا بوصف**: كلُّ قائمةٍ مفتوحةِ العدد تُنفخ إلى {@link INFLATE_TO}
 *      عنصرًا صحيحَ البنية في نسخةٍ من التهيئة، ثم يُنادى محمّلُها. فإن قُبلت فالبابُ مفتوح،
 *      وإن رُفضت طُبع رمزُ الرفض. والنتيجةُ نفسُها تُقاس قبل الإصلاح وبعده بالأمر ذاته.
 *   3) **المقيَّدُ بمجموعةٍ مغلقةٍ يُعلن لا يُسقَف**: قائمةٌ كلُّ عنصرٍ فيها يُقابل تعدادًا
 *      مغلقًا في النواة (كالقطوع والماسحات وكتبِ التشغيل) محدودةٌ بحجم التعداد أصلًا،
 *      فسقفُها ثابتٌ نائمٌ لا يقع. تُطبع في جدولٍ منفصلٍ بسببِ استثنائها معلنًا.
 *   4) **الكلفةُ تُطبع كما قيست**: حجمُ الملف قبل النفخ وبعده وزمنُ التحميل — فمن يقول
 *      «لا حدَّ يضرّ» يقرأ ما يضرّ رقمًا.
 */
import {
  cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { SovereignViolation } from '../src/kernel/types';
import { resolveConfigDir } from '../src/kernel/config/paths';
import { loadChannels } from '../src/kernel/config/channels';
import { loadConfinement } from '../src/kernel/config/confinement';
import { loadContracts } from '../src/kernel/config/contracts';
import { loadEconomy } from '../src/kernel/config/economy';
import { loadExternal } from '../src/kernel/config/external';
import { loadInference } from '../src/kernel/config/inference';
import { loadQuotas } from '../src/kernel/config/quotas';
import { loadRegions } from '../src/kernel/config/regions';
import { loadResearch } from '../src/kernel/config/research';
import { loadServices } from '../src/kernel/config/services';

/** عددُ العناصر المنفوخة: أكبرُ بمراتبَ من كلِّ سقفٍ معلن، فالمرورُ به مرورٌ بلا حدّ */
const INFLATE_TO = 1024;

/** المحمّلاتُ التي تقرأ قوائمَ **مفتوحةَ العدد**: مُعرِّفٌ حرٌّ أو اسمٌ حرٌّ لا تعدادٌ مغلق */
type OpenCase = {
  readonly ceiling: string;
  readonly file: string;
  readonly key: string;
  readonly load: (dir: string) => unknown;
  readonly entry: (index: number, ctx: Ctx) => readonly string[];
};

/** ما يُقرأ من التهيئة القائمة ليكون النفخُ صحيحَ البنية (لا يخترع مرجعًا غيرَ معلن) */
type Ctx = {
  readonly counterparty: string;
  readonly researchType: string;
  readonly serviceSource: string;
};

const OPEN_CASES: readonly OpenCase[] = [
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

/** قوائمُ كلُّ عنصرٍ فيها يُقابل تعدادًا مغلقًا في النواة — محدودةٌ بحجمه لا بسقفٍ يُكتب */
const CLOSED_ENUM_CASES: readonly (readonly [string, string, string])[] = [
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

const out: string[] = [];
function say(line: string): void {
  out.push(line);
  process.stdout.write(`${line}\n`);
}

/**
 * جذرُ المستودع: يُبحث عنه صعودًا من موقع التنفيذ، فيُقاس المصدرُ لا ما بُني منه.
 * المزلق الذي وقع أوّلَ تشغيل: `__dirname/../src` من `dist/scripts` يشير إلى `dist/src`،
 * فقُرئت ملفاتُ `.d.ts` وأُعلن أنّ مواضعَ رفضِ الفراغ صفرٌ — عدٌّ على غير المقصود.
 */
function repoRoot(): string {
  let dir = resolve(__dirname);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('جذرُ المستودع غيرُ موجود — لا يُقاس مصدرٌ لا يُرى');
}

/** مسحُ الشفرة: يُعَدُّ ما يرفض الفراغَ وما يحرس العددَ — عدٌّ لا رواية */
function census(srcDir: string): void {
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts')).sort();
  let emptyGuards = 0;
  let ceilingGuards = 0;
  let loadersWithEmpty = 0;
  say('| المحمّل | يرفض الفراغ | يحرس العدد |');
  say('|---|---|---|');
  for (const file of files) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    const empty = (text.match(/length === 0|length < 1/g) ?? []).length;
    const ceiling = (text.match(/guardDeclaredCount\(/g) ?? []).length;
    emptyGuards += empty;
    ceilingGuards += ceiling;
    if (empty > 0) loadersWithEmpty += 1;
    if (empty > 0 || ceiling > 0) say(`| ${file} | ${empty} | ${ceiling} |`);
  }
  say('');
  say(`المحمّلات: ${files.length} · مواضعُ رفضِ الفراغ: ${emptyGuards}`
    + ` في ${loadersWithEmpty} محمّلًا · مواضعُ حرسِ العدد: ${ceilingGuards}`);
}

/** نفخُ قائمةٍ في نسخةٍ من التهيئة: تُحشر العناصرُ تحت المفتاح بإزاحةِ أوّلِ عنصرٍ قائم */
function inflate(path: string, key: string, entry: OpenCase['entry'], ctx: Ctx): number {
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
  for (let i = 0; i < INFLATE_TO; i += 1) {
    for (const raw of entry(i, ctx)) added.push(pad + raw);
  }
  lines.splice(at + 1, 0, ...added);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return added.length;
}

function refusal(error: unknown): string {
  if (error instanceof SovereignViolation) return `مرفوض ${error.code}`;
  return `خطأٌ غيرُ سياديّ: ${(error as Error).message.slice(0, 80)}`;
}

function main(): void {
  const configDir = resolveConfigDir();
  const external = loadExternal(configDir);
  const research = loadResearch(configDir);
  const services = loadServices(configDir);
  const ctx: Ctx = {
    counterparty: external.counterparties[0]!.id,
    researchType: String(research.allowed_source_types[0]),
    serviceSource: String(services.services[0]!.operations[0]!.required_sources[0]),
  };

  say(`# مسبارُ سقوفِ العدد المعلن — البند T-129 (${new Date().toISOString()})`);
  say(`# الأمر: npm run probe:declaration-scope · النفخ: ${INFLATE_TO} عنصرًا لكل قائمة`);
  say('');
  say('## أوّلًا: مسحُ الشفرة — ما يرفض الفراغَ مقابلَ ما يحرس العدد');
  say('');
  census(join(repoRoot(), 'src', 'kernel', 'config'));
  say('');
  say('## ثانيًا: القوائمُ مفتوحةُ العدد — نفخٌ ثم تحميل');
  say('');
  say('| السقف | الملف | المفتاح | الحجم قبل | الحجم بعد | النتيجة | زمن التحميل |');
  say('|---|---|---|---|---|---|---|');
  let accepted = 0;
  let refused = 0;
  for (const item of OPEN_CASES) {
    const dir = mkdtempSync(join(tmpdir(), 'sool-decl-'));
    try {
      cpSync(configDir, join(dir, 'config'), { recursive: true });
      const path = join(dir, 'config', item.file);
      const before = statSync(path).size;
      inflate(path, item.key, item.entry, ctx);
      const after = statSync(path).size;
      const t0 = Date.now();
      let result: string;
      try {
        item.load(join(dir, 'config'));
        result = '**قُبل بلا حدّ**';
        accepted += 1;
      } catch (error) {
        result = refusal(error);
        refused += 1;
      }
      const ms = Date.now() - t0;
      say(`| ${item.ceiling} | ${item.file} | ${item.key} | ${before}B | ${after}B`
        + ` | ${result} | ${ms}ms |`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  say('');
  say(`القوائمُ مفتوحةُ العدد: ${OPEN_CASES.length} · قُبلت بلا حدّ: ${accepted}`
    + ` · رُفضت: ${refused}`);
  say('');
  say('## ثالثًا: القوائمُ المقيَّدةُ بتعدادٍ مغلق — تُعلن ولا تُسقَف');
  say('');
  say('| الملف | القائمة | ما يحدّها اليوم |');
  say('|---|---|---|');
  for (const [file, key, bound] of CLOSED_ENUM_CASES) say(`| ${file} | ${key} | ${bound} |`);
  say('');
  say(`المقيَّدةُ بتعدادٍ مغلق: ${CLOSED_ENUM_CASES.length} — سقفُها ثابتٌ نائمٌ لا يقع،`
    + ' فاستُثنيت معلنةً لا مسكوتًا عنها.');
  say('');
  say('**قياسُ منفّذٍ حتى يعيده المدقّق.**');

  const target = process.argv[2];
  if (target) writeFileSync(target, `${out.join('\n')}\n`, 'utf8');
}

main();
