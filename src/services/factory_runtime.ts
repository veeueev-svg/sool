/**
 * src/services/factory_runtime.ts — دفعات الإنتاج ومراقبة الجودة (المرحلة 28)
 * المالك: وزارة الاقتصاد تُشغّل — و**ديوان المحاسبة يفتّش**، ولا تشهد يدٌ لعملها (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: منشأة قائمة + مخزون مُقاس لكل مدخل معلن + حصة مورد متاحة
 * المخرجات: دفعة مُقاسة تُقفل بتفتيش مستقل: مقبولةٌ فيدخل مخرجها المخزون، أو مرفوضةٌ
 *           فلا يدخل شيء ويُسجَّل الفقد — وفي الحالين تُستعاد الموارد
 * التبعيات: سجل المنشآت، سلسلة التوريد، سجل الموارد، سجل التدقيق
 * الصلاحيات: البدء والإلغاء للمشغّل؛ **الإقفال بالتفتيش لجهة معلنة غير المشغّل**
 * السجلات: production_started / production_refused / production_completed /
 *           production_rejected / production_aborted / quality_claim_contradicted
 * ثوابت هذه الوحدة:
 *   1) **لا إنتاج بلا مدخل مُقاس** (شرط قبول T-69): كل مدخل معلن حاضرٌ بعدد صحيح موجب،
 *      والمدخل غير المعلن يُرفض به الطلب كلّه — فلا يُدخَل شيء بلا إعلان
 *   2) **الدفعات محسوبة لا مُدَّعاة**: `batches = min(floor(المتاح/المطلوب))` لكل مدخل،
 *      والصفر رفضٌ — فلا دفعة من مدخلٍ لا يكفي واحدةً
 *   3) **لا إنتاج بلا حصة مورد**: التأجير قبل الاستهلاك، وفشله رفضٌ ولا استهلاك (ثابت 13)
 *   4) **المشغّل لا يفتّش** (RULE-004): المفتّش جهة معلنة في التهيئة تخالف المشغّل
 *   5) **الفحص المعلن وحده يُحتسب**: فحصٌ غير معلن أو مكرَّر يُبطل **التفتيش كلّه**،
 *      فلا يُنتقى من التقرير ما يرفع الدرجة
 *   6) **الدعوى تُقابَل بالسجل**: ما يستطيع النظام التحقق منه بنفسه (الفقد وحدّ المورد)
 *      لا يُقبل فيه قول المفتّش إذا خالف قيده — ويُسجَّل التناقض باسمه
 *   7) **دون الحدّ = رفض الدفعة**: لا مخرج يدخل المخزون، والفقد يُسجَّل كاملًا
 *   8) **حدٌّ معلن للدفعات المتزامنة ولمدة الدفعة**: والمتجاوزة تُلغى بالمسح لا تُنسى
 *   9) **الموارد تُستعاد في كل خروج**: قبولًا ورفضًا وإلغاءً — فلا حصة معلّقة بلا دفعة
 *  10) **لا إقفال مرتين ولا إقفال لملغاة**: كل دفعة تُقفل مرة واحدة
 * حالات الفشل (كلها مغلقة): منشأة غير قائمة ⇒ رفض؛ مدخل ناقص أو غير مُقاس أو غير معلن ⇒
 *   رفض؛ دفعات = صفر ⇒ رفض؛ تأجير مورد مرفوض ⇒ رفض؛ تجاوز حدّ التزامن ⇒ رفض؛ مفتّش هو
 *   المشغّل ⇒ رفض؛ فحص غير معلن أو مكرَّر ⇒ رفض؛ دعوى تخالف السجل ⇒ رفض وتسجيل تناقض؛
 *   إقفال دفعة مقفلة أو ملغاة ⇒ رفض
 * اختبار القبول: tests/services/enterprise_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0012-enterprises.md
 * ثوابتُ التفكيك (الجلسة 43 · T-113 — وبه أُغلق البند):
 *  11) **الإعلانُ والحكمُ خرجا، والفعلُ بقي**: الأشكالُ في `factory_types.ts`، وحكمُ
 *      المفتّش على التقرير دوالَّ **نقيّةً** في `factory_inspection.ts`؛ وبقي هنا ما
 *      **يفعل**: يستهلك مخزونًا ويستأجر حصةً ويكتب قيدَ تدقيق.
 *  12) **وحدُّ القسمة هو الثابت الرابع نفسُه**: الملفُ كان يجمع مَن يُنتج ومَن يشهد على
 *      المُنتَج في مسارٍ واحد — وهما اللتان يقول الثابت 4 إنّهما لا تكونان يدًا واحدة.
 *      فصارت الشهادةُ في ملفٍ لا يستورد سجلَّ التدقيق أصلًا: من أراد أن يُلين حكمًا
 *      ويكتب القيدَ به في نفَسٍ واحدٍ لم يجد الاثنَين في موضعٍ واحد.
 *  13) **السقّاطة**: سقفُ هذا الملف لا يُرفع بعد اليوم — وصفُّه محذوفٌ من
 *      `scripts/limits/module_limits.yaml`، ولم يبقَ في الاستثناءات صفٌّ واحد.
 */
