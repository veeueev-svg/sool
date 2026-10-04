/**
 * tests/governance/review_council.test.ts — حارسُ مجلس المراجعة (RULE-020 · W-2026-062)
 * المالك: القيّم على المستودع | المرحلة: 40
 * المدخلات: `scripts/review_council.ts` · وحالُ المستودع الحقيقيّ قراءةً لا كتابة:
 *   `docs/work/REVIEW_COUNCIL.json` · `docs/work/WORK_QUEUE.json` · `docs/work/council/*.json`
 * المخرجات: تأكيدٌ أنّ لا VERIFIED بلا إجماعٍ محفوظ، وأنّ كلَّ خللٍ معلنٍ يسقط باسمه
 * الصلاحيات (RULE-004): يقرأ ولا يكتب في سجلّ المستودع
 * اختبار القبول: هذا الملف نفسه — `npm test`
 *
 * ثابت: **الحارسُ يقرأ الحالَ الحقيقيّ** — فالاختبارُ الأخير يشغّل الحكمَ على سجلّ المستودع
 * عينِه، فبندٌ يُرفع إلى VERIFIED بلا محضرِ إجماعٍ يُسقط `npm test` ومعه CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  evaluateCouncil as evaluateRaw, checkDeclaration, scopeDigest, type CouncilDeclaration, type CouncilRecord, type QueueItemLike,
} from '../../scripts/review_council';

const decl = (over: Partial<CouncilDeclaration> = {}): CouncilDeclaration => ({
  authority: 'docs/decisions/x.md',
  rule: 'unanimous',
  min_members: 2,
  members: [
    { id: 'gpt', model: 'GPT 5.6', provider: 'OpenAI', family: 'GPT' },
    { id: 'grok', model: 'Grok 4.6', provider: 'xAI', family: 'Grok' },
  ],
  ...over,
});
const rec = (over: Partial<CouncilRecord> = {}): CouncilRecord => ({
  item: 'W-2026-900', commit: 'abcdef1', scope_digest: DIGEST, executor_family: 'Claude', convened_at: '2026-10-03', session: 1,
  verdicts: [
    { member: 'gpt', verdict: 'VERIFIED', report: 'r/gpt.md' },
    { member: 'grok', verdict: 'VERIFIED', report: 'r/grok.md' },
  ],
  decision: 'VERIFIED',
  ...over,
});
const yes = (): boolean => true;
const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const SCOPE = ['src/a.ts', 'docs/b.md'];
const contents = new Map<string, string>([['src/a.ts', 'A'], ['docs/b.md', 'B']]);
const digestOf = (scope: readonly string[]): string => scopeDigest(scope, (p) => (contents.has(p) ? sha(contents.get(p)!) : null), sha);
const DIGEST = digestOf(SCOPE);
const evaluateCouncil = (d: Parameters<typeof evaluateRaw>[0], it: QueueItemLike[], r: CouncilRecord[], f: (p: string) => boolean): string[] =>
  evaluateRaw(d, it, r, f, digestOf);
const verified: QueueItemLike[] = [{ id: 'W-2026-900', status: 'VERIFIED', scope: SCOPE }];
const split = [
  { member: 'gpt', verdict: 'VERIFIED', report: 'r/gpt.md' },
  { member: 'grok', verdict: 'REJECTED', report: 'r/grok.md' },
];

test('مجلس: إجماعٌ محفوظٌ على VERIFIED يمرّ', () => {
  assert.deepEqual(evaluateCouncil(decl(), verified, [rec()], yes), []);
});

test('مجلس: VERIFIED بلا محضرٍ يسقط', () => {
  const e = evaluateCouncil(decl(), verified, [], yes);
  assert.equal(e.length, 1);
  assert.match(e[0]!, /بلا محضرِ مجلس/);
});

test('مجلس: خلافُ العضوين لا يُرقّي — قرارُ VERIFIED على خلافٍ يسقط', () => {
  const e = evaluateCouncil(decl(), verified, [rec({ verdicts: split })], yes);
  assert.ok(e.some((m) => /بلا إجماع/.test(m)));
});

test('مجلس: خلافٌ بقرار NOT_VERIFIED ومآلٍ مسمّى يمرّ، والبندُ لا يبقى VERIFIED', () => {
  const r = rec({ verdicts: split, decision: 'NOT_VERIFIED', disposition: { kind: 'RK', ref: 'T-170' } });
  assert.deepEqual(evaluateCouncil(decl(), [{ id: 'W-2026-900', status: 'IN_PROGRESS' }], [r], yes), []);
  assert.ok(evaluateCouncil(decl(), verified, [r], yes).some((m) => /الخلافُ يُعيده/.test(m)));
});

test('مجلس: خلافٌ بلا مآلٍ، أو RK بلا T-NNN، أو DISC بلا نصّ — يسقط', () => {
  const items = [{ id: 'W-2026-900', status: 'IN_PROGRESS' }];
  for (const disposition of [undefined, { kind: 'RK', ref: 'x' }, { kind: 'DISC', ref: ' ' }, { kind: 'MERGE' }]) {
    const r = rec({ verdicts: split, decision: 'NOT_VERIFIED', ...(disposition ? { disposition } : {}) });
    assert.ok(evaluateCouncil(decl(), items, [r], yes).length > 0, JSON.stringify(disposition));
  }
});

test('مجلس: إعادةٌ إلى IN_PROGRESS والبندُ باقٍ REVIEW — يسقط', () => {
  const r = rec({ verdicts: split, decision: 'NOT_VERIFIED', disposition: { kind: 'IN_PROGRESS' } });
  assert.ok(evaluateCouncil(decl(), [{ id: 'W-2026-900', status: 'REVIEW' }], [r], yes).some((m) => /لا يزال REVIEW/.test(m)));
});

test('مجلس: عضوٌ غائبُ الحكم، أو حكمٌ من غريب، أو حكمان لعضو — يسقط', () => {
  const cases = [
    [{ member: 'gpt', verdict: 'VERIFIED', report: 'r' }],
    [...rec().verdicts, { member: 'gemini', verdict: 'VERIFIED', report: 'r' }],
    [{ member: 'gpt', verdict: 'VERIFIED', report: 'r' }, { member: 'gpt', verdict: 'VERIFIED', report: 'r' }],
  ];
  for (const verdicts of cases) assert.ok(evaluateCouncil(decl(), verified, [rec({ verdicts })], yes).length > 0);
});

test('مجلس: تقريرٌ خامٌّ غيرُ محفوظ، أو حكمٌ خارجَ المعجم، أو التزامةٌ بلا هاش — يسقط', () => {
  assert.ok(evaluateCouncil(decl(), verified, [rec()], () => false).some((m) => /غيرُ محفوظ/.test(m)));
  const bad = rec({ verdicts: [{ member: 'gpt', verdict: 'OK', report: 'r' }, { member: 'grok', verdict: 'VERIFIED', report: 'r' }] });
  assert.ok(evaluateCouncil(decl(), verified, [bad], yes).some((m) => /خارجَ المعجم/.test(m)));
  assert.ok(evaluateCouncil(decl(), verified, [rec({ commit: '' })], yes).some((m) => /هاشِ التزامة/.test(m)));
});

test('مجلس: عضوٌ من عائلةِ المنفّذ يسقط', () => {
  assert.ok(evaluateCouncil(decl(), verified, [rec({ executor_family: 'GPT' })], yes).some((m) => /عائلةِ المنفّذ/.test(m)));
});

test('مجلس: إعلانٌ بعضوٍ واحد، أو عائلتين مكرّرتين، أو قاعدةٍ غيرِ الإجماع — يسقط', () => {
  const one = decl({ members: [decl().members[0]!] });
  const twin = decl({ members: [decl().members[0]!, { id: 'gpt2', model: 'GPT 5.5', provider: 'OpenAI', family: 'gpt' }] });
  for (const d of [one, twin, decl({ rule: 'majority' }), decl({ min_members: 1 }), decl({ authority: '' })]) {
    assert.ok(checkDeclaration(d).length > 0);
  }
  assert.ok(checkDeclaration(null).length > 0);
});

test('مجلس: ثلاثةُ أعضاءٍ من عائلاتٍ مختلفة — الإجماعُ يلزم الثلاثة', () => {
  const three = decl({ members: [...decl().members, { id: 'gemini', model: 'Gemini', provider: 'Google', family: 'Gemini' }] });
  assert.deepEqual(checkDeclaration(three), []);
  assert.ok(evaluateCouncil(three, verified, [rec()], yes).some((m) => /لا حكمَ للعضو «gemini»/.test(m)));
});

test('مجلس: محضرٌ مربوطٌ بغيرِ ما رُوجع — بصمةٌ لا تطابق النطاق القائم تسقط (COUNCIL_UNBOUND_REVIEWED_COMMIT)', () => {
  const other = rec({ scope_digest: sha('محضرٌ على التزامةٍ أخرى') });
  assert.ok(evaluateCouncil(decl(), verified, [other], yes).some((m) => /بصمةُ نطاقِه اليومَ/.test(m)));
  contents.set('src/a.ts', 'A — تغيّر بعد الحكم');
  try {
    assert.ok(evaluateCouncil(decl(), verified, [rec()], yes).some((m) => /تغيّر بعد الحكم/.test(m)));
  } finally { contents.set('src/a.ts', 'A'); }
  assert.deepEqual(evaluateCouncil(decl(), verified, [rec()], yes), []);
});

test('مجلس: محضرُ VERIFIED بلا scope_digest، أو حكمٌ بلا دالّةِ بصمة، أو بندٌ بلا نطاق — يسقط', () => {
  const { scope_digest: _drop, ...bare } = rec();
  assert.ok(evaluateCouncil(decl(), verified, [bare as CouncilRecord], yes).some((m) => /بلا scope_digest/.test(m)));
  assert.ok(evaluateRaw(decl(), verified, [rec()], yes).some((m) => /لا تُقاس بصمةُ نطاقِه/.test(m)));
  assert.ok(evaluateCouncil(decl(), [{ id: 'W-2026-900', status: 'VERIFIED' }], [rec()], yes).some((m) => /لا تُقاس بصمةُ نطاقِه/.test(m)));
});

test('مجلس: البصمةُ لا تتبع ترتيبَ النطاق، وتتبع كلَّ بايتٍ وغيابَ الملف', () => {
  assert.equal(digestOf(['docs/b.md', 'src/a.ts']), DIGEST);
  assert.notEqual(digestOf([...SCOPE, 'missing.ts']), DIGEST);
  assert.match(DIGEST, /^[0-9a-f]{64}$/);
});

test('مجلس: ترتيبُ «آخر محضر» قطعيٌّ برقمِ الجلسةِ لا بترتيبِ القراءة (COUNCIL_SAME_DAY_LATEST_ORDER)', () => {
  const day = '2026-10-04';
  const session1 = rec({ convened_at: day, session: 1, verdicts: split, decision: 'NOT_VERIFIED', disposition: { kind: 'IN_PROGRESS' } });
  const session2 = rec({ convened_at: day, session: 2 });
  // الجلسةُ 2 هي الأحدث مهما كان ترتيبُ الإدخال — فلا يقلبُ الترتيبُ حكمًا
  assert.deepEqual(evaluateCouncil(decl(), verified, [session1, session2], yes), []);
  assert.deepEqual(evaluateCouncil(decl(), verified, [session2, session1], yes), []);
  // وبالعكس: محضرُ الجلسةِ 2 خلافٌ والبندُ VERIFIED — يسقط في الترتيبين معًا
  const later = rec({ convened_at: day, session: 2, verdicts: split, decision: 'NOT_VERIFIED', disposition: { kind: 'IN_PROGRESS' } });
  const earlier = rec({ convened_at: day, session: 1 });
  for (const records of [[earlier, later], [later, earlier]]) {
    assert.ok(evaluateCouncil(decl(), verified, records, yes).some((m) => /الخلافُ يُعيده/.test(m)));
  }
});

test('مجلس: محضران لنفسِ الجلسةِ تعادلٌ مرفوضٌ بالاسم، ومحضرٌ بلا جلسةٍ فشلٌ مغلق (الثابت 7)', () => {
  const tie = [rec({ convened_at: '2026-10-04', session: 3 }), rec({ convened_at: '2026-10-04', session: 3 })];
  assert.ok(evaluateCouncil(decl(), verified, tie, yes).some((m) => /الجلسة نفسها/.test(m)));
  const { session: _drop, ...bare } = rec();
  assert.ok(evaluateCouncil(decl(), verified, [bare as CouncilRecord], yes).some((m) => /رقمِ جلسة/.test(m)));
  assert.ok(evaluateCouncil(decl(), verified, [rec({ session: 0 })], yes).some((m) => /رقمِ جلسة/.test(m)));
});

test('مجلس: تاريخٌ أحدثُ يُغني الأقدمَ مهما كان ترتيبُ الإدخال — والعكسُ يسقط في الترتيبين', () => {
  const earlier = rec({ convened_at: '2026-10-03', session: 5, verdicts: split, decision: 'NOT_VERIFIED', disposition: { kind: 'IN_PROGRESS' } });
  const nextDay = rec({ convened_at: '2026-10-05', session: 1 });
  assert.deepEqual(evaluateCouncil(decl(), verified, [earlier, nextDay], yes), []);
  assert.deepEqual(evaluateCouncil(decl(), verified, [nextDay, earlier], yes), []);
  const laterDisagreement = rec({ convened_at: '2026-10-05', session: 1, verdicts: split, decision: 'NOT_VERIFIED', disposition: { kind: 'IN_PROGRESS' } });
  for (const records of [[rec(), laterDisagreement], [laterDisagreement, rec()]]) {
    assert.ok(evaluateCouncil(decl(), verified, records, yes).some((m) => /الخلافُ يُعيده/.test(m)));
  }
});

test('مجلس: الحالُ الحقيقيُّ للمستودع — لا VERIFIED بلا إجماعٍ محفوظ', () => {
  const d = JSON.parse(readFileSync('docs/work/REVIEW_COUNCIL.json', 'utf8')) as CouncilDeclaration;
  const q = JSON.parse(readFileSync('docs/work/WORK_QUEUE.json', 'utf8')) as { work_items: QueueItemLike[] };
  const dir = 'docs/work/council';
  const records = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as CouncilRecord);
  const fileHash = (p: string): string | null => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null);
  const realDigest = (scope: readonly string[]): string => scopeDigest(scope, fileHash, sha);
  assert.deepEqual(evaluateRaw(d, q.work_items, records, (p) => existsSync(p) && readFileSync(p, 'utf8').trim() !== '', realDigest), []);
  assert.ok(existsSync(d.authority), 'قرارُ المالك المسمّى في الإعلان موجود');
});
