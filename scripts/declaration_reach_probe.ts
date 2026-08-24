/**
 * scripts/declaration_reach_probe.ts — مسبارُ مدى الحصر: ما يُحصى مقابل ما يُحمَّل (المرحلة 39، البند T-133)
 * المالك: القيّم على المستودع | المدخلات: `config/` و`deploy/` قراءةً، ومجلداتٌ منسوخةٌ في tmpdir
 * المخرجات: أسطرٌ مقروءة تُطبع وتُحفظ خامًا في `docs/audit/measurements/phase-39-T133.txt`
 * التبعيات: src/index.ts (`bootstrapState`) · src/kernel/config/* · src/staging/manifest.ts
 * الصلاحيات: قراءةُ المستودع وكتابةٌ في tmpdir وحده — لا شبكة ولا سجل
 * السجلات: لا يكتب في اليوميّة — القياسُ لا يُلوّث الدفتر
 * حالات الفشل: أيُّ خطأٍ غيرِ سياديٍّ يخرج بشفرة 1 — ولا يُبتلع خطأ (RULE-007)
 * اختبارات الوحدة: tests/kernel/declaration_reach.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0036-declaration-reach.md
 *
 * ثوابت هذه الوحدة:
 *   1) **المُحمَّلُ يُقاس بالتقاطِه لا باستنتاجِه**: تُلفُّ `loadYamlFile` نفسُها فيُسجَّل كلُّ
 *      مسارٍ **قرأته الدولةُ فعلًا** في الإقلاع وفي محمّلات النشر. ومن أحصى مواضعَ النداء
 *      في الشفرة بعينه أحصى ما ظنّ لا ما جرى.
 *   2) **الفرقُ يُقاس في الاتجاهين**: مُحمَّلٌ غيرُ مُحصًى **بابٌ** بلا حرَس، ومُحصًى غيرُ
 *      مُحمَّلٍ **ثمنٌ** يُدفع من الميزانيّة بلا مقابل. وكلاهما يُعلن.
 *   3) **المسبارُ لا يحكم**: يطبع أرقامًا ورموزَ رفضٍ كما وقعت. والحكمُ في ADR وتقريرِ الاختبار.
 *   4) **لا يُلمس المستودع**: كلُّ نفخٍ في نسخةٍ في tmpdir تُحذف في النهاية.
 */
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { bootstrapState } from '../src/index';
import { resolveConfigDir } from '../src/kernel/config/paths';
import * as yamlModule from '../src/kernel/config/yaml';
import { loadYamlFile, parseSimpleYaml } from '../src/kernel/config/yaml';
import {
  countNodes, guardDeclarationDirectoryBytes, loadedDeclaration, resetLoadedDeclaration,
} from '../src/kernel/config/declaration_reach';
import { censusDeclaration } from '../src/kernel/config/declaration_census';
import { loadChaos } from '../src/kernel/config/chaos';
import { loadStaging } from '../src/kernel/config/staging';
import { loadProduction } from '../src/kernel/config/production';
import { loadStagingManifest, loadDeclaredRunbook } from '../src/staging/manifest';
import { loadProductionManifest } from '../src/production/production_manifest';
import { repoRoot } from './declaration_cases';

/** حجمُ ملفِّ النفخِ الواحد: تحت سقفِ بايتات الملف (65536) فلا يُردّ فرادى */
const PAD_BYTES = 60_000;

const out: string[] = [];
function say(line: string): void {
  out.push(line);
  process.stdout.write(`${line}\n`);
}

/** رمزُ الرفض إن وقع، أو `مرّ` — والمسبارُ لا يُخفي مرورًا ولا رفضًا */
function verdict(run: () => void): string {
  try {
    run();
    return 'مرّ';
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code ? `رُفض: ${code}` : `خطأ: ${(error as Error).message.slice(0, 60)}`;
  }
}

/** ملفُّ نفخٍ صالحُ البنية: مفتاحٌ واحدٌ وقيمةٌ طويلة — يزيد البايتاتَ بعُقدةٍ واحدة */
function pad(path: string, bytes: number): void {
  writeFileSync(path, `pad: "${'ب'.repeat(Math.floor(bytes / 2))}"\n`, 'utf8');
}

/** ما يراه الحصرُ اليومَ: `*.yaml` مباشرةً في المجلد */
function censusToday(dir: string): { files: number; bytes: number; nodes: number } {
  const names = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
  let bytes = 0;
  let nodes = 0;
  for (const name of names) {
    bytes += statSync(join(dir, name)).size;
    nodes += countNodes(parseSimpleYaml(readFileSync(join(dir, name), 'utf8')));
  }
  return { files: names.length, bytes, nodes };
}

/** كلُّ ملفِّ YAML في الشجرة — الحقيقةُ التي يُقاس عليها ما يراه الحصر */
function walkYaml(dir: string, depth = 0): string[] {
  if (depth > 8) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkYaml(path, depth + 1));
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) found.push(path);
  }
  return found.sort();
}

function bytesOf(paths: readonly string[]): number {
  return paths.reduce((sum, p) => sum + statSync(p).size, 0);
}

