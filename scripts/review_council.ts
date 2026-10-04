/**
 * scripts/review_council.ts — حكمُ مجلس المراجعة (RULE-020 · أمر المالك · ADR-0054)
 * المالك: القيّم على المستودع | المرحلة: 40 | البند: W-2026-062
 * المدخلات: إعلانُ المجلس `docs/work/REVIEW_COUNCIL.json` · بنودُ `docs/work/WORK_QUEUE.json`
 *   · محاضرُ الجلسات `docs/work/council/W-YYYY-NNN.json` · ودالّةُ وجودِ الملفّات
 * المخرجات: قائمةُ مخالفاتٍ مسمّاة — فارغةٌ إذا كان كلُّ VERIFIED بإجماعٍ محفوظ
 * الصلاحيات (RULE-004): يقرأ ولا يُصلح، ولا يُرقّي حالةً — الترقيةُ فعلُ المجلس لا فعلُ الدالّة
 * اختبار القبول: tests/governance/review_council.test.ts — `npm test`
 *
 * ثوابت هذا الملف:
 *
 * 1) **لا VERIFIED بلا إجماع**: بندٌ حالُه VERIFIED في السجلّ الحيّ يلزمه محضرٌ قرارُه
 *    VERIFIED، وفيه حكمٌ لكلِّ عضوٍ معلنٍ في المجلس — لا ناقصٌ ولا غريب — وكلُّها VERIFIED.
 * 2) **الخلافُ لا يُرقّي**: محضرٌ اختلف فيه عضوان قرارُه NOT_VERIFIED حتمًا، ويُسمّي مآلَ
 *    البند: عودةً إلى IN_PROGRESS، أو قيدَ العيبِ اكتشافًا (DISC) في `discoveries`، أو خطرًا
 *    (RK) بمعرّف دَينٍ T-NNN. والبندُ لا يكون VERIFIED ما دام آخرُ محاضره خلافًا.
 * 3) **العائلاتُ مختلفة**: لا يجلس عضوان من عائلةِ نماذجَ واحدة، ولا عضوٌ من عائلةِ المنفّذ
 *    المسمّاة في المحضر — فالتنويعُ شرطٌ مقيسٌ لا وصف.
 * 4) **الخرجُ الخامُّ محفوظٌ لا ملخَّص**: لكلِّ حكمٍ ملفُّ تقريرٍ موجودٌ في المستودع.
 * 5) **فشلٌ مغلق**: إعلانٌ ناقصٌ أو معجمٌ خارجَ المغلق يُرفض ولا يُفترض صحيحًا.
 * 6) **الحكمُ مربوطٌ بما رُوجع** (مجلس المراجعة · الجلسة 1 · COUNCIL_UNBOUND_REVIEWED_COMMIT):
 *    محضرُ VERIFIED يحمل `scope_digest` — بصمةَ محتوى نطاقِ البندِ يومَ المراجعة (`scopeDigest`)
 *    — والبندُ لا يكون VERIFIED في السجلّ الحيّ إلّا وبصمةُ نطاقِه اليومَ تساويها. فإجماعٌ على
 *    التزامةٍ أخرى، أو نطاقٌ تغيّر بعد الحكم، يسقط. والبصمةُ محتوًى لا تاريخ: تصحّ على نسخةٍ
 *    ضحلة (CI بعمقِ التزامتين) حيث لا تُرى الالتزاماتُ القديمة.
 *
 * الحدُّ المعلن: الهويّةُ والعزلُ **مُعلَنان** في المحضر لا **مُثبَتان** — فالأعضاءُ وكلاءُ
 * يوفّرهم المنفّذُ على منصّته. وهذا ما قبله المالكُ بأمره صراحةً، والدالّةُ تقيس الشكلَ
 * والإجماعَ والحفظَ لا صدقَ الإقرار.
 */

/** معجمُ الأحكام المغلق — لكلِّ عضو */
export const COUNCIL_VERDICTS = ['VERIFIED', 'REJECTED'] as const;
/** معجمُ قرار المجلس المغلق */
export const COUNCIL_DECISIONS = ['VERIFIED', 'NOT_VERIFIED'] as const;
/** معجمُ مآلِ البندِ عند الخلاف — كما سمّاه الأمر الملكي */
export const COUNCIL_DISPOSITIONS = ['IN_PROGRESS', 'DISC', 'RK'] as const;
/** أدنى عددٍ للأعضاء بنصّ الأمر */
export const COUNCIL_MIN_MEMBERS = 2;

export interface CouncilMember { id: string; model: string; provider: string; family: string }
export interface CouncilDeclaration {
  authority: string;
  rule: string;
  min_members: number;
  members: CouncilMember[];
}
export interface CouncilVerdict { member: string; model?: string; verdict: string; report: string }
export interface CouncilDisposition { kind: string; ref?: string }
export interface CouncilRecord {
  item: string;
  commit: string;
  /** بصمةُ محتوى نطاقِ البند يومَ المراجعة — شرطٌ لمحضرِ VERIFIED (الثابت 6) */
  scope_digest?: string;
  executor_family: string;
  convened_at: string;
  verdicts: CouncilVerdict[];
  decision: string;
  disposition?: CouncilDisposition;
}
export interface QueueItemLike { id: string; status: string; scope?: string[]; discoveries?: unknown }

