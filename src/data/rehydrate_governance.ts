/**
 * src/data/rehydrate_governance.ts — إرجاعُ الحكومة من اليوميّة (المرحلة 39 — T-126)
 * المالك: وزارة البيانات | القاعدة الحاكمة RULE-000: كل تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: قيودُ يوميّةٍ متحقَّقةُ السلسلة + سجلُّ الوزارات وسجلُّ التعيينات
 * المخرجات: تقريرُ إرجاعٍ معدود (وزاراتٌ · مناصبُ · اقتراحاتٌ · أصحابُ مناصب) + الصامتون
 * التبعيات: `persistence.ts` — والسجلّان يُستدعيان عبر بابَي `restore` المعلنَين
 * الصلاحيات: الاستعادةُ فقط. لا تُقيم وزارةً ولا تُعلن منصبًا ولا تُعيّن أحدًا ولا تعزل
 * السجلات: كلُّ سجلٍّ يُقيّد استعادتَه بنفسه (`ministries_restored` · `appointments_restored`)
 *
 * ثوابت هذه الوحدة:
 *   1) **الإرجاعُ إعادةُ بناءِ حالةٍ لا إعادةُ تنفيذِ أفعال** (كثابت 1 في `rehydrate_fiscal.ts`):
 *      لا تُنادى `establish` ولا `declareOffice` ولا `propose/approve/execute` ثانيةً —
 *      نداؤها يطلب أمرًا ملكيًّا لم يُصدره أحدٌ في هذا الإقلاع، ويُقيّد في السجل الأبديّ
 *      تعيينًا ثانيًا لتعيينٍ واحد. فالإقلاعُ لا يُنشئ سلطةً بحجّة أنّه يستعيدها.
 *   2) **ترتيبُ الأبواب مُلزَم**: الوزاراتُ تُرجَع **قبل** التعيينات، لأنّ حرَسَ لقطةِ
 *      التعيينات يسأل سجلَّ الوزارات عن وزارةِ كلِّ منصب — وترتيبٌ معكوسٌ يُرفض
 *      بـ RECOVERY_OFFICE_MINISTRY_MISSING لا يُقبل صامتًا.
 *   3) **الصامتُ يُعلن لا يُخمَّن**: سجلٌّ رُبط ولم تشهد له اليوميّةُ بقيدٍ يُذكر في
 *      `silent[]` ولا تُختلق له حكومةٌ فارغةٌ تُقرأ كأنّها حقّ (RULE-001/008).
 *   4) **الوزارةُ المحلولةُ تُستعاد محلولةً**: القيدُ حالةٌ يُغني أحدثُها، وأحدثُ صورةٍ
 *      لوزارةٍ حُلّت تحمل `dissolvedAt` — فالحلُّ تاريخٌ لا يُمحى بإعادة تشغيل (ثابت 5
 *      في `ministries.ts`، وهو ما نقضه الفقدُ المقيس قبل هذا البند).
 *   5) **خلوُّ المنصب علامةٌ لا حذف**: قيدُ `office_holder` بعلامة `vacated` يُسقط صاحبَ
 *      المنصب من اللقطة، فالعزلُ ينجو الإطفاءَ كما ينجو التعيين.
 *
 * حالات الفشل (كلها مغلقة، وكلها من حرَس اللقطة لا من هنا):
 *   RECOVERY_MINISTRY_INVALID · RECOVERY_MINISTRY_MANDATE_CONFLICT ·
 *   RECOVERY_OFFICE_INVALID · RECOVERY_OFFICE_MINISTRY_MISSING ·
 *   RECOVERY_PROPOSAL_OFFICE_MISSING · RECOVERY_PROPOSAL_TRAIL_MISSING ·
 *   RECOVERY_HOLDER_OFFICE_MISSING · RECOVERY_HOLDER_CHAIN_INCOMPLETE ·
 *   RECOVERY_HOLDER_CONFLICT
 * اختبار القبول: tests/data/rehydrate_governance.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0032-governance-durability.md
 */
import type { EntityId } from '../kernel/types';
import type { DurableRecord } from './persistence';
import type { Ministry, MinistryRegistry } from '../governance/ministries';
import type { AppointmentRegistry } from '../governance/appointments';
import type {
  OfficeDefinition, OfficeHolder, Proposal, ProposalTrail,
} from '../governance/appointment_types';

/** السجلّان اللذان يُرجَعان؛ غيابُ أيِّهما يعني «لا إرجاع له» لا «إرجاعٌ فارغ» */
export interface GovernanceTargets {
  readonly ministries?: MinistryRegistry;
  readonly appointments?: AppointmentRegistry;
}

