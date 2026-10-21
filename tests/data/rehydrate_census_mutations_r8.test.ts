/**
 * تطفيراتُ الجولةِ الثامنة — W-2026-040 (علاجُ عيوبِ مجلسِ المراجعةِ الرابعة · محضر
 * `docs/work/council/W-2026-040-4.json` · اكتشافُ الصفِّ `COUNCIL4_W040_SPLIT_REJECTED`).
 *
 * العيوبُ المسماةُ التي يُقيسُها كلُّ وجهٍ هنا — خامُّ gpt وgrok بحروفِهِ:
 *   - `EXEMPTION_RUNTIME_GUARD_NOT_DOMINATING_ALL_REHYDRATION_PATHS` (gpt · أكّده grok):
 *     الحارسُ التشغيليُّ لتكذيبِ الإعفاءِ كان داخلَ مسلكِ إرجاعٍ واحدٍ لا عندَ نقطةِ القراءةِ
 *     المشتركةِ — يُقاسُ سلوكًا في الأسفلِ (read() يُكذِّبُ الإعفاءَ بأيِّ قارئٍ).
 *   - `RC07_HEX_BIGINT_ZERO_AND_SKIPS_CENSUS` و`RC07_HEX_BIGINT_ZERO_OR_FALSE_REJECT` (grok):
 *     حرفيُّ BigInt السداسيُّ يُحسَبُ قيمةً لا نصًّا — الوجهُ السالبُ يسقطُ والحقيُّ يُخضِرّ.
 *   - `RC07_SHADOWED_NAN_OR_SKIPS_CENSUS` و`RC07_SHADOWED_UNDEFINED_OR_SKIPS_CENSUS` (grok):
 *     المعرّفُ المظلَّلُ مجهولٌ لا حرفيٌّ عالميٌّ.
 *   - نداءٌ ميتٌ يُعَدُّ حيًّا (grok): catch لكتلةٍ لا ترمي · break مُسمّى · default مطابقٌ لبندٍ.
 *   - `GENERIC_BIND_ESCAPES_TYPED_PRODUCER_NEGATION` · `GENERIC_DURABLEKIND_PARAM_UNSEEN` ·
 *     `SUBCLASS_BIND_ESCAPES_TYPED_PRODUCER_NEGATION` (grok): اتجاهُ الإسنادِ في نفيِ المنتِجِ.
 *   - `AS_UNKNOWN_AS_STRUCTURAL_RECORD_GREENS_STATIC_GATE` (grok): تحويلُ التحويلِ يُتتبَّعُ
 *     تعبيرًا — والظهورُ في `src/**` يُقاسُ على البوابةِ الساكنةِ لا على النيةِ.
 *   - `READ_CENSUS_REMAPPED_AS_COMPACTION_TAMPER` (grok): رمزُ الحصرِ يُمرَّر في الضغطِ لا
 *     يُحَرَّف — يُقاسُ في اختبارِ الضغطِ (`journal_compaction.test.ts`) ومعه الوجهُ هنا.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateRoot, patch } from './rehydrate_census_harness';
import { SovereignViolation } from '../../src/kernel/types';
import { StateJournal } from '../../src/data/persistence';

const INDEX = 'src/index.ts';
const PERSISTENCE = 'src/data/persistence.ts';
const CENSUS_CALL = 'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);';
const SCOPE = 'assertRehydrateCensus(persistenceConfig.policy.scope)';

/** دالّةٌ تُلحَقُ بـ`persistence.ts` بمُستقبِلٍ من نوعِ اليوميّةِ الحقيقيِّ `DurableSink` */
const sink = (name: string, body: readonly string[]): ((root: string) => void) => (root) =>
  appendFileSync(join(root, PERSISTENCE), [`export function ${name}(j: DurableSink): void {`, ...body, '}', ''].join('\n'));

type Face = { readonly code: string; readonly why: string; readonly mutate: (root: string) => void };

