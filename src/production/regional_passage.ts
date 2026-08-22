/**
 * src/production/regional_passage.ts — مرور التاج على الفعل الإقليمي (المرحلة 37)
 * المالك: الديوان الملكي يستأذن، وبوابة التاج تعتمد، وديوان التدقيق يقيس (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أوامر ملكية موقّعة تمرّ ببوابة التاج، وطلبات أفعال من حكّام الأقاليم
 * المخرجات: أذون مرور تُستهلك مرة واحدة، ومحاولات تجاوز مرفوضة **ومقيَّدة**
 * التبعيات: CrownGateway, AppendOnlyLog, ProductionConfig
 * الصلاحيات: منح الإذن ومنع الفعل بلا إذن؛ ولا تُنفّذ الوحدة فعلًا إقليميًّا بنفسها
 * السجلات: region_passage_opened / _closed / region_passage_granted /
 *           region_passage_refused / region_action_passed / region_action_bypass_blocked
 * ثوابت هذه الوحدة:
 *   1) **الإذن قرارُ بوابة لا علمُ وحدة**: لا يُمنح إذنٌ إلا بأمر ملكي موقّع اعتمدته
 *      `CrownGateway.authorize` — فلو صار المنح داخليًّا لصارت الوحدة تُشرّع لنفسها
 *      (RULE-003 و RULE-005)
 *   2) **الإذن مطابقٌ لا عامّ**: يُقيَّد بالإقليم والنطاق والفعل بعينه؛ إذنٌ عامّ
 *      تفويضٌ دائم بأمر واحد، وهو نقض «لا فعل إقليمي بلا قرار»
 *   3) **الإذن يُستهلك مرة ويشيخ**: استعمالٌ ثانٍ أو بعد المدة تجاوزٌ يُرفض
 *   4) **التجاوز يُقيَّد لا يُصمت عليه**: المنع بلا سجل لا يُثبت إنفاذًا — ودفتر
 *      التشغيل يشترط دليل رفضٍ حقيقيًّا (min_bypass_proof)
 *   5) **الباب المغلق لا يغيّر ما قبله**: خارج تشغيل اتحادي معلن يبقى الفعل الإداري
 *      كما أعلنته المرحلة 24 — الوحدة غير المفتوحة لا تُقيّد شيئًا (كما نطاق التشغيل)
 * حالات الفشل (كلها مغلقة): فتحٌ من غير مشغّل ⇒ رفض؛ فتحٌ مكرَّر ⇒ رفض؛ منحٌ بأمر
 *   غير معتمد ⇒ رفض؛ إذن منتهٍ/مستهلك ⇒ منع مقيَّد؛ فعل بلا إذن ⇒ منع مقيَّد
 * اختبار القبول: tests/production/regional_passage.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { ProductionConfig, PRODUCTION_OPERATORS } from '../kernel/config';

/** ما يُستأذن له: الإقليم والنطاق والفعل. لا إذن أوسع من فعلٍ واحد (ثابت 2). */
export interface PassageRequest {
  readonly regionId: EntityId;
  readonly domain: string;
  readonly action: string;
}

export interface PassageResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly auditId: string;
}

export interface PassageDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly auditId: string;
}

export interface BypassAttempt {
  readonly governor: EntityId;
  readonly regionId: EntityId;
  readonly domain: string;
  readonly action: string;
  readonly reason: string;
  readonly at: number;
  readonly auditId: string;
}

export interface RegionalPassageDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly policy: ProductionConfig['policy'];
}

interface PassageToken {
  readonly commandId: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
  used: boolean;
}

/** مفتاح المطابقة: الإقليم والنطاق والفعل معًا (ثابت 2) */
function keyOf(request: PassageRequest): string {
  return `${request.regionId}|${request.domain}|${request.action.trim()}`;
}

export class RegionalPassage {
  private openedBy: EntityId | null = null;
  private readonly windows: { from: number; to: number | null }[] = [];
  private readonly tokens = new Map<string, PassageToken>();
  private readonly bypasses: BypassAttempt[] = [];
  private passedCount = 0;

  constructor(private readonly deps: RegionalPassageDeps) {}

  get active(): boolean { return this.openedBy !== null; }

  get operator(): EntityId | null { return this.openedBy; }

  /** ثابت 5: خارج نافذة مفتوحة لا حكم — فلا يُقاس فعلٌ وقع قبل الفتح */
  wasOpenAt(at: number): boolean {
    return this.windows.some((w) => at >= w.from && (w.to === null || at <= w.to));
  }