import { EntityId } from '../kernel/types';
import { DeclaredFacilityKind, ECONOMY_MINISTRY } from './company_runtime';
import {
  AUDIT_BUREAU, FactoryRuntimeDeps, InspectionReport, ProductionRequest, ProductionRun, RunResult,
} from './factory_types';
import { claimContradictions, declaredChecks, qualityScore } from './factory_inspection';

/**
 * واجهةُ التصدير تبقى هنا كما كانت قبل التفكيك: من كان يستورد شكلًا أو هويّةً من هذا
 * المسار يستوردُها منه بعد التفكيك — فلا يُعدَّل مستوردٌ ولا اختبار (سابقة `load_drill.ts`).
 */
export { AUDIT_BUREAU } from './factory_types';
export type {
  FactoryRuntimeDeps, InspectionReport, ProductionRequest, ProductionRun, RunResult, RunStatus,
} from './factory_types';

export class FactoryRuntime {
  private readonly runs = new Map<string, ProductionRun>();
  private readonly inspectorId: EntityId;
  private readonly operatorId: EntityId;

  constructor(private readonly deps: FactoryRuntimeDeps) {
    this.inspectorId = deps.inspectorId ?? AUDIT_BUREAU;
    this.operatorId = deps.operatorId ?? ECONOMY_MINISTRY;
    // RULE-004 يُفحص عند التركيب لا عند الاستعمال: يدٌ واحدة تشغّل وتفتّش = بناء فاسد
    if (this.inspectorId === this.operatorId) {
      throw new Error('المفتّش والمشغّل جهة واحدة — بناء مرفوض (RULE-004)');
    }
  }

  private refuse(
    runId: string, facilityId: string, mode: string, why: string,
    extra: Record<string, unknown> = {},
  ): RunResult {
    const entry = this.deps.audit.append(this.operatorId, 'production_refused', {
      runId, facilityId, mode, reason: why, ...extra,
    });
    return { ok: false, reason: why, auditId: entry.hash };
  }

