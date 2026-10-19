/**
 * src/economy/tax_types.ts — أنواعُ الرسوم: التقديرُ ونتيجتُه ونتيجةُ تعديلِ النسبة (المرحلة 25 · T-53)
 * فُكِّكت من src/economy/tax.ts لسقفِ الوحدةِ 400 سطرًا (الجلسة 136 · W-2026-065 — سابقةُ T-125 وrate_policy):
 * الأنواعُ نفسُها بحروفِها بلا تغييرٍ في الشكلِ أو المعنى، ويُعيدُ tax.ts تصديرَها فلا يتغيّرُ مستوردٌ.
 * الجلسة 139 (علاجُ عيبَي الجولة 41 · W-2026-065): أُضيفَ هنا معقّمُ القيدِ auditPrimitive
 * لسقفِ tax.ts نفسِه (399/400): قيدُ الرفضِ لا يحملُ مرجعًا حيًّا (ثابت 12) — وكلُّ مُسندٍ باقٍ بحروفِه.
 * الجلسة 141 (علاجُ عيبِ الجولة 43 · W-2026-065): نُقلَ حرفيًا إلى هنا واجهةُ RevenueDeps
 * لسقفِ tax.ts نفسِه (الواجهةُ بحروفِها بلا تغييرٍ — سابقةُ الجلستين 133 و136) مع حارسِ issuedAt.
 * المالك: وزارة المالية تحت التاج | القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md
 */
import { EntityId, RoyalCommandPayload, SignedRoyalCommand } from '../kernel/types';
import type { AppendOnlyLog } from '../audit/append_only_log';
import type { CrownGateway } from '../crown/crown_gateway';
import type { Treasury } from './treasury';
import type { RateDeclaration } from './rate_policy';

export type LevyStatus = 'assessed' | 'collected' | 'waived';

/** واجهةُ تبعياتِ خدمةِ الرسوم (فُكِّكت من tax.ts بحروفِها — الجلسة 141 · لسقفِ الوحدة) */
export interface RevenueDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly treasury: Treasury;
  readonly revenueAccount: string;
  /** النِسَب المعلنة في config/economy.yaml (ثابت 1) */
  readonly rates: readonly RateDeclaration[];
  /** هل يُسمح بالأثر الرجعي؟ معلن في التهيئة، وقيمته الملزمة: لا (ثابت 2) */
  readonly retroactiveAllowed: boolean;
  readonly actorId?: EntityId;
}

export interface Levy {
  readonly levyId: string;
  readonly base: string;
  readonly payer: EntityId;
  readonly amountBase: number;
  readonly ratePerMille: number;
  readonly levied: number;
  readonly status: LevyStatus;
  readonly occurredAt: number;
  readonly assessedAt: number;
  readonly collectedAt: number | null;
  readonly receiptEntryId: string | null;
  readonly waiveReason: string | null;
}

