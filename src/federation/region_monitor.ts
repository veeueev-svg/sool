/**
 * src/federation/region_monitor.ts — مراقبة الأقاليم واحتواء انحرافها (المرحلة 24)
 * المالك: ديوان التدقيق (الرفع) وحرس التاج (الاحتواء)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: حالة سجل الأقاليم وسجل الحكّام ومحكمة النزاع | المخرجات: مخالفات مرفوعة
 * التبعيات: سجل الأقاليم، سجل الحكّام، محكمة النزاع، الاجتماع، السجل غير القابل للمحو
 * السجلات: region_sweep / region_flagged / region_contained / containment_refused
 * ثوابت هذه الوحدة:
 *   1) **المراقب يرفع ولا يعالج**: المسح يُنتج مخالفات معلنة، والاحتواء فعل حرس مسجَّل
 *   2) **لا احتواء بلا مخالفة مرفوعة سابقًا**: العقوبة لا تسبق الإثبات (RULE-006)
 *   3) الاحتواء لا يمحو المخالفة: تبقى في السجل مع أثر الاحتواء — وهو موضعيٌّ للإقليم وحده (T-44)
 *   4) سلطة بلا مسؤول مخالفة: إقليم مفوَّض ومقعد حاكمه خالٍ بعد المهلة يُرفع
 *   5) نطاق محفوظ للتاج بيد إقليم انحرافٌ جسيم يُرفع فورًا بلا مهلة
 *   6) نزاع لم يُحسم بعد مهلته يُرفع — لا نزاع يُنسى
 *   7) (T-45 · W-2026-052) نزاعٌ مُصعَّدٌ بلا حكمٍ ملكيٍّ بعد `ESCALATION_GRACE_MS` من تصعيده يُرفع جسيمًا —
 *      التصعيدُ ينقل الحسمَ إلى الملك ولا يُعفيه من مدّة
 *   8) (T-47 · W-2026-052) التماسُ أقاليمَ `pending` بعد `PETITION_GRACE_MS` يُرفع — لا التماسَ بلا جواب
 * حالات الفشل (كلها مغلقة): احتواء من غير الحرس ⇒ رفض؛ احتواء بلا مخالفة ⇒ رفض؛
 *   احتواء لإقليم غير قائم ⇒ رفض
 * اختبار القبول: tests/federation/federation_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0008-federation-and-governors.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CROWN_RESERVED_DOMAINS, RegionRegistry } from './region_registry';
import { GovernorRegistry, GOVERNOR_EXECUTOR } from './governor';
import { RegionalTribunal } from './dispute_resolution';
import { RegionalAssembly } from './regional_assembly';

/** ديوان التدقيق: يرفع المخالفة ولا ينفّذ الاحتواء (RULE-004) */
export const REGION_AUDITOR: EntityId = 'authority:audit_bureau';
/** مهلة شغل مقعد الحاكم في إقليم مفوَّض */
export const VACANCY_GRACE_MS = 48 * 60 * 60 * 1000;
/** مهلة حسم النزاع قبل رفعه مخالفةً */
export const DISPUTE_GRACE_MS = 72 * 60 * 60 * 1000;
/** T-45: مدّةُ الحكمِ الملكيِّ في نزاعٍ مُصعَّد — تُعدّ من لحظة التصعيد لا من رفع النزاع */
export const ESCALATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** T-47: مدّةُ جوابِ الملكِ على التماسِ الأقاليم */
export const PETITION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type FlagKind =
  | 'delegated_without_governor'
  | 'reserved_domain_drift'
  | 'governor_without_region'
  | 'dispute_unresolved'
  | 'escalation_unruled'
  | 'petition_unanswered';

export interface RegionFlag {
  readonly kind: FlagKind;
  readonly regionId: EntityId;
  readonly detail: string;
  readonly at: number;
  readonly severity: 'high' | 'medium';
  readonly auditId: string;
  readonly containedAt: number | null;
}

export interface RegionMonitorDeps {
  readonly audit: AppendOnlyLog;
  readonly regions: RegionRegistry;
  readonly governors: GovernorRegistry;
  readonly tribunal: RegionalTribunal;
  readonly vacancyGraceMs?: number;
  readonly disputeGraceMs?: number;
  /** T-47: مصدرُ الالتماسات — غيابُه في تركيبٍ قديمٍ يُبقي الالتماسَ بلا رقيب، فهو إلزاميّ */
  readonly assembly: RegionalAssembly;
  readonly escalationGraceMs?: number;
  readonly petitionGraceMs?: number;
}