  open(by: EntityId, reason: string, now = Date.now()): PassageResult {
    const refuse = (why: string): PassageResult => {
      const entry = this.deps.audit.append(by, 'region_passage_refused', { mode: 'open', reason: why });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (!PRODUCTION_OPERATORS.includes(by)) return refuse('جهة غير مشغّلة لا تفتح مرور التاج (RULE-004)');
    if (reason.trim().length < 3) return refuse('لا فتح بلا سبب معلن (RULE-006)');
    if (this.openedBy) return refuse('مرور التاج مفتوح سابقًا — فتحٌ ثانٍ يُخفي فاتحًا قائمًا');
    this.openedBy = by;
    this.windows.push({ from: now, to: null });
    const entry = this.deps.audit.append(by, 'region_passage_opened', {
      at: now, reason: reason.trim(), ttlMs: this.deps.policy.regions.passage_ttl_ms,
    });
    return { ok: true, reason: 'مرور التاج مفتوح', auditId: entry.hash };
  }

  close(by: EntityId, reason: string, now = Date.now()): PassageResult {
    const refuse = (why: string): PassageResult => {
      const entry = this.deps.audit.append(by, 'region_passage_refused', { mode: 'close', reason: why });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (!this.openedBy) return refuse('لا مرور مفتوح ليُغلق');
    if (by !== this.openedBy && !PRODUCTION_OPERATORS.includes(by)) {
      return refuse('جهة غير مشغّلة لا تغلق مرور التاج');
    }
    if (reason.trim().length < 3) return refuse('لا إغلاق بلا سبب معلن (RULE-006)');
    const open = this.windows[this.windows.length - 1];
    if (open && open.to === null) open.to = now;
    this.openedBy = null;
    const entry = this.deps.audit.append(by, 'region_passage_closed', {
      at: now, reason: reason.trim(), granted: this.tokens.size, passed: this.passedCount,
      blocked: this.bypasses.length,
    });
    return { ok: true, reason: 'مرور التاج مغلق', auditId: entry.hash };
  }

  /**
   * منح إذن مرور لفعل إقليمي واحد. الأمر يمرّ ببوابة التاج فعلًا (ثابت 1): لو
   * رفضت البوابة فلا إذن — ولا تُعيد الوحدة الحكم بعدها.
   */
  grant(command: SignedRoyalCommand, request: PassageRequest, now = Date.now()): PassageResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): PassageResult => {
      const entry = this.deps.audit.append(command?.payload?.issuedBy ?? 'unknown', 'region_passage_refused', {
        mode: 'grant', regionId: request.regionId, domain: request.domain,
        action: request.action, reason: why, ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (!this.openedBy) return refuse('لا يُمنح إذن مرور خارج تشغيل اتحادي مفتوح');
    if (request.action.trim().length < 3) return refuse('لا إذن لفعل بلا وصف معلن');
    const payload = command?.payload;
    if (!payload) return refuse('لا إذن بلا أمر ملكي موقّع');
    if (payload.action !== 'approve_phase') {
      return refuse('إذن المرور اعتمادٌ لا أمرٌ آخر — فعل الأمر يجب أن يكون approve_phase', {
        attempted: payload.action,
      });
    }
    if (payload.target !== request.regionId) {
      return refuse('هدف الأمر ليس الإقليم المطلوب — إذنٌ لغير موضعه (ثابت 2)', {
        target: payload.target,
      });
    }
    const params = (payload.params ?? {}) as Record<string, unknown>;
    if (params.domain !== request.domain || String(params.action ?? '') !== request.action.trim()) {
      return refuse('وسائط الأمر لا تطابق الفعل المطلوب — لا إذن عامّ (ثابت 2)', {
        declaredDomain: params.domain, declaredAction: params.action,
      });
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`بوابة التاج لم تعتمد: ${decision.reason ?? 'غير محدد'}`);

    const key = keyOf(request);
    const existing = this.tokens.get(key);
    if (existing && !existing.used && existing.expiresAt > now) {
      return refuse('إذن قائم لم يُستهلك — لا تكديس أذون لفعل واحد');
    }
    this.tokens.set(key, {
      commandId: payload.commandId,
      grantedAt: now,
      expiresAt: now + this.deps.policy.regions.passage_ttl_ms,
      used: false,
    });
    const entry = this.deps.audit.append(payload.issuedBy, 'region_passage_granted', {
      regionId: request.regionId, domain: request.domain, action: request.action.trim(),
      commandId: payload.commandId, at: now,
      expiresAt: now + this.deps.policy.regions.passage_ttl_ms,
    });
    return { ok: true, reason: 'إذن مرور ممنوح', auditId: entry.hash };
  }

  /**
   * تُنادى من سجل الحكّام قبل تنفيذ الفعل. تستهلك الإذن أو تمنع وتُقيّد (ثوابت 3 و4).
   */
  check(governor: EntityId, request: PassageRequest, now = Date.now()): PassageDecision {
    const block = (why: string): PassageDecision => {
      const entry = this.deps.audit.append(governor, 'region_action_bypass_blocked', {
        regionId: request.regionId, domain: request.domain, action: request.action,
        reason: why, at: now,
      });
      this.bypasses.push({
        governor, regionId: request.regionId, domain: request.domain,
        action: request.action, reason: why, at: now, auditId: entry.hash,
      });
      return { allowed: false, reason: why, auditId: entry.hash };
    };
    const token = this.tokens.get(keyOf(request));
    if (!token) return block('فعل إقليمي بلا إذن مرور من التاج');
    if (token.used) return block('إذن المرور مستهلك — لا استعمال ثانٍ (ثابت 3)');
    if (token.expiresAt <= now) return block('إذن المرور منتهٍ — لا إذن دائم (ثابت 3)');
    token.used = true;
    this.passedCount += 1;
    const entry = this.deps.audit.append(governor, 'region_action_passed', {
      regionId: request.regionId, domain: request.domain, action: request.action.trim(),
      commandId: token.commandId, at: now,
    });
    return { allowed: true, reason: 'إذن مرور مستوفى', auditId: entry.hash };
  }

  blockedAttempts(): readonly BypassAttempt[] { return [...this.bypasses]; }

  report(): {
    readonly granted: number; readonly passed: number; readonly blocked: number;
    readonly active: boolean; readonly windows: number;
  } {
    return {
      granted: this.tokens.size, passed: this.passedCount, blocked: this.bypasses.length,
      active: this.active, windows: this.windows.length,
    };
  }
}
