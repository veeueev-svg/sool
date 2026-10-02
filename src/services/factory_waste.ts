/**
 * src/services/factory_waste.ts — الهدرُ المتكرّرُ يعلّق المنشأة (T-72 · W-2026-050)
 * المالك: ديوان التدقيق + وزارة الاقتصاد
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: دفعةٌ أُقفلت (مقبولةً أو مرفوضة) وفقدُها المسجَّل بالألف | المخرجات: قيدُ `production_waste_breach`
 *           لكلِّ دفعةٍ تجاوزت التسامح، وتعليقٌ فوريٌّ للمنشأة حين يبلغ العدُّ `waste_breaches_to_suspend`
 * لماذا وُجدت: الهدرُ كان يُحكم عليه دفعةً دفعة — يُسقط ادّعاءَ «الفقد داخل الحدّ» وحده — ولا يُراكم،
 *   فمنشأةٌ تهدر فوق الحدِّ في كلِّ دفعةٍ لا يرفعها شيءٌ انحرافًا.
 * ثوابت:
 *   1) **العدُّ من الدفعات لا من عدّادٍ مستقلّ**: يُحصى من الدفعات المقفلة نفسِها، فلا عدّادَ يفترق عن
 *      سجلّها. وبعد كلِّ تعليقٍ يبدأ العدُّ من لحظته — فالاستئنافُ لا يرثُ ما قبل التعليق.
 *   2) **التعليقُ بيدِ المشغّل المعلن** وعبر `CompanyRuntime.suspend` نفسِه (جهةٌ مخوَّلةٌ وسببٌ معلن)؛
 *      ولا استئنافَ هنا — الاستئنافُ ملكيٌّ وبغير من علّق (ثابت 7 في `company_runtime.ts`).
 *   3) **مؤشّرُ «منذ آخر تعليق» في الذاكرة**: إعادةُ تشغيلِ العمليّة تعيد العدَّ من أول الدفعات —
 *      انحيازٌ نحو التعليق لا نحو النسيان (فشلٌ مغلق)، معلنٌ لا مخفيّ.
 * اختبار القبول: tests/services/factory_waste.test.ts
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ProductionRun } from './factory_types';

export interface WasteSuspender {
  suspend(facilityId: string, by: EntityId, reason: string, now?: number): { readonly ok: boolean };
}

export interface WasteWatchDeps {
  readonly audit: AppendOnlyLog;
  readonly suspender: WasteSuspender;
  readonly operatorId: EntityId;
  readonly tolerancePerMille: number;
  readonly breachesToSuspend: number;
}

export class WasteWatch {
  private readonly countFrom = new Map<string, number>();

  constructor(private readonly deps: WasteWatchDeps) {}

  /** يُنادى بعد إقفالِ دفعة — `runs` دفعاتُ المنشأة كلُّها من سجلِّ التشغيل */
  note(run: ProductionRun, runs: readonly ProductionRun[], now: number): void {
    if (run.declaredWastePerMille <= this.deps.tolerancePerMille) return;
    const since = this.countFrom.get(run.facilityId) ?? Number.NEGATIVE_INFINITY;
    const count = runs.filter((r) => r.facilityId === run.facilityId && r.closedAt !== null
      && r.closedAt > since && r.declaredWastePerMille > this.deps.tolerancePerMille).length;
    this.deps.audit.append(this.deps.operatorId, 'production_waste_breach', {
      runId: run.runId, facilityId: run.facilityId, declaredWastePerMille: run.declaredWastePerMille,
      tolerancePerMille: this.deps.tolerancePerMille, count, limit: this.deps.breachesToSuspend, at: now,
    });
    if (count < this.deps.breachesToSuspend) return;
    const out = this.deps.suspender.suspend(run.facilityId, this.deps.operatorId,
      `هدرٌ فوق التسامح في ${count} دفعات (الحدّ ${this.deps.breachesToSuspend}) — تعليقٌ آليّ (T-72)`, now);
    if (out.ok) this.countFrom.set(run.facilityId, now);
  }
}
