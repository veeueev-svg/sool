/**
 * src/agents/spawn_policy.ts — سياسة التوالد وحدوده (المرحلة 19 · شُدّت في 39)
 * المالك: وزارة الداخلية (بمراجعة وزارة الأمن السيبراني)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مخططات توالد معلنة (blueprints) + طلب دفعة + حالة السكان الحالية
 * المخرجات: حكم واحد على الدفعة **كاملة**: مسموح أو مرفوض بسببه — لا حكم جزئي
 * التبعيات: السجل ودفترُ الحجز وحسابُ النسب — السياسة لا تنشئ ولا تنهي
 * الصلاحيات: إعلان مخطط = تعديل سياسة بأمر ملكي (amend_policy)؛ التجميد بلا أمر
 * السجلات: blueprint_declared / blueprint_refused / spawn_frozen / spawn_thawed /
 *          spawn_policy_denied / spawn_reserved / spawn_reservation_expired /
 *          spawn_recorded_without_reservation / lineage_drift_detected
 * ثوابت هذه الوحدة:
 *   1) لا توالد إلا من مخطط معلن معتمد — لا مخطط ضمني
 *   2) **لا وكيل يولّد وكيلًا** — طالب التوالد لا يجوز أن يكون كيانًا من نوع agent
 *   3) سقف نسخ لكل مخطط، وسقف حجم الدفعة، وسقف توالد في الساعة فوق سقف الدقيقة
 *   4) **حدُّ الأجيال يُقاس على النسب لا على الدعوى** (T-25): مخططٌ بلا أصلٍ
 *      جيلُه 1، ومشتقٌّ جيلُه جيلُ أصله + 1، والدعوى المخالفة مرفوضة. قبل هذا
 *      البند كان المخططُ يعلن جيلَه عن نفسه: سلسلةُ أربعين مخططًا مشتقًّا كلُّها
 *      تُعلن «جيل 1» مرّت من حدٍّ أقصاه اثنان — عمقٌ بلا حدٍّ فعليّ.
 *   5) الحكم على الدفعة كاملة قبل إنشاء أي وكيل — لا دفعة جزئية
 *   6) التجميد إجراء فوري بلا أمر، ويعلو على كل مخطط معتمد
 *   7) **النصيبُ يُخصم لحظةَ الحكم لا بعده** (T-25): الطريقُ المضمون
 *      `reserveBatch` ⇒ `commitReservation` أو `releaseReservation`. القياسُ قبل
 *      ذلك: سقفٌ خمسٌ وأربعُ دفعاتٍ متزامنةٍ سُمح لها كلُّها ⇒ **عشرون نسخة**.
 *   8) **الحدودُ من التهيئة وحدها** (RULE-005): `config/reproduction.yaml`
 * حالات الفشل (كلها مغلقة): أي شك أو نقص ⇒ رفض الدفعة كاملة
 * اختبار القبول: tests/agents/factory.test.ts · tests/agents/lineage.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { ReproductionLimits, loadReproduction } from '../kernel/config/reproduction';
import { derivePendingLineage, verifyLineageClaims, LineageDrift } from './lineage';
import { SpawnReservation, SpawnReservationLedger } from './spawn_reservations';

/** مخطط توالد معلن: ما يُسمح بتوليده، وكم، ومن أي أصل */
export interface AgentBlueprint {
  readonly blueprintId: string;
  readonly template: string;
  readonly maxInstances: number;
  /** جيل الوكلاء المولَّدين من هذا المخطط — 1 هو الجيل الأول من سلطة بشرية */
  readonly generation: number;
  readonly purpose: string;
  /**
   * أصلُ المخطط: مخططٌ معلنٌ سابق، أو `null`/غيابٌ = جذرٌ من سلطةٍ بشريّة مباشرة.
   * والجيلُ المعلن أعلاه يجب أن **يطابق** ما يُقاس من هذا النسب.
   */
  readonly derivedFrom?: string | null;
}

