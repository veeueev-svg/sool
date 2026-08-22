/**
 * src/law/enforcement.ts — تنفيذ الأحكام بعد نهائيتها (المرحلة 22)
 * المالك: حرس التاج (التنفيذ) — والقضاء لا ينفّذ والادعاء لا ينفّذ (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: دعوى بحكم نهائي + جهة تنفيذ مخوَّلة (+ أمر ملكي عند الإنهاء)
 * المخرجات: أثر فعلي متحقَّق منه على الوكيل، أو فشل تنفيذ معلن لا مفترَض
 * التبعيات: المحكمة، سجل الوكلاء، سجل الصلاحيات، سياسة التوالد، بوابة التاج، السجل
 * الصلاحيات: التنفيذ لحرس التاج فقط، والإنهاء لا يقع إلا بأمر ملكي معتمد
 * السجلات: enforcement_executed / enforcement_refused / enforcement_failed
 * ثوابت هذه الوحدة:
 *   1) **لا تنفيذ قبل النهائية**: مدة الطعن منقضية ولا طعن قائم
 *   2) **لا تنفيذ على غير مُدان**، ولا تنفيذ لعقوبة خارج حكم المحكمة
 *   3) **من حكم لا ينفّذ، ومن اتهم لا ينفّذ** (RULE-004)
 *   4) **الإنهاء فعل سيادي**: يلزمه أمر ملكي `terminate_agent` بهدف المحكوم عليه
 *   5) **التحقق بعد التنفيذ إلزامي**: إن لم يثبت الأثر فالنتيجة فشل مسجَّل لا نجاح مفترض
 *      (الدرس المستفاد من المرحلة 20: الاحتواء المرفوض كان يُسجَّل نجاحًا)
 *   6) التنفيذ مرة واحدة: دعوى منفَّذة لا تُنفَّذ ثانية
 *   7) العفو الملكي يسقط التنفيذ — لا عقوبة بعد نقض الحكم
 * حالات الفشل (كلها مغلقة): جهة غير مخوَّلة، حكم غير نهائي، طعن قائم،
 *   أمر إنهاء ناقص، أثر غير متحقَّق ⇒ كلها رفض/فشل مسجَّل
 * اختبار القبول: tests/law/enforcement.test.ts, tests/law/case_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0006-law-and-courts.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { AgentRegistry } from '../agents/agent_registry';
import { PermissionRegistry } from '../agents/permissions';
import { SpawnPolicy } from '../agents/spawn_policy';
import { Court, LegalCase } from './courts';
import { PenaltyKind } from './statutes';
import { ENFORCEMENT_AUTHORITIES } from './authorities';

/** جهات التنفيذ المعلنة — قائمة مغلقة */
// قائمةُ جهات التنفيذ مصدرها `./authorities` — يقرؤها حرَسُ المحكمة أيضًا فلا نسختان (T-114)
export { ENFORCEMENT_AUTHORITIES };

export interface EnforcementReport {
  readonly caseId: string;
  readonly defendant: EntityId;
  readonly penalty: PenaltyKind | 'none';
  readonly executedBy: EntityId;
  readonly at: number;
  /** إثبات الأثر بعد التنفيذ — لا نجاح بلا تحقّق */
  readonly verified: boolean;
  readonly detail: string;
}

