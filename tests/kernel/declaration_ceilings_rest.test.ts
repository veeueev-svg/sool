/**
 * tests/kernel/declaration_ceilings_rest.test.ts — سقوفُ العدد في بقيّة محمّلات النواة (T-129)
 * المالك: القيّم على المستودع | المدخلات: نسخةٌ من `config/` تُنفخ في مجلد مؤقت | المخرجات: رفضُ إقلاع
 * التبعيات: محمّلاتُ `src/kernel/config/*` · guardDeclaredCount · DECLARATION_CEILINGS
 * الصلاحيات: لا تعديل على تهيئة المستودع الفعليّة | السجلات: لا شيء — الرفضُ قبل الإقلاع
 * حالات الفشل: كلُّها مغلقةٌ برمز `CONFIG_DECLARATION_OVER_CEILING`
 * الوثيقة: docs/test-reports/T-129-declaration-ceilings-rest.md
 * ثوابت الاختبار:
 *   1) **ستّةَ عشرَ بابًا لا بابٌ واحد**: كلُّ قائمةٍ مفتوحةِ العدد قيست في المسبار
 *      (`npm run probe:declaration-scope`) أنّها تقبل 1024 إعلانًا، فلها هنا حالةٌ تُسقطها باسمها.
 *   2) **العددُ المعلن اليوم مُثبَّتٌ في اختبار**: من زاد إعلانًا في `config/` يسقط عنده هذا
 *      الاختبارُ فيُحدِّث الوثيقةَ والسقفَ معًا — فلا ينمو الإعلانُ صامتًا تحت سقفٍ لا يراه.
 *   3) **الحدُّ يُقبل عنده ويُرفض فوقه بواحد** — حدٌّ لا يُقبل عنده منعٌ لا سقف.
 *   4) **سطرٌ في الملف المحكوم لا يوسّع سقفَه** (RULE-005).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SovereignViolation } from '../../src/index';
import {
  DECLARATION_CEILINGS, loadChannels, loadConfinement, loadContracts, loadEconomy, loadExternal,
  loadInference, loadQuotas, loadRegions, loadResearch, loadServices, resolveConfigDir,
} from '../../src/kernel/config';

const REAL_CONFIG = resolveConfigDir();
const OVER = 'CONFIG_DECLARATION_OVER_CEILING';

/** نظيرٌ ومصدرٌ ونوعُ بحثٍ معلنون فعلًا — النفخُ لا يخترع مرجعًا غيرَ معلن (RULE-005) */
const CP = loadExternal().counterparties[0]!.id;
const SRC = String(loadServices().services[0]!.operations[0]!.required_sources[0]);
const RTYPE = String(loadResearch().allowed_source_types[0]);

/** نفخُ قائمةٍ تحت مفتاحها بإزاحةِ أوّلِ عنصرٍ قائم — لا يُخمَّن تنسيقٌ ولا تُكتب إزاحةٌ بيدٍ */
function inflate(yaml: string, key: string, entry: (i: number) => string, count: number): string {
  const lines = yaml.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  assert.notEqual(at, -1, `مفتاحٌ غيرُ موجودٍ للنفخ: ${key}`);
  let indent = -1;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    indent = line.length - line.trimStart().length;
    break;
  }
  assert.ok(indent > 0, `لا عنصرَ قائمًا تُقاس عليه الإزاحة: ${key}`);
  const pad = ' '.repeat(indent);
  const added: string[] = [];
  for (let i = 0; i < count; i += 1) {
    for (const raw of entry(i).split('\n')) added.push(pad + raw);
  }
  lines.splice(at + 1, 0, ...added);
  return lines.join('\n');
}

/** نسخةٌ من التهيئة الفعليّة يُنفخ فيها ملفٌ واحد — والأصلُ لا يُمسّ */
function withInflated(
  file: string, key: string, entry: (i: number) => string, count: number,
  body: (dir: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), 'decl-rest-'));
  try {
    cpSync(REAL_CONFIG, dir, { recursive: true });
    const path = join(dir, file);
    writeFileSync(path, inflate(readFileSync(path, 'utf8'), key, entry, count));
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function refusalCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SovereignViolation, 'الرفضُ يكون انتهاكًا سياديًّا لا خطأً عامًّا');
    return (error as SovereignViolation).code;
  }
  assert.fail('كان يجب أن يُرفض');
}