/**
 * بصمةُ نطاق (الثابت 6): المساراتُ مرتّبةً، لكلٍّ سطرٌ `path<TAB>sha256(محتواه)` أو `-` لغائب،
 * ثمّ sha256 للنصّ كلِّه. `hash` يُحقن (node:crypto في الحارس) فلا تبعيّةَ هنا.
 */
export function scopeDigest(
  scope: readonly string[],
  fileHash: (p: string) => string | null,
  hash: (text: string) => string,
): string {
  const lines = [...scope].sort().map((p) => `${p}\t${fileHash(p) ?? '-'}\n`);
  return hash(lines.join(''));
}

const has = <T extends string>(set: readonly T[], v: unknown): v is T => typeof v === 'string' && (set as readonly string[]).includes(v);
const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** يفحص الإعلانَ وحده (الثابت 3 · الثابت 5) */
export function checkDeclaration(d: CouncilDeclaration | null | undefined): string[] {
  const e: string[] = [];
  if (d === null || d === undefined || typeof d !== 'object') return ['إعلانُ المجلس غائبٌ أو غيرُ مقروء — ولا يُحكم بمجلسٍ لا يُعرف أعضاؤه (فشلٌ مغلق)'];
  if (typeof d.authority !== 'string' || d.authority.trim() === '') e.push('إعلانُ المجلس بلا مرجعِ سلطة (authority) — والمجلسُ قائمٌ بأمرٍ ملكيٍّ مسمّى');
  if (d.rule !== 'unanimous') e.push(`قاعدةُ القرار «${String(d.rule)}» — والأمرُ الملكي لا يعرف إلّا الإجماع (unanimous)`);
  if (!Number.isInteger(d.min_members) || d.min_members < COUNCIL_MIN_MEMBERS) e.push(`min_members=${String(d.min_members)} — والأمرُ لا يقبل أقلَّ من ${COUNCIL_MIN_MEMBERS}`);
  const members = Array.isArray(d.members) ? d.members : [];
  if (members.length < Math.max(COUNCIL_MIN_MEMBERS, Number(d.min_members) || 0)) e.push(`المجلسُ ${members.length} عضوًا — دون الحدِّ المعلن`);
  const ids = new Set<string>();
  const fams = new Set<string>();
  for (const m of members) {
    for (const k of ['id', 'model', 'provider', 'family'] as const) {
      if (typeof m?.[k] !== 'string' || m[k].trim() === '') e.push(`عضوٌ بلا «${k}» — والهويّةُ المعلنةُ شرطٌ لا تجميل`);
    }
    if (ids.has(norm(m?.id))) e.push(`معرّفُ عضوٍ مكرّر «${m.id}»`);
    if (fams.has(norm(m?.family))) e.push(`عائلةٌ مكرّرة «${m.family}» — لا يجلس عضوان من عائلةٍ واحدة (الثابت 3)`);
    ids.add(norm(m?.id));
    fams.add(norm(m?.family));
  }
  return e;
}

