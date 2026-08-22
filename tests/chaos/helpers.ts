/**
 * tests/chaos/helpers.ts — مهاد اختبارات الانقطاع (المرحلة 34)
 * المالك: ديوان التدقيق
 * المدخلات: دولة مهيأة + تهيئة config/chaos.yaml
 * المخرجات: مهاد تمرين (حاقن + دفتر + تمرين) و«ضحيّة» لكل قطع بمقعد حقيقي
 * التبعيات: bootstrapState + CommandChannel + NetworkEgressGuard + ContinuityController
 * الصلاحيات: القطع والقياس فقط. المهاد لا يخترع رفضًا ولا يُصلح خرقًا أثناء قياسه
 * السجلات: تصدرها الوحدات المختبَرة | حالات الفشل: تصغير السقوف في نسخة السياسة لا في التهيئة
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت هذا المهاد:
 *   1) **الضحيّة دولة حقيقية مستقلة**: كل قطع يُمارَس على دولة مهيأة بمجلدها ولقطتها،
 *      لا على الدولة التي تُدير التمرين — فالتمرين لا يوقف من يقيسه (RULE-004).
 *   2) **المقاعد حقيقية**: الشبكة = إذن خروج معلن يُلغى، والهوية = شهادة ملك تُبطل،
 *      والطاقة = قناة تُفقد وتُبنى من القرص، والقرص = مسار لقطة يُستحال الكتابة عليه.
 *      لا مقعد صوري ولا علم بولياني يتظاهر بالقطع.
 *   3) **الرفض يُقرأ برمزه**: كل مِجَسّ يعيد رمزًا معلنًا (حدث تدقيق أو رمز استثناء)،
 *      ولا يُقاس الرفض بنص عربي مشكول.
 *   4) **العودة بإثبات**: `healed()` لا يقول «تم» بل يُعيد قياسًا: إذنٌ عاد، أو بوابة
 *      اعتمدت، أو لقطة قُرئت وطابقت عددها قبل القطع.
 */
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapState, ChaosDrill, ChaosPolicy, CommandChannel, CutProbe, DigitalState,
  FaultInjector, FaultSeam, NetworkEgressGuard, SafeStopLedger, SignedRoyalCommand,
  matchEffects, CHANNEL_PERSIST_FAILED,
} from '../../src/index';

export const T0 = Date.now();

/** المضيف المستعمل في مقعد الشبكة — معلن في المهاد كي لا يُكتب رقمًا سائبًا في الاختبار */
export const PROBE_HOST = 'probe.sool.local';
export const PROBE_PORT = 443;