type Case = {
  readonly ceiling: keyof typeof DECLARATION_CEILINGS;
  readonly file: string;
  readonly key: string;
  readonly load: (dir: string) => unknown;
  readonly entry: (i: number) => string;
  /** العددُ المعلنُ اليوم في تهيئة المستودع — مُثبَّتٌ ليسقط الاختبارُ عند نموّه صامتًا */
  readonly today: number;
};

const CASES: readonly Case[] = [
  {
    ceiling: 'regions', file: 'regions.yaml', key: 'regions', load: loadRegions, today: 4,
    entry: (i) => `- { id: "region:probe${i}", name: "إقليم قياس ${i}", autonomy_level: "limited" }`,
  },
  {
    ceiling: 'quota_resources', file: 'quotas.yaml', key: 'resources', load: loadQuotas, today: 4,
    entry: (i) => `probe${i}: { total: 8, per_agent_max: 1, lease_seconds: 60 }`,
  },
  {
    ceiling: 'revenue_rates', file: 'economy.yaml', key: 'rates', load: loadEconomy, today: 3,
    entry: (i) => `- { base: "probe${i}", rate_per_mille: 1, declared_at: "2026-01-01" }`,
  },
  {
    ceiling: 'counterparties', file: 'external.yaml', key: 'counterparties', load: loadExternal,
    today: 3,
    entry: (i) => `- { id: "external:probe${i}", name: "نظير قياس ${i}", host: "probe${i}.example",`
      + ' port: 443, purpose: "قياس سقف العدد", single_max: 1, daily_max: 1, total_cap: 1 }',
  },
  {
    ceiling: 'suspend_authorities', file: 'external.yaml', key: 'suspend_authorities',
    load: loadExternal, today: 4, entry: (i) => `- "authority:probe${i}"`,
  },
  {
    ceiling: 'contract_risk_factors', file: 'contracts.yaml', key: 'risk_factors',
    load: loadContracts, today: 5, entry: (i) => `probe${i}: 1`,
  },
  {
    ceiling: 'contract_kinds', file: 'contracts.yaml', key: 'kinds', load: loadContracts, today: 3,
    entry: (i) => `- { id: "contract:probe${i}", name: "عقد قياس ${i}",`
      + ` purpose: "قياس سقف العدد", counterparty: "${CP}", max_value: 1, risk_weight: 1 }`,
  },
  {
    ceiling: 'service_sources', file: 'services.yaml', key: 'sources', load: loadServices, today: 5,
    entry: (i) => `- { id: "source:probe${i}", name: "مصدر قياس ${i}" }`,
  },
  {
    ceiling: 'quality_checks', file: 'services.yaml', key: 'quality_checks', load: loadServices,
    today: 3, entry: (i) => `probe${i}: 1`,
  },
  {
    ceiling: 'service_operations', file: 'services.yaml', key: 'operations', load: loadServices,
    today: 2,
    entry: (i) => `- id: "operation:probe${i}"\n  minimum_mode: "full"\n  required_sources:\n`
      + `    - "${SRC}"`,
  },
  {
    ceiling: 'research_sources', file: 'research.yaml', key: 'sources', load: loadResearch,
    today: 3,
    entry: (i) => `- { id: "source:probe${i}", type: "${RTYPE}", title: "وثيقة قياس ${i}" }`,
  },
  {
    ceiling: 'channels', file: 'channels.yaml', key: 'channels', load: loadChannels, today: 2,
    entry: (i) => `- id: "ch:probe${i}"\n  purpose: "قياس سقف العدد"\n  kinds:\n    - "probe"\n`
      + `  participants:\n    - "party:probe${i}a"\n    - "party:probe${i}b"`,
  },
  {
    ceiling: 'channel_kinds', file: 'channels.yaml', key: 'kinds', load: loadChannels, today: 2,
    entry: (i) => `- "probe${i}"`,
  },
  {
    ceiling: 'channel_participants', file: 'channels.yaml', key: 'participants',
    load: loadChannels, today: 2, entry: (i) => `- "party:probe${i}"`,
  },
  {
    ceiling: 'safety_categories', file: 'inference.yaml', key: 'required_categories',
    load: loadInference, today: 8, entry: (i) => `- "probe${i}"`,
  },
  {
    ceiling: 'infrastructure_ports', file: 'confinement.yaml', key: 'infrastructure_ports',
    load: loadConfinement, today: 2,
    entry: (i) => `- { name: "probe${i}", port: 53, protocol: "UDP" }`,
  },
];