  /**
   * 1) بدء دفعة إنتاج. ترتيب الفحوص مقصود ومُلزم:
   * المعرّف ← المنشأة القائمة ← حدّ التزامن ← **المدخلات المعلنة والمُقاسة** ←
   * حساب الدفعات ← **تأجير المورد** ← الاستهلاك.
   * والاستهلاك آخر خطوة عن قصد: لا يُخصم مخزونٌ لدفعةٍ قد تُرفض لأجل مورد (ثابت 3)،
   * ولو انعكس الترتيب لضاع مخزونٌ في دفعةٍ لم تبدأ.
   */
  start(facilityId: string, request: ProductionRequest, now = Date.now()): RunResult {
    const by = request.by ?? this.operatorId;
    if (typeof request.runId !== 'string' || request.runId.trim().length === 0) {
      return this.refuse(String(request.runId), facilityId, 'start', 'دفعة بلا معرّف معلن');
    }
    if (this.runs.has(request.runId)) {
      return this.refuse(request.runId, facilityId, 'start', 'دفعة قائمة بهذا المعرّف — لا تكرار هوية');
    }
    if (by !== this.operatorId) {
      return this.refuse(request.runId, facilityId, 'start',
        'الإنتاج للمشغّل المعلن وحده (RULE-004)', { by });
    }
    if (!this.deps.companies.isActive(facilityId, now)) {
      return this.refuse(request.runId, facilityId, 'start',
        'منشأة غير قائمة — لا إنتاج في معلَّقة أو منحلّة أو منتهية');
    }
    const facility = this.deps.companies.get(facilityId);
    if (facility === null) {
      return this.refuse(request.runId, facilityId, 'start', 'منشأة غير موجودة');
    }
    const kind = this.deps.companies.kind(facility.kindId) as DeclaredFacilityKind | null;
    if (kind === null) {
      return this.refuse(request.runId, facilityId, 'start',
        'نوع المنشأة غير معلن — إعلانٌ سقط بعد الإقامة (فشل مغلق)');
    }
    const openRuns = [...this.runs.values()]
      .filter((r) => r.facilityId === facilityId && r.status === 'running').length;
    if (openRuns >= this.deps.maxConcurrentRuns) {
      return this.refuse(request.runId, facilityId, 'start',
        'الدفعات المتزامنة بلغت الحدّ المعلن (ثابت 8)',
        { open: openRuns, max: this.deps.maxConcurrentRuns });
    }
    if (request.inputs === null || typeof request.inputs !== 'object') {
      return this.refuse(request.runId, facilityId, 'start', 'لا إنتاج بلا مدخلات (ثابت 1)');
    }
    // ثابت 1: مدخل غير معلن يُرفض به الطلب كلّه — لا يُتجاهَل بصمت
    const declared = new Set(kind.inputs.map((i) => i.material));
    for (const material of Object.keys(request.inputs)) {
      if (!declared.has(material)) {
        return this.refuse(request.runId, facilityId, 'start',
          'مدخل غير معلن في نوع المنشأة — يُرفض به الطلب كلّه (ثابت 1)', { material });
      }
    }
    let batches = Number.POSITIVE_INFINITY;
    for (const input of kind.inputs) {
      const provided = request.inputs[input.material];
      if (provided === undefined) {
        return this.refuse(request.runId, facilityId, 'start',
          'مدخل معلن غائب — لا إنتاج بلا مدخل مُقاس (T-69)', { material: input.material });
      }
      if (!Number.isSafeInteger(provided) || provided <= 0) {
        return this.refuse(request.runId, facilityId, 'start',
          'مدخل غير مُقاس: عدد صحيح موجب (T-69)', { material: input.material, provided });
      }
      const available = this.deps.supply.balance(facilityId, input.material);
      if (provided > available) {
        return this.refuse(request.runId, facilityId, 'start',
          'المقدَّم يتجاوز المخزون — لا إنتاج من مخزون لا وجود له',
          { material: input.material, provided, available });
      }
      batches = Math.min(batches, Math.floor(provided / input.quantity));
    }
    if (!Number.isFinite(batches) || batches <= 0) {
      return this.refuse(request.runId, facilityId, 'start',
        'المدخل لا يكفي دفعةً واحدة — لا دفعة كسرية (ثابت 2)');
    }
    const waste = request.wastePerMille ?? 0;
    if (!Number.isSafeInteger(waste) || waste < 0 || waste >= 1000) {
      return this.refuse(request.runId, facilityId, 'start',
        'الفقد المعلن غير صالح — عدد صحيح بين صفر و999', { waste });
    }
    // ثابت 3: التأجير قبل الاستهلاك — وفشله رفضٌ لا استهلاك بعده
    const lease = this.deps.resources.lease(
      facilityId, kind.resourceCost.resource, kind.resourceCost.amount, now,
    );
    if (!lease.granted) {
      return this.refuse(request.runId, facilityId, 'start',
        `حصة المورد مرفوضة: ${lease.reason}`,
        { resource: kind.resourceCost.resource, amount: kind.resourceCost.amount });
    }
    const consumed: { material: string; quantity: number }[] = [];
    for (const input of kind.inputs) {
      const quantity = batches * input.quantity;
      const result = this.deps.supply.consume(
        facilityId, input.material, quantity, request.runId, by, now,
      );
      if (!result.ok) {
        // ذرّية الفشل الجزئي: ما استُهلك يُعاد، والحصة تُستعاد — فلا دفعة نصف بادئة
        for (const done of consumed) {
          this.deps.supply.receive(facilityId, done.material, done.quantity, {
            kind: 'transfer', from: facilityId,
          }, by, now);
        }
        this.deps.resources.release(lease.lease.leaseId);
        return this.refuse(request.runId, facilityId, 'start',
          `تعذّر استهلاك مدخل — أُعيد ما استُهلك: ${result.reason}`,
          { material: input.material, rolledBack: consumed.length });
      }
      consumed.push({ material: input.material, quantity });
    }
    const run: ProductionRun = {
      runId: request.runId, facilityId, kindId: kind.id, startedAt: now, startedBy: by,
      batches, consumed, leaseId: lease.lease.leaseId,
      resource: kind.resourceCost.resource, resourceAmount: kind.resourceCost.amount,
      declaredWastePerMille: waste,
      deadline: now + this.deps.maxRunDurationHours * 3600 * 1000,
      status: 'running', closedAt: null, closedBy: null,
      qualityScore: null, passedChecks: null, producedQuantity: null, note: null,
    };
    this.runs.set(run.runId, run);
    const entry = this.deps.audit.append(by, 'production_started', {
      runId: run.runId, facilityId, kindId: kind.id, batches,
      consumed, leaseId: run.leaseId, wastePerMille: waste, deadline: run.deadline,
    });
    return { ok: true, run, auditId: entry.hash };
  }

