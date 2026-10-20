/**
 * تطفيراتُ الجولةِ السابعة — W-2026-040 (معالجةُ مجلسِ المراجعةِ الثالثة · الجلسة 153 · §2-ط).
 *
 * المحضر: `docs/work/council/W-2026-040-3.json` — إجماعُ رفضٍ بعشرةِ عيوبٍ مسمّاة. والعلّةُ الجامعةُ:
 * نفيُ المنتِجِ وإثباتُ السيادةِ كانا يقرآنِ صيغًا مسمّاةً فيُعَدُّ المجهولُ آمنًا. فكلُّ وجهٍ هنا
 * مسبارٌ من خامِّ عضوٍ (أو أخوه المباشر) يسقطُ الحاجزَ **برمزِه**، والوجوهُ الحيّةُ تُخضِرّ — والحدُّ
 * يُقاسُ من وجهيه. والحارسانِ التشغيليّانِ يُقاسانِ سلوكًا لا نصًّا.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateRoot, patch } from './rehydrate_census_harness';
import { SovereignViolation } from '../../src/kernel/types';
import { StateJournal, rehydrateFromJournal } from '../../src/data/persistence';
import { assertExemptionsHold, REHYDRATE_CLAIMS } from '../../src/data/rehydrate_census';

const INDEX = 'src/index.ts';
const PERSISTENCE = 'src/data/persistence.ts';
const CENSUS_CALL = 'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);';
const SCOPE = 'assertRehydrateCensus(persistenceConfig.policy.scope)';

/** دالّةٌ تُلحَقُ بـ`persistence.ts` بمُستقبِلٍ من نوعِ اليوميّةِ الحقيقيِّ `DurableSink` */
const sink = (name: string, body: readonly string[]): ((root: string) => void) => (root) =>
  appendFileSync(join(root, PERSISTENCE), [`export function ${name}(j: DurableSink): void {`, ...body, '}', ''].join('\n'));

type Face = { readonly code: string; readonly why: string; readonly mutate: (root: string) => void };