const NEGATIVE: readonly Face[] = [
  // ── حرفيّاتُ BigInt السداسية: القيمةُ تُحسَبُ لا تُقرأُ نصًّا (RC07_HEX_BIGINT_ZERO_*) ──
  { code: 'RC-07', why: '`0x0n &&` — النصُّ السداسيُّ لا يُطبَّعُ إلى «0n» فيسقطُ الحاجزُ والنداءُ لا يُنفَّذ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `if (journal) 0x0n && ${SCOPE};`) },
  { code: 'RC-07', why: '`0x00n &&` — سداسيٌّ بحشوٍ لا يُطابِقُ النصَّ «0n»',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `if (journal) 0x00n && ${SCOPE};`) },
  // ── التظليلُ: المعرّفُ المظلَّلُ مجهولٌ لا حرفيٌّ عالميٌّ (RC07_SHADOWED_*_OR_SKIPS_CENSUS) ──
  { code: 'RC-07', why: "`const NaN = 1` ثمّ `NaN ||` — ربطٌ محليٌّ صادقٌ فالنداءُ لا يُنفَّذ والحاجزُ كان يخضرُّ",
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, 'const NaN = 1;\n  if (journal) NaN || ' + SCOPE + ';') },
  { code: 'RC-07', why: "`const undefined = 1` ثمّ `undefined ||` — الوجهُ نفسُه للمعدومِ المظلَّلِ",
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, 'const undefined = 1;\n  if (journal) undefined || ' + SCOPE + ';') },
  // ── نداءٌ ميتٌ يُعَدُّ حيًّا: أشكالُ النقلِ غيرِ المشروطِ (grok §4) ──
  { code: 'RC-07', why: '`try { const marker = 1; } catch { census() }` — إعلانٌ محضٌ لا يرمي فالـcatch لا يُنفَّذ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      'try { const marker = 1; } catch { ' + SCOPE + '; }\n  ' + CENSUS_CALL) },
  { code: 'RC-07', why: '`skipCensus: { break skipCensus; census() }` — خروجٌ مُسمًّى يعبرُ ما بعدَه',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      'skipCensus: { break skipCensus; if (journal) ' + SCOPE + '; }\n  ' + CENSUS_CALL) },
  { code: 'RC-07', why: '`switch (0) { case 0: break; default: census() }` — default مطابقٌ فلا يُدخلُ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      'switch (0) { case 0: break; default: if (journal) ' + SCOPE + '; }\n  ' + CENSUS_CALL) },
  // ── نفيُ المنتِجِ: اتجاهُ الإسنادِ لا الشكلُ (GENERIC_* · SUBCLASS_*) ──
  { code: 'RC-14', why: "ربطٌ على معاملٍ عامٍّ `J extends StateJournal` — مرجعٌ هاربٌ والمعاملُ يوميّةٌ قطعًا (GENERIC_BIND_ESCAPES_TYPED_PRODUCER_NEGATION)",
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export function mutantR8GenericBind<J extends StateJournal>(j: J): void {',
      '  const f = j.record.bind(j);', "  f('archive_snapshot', {});", '}', ''].join('\n')) },
  { code: 'RC-14', why: 'وسيطُ الصنفِ `DurableKind` مجهولُ الصنفِ — نداءٌ لا يُرى والمجهولُ لا يؤيّدُ الإعفاء (GENERIC_DURABLEKIND_PARAM_UNSEEN)',
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export function mutantR8GenericKind<J extends StateJournal>(j: J, k: DurableKind): void {',
      '  j.record(k, {});', '}', ''].join('\n')) },
  { code: 'RC-14', why: 'ربطٌ على صنفٍ فرعيٍّ `extends StateJournal` — منتجٌ بلا تحويلٍ يخضّرُ الإعفاء (SUBCLASS_BIND_ESCAPES_TYPED_PRODUCER_NEGATION)',
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export class MutantR8Sub extends StateJournal {',
      '  constructor(dir: string) { super({ directory: dir, file: \'m.jsonl\', fsync: false, verifyOnBoot: true, maxRecords: 10, scope: [\'audit_entry\'] }); }',
      '  leak(): void { const f = this.record.bind(this);', "  f('archive_snapshot', {});", '  }', '}', ''].join('\n')) },
  // ── تحويلُ التحويلِ: الظهورُ يُقاسُ تعبيرًا (AS_UNKNOWN_AS_STRUCTURAL_RECORD_GREENS_STATIC_GATE) ──
  { code: 'RC-04', why: 'الوجهُ الذي عرضتْه المعالجةُ دليلًا: `as unknown as { record }` بفهرسِ مصفوفةٍ — الآن يسقطُ ساكنًا بالرمزِ القطعيِّ',
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export function mutantR8Structural(j: DurableSink): void {',
      '  const sinkAs = j as unknown as { record: (k: string, p: unknown) => unknown };',
      "  sinkAs.record((['archive_snapshot'] as const)[0], { probe: true });", '}', ''].join('\n')) },
  { code: 'RC-04', why: 'تحويلٌ إلى اسمٍ مسمًّى ذي record — التعقّي تعبيرًا لا نوعًا فالاسمُ لا يُبرّئ',
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export interface MutantR8Holder { record: (k: string, p: unknown) => unknown; }',
      'export function mutantR8NamedCast(j: DurableSink): void {',
      '  const holder = j as unknown as MutantR8Holder;', "  holder.record('archive_snapshot', {});", '}', ''].join('\n')) },
  { code: 'RC-04', why: 'معرّفٌ إعلانُهُ تحويلٌ — `const h = j as unknown as MutantR8Holder2; h.record(…)` يُعقَّبُ إلى إعلانِهِ',
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export interface MutantR8Holder2 { record: (k: string, p: unknown) => unknown; }',
      'export function mutantR8DeclCast(j: DurableSink): void {',
      '  const h = j as unknown as MutantR8Holder2;', "  h.record('archive_snapshot', {});", '}', ''].join('\n')) },
];