  /**
   * 2) إقفال الدفعة بتفتيش مستقل. ترتيب الفحوص مقصود:
   * الدفعة ← الحالة ← **المفتّش** ← الفحوص المعلنة ← **مقابلة الدعوى بالسجل** ← الدرجة.
   * والمفتّش يُفحص قبل التقرير عن قصد: تقرير من يدٍ غير مخوَّلة لا يُقرأ أصلًا (RULE-004).
   */
  complete(runId: string, report: InspectionReport, now = Date.now()): RunResult {
    const run = this.runs.get(runId);
    if (!run) return this.refuse(runId, 'unknown', 'complete', 'دفعة غير قائمة');
    if (run.status !== 'running') {
      return this.refuse(runId, run.facilityId, 'complete',
        'دفعة مقفلة أو ملغاة — لا إقفال مرتين (ثابت 10)', { status: run.status });
    }
    if (report === null || typeof report !== 'object') {
      return this.refuse(runId, run.facilityId, 'complete', 'لا إقفال بلا تقرير تفتيش');
    }
    if (report.inspector !== this.inspectorId) {
      return this.refuse(runId, run.facilityId, 'complete',
        'التفتيش لجهة معلنة غير المشغّل — من أنتج لا يشهد (RULE-004)',
        { inspector: report.inspector, expected: this.inspectorId });
    }
    if (!Array.isArray(report.passed)) {
      return this.refuse(runId, run.facilityId, 'complete', 'تقرير بلا قائمة فحوص');
    }
    const kind = this.deps.companies.kind(run.kindId) as DeclaredFacilityKind | null;
    if (kind === null) {
      return this.refuse(runId, run.facilityId, 'complete', 'نوع المنشأة غير معلن (فشل مغلق)');
    }
    // ثابت 5: الحكمُ على القائمة قراءةٌ — فهو دالّةٌ نقيّة، والرفضُ وحدَه يُكتب هنا
    const checked = declaredChecks(report.passed, kind.requiredChecks);
    if (!checked.ok) {
      return this.refuse(runId, run.facilityId, 'complete', checked.why, checked.extra);
    }
    const seen = checked.seen;
    // ثابت 6: ما يعرفه النظام بنفسه لا يُصدَّق فيه المفتّش إن خالف القيد.
    // والقيدُ يُقاس هنا (قراءةُ سجل التأجير) ثمّ يُحكَم عليه هناك (بلا سجلٍّ ولا وقت).
    const contradictions = claimContradictions({
      seen,
      declaredWastePerMille: run.declaredWastePerMille,
      wasteTolerancePerMille: this.deps.wasteTolerancePerMille,
      leaseActive: this.deps.resources.activeLeases(now).some((l) => l.leaseId === run.leaseId),
    });
    if (contradictions.length > 0) {
      this.deps.audit.append(report.inspector, 'quality_claim_contradicted', {
        runId, facilityId: run.facilityId, claims: contradictions,
        declaredWastePerMille: run.declaredWastePerMille,
        wasteTolerancePerMille: this.deps.wasteTolerancePerMille,
        leaseId: run.leaseId,
      });
      return this.refuse(runId, run.facilityId, 'complete',
        'دعوى في التقرير تخالف قيد النظام — تُرفض ويُسجَّل التناقض (ثابت 6)',
        { claims: contradictions });
    }
    const score = qualityScore(seen, this.deps.qualityChecks);

    this.deps.resources.release(run.leaseId); // ثابت 9: في القبول والرفض معًا
    run.closedAt = now;
    run.closedBy = report.inspector;
    run.qualityScore = score;
    run.passedChecks = [...seen];
    run.note = typeof report.note === 'string' ? report.note.trim() : null;

    if (score < this.deps.minQualityScore) {
      // ثابت 7: لا مخرج يدخل المخزون، والمدخل المستهلَك فقدٌ يُسجَّل كاملًا
      run.status = 'rejected';
      run.producedQuantity = 0;
      const entry = this.deps.audit.append(report.inspector, 'production_rejected', {
        runId, facilityId: run.facilityId, score, minRequired: this.deps.minQualityScore,
        passed: run.passedChecks, wasted: run.consumed, output: 0,
      });
      return { ok: true, run, auditId: entry.hash };
    }
    const produced = run.batches * kind.output.quantity;
    const received = this.deps.supply.receive(
      run.facilityId, kind.output.material, produced,
      { kind: 'production', runId }, this.operatorId, now,
    );
    if (!received.ok) {
      // المخرج لا يدخل ⇒ الدفعة مرفوضة لا مقبولة بمخرج وهمي (فشل مغلق)
      run.status = 'rejected';
      run.producedQuantity = 0;
      const entry = this.deps.audit.append(report.inspector, 'production_rejected', {
        runId, facilityId: run.facilityId, score,
        reason: `تعذّر إدخال المخرج: ${received.reason}`, output: 0,
      });
      return { ok: true, run, auditId: entry.hash };
    }
    run.status = 'accepted';
    run.producedQuantity = produced;
    const entry = this.deps.audit.append(report.inspector, 'production_completed', {
      runId, facilityId: run.facilityId, score, minRequired: this.deps.minQualityScore,
      passed: run.passedChecks, output: { material: kind.output.material, quantity: produced },
    });
    return { ok: true, run, auditId: entry.hash };
  }