for (const item of CASES) {
  test(`T-129: ${item.ceiling} فوق سقفه يُرفض — ${item.file}/${item.key}`, () => {
    const ceiling = DECLARATION_CEILINGS[item.ceiling];
    withInflated(item.file, item.key, item.entry, ceiling + 1, (dir) => {
      assert.equal(refusalCode(() => item.load(dir)), OVER);
    });
  });
}

test('T-129: تهيئةُ المستودع الفعليّة تمرّ في المحمّلات كلّها — حرسٌ لا شلَل', () => {
  for (const item of CASES) assert.doesNotThrow(() => item.load(REAL_CONFIG));
});

test('T-129: العددُ المعلنُ اليوم مُثبَّتٌ ودون سقفه — لا ينمو الإعلانُ صامتًا', () => {
  for (const item of CASES) {
    const ceiling = DECLARATION_CEILINGS[item.ceiling];
    assert.ok(
      item.today < ceiling,
      `سقفُ ${item.ceiling} لا يترك متّسعًا فوق المعلن (${item.today}/${ceiling})`,
    );
    // ومن نفخ حتى الفرق بين السقف والمعلن بلا زيادةٍ يمرّ: الحدُّ يُقبل عنده
    withInflated(item.file, item.key, item.entry, ceiling - item.today, (dir) => {
      assert.doesNotThrow(
        () => item.load(dir),
        `العددُ المعلنُ اليوم لـ${item.ceiling} ليس ${item.today} — يُحدَّث الجدولُ والوثيقة`,
      );
    });
  }
});

test('T-129: الأقاليمُ عند السقف بالضبط تُقبل وفوقه بواحدٍ تُرفض — حدٌّ يقع', () => {
  const max = DECLARATION_CEILINGS.regions;
  const region = CASES[0]!;
  withInflated(region.file, region.key, region.entry, max - region.today, (dir) => {
    assert.equal(loadRegions(dir).regions.length, max);
  });
  withInflated(region.file, region.key, region.entry, max - region.today + 1, (dir) => {
    assert.equal(refusalCode(() => loadRegions(dir)), OVER);
  });
});

test('T-129: سقفٌ يُكتب في الملف المحكوم لا أثرَ له (RULE-005)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'decl-rest-rule005-'));
  try {
    cpSync(REAL_CONFIG, dir, { recursive: true });
    const path = join(dir, 'regions.yaml');
    const inflated = inflate(
      readFileSync(path, 'utf8'), 'regions', CASES[0]!.entry, DECLARATION_CEILINGS.regions + 1,
    );
    // من كتب في تهيئته «max_regions: 10000» ثمّ أعلن فوق السقف يُرفض كأنّه لم يكتب شيئًا
    writeFileSync(path, `max_regions: 10000\nmax_declarations: 10000\n${inflated}`);
    assert.equal(refusalCode(() => loadRegions(dir)), OVER);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-129: السقوفُ الثمانيةَ عشرَ معلنةٌ أعدادًا صحيحةً موجبة ومجمَّدة', () => {
  const names = Object.keys(DECLARATION_CEILINGS);
  assert.equal(names.length, 18, 'أربعةٌ من T-75 وأربعةَ عشرَ من T-129');
  for (const name of names) {
    const value = (DECLARATION_CEILINGS as unknown as Record<string, number>)[name] as number;
    assert.ok(Number.isSafeInteger(value) && value > 0, `سقفٌ غيرُ صالح: ${name}`);
  }
  assert.ok(Object.isFrozen(DECLARATION_CEILINGS));
  // وكلُّ حالةٍ في الجدول تُحرس بسقفٍ معلنٍ بالاسم — لا سقفَ يُصنع في موضع النداء
  for (const item of CASES) assert.ok(names.includes(item.ceiling));
});
