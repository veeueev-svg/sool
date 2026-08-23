/**
 * src/external/account_registry.ts — سجل الحسابات الخارجية (المرحلة 26)
 * المالك: وزارة الخارجية — تحت التاج، وتحت التعليق الفوري لأربع جهات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: نظير خارجي معلن في config/external.yaml + أمر ملكي بفعل open_external_account
 * المخرجات: حساب خارجي معلن، مؤقَّت، محدود السقف، قابل للتعليق فورًا — أو رفض بسبب موثّق
 * التبعيات: بوابة التاج، الدفتر المزدوج (حساب مقابل لكل نظير)، حارس الخروج الشبكي
 * الصلاحيات: الفتح ملكي؛ التعليق لأربع جهات معلنة بلا أمر؛ الاستئناف ملكي وبغير من علّق
 * السجلات: external_account_opened / external_account_refused / external_account_suspended /
 *           external_account_resumed / external_account_closed / external_accounts_suspended_all
 * ثوابت هذه الوحدة:
 *   1) **لا حساب لغير نظير معلن** في التهيئة: الفتح لا يُنشئ نظيرًا (RULE-005)
 *   2) **لا حساب دائم**: لكل حساب مدة تنتهي، ولا تمديد ضمني — والمنتهي ليس قائمًا
 *   3) **السقوف من الإعلان لا من الطلب**: لا يختار طالبُ الفتح سقفه، ولا يرفعه بأمر فتح
 *   4) **التعليق فوري وبلا أمر ملكي**: الحماية تُنزَل بثمن رخيص وتُرفع بثمن غالٍ —
 *      والاستئناف بأمر ملكي، **ولا يرفع التعليقَ من أنزله** (RULE-004)
 *   5) **لا قناة مال بلا قناة شبكة معلنة**: لا يُفتح حساب لمضيف لا إذن خروج له
 *   6) **فتح حساب خارجي لا يجعل الوحدة قابلة للتحويل**: تنبيه النطاق مُلزم في الكود
 *   7) **لا إغلاق على التزام غير مُثبَت**: الحساب لا يُغلق وله دفعة لم يُقرّ استلامها
 *   8) **لا سجل مال موازٍ**: ما دُفع لنظير يُقرأ من الدفتر لا من عدّاد في هذا السجل
 * حالات الفشل (كلها مغلقة): نظير غير معلن ⇒ رفض؛ مدة غائبة أو تفوق الحدّ ⇒ رفض؛
 *   حساب مكرَّر ⇒ رفض؛ مضيف بلا إذن خروج ⇒ رفض؛ تعليق من غير مُخوَّل ⇒ رفض؛
 *   استئناف بغير أمر ملكي أو من المعلِّق نفسه ⇒ رفض؛ إغلاق على التزام معلَّق ⇒ رفض
 * اختبار القبول: tests/external/external_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0010-external-accounts.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { Ledger } from '../economy/ledger';
export * from './account_types';
import {
  AccountResult, DeclaredCounterparty, EgressProbe, ExternalAccount, ObligationProbe,
  OpenAccountInput,
} from './account_types';
import type { DurableSink } from '../data/persistence';
import { AccountReport, accountInactiveReason, buildAccountReport, isAccountActive } from './account_view';

/** وزارة الخارجية: صاحبة الاختصاص في النوافذ الخارجية — تطلب ولا تدفع */
export const FOREIGN_MINISTRY: EntityId = 'ministry:foreign_affairs';

export interface AccountRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly ledger: Ledger;
  readonly counterparties: readonly DeclaredCounterparty[];
  /** أقصى مدة لأي حساب — معلنة في config/external.yaml (ثابت 2) */
  readonly maxTermMs: number;
  /** من يملك التعليق الفوري — معلنون في التهيئة (ثابت 4) */
  readonly suspendAuthorities: readonly EntityId[];
  /** تنبيه النطاق: قابلية تحويل الوحدة — قيمتها الملزمة: لا (ثابت 6) */
  readonly unitConvertible: boolean;
  readonly ministryId?: EntityId;
}

export class ExternalAccountRegistry {
  private readonly accounts = new Map<string, ExternalAccount>();
  private sink: DurableSink | null = null;
  private readonly declared = new Map<string, DeclaredCounterparty>();
  private readonly ministryId: EntityId;
  private egressProbe: EgressProbe | null = null;
  private obligationProbe: ObligationProbe | null = null;

  constructor(private readonly deps: AccountRegistryDeps) {
    this.ministryId = deps.ministryId ?? FOREIGN_MINISTRY;
    for (const cp of deps.counterparties) this.declared.set(cp.id, cp);
  }

