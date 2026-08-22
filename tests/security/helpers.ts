/**
 * tests/security/helpers.ts — مهاد اختبارات الإنهاء (المرحلة 35)
 * المالك: ديوان التدقيق
 * المدخلات: لا شيء | المخرجات: دولة مُقلعة + وكلاء أحياء + مسالك حقيقية للشهادة
 * التبعيات: bootstrapState وحده — لا حالة تُحقن من خارج البوابة
 * الصلاحيات: بناء مشاهد اختبار فقط
 * السجلات: كلها عبر سجل الدولة القائم
 * حالات الفشل: أي مشهد لا يمرّ من الطريق المعلن يُعدّ خطأ في المهاد لا في الوحدة
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت هذا المهاد:
 *   1) **المسالك حقيقية**: كل مسلك هنا يستدعي وحدة الدولة الفعلية (الأداة، المورد،
 *      القدرة، المجدول، المصنع) — لا علمًا في الاختبار. مسلكٌ مزيّف يُثبت المزيّف.
 *   2) **لا حقن حالة**: الوكلاء يُولدون من المصنع بأمر ملكي، والقدرات تُمنح بأمر.
 *   3) **العدّادات مكشوفة** في المسالك الوهمية كي يُقاس أنها نودِيت فعلًا.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentBlueprint, EntityId, ProbeAttempt, StopProbe, StopProbeKind, StopWitness,
  TerminationDrill, TerminationLedger, TerminationRoll, bootstrapState, loadTermination,
} from '../../src/index';
import { TerminationOrder } from '../../src/crown/termination_order';

export type State = ReturnType<typeof bootstrapState>;

/** زمن ثابت لكل قياس زمني — لا اختبار يعتمد على ساعة الجدار */
export const T0 = 1_800_000_000_000;

export function tmpDir(prefix = 'sool-term-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function blueprint(over: Partial<AgentBlueprint> = {}): AgentBlueprint {
  return {
    blueprintId: 'worker',
    template: 'limited_worker',
    maxInstances: 16,
    generation: 1,
    purpose: 'عمل حسابي محدود داخل الأدوات المسجَّلة',
    ...over,
  };
}

/** أداة اختبار حقيقية: تُسجَّل في سجل الأدوات وتُستدعى من الطريق الوحيد */
export const TOOL = 'calc';

/**
 * مشهد كامل: دولة مُقلعة، مخطط معلن، وكلاء مولودون، خطة نية معلنة لكل وكيل،
 * وقدرة `compute` ممنوحة بأمر ملكي — أي أن كل مسلك **يعمل** قبل الأمر.
 */
export function scene(count = 3): {
  s: State;
  agents: readonly EntityId[];
  policy: ReturnType<typeof loadTermination>['policy'];
} {
  const s = bootstrapState({ now: T0 });
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'spawn:worker'), blueprint());
  // سقف التوالد 4/دقيقة في quotas.yaml: دفعة أكبر تُلغى كاملة وتُنهي مواليدها.
  // المهاد يرفض أن يُكمل على مشهد فاسد — مهادٌ يصمت على فشله يُنتج نجاحًا كاذبًا.
  const batch = s.factory.spawn(s.king.issueCommand('create_agent', 'batch'), {
    blueprintId: 'worker', count, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  } as never);
  if (!batch.ok) throw new Error(`مهاد فاسد — الدفعة رُفضت: ${batch.reason}`);
  s.tools.register({
    name: TOOL, requiredCapability: 'compute', maxCallsPerWindow: 1000, windowMs: 60_000,
    handler: () => 'ok',
  } as never);
  // الأحياء فقط: `list()` يشمل المنتهين، والشهادة على منتهٍ سابق تقيس الماضي لا الأمر
  const agents = s.agents.list()
    .filter((a) => a.status === 'created' || a.status === 'running' || a.status === 'suspended')
    .map((a) => a.agentId);
  for (const id of agents) {
    s.deception.declarePlan(id, [TOOL]);
    s.permissions.grant(
      s.king.issueCommand('grant_capability', id),
      { entity: id, capability: 'compute', expiresAt: Date.now() + 3_600_000 },
    );
  }
  if (agents.length !== count) throw new Error(`مهاد فاسد — طُلب ${count} وحُصل ${agents.length}`);
  return { s, agents, policy: loadTermination().policy };
}

/**
 * المسالك الحقيقية الخمسة. كلٌّ منها يحاول فعلًا سياديًّا بهوية الكيان عبر
 * الوحدة الفعلية، ويُرجع رمز الرفض المعلن إن رُفض.
 */
export function toolProbe(s: State): StopProbe {
  return {
    kind: 'tool',
    attempt: (entity): ProbeAttempt => {
      const out = s.tools.invoke(entity, TOOL, {}, s.permissions.granted(entity));
      return { acted: out.ok, refusalCode: out.ok ? null : 'TOOL_DENIED' };
    },
  };
}

export function leaseProbe(s: State): StopProbe {
  return {
    kind: 'lease',
    attempt: (entity): ProbeAttempt => {
      const out = s.resources.lease(entity, 'compute_units', 1);
      if (out.granted) {
        // المسلك لا يترك أثرًا يفسد قياس «الإيجار المعلَّق»: يحرّر ما استأجره هو
        s.resources.release(out.lease.leaseId);
        return { acted: true, refusalCode: null };
      }
      return { acted: false, refusalCode: 'LEASE_DENIED' };
    },
  };
}