/** حدودُ التوالد — مصدرُها `config/reproduction.yaml` وحدها (RULE-005) */
export type SpawnLimits = ReproductionLimits;

export interface SpawnRequestFacts {
  readonly blueprintId: string;
  readonly count: number;
  readonly requestedBy: EntityId;
  /** السكان الأحياء الحاليون والسقف السكاني — من سجل الوكلاء */
  readonly population: number;
  readonly populationMax: number;
}

export interface SpawnPolicyDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly limits?: SpawnLimits;
  readonly ministryId?: EntityId;
}

export type ReservedBatch =
  | { readonly allowed: true; readonly reservation: SpawnReservation; readonly auditId: string }
  | { readonly allowed: false; readonly reason: string; readonly auditId: string };

export class SpawnPolicy {
  private readonly blueprints = new Map<string, AgentBlueprint>();
  private readonly parents = new Map<string, string | null>();
  private readonly lineages = new Map<string, readonly string[]>();
  private readonly ledger: SpawnReservationLedger;
  private readonly spawnTimes: number[] = [];
  private frozen: { readonly by: EntityId; readonly reason: string } | null = null;
  private readonly ministryId: EntityId;
  private unreservedRecords = 0;
  readonly limits: SpawnLimits;

  constructor(private readonly deps: SpawnPolicyDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:interior';
    this.limits = deps.limits ?? loadReproduction().limits;
    this.ledger = new SpawnReservationLedger(this.limits);
    deps.audit.append(this.ministryId, 'spawn_policy_online', { limits: this.limits });
  }

  get isFrozen(): boolean {
    return this.frozen !== null;
  }

  get freezeReason(): string | null {
    return this.frozen?.reason ?? null;
  }

  blueprint(blueprintId: string): AgentBlueprint | undefined {
    return this.blueprints.get(blueprintId);
  }

  list(): readonly AgentBlueprint[] {
    return [...this.blueprints.values()];
  }

  instancesOf(blueprintId: string): number {
    return this.ledger.committedOf(blueprintId);
  }

  /** سلسلةُ النسب المقيسة من الجذر إلى المخطط — دليلُ الجيل لا دعواه */
  lineageOf(blueprintId: string): readonly string[] | undefined {
    return this.lineages.get(blueprintId);
  }

  /** مقابلةُ كلِّ جيلٍ معلنٍ بنسبِه المقيس — تكشف ولا تُصلح (درسُ T-119) */
  verifyLineage(): { readonly ok: boolean; readonly drifts: readonly LineageDrift[] } {
    const claims = new Map<string, number>();
    for (const [id, bp] of this.blueprints) claims.set(id, bp.generation);
    const result = verifyLineageClaims(claims, (id) => this.parents.get(id));
    if (!result.ok) {
      this.deps.audit.append(this.ministryId, 'lineage_drift_detected', {
        drifts: result.drifts.length, detail: result.drifts,
      });
    }
    return result;
  }

