/**
 * src/production/deadline_probes.ts — ماسحُ المواعيد: ما ينقضي بمرورِ الوقتِ يُمسح بمؤقّت (W-2026-047)
 * المالك: وزارة البنية | القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: واجهاتٌ ضيّقةٌ لخمس وحدات قائمة (الميزانية · الدفعات · تسويات الإنهاء · الخدمات الحرجة ·
 *           البحث البشري) | المخرجات: `WatchProbe` واحدٌ يُمرَّر للمراقب الدائم باسم `deadlines`
 * التبعيات: WatchFinding/WatchProbe من مراقب المرحلة 36
 * لماذا وُجد: خمسةُ بنودٍ مفتوحةٍ بنمطٍ واحد — حكمُ الوقتِ قائمٌ في الوحدة ولا يُطبَّق حتى يناديه أحد:
 *   T-50 بندٌ منقضٍ يبقى في `active()` · T-57 دفعةٌ بلا إثباتٍ لا تُرفع · T-64 تسويةٌ متأخرةٌ لا تُرفع ·
 *   T-78 فقدُ مصدرِ خدمةٍ حرجةٍ لا يُطبَّق إلا عند `execute()` · T-81 بحثٌ منتهٍ ودرسٌ بالٍ لا يُسجَّلان.
 *   وT-70 (نظيرها في المصانع) سُدّ في المرحلة 37 بماسح `factories` — فهذا الماسحُ يتمّها «في نداءٍ واحدٍ
 *   لكل الماسحات» كما نصّ صفُّها.
 * ثوابت:
 *   1) **الماسحُ ينادي حكمَ الوحدةِ نفسَه** (`lapse` · `raiseOverdue` · `raiseUnsettled` · `reconcile` ·
 *      `lapsed`) — لا يعيد كتابةَ قاعدةِ وقتٍ ولا يُصلح غيرَ ما تُصلحه الوحدةُ بندائها المعلن.
 *   2) **لا يُعدّ حادثٌ مرّتين** (ثابت 4 في `production_scanners.ts`): الوحدتان الأوليان ترفعان مرّةً
 *      بطبعهما، والباقي بمؤشّرِ ما رُفع.
 *   3) **سقوطُ البندِ واجبٌ لا حادث**: انقضاءُ الفترةِ مسارٌ طبيعيّ يُقيَّد `appropriation_lapsed` في
 *      الوحدة؛ فلا يُضخّم عدّادَ الحوادث. أمّا ما فات وعدُه (إثبات · تسوية · مصدر · مراجعة) فحادثٌ جسيمٌ
 *      شدّتُه من `config/production.yaml` (RULE-005).
 * حالات الفشل: انهيارُ أيّ وحدةٍ يرفعه المراقبُ خرقًا (مسحةٌ فاشلة) لا يُبلع هنا.
 * اختبار القبول: tests/production/deadline_probes.test.ts
 */
import { EntityId } from '../kernel/types';
import { IncidentKind } from '../kernel/config';
import { WatchFinding, WatchProbe } from '../staging/incident_monitor';

export interface BudgetLapses {
  active(): readonly { readonly line: string; readonly periodEnd: number }[];
  lapse(line: string, now?: number): { readonly ok: boolean };
}
export interface PaymentDeadlines {
  raiseOverdue(now?: number): readonly { readonly paymentId: string }[];
}
export interface SettlementDeadlines {
  raiseUnsettled(now?: number): readonly { readonly contractId: string }[];
  /** T-65 (W-2026-050) */
  raiseUndisposed(now?: number): readonly { readonly contractId: string; readonly counterparty: string }[];
}
export interface ServiceSources {
  activeServices(now?: number): readonly { readonly serviceId: string; readonly mode: string }[];
  reconcile(serviceId: string, observedBy?: EntityId, now?: number):
    { readonly ok: boolean; readonly service?: { readonly mode: string } };
}
export interface ResearchLapses {
  lapsed(now?: number): { readonly researches: readonly string[]; readonly lessons: readonly string[] };
}

export interface DeadlineDeps {
  readonly budget: BudgetLapses;
  readonly payments: PaymentDeadlines;
  readonly settlements: SettlementDeadlines;
  readonly services: ServiceSources;
  readonly research: ResearchLapses;
  /** جهةُ الرصدِ في `reconcile` — تُمرَّر ولا تُخترع داخل الماسح */
  readonly observer: EntityId;
}

const finding = (kind: string, detail: string): WatchFinding => ({ kind: kind as IncidentKind, detail });

export function deadlinesProbe(deps: DeadlineDeps): WatchProbe {
  const reportedResearch = new Set<string>();
  const reportedLessons = new Set<string>();
  return (now: number): readonly WatchFinding[] => {
    const findings: WatchFinding[] = [];
    // T-50 — ثابت 3: واجب لا حادث
    for (const line of deps.budget.active()) {
      if (now > line.periodEnd) deps.budget.lapse(line.line, now);
    }
    // T-57 · T-64 — الوحدةُ ترفع مرّةً بطبعها (ثابت 2)
    for (const p of deps.payments.raiseOverdue(now)) {
      findings.push(finding('payment_confirmation_overdue', `دفعةٌ بلا إثباتٍ بعد نافذتها: ${p.paymentId}`));
    }
    for (const s of deps.settlements.raiseUnsettled(now)) {
      findings.push(finding('settlement_overdue', `تسويةُ عقدٍ مُنهى فات موعدُها: ${s.contractId}`));
    }
    for (const s of deps.settlements.raiseUndisposed(now)) {
      findings.push(finding('channel_undisposed', `قناةٌ معلَّقةٌ بعد تسويةِ ${s.contractId} لم تُغلق ولم تُستأنف: ${s.counterparty}`));
    }
    // T-78 — الهبوطُ وحدَه حادث؛ و`reconcile` لا يرفع خدمةً (صعودُها بتحقّقٍ مستقل)
    for (const svc of deps.services.activeServices(now)) {
      const before = svc.mode;
      const out = deps.services.reconcile(svc.serviceId, deps.observer, now);
      const after = out.ok && out.service ? out.service.mode : before;
      if (after !== before) {
        findings.push(finding('critical_service_degraded', `خدمةٌ حرجةٌ هبطت ${before} ⇒ ${after}: ${svc.serviceId}`));
      }
    }
    // T-81
    const lapsed = deps.research.lapsed(now);
    for (const id of lapsed.researches) {
      if (reportedResearch.has(id)) continue;
      reportedResearch.add(id);
      findings.push(finding('research_lapsed', `بحثٌ انتهت مدتُه وهو قائم: ${id}`));
    }
    for (const id of lapsed.lessons) {
      if (reportedLessons.has(id)) continue;
      reportedLessons.add(id);
      findings.push(finding('research_lapsed', `درسٌ معتمدٌ فاتت مراجعتُه: ${id}`));
    }
    return findings;
  };
}
