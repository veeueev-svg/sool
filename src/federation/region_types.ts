/**
 * src/federation/region_types.ts — أشكالُ الاتحاد وإعلاناتُه (المرحلة 39 · البند T-113)
 * المالك: مجلس الأقاليم — تحت التاج، لا بجانبه
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: لا شيء — هذه وحدةُ إعلانٍ لا وحدةُ سلوك
 * المخرجات: أشكالُ الإقليم والالتماس، ومعرّفُ المجلس، ونطاقاتُ التاج المحفوظة
 * التبعيات: src/kernel/types (EntityId) و src/audit/append_only_log و src/crown/crown_gateway
 *           للأشكالِ وحدَها — ولا تبعيةَ على وحدةٍ في هذا المجلد فلا دورةَ استيراد
 * الصلاحيات: لا شيء — لا تكتب سجلًّا ولا تقرّر رفضًا
 * السجلات: لا شيء
 * ثوابت هذه الوحدة:
 *   1) **إعلانٌ لا سلوك**: لا دالّةَ هنا ولا حرَسَ ولا قيدَ تدقيق — من أراد المنعَ فمكانُه
 *      region_registry.ts أو regional_assembly.ts
 *   2) **نطاقاتُ التاج تُعلن هنا وتُنفَّذ هناك**: CROWN_RESERVED_DOMAINS قائمةٌ معلنة،
 *      ومنعُ تفويضِها فعلٌ في السجل لا في هذا الملف (ثابت 4 من region_registry.ts)
 *   3) من أضاف نطاقًا محفوظًا هنا وثَّقه في ADR-0008 وفي PROGRESS.md — القائمةُ سياسةٌ
 *      لا تفصيلُ تنفيذ
 * حالات الفشل: لا شيء — لا مسارَ تنفيذٍ في وحدةِ إعلان
 * اختبار القبول: tests/federation/regions.test.ts · tests/federation/federation_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0008-federation-and-governors.md
 * لماذا انفصلت: كان region_registry.ts **454 سطرًا** فوق سقف 400 (البند T-113)، فخرجت
 *   الأشكالُ والإعلاناتُ هنا **نقلًا حرفيًّا بلا إصلاح**، ويُعيد الملفُ الأصلي تصديرَها
 *   فلا يتغيّر مستوردٌ ولا اختبار.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';

/** المجلس الذي يمثّل الأقاليم مجتمعةً — يلتمس ولا يقرّر (ثابت 7) */
export const REGIONS_COUNCIL: EntityId = 'federation:regions';

/**
 * نطاقات محفوظة للتاج لا تُفوَّض لإقليم بحال.
 * سببها: تفويض أيٍّ منها يُنشئ مركز قرار مستقلًّا عن التاج — أي انقسام سيادة.
 */
export const CROWN_RESERVED_DOMAINS: readonly string[] = [
  'sovereignty', 'audit', 'termination', 'identity', 'policy', 'justice',
];

export type Autonomy = 'limited' | 'delegated';

export interface Region {
  readonly regionId: EntityId;
  readonly name: string;
  /** limited: لا نطاق مفوَّض | delegated: يمارس نطاقات معلنة */
  readonly autonomy: Autonomy;
  readonly domains: readonly string[];
  readonly establishedBy: EntityId;
  readonly establishedAt: number;
  readonly commandId: string;
  readonly delegationCommandId: string | null;
  readonly dissolvedAt: number | null;
  readonly dissolveReason: string | null;
}

export interface RegionInput {
  readonly regionId: EntityId;
  readonly name: string;
  readonly proposedBy: EntityId;
}

export type RegionResult =
  | { readonly ok: true; readonly region: Region; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** مصدر يتحقق من حاكم إقليم — يُربط من سجل الحكّام (فشل مغلق قبل الربط) */
export type GovernorProbe = (regionId: EntityId) => EntityId | null;

export interface RegionRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  /** معرّفات الأقاليم المعلنة في config/regions.yaml (ثابت 1) */
  readonly declaredRegions: readonly string[];
  readonly actorId?: EntityId;
}

/* ————————————————— اجتماع الأقاليم ————————————————— */

export type PetitionStatus = 'pending' | 'accepted' | 'rejected';

export interface Petition {
  readonly petitionId: string;
  readonly attendees: readonly EntityId[];
  readonly subject: string;
  readonly unanimous: boolean;
  readonly raisedAt: number;
  readonly status: PetitionStatus;
  readonly answeredBy: EntityId | null;
  readonly answeredAt: number | null;
  readonly commandId: string | null;
}

export type AssemblyResult =
  | { readonly ok: true; readonly petition: Petition; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };
