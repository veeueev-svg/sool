/**
 * scripts/declaration_cost_probe.ts — مسبارُ كلفةِ الإعلان عند حدِّ كلِّ سقف (المرحلة 39، البندان T-132 و T-130)
 * المالك: القيّم على المستودع | المدخلات: مجلدُ تهيئةٍ منسوخٌ في tmpdir (لا يُلمس المستودع)
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًا في `docs/audit/measurements/phase-39-T130.txt`
 * التبعيات: scripts/declaration_cases.ts · src/index.ts (`bootstrapState`)
 * الصلاحيات: قراءةُ `config/` وكتابةٌ في tmpdir وحده — لا شبكة ولا سجل
 * السجلات: لا يكتب في اليوميّة — القياسُ لا يُلوّث الدفتر
 * حالات الفشل: أيُّ خطأٍ غيرِ سياديّ يخرج بشفرة 1 — ولا يُبتلع خطأ (RULE-007)
 * اختبارات الوحدة: tests/kernel/config_budget.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0034-config-declaration-budget.md
 * ثوابت هذه الوحدة:
 *   1) **السقفُ يُقاس عند حدِّه لا فوقه**: T-132 يسأل: ماذا تكلّف الدولةُ إن بلغ كلُّ إعلانٍ
 *      سقفَه **دون تجاوزه**؟ فيُنفخ كلُّ سقفٍ إلى `المعلن اليوم ⇒ السقف` بالضبط، ويُقلع
 *      {@link bootstrapState} فعلًا. مرورُ الإقلاع هو الجواب، وزمنُه هو الثمن.
 *   2) **المجموعُ يُقاس مجتمعًا لا مجموعَ آحادٍ**: كلفةُ ثمانيةَ عشرَ سقفًا معًا ليست حاصلَ
 *      جمعِ كلفاتٍ منفردة، وسقفُ المجموع في T-130 لا يُشتقّ إلّا من الحالة المجتمعة.
 *      فتُقاس حالةٌ واحدةٌ تبلغ فيها **كلُّ** القوائم سقوفَها في وقتٍ واحد.
 *   3) **الزمنُ يُكرَّر ويُوسَّط بالوسيط لا بالمتوسّط**: الإقلاعُ يُعاد {@link REPEATS} مرّاتٍ
 *      ويُؤخذ الوسيطُ، فقفزةُ جامعِ المهملات لا تُصبح «قياسًا».
 *   4) **الفشلُ قياسٌ أيضًا**: نفخٌ يبلغ سقفَه قد يوقعه حاجزٌ آخرُ (مرجعٌ · مجموعُ نسبٍ ·
 *      حدُّ تشغيل). فيُطبع رمزُ الرفض في مكان الزمن ولا يُخفى — وإلّا صار غيابُ الرقم دعوى.
 *   5) **القياسُ لا يمرّ بالحاجز الجديد**: يُقاس بعد تركيب سقفِ المجموع، فيُعلن الحاجزُ
 *      نفسُه إن أوقع حالةً — وذاك مقصود: من يقرأ يرى أنّ السقفَ الذي وُضع يقع فعلًا.
 */