export type LevyResult =
  | { readonly ok: true; readonly levy: Levy; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** نتيجةُ تعديلِ النسبةِ الملكيّ (T-53): الإعلانُ الجديدُ والسابقُ معًا أو رفضٌ بسببٍ موثّق */
export type RateAmendmentResult =
  | { readonly ok: true; readonly declaration: RateDeclaration; readonly previous: RateDeclaration; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** ثابت 12 (الجولة 41 · علاجُ الجلسة 139): المدخلُ غيرُ البدائيِّ لا يُخزَّنُ مرجعُه الحيُّ في قيدِ
 *  الرفض — يُقنَّعُ برمزٍ مغلقٍ قبلَ التدوينِ فلا يعبثُ المستدعي بالسلسلةِ بعدَ الرفضِ ولا يُقتلُ الإقلاع */
export function auditPrimitive(value: unknown): unknown {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
    ? value
    : 'مدخلٌ غيرُ بدائيٍّ — لا يُخزَّنُ مرجعُهُ الحيُّ (ثابت 12)';
}

/**
 * حارسُ شهودِ الأمرِ الملكيّ ولقطةُهُ الموحّدة (الجولتان 43–44 · W-2026-065): المعرّفُ ولحظةُ
 * الإصدارِ وحمولةُ الأمرِ كلُّها تُقرأُ قراءةً واحدةً — فالكائنُ ذا `valueOf` يمرُّ بوابةَ التاجِ
 * (العمرُ بالطرحِ) وغيرُ النصّيِّ يمرُّها بلا فحصِ نوعٍ، ثمّ يُدوَّنُ مرجعًا حيًّا فيكسرُ العبثُ
 * بعدَ النجاحِ سلامةَ السلسلةِ ويقتلُ الإقلاعَ (الجولة 43 · RATE_AMENDMENT_COMMAND_ISSUED_AT_UNGUARDED
 * والجولة 44 · RATE_AMENDMENT_COMMAND_ID_UNGUARDED وTAX_WAIVE_COMMAND_ID_LIVE_REFERENCE). واللقطةُ
 * تُمرَّرُ إلى البوابةِ فيكونُ المفحوصُ والمعتمدُ والمخزَّنُ قراءةً واحدةً — فالقارئةُ المنقلبةُ
 * أثناءَ التنفيذِ لا تُفرّقُ بينَها.
 */
export type RoyalCommandWitness =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly commandId: string; readonly command: SignedRoyalCommand; readonly commandIssuedAt?: number };

export function royalCommandWitness(
  command: SignedRoyalCommand, withIssuedAt: true,
): { readonly ok: true; readonly commandId: string; readonly command: SignedRoyalCommand; readonly commandIssuedAt: number } | { readonly ok: false; readonly reason: string };
export function royalCommandWitness(
  command: SignedRoyalCommand, withIssuedAt: false,
): { readonly ok: true; readonly commandId: string; readonly command: SignedRoyalCommand } | { readonly ok: false; readonly reason: string };
export function royalCommandWitness(
  command: SignedRoyalCommand, withIssuedAt: boolean,
): RoyalCommandWitness {
  const payload = command.payload;
  const commandId = payload.commandId;
  const issuedAt = payload.issuedAt;
  // الجولة 47 (gpt · TAX_WAIVE_COMMAND_ISSUED_AT_MUTABLE_EXPIRY_BYPASS): الحارسُ البدائيُّ صار
  // لكلِّ الاستدعاءاتِ لا لـamendRate وحده — فمسارُ الإعفاءِ كان يمرِّرُ كائنَ Date متحركًا يُوقَّعُ
  // كـ{} (طيُّ canonicalize) ثم يُحرَّكُ بعدَ التوقيعِ فيتجاوزُ نافذةَ صلاحيةِ البوابةِ ويُدوِّنُ الإعفاءَ
  // الدائمَ ويَنجو الإقلاع. واللقطةُ تخزنُه بدائيًّا مقروءًا مرّةً واحدةً فلا مرجعَ حيًّا بعدَ النجاح.
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) {
    return { ok: false, reason: 'لحظةُ إصدارِ الأمرِ رقمٌ محددٌ لا كائنٌ يُكرَه عند حسابِ العمر — وذاك مرجعٌ حيٌّ يُدوَّنُ في السجلِّ فيكسرُه' };
  }
  if (typeof commandId !== 'string' || commandId.trim().length === 0) {
    return { ok: false, reason: 'معرّفُ الأمرِ نصٌّ محددٌ غيرُ فارغ — فغيرُ النصّيِّ يُدوَّنُ خامًّا في السجلِّ فيكسرُه العبثُ بعدَ النجاحِ ويقتلُ الإقلاعَ' };
  }
  // الجولة 45 (grok · AUDIT_ACTOR_LIVE_REFERENCE_UNBOOTABLE): المُصدِرُ يُقرأُ قراءةً
  // واحدةً ويُحرسُ نصًّا — فالكائنُ الحيُّ كان يصلُ شاهدَ sovereign_violation وcommand_denied
  // مرجعًا فيكسرُ قلبُه السلسلةَ ويقتلُ toJSON الإقلاعَ.
  const issuedBy = payload.issuedBy;
  if (typeof issuedBy !== 'string' || issuedBy.trim().length === 0) {
    return { ok: false, reason: 'مُصدِرُ الأمرِ نصٌّ محددٌ — فالمرجعُ الحيُّ يُدوَّنُ في قيودِ البوابةِ الدائمةِ فيكسرُه العبثُ بعدَ الرفضِ ويقتلُ الإقلاعَ' };
  }
  const params = payload.params;
  const payloadSnapshot: RoyalCommandPayload = {
    commandId,
    issuedBy,
    action: payload.action,
    target: payload.target,
    params: params ? { ...params } : params,
    issuedAt,
    nonce: payload.nonce,
  };
  return withIssuedAt
    ? { ok: true, commandId, command: { ...command, payload: payloadSnapshot }, commandIssuedAt: issuedAt }
    : { ok: true, commandId, command: { ...command, payload: payloadSnapshot } };
}

/**
 * الجولة 47 (grok · RATE_AMENDMENT_APPROVAL_BINDING_OMITS_ISSUED_AT): نافذةُ عمرِ الأمرِ
 * المعلنةُ عندَ بوابةِ التاجِ (120 ثانيةً في التركيبِ وDEFAULT_POLICY معًا · وتسامحُ المستقبلِ 5 ثوانٍ
 * في authorize نفسِها) — يُعكسُها الربطُ هنا فلا يُقبلُ قرارٌ معادٌ لأمرٍ صدرَ خارجَ نافذتِه. اقترانٌ
 * معلنٌ لا صامت: إن غُيِّرتْ نافذةُ البوابةِ في التركيبِ فليُحدَّثْ هذا الثابتُ معها.
 */