export function capabilityProbe(s: State): StopProbe {
  return {
    kind: 'capability',
    attempt: (entity): ProbeAttempt => {
      const ok = s.permissions.check(entity, 'compute');
      return { acted: ok, refusalCode: ok ? null : 'CAPABILITY_DENIED' };
    },
  };
}

export function scheduleProbe(s: State): StopProbe {
  let counter = 0;
  return {
    kind: 'schedule',
    attempt: (entity): ProbeAttempt => {
      counter += 1;
      const out = s.scheduler.enqueue(`probe:${entity}:${counter}`, entity);
      return { acted: out.ok, refusalCode: out.ok ? null : out.code };
    },
  };
}

export function spawnProbe(s: State): StopProbe {
  let counter = 0;
  return {
    kind: 'spawn',
    attempt: (entity): ProbeAttempt => {
      counter += 1;
      const out = s.factory.spawn(s.king.issueCommand('create_agent', `probe-${counter}`), {
        blueprintId: 'worker', count: 1, requestedBy: entity, supervisor: entity,
      } as never);
      return { acted: out.ok, refusalCode: out.ok ? null : 'SPAWN_DENIED' };
    },
  };
}

/** كل المسالك المبنية — بما فيها غير المعلن في التهيئة، لقياس الحدود صراحةً */
export function allProbes(s: State): readonly StopProbe[] {
  return [toolProbe(s), leaseProbe(s), capabilityProbe(s), scheduleProbe(s), spawnProbe(s)];
}

/**
 * المسالك المعلنة في التهيئة وحدها. الشاهد في التشغيل لا يُجرّب ما لم تُعلنه
 * السياسة — وإلا صار الاختبار يحكم على مسلك لا تقرّه القاعدة الحاكمة.
 */
export function declaredProbesOf(s: State): readonly StopProbe[] {
  const declared = new Set<string>(loadTermination().policy.probes);
  return allProbes(s).filter((probe) => declared.has(probe.kind));
}

/** مسلك وهمي بعدّادات مكشوفة — للاختبارات التي تقيس سلوك الشاهد لا الدولة */
export function dummyProbe(
  kind: StopProbeKind,
  options: { before?: boolean; after?: boolean; code?: string | null; throws?: boolean } = {},
): StopProbe & { counters: { calls: number } } {
  const counters = { calls: 0 };
  return {
    kind,
    counters,
    attempt: (): ProbeAttempt => {
      counters.calls += 1;
      if (options.throws) throw new Error('انهيار مسلك');
      const acted = counters.calls === 1 ? options.before ?? true : options.after ?? false;
      return { acted, refusalCode: acted ? null : options.code ?? 'DUMMY_DENIED' };
    },
  };
}

/** منفّذ أمر إنهاء حقيقي عبر `TerminationOrder` — أمر واحد يمرّ من البوابة */
export function realExecutor(s: State) {
  const order = new TerminationOrder(
    s.audit, s.gateway, s.killSwitch, s.agents.controller(), s.resources,
  );
  return {
    execute: (targets: readonly EntityId[]) => {
      const report = order.execute(
        s.king.issueCommand('terminate_agent', 'all', { targets: targets.join(',') }),
      );
      return { executed: report.executed, claimedStopped: report.stopped, reason: report.reason };
    },
  };
}

/** قارئ القياسات من الوحدات الحقيقية — لا يدّعي عنها */
export function realReader(s: State, at = T0) {
  return {
    read: (entity: EntityId) => ({
      liveCapabilities: s.permissions.granted(entity).length,
      danglingLeases: s.resources.activeLeases().filter((l) => l.entity === entity).length,
      declaredStop: s.audit.find('entity_stopped').some(
        (e) => (e.detail as { entity?: string }).entity === entity,
      ),
      stopMs: 0,
    }),
    at,
  };
}

/** مهاد تمرين كامل جاهز للتشغيل */
export function drillHarness(count = 3) {
  const { s, agents, policy } = scene(count);
  const witness = new StopWitness({ audit: s.audit, policy, probes: declaredProbesOf(s) });
  const ledger = new TerminationLedger({ audit: s.audit, policy });
  const drill = new TerminationDrill({
    audit: s.audit, killSwitch: s.killSwitch, witness, ledger,
    executor: realExecutor(s), reader: realReader(s), policy, mode: () => s.mode(),
  });
  return { s, agents, policy, witness, ledger, drill, runner: 'authority:audit_bureau' as EntityId };
}

export function freshRoll(s: State): TerminationRoll {
  return new TerminationRoll(s.audit);
}

export function countEvent(s: State, kind: string): number {
  return s.audit.find(kind).length;
}

export function hasEvent(s: State, kind: string): boolean {
  return s.audit.find(kind).length > 0;
}

export function lastDetail(s: State, kind: string): Record<string, unknown> {
  const entries = s.audit.find(kind);
  return (entries.at(-1)?.detail ?? {}) as Record<string, unknown>;
}