export interface RehydrateGovernanceReport {
  readonly ministries: number;
  readonly ministriesDissolved: number;
  readonly offices: number;
  readonly proposals: number;
  readonly holders: number;
  /** سجلّاتٌ رُبطت ولم تشهد لها اليوميّةُ بقيدٍ واحد — تُعلن ولا تُخفى (ثابت 3) */
  readonly silent: readonly string[];
}

interface Collected {
  ministries: Map<EntityId, Ministry>;
  ministriesSeen: boolean;
  offices: Map<string, OfficeDefinition>;
  proposals: Map<string, { proposal: Proposal; trail: ProposalTrail }>;
  proposalOrder: string[];
  holders: Map<string, OfficeHolder>;
  appointmentsSeen: boolean;
}

function empty(): Collected {
  return {
    ministries: new Map(), ministriesSeen: false,
    offices: new Map(), proposals: new Map(), proposalOrder: [],
    holders: new Map(), appointmentsSeen: false,
  };
}

/** ثابت 4/5: أربعتُها حالةٌ يُغني أحدثُها عمّا قبله؛ ولا يُنفَّذ فعلٌ هنا */
function collect(state: Collected, entry: DurableRecord, payload: Record<string, unknown>): void {
  switch (entry.kind) {
    case 'ministry_state': {
      state.ministriesSeen = true;
      const ministry = payload.ministry as Ministry | undefined;
      if (ministry && typeof ministry.ministryId === 'string') {
        state.ministries.set(ministry.ministryId, { ...ministry, mandate: [...ministry.mandate] });
      }
      return;
    }
    case 'office_definition': {
      state.appointmentsSeen = true;
      const office = payload.office as OfficeDefinition | undefined;
      if (office && typeof office.officeId === 'string') {
        state.offices.set(office.officeId, { ...office, conflictsWith: [...office.conflictsWith] });
      }
      return;
    }
    case 'appointment_proposal': {
      state.appointmentsSeen = true;
      const proposal = payload.proposal as Proposal | undefined;
      const trail = payload.trail as ProposalTrail | undefined;
      if (proposal && typeof proposal.proposalId === 'string' && trail) {
        if (!state.proposals.has(proposal.proposalId)) {
          state.proposalOrder.push(proposal.proposalId);
        }
        state.proposals.set(proposal.proposalId, {
          proposal: { ...proposal }, trail: { ...trail },
        });
      }
      return;
    }
    case 'office_holder': {
      state.appointmentsSeen = true;
      const officeId = typeof payload.officeId === 'string' ? payload.officeId : null;
      if (officeId === null) return;
      // ثابت 5: العزلُ علامةٌ تُقرأ، فيُحذف من **اللقطة** لا من اليوميّة.
      if (payload.vacated === true) { state.holders.delete(officeId); return; }
      const holder = payload.holder as OfficeHolder | undefined;
      if (holder && typeof holder.holder === 'string') {
        state.holders.set(officeId, { ...holder, chain: { ...holder.chain } });
      }
      return;
    }
    default:
      return;
  }
}

/**
 * يُرجع الحكومةَ من قيودِ يوميّةٍ **متحقَّقةِ السلسلة سابقًا**. لا تتحقّق هذه الوحدةُ من
 * السلسلة: التحقّقُ بابُه `StateJournal.verify()`. وتُنادى **قبل** ربطِ اليوميّة بالسجلَّين
 * وإلّا دُوِّن المُستعادُ ثانيةً في كلِّ إقلاع.
 */
export function rehydrateGovernanceFromJournal(
  entries: readonly DurableRecord[],
  targets: GovernanceTargets,
  by: EntityId,
): RehydrateGovernanceReport {
  const state = empty();
  for (const entry of entries) {
    const payload = entry.payload as Record<string, unknown> | null;
    if (payload === null || typeof payload !== 'object') continue;
    collect(state, entry, payload);
  }

  const silent: string[] = [];
  const door = (system: string, target: unknown, seen: boolean, run: () => void): void => {
    if (target === undefined) return;
    if (!seen) { silent.push(system); return; }
    run();
  };

  // ثابت 2: الوزاراتُ أوّلًا — حرَسُ التعيينات يسأل عن وزارةِ كلِّ منصب.
  door('ministries', targets.ministries, state.ministriesSeen, () => {
    targets.ministries!.restore([...state.ministries.values()], by);
  });
  door('appointments', targets.appointments, state.appointmentsSeen, () => {
    targets.appointments!.restore({
      offices: [...state.offices.values()],
      proposals: state.proposalOrder.map((id) => state.proposals.get(id)!),
      holders: [...state.holders.values()],
    }, by);
  });

  let dissolved = 0;
  for (const ministry of state.ministries.values()) {
    if (ministry.dissolvedAt !== null) dissolved += 1;
  }

  return {
    ministries: state.ministries.size,
    ministriesDissolved: dissolved,
    offices: state.offices.size,
    proposals: state.proposals.size,
    holders: state.holders.size,
    silent,
  };
}
