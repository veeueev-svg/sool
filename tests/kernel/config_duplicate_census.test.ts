/**
 * tests/kernel/config_duplicate_census.test.ts — حصرُ حرسِ التكرار في القوائم المسقوفة (T-135)
 * المالك: القيّم على المستودع | المدخلات: نسخةٌ من `config/` يُكرَّر فيها عنصرٌ واحدٌ في مجلدٍ مؤقّت
 * المخرجات: رفضُ إقلاعٍ برمزٍ مسمّى، أو تلاشي التكرارِ بلا انتفاخِ عددٍ معلن
 * التبعيات: DECLARATION_CEILINGS · محمّلاتُ `src/kernel/config/*`
 * الصلاحيات: لا تعديل على تهيئة المستودع الفعليّة | السجلات: لا شيء — الحكمُ قبل الإقلاع
 * حالات الفشل: رمزُ كلِّ رفضٍ مُعلَنٌ في جدولِ الحصرِ أدناه صفًّا صفًّا
 * الوثيقة: docs/test-reports/phase-40-T135.md · القرار: docs/decisions/ADR-0045-duplicate-guard-locality.md
 * ثوابت الاختبار:
 *   1) **الحصرُ من الشفرةِ لا من جدول**: أسماءُ السقوفِ تُقرأ من `DECLARATION_CEILINGS`، فمن
 *      أضاف سقفًا ولم يُدرجه في الجدولِ يسقط عنده هذا الاختبارُ باسمِ سقفِه.
 *   2) **التكرارُ يُقاس تشغيليًّا لا نصًّا**: يُكرَّر عنصرٌ حقيقيٌّ في الإعلانِ ثمّ يُنادى المحمّل.
 *   3) **الثابتُ المحروس**: قائمةٌ مسقوفةٌ إمّا ترفضُ التكرارَ برمز، وإمّا لا ينتفخُ عددُها
 *      المقيسُ به (خريطةٌ يتلاشى فيها التكرار). والانتفاخُ الصامتُ خرقٌ يسقط باسمِ سقفِه.
 *   4) **الاستثناءُ يُغلَق لا يُتركَ مُثبَتًا**: `infrastructure_ports` كانت تنتفخُ صامتةً
 *      والدَّينُ `T-158` مُعلنٌ — فلمّا سُدَّ الحرسُ نُقلَ الصفُّ إلى `REJECTS` برمزِه،
 *      وأُغلقَ الدَّينُ في `PROGRESS.md`. وحدَهُ `channels` و`safety_categories` رمزانِ عامّانِ
 *   5) **لا رمزَ رفضٍ يُعاد استعمالُه** بين حرسَي تكرارٍ مختلفَين في محمّلات النواة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SovereignViolation } from '../../src/index';
import {
  DECLARATION_CEILINGS, loadChannels, loadConfinement, loadContracts, loadEconomy, loadEnterprises,
  loadExternal, loadInference, loadQuotas, loadRegions, loadResearch, loadServices, resolveConfigDir,
} from '../../src/kernel/config';

const REAL_CONFIG = resolveConfigDir();
const LOADER_DIR = join(dirname(REAL_CONFIG), 'src', 'kernel', 'config');

/** حكمُ القائمةِ المسقوفةِ على التكرار — مقيسٌ لا مُدَّعى */
type Verdict = 'REJECTS' | 'COLLAPSES' | 'INFLATES_DECLARED_DEBT';