const GATEWAY_MAX_COMMAND_AGE_MS = 120_000;
const GATEWAY_FUTURE_TOLERANCE_MS = 5_000;

/**
 * الجولة 46 (grok · RATE_AMENDMENT_IDEMPOTENT_APPROVAL_NOT_PAYLOAD_BOUND): بوابةُ التاجِ تعيدُ القرارَ السابقَ لأيِّ
 * حمولةٍ تحملُ commandId سبقَ اعتمادُه قبلَ فحصِ التوقيعِ والفعلِ والهدف — فمعرّفُ declare_emergency المعتمدُ كان
 * يمرِّرُ amend_policy (وwaive) بتوقيعٍ مزوّر. فالاعتمادُ هنا: (1) أمرٌ نُفّذ في قيدِ executedKind لا يُنفَّذُ ثانيةً
 * (نظيرُ hasExecuted في amendRate — وwaive كان بلا حارسٍ أصلًا)؛ (2) البوابةُ تعتمد؛ (3) قيدُ command_approved الذي
 * يشيرُ إليه القرارُ واحدٌ ويطابقُ حمولةَ اللقطةِ بعينِها (المعرّفُ والفعلُ والهدفُ وparams) — فشلٌ مغلق. إعادةُ
 * الحمولةِ المعتمدةِ نفسِها بعدَ فشلٍ سابقٍ مشروعة، والقرارُ لحمولةٍ أخرى ليس اعتمادًا. البوابةُ نفسُها لا تُلمس هنا
 * (src/crown/crown_gateway.ts خارجَ نطاقِ W-2026-065).
 *
 * الجولة 47 (grok · RATE_AMENDMENT_APPROVAL_BINDING_OMITS_ISSUED_AT): الربطُ كانَ يتجاهلُ ما تبقّى من
 * حمولةِ الأمرِ الموقَّعةِ — فأمرٌ غيرُ موقَّعٍ يعيدُ معرّفًا معتمدًا بـissuedAt=1 وissuedBy مزوّرٍ كانَ يُنفَّذُ
 * ويُدوَّنُ الشاهدُ كذبًا (commandIssuedAt=1) ويَنجو الإقلاعُ. فالربطُ صارَ يلزمُ المُصدِرَ (فاعلَ قيدِ
 * الاعتمادِ) ويلزمُ issuedAt داخلَ نافذةِ العمرِ المعلنةِ (أعلاه) — فلا يُقبلُ قرارٌ معادٌ لحمولةٍ لم تصدرْ
 * في نافذتِها ولا لمُصدِرٍ غيرِ مَن اعتُمدَ له. والبقيّةُ الباقيةُ (توقيعٌ لا يُمكنُ التحقّقُ منه هنا بلا مفتاحِ
 * الملكِ العام) جذرُها في البوابةِ نفسِها — مُسجَّلةً في عقدِ البند لا مُخفاة.
 */
export function authorizeBound(
  deps: Pick<RevenueDeps, 'audit' | 'gateway'>, command: SignedRoyalCommand, now: number, executedKind?: string,
): { ok: true } | { ok: false; reason: string; extra: Record<string, unknown> } {
  const commandId = command.payload.commandId;
  if (executedKind !== undefined && deps.audit.find(executedKind).some((e) => e.detail['commandId'] === commandId)) {
    return { ok: false, reason: 'الأمر نُفّذ سابقًا — إعادتُه لا تُنفَّذ ثانيةً', extra: { commandId } };
  }
  const decision = deps.gateway.authorize(command, now);
  if (!decision.allowed) return { ok: false, reason: `الأمر غير معتمد: ${decision.reason}`, extra: {} };
  const hits = deps.audit.find('command_approved').filter((e) => e.hash === decision.auditId);
  const hit = hits.length === 1 ? hits[0]! : null;
  const d = hit ? hit.detail : null;
  const p = command.payload;
  const ageMs = now - (p.issuedAt as number);
  const bound = hit !== null && d !== null
    && d['commandId'] === p.commandId && d['action'] === p.action && d['target'] === p.target
    && canonicalJson(d['params'] ?? null) === canonicalJson(p.params ?? null)
    && hit.actor === p.issuedBy
    && typeof p.issuedAt === 'number' && Number.isFinite(p.issuedAt)
    && ageMs <= GATEWAY_MAX_COMMAND_AGE_MS && ageMs >= -GATEWAY_FUTURE_TOLERANCE_MS;
  if (!bound) return { ok: false, reason: 'اعتمادُ البوابةِ لا يطابقُ حمولةَ هذا الأمر — لا أثرَ بقرارٍ لحمولةٍ أخرى', extra: { commandId } };
  return { ok: true };
}

/** تمثيلٌ قانونيٌّ مرتّبُ المفاتيح لمقابلةِ params المعتمدةِ بحمولةِ اللقطة (الجولة 46) */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
