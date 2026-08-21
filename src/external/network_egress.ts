/**
 * src/external/network_egress.ts — منع الخروج الشبكي غير المعلن (المرحلة 11)
 * المالك: وزارة الأمن السيبراني
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: طلب اتصال خارجي من كيان داخلي + إذن خروج معلن بأمر ملكي معتمد
 * المخرجات: قرار موثّق (مسموح/مرفوض) + تقرير محاولات غير معلنة
 * التبعيات: بوابة التاج (إعلان الإذن)، مفتاح الإيقاف (الاحتواء)، سجل الموارد (حصة النداءات)
 * الصلاحيات: لا تُمنح استثناءات من داخل الوحدة الخاضعة لها (RULE-005) —
 *            كل إذن خروج يمرّ ببوابة التاج بفعل open_external_account
 * السجلات: كل طلب — مسموحًا كان أو مرفوضًا — يُسجَّل بمعرّف تدقيق
 * ثوابت هذه الوحدة:
 *   1) الافتراض رفض (external_egress_default: deny) — لا خروج بلا إذن معلن غير منتهٍ
 *   2) لا خروج في وضع الحماية أو الإيقاف مهما كان الإذن
 *   3) لا إذن دائم: كل إذن له تاريخ انتهاء وسقف نداءات في الدقيقة
 *   4) بروتوكول غير https مرفوض دائمًا
 *   5) تكرار محاولات غير معلنة ⇒ احتواء (إيقاف الخارج) + تصعيد للملك
 * حالات الفشل (كلها مغلقة): أي شك أو نقص بيانات ⇒ رفض
 * اختبار القبول: tests/security/network_egress.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-monarchy-comprehensive-spec.md — الاتصال الخارجي والعزل
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { KillSwitch } from '../security/kill_switch';
import { ResourceRegistry } from '../kernel/resource_registry';

/** إذن خروج معلن — لا خروج إلا بمطابقة كاملة لأحد هذه الأذونات */
export interface EgressAllowance {
  readonly host: string;
  readonly port: number;
  readonly purpose: string;
  readonly declaredBy: EntityId;
  readonly declaredAt: number;
  readonly expiresAt: number;
  readonly maxCallsPerMinute: number;
}

export interface EgressRequest {
  readonly host: string;
  readonly port?: number;
  readonly protocol?: string;
  readonly purpose?: string;
}

export interface EgressReport {
  readonly allowedCalls: number;
  readonly deniedCalls: number;
  /** المضيفون الذين حاول أحد الوصول إليهم بلا إذن معلن — يجب أن تكون فارغة في التشغيل السليم */
  readonly unannouncedHosts: readonly string[];
  readonly allowances: readonly EgressAllowance[];
  readonly contained: boolean;
}

export interface EgressOptions {
  readonly resources?: ResourceRegistry;
  /** عدد المحاولات غير المعلنة قبل الاحتواء التلقائي */
  readonly containAfterUnannounced?: number;
  readonly ministryId?: EntityId;
}