  /** إعلان مخطط توالد — تعديل سياسة بأمر ملكي لا قرار تشغيلي */
  declareBlueprint(command: SignedRoyalCommand, blueprint: AgentBlueprint, now = Date.now()): Decision {
    const refuse = (reason: string): Decision => {
      const entry = this.deps.audit.append(this.ministryId, 'blueprint_refused', {
        blueprintId: blueprint.blueprintId, reason, commandId: command.payload.commandId,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر إعلان المخطط مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'amend_policy') {
      return refuse('إعلان مخطط توالد تعديل سياسة — لا يقع بفعل آخر');
    }
    if (!blueprint.blueprintId || !blueprint.template) return refuse('مخطط بلا معرّف أو بلا قالب دور');
    if (!blueprint.purpose) return refuse('لا مخطط بلا غرض معلن');
    if (this.blueprints.has(blueprint.blueprintId)) return refuse('معرّف مخطط مستخدَم — لا تكرار');
    if (!Number.isInteger(blueprint.maxInstances) || blueprint.maxInstances <= 0) {
      return refuse('سقف نسخ غير صالح — لا مخطط بلا سقف');
    }
    if (!Number.isInteger(blueprint.generation) || blueprint.generation < 1) {
      return refuse('جيل غير صالح');
    }
    if (blueprint.generation > this.limits.generationMax) {
      return refuse(`جيل ${blueprint.generation} يفوق حد الأجيال (${this.limits.generationMax})`);
    }

    // الثابت الرابع: الجيلُ يُقاس من النسب، والدعوى المخالفةُ مرفوضة
    const parent = blueprint.derivedFrom ?? null;
    const lineage = derivePendingLineage(blueprint.blueprintId, parent, (id) => this.parents.get(id));
    if (!lineage.ok) return refuse(lineage.reason);
    if (lineage.generation !== blueprint.generation) {
      return refuse(
        `جيلٌ مُعلنٌ ${blueprint.generation} يخالف النسبَ المقيس (${lineage.generation})`
        + ` — سلسلةُ النسب: ${lineage.chain.join(' ← ')}`,
      );
    }
    if (lineage.generation > this.limits.generationMax) {
      return refuse(
        `النسبُ المقيس ${lineage.generation} يفوق حد الأجيال (${this.limits.generationMax})`,
      );
    }

    this.blueprints.set(blueprint.blueprintId, blueprint);
    this.parents.set(blueprint.blueprintId, parent);
    this.lineages.set(blueprint.blueprintId, lineage.chain);
    const entry = this.deps.audit.append(this.ministryId, 'blueprint_declared', {
      blueprintId: blueprint.blueprintId, template: blueprint.template,
      maxInstances: blueprint.maxInstances, generation: blueprint.generation,
      derivedFrom: parent, lineage: lineage.chain,
      purpose: blueprint.purpose, commandId: command.payload.commandId,
    });
    return { allowed: true, reason: 'أُعلن المخطط', auditId: entry.hash };
  }

  /** تجميد التوالد — فوري بلا أمر، ويعلو على كل مخطط معتمد */
  freeze(by: EntityId, reason: string): void {
    this.frozen = { by, reason };
    this.deps.audit.append(by, 'spawn_frozen', { reason });
  }

  /** فك التجميد — قرار ملكي أو حرس التاج، ويُسجَّل */
  thaw(by: EntityId, reason: string): boolean {
    if (!this.frozen) return false;
    this.frozen = null;
    this.deps.audit.append(by, 'spawn_thawed', { reason });
    return true;
  }

  /**
   * الحكمُ على الدفعة كاملة — **قراءةٌ لا تحجز**. يقيس على النصيب المشغول
   * كلِّه (مُثبَّتٌ + محجوزٌ معلَّق)، فلا يُرى نصيبٌ محجوزٌ متاحًا. ومن أراد أن
   * يُنشئ فعلًا فطريقُه `reserveBatch` — فبين الحكم والفعل نافذةٌ بطبعها.
   */
  evaluate(facts: SpawnRequestFacts, now = Date.now()): Decision {
    const denial = this.judge(facts, now);
    if (denial) return this.deny(facts, denial.reason, denial.kind);
    return { allowed: true, reason: 'الدفعة داخل كل الحدود المعلنة', auditId: '' };
  }

  /**
   * الحكمُ والحجزُ في خطوةٍ واحدة: الطريقُ المضمون. النصيبُ يُخصم فورًا،
   * فحكمٌ ثانٍ متزامنٌ يرى النصيبَ مشغولًا ويُرفض.
   */
  reserveBatch(facts: SpawnRequestFacts, now = Date.now()): ReservedBatch {
    const expiredBefore = this.ledger.expired();
    const denial = this.judge(facts, now);
    this.reportExpiry(expiredBefore);
    if (denial) {
      const d = this.deny(facts, denial.reason, denial.kind);
      return { allowed: false, reason: d.reason, auditId: d.auditId };
    }
    const blueprint = this.blueprints.get(facts.blueprintId);
    if (!blueprint) {
      const d = this.deny(facts, 'مخطط غير معلن — لا توالد بلا مخطط معتمد');
      return { allowed: false, reason: d.reason, auditId: d.auditId };
    }
    const held = this.ledger.reserve(facts.blueprintId, facts.count, blueprint.maxInstances, now);
    if (!held.ok) {
      const d = this.deny(facts, held.reason, 'blueprint_cap_reached');
      return { allowed: false, reason: d.reason, auditId: d.auditId };
    }
    for (let i = 0; i < facts.count; i += 1) this.spawnTimes.push(now);
    const entry = this.deps.audit.append(this.ministryId, 'spawn_reserved', {
      reservationId: held.reservation.reservationId, blueprintId: facts.blueprintId,
      count: facts.count, expiresAt: held.reservation.expiresAt,
    });
    return { allowed: true, reservation: held.reservation, auditId: entry.hash };
  }

  /** تثبيتُ حجزٍ بعد نجاح الدفعة — النصيبُ المعلَّق يصير مُثبَّتًا */
  commitReservation(reservationId: string, now = Date.now()): boolean {
    const settled = this.ledger.commit(reservationId, now);
    this.deps.audit.append(this.ministryId, settled.ok ? 'spawn_committed' : 'spawn_settle_refused', {
      reservationId, reason: settled.ok ? undefined : settled.reason,
    });
    return settled.ok;
  }

  /** الإفراجُ عن حجزٍ بعد إلغاء الدفعة — والرجوعُ لا يُترك ضمنيًّا */
  releaseReservation(reservationId: string, now = Date.now()): boolean {
    const settled = this.ledger.release(reservationId, now);
    if (settled.ok) {
      const back = settled.reservation.count;
      this.spawnTimes.splice(Math.max(0, this.spawnTimes.length - back), back);
    }
    this.deps.audit.append(this.ministryId, settled.ok ? 'spawn_released' : 'spawn_settle_refused', {
      reservationId, reason: settled.ok ? undefined : settled.reason,
    });
    return settled.ok;
  }

  /**
   * تقييد دفعة نُفّذت في **خطوةٍ واحدةٍ متزامنة** بلا حجز. يُحجز ويُثبَّت هنا
   * ذرّيًّا فلا يتجاوز السقف، ويُسجَّل استعمالُ هذا الطريق كي لا يكون صامتًا.
   */
  recordSpawn(blueprintId: string, count: number, now = Date.now()): boolean {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return false;
    const held = this.ledger.reserve(blueprintId, count, blueprint.maxInstances, now);
    if (!held.ok) {
      this.deps.audit.append(this.ministryId, 'spawn_record_refused', {
        blueprintId, count, reason: held.reason,
      });
      return false;
    }
    this.ledger.commit(held.reservation.reservationId, now);
    for (let i = 0; i < count; i += 1) this.spawnTimes.push(now);
    this.unreservedRecords += 1;
    this.deps.audit.append(this.ministryId, 'spawn_recorded_without_reservation', {
      blueprintId, count, total: this.unreservedRecords,
    });
    return true;
  }

  /** إعادة نسخ إلى الحساب بعد إلغاء دفعة — الرجوع لا يُترك ضمنيًا */
  releaseSpawn(blueprintId: string, count: number): void {
    this.ledger.discardCommitted(blueprintId, count);
    this.spawnTimes.splice(Math.max(0, this.spawnTimes.length - count), count);
  }

  report(): {
    readonly blueprints: number;
    readonly frozen: boolean;
    readonly instances: Readonly<Record<string, number>>;
    readonly limits: SpawnLimits;
    readonly outstandingReservations: number;
    readonly expiredReservations: number;
    readonly unreservedRecords: number;
  } {
    return {
      blueprints: this.blueprints.size,
      frozen: this.isFrozen,
      instances: this.ledger.snapshot(),
      limits: this.limits,
      outstandingReservations: this.ledger.outstandingCount(Date.now()),
      expiredReservations: this.ledger.expired(),
      unreservedRecords: this.unreservedRecords,
    };
  }

  /** الحكمُ الخالص: أولُ سببِ رفضٍ أو `null` — مصدرٌ واحدٌ لكل بوابةٍ ولمسبار */
  private judge(
    facts: SpawnRequestFacts, now: number,
  ): { readonly reason: string; readonly kind?: string } | null {
    // الثابت الثاني: لا وكيل يولّد وكيلًا — ولا مجرّد طلب
    if (facts.requestedBy.startsWith('agent:')) {
      this.deps.audit.append(this.ministryId, 'self_replication_attempt', {
        requestedBy: facts.requestedBy, blueprintId: facts.blueprintId, count: facts.count,
      });
      this.deps.audit.append(this.ministryId, 'escalated_to_king', {
        incident: 'self_replication_attempt', requestedBy: facts.requestedBy,
      });
      return { reason: 'لا وكيل يولّد وكيلًا — محاولة توالد ذاتي', kind: 'self_replication_denied' };
    }
    if (this.frozen) return { reason: `التوالد مجمَّد: ${this.frozen.reason}` };
    if (!Number.isInteger(facts.count) || facts.count <= 0) return { reason: 'حجم دفعة غير صالح' };
    if (facts.count > this.limits.batchMax) {
      return { reason: `حجم الدفعة ${facts.count} يفوق الحد (${this.limits.batchMax})` };
    }
    const blueprint = this.blueprints.get(facts.blueprintId);
    if (!blueprint) return { reason: 'مخطط غير معلن — لا توالد بلا مخطط معتمد' };
    if (blueprint.generation > this.limits.generationMax) {
      return { reason: `جيل المخطط يفوق حد الأجيال (${this.limits.generationMax})` };
    }

    const charged = this.ledger.chargedOf(facts.blueprintId, now);
    if (charged + facts.count > blueprint.maxInstances) {
      return {
        reason: `تجاوز سقف نسخ المخطط: ${charged} + ${facts.count} > ${blueprint.maxInstances}`,
        kind: 'blueprint_cap_reached',
      };
    }
    if (facts.population + facts.count > facts.populationMax) {
      return {
        reason: `تجاوز السقف السكاني: ${facts.population} + ${facts.count} > ${facts.populationMax}`,
        kind: 'population_cap_would_break',
      };
    }
    const recent = this.spawnTimes.filter((t) => now - t < 3_600_000);
    this.spawnTimes.splice(0, this.spawnTimes.length, ...recent);
    if (recent.length + facts.count > this.limits.perHourMax) {
      return {
        reason: `تجاوز سقف التوالد في الساعة: ${recent.length} + ${facts.count} > ${this.limits.perHourMax}`,
        kind: 'hourly_spawn_cap_reached',
      };
    }
    return null;
  }

  private deny(facts: SpawnRequestFacts, reason: string, kind = 'spawn_policy_denied'): Decision {
    const entry = this.deps.audit.append(this.ministryId, kind, {
      blueprintId: facts.blueprintId, count: facts.count,
      requestedBy: facts.requestedBy, reason,
    });
    return { allowed: false, reason, auditId: entry.hash };
  }

  /** حجزٌ سقط بمهلته ليس صمتًا — يُقيَّد كي يُرى تسريبُ النصيب لو وقع */
  private reportExpiry(before: number): void {
    const dropped = this.ledger.expired() - before;
    if (dropped > 0) {
      this.deps.audit.append(this.ministryId, 'spawn_reservation_expired', { dropped });
    }
  }
}