const LIVE: readonly Face[] = [
  { code: '', why: '`0x0n ||` — يسارٌ كاذبٌ بالقيمةِ فاليمينُ يُنفَّذُ (الوجهُ الحقيقيُّ الذي كان يُرفَضُ كذبًا)',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `if (journal) 0x0n || ${SCOPE};`) },
  { code: '', why: '`0x1n &&` — يسارٌ صادقٌ بالقيمةِ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `if (journal) 0x1n && ${SCOPE};`) },
  { code: '', why: '`NaN ||` عالميًّا بلا تظليلٍ — كاذبٌ فاليمينُ يُنفَّذُ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `if (journal) NaN || ${SCOPE};`) },
  { code: '', why: "`const NaN = 1` ثمّ `NaN &&` — مظلَّلٌ صادقٌ فاليمينُ يُنفَّذُ",
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, 'const NaN = 1;\n  if (journal) NaN && ' + SCOPE + ';') },
  { code: '', why: 'catch لكتلةٍ فيها نداءٌ — الرميُ ممكنٌ فالـcatch مقروءٌ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      'try { console.log(\'m\'); } catch { ' + SCOPE + '; }\n  ' + CENSUS_CALL) },
  { code: '', why: '`break` مُسمًّى داخلَ شرطٍ — قد لا يُنفَّذُ فما بعدَهُ مقروءٌ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      'skipLive: { if (journal === null) break skipLive; if (journal) ' + SCOPE + '; }\n  ' + CENSUS_CALL) },
  { code: '', why: '`switch (0) { case 1: break; default: census() }` — لا بندَ يوافِقُ المميّزَ فالـdefault مقروءٌ',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      'switch (0) { case 1: break; default: if (journal) ' + SCOPE + '; }\n  ' + CENSUS_CALL) },
  { code: '', why: "معاملٌ عامٌّ بصنفٍ حرفيٍّ غيرِ المُعفى — `j.record('ledger_entry', {})` على J",
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export function liveR8Generic<J extends StateJournal>(j: J): void {',
      "  j.record('ledger_entry', {});", '}', ''].join('\n')) },
  { code: '', why: "صنفٌ فرعيٌّ أمينٌ — `this.record('ledger_entry', {})`",
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export class LiveR8Sub extends StateJournal {',
      '  constructor(dir: string) { super({ directory: dir, file: \'m.jsonl\', fsync: false, verifyOnBoot: true, maxRecords: 10, scope: [\'audit_entry\'] }); }',
      '  honest(): void {', "    this.record('ledger_entry', {});", '  }', '}', ''].join('\n')) },
  { code: '', why: 'صنفٌ مسمًّى ذو record لا يوميّةً — لا يُتَّهمُ لصنفِهِ (رفضٌ كاذبٌ كان سيقعُ بالقاعدةِ الواسعةِ)',
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      'export class LiveR8Ledger { record(k: string, p: unknown): void { return; } }',
      'export function liveR8LedgerCall(): void { new LiveR8Ledger().record(\'shipment\', {}); }', ''].join('\n')) },
];