const NEGATIVE: readonly Face[] = [
  // ── نفيُ المنتِج: المترجمُ يُسأَلُ لا الشكل (COMPUTED_PRODUCER · PRODUCER_ABSENCE_PROOF_IS_CLOSED_SYNTAX) ──
  { code: 'RC-04', why: "منتِجٌ محسوب: `j.record((['archive_snapshot'] as const)[0], {})` — COMPUTED_PRODUCER_BYPASSES_DECLARED_WITHOUT_PRODUCER",
    mutate: sink('mutantR7Computed', ["  j.record((['archive_snapshot'] as const)[0], {});"]) },
  { code: 'RC-14', why: "وجهُ gpt بحرفِه: `j.record(['archive_snapshot'][0]! as DurableKind, {})` — نوعٌ غيرُ حرفيٍّ مجهول",
    mutate: sink('mutantR7ComputedCast', ["  j.record(['archive_snapshot'][0]! as DurableKind, {});"]) },
  { code: 'RC-14', why: "`.call`: `j.record.call(j, 'archive_snapshot', {})` — مرجعٌ هارب",
    mutate: sink('mutantR7Call', ["  j.record.call(j, 'archive_snapshot', {});"]) },
  { code: 'RC-14', why: "`.bind`: `const f = j.record.bind(j); f('archive_snapshot', {})` — مرجعٌ هارب",
    mutate: sink('mutantR7Bind', ['  const f = j.record.bind(j);', "  f('archive_snapshot', {});"]) },
  { code: 'RC-04', why: 'ثابتٌ مستورَدٌ من ملفٍّ آخر: `j.record(SNAP, {})` — نوعُه الحرفُ وحدَه',
    mutate: (root) => {
      writeFileSync(join(root, 'src/data/mutant_r7_kind.ts'), "export const SNAP = 'archive_snapshot' as const;\n");
      appendFileSync(join(root, PERSISTENCE), "import { SNAP } from './mutant_r7_kind';\n");
      sink('mutantR7Imported', ['  j.record(SNAP, {});'])(root);
    } },
  { code: 'RC-14', why: "عائدُ دالّة: `const k = (): DurableKind => 'archive_snapshot'; j.record(k(), {})` — اتّحادٌ يحتويه",
    mutate: sink('mutantR7Return', ["  const k = (): DurableKind => 'archive_snapshot';", '  j.record(k(), {});']) },
  { code: 'RC-14', why: 'فهرسٌ محسوبُ المفتاح: `(j as any)[m](…)` — LOCAL/CLOSED_SYNTAX',
    mutate: sink('mutantR7ComputedKey', ["  const m = 'rec' + 'ord';", "  // eslint-disable-next-line @typescript-eslint/no-explicit-any", "  (j as any)[m]('archive_snapshot', {});"]) },
  { code: 'RC-04', why: "تفكيك: `const { record } = j; record('archive_snapshot', {})` — الاسمُ باقٍ فالمنتِجُ قطعيّ",
    mutate: sink('mutantR7Destructure', ['  const { record } = j;', "  record('archive_snapshot', {});"]) },
  { code: 'RC-14', why: "تفكيكٌ بإعادةِ تسمية: `const { record: w } = j; w('archive_snapshot', {})` — مرجعٌ هارب",
    mutate: sink('mutantR7DestructureRename', ['  const { record: w } = j;', "  w('archive_snapshot', {});"]) },
  { code: 'RC-04', why: "مُستقبِلٌ `any`: `(j as any).record('archive_snapshot', {})`",
    mutate: sink('mutantR7Any', ["  // eslint-disable-next-line @typescript-eslint/no-explicit-any", "  (j as any).record('archive_snapshot', {});"]) },
  // ── حدُّ الإسنادِ الموضعيّ (LOCAL_ASSIGNMENT_LIMIT_FAILS_OPEN · …_MISSTATED) ──
  { code: 'RC-14', why: "كتابةٌ في دالّةٍ سهميّةٍ تُنادى قبلَ النداء (يوميّة): النوعُ المُعلَنُ لا المُضيَّق — LOCAL_ASSIGNMENT_LIMIT_FAILS_OPEN",
    mutate: sink('mutantR7LaterWrite', ["  let kind: DurableKind = 'ledger_entry';", "  const later = (): void => { kind = 'archive_snapshot'; };", '  later();', '  j.record(kind, {});']) },
  { code: 'RC-14', why: "وجهُ grok بحرفِه: دالّةٌ مرفوعةٌ بعدَ النداءِ تكتبُ الصنفَ وتُنادى قبلَه — LOCAL_ASSIGNMENT_LIMIT_FAILS_OPEN",
    mutate: sink('mutantR7Hoisted', ["  let kind: DurableKind = 'ledger_entry';", '  later();', '  j.record(kind, {});',
      "  function later(): void { kind = 'archive_snapshot'; }"]) },
  { code: 'RC-14', why: "كتابةٌ في دالّةٍ أخرى (مُستقبِلٌ بنيويّ): «لا يُبرهَن» لا «له منتِج» — LOCAL_ASSIGNMENT_LIMIT_MISSTATED",
    mutate: (root) => appendFileSync(join(root, PERSISTENCE), [
      "let mutantR7Kind = 'other';",
      "export function mutantR7Writer(): void { mutantR7Kind = 'archive_snapshot'; }",
      'export function mutantR7Structural(j: { record: (k: string, p: unknown) => unknown }): void {',
      '  mutantR7Writer();', '  j.record(mutantR7Kind, {});', '}', ''].join('\n')) },
  // ── سيادةُ الحصر: يسارُ القصرِ ذرّةُ حارسٍ والقيمةُ تُحسَب (RC07_* من grok §10) ──
  ...['Number(0)', "+'0'", 'Boolean(0)', 'Number.NaN', '(1 - 1)', '0 === 1', 'Math.min(0)'].map((left): Face => ({
    code: 'RC-07', why: `\`if (journal) ${left} && assertRehydrateCensus(…)\` — يسارٌ لا يصدقُ أو لا يُحسَب`,
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `if (journal) ${left} && ${SCOPE};`),
  })),
  // ── المُستدعى المغلَّفُ والمرجعُ الهارب (RC07_PARENTHESIZED_REHYDRATE_CALLEE_BLINDS_GATE · gemini) ──
  { code: 'RC-07', why: '`(rehydrateFromJournal)(…)` قبلَ الحاجز — يُرى نداءَ إرجاعٍ بعدَ فكِّ القوس',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      `if (journal) (rehydrateFromJournal)(journal, {} as never);\n  ${CENSUS_CALL}`) },
  { code: 'RC-07', why: '`(0, rehydrateFromJournal)(…)` قبلَ الحاجز — يمينُ الفاصلة',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      `if (journal) (0, rehydrateFromJournal)(journal, {} as never);\n  ${CENSUS_CALL}`) },
  { code: 'RC-07', why: 'اسمٌ آخرُ للإرجاع: `const early = rehydrateFromJournal; early(…)` — مرجعٌ هارب',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL,
      `const early = rehydrateFromJournal;\n  if (journal) early(journal, {} as never);\n  ${CENSUS_CALL}`) },
];