export function tmpDir(prefix = 'sool-chaos-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * ضحيّة القطع: دولة مستقلة بقناة أوامر ودفتر آثار.
 * `effects` يُلحق فيه المنفّذ رقم كل أمر جرى أثره فعلًا — فمطابقة الأثر بالمصير
 * تُقاس من مصدرين مستقلين لا من مصدر واحد يُصدّق نفسه.
 */
export class Victim {
  dir: string;

  s: DigitalState;

  channel: CommandChannel | null;

  readonly effects: string[] = [];

  private counter = 0;

  constructor(readonly label: string) {
    this.dir = tmpDir(`sool-chaos-${label}-`);
    this.s = bootstrapState({ now: T0, auditPath: join(this.dir, 'audit.jsonl') });
    this.channel = new CommandChannel(this.s.audit, this.s.gateway, this.statePath);
  }

  get statePath(): string {
    return join(this.dir, 'state', 'channel.json');
  }

  get live(): CommandChannel {
    if (!this.channel) throw new Error('لا قناة قائمة — الطاقة مقطوعة');
    return this.channel;
  }

  issue(action = 'create_agent'): SignedRoyalCommand {
    this.counter += 1;
    return this.s.king.issueCommand(
      action as Parameters<DigitalState['king']['issueCommand']>[0],
      `agent:${this.label}-${this.counter}`,
      { probe: this.counter },
      T0,
    );
  }

  /** المنفّذ المفوَّض: يُلحق الأثر ثم لا شيء. الأثر هنا هو الدليل المستقل. */
  executor = (command: SignedRoyalCommand): void => {
    this.effects.push(command.payload.commandId);
  };

  /** أمر واحد كامل: إدراج ثم معالجة. يُستعمل في تهيئة ما قبل القطع. */
  runOne(): string {
    const command = this.issue();
    this.live.submit(command);
    this.live.process(this.executor, T0);
    return command.payload.commandId;
  }

  /** بناء القناة من القرص — هذا هو مسار العودة بعد فقد العملية */
  rebuild(): CommandChannel {
    this.channel = new CommandChannel(this.s.audit, this.s.gateway, this.statePath);
    return this.channel;
  }

  /** قياسات ما بعد القطع، كلها مقروءة من الوحدات لا مُدَّعاة */
  measure(): {
    effects: ReturnType<typeof matchEffects>;
    danglingLeases: number;
    auditIntact: boolean;
    modeAfter: 'full' | 'limited' | 'halted';
    declaredStop: boolean;
  } {
    const records = this.channel ? this.channel.list() : [];
    return {
      effects: matchEffects({
        effects: this.effects,
        records: records.map((r) => ({ commandId: r.commandId, status: r.status })),
      }),
      danglingLeases: this.s.resources.activeLeases(T0).length,
      auditIntact: this.s.audit.verifyIntegrity().valid,
      modeAfter: this.s.continuity.current.mode,
      declaredStop: this.s.audit.find('continuity_mode_changed').length > 0,
    };
  }

  /** إعلان التوقف: مسار الوحدة الحقيقي لا علم في الاختبار */
  declareStop(reason: string): void {
    this.s.continuity.enterOutage(reason, T0);
  }
}

export interface ChaosHarness {
  readonly dir: string;
  readonly s: DigitalState;
  readonly policy: ChaosPolicy;
  readonly injector: FaultInjector;
  readonly ledger: SafeStopLedger;
  readonly drill: ChaosDrill;
  readonly authority: string;
}

/**
 * مهاد التمرين. التصغير يقع في نسخة السياسة الممرَّرة، ولا يمسّ config/chaos.yaml:
 * الاختبار لا يخفّف سياسة الدولة لينجح.
 */
export function chaosHarness(overrides: Partial<ChaosPolicy> = {}): ChaosHarness {
  const dir = tmpDir();
  const s = bootstrapState({ now: T0, auditPath: join(dir, 'audit.jsonl') });
  const policy: ChaosPolicy = { ...s.chaosConfig.policy, ...overrides };
  const injector = new FaultInjector({ audit: s.audit, policy });
  const ledger = new SafeStopLedger({ audit: s.audit, policy });
  const drill = new ChaosDrill({
    audit: s.audit, killSwitch: s.killSwitch, injector, ledger, policy, mode: () => s.gateway.mode,
  });
  return {
    dir, s, policy, injector, ledger, drill, authority: policy.drill_authority,
  };
}

/** مقعد صوري معلن أنه صوري — للاختبارات السلبية وحدها (تسجيل، تكرار، تداخل) */
export function dummySeam(kind: ChaosPolicy['faults'][number], options: {
  healsTo?: boolean;
} = {}): FaultSeam & { cuts: number; heals: number } {
  const seam = {
    kind,
    cuts: 0,
    heals: 0,
    cut(): void { seam.cuts += 1; },
    heal(): void { seam.heals += 1; },
    healed(): boolean { return options.healsTo ?? true; },
  };
  return seam;
}

/* ------------------------------------------------------------------ */
/*                      المقاعد الأربعة الحقيقية                       */
/* ------------------------------------------------------------------ */

/**
 * قطع الشبكة: إذن خروج معلن بأمر ملكي ثم يُلغى.
 * محاولة واحدة تحت القطع لا أكثر: الحارس يحتوي القناة بعد ثلاث محاولات غير معلنة
 * والاحتواء لا رجعة فيه داخل العملية، فتكثير المحاولات يقيس الاحتواء لا القطع.
 */
export function networkProbe(v: Victim): CutProbe & { guard: NetworkEgressGuard } {
  // حارس بلا حصة موارد: حصة egress_calls في config/quotas.yaml صفر فترفض كل نداء
  // لسبب غير القطع، وقطعٌ لا يغيّر النتيجة لا يقيس شيئًا. الحصة تُختبر في المرحلة 26.
  const guard = new NetworkEgressGuard(v.s.audit, v.s.gateway, v.s.killSwitch, {});
  const allow = (): boolean => guard.declare(
    v.s.king.issueCommand('open_external_account', `host:${PROBE_HOST}`, {}, T0),
    {
      host: PROBE_HOST,
      port: PROBE_PORT,
      purpose: 'مِجَسّ قطع شبكة معلن',
      expiresAt: T0 + 3_600_000,
      maxCallsPerMinute: 60,
    },
    T0,
  ).allowed;
  if (!allow()) throw new Error('تعذّر إعلان إذن الخروج في تهيئة المِجَسّ');

  return {
    kind: 'network',
    guard,
    seam: {
      kind: 'network',
      cut: () => { guard.revoke(PROBE_HOST, PROBE_PORT, 'authority:audit_bureau', 'قطع شبكة معلن في تمرين'); },
      heal: () => { allow(); },
      healed: () => guard.hasAllowance(PROBE_HOST, PROBE_PORT, T0),
    },
    attempt: () => {
      const decision = guard.request(`agent:${v.label}`, { host: PROBE_HOST, port: PROBE_PORT }, T0);
      v.declareStop('انقطاع شبكة معلن — لا اتصال خارجي');
      return {
        proceeded: decision.allowed,
        refusalCode: decision.allowed ? null : 'unannounced_egress_attempt',
      };
    },
    measure: () => v.measure(),
  };
}

/**
 * قطع الهوية: شهادة الملك تُبطل من سلطة الشهادات، فتُغلق البوابة كل فعل سيادي.
 * العودة إصدار هوية جديدة بعد الانقطاع: الإبطال لا رجعة فيه بحكم التصميم
 * (سلطة الشهادات لا تُلغي إبطالًا)، والعودة الحقيقية في الواقع إعادة إصدار.
 */
export function identityProbe(v: Victim): CutProbe {
  const certIdOf = (state: DigitalState): string => {
    const kingId = state.registry.kingId();
    if (!kingId) throw new Error('لا ملك مسجَّل في الضحيّة');
    const cert = state.registry.get(kingId);
    if (!cert) throw new Error('لا شهادة ملك في الضحيّة');
    return cert.certId;
  };
  return {
    kind: 'identity',
    seam: {
      kind: 'identity',
      cut: () => { v.s.ca.revoke(certIdOf(v.s), 'إبطال هوية معلن في تمرين قطع'); },
      heal: () => {
        // إعادة تأسيس الهوية بعد الانقطاع: جذر ثقة جديد وشهادة ملك جديدة.
        // مجلد الضحيّة يُستبدل كي لا تُخلط لقطة ما قبل القطع بما بعده.
        v.dir = tmpDir('sool-chaos-identity-restored-');
        v.s = bootstrapState({ now: T0, auditPath: join(v.dir, 'audit.jsonl') });
        v.channel = new CommandChannel(v.s.audit, v.s.gateway, v.statePath);
      },
      healed: () => v.s.gateway.authorize(v.issue(), T0).allowed,
    },
    attempt: () => {
      const command = v.issue();
      v.live.submit(command);
      const before = v.effects.length;
      v.live.process(v.executor, T0);
      v.declareStop('انقطاع هوية معلن — شهادة الملك مبطلة');
      const proceeded = v.effects.length > before;
      return {
        proceeded,
        refusalCode: proceeded ? null : 'command_channel_denied',
      };
    },
    measure: () => v.measure(),
  };
}

/**
 * قطع الطاقة: العملية تُفقد فجأة والقناة تذهب معها، ثم تُبنى من القرص.
 * الفعل المُجرَّب تحت القطع هو إعادة إدراج أمر سبق تنفيذه: قناة أُعيد بناؤها
 * لا يجوز أن تنفّذه ثانيًا («مرة واحدة فقط» يعبر إعادة التشغيل).
 */
export function powerProbe(v: Victim): CutProbe {
  let executedId = '';
  let recordsBefore = 0;
  return {
    kind: 'power',
    seam: {
      kind: 'power',
      cut: () => {
        executedId = v.runOne();
        v.runOne();
        recordsBefore = v.live.list().length;
        v.channel = null; // فقد العملية: لا إغلاق مرتّب ولا وداع
        v.declareStop('انقطاع طاقة معلن — العملية فُقدت');
      },
      heal: () => { v.rebuild(); },
      healed: () => v.channel !== null && v.live.list().length === recordsBefore,
    },
    attempt: () => {
      const channel = v.rebuild(); // العودة من القرص هي أول ما يجري بعد الطاقة
      const replay = v.live.list().find((r) => r.commandId === executedId);
      if (!replay) return { proceeded: true, refusalCode: null };
      const before = v.effects.length;
      channel.submit(replay.command);
      channel.process(v.executor, T0);
      const proceeded = v.effects.length > before;
      return {
        proceeded,
        refusalCode: proceeded ? null : 'command_duplicate_submission',
      };
    },
    measure: () => v.measure(),
  };
}

/**
 * قطع القرص (البند T-90): مسار اللقطة يُستحال الكتابة عليه — يُستبدل الملف بمجلد،
 * فتفشل الكتابة بيقين ومهما كان المستخدم صاحب صلاحية (لا يُعتمد على بتّات الأذونات).
 * الواجب أن يكون توقفًا معلنًا برمز، لا أمرًا مقبولًا في الذاكرة بلا أثر على القرص.
 */
export function diskProbe(v: Victim): CutProbe {
  let saved = '';
  let recordsBefore = 0;
  let ghostId = '';
  return {
    kind: 'disk',
    seam: {
      kind: 'disk',
      cut: () => {
        v.runOne();
        v.runOne();
        recordsBefore = v.live.list().length;
        saved = readFileSync(v.statePath, 'utf8');
        rmSync(v.statePath);
        mkdirSync(v.statePath, { recursive: true });
        v.declareStop('انقطاع قرص معلن — لا كتابة على مسار اللقطة');
      },
      heal: () => {
        if (existsSync(v.statePath)) rmSync(v.statePath, { recursive: true, force: true });
        writeFileSync(v.statePath, saved, 'utf8');
      },
      healed: () => {
        const rebuilt = v.rebuild();
        return rebuilt.list().length === recordsBefore
          && rebuilt.statusOf(ghostId) === null;
      },
    },
    attempt: () => {
      const command = v.issue();
      ghostId = command.payload.commandId;
      let refusalCode: string | null = null;
      try {
        v.live.submit(command);
      } catch (err) {
        const message = (err as Error).message;
        refusalCode = message.startsWith(CHANNEL_PERSIST_FAILED) ? CHANNEL_PERSIST_FAILED : null;
      }
      // «مضى» تعني بقاء سجل مقبول لا أثر له على القرص — وهي الحالة المجهولة الممنوعة
      return { proceeded: v.live.statusOf(ghostId) !== null, refusalCode };
    },
    measure: () => v.measure(),
  };
}

/** الضحايا الأربع ومقاعدها، جاهزة لتمرين كامل. حارس الشبكة يُعاد كي يُقاس قبل القطع وبعده. */
export function allProbes(): {
  victims: Record<string, Victim>;
  probes: CutProbe[];
  guard: NetworkEgressGuard;
} {
  const victims: Record<string, Victim> = {
    network: new Victim('network'),
    identity: new Victim('identity'),
    power: new Victim('power'),
    disk: new Victim('disk'),
  };
  const network = networkProbe(victims.network!);
  return {
    victims,
    guard: network.guard,
    probes: [
      network,
      identityProbe(victims.identity!),
      powerProbe(victims.power!),
      diskProbe(victims.disk!),
    ],
  };
}

/** أحداث السجل بأسمائها — الاختبار يؤكد على الرموز لا على النصوص المشكولة */
export function countEvent(s: DigitalState, event: string): number {
  return s.audit.find(event).length;
}

export function hasEvent(s: DigitalState, event: string): boolean {
  return s.audit.find(event).length > 0;
}

export function lastDetail(s: DigitalState, event: string): Record<string, unknown> {
  const found = s.audit.find(event);
  return (found.at(-1)?.detail ?? {}) as Record<string, unknown>;
}