test('الحاجزُ الساكن: عيوبُ مجلسِ الجولةِ الرابعةِ تُسقِطُه برموزِها — والقيمةُ تُحسَبُ والتحويلُ يُتتبَّعُ والاتجاهُ يُقلَبُ', () => {
  for (const m of NEGATIVE) {
    const g = gateRoot();
    try {
      m.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 1, `${m.code}: التطفيرُ نجا — ${m.why}\n${r.out}`);
      assert.match(r.out, new RegExp(`\\[${m.code}\\]`), `${m.code}: سقط بغير رمزه — ${m.why}\n${r.out}`);
    } finally {
      g.clean();
    }
  }
});

test('الحاجزُ الساكن: الوجوهُ الحيّةُ للجولةِ الثامنةِ لا تُرفَض', () => {
  for (const f of LIVE) {
    const g = gateRoot();
    try {
      f.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 0, `حاجزٌ رفض وجهًا حيًّا: ${f.why}\n${r.out}`);
    } finally {
      g.clean();
    }
  }
});

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof SovereignViolation ? error.code : `غير-سيادي:${String(error)}`;
  }
  return 'لا-رفض';
};

test('الحارسُ التشغيليُّ عندَ نقطةِ القراءةِ المشتركةِ: قيدُ المُعفى المكتوبُ يُكذَّبُ بأيِّ قارئٍ لا بمسلكٍ واحد (EXEMPTION_RUNTIME_GUARD_NOT_DOMINATING_ALL_REHYDRATION_PATHS)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-r8-'));
  const journal = new StateJournal({
    directory: dir, file: 'state.jsonl', fsync: false, verifyOnBoot: true, maxRecords: 100,
    scope: ['audit_entry', 'archive_snapshot'],
  });
  try {
    // المنتِجُ الذي أفلتَ في خامِّ gpt: حذفُ نداءِ مسلكِ الإرجاعِ الوحيدِ الحارسِ من الإقلاعِ
    // كان يُبقي القيدَ المكتوبَ يُقرأُ صامتًا — فالحارسُ صار عندَ القراءةِ نفسِها: كلُّ قارئٍ يُسقَطُ.
    const sinkAs = journal as unknown as { record: (k: string, p: unknown) => unknown };
    sinkAs.record((['archive_snapshot'] as const)[0], { probe: true });
    assert.equal(journal.length, 1, 'القيدُ لم يُكتَب — فالمسبارُ لا يقيسُ شيئًا');
    assert.equal(codeOf(() => journal.read()), 'PERSISTENCE_REHYDRATE_EXEMPTION_CONTRADICTED');
  } finally {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