function nodesOf(paths: readonly string[]): number {
  return paths.reduce((sum, p) => sum + countNodes(loadYamlFile(p)), 0);
}

// ═══ السؤال 1: ما حمّلته الدولةُ فعلًا مقابل ما أحصاه الحصر ═══
const loaded = new Set<string>();
const patch = yamlModule as unknown as { loadYamlFile: (p: string) => Record<string, unknown> };
const original = patch.loadYamlFile;
patch.loadYamlFile = (path: string) => {
  loaded.add(path);
  return original(path);
};

const configDir = resolveConfigDir();
bootstrapState({ configDir, now: Date.parse('2026-08-25T00:00:00Z') });
const bootOnly = new Set(loaded);
loadStagingManifest(loadStaging(configDir));
loadProductionManifest(loadProduction(configDir));
for (const name of ['halt-and-recover', 'incident-response', 'limited-operation']) {
  loadDeclaredRunbook(name);
}
patch.loadYamlFile = original;

const census = censusToday(configDir);
const censused = new Set(readdirSync(configDir).filter((f) => f.endsWith('.yaml'))
  .map((f) => join(configDir, f)));
const loadedNotCensused = [...loaded].filter((p) => !censused.has(p)).sort();
const censusedNotLoaded = [...censused].filter((p) => !loaded.has(p)).sort();

say('## 1) ما يُحصى مقابل ما يُحمَّل — مقيسًا بلفِّ `loadYamlFile` لا باستنتاج');
say('');
say('| ما قِيس | العدد | البايتات | العُقد |');
say('|---|---|---|---|');
const now = censusDeclaration(configDir);
say(`| القاعدةُ القديمة: \`*.yaml\` مباشرةً في \`config/\` (محاكاةً) | ${census.files} | ${census.bytes} | ${census.nodes} |`);
say(`| الحصرُ اليومَ: المجلدُ وفرعيّاتُه بلاحقتَين | ${now.files} | ${now.bytes} | ${now.nodes} |`);
say(`| حمّلته الدولةُ في الإقلاع | ${bootOnly.size} | ${bytesOf([...bootOnly])} | ${nodesOf([...bootOnly])} |`);
say(`| حمّلته الدولةُ ومحمّلاتُ النشر | ${loaded.size} | ${bytesOf([...loaded])} | ${nodesOf([...loaded])} |`);
say(`| **مُحمَّلٌ ولا يُحصى** (بابٌ بلا حرَس) | **${loadedNotCensused.length}** | **${bytesOf(loadedNotCensused)}** | **${nodesOf(loadedNotCensused)}** |`);
say(`| **مُحصًى ولا يُحمَّل** (ثمنٌ بلا مقابل) | **${censusedNotLoaded.length}** | **${bytesOf(censusedNotLoaded)}** | — |`);
say('');
say('**المُحمَّلُ الذي لا يراه الحصرُ اليومَ:**');
for (const p of loadedNotCensused) say(`- \`${relative(repoRoot(), p)}\` — ${statSync(p).size}B`);
say('');
say('**المُحصى الذي لا يُحمَّل عبر `loadYamlFile`:**');
for (const p of censusedNotLoaded) say(`- \`${relative(repoRoot(), p)}\` — ${statSync(p).size}B`);
say('');

// ═══ السؤال 2: مجلدٌ فرعيٌّ داخل مجلد التهيئة ═══
const nested = mkdtempSync(join(tmpdir(), 'reach-nested-'));
cpSync(configDir, nested, { recursive: true });
mkdirSync(join(nested, 'nested'));
for (let i = 0; i < 4; i += 1) pad(join(nested, 'nested', `pad-${i}.yaml`), PAD_BYTES);
const nestedCensus = censusToday(nested);
const nestedTruth = walkYaml(nested);
say('## 2) مجلدٌ فرعيٌّ: 240000B من YAML داخل مجلد التهيئة');
say('');
say(`- الحقيقةُ: ${nestedTruth.length} ملفًا · ${bytesOf(nestedTruth)}B`);
say(`- ما يراه الحصرُ: ${nestedCensus.files} ملفًا · ${nestedCensus.bytes}B`);
say(`- **الفرقُ: ${bytesOf(nestedTruth) - nestedCensus.bytes}B لا يراها سقفُ المجموع (262144)**`);
say(`- إقلاعُ الدولة على هذا المجلد: **${verdict(() => { bootstrapState({ configDir: nested, now: 1 }); })}**`);
say('');

// ═══ السؤال 3: نداءُ محمّلٍ مفردٍ على إعلانٍ فوق سقفِ المجموع ═══
const flat = mkdtempSync(join(tmpdir(), 'reach-flat-'));
cpSync(configDir, flat, { recursive: true });
for (let i = 0; i < 4; i += 1) pad(join(flat, `pad-${i}.yaml`), PAD_BYTES);
const flatCensus = censusToday(flat);
say('## 3) نداءُ محمّلٍ مفردٍ: الإعلانُ نفسُه يُرفض في طريقٍ ويُقبل في طريق');
say('');
say(`- المجلدُ: ${flatCensus.files} ملفًا · **${flatCensus.bytes}B** (فوق سقفِ المجموع 262144)`);
say(`- إقلاعُ الدولة (\`bootstrapState\`): **${verdict(() => { bootstrapState({ configDir: flat, now: 1 }); })}**`);
say(`- نداءُ محمّلٍ مفردٍ (\`loadChaosConfig\`): **${verdict(() => { loadChaos(flat); })}**`);
say(`- قراءةُ ملفٍ مباشرةً (\`loadYamlFile\`): **${verdict(() => { loadYamlFile(join(flat, 'chaos.yaml')); })}**`);
say('');