  /**
   * 3) إلغاء دفعة. الموارد تُستعاد، والمدخل المستهلَك **لا يُعاد** لأنه دخل الخط فعلًا:
   * الإلغاء اعترافٌ بفقدٍ لا محاولةُ إخفائه (ثابتا 9 وRULE-006).
   */
  abort(runId: string, by: EntityId, reason: string, now = Date.now()): RunResult {
    const run = this.runs.get(runId);
    if (!run) return this.refuse(runId, 'unknown', 'abort', 'دفعة غير قائمة');
    if (run.status !== 'running') {
      return this.refuse(runId, run.facilityId, 'abort',
        'دفعة غير جارية — لا إلغاء لمقفلة (ثابت 10)', { status: run.status });
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      return this.refuse(runId, run.facilityId, 'abort', 'لا إلغاء بلا سبب معلن (RULE-006)');
    }
    this.deps.resources.release(run.leaseId);
    run.status = 'aborted';
    run.closedAt = now;
    run.closedBy = by;
    run.producedQuantity = 0;
    run.note = reason.trim();
    const entry = this.deps.audit.append(by, 'production_aborted', {
      runId, facilityId: run.facilityId, reason: run.note, wasted: run.consumed, output: 0,
    });
    return { ok: true, run, auditId: entry.hash };
  }

  /**
   * 4) مسح الدفعات المتجاوزة مدتها (ثابت 8): ما تجاوز `max_run_duration_hours` يُلغى
   * ويُسجَّل — فلا تبقى دفعة "جارية" أبدًا تحتجز حصةً وتخفي فقدًا.
   */
  sweep(now = Date.now()): readonly string[] {
    const swept: string[] = [];
    for (const run of this.runs.values()) {
      if (run.status !== 'running' || run.deadline > now) continue;
      this.abort(run.runId, this.operatorId, 'تجاوز المدة المعلنة للدفعة', now);
      swept.push(run.runId);
    }
    return swept;
  }

  get(runId: string): ProductionRun | null { return this.runs.get(runId) ?? null; }
  list(): readonly ProductionRun[] { return [...this.runs.values()]; }
  runsOf(facilityId: string): readonly ProductionRun[] {
    return [...this.runs.values()].filter((r) => r.facilityId === facilityId);
  }

  report(): {
    readonly total: number; readonly running: number; readonly accepted: number;
    readonly rejected: number; readonly aborted: number; readonly minQualityScore: number;
    readonly inspector: EntityId;
  } {
    const all = [...this.runs.values()];
    return {
      total: all.length,
      running: all.filter((r) => r.status === 'running').length,
      accepted: all.filter((r) => r.status === 'accepted').length,
      rejected: all.filter((r) => r.status === 'rejected').length,
      aborted: all.filter((r) => r.status === 'aborted').length,
      minQualityScore: this.deps.minQualityScore,
      inspector: this.inspectorId,
    };
  }
}