interface CensusRow {
  readonly ceiling: keyof typeof DECLARATION_CEILINGS;
  readonly file: string;
  readonly key: string;
  readonly load: (dir: string) => unknown;
  readonly verdict: Verdict;
  /** رمزُ الرفضِ المُعلَن — لصفوفِ `REJECTS` وحدَها */
  readonly code?: string;
  /** رمزٌ عامٌّ لا يُسمّي التكرارَ علّةً: دَينٌ مُعلَنٌ `T-159` لا يُبدَّل في هذا البند */
  readonly generic?: true;
  /** قياسُ العددِ المعلن — لصفوفِ `COLLAPSES` و`INFLATES_DECLARED_DEBT` */
  readonly count?: (config: never) => number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const CENSUS: readonly CensusRow[] = [
  {
    ceiling: 'materials', file: 'enterprises.yaml', key: 'materials', load: loadEnterprises,
    verdict: 'REJECTS', code: 'CONFIG_ENTERPRISE_MATERIAL_DUPLICATE',
  },
  {
    ceiling: 'enterprise_kinds', file: 'enterprises.yaml', key: 'kinds', load: loadEnterprises,
    verdict: 'REJECTS', code: 'CONFIG_ENTERPRISE_KIND_DUPLICATE',
  },
  {
    ceiling: 'regions', file: 'regions.yaml', key: 'regions', load: loadRegions,
    verdict: 'REJECTS', code: 'CONFIG_REGION_DUPLICATE',
  },
  {
    ceiling: 'revenue_rates', file: 'economy.yaml', key: 'rates', load: loadEconomy,
    verdict: 'REJECTS', code: 'CONFIG_RATE_DUPLICATE',
  },
  {
    ceiling: 'counterparties', file: 'external.yaml', key: 'counterparties', load: loadExternal,
    verdict: 'REJECTS', code: 'CONFIG_EXTERNAL_DUPLICATE',
  },
  {
    ceiling: 'suspend_authorities', file: 'external.yaml', key: 'suspend_authorities',
    load: loadExternal, verdict: 'REJECTS',
    code: 'CONFIG_EXTERNAL_SUSPEND_AUTHORITY_DUPLICATE',
  },
  {
    ceiling: 'contract_kinds', file: 'contracts.yaml', key: 'kinds', load: loadContracts,
    verdict: 'REJECTS', code: 'CONFIG_CONTRACT_KIND_DUPLICATE',
  },
  {
    ceiling: 'service_sources', file: 'services.yaml', key: 'sources', load: loadServices,
    verdict: 'REJECTS', code: 'CONFIG_SERVICES_SOURCE_DUPLICATE',
  },
  {
    ceiling: 'service_operations', file: 'services.yaml', key: 'operations', load: loadServices,
    verdict: 'REJECTS', code: 'CONFIG_SERVICES_OPERATION_DUPLICATE',
  },
  {
    ceiling: 'research_sources', file: 'research.yaml', key: 'sources', load: loadResearch,
    verdict: 'REJECTS', code: 'CONFIG_RESEARCH_SOURCE_DUPLICATE',
  },
  {
    ceiling: 'channel_kinds', file: 'channels.yaml', key: 'kinds', load: loadChannels,
    verdict: 'REJECTS', code: 'CONFIG_CHANNEL_KIND_DUPLICATE',
  },
  {
    ceiling: 'channel_participants', file: 'channels.yaml', key: 'participants',
    load: loadChannels, verdict: 'REJECTS', code: 'CONFIG_CHANNEL_PARTICIPANT_DUPLICATE',
  },
  // رمزان عامّان: الحرسُ قائمٌ والعلّةُ لا تُسمّى — دَينٌ مُعلَنٌ T-159 (تبديلُ رمزٍ عقدُ فشل)
  {
    ceiling: 'channels', file: 'channels.yaml', key: 'channels', load: loadChannels,
    verdict: 'REJECTS', code: 'CONFIG_CHANNEL_SPEC', generic: true,
  },
  {
    ceiling: 'safety_categories', file: 'inference.yaml', key: 'required_categories',
    load: loadInference, verdict: 'REJECTS', code: 'CONFIG_INFERENCE_SAFETY', generic: true,
  },
  // خرائطُ يتلاشى فيها التكرارُ في طبقةِ YAML: لا انتفاخَ فلا حاجةَ إلى حرسٍ صوريّ
  {
    ceiling: 'quality_checks', file: 'enterprises.yaml', key: 'quality_checks',
    load: loadEnterprises, verdict: 'COLLAPSES',
    count: (c: any) => Object.keys(c.quality_checks ?? {}).length,
  },
  {
    ceiling: 'quota_resources', file: 'quotas.yaml', key: 'resources', load: loadQuotas,
    verdict: 'COLLAPSES', count: (c: any) => Object.keys(c.resources ?? {}).length,
  },
  {
    ceiling: 'contract_risk_factors', file: 'contracts.yaml', key: 'risk_factors',
    load: loadContracts, verdict: 'COLLAPSES',
    count: (c: any) => Object.keys(c.risk_factors ?? {}).length,
  },
  // أُغلق في W-2026-037: حرسُ تكرارِ الاسمِ في confinement برمزٍ مسمّى — لم يبقَ انتفاخٌ صامتٌ
  {
    ceiling: 'infrastructure_ports', file: 'confinement.yaml', key: 'infrastructure_ports',
    load: loadConfinement, verdict: 'REJECTS', code: 'CONFIG_CONFINEMENT_DUPLICATE',
  },
];
/* eslint-enable @typescript-eslint/no-explicit-any */

/** يُكرَّرُ أوّلُ عنصرٍ تحت مفتاحٍ بكتلتِه كاملةً — لا تُخمَّن إزاحةٌ ولا يُخترع عنصرٌ جديد */
function duplicateFirst(yaml: string, key: string): string {
  const lines = yaml.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*$`).test(l));
  assert.notEqual(at, -1, `مفتاحٌ غيرُ موجودٍ للتكرار: ${key}`);
  let first = at + 1;
  while (first < lines.length
    && ((lines[first] as string).trim() === '' || (lines[first] as string).trim().startsWith('#'))) {
    first += 1;
  }
  assert.ok(first < lines.length, `لا عنصرَ يُكرَّرُ تحت المفتاح: ${key}`);
  const head = lines[first] as string;
  const indent = head.length - head.trimStart().length;
  assert.ok(indent > 0, `عنصرٌ بلا إزاحةٍ تحت المفتاح: ${key}`);
  const isItem = head.trimStart().startsWith('- ');
  const block: string[] = [head];
  for (let i = first + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === '') break;
    const ind = line.length - line.trimStart().length;
    if (ind < indent) break;
    if (ind === indent && (line.trimStart().startsWith('- ') || !isItem)) break;
    block.push(line);
  }
  lines.splice(first, 0, ...block);
  return lines.join('\n');
}

/** نسخةٌ من التهيئة الفعليّة يُكرَّرُ فيها عنصرٌ واحد — والأصلُ لا يُمسّ */
function withDuplicated(row: CensusRow, body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'dup-census-'));
  try {
    cpSync(REAL_CONFIG, dir, { recursive: true });
    const path = join(dir, row.file);
    writeFileSync(path, duplicateFirst(readFileSync(path, 'utf8'), row.key));
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('T-135/DC-01: كلُّ سقفٍ معلنٍ محصورٌ في جدولِ التكرار — لا سقفَ يُضاف بلا حكمٍ مقيس', () => {
  const declared = Object.keys(DECLARATION_CEILINGS).sort();
  const censused = CENSUS.map((r) => String(r.ceiling)).sort();
  assert.deepEqual(censused, declared,
    'سقفٌ معلنٌ بلا صفٍّ في الحصر (أو صفٌّ لسقفٍ لا وجودَ له) — يُقاس حكمُه ويُدرج');
  assert.equal(new Set(censused).size, censused.length, 'صفٌّ مكرَّرٌ لسقفٍ واحدٍ في الحصر');
});

test('T-135/DC-02: قائمةٌ مسقوفةٌ إمّا ترفضُ التكرارَ برمزٍ مسمّى وإمّا لا ينتفخُ عددُها', () => {
  for (const row of CENSUS) {
    const name = String(row.ceiling);
    if (row.verdict === 'REJECTS') {
      withDuplicated(row, (dir) => {
        assert.throws(() => row.load(dir), (error: unknown) => {
          assert.ok(error instanceof SovereignViolation, `${name}: رفضٌ بغيرِ خرقٍ سياديّ`);
          assert.equal(error.code, row.code, `${name}: رمزُ الرفضِ خالف المُعلَن`);
          return true;
        }, `${name}: تكرارٌ لم يُرفض — والسقفُ يعدّ التكرارَ إعلانًا`);
      });
      continue;
    }
    const before = (row.count as (c: never) => number)(row.load(REAL_CONFIG) as never);
    withDuplicated(row, (dir) => {
      const after = (row.count as (c: never) => number)(row.load(dir) as never);
      if (row.verdict === 'COLLAPSES') {
        assert.equal(after, before,
          `${name}: انتفخ العددُ المعلنُ بالتكرار (${before} ⇒ ${after}) — فليس تلاشيًا `
          + 'بل خرقًا: يُكتب له حرسٌ أو يُنقل صفُّه إلى REJECTS');
      } else {
        assert.equal(after, before + 1,
          `${name}: تغيّر الانتفاخُ المُثبَّتُ (${before} ⇒ ${after}) — إن سُدَّ الحرسُ فيُنقل `
          + 'الصفُّ إلى REJECTS برمزِه ويُغلق الدَّينُ T-158 في PROGRESS.md');
      }
    });
  }
});

test('T-135/DC-03: رمزُ حرسِ التكرارِ يُسمّي علّتَه — والعامُّ مُعلَنٌ دَينًا لا مسكوتٌ عنه', () => {
  for (const row of CENSUS) {
    if (row.verdict !== 'REJECTS') {
      assert.equal(row.code, undefined, `${String(row.ceiling)}: صفٌّ لا يرفضُ ولا رمزَ له`);
      continue;
    }
    const code = String(row.code);
    assert.match(code, /^CONFIG_[A-Z0-9_]+$/, `${String(row.ceiling)}: رمزٌ خارجُ صياغةِ النواة`);
    if (row.generic === true) {
      assert.doesNotMatch(code, /DUPLICATE/,
        `${String(row.ceiling)}: رمزٌ يُسمّي التكرارَ لا يُعلَن عامًّا — يُحذف وسمُ generic`);
    } else {
      assert.match(code, /DUPLICATE$/,
        `${String(row.ceiling)}: رمزُ حرسِ تكرارٍ لا يُسمّي علّتَه — يُسمّى أو يُعلَن عامًّا بدَينِه`);
    }
  }
  const generics = CENSUS.filter((r) => r.generic === true).map((r) => String(r.ceiling));
  assert.deepEqual(generics.sort(), ['channels', 'safety_categories'],
    'الرموزُ العامّةُ المُعلَنةُ دَينًا T-159 اثنان لا غير — من زاد عليهما أعلن دَينَه');
});

test('T-135/DC-04: لا رمزَ تكرارٍ يُعاد استعمالُه بين محمّلَين — العلّةُ تُقرأ من الرمز', () => {
  const codes = new Map<string, string[]>();
  for (const entry of readdirSync(LOADER_DIR)) {
    if (!entry.endsWith('.ts')) continue;
    const text = readFileSync(join(LOADER_DIR, entry), 'utf8');
    for (const match of text.matchAll(/'(CONFIG_[A-Z0-9_]*DUPLICATE[A-Z0-9_]*)'/g)) {
      const code = match[1] as string;
      const owners = codes.get(code) ?? [];
      if (!owners.includes(entry)) owners.push(entry);
      codes.set(code, owners);
    }
  }
  const shared = [...codes.entries()].filter(([, owners]) => owners.length > 1);
  assert.deepEqual(shared, [], `رمزُ تكرارٍ في ملفَّين: ${JSON.stringify(shared)}`);
  assert.ok(codes.size >= 29,
    `رموزُ التكرارِ المقيسةُ ${codes.size} دون المقيسِ في الجلسة 68 (29) — حرسٌ حُذف بلا إعلان`);
});