export class RegionMonitor {
  private readonly flags: RegionFlag[] = [];
  /** T-44 (W-2026-056): الأقاليمُ المحتواة — الاحتواءُ موضعيٌّ لا قاطعٌ عامٌّ يوقف السليمَ معها */
  private readonly contained = new Map<EntityId, number>();
  private readonly vacancyGraceMs: number;
  private readonly disputeGraceMs: number;
  private readonly escalationGraceMs: number;
  private readonly petitionGraceMs: number;

  constructor(private readonly deps: RegionMonitorDeps) {
    this.vacancyGraceMs = deps.vacancyGraceMs ?? VACANCY_GRACE_MS;
    this.disputeGraceMs = deps.disputeGraceMs ?? DISPUTE_GRACE_MS;
    this.escalationGraceMs = deps.escalationGraceMs ?? ESCALATION_GRACE_MS;
    this.petitionGraceMs = deps.petitionGraceMs ?? PETITION_GRACE_MS;
  }

  /** مسح دوري: يرفع المخالفات ولا يعالجها (ثابت 1) */
  sweep(now = Date.now()): { readonly flags: readonly RegionFlag[]; readonly auditId: string } {
    const raised: RegionFlag[] = [];
    const raise = (
      kind: FlagKind, regionId: EntityId, detail: string, severity: 'high' | 'medium',
    ): void => {
      const entry = this.deps.audit.append(REGION_AUDITOR, 'region_flagged', {
        kind, regionId, detail, severity, at: now,
      });
      const flag: RegionFlag = {
        kind, regionId, detail, at: now, severity, auditId: entry.hash, containedAt: null,
      };
      this.flags.push(flag);
      raised.push(flag);
    };

    for (const region of this.deps.regions.active()) {
      // ثابت 5: نطاق محفوظ للتاج بيد إقليم — انحراف جسيم بلا مهلة
      const reserved = region.domains.filter((d) => CROWN_RESERVED_DOMAINS.includes(d));
      if (reserved.length > 0) {
        raise('reserved_domain_drift', region.regionId,
          `نطاق محفوظ للتاج بيد الإقليم: ${reserved.join(', ')}`, 'high');
      }
      // ثابت 4: سلطة بلا مسؤول
      if (region.autonomy === 'delegated' && this.deps.governors.governorOf(region.regionId) === undefined) {
        const elapsed = now - region.establishedAt;
        if (elapsed > this.vacancyGraceMs) {
          raise('delegated_without_governor', region.regionId,
            `إقليم مفوَّض ومقعد حاكمه خالٍ منذ ${Math.floor(elapsed / 3600000)} ساعة`, 'high');
        }
      }
    }

    // حاكم جالس في إقليم غير قائم — لا يقع عادةً، والمسح يكشفه إن وقع
    for (const seat of this.deps.governors.seatedRegions()) {
      if (!this.deps.regions.isActive(seat.regionId)) {
        raise('governor_without_region', seat.regionId,
          `حاكم جالس في إقليم غير قائم: ${seat.governor}`, 'high');
      }
    }

    // ثابت 6: نزاع لم يُحسم بعد مهلته
    for (const dispute of this.deps.tribunal.open()) {
      if (now - dispute.raisedAt > this.disputeGraceMs) {
        raise('dispute_unresolved', dispute.claimant,
          `نزاع ${dispute.disputeId} مع ${dispute.respondent} لم يُحسم بعد مهلته`, 'medium');
      }
      // ثابت 7: المُصعَّدُ ينتظر الملك — ومدّتُه من التصعيد
      if (dispute.status === 'escalated' && dispute.escalation
        && now - dispute.escalation.at > this.escalationGraceMs) {
        raise('escalation_unruled', dispute.claimant,
          `نزاع ${dispute.disputeId} مُصعَّدٌ إلى الملك بلا حكمٍ منذ ${Math.floor((now - dispute.escalation.at) / 3600000)} ساعة`, 'high');
      }
    }

    // ثابت 8: التماسٌ بلا جواب
    for (const petition of this.deps.assembly.pending()) {
      if (now - petition.raisedAt > this.petitionGraceMs) {
        raise('petition_unanswered', petition.attendees[0] ?? 'council:regions',
          `التماس ${petition.petitionId} («${petition.subject}») بلا جوابٍ ملكيٍّ بعد مهلته`, 'medium');
      }
    }

    const entry = this.deps.audit.append(REGION_AUDITOR, 'region_sweep', {
      at: now, regions: this.deps.regions.active().length,
      flags: raised.length, high: raised.filter((f) => f.severity === 'high').length,
    });
    return { flags: raised, auditId: entry.hash };
  }

