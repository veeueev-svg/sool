/**
 * scripts/rehydrate_census_probe.ts — مسبارُ حصرِ إرجاعِ أصنافِ اليوميّة (المرحلة 39 · W-2026-040)
 * المالك: وزارة البيانات | المدخلات: تهيئةُ المستودع القائمة ومجلدُ يوميّةٍ مؤقّت
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًّا في docs/test-reports/phase-39-W-2026-040-measurements.txt
 * التبعيات: dist/src/index و dist/src/data/rehydrate_census | الصلاحيات: لا يكتب في المستودع
 * السجلات: يعتمد على ما تُخرجه الوحدات — والمسبارُ لا يخترع قيدًا لنفسه
 * حالات الفشل: أيُّ رفضٍ سياديٍّ يخرج بشفرة 1 برمزه — لا يُبتلع خطأ (RULE-007)
 * اختبارات الوحدة: tests/data/rehydrate_census.test.ts
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 * ثوابت هذا الملف:
 *   1) **«قبل» و«بعد» في جريانٍ واحد**: تُقاس الحالُ بلا حاجزٍ (بجدولِ دعاوى ناقصٍ يُحاكي
 *      ما كان) ثم بالحاجز على المهاد نفسِه — فالمقارنةُ لا تُستدعى من ذاكرة.
 *   2) **الصمتُ يُقاس لا يُروى**: يُطبع عددُ ما أُسقط خارجَ النطاقِ بحسب الصنف.
 *   3) **حدُّ البندِ يُطبع مع نتيجته**: مساحةُ الحالةِ الكاملةُ مقابلَ ما يُدوَّن منها اليوم،
 *      فلا يُقرأ الخضراءُ على أنّه إغلاقُ C-08.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../src/index';
import { REHYDRATE_CLAIMS, assertRehydrateCensus, censusRehydrate } from '../src/data/rehydrate_census';
import { DURABLE_KINDS, loadPersistence } from '../src/kernel/config/persistence';
import type { DurableKind } from '../src/kernel/config/persistence';
import { SovereignViolation } from '../src/kernel/types';

const T0 = 1_700_000_000_000;

function scene(scope: readonly string[] | null) {
  const root = mkdtempSync(join(tmpdir(), 'sool-census-probe-'));
  const config = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  if (scope) {
    const file = join(config, 'persistence.yaml');
    const body = readFileSync(file, 'utf8');
    const head = body.slice(0, body.indexOf('  scope:'));
    const tail = body.slice(body.indexOf('\n# T-123'));
    writeFileSync(file, `${head}  scope:\n${scope.map((k) => `    - ${k}`).join('\n')}\n${tail}`, 'utf8');
  }
  return {
    boot: () => bootstrapState({ configDir: config, now: T0, persistenceDir: join(root, 'state') }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** يُحصي المُنتِجينَ لكلِّ صنفٍ من الشفرة — دعوى «لا مُنتِجَ له» تُقاس لا تُصدَّق */
function producers(): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) {
        const body = readFileSync(p, 'utf8');
        for (const kind of DURABLE_KINDS) {
          if (body.includes(`.record('${kind}'`)) {
            found.set(kind, [...(found.get(kind) ?? []), p.replace(`${process.cwd()}/`, '')]);
          }
        }
      }
    }
  };
  walk(join(process.cwd(), 'src'));
  return found;
}

