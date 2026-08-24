/**
 * src/federation/regional_assembly.ts — اجتماعُ الأقاليم: يلتمس ولا يقرّر (المرحلة 24)
 * المالك: مجلس الأقاليم — تحت التاج، لا بجانبه
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: حضورُ أقاليم قائمة، وموضوعُ التماس، وأمرٌ ملكي معتمد بفعل amend_policy
 *           موجَّه إلى مجلس الأقاليم للجواب
 * المخرجات: التماسٌ مسجَّل لا أثر له حتى يجيبه الملك، أو رفضٌ بسبب موثّق
 * التبعيات: بوابة التاج (الاعتماد والنقض الجماعي)، السجل غير القابل للمحو،
 *           سجلُّ الأقاليم (قراءةَ القائم وعدَّه) — **بنوعه لا بقيمته** فلا دورةَ استيراد
 * الصلاحيات: تسجيلُ التماسٍ ورفضُ نقضٍ جماعي وقيدُ جوابِ الملك — ولا فعلَ سياديًّا
 * السجلات: assembly_petitioned / assembly_refused / assembly_override_refused /
 *           petition_answered
 * ثوابت هذه الوحدة:
 *   7) **اجتماع الأقاليم لا ينقض الملك**: أقصى ما تستطيعه مجتمعةً التماسٌ لا أثر له
 *      إلا بأمر ملكي — ولو حضرت كلها بالإجماع (RULE-003)
 *   8) **الملتمس لا يجيب التماسه** (RULE-004): من كان في الحضور لا يُقيَّد جوابُه
 *   9) الرفضُ الجماعي يُسجَّل **مرّتَين بقصد**: في بوابة التاج باسم الاجتماع، وهنا
 *      بالعدد والنسبة — فمحاولةُ النقض أثرٌ في اليوميّة لا صمتٌ
 * حالات الفشل (كلها مغلقة): معرّفُ التماسٍ مستخدم ⇒ رفض؛ موضوعٌ بلا إعلان ⇒ رفض؛
 *   أقلُّ من إقليمين ⇒ رفض؛ حضورٌ مكرَّر ⇒ رفض؛ حاضرٌ ليس إقليمًا قائمًا ⇒ رفض؛
 *   جوابٌ بغير amend_policy أو بغير هدفِ المجلس ⇒ رفض؛ جوابُ ملتمسٍ ⇒ رفض؛
 *   أمرٌ غير معتمد ⇒ رفض؛ محاولةُ نقضٍ جماعي ⇒ رفضٌ مسجَّل باسم كل حاضر
 * اختبار القبول: tests/federation/federation_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0008-federation-and-governors.md
 * لماذا انفصلت: كان region_registry.ts **454 سطرًا** فوق سقف 400 (البند T-113) وفيه
 *   سلطتان لا واحدة: سجلُّ الأقاليم يقرّر بأمرٍ ملكي، والاجتماعُ **لا يقرّر شيئًا**.
 *   فالنقلُ حرفيٌّ بلا إصلاح، والملفُ الأصلي يُعيد تصديرَ الصنف فلا يتغيّر مستوردٌ ولا اختبار.
 */
import { EntityId, SignedRoyalCommand, SovereignAction } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { AssemblyResult, Petition, REGIONS_COUNCIL } from './region_types';
// نوعًا فقط: القيمةُ لا تُستورد هنا حتى لا تقوم دورةُ استيرادٍ مع region_registry.ts
// الذي يُعيد تصدير هذا الصنف (RULE-005: الحدُّ يُصان بالبنية لا بالتعليق)
import type { RegionRegistry } from './region_registry';

export interface RegionalAssemblyDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly regions: RegionRegistry;
}

/**
 * مجلس الأقاليم مجتمعةً: يلتمس ولا يقرّر (ثابت 7).
 * الفرق جوهري: الالتماس بلا أثر حتى يجيبه الملك بأمر معتمد؛
 * ومحاولة النقض مرفوضة بذاتها ولو حضرت كل الأقاليم بالإجماع.
 */
export class RegionalAssembly {
  private readonly petitions = new Map<string, Petition>();

  constructor(private readonly deps: RegionalAssemblyDeps) {}