import {
  cpSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../src/index';
import { resolveConfigDir } from '../src/kernel/config/paths';
import { parseSimpleYaml } from '../src/kernel/config/yaml';
import { readFileSync } from 'node:fs';
import { DECLARATION_CEILINGS } from '../src/kernel/config/declaration_limits';
import {
  OPEN_CASES, PRIOR_CASES, countNodes, declaredCount, inflate, readCtx, refusal, repoRoot,
} from './declaration_cases';

/** مرّاتُ إعادةِ الإقلاع في كلِّ حالة — الوسيطُ منها هو المُعلن */
const REPEATS = 3;

/** كلُّ السقوف الثمانيةَ عشرَ: ستةَ عشرَ فُتحت في T-129 واثنان سبقاها في T-75 */
const ALL_CASES = [...OPEN_CASES, ...PRIOR_CASES];

const out: string[] = [];
function say(line: string): void {
  out.push(line);
  process.stdout.write(`${line}\n`);
}

/** حجمُ مجلد التهيئة بالبايت وعددُ ملفاته وعددُ عُقده المعلنة — ثلاثةُ أرقامٍ تُقاس معًا */
function measureDir(dir: string): { bytes: number; files: number; nodes: number; largest: number } {
  const names = readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
  let bytes = 0;
  let nodes = 0;
  let largest = 0;
  for (const name of names) {
    const size = statSync(join(dir, name)).size;
    bytes += size;
    if (size > largest) largest = size;
    nodes += countNodes(parseSimpleYaml(readFileSync(join(dir, name), 'utf8')));
  }
  return { bytes, files: names.length, nodes, largest };
}

/** الوسيطُ لا المتوسّط: قفزةٌ واحدةٌ لا تُزيح القياس */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** زمنُ الإقلاع (وسيطًا) وأثرُه في الكومة — أو رمزُ الرفض إن لم تُقلع الدولة */
function boot(configDir: string): { ms: number; heapMb: number; verdict: string } {
  const times: number[] = [];
  let heapMb = 0;
  for (let i = 0; i < REPEATS; i += 1) {
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    try {
      bootstrapState({ configDir, now: 1_760_000_000_000 });
    } catch (error) {
      return { ms: -1, heapMb: 0, verdict: refusal(error) };
    }
    times.push(performance.now() - t0);
    heapMb = Math.max(heapMb, (process.memoryUsage().heapUsed - before) / (1024 * 1024));
  }
  return { ms: median(times), heapMb, verdict: 'أقلعت' };
}

/** ينسخ التهيئة إلى tmpdir، ينفخ ما يُطلب، ثمّ يُقيس ويحذف — لا يلمس المستودعَ أبدًا */
function withInflated(
  configDir: string, cases: readonly (typeof ALL_CASES)[number][],
  ctx: ReturnType<typeof readCtx>, body: (dir: string) => void,
): void {
  const tmp = mkdtempSync(join(tmpdir(), 'sool-cost-'));
  try {
    const dir = join(tmp, 'config');
    cpSync(configDir, dir, { recursive: true });
    for (const item of cases) {
      const path = join(dir, item.file);
      const ceiling = DECLARATION_CEILINGS[item.ceiling as keyof typeof DECLARATION_CEILINGS];
      const today = declaredCount(path, item.key);
      if (today < 0) throw new Error(`مفتاحٌ غيرُ موجود: ${item.key} في ${item.file}`);
      const need = ceiling - today;
      if (need > 0) inflate(path, item.key, item.entry, ctx, need);
    }
    body(dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const configDir = resolveConfigDir();
  const ctx = readCtx(configDir);

  say(`# مسبارُ كلفةِ الإعلان — البندان T-132 و T-130 (${new Date().toISOString()})`);
  say(`# الأمر: npm run probe:declaration-cost · الإقلاع: ${REPEATS} مرّاتٍ لكلِّ حالةٍ (الوسيط)`);
  say(`# النواة: node ${process.version} · جذرُ المستودع: ${repoRoot() !== '' ? 'مُحدَّد' : '?'}`);
  say('');

  say('## أوّلًا: خطُّ الأساس — الإعلانُ القائم اليوم');
  say('');
  const base = measureDir(configDir);
  const baseBoot = boot(configDir);
  say(`| ملفاتُ التهيئة | ${base.files} |`);
  say('|---|---|');
  say(`| مجموعُ البايتات | ${base.bytes}B |`);
  say(`| أكبرُ ملفٍ | ${base.largest}B |`);
  say(`| العُقدُ المعلنة | ${base.nodes} |`);
  say(`| زمنُ الإقلاع (وسيطًا من ${REPEATS}) | ${baseBoot.ms.toFixed(1)}ms |`);
  say(`| أثرُ الإقلاع في الكومة | ${baseBoot.heapMb.toFixed(2)}MB |`);
  say(`| الحكم | ${baseBoot.verdict} |`);
  say('');

  say('## ثانيًا: سقفٌ سقفٌ — كلُّ قائمةٍ تُنفخ إلى حدِّها وحدَها');
  say('');
  say('| السقف | حدُّه | المعلن اليوم | بايتاتُ التهيئة | العُقد | زمنُ الإقلاع | الكومة | الحكم |');
  say('|---|---|---|---|---|---|---|---|');
  let bootedAlone = 0;
  let refusedAlone = 0;
  let worstMs = baseBoot.ms;
  let worstName = '(خطُّ الأساس)';
  for (const item of ALL_CASES) {
    const ceiling = DECLARATION_CEILINGS[item.ceiling as keyof typeof DECLARATION_CEILINGS];
    const today = declaredCount(join(configDir, item.file), item.key);
    withInflated(configDir, [item], ctx, (dir) => {
      const m = measureDir(dir);
      const b = boot(dir);
      if (b.ms < 0) refusedAlone += 1;
      else {
        bootedAlone += 1;
        if (b.ms > worstMs) { worstMs = b.ms; worstName = item.ceiling; }
      }
      const msCell = b.ms < 0 ? '—' : `${b.ms.toFixed(1)}ms`;
      const heapCell = b.ms < 0 ? '—' : `${b.heapMb.toFixed(2)}MB`;
      say(`| ${item.ceiling} | ${ceiling} | ${today} | ${m.bytes}B | ${m.nodes}`
        + ` | ${msCell} | ${heapCell} | ${b.verdict} |`);
    });
  }
  say('');
  say(`السقوفُ المقيسة: ${ALL_CASES.length} · أقلعت عند حدِّها: ${bootedAlone}`
    + ` · رُفضت عند حدِّها: ${refusedAlone}`);
  say(`أبطأُ حالةٍ منفردة: ${worstName} بـ${worstMs.toFixed(1)}ms`
    + ` (خطُّ الأساس ${baseBoot.ms.toFixed(1)}ms)`);
  say('');

  say('## ثالثًا: الحالةُ المجتمعة — كلُّ السقوف عند حدِّها في وقتٍ واحد');
  say('');
  withInflated(configDir, ALL_CASES, ctx, (dir) => {
    const m = measureDir(dir);
    const b = boot(dir);
    say(`| مجموعُ البايتات | ${m.bytes}B (×${(m.bytes / base.bytes).toFixed(1)} عن الأساس) |`);
    say('|---|---|');
    say(`| أكبرُ ملفٍ | ${m.largest}B (×${(m.largest / base.largest).toFixed(1)}) |`);
    say(`| العُقدُ المعلنة | ${m.nodes} (×${(m.nodes / base.nodes).toFixed(1)}) |`);
    const msCell = b.ms < 0 ? '—' : `${b.ms.toFixed(1)}ms (×${(b.ms / baseBoot.ms).toFixed(1)})`;
    say(`| زمنُ الإقلاع | ${msCell} |`);
    say(`| أثرُ الإقلاع في الكومة | ${b.ms < 0 ? '—' : `${b.heapMb.toFixed(2)}MB`} |`);
    say(`| الحكم | ${b.verdict} |`);
    say('');
    say('**وهذه الحالةُ هي أساسُ سقوفِ T-130**: ما لا تبلغه الحالةُ المجتمعةُ لا يُسقَف به،'
      + ' وما تبلغه يُسقَف فوقه بمدًى معلنٍ لا بتقديرٍ مستحسَن.');
  });
  say('');
  say('**قياسُ منفّذٍ حتى يعيده المدقّق.**');

  const target = process.argv[2];
  if (target) writeFileSync(target, `${out.join('\n')}\n`, 'utf8');
}

main();