  /** ربط مصدر التحقق من قناة الشبكة (ثابت 5). قبل ربطه: كل فتح مرفوض — لا افتراض سماح */
  bindEgressProbe(probe: EgressProbe): void {
    this.egressProbe = probe;
    this.deps.audit.append(this.ministryId, 'external_egress_probe_bound', {
      note: 'لا حساب خارجي بلا قناة شبكة معلنة',
    });
  }

  /** ربط مصدر التحقق من الالتزامات غير المُثبَتة (ثابت 7) */
  bindObligationProbe(probe: ObligationProbe): void {
    this.obligationProbe = probe;
  }

  /**
   * 1) فتح حساب خارجي: نظير معلن + أمر ملكي بفعل open_external_account هدفه معرّف النظير.
   * ترتيب الفحوص مقصود: تنبيه النطاق ← نظير معلن ← لا تكرار ← الطالب ← المبرّر ←
   * المدة ← قناة الشبكة ← اعتماد الأمر ← فتح الحساب المقابل في الدفتر.
   */
  open(command: SignedRoyalCommand, input: OpenAccountInput, now = Date.now()): AccountResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): AccountResult => {
      const entry = this.deps.audit.append(this.ministryId, 'external_account_refused', {
        counterparty: input.counterparty, requestedBy: input.requestedBy, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    // ثابت 6: لو سُمح بقابلية التحويل لصار الحساب الخارجي بابًا نقديًّا — يُرفض كل فتح
    if (this.deps.unitConvertible) {
      return refuse('قابلية تحويل الوحدة ممنوعة: لا تُفتح نوافذ خارجية على وحدة تدّعي قيمة');
    }
    const declared = this.declared.get(input.counterparty);
    if (!declared) {
      return refuse('نظير غير معلن في التهيئة — الفتح لا يُنشئ نظيرًا (ثابت 1)');
    }
    if (this.accounts.has(declared.id)) {
      const existing = this.accounts.get(declared.id) as ExternalAccount;
      if (existing.closedAt === null) return refuse('حساب هذا النظير مفتوح سابقًا');
    }
    if (input.requestedBy !== this.ministryId) {
      return refuse('فتح الحسابات الخارجية باقتراح وزارة الخارجية وحدها (RULE-004)');
    }
    if (input.justification.trim().length < 3) {
      return refuse('لا فتح بلا مبرّر معلن (RULE-006)');
    }
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
      return refuse('حساب بلا مدة انتهاء صالحة مرفوض — لا حساب دائم (ثابت 2)');
    }
    if (input.expiresAt - now > this.deps.maxTermMs) {
      return refuse('المدة تتجاوز الحدّ المعلن للحسابات الخارجية (ثابت 2)', {
        maxTermMs: this.deps.maxTermMs, requested: input.expiresAt - now,
      });
    }
    if (!this.egressProbe) {
      return refuse('مصدر التحقق من قناة الشبكة غير مربوط — لا افتراض سماح (ثابت 5)');
    }
    if (!this.egressProbe(declared.host, declared.port, now)) {
      return refuse('لا قناة مال بلا قناة شبكة معلنة غير منتهية (ثابت 5)', {
        host: declared.host, port: declared.port,
      });
    }
    if (command.payload.action !== 'open_external_account') {
      return refuse('الفتح بفعل open_external_account وحده');
    }
    if (command.payload.target !== declared.id) {
      return refuse('هدف الأمر لا يطابق معرّف النظير المعلن');
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const ledgerAccount = `external:ledger:${declared.id.replace('external:', '')}`;
    if (!this.deps.ledger.hasAccount(ledgerAccount)) {
      const opened = this.deps.ledger.openAccount(
        ledgerAccount, 'expense', `مدفوعات ${declared.name}`, now,
      );
      if (!opened.ok) return refuse(`فتح الحساب المقابل في الدفتر مرفوض: ${opened.reason}`);
    }

    const account: ExternalAccount = {
      accountId: declared.id, name: declared.name, host: declared.host, port: declared.port,
      purpose: declared.purpose, ledgerAccount,
      // ثابت 3: السقوف تُنسخ من الإعلان — لا من مدخلات الطالب
      singleMax: declared.singleMax, dailyMax: declared.dailyMax, totalCap: declared.totalCap,
      openedBy: input.requestedBy, openedAt: now, expiresAt: input.expiresAt,
      commandId: command.payload.commandId,
      suspended: false, suspendedBy: null, suspendedReason: null, suspendedAt: null,
      closedAt: null,
    };
    this.accounts.set(declared.id, account);
    this.journalAccount(account);
    const entry = this.deps.audit.append(this.ministryId, 'external_account_opened', {
      accountId: account.accountId, host: account.host, port: account.port,
      ledgerAccount, expiresAt: account.expiresAt,
      caps: { single: account.singleMax, daily: account.dailyMax, total: account.totalCap },
      commandId: account.commandId, unitConvertible: false,
    });
    return { ok: true, account, auditId: entry.hash };
  }

  /**
   * 2) التعليق الفوري (ثابت 4): بلا أمر ملكي، ويقع أثره على أول دفعة بعده.
   * الحماية تُنزَل رخيصةً عن قصد: تأخير التعليق حتى يجتمع التاج ثغرةٌ لا انتظام.
   */
  suspend(by: EntityId, accountId: string, reason: string, now = Date.now()): AccountResult {
    const refuse = (why: string): AccountResult => {
      const entry = this.deps.audit.append(by, 'external_account_refused', {
        mode: 'suspend', accountId, reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const account = this.accounts.get(accountId);
    if (!account) return refuse('حساب غير قائم');
    if (account.closedAt !== null) return refuse('حساب مغلق');
    if (!this.deps.suspendAuthorities.includes(by)) {
      return refuse('التعليق لجهة معلنة في التهيئة وحدها');
    }
    if (reason.trim().length < 3) return refuse('لا تعليق بلا سبب معلن (RULE-006)');
    if (account.suspended) return refuse('حساب معلَّق سابقًا');

    account.suspended = true;
    account.suspendedBy = by;
    account.suspendedReason = reason.trim();
    account.suspendedAt = now;
    this.journalAccount(account);
    const entry = this.deps.audit.append(by, 'external_account_suspended', {
      accountId, reason: account.suspendedReason, at: now, immediate: true,
    });
    return { ok: true, account, auditId: entry.hash };
  }

  /** 3) تعليق كل الحسابات دفعةً واحدة: نافذةٌ واحدة تُغلق النوافذ كلها فورًا */
  suspendAll(by: EntityId, reason: string, now = Date.now()): Decision {
    if (!this.deps.suspendAuthorities.includes(by)) {
      const entry = this.deps.audit.append(by, 'external_account_refused', {
        mode: 'suspend_all', reason: 'جهة غير مخوَّلة بالتعليق',
      });
      return { allowed: false, reason: 'جهة غير مخوَّلة بالتعليق', auditId: entry.hash };
    }
    if (reason.trim().length < 3) {
      const entry = this.deps.audit.append(by, 'external_account_refused', {
        mode: 'suspend_all', reason: 'لا تعليق بلا سبب معلن',
      });
      return { allowed: false, reason: 'لا تعليق بلا سبب معلن', auditId: entry.hash };
    }
    const affected: string[] = [];
    for (const account of this.accounts.values()) {
      if (account.closedAt !== null || account.suspended) continue;
      account.suspended = true;
      account.suspendedBy = by;
      account.suspendedReason = reason.trim();
      account.suspendedAt = now;
      this.journalAccount(account);
      affected.push(account.accountId);
    }
    const entry = this.deps.audit.append(by, 'external_accounts_suspended_all', {
      reason: reason.trim(), affected, count: affected.length, at: now,
    });
    return { allowed: true, reason: `عُلِّق ${affected.length} حسابًا فورًا`, auditId: entry.hash };
  }

  /**
   * 4) الاستئناف (ثابت 4): بأمر ملكي هدفه الحساب، **وبغير من علّقه**.
   * سببه: من علّق قد يكون هو مصدر الخطر أو من يريد إخفاءه.
   */
  resume(
    command: SignedRoyalCommand, accountId: string, by: EntityId,
    reason: string, now = Date.now(),
  ): AccountResult {
    const refuse = (why: string): AccountResult => {
      const entry = this.deps.audit.append(by, 'external_account_refused', {
        mode: 'resume', accountId, reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const account = this.accounts.get(accountId);
    if (!account) return refuse('حساب غير قائم');
    if (account.closedAt !== null) return refuse('حساب مغلق لا يُستأنف');
    if (!account.suspended) return refuse('حساب غير معلَّق');
    if (reason.trim().length < 3) return refuse('لا استئناف بلا سبب معلن');
    if (by === account.suspendedBy) {
      return refuse('لا يرفع التعليقَ من أنزله (RULE-004)');
    }
    if (command.payload.action !== 'open_external_account') {
      return refuse('الاستئناف بفعل open_external_account وحده');
    }
    if (command.payload.target !== accountId) {
      return refuse('هدف الأمر لا يطابق الحساب المعلَّق');
    }
    if (account.expiresAt <= now) {
      return refuse('حساب منتهي المدة لا يُستأنف — لا تمديد ضمني (ثابت 2)');
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const previousBy = account.suspendedBy;
    const previousReason = account.suspendedReason;
    account.suspended = false;
    account.suspendedBy = null;
    account.suspendedReason = null;
    account.suspendedAt = null;
    this.journalAccount(account);
    const entry = this.deps.audit.append(by, 'external_account_resumed', {
      accountId, reason: reason.trim(), previousBy, previousReason,
      commandId: command.payload.commandId,
    });
    return { ok: true, account, auditId: entry.hash };
  }

  /** 5) الإغلاق: بأمر ملكي، ولا يقع على حساب له دفعة لم يُقرّ استلامها (ثابت 7) */
  close(
    command: SignedRoyalCommand, accountId: string, by: EntityId,
    reason: string, now = Date.now(),
  ): AccountResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): AccountResult => {
      const entry = this.deps.audit.append(by, 'external_account_refused', {
        mode: 'close', accountId, reason: why, ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const account = this.accounts.get(accountId);
    if (!account) return refuse('حساب غير قائم');
    if (account.closedAt !== null) return refuse('حساب مغلق سابقًا');
    if (reason.trim().length < 3) return refuse('لا إغلاق بلا سبب معلن');
    if (command.payload.action !== 'open_external_account') {
      return refuse('الإغلاق بفعل open_external_account وحده');
    }
    if (command.payload.target !== accountId) return refuse('هدف الأمر لا يطابق الحساب');
    const pending = this.obligationProbe ? this.obligationProbe(accountId) : 0;
    if (pending > 0) {
      return refuse('لا إغلاق على التزام لم يُثبَت استلامه (ثابت 7)', { pending });
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    account.closedAt = now;
    this.journalAccount(account);
    const entry = this.deps.audit.append(by, 'external_account_closed', {
      accountId, reason: reason.trim(), paidTotal: this.paidTotal(accountId),
      commandId: command.payload.commandId,
    });
    return { ok: true, account, auditId: entry.hash };
  }

  /** الحساب القائم فعلًا: موجود، غير مغلق، غير معلَّق، وغير منتهي المدة (ثوابت 2 و4) */
  isActive(accountId: string, now = Date.now()): boolean {
    return isAccountActive(this.accounts.get(accountId), now);
  }

  /** سبب عدم القيام — يُستعمل في الرفض حتى لا يكون الرفض بلا بيان (RULE-006) */
  inactiveReason(accountId: string, now = Date.now()): string | null {
    return accountInactiveReason(this.accounts.get(accountId), now);
  }

  /** ثابت 8: ما دُفع للنظير يُقرأ من الدفتر — لا عدّاد في هذا السجل يُصدَّق دونه */
  paidTotal(accountId: string): number {
    const account = this.accounts.get(accountId);
    if (!account) return 0;
    return this.deps.ledger.balance(account.ledgerAccount);
  }

  get(accountId: string): ExternalAccount | null {
    return this.accounts.get(accountId) ?? null;
  }
  list(): readonly ExternalAccount[] { return [...this.accounts.values()]; }
  declaredCounterparties(): readonly DeclaredCounterparty[] {
    return [...this.declared.values()];
  }
  active(now = Date.now()): readonly ExternalAccount[] {
    return [...this.accounts.values()].filter((a) => this.isActive(a.accountId, now));
  }

  report(now = Date.now()): AccountReport {
    return buildAccountReport({
      accounts: [...this.accounts.values()], declaredCount: this.declared.size, now,
      paidOf: (account) => this.paidTotal(account.accountId),
      unitConvertible: this.deps.unitConvertible, maxTermMs: this.deps.maxTermMs,
    });
  }

  /** T-125: يُربط بعد الإرجاع لا قبله — وإلا دُوِّن المُستعادُ ثانيةً كلَّ إقلاع */
  attachJournal(sink: DurableSink): void { this.sink = sink; }

  /** كلُّ تغيّرٍ في حالِ حسابٍ يُدوَّن لحظتَه — والحسابُ كائنٌ يُعدَّل، فالتدوينُ بعده (T-125) */
  private journalAccount(account: ExternalAccount): void {
    this.sink?.record('external_account', { account });
  }

  /**
   * بابُ الإرجاع الذرّيّ (T-125): يُثبت حساباتٍ مشهودةً ولا يفتح حسابًا من عنده.
   * ويرفض ما لا نظيرَ له في التهيئة ⇒ RECOVERY_ACCOUNT_UNDECLARED: نظيرٌ يُمحى من
   * `config/foreign.yaml` لا يُعاد إحياؤه بيوميّةٍ قديمة (ثابت 1).
   */
  restore(accounts: readonly ExternalAccount[], by: EntityId): void {
    for (const account of accounts) {
      if (!this.declared.has(account.accountId)) throw new Error('RECOVERY_ACCOUNT_UNDECLARED');
    }
    this.accounts.clear();
    for (const account of accounts) this.accounts.set(account.accountId, { ...account });
    this.deps.audit.append(by, 'external_accounts_restored', {
      accounts: this.accounts.size, active: this.active().length,
    });
  }
}