  /**
   * الاحتواء: إيقاف يوقعه الحرس بعد مخالفة مرفوعة (ثوابت 1 و2 و3).
   * الاحتواء لا يسحب التفويض بنفسه — السحب أمر ملكي بسجل الأقاليم (RULE-003).
   */
  contain(
    actor: EntityId, regionId: EntityId, kind: FlagKind, reason: string, now = Date.now(),
  ): { readonly ok: boolean; readonly reason?: string; readonly auditId: string } {
    const refuse = (why: string): { ok: false; reason: string; auditId: string } => {
      const entry = this.deps.audit.append(actor, 'containment_refused', {
        regionId, kind, reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (actor !== GOVERNOR_EXECUTOR) return refuse('الاحتواء لحرس التاج وحده (RULE-004)');
    if (reason.trim().length < 3) return refuse('لا احتواء بلا سبب معلن (RULE-006)');
    if (!this.deps.regions.isActive(regionId)) return refuse('إقليم غير قائم');
    const flag = this.flags.find(
      (f) => f.regionId === regionId && f.kind === kind && f.containedAt === null,
    );
    if (!flag) return refuse('لا احتواء بلا مخالفة مرفوعة سابقًا (ثابت 2)');

    // ثابت 3: المخالفة تبقى، ويُسجَّل عليها أثر الاحتواء
    const index = this.flags.indexOf(flag);
    this.flags[index] = { ...flag, containedAt: now };
    // T-44: يُحتوى الإقليمُ وحده — أفعالُ حاكمه تُرفض عند الباب، والأقاليمُ السليمةُ تعمل
    this.contained.set(regionId, now);
    const entry = this.deps.audit.append(actor, 'region_contained', {
      regionId, kind, reason: reason.trim(), flagAudit: flag.auditId, at: now, scope: 'region',
      note: 'الاحتواء لا يسحب التفويض — السحب أمر ملكي',
    });
    return { ok: true, auditId: entry.hash };
  }

  /** T-44: رفعُ الاحتواء الموضعيّ — لحرس التاج وحده وبسببٍ معلن، والمخالفةُ تبقى في التاريخ */
  release(
    actor: EntityId, regionId: EntityId, reason: string, now = Date.now(),
  ): { readonly ok: boolean; readonly reason?: string; readonly auditId: string } {
    const why = actor !== GOVERNOR_EXECUTOR ? 'رفعُ الاحتواء لحرس التاج وحده (RULE-004)'
      : reason.trim().length < 3 ? 'لا رفع بلا سبب معلن (RULE-006)'
        : !this.contained.has(regionId) ? 'إقليمٌ غير محتوى' : null;
    if (why) {
      const refused = this.deps.audit.append(actor, 'containment_refused', { regionId, reason: why, mode: 'release' });
      return { ok: false, reason: why, auditId: refused.hash };
    }
    const since = this.contained.get(regionId);
    this.contained.delete(regionId);
    const entry = this.deps.audit.append(actor, 'region_released', { regionId, reason: reason.trim(), since, at: now });
    return { ok: true, auditId: entry.hash };
  }

  /** T-44: هل الإقليمُ محتوًى الآن؟ — يقرؤه سجلُّ الحكّام قبل كلِّ فعل */
  isContained(regionId: EntityId): boolean {
    return this.contained.has(regionId);
  }

  /** كل المخالفات المرفوعة — لا تُحذف (RULE-006) */
  history(): readonly RegionFlag[] {
    return [...this.flags];
  }

  /** المخالفات التي لم تُحتوَ بعد */
  outstanding(): readonly RegionFlag[] {
    return this.flags.filter((f) => f.containedAt === null);
  }

  report(): { flags: number; outstanding: number; contained: number; high: number } {
    return {
      flags: this.flags.length,
      outstanding: this.outstanding().length,
      contained: this.flags.filter((f) => f.containedAt !== null).length,
      high: this.flags.filter((f) => f.severity === 'high').length,
    };
  }
}