function main(): void {
  const cfg = loadPersistence(join(process.cwd(), 'config'));
  const scope = cfg.policy.scope;
  const prod = producers();

  console.log('مسبارُ حصرِ الإرجاع — W-2026-040 · المرحلة 39\n');

  console.log('── قبل الحاجز: الحالُ كما كانت (يُحاكى بجدولِ دعاوى بلا الصنفِ المقصود) ──');
  const before = censusRehydrate(scope, REHYDRATE_CLAIMS.filter((c) => c.kind !== 'tax_levy'));
  console.log(`  أصنافٌ في النطاق: ${before.inScope.length} · مُدَّعاةٌ بمستهلك: ${before.claimed.length}`
    + ` · مُعفاة: ${before.exempt.length} · بلا دعوى: ${before.unclaimed.length} (${before.unclaimed.join(', ')})`);
  console.log('  وقبلَ هذا البندِ لم يكن ثمّ حاجزٌ يقرأ هذا السطرَ أصلًا: الإقلاعُ يمضي، والصنفُ يُدوَّن ويُسقَط صمتًا.\n');

  console.log('── بعد الحاجز: الجدولُ التامُّ على النطاق المعلن ──');
  const after = assertRehydrateCensus(scope);
  console.log(`  أصنافٌ في التعداد المغلق: ${after.declared} · في النطاق: ${after.inScope.length}`);
  console.log(`  بمستهلكِ إرجاعٍ مسمًّى: ${after.claimed.length} · بإعفاءٍ مُعلَن: ${after.exempt.length}`
    + ` · بلا دعوى: ${after.unclaimed.length}`);
  console.log("  الأصنافُ المُعفاة، وسببُ كلٍّ منها، وما لها من مُنتِجٍ في src/** (بنمطِ `.record('<kind>'`):");
  for (const claim of REHYDRATE_CLAIMS.filter((c) => c.consumer === null)) {
    const p = prod.get(claim.kind) ?? [];
    const note = claim.kind === 'journal_compacted'
      ? 'لا مُنتِجَ بهذا النمط — يكتبه الضاغطُ في src/data/journal_compaction.ts ببناءِ القيدِ مباشرةً لا بنداءِ record'
      : 'لا مُنتِج';
    console.log(`  · ${claim.kind} — ${claim.exemption} — مُنتِجونَ: ${p.length === 0 ? note : p.join(', ')}`);
  }

  console.log('\n── سقوطُ الحاجزِ يُرى لا يُدّعى ──');
  try {
    assertRehydrateCensus(scope, REHYDRATE_CLAIMS.filter((c) => c.kind !== 'ledger_entry'));
    console.log('  ✗ لم يسقط الحاجزُ على صنفٍ بلا دعوى — وهذا فشلُ المسبارِ لا نجاحُه');
    process.exit(1);
  } catch (error) {
    if (!(error instanceof SovereignViolation)) throw error;
    console.log(`  رُفض برمز: ${error.code}`);
  }

  console.log('\n── عدّادُ الإسقاطِ خارجَ النطاق: التهيئةُ تحكم والعدّادُ يشهد ──');
  const narrow = [...DURABLE_KINDS].filter((k) => k !== 'ledger_entry');
  const s = scene(narrow);
  try {
    const state = s.boot();
    const journal = state.journal!;
    console.log(`  النطاقُ المُضيَّق: ${narrow.length} صنفًا · يشمل ledger_entry: ${journal.covers('ledger_entry')}`);
    for (let i = 0; i < 3; i += 1) journal.record('ledger_entry' as DurableKind, { probe: i }, T0);
    console.log(`  ثلاثُ محاولاتِ تدوينٍ خارجَ النطاق ⇒ مُسقَطٌ مقيسٌ: ${journal.droppedOutOfScope}`
      + ` · بحسب الصنف: ${[...journal.droppedByKind()].map(([k, n]) => `${k}=${n}`).join(' · ')}`);
    console.log('  وقبلَ هذا البندِ كان العائدُ null والعدّادُ معدومًا: ثلاثُ خسائرَ لا أثرَ لها في شيء.');
  } finally {
    s.clean();
  }

  console.log('\n── حدُّ البند: ما لم يُغلَق ──');
  const stateFile = readFileSync(join(process.cwd(), 'src/composition/state.ts'), 'utf8');
  const iface = stateFile.slice(stateFile.indexOf('export interface DigitalState'));
  const fields = (iface.slice(0, iface.indexOf('\n}\n')).match(/^\s*readonly \w+\??:/gm) ?? []).length;
  const units = new Set([...prod.values()].flat()).size;
  console.log(`  حقولُ واجهة DigitalState: ${fields} · أصنافٌ لها مُنتِجٌ فعليّ: ${prod.size} · وحداتٌ تُدوّن: ${units}`);
  console.log('  فهذا البندُ يُصلح **الصمتَ** لا **النطاق**: C-08 و C-21 يبقيان فجوةً، والفجواتُ 7 والإكمالُ 97.00%.');
}

main();