// ═══ السؤال 3ب: دفترُ ما حُمِّل — سقفُ العُقد يقع بلا إقلاعٍ ولا مجلدٍ منفوخ ═══
const ledgerDir = mkdtempSync(join(tmpdir(), 'reach-ledger-'));
for (let f = 0; f < 4; f += 1) {
  const rows = Array.from({ length: 3000 }, (_, i) => `  - عنصر-${f}-${i}`).join('\n');
  writeFileSync(join(ledgerDir, `nodes-${f}.yaml`), `items:\n${rows}\n`, 'utf8');
}
resetLoadedDeclaration(ledgerDir);
say('## 3ب) دفترُ ما حُمِّل: أربعةُ ملفاتٍ كلُّ واحدٍ تحت سقفِه، والمجموعُ فوق سقفِ العُقد');
say('');
say(`- المجلدُ: 4 ملفاتٍ · ${bytesOf(walkYaml(ledgerDir))}B (تحت سقفِ المجموع) · 3001 عُقدةً لكلِّ ملف`);
for (let f = 0; f < 4; f += 1) {
  const v = verdict(() => { loadYamlFile(join(ledgerDir, `nodes-${f}.yaml`)); });
  const led = loadedDeclaration(ledgerDir);
  say(`- القراءةُ ${f + 1}: **${v}** — الدفترُ بعدها: ${led.files} ملفًا · ${led.nodes} عُقدةً`);
}
rmSync(ledgerDir, { recursive: true, force: true });
say('');

// ═══ السؤال 5: كلفةُ الحرَس في موضع القراءة ═══
const REPEATS = 5;
const dirTimes: number[] = [];
for (let i = 0; i < REPEATS; i += 1) {
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 24; k += 1) guardDeclarationDirectoryBytes(configDir);
  dirTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
const bootTimes: number[] = [];
for (let i = 0; i < REPEATS; i += 1) {
  const t0 = process.hrtime.bigint();
  bootstrapState({ configDir, now: 1 });
  bootTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
const median = (xs: number[]): string => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(2);
say('## 5) ثمنُ الحرَس عند كلِّ قراءةٍ — مقيسًا لا مقدَّرًا');
say('');
say(`- ${24} نداءً لحرَس المجلد (مشيٌ وإحصاءُ أحجامٍ بلا تحليل): وسيطُ **${median(dirTimes)}ms** لكلِّ ${24} نداءً (${REPEATS} تشغيلات)`);
say(`- إقلاعُ الدولة كاملًا بعد التركيب: وسيطُ **${median(bootTimes)}ms** · المدى ${Math.min(...bootTimes).toFixed(2)}–${Math.max(...bootTimes).toFixed(2)}ms`);
const docs = walkYaml(configDir).map((p) => parseSimpleYaml(readFileSync(p, 'utf8')));
const nodeTimes: number[] = [];
for (let i = 0; i < REPEATS; i += 1) {
  const t0 = process.hrtime.bigint();
  for (const doc of docs) countNodes(doc);
  nodeTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
say(`- عدُّ العُقد لكلِّ ما يُقرأ في الإقلاع (${docs.length} مستندًا): وسيطُ **${median(nodeTimes)}ms**`);
say('- خطُّ الأساس المُثبَت في الجلسة 49 قبل هذا الحرَس: 8.3–10.6ms (مقيسٌ في مسبار الكلفة)');
say('');

// ═══ السؤال 4: لاحقةٌ أخرى ═══
const ext = mkdtempSync(join(tmpdir(), 'reach-ext-'));
cpSync(configDir, ext, { recursive: true });
pad(join(ext, 'extra.yml'), PAD_BYTES);
say('## 4) لاحقةٌ أخرى: ما يقرؤه المحمّلُ ولا يعدُّه الحصر');
say('');
say(`- \`extra.yml\` حجمُه ${statSync(join(ext, 'extra.yml')).size}B`);
say(`- القاعدةُ القديمة كانت ترى: ${censusToday(ext).bytes}B (لا تشمله)`);
say(`- الحصرُ اليومَ يرى: ${censusDeclaration(ext).bytes}B (تشمله)`);
say(`- قراءةُ الملفِّ نفسِه بـ\`loadYamlFile\`: **${verdict(() => { loadYamlFile(join(ext, 'extra.yml')); })}**`);
say('');

for (const dir of [nested, flat, ext]) rmSync(dir, { recursive: true, force: true });

const target = process.argv[2];
if (target) writeFileSync(target, `${out.join('\n')}\n`, 'utf8');