/** يفحص محضرًا واحدًا مقابلَ الإعلان (الثوابت 1–4) */
export function checkRecord(r: CouncilRecord, d: CouncilDeclaration, fileExists: (p: string) => boolean): string[] {
  const e: string[] = [];
  const tag = `محضرُ ${String(r?.item ?? '؟')}`;
  if (!/^W-\d{4}-\d{3}$/.test(String(r?.item))) e.push(`${tag}: معرّفُ بندٍ غيرُ صالح`);
  if (!/^[0-9a-f]{7,40}$/.test(String(r?.commit))) e.push(`${tag}: بلا هاشِ التزامةٍ مُراجَعة — والحكمُ على شيءٍ لا يُسمّى لا يُقرأ`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r?.convened_at))) e.push(`${tag}: convened_at ليس تاريخًا YYYY-MM-DD`);
  if (r?.decision === 'VERIFIED' && !/^[0-9a-f]{64}$/.test(String(r?.scope_digest ?? ''))) e.push(`${tag}: محضرُ VERIFIED بلا scope_digest — والحكمُ الذي لا يُربط بما رُوجع يُرقّي ما لم يُراجَع (الثابت 6)`);
  if (typeof r?.executor_family !== 'string' || r.executor_family.trim() === '') e.push(`${tag}: بلا عائلةِ المنفّذ — فلا يُقاس اختلافُ العائلات (الثابت 3)`);
  const byId = new Map(d.members.map((m) => [norm(m.id), m]));
  const seen = new Set<string>();
  const verdicts = Array.isArray(r?.verdicts) ? r.verdicts : [];
  for (const v of verdicts) {
    const m = byId.get(norm(v?.member));
    if (m === undefined) { e.push(`${tag}: حكمٌ من غيرِ عضوٍ معلن «${String(v?.member)}»`); continue; }
    if (seen.has(norm(v.member))) e.push(`${tag}: حكمان للعضو «${v.member}»`);
    seen.add(norm(v.member));
    if (norm(m.family) === norm(r.executor_family)) e.push(`${tag}: العضو «${m.id}» من عائلةِ المنفّذ (${m.family}) — والمراجعُ لا يكون من عائلةِ من يراجعه (الثابت 3)`);
    if (!has(COUNCIL_VERDICTS, v.verdict)) e.push(`${tag}: حكمُ «${m.id}» خارجَ المعجم «${String(v.verdict)}»`);
    if (typeof v.report !== 'string' || v.report.trim() === '' || !fileExists(v.report)) e.push(`${tag}: تقريرُ «${m.id}» الخامُّ غيرُ محفوظ «${String(v?.report)}» (الثابت 4)`);
  }
  for (const m of d.members) if (!seen.has(norm(m.id))) e.push(`${tag}: لا حكمَ للعضو «${m.id}» — والقرارُ بلا كلِّ الأعضاء ليس قرارَ مجلس`);
  const unanimous = verdicts.length > 0 && seen.size === d.members.length && verdicts.every((v) => v.verdict === 'VERIFIED');
  if (!has(COUNCIL_DECISIONS, r?.decision)) e.push(`${tag}: قرارٌ خارجَ المعجم «${String(r?.decision)}»`);
  else if (r.decision === 'VERIFIED' && !unanimous) e.push(`${tag}: القرارُ VERIFIED بلا إجماع — والخلافُ لا يُرقّي (الثابت 2)`);
  else if (r.decision === 'NOT_VERIFIED') {
    if (unanimous) e.push(`${tag}: إجماعٌ على VERIFIED وقرارٌ NOT_VERIFIED — قرارٌ يخالف أحكامَه`);
    const k = r.disposition?.kind;
    if (!has(COUNCIL_DISPOSITIONS, k)) e.push(`${tag}: خلافٌ بلا مآلٍ مسمّى (IN_PROGRESS · DISC · RK) — والعيبُ الذي لا يُقيَّد يضيع`);
    else if (k === 'RK' && !/^T-\d+[\u0600-\u06FF]?$/.test(String(r.disposition?.ref ?? ''))) e.push(`${tag}: مآلُ RK بلا معرّفِ دَينٍ T-NNN`);
    else if (k === 'DISC' && String(r.disposition?.ref ?? '').trim() === '') e.push(`${tag}: مآلُ DISC بلا نصِّ الاكتشاف`);
  }
  return e;
}

/** الحكمُ الجامع: الإعلانُ والمحاضرُ وكلُّ VERIFIED في السجلّ الحيّ */
export function evaluateCouncil(
  d: CouncilDeclaration | null | undefined,
  items: QueueItemLike[],
  records: CouncilRecord[],
  fileExists: (p: string) => boolean,
  digestOf?: (scope: readonly string[]) => string,
): string[] {
  const e = checkDeclaration(d);
  if (e.length > 0 || d === null || d === undefined) return e;
  const latest = new Map<string, CouncilRecord>();
  for (const r of records) {
    e.push(...checkRecord(r, d, fileExists));
    const prev = latest.get(r.item);
    if (prev === undefined || String(r.convened_at) >= String(prev.convened_at)) latest.set(r.item, r);
  }
  for (const it of items) {
    if (it.status !== 'VERIFIED') continue;
    const r = latest.get(it.id);
    if (r === undefined) e.push(`${it.id}: حالُه VERIFIED بلا محضرِ مجلس — ولا يُمنح VERIFIED إلّا بإجماع الأعضاء (RULE-020)`);
    else if (r.decision !== 'VERIFIED') e.push(`${it.id}: حالُه VERIFIED وآخرُ محاضره ${r.decision} — الخلافُ يُعيده لا يُرقّيه (RULE-020)`);
    else if (digestOf === undefined || !Array.isArray(it.scope)) e.push(`${it.id}: لا تُقاس بصمةُ نطاقِه — فلا يُثبت أنّ ما رُوجع هو الحالُ القائم (الثابت 6 · فشلٌ مغلق)`);
    else if (digestOf(it.scope) !== r.scope_digest) e.push(`${it.id}: بصمةُ نطاقِه اليومَ لا تساوي بصمةَ المحضر — تغيّر بعد الحكم أو رُوجع غيرُه (الثابت 6 · RULE-020)`);
  }
  for (const [id, r] of latest) {
    if (r.decision !== 'NOT_VERIFIED' || r.disposition?.kind !== 'IN_PROGRESS') continue;
    const it = items.find((x) => x.id === id);
    if (it !== undefined && it.status === 'REVIEW') e.push(`${id}: المجلسُ أعاده إلى IN_PROGRESS وحالُه لا يزال REVIEW`);
  }
  return e;
}