const LIVE: readonly Face[] = [
  { code: '', why: "يوميّةٌ حقيقيّةٌ بصنفٍ آخرَ حرفًا: `j.record('ledger_entry', {})`",
    mutate: sink('liveR7Literal', ["  j.record('ledger_entry', {});"]) },
  { code: '', why: "ثابتٌ حرفيٌّ لصنفٍ آخر: `const K = 'ledger_entry' as const; j.record(K, {})`",
    mutate: sink('liveR7Const', ["  const K = 'ledger_entry' as const;", '  j.record(K, {});']) },
  { code: '', why: "اتّحادٌ لا يحتوي المُعفى: `const k: 'ledger_entry' | 'tax_levy' = …`",
    mutate: sink('liveR7Union', ["  const k: 'ledger_entry' | 'tax_levy' = Date.now() > 0 ? 'ledger_entry' : 'tax_levy';", '  j.record(k, {});']) },
  { code: '', why: "كتابةٌ ميتةٌ في دالّةٍ أخرى بنوعٍ مُعلَنٍ لا يحتوي المُعفى — لا تُرفَضُ كذبًا (LOCAL_ASSIGNMENT_LIMIT_MISSTATED)",
    mutate: sink('liveR7DeadWrite', ["  let kind: 'ledger_entry' | 'tax_levy' = 'ledger_entry';", "  const dead = (): void => { kind = 'tax_levy'; };", '  void dead;', '  j.record(kind, {});']) },
  { code: '', why: 'مقيّمٌ يحسبُ الصدقَ أيضًا: `(1 + 1) && assertRehydrateCensus(…)`',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `if (journal) (1 + 1) && ${SCOPE};`) },
  { code: '', why: 'يسارٌ هو حارسُ الإرجاعِ نفسُه: `journal && assertRehydrateCensus(…)`',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, `journal && ${SCOPE};`) },
  { code: '', why: 'مُستدعى الحاجزِ مغلَّفٌ بقوس: `(assertRehydrateCensus)(…)`',
    mutate: (root) => patch(root, INDEX, CENSUS_CALL, 'if (journal) (assertRehydrateCensus)(persistenceConfig.policy.scope);') },
];

test('الحاجزُ الساكن: عيوبُ مجلسِ الجولةِ الثالثةِ تُسقطه برموزِها — والمجهولُ لا يؤيّدُ الإعفاءَ ولا السيادة', () => {
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

test('الحاجزُ الساكن: كتابةٌ في دالّةٍ أخرى «لا يُبرهَنُ غيابُها» لا «لها منتِج» — فلا يُدّعى [RC-04] كذبًا', () => {
  const g = gateRoot();
  try {
    NEGATIVE.find((m) => m.why.includes('مُستقبِلٌ بنيويّ'))!.mutate(g.root);
    const r = g.run();
    assert.match(r.out, /\[RC-14\]/);
    assert.doesNotMatch(r.out, /\[RC-04\]/, `ادّعى الحاجزُ منتِجًا قائمًا بلا برهان:\n${r.out}`);
  } finally {
    g.clean();
  }
});

test('الحاجزُ الساكن: الوجوهُ الحيّةُ للجولةِ السابعةِ لا تُرفض', () => {
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

test('الحارسُ التشغيليّ: قيدٌ مكتوبٌ لصنفٍ «لا منتِجَ له» يُسقِطُ الإرجاعَ برمزِه — أيًّا كانت صيغةُ منتِجِه', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-r7-'));
  const journal = new StateJournal({
    directory: dir, file: 'state.jsonl', fsync: false, verifyOnBoot: true, maxRecords: 100,
    scope: ['audit_entry', 'archive_snapshot'],
  });
  try {
    // المنتِجُ «المحسوبُ» نفسُه الذي أجمعَ عليه المجلس — يُفلتُ ساكنًا بالتحويلِ ويكتبُ فعلًا
    const sinkAsAny = journal as unknown as { record: (k: string, p: unknown) => unknown };
    sinkAsAny.record((['archive_snapshot'] as const)[0], { probe: true });
    assert.equal(journal.length, 1, 'القيدُ لم يُكتَب — فالمسبارُ لا يقيسُ شيئًا');
    assert.equal(codeOf(() => rehydrateFromJournal(journal, {} as never)), 'PERSISTENCE_REHYDRATE_EXEMPTION_CONTRADICTED');
  } finally {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('الحارسُ التشغيليّ: الإعفاءُ القائمُ لا يُرفَض — يوميّةٌ بلا قيدٍ للمُعفى تمرّ، والصنفُ المُستهلَكُ لا يُعَدُّ تكذيبًا', () => {
  assert.equal(codeOf(() => assertExemptionsHold(['audit_entry', 'ledger_entry', 'journal_compacted'])), 'لا-رفض');
  assert.equal(codeOf(() => assertExemptionsHold(['archive_snapshot'])), 'PERSISTENCE_REHYDRATE_EXEMPTION_CONTRADICTED');
  // جدولٌ لا إعفاءَ فيه بحجّةِ «لا منتِج» — فلا شيءَ يُكذَّب
  const noExempt = REHYDRATE_CLAIMS.filter((c) => c.exemption !== 'declared_without_producer');
  assert.equal(codeOf(() => assertExemptionsHold(['archive_snapshot'], noExempt)), 'لا-رفض');
});
