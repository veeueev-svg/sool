/**
 * src/services/factory_types.ts — إعلانُ دفعات الإنتاج والتفتيش (المرحلة 39 · الجلسة 43)
 * المالك: وزارة الاقتصاد تُشغّل — وديوان المحاسبة يفتّش (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * ما فيها: **إعلانٌ لا سلوك** — أشكالُ الدفعة والطلب والتقرير والنتيجة والتبعيات،
 *          ومعها إعلانُ هويّةِ المفتّش المستقل. لا سطرَ منها يُنفَّذ.
 * لماذا انفصلت: أُخرجت من `factory_runtime.ts` (**422** سطرًا) في تفكيك البند T-113،
 *          والأشكالُ تُقرأ ولا تُشغَّل — فمن أراد أن يعرف ما تُقيّده الوحدةُ قرأ هنا،
 *          ومن أراد أن يعرف ما تفعله قرأ هناك.
 * واجهةُ التصدير: كلُّ ما هنا يُعاد تصديرُه من `factory_runtime.ts` كما كان قبل التفكيك،
 *          فلا يُعدَّل مستوردٌ ولا اختبار.
 * الوثيقة المرتبطة: docs/decisions/ADR-0012-enterprises.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ResourceRegistry } from '../kernel/resource_registry';
import { CompanyRuntime } from './company_runtime';
import { SupplyChain } from './supply_chain';

/** ديوان المحاسبة: المفتّش المستقل — ولا يشغّل شيئًا (RULE-004) */
export const AUDIT_BUREAU: EntityId = 'authority:audit_bureau';

export type RunStatus = 'running' | 'accepted' | 'rejected' | 'aborted';

export interface ProductionRun {
  readonly runId: string;
  readonly facilityId: string;
  readonly kindId: string;
  readonly startedAt: number;
  readonly startedBy: EntityId;
  /** عدد الدفعات المحسوب من المخزون لا المُدَّعى (ثابت 2) */
  readonly batches: number;
  readonly consumed: readonly { readonly material: string; readonly quantity: number }[];
  readonly leaseId: string;
  readonly resource: string;
  readonly resourceAmount: number;
  /** الفقد المسجَّل بالألف من المدخل — قيدُ النظام الذي تُقابَل به الدعوى (ثابت 6) */
  readonly declaredWastePerMille: number;
  readonly deadline: number;
  status: RunStatus;
  closedAt: number | null;
  closedBy: EntityId | null;
  qualityScore: number | null;
  passedChecks: readonly string[] | null;
  producedQuantity: number | null;
  note: string | null;
}

export interface ProductionRequest {
  readonly runId: string;
  /** ما يُقدَّم فعلًا من كل مادة — يُقابَل بالمخزون لا يُصدَّق (ثابت 1) */
  readonly inputs: Readonly<Record<string, number>>;
  /** الفقد المُعلَن من المشغّل بالألف — يُقيَّد ليُقابَل به تقرير المفتّش (ثابت 6) */
  readonly wastePerMille?: number;
  readonly by?: EntityId;
}

export interface InspectionReport {
  readonly inspector: EntityId;
  /** الفحوص التي يدّعي المفتّش نجاحها — المعلنة وحدها تُحتسب (ثابت 5) */
  readonly passed: readonly string[];
  readonly note?: string;
}

export type RunResult =
  | { readonly ok: true; readonly run: ProductionRun; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface FactoryRuntimeDeps {
  readonly audit: AppendOnlyLog;
  readonly companies: CompanyRuntime;
  readonly supply: SupplyChain;
  readonly resources: ResourceRegistry;
  /** أوزان الفحوص المعلنة في config/enterprises.yaml — لا وزن يُحتسب من خارجها */
  readonly qualityChecks: Readonly<Record<string, number>>;
  readonly minQualityScore: number;
  readonly wasteTolerancePerMille: number;
  /** T-72: عددُ الدفعاتِ فوق التسامح الذي يعلّق المنشأةَ آليًّا — من `config/enterprises.yaml` */
  readonly wasteBreachesToSuspend: number;
  readonly maxConcurrentRuns: number;
  readonly maxRunDurationHours: number;
  readonly inspectorId?: EntityId;
  readonly operatorId?: EntityId;
}