export class NetworkEgressGuard {
  private readonly allowances = new Map<string, EgressAllowance>();
  private readonly calls = new Map<string, number[]>(); // مفتاح: كيان|مضيف:منفذ
  private readonly unannounced = new Map<string, number>();
  private allowedCalls = 0;
  private deniedCalls = 0;
  private contained = false;
  private readonly ministryId: EntityId;
  private readonly containAfter: number;

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly gateway: CrownGateway,
    private readonly killSwitch: KillSwitch,
    private readonly options: EgressOptions = {},
  ) {
    this.ministryId = options.ministryId ?? 'ministry:cyber_security';
    this.containAfter = options.containAfterUnannounced ?? 3;
    this.audit.append(this.ministryId, 'egress_guard_online', { defaultPolicy: 'deny' });
  }

  private static key(host: string, port: number): string {
    return `${host.toLowerCase()}:${port}`;
  }

  /** إعلان إذن خروج — لا يُقبل إلا بأمر ملكي معتمد من البوابة وبتاريخ انتهاء */
  declare(command: SignedRoyalCommand, allowance: Omit<EgressAllowance, 'declaredBy' | 'declaredAt'>, now = Date.now()): Decision {
    const decision = this.gateway.authorize(command, now);
    if (!decision.allowed) {
      const entry = this.audit.append(this.ministryId, 'egress_allowance_refused', {
        host: allowance.host, reason: decision.reason,
      });
      return { allowed: false, reason: `إذن الخروج مرفوض: ${decision.reason}`, auditId: entry.hash };
    }
    if (command.payload.action !== 'open_external_account') {
      const entry = this.audit.append(this.ministryId, 'egress_allowance_refused', {
        host: allowance.host, reason: 'الفعل لا يخصّ فتح قناة خارجية',
      });
      return { allowed: false, reason: 'الفعل لا يخصّ فتح قناة خارجية', auditId: entry.hash };
    }
    if (!(allowance.expiresAt > now)) {
      const entry = this.audit.append(this.ministryId, 'egress_allowance_refused', {
        host: allowance.host, reason: 'إذن بلا تاريخ انتهاء صالح مرفوض',
      });
      return { allowed: false, reason: 'إذن بلا تاريخ انتهاء صالح مرفوض', auditId: entry.hash };
    }
    if (allowance.maxCallsPerMinute <= 0) {
      const entry = this.audit.append(this.ministryId, 'egress_allowance_refused', {
        host: allowance.host, reason: 'إذن بلا سقف نداءات مرفوض',
      });
      return { allowed: false, reason: 'إذن بلا سقف نداءات مرفوض', auditId: entry.hash };
    }

    const full: EgressAllowance = Object.freeze({
      ...allowance,
      host: allowance.host.toLowerCase(),
      declaredBy: command.payload.issuedBy,
      declaredAt: now,
    });
    this.allowances.set(NetworkEgressGuard.key(full.host, full.port), full);
    const entry = this.audit.append(this.ministryId, 'egress_allowance_declared', {
      host: full.host, port: full.port, purpose: full.purpose,
      expiresAt: full.expiresAt, maxCallsPerMinute: full.maxCallsPerMinute,
      commandId: command.payload.commandId,
    });
    return { allowed: true, reason: 'إذن خروج معلن ومحدود المدة', auditId: entry.hash };
  }

  /** إلغاء إذن — ملكي معتمد، أو من الحرس عند الاحتواء */
  revoke(host: string, port: number, by: EntityId, reason: string): boolean {
    const removed = this.allowances.delete(NetworkEgressGuard.key(host, port));
    this.audit.append(by, 'egress_allowance_revoked', { host, port, reason, removed });
    return removed;
  }

  /**
   * الطلب الوحيد الممكن للخروج. أي مسار آخر يُعَدّ خروجًا غير معلن.
   * الترتيب مقصود: الإيقاف ← وضع الدولة ← البروتوكول ← الإذن ← الانتهاء ← السقف ← الحصة.
   */
  request(entity: EntityId, req: EgressRequest, now = Date.now()): Decision {
    const port = req.port ?? 443;
    const host = (req.host ?? '').trim().toLowerCase();
    const key = NetworkEgressGuard.key(host, port);

    const deny = (reason: string, kind = 'egress_denied'): Decision => {
      this.deniedCalls += 1;
      const entry = this.audit.append(entity, kind, { host, port, protocol: req.protocol ?? 'https', reason });
      return { allowed: false, reason, auditId: entry.hash };
    };

    const halt = this.killSwitch.status;
    if (halt.engaged && (halt.scope === 'all' || halt.scope === 'external')) {
      return deny('الإيقاف مُشتغل — لا اتصال خارجي');
    }
    if (this.contained) return deny('القناة الخارجية محتواة بعد محاولات غير معلنة');
    if (this.gateway.mode !== 'normal') {
      return deny(`وضع الدولة ${this.gateway.mode} — لا اتصال خارجي`);
    }
    if (!host) return deny('مضيف غير محدد');
    if ((req.protocol ?? 'https') !== 'https') {
      return deny(`بروتوكول غير مصرَّح به: ${req.protocol}`);
    }

    const allowance = this.allowances.get(key);
    if (!allowance) return this.recordUnannounced(entity, host, port);
    if (allowance.expiresAt <= now) {
      this.allowances.delete(key);
      return deny('انتهت مدة إذن الخروج — لا تمديد ضمني');
    }

    // سقف النداءات في الدقيقة لكل كيان
    const rateKey = `${entity}|${key}`;
    const window = (this.calls.get(rateKey) ?? []).filter((t) => now - t < 60_000);
    if (window.length >= allowance.maxCallsPerMinute) {
      this.calls.set(rateKey, window);
      return deny(`تجاوز سقف النداءات (${allowance.maxCallsPerMinute}/دقيقة)`);
    }

    // حصة الخروج من سجل الموارد — بالتهيئة الافتراضية سقفها صفر فتُرفض دائمًا
    let leaseId: string | null = null;
    if (this.options.resources) {
      const lease = this.options.resources.lease(entity, 'egress_calls', 1, now);
      if (!lease.granted) return deny(`حصة الخروج غير متاحة: ${lease.reason}`);
      leaseId = lease.lease.leaseId;
      this.options.resources.release(leaseId);
    }

    window.push(now);
    this.calls.set(rateKey, window);
    this.allowedCalls += 1;
    const entry = this.audit.append(entity, 'egress_allowed', {
      host, port, purpose: allowance.purpose, declaredBy: allowance.declaredBy, leaseId,
    });
    return { allowed: true, reason: 'خروج معلن داخل الإذن والسقف', auditId: entry.hash };
  }

  /** محاولة إلى مضيف غير معلن: تُسجَّل كحادث، وتكرارها يُحتوى ويُصعَّد */
  private recordUnannounced(entity: EntityId, host: string, port: number): Decision {
    const count = (this.unannounced.get(host) ?? 0) + 1;
    this.unannounced.set(host, count);
    this.deniedCalls += 1;
    const entry = this.audit.append(entity, 'unannounced_egress_attempt', {
      host, port, attempt: count, policy: 'deny_by_default',
    });
    if (count >= this.containAfter && !this.contained) {
      this.contained = true;
      this.killSwitch.engage(this.ministryId, 'external', `محاولات خروج غير معلنة إلى ${host}`);
      this.audit.append(this.ministryId, 'escalated_to_king', {
        incident: 'unannounced_egress', host, attempts: count,
      });
    }
    return { allowed: false, reason: 'مضيف غير معلن — الرفض هو الافتراض', auditId: entry.hash };
  }

  get isContained(): boolean {
    return this.contained;
  }

  report(): EgressReport {
    return {
      allowedCalls: this.allowedCalls,
      deniedCalls: this.deniedCalls,
      unannouncedHosts: [...this.unannounced.keys()],
      allowances: [...this.allowances.values()],
      contained: this.contained,
    };
  }
}