  /** التماس جماعي: أقصى ما يستطيعه الاجتماع */
  petition(
    attendees: readonly EntityId[], input: { petitionId: string; subject: string }, now = Date.now(),
  ): AssemblyResult {
    const refuse = (reason: string): AssemblyResult => {
      const entry = this.deps.audit.append(REGIONS_COUNCIL, 'assembly_refused', {
        petitionId: input.petitionId, reason, attending: attendees.length,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (this.petitions.has(input.petitionId)) return refuse('معرّف التماس مستخدم');
    if (input.subject.trim().length < 3) return refuse('لا التماس بلا موضوع معلن');
    if (attendees.length < 2) return refuse('لا اجتماع بأقل من إقليمين');
    if (new Set(attendees).size !== attendees.length) return refuse('حضور مكرَّر لا يُعتدّ به');
    const absent = attendees.filter((a) => !this.deps.regions.isActive(a));
    if (absent.length > 0) return refuse('حاضر ليس إقليمًا قائمًا');

    const totalActive = this.deps.regions.active().length;
    const petition: Petition = {
      petitionId: input.petitionId,
      attendees: [...attendees],
      subject: input.subject.trim(),
      unanimous: attendees.length === totalActive,
      raisedAt: now,
      status: 'pending',
      answeredBy: null,
      answeredAt: null,
      commandId: null,
    };
    this.petitions.set(petition.petitionId, petition);
    const entry = this.deps.audit.append(REGIONS_COUNCIL, 'assembly_petitioned', {
      petitionId: petition.petitionId, subject: petition.subject,
      attending: petition.attendees.length, totalActive, unanimous: petition.unanimous,
      effect: 'لا أثر حتى أمر ملكي',
    });
    return { ok: true, petition, auditId: entry.hash };
  }

  /**
   * محاولة نقض جماعي: مرفوضة دائمًا — ولو بالإجماع الكامل.
   * تُمرَّر إلى بوابة التاج لتسجيلها باسم الاجتماع، ثم تُسجَّل هنا ثانيًا بالعدد والنسبة.
   */
  override(
    attendees: readonly EntityId[], action: SovereignAction, now = Date.now(),
  ): { readonly allowed: false; readonly reason: string; readonly auditId: string } {
    const decision = this.deps.gateway.collectiveOverride(attendees, action);
    const totalActive = this.deps.regions.active().length;
    const entry = this.deps.audit.append(REGIONS_COUNCIL, 'assembly_override_refused', {
      action, attending: attendees.length, totalActive,
      unanimous: totalActive > 0 && attendees.length >= totalActive,
      gatewayReason: decision.reason, at: now,
    });
    return { allowed: false, reason: decision.reason ?? 'اجتماع الأقاليم لا ينقض الملك', auditId: entry.hash };
  }

  /** جواب الملك على الالتماس: أمر معتمد موجَّه إلى مجلس الأقاليم */
  answer(
    command: SignedRoyalCommand, petitionId: string, verdict: 'accepted' | 'rejected',
    now = Date.now(),
  ): AssemblyResult {
    const refuse = (reason: string): AssemblyResult => {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'assembly_refused', {
        petitionId, reason, stage: 'answer',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const petition = this.petitions.get(petitionId);
    if (!petition) return refuse('التماس غير موجود');
    if (petition.status !== 'pending') return refuse(`التماس محسوم سابقًا: ${petition.status}`);
    if (command.payload.action !== 'amend_policy') {
      return refuse('جواب الالتماس بفعل amend_policy وحده');
    }
    if (command.payload.target !== REGIONS_COUNCIL) {
      return refuse('هدف الأمر لا يطابق مجلس الأقاليم');
    }
    if (petition.attendees.includes(command.payload.issuedBy)) {
      return refuse('الملتمس لا يجيب التماسه (RULE-004)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`الأمر غير معتمد: ${decision.reason}`);

    const answered: Petition = {
      ...petition, status: verdict, answeredBy: command.payload.issuedBy,
      answeredAt: now, commandId: command.payload.commandId,
    };
    this.petitions.set(petitionId, answered);
    const entry = this.deps.audit.append(command.payload.issuedBy, 'petition_answered', {
      petitionId, verdict, commandId: command.payload.commandId,
    });
    return { ok: true, petition: answered, auditId: entry.hash };
  }

  getPetition(petitionId: string): Petition | undefined {
    return this.petitions.get(petitionId);
  }

  pending(): readonly Petition[] {
    return [...this.petitions.values()].filter((p) => p.status === 'pending');
  }

  report(): { total: number; pending: number; accepted: number; rejected: number } {
    const all = [...this.petitions.values()];
    return {
      total: all.length,
      pending: all.filter((p) => p.status === 'pending').length,
      accepted: all.filter((p) => p.status === 'accepted').length,
      rejected: all.filter((p) => p.status === 'rejected').length,
    };
  }
}
