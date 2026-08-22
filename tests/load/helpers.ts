/**
 * tests/load/helpers.ts — مهاد اختبارات الضغط (المرحلة 33)
 * المالك: ديوان التدقيق | المدخلات: دولة مهيأة وأوامر ملكية | المخرجات: قناة ومجدول ودفتر وتمرين
 * التبعيات: bootstrapState + CommandChannel + FairScheduler + LoadLedger + LoadDrill
 * الصلاحيات: لا حقن لمصير ناجح خارج القناة، ولا منح حصة خارج سجل الموارد
 * السجلات: تصدرها الوحدات المختبَرة | حالات الفشل: تصغير السقوف في المهاد لا في السياسة الفعلية
 * اختبار القبول: tests/load/load_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت هذا المهاد: 1) كل أمر يوقّعه الملك؛ 2) لكل اختبار مجلد مؤقت مستقل؛
 *                    3) السياسة تُشتق من config/load.yaml لا من أرقام مكتوبة في الاختبار.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapState, CommandChannel, DigitalState, FairScheduler, LoadDrill, LoadLedger, LoadPolicy,
} from '../../src/index';

export const T0 = Date.now();

export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'sool-load-'));
}

export interface LoadHarness {
  readonly s: DigitalState;
  readonly dir: string;
  readonly policy: LoadPolicy;
  readonly channel: CommandChannel;
  readonly scheduler: FairScheduler;
  readonly ledger: LoadLedger;
  readonly drill: LoadDrill;
  readonly authority: string;
  issue(index?: number): ReturnType<DigitalState['king']['issueCommand']>;
}

/**
 * مهاد كامل بسقوف مصغّرة اختياريًا. التصغير يقع في نسخة السياسة الممرَّرة للتمرين،
 * ولا يمسّ config/load.yaml: الاختبار لا يخفّف سياسة الدولة ليَنجح.
 */
export function loadHarness(overrides: Partial<LoadPolicy> = {}, options: {
  queueMax?: number; ownerQueueMax?: number; maxConcurrent?: number; maxAttempts?: number;
} = {}): LoadHarness {
  const dir = tmpDir();
  const s = bootstrapState({ now: T0, auditPath: join(dir, 'audit.jsonl') });
  const policy: LoadPolicy = { ...s.loadConfig.policy, ...overrides };
  const channel = new CommandChannel(s.audit, s.gateway, join(dir, 'channel.json'), options.maxAttempts ?? 3);
  const scheduler = new FairScheduler(
    s.audit, s.killSwitch, options.maxConcurrent ?? 4,
    options.queueMax ?? s.scaleConfig.policy.scheduler_queue_max,
    options.ownerQueueMax ?? s.scaleConfig.policy.scheduler_owner_queue_max,
  );
  const ledger = new LoadLedger({ audit: s.audit, authority: policy.drill_authority, maxLoss: policy.max_command_loss });
  const drill = new LoadDrill({
    audit: s.audit, killSwitch: s.killSwitch, resources: s.resources,
    ledger, policy, mode: () => s.gateway.mode,
  });
  let counter = 0;
  return {
    s, dir, policy, channel, scheduler, ledger, drill, authority: policy.drill_authority,
    issue(index?: number) {
      counter += 1;
      const n = index ?? counter;
      return s.king.issueCommand('create_agent', `agent:load-${n}-${counter}`, { load: n }, T0);
    },
  };
}

/** دفتر معزول: يُختبر وحده بلا قناة، كي تُقاس المطابقة لا التكامل */
export function ledgerOnly(maxLoss = 0): { s: DigitalState; ledger: LoadLedger } {
  const dir = tmpDir();
  const s = bootstrapState({ now: T0, auditPath: join(dir, 'audit.jsonl') });
  const ledger = new LoadLedger({ audit: s.audit, authority: 'authority:audit_bureau', maxLoss });
  return { s, ledger };
}

/** أحداث السجل بأسمائها — الاختبار يؤكد على الرموز لا على النصوص المشكولة */
export function countEvent(s: DigitalState, event: string): number {
  return s.audit.find(event).length;
}

export function hasEvent(s: DigitalState, event: string): boolean {
  return s.audit.find(event).length > 0;
}

/** تفاصيل آخر حدث بالاسم — للتأكد أن الرفض حمل رمزه لا مجرد أنه وقع */
export function lastDetail(s: DigitalState, event: string): Record<string, unknown> {
  const found = s.audit.find(event);
  return (found.at(-1)?.detail ?? {}) as Record<string, unknown>;
}