export type EnforcementResult =
  | { readonly ok: true; readonly report: EnforcementReport; readonly legalCase: LegalCase; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface EnforcementDeps {
  readonly audit: AppendOnlyLog;
  readonly court: Court;
  readonly gateway: CrownGateway;
  readonly agents: AgentRegistry;
  readonly permissions: PermissionRegistry;
  readonly spawnPolicy: SpawnPolicy;
  readonly authorities?: readonly EntityId[];
}

export interface ExecuteOptions {
  /** أمر ملكي بفعل terminate_agent — إلزامي لعقوبة الإنهاء وحدها */
  readonly terminationCommand?: SignedRoyalCommand;
}

export class Enforcement {
  private readonly executed = new Map<string, EnforcementReport>();
  private readonly authorities: readonly EntityId[];

  constructor(private readonly deps: EnforcementDeps) {
    this.authorities = deps.authorities ?? ENFORCEMENT_AUTHORITIES;
  }

  reportFor(caseId: string): EnforcementReport | undefined {
    return this.executed.get(caseId);
  }

  execute(
    caseId: string, by: EntityId, options: ExecuteOptions = {}, now = Date.now(),
  ): EnforcementResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): EnforcementResult => {
      const entry = this.deps.audit.append(by, 'enforcement_refused', { caseId, reason, ...extra });
      return { ok: false, reason, auditId: entry.hash };
    };
    const fail = (detail: string, penalty: PenaltyKind | 'none', defendant: EntityId): EnforcementResult => {
      const entry = this.deps.audit.append(by, 'enforcement_failed', {
        caseId, defendant, penalty, detail,
      });
      return { ok: false, reason: `فشل التنفيذ: ${detail}`, auditId: entry.hash };
    };

    if (!this.authorities.includes(by)) return refuse('جهة غير مخوَّلة بالتنفيذ');
    const c = this.deps.court.get(caseId);
    if (!c) return refuse('دعوى غير موجودة');
    if (this.executed.has(caseId) || c.status === 'enforced') return refuse('الحكم نُفِّذ سابقًا');
    if (!c.ruling) return refuse('لا تنفيذ بلا حكم');
    if (by === c.ruling.judge) return refuse('من حكم لا ينفّذ (RULE-004)');
    if (by === c.prosecutor) return refuse('من اتهم لا ينفّذ (RULE-004)');
    if (c.appealPending) return refuse('طعن قائم — التنفيذ موقوف حتى الفصل');
    if (!this.deps.court.isFinal(caseId, now)) return refuse('لا تنفيذ قبل نهائية الحكم');

    const finalized = this.deps.court.finalize(caseId, by, now);
    if (!finalized.ok) return refuse(`تثبيت النهائية فشل: ${finalized.reason}`);
    const settled = finalized.legalCase;
    if (!settled.ruling) return refuse('لا حكم بعد التثبيت');
    if (!settled.ruling.guilty) return refuse('لا تنفيذ على غير مُدان — الحكم بالبراءة أو نُقض');
    const penalty = settled.ruling.penalty;
    if (penalty === 'none') return refuse('لا عقوبة في الحكم');

    // تنفيذ العقوبة ثم التحقق من أثرها (ثابت 5)
    let detail = '';
    let verified = false;
    switch (penalty) {
      case 'warning': {
        this.deps.audit.append(by, 'penalty_warning_recorded', {
          caseId, defendant: settled.defendant, reason: settled.ruling.reason,
        });
        detail = 'تحذير مسجَّل في السجل غير القابل للمحو';
        verified = this.deps.audit.find('penalty_warning_recorded')
          .some((e) => e.detail.caseId === caseId);
        break;
      }
      case 'capability_revocation': {
        const removed = this.deps.permissions.revokeAll(settled.defendant, by, `حكم ${caseId}`);
        const left = this.deps.permissions.granted(settled.defendant, now);
        detail = `سُحبت ${removed} قدرة، والمتبقي ${left.length}`;
        verified = left.length === 0;
        break;
      }
      case 'suspension': {
        const r = this.deps.agents.suspend(settled.defendant, by, `حكم ${caseId}`, now);
        detail = r.ok ? 'تعليق منفَّذ' : `تعليق مرفوض: ${r.reason}`;
        verified = this.deps.agents.get(settled.defendant)?.status === 'suspended';
        break;
      }
      case 'spawn_freeze': {
        this.deps.spawnPolicy.freeze(by, `حكم ${caseId}`);
        detail = 'التوالد مجمَّد';
        verified = this.deps.spawnPolicy.report().frozen === true;
        break;
      }
      case 'termination': {
        const command = options.terminationCommand;
        if (!command) return refuse('الإنهاء فعل سيادي — لا تنفيذ بلا أمر ملكي');
        if (command.payload.action !== 'terminate_agent') return refuse('فعل الأمر ليس terminate_agent');
        if (command.payload.target !== settled.defendant) return refuse('هدف الأمر ليس المحكوم عليه');
        const authorized = this.deps.gateway.authorize(command, now);
        if (!authorized.allowed) return refuse(`أمر الإنهاء غير معتمد: ${authorized.reason}`);
        const r = this.deps.agents.terminate(settled.defendant, by, `حكم ${caseId}`, now);
        detail = r.ok ? 'إنهاء منفَّذ' : `إنهاء مرفوض: ${r.reason}`;
        verified = this.deps.agents.get(settled.defendant)?.status === 'terminated';
        break;
      }
      default:
        return refuse('عقوبة غير معلنة في سلّم التنفيذ');
    }

    if (!verified) return fail(detail, penalty, settled.defendant);

    const marked = this.deps.court.markEnforced(caseId, by, now);
    if (!marked.ok) return fail(`تعذّر تثبيت التنفيذ في الدعوى: ${marked.reason}`, penalty, settled.defendant);

    const report: EnforcementReport = {
      caseId, defendant: settled.defendant, penalty, executedBy: by, at: now, verified: true, detail,
    };
    this.executed.set(caseId, report);
    const entry = this.deps.audit.append(by, 'enforcement_executed', {
      caseId, defendant: report.defendant, penalty, detail, verified: true,
    });
    return { ok: true, report, legalCase: marked.legalCase, auditId: entry.hash };
  }

  report(): {
    readonly executed: number;
    readonly byPenalty: Readonly<Record<string, number>>;
  } {
    const byPenalty: Record<string, number> = {};
    for (const r of this.executed.values()) {
      byPenalty[r.penalty] = (byPenalty[r.penalty] ?? 0) + 1;
    }
    return { executed: this.executed.size, byPenalty };
  }
}
