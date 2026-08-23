/**
 * src/economy/ledger.ts — الدفتر المزدوج: لا قيد إلا متوازنًا (المرحلة 25)
 * المالك: وزارة المالية — والدفتر حجّة عليها لا لها
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: قيد بطرفين أو أكثر، كل مبلغ عدد صحيح بالوحدات الصغرى
 * المخرجات: قيد مُثبَت في دفتر لا يُمحى، أو رفض بسبب موثّق
 * التبعيات: السجل غير القابل للمحو (كل قيد له أثر تدقيق)
 * الصلاحيات: فتح الحساب وإثبات القيد لوزارة المالية، والإغلاق لا رجعة فيه
 * السجلات: account_opened / entry_posted / entry_refused / entry_reversed / period_closed
 * ثوابت هذه الوحدة:
 *   1) **لا قيد إلا متوازنًا**: مجموع المدين = مجموع الدائن في كل قيد، وإلا رُفض
 *   2) **لا كسور عائمة في المال**: كل مبلغ عدد صحيح موجب بالوحدات الصغرى —
 *      الفاصلة العائمة تُنتج فروقًا لا يفسّرها أحد، والمال لا يحتمل «تقريبًا»
 *   3) **لا محو ولا تعديل**: القيد المُثبَت يبقى، والتصحيح بقيدٍ معاكس مُعلن
 *   4) لا قيد على حساب غير مفتوح، ولا حساب يُفتح مرتين
 *   5) **الدفتر المغلق لا يُعاد فتحه**: القيد في فترة مغلقة مرفوض،
 *      والتصحيح يقع في الفترة المفتوحة بقيد معاكس
 *   6) لا قيد بلا بيان (memo): مبلغ بلا سبب معلن مرفوض (RULE-006)
 *   7) الميزان الكلي ثابت: بعد أي عدد من القيود يبقى مجموع المدين = مجموع الدائن
 *   8) **القيدُ يُدوّن لحظةَ إثباته لا عند لقطة** (المرحلة 39 — T-122): إن رُبط وسيطٌ
 *      دائم، دُوّن كلُّ ما يُغيّر الدفتر (فتحُ حساب، قيدٌ، إغلاقُ فترة) قيدًا دائمًا
 *      قبل أن تعود الدالّة. والرفضُ لا يُدوّن هنا: شاهدُه قيدُ التدقيق وهو مُدوَّن أصلًا.
 * حالات الفشل (كلها مغلقة): قيد غير متوازن ⇒ رفض؛ مبلغ كسري أو سالب أو صفر ⇒ رفض؛
 *   حساب غير مفتوح ⇒ رفض؛ فترة مغلقة ⇒ رفض؛ معرّف قيد مكرَّر ⇒ رفض
 * اختبار القبول: tests/economy/economy_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0009-economy-and-treasury.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import type { DurableSink } from '../data/persistence';

/** وزارة المالية: الجهة الوحيدة التي تفتح حسابًا وتُثبت قيدًا */
export const FINANCE_MINISTRY: EntityId = 'ministry:finance';

/** أنواع الحسابات — الأصول والمصروف مدينة بطبعها، والبقية دائنة */
export type AccountKind = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export const DEBIT_NATURED: readonly AccountKind[] = ['asset', 'expense'];

export interface Account {
  readonly accountId: string;
  readonly kind: AccountKind;
  readonly name: string;
  readonly openedAt: number;
}

/** طرف واحد من القيد: مدين أو دائن، لا الاثنين ولا لا شيء */
export interface EntryLine {
  readonly account: string;
  readonly debit?: number;
  readonly credit?: number;
}

export interface EntryInput {
  readonly entryId: string;
  readonly memo: string;
  readonly lines: readonly EntryLine[];
  readonly by: EntityId;
}

export interface LedgerEntry {
  readonly entryId: string;
  readonly memo: string;
  readonly lines: readonly EntryLine[];
  readonly by: EntityId;
  readonly at: number;
  readonly total: number;
  /** معرّف القيد الذي يعكسه هذا القيد — إن كان تصحيحًا */
  readonly reverses: string | null;
  readonly auditId: string;
}

export type LedgerResult =
  | { readonly ok: true; readonly entry: LedgerEntry; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface TrialBalance {
  readonly debits: number;
  readonly credits: number;
  readonly balanced: boolean;
  readonly accounts: number;
  readonly entries: number;
}

export interface LedgerDeps {
  readonly audit: AppendOnlyLog;
  readonly actorId?: EntityId;
  /** وسيطُ الثبات (T-122) — اختياريٌّ في الإنشاء، ويُربط بعد الإرجاع لا قبله */
  readonly journal?: DurableSink;
}

/** ما يُدوّن عن الدفتر (T-122): حدثٌ من ثلاثة، ولا رابعَ يُغيّر حالته */
export type LedgerJournalRecord =
  | { readonly op: 'account_opened'; readonly account: Account }
  | { readonly op: 'entry'; readonly entry: LedgerEntry }
  | { readonly op: 'period_closed'; readonly upTo: number; readonly by: EntityId };

/** لقطةُ استعادةٍ تُبنى من قيود اليوميّة لا من ملفٍ خارجيّ */
export interface LedgerSnapshot {
  readonly accounts: readonly Account[];
  readonly entries: readonly LedgerEntry[];
  readonly closedThrough: number | null;
}

/** مبلغ سليم: عدد صحيح موجب داخل المدى الآمن (ثابت 2) */
export function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly entries: LedgerEntry[] = [];
  private readonly byId = new Map<string, LedgerEntry>();
  private readonly actorId: EntityId;
  /** آخر لحظة مغلقة: لا قيد عندها أو قبلها (ثابت 5) */
  private closedThrough: number | null = null;

  /** وسيطُ الثبات — يُربط بعد الإرجاع فلا تُدوَّن الاستعادةُ نفسها قيودًا مكرّرة (T-122) */
  private sink: DurableSink | null;

  constructor(private readonly deps: LedgerDeps) {
    this.actorId = deps.actorId ?? FINANCE_MINISTRY;
    this.sink = deps.journal ?? null;
  }

  /** ربطُ الوسيط بعد الإقلاع والإرجاع — ترتيبٌ مُلزم كترتيب سجل التدقيق */
  attachJournal(sink: DurableSink): void {
    this.sink = sink;
  }

  /** 1) فتح حساب: مرة واحدة، بنوع معلن واسم معلن (ثابت 4) */
  openAccount(accountId: string, kind: AccountKind, name: string, now = Date.now()): LedgerResult {
    const refuse = (reason: string): LedgerResult => {
      const entry = this.deps.audit.append(this.actorId, 'entry_refused', {
        accountId, reason, mode: 'open_account',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (!accountId.includes(':')) return refuse('معرّف حساب غير صالح: يجب أن يكون <نوع>:<اسم>');
    if (this.accounts.has(accountId)) return refuse('حساب بهذا المعرّف مفتوح — لا يُفتح مرتين');
    if (name.trim().length < 3) return refuse('لا حساب بلا اسم معلن');

    const account: Account = { accountId, kind, name: name.trim(), openedAt: now };
    this.accounts.set(accountId, account);
    const audit = this.deps.audit.append(this.actorId, 'account_opened', {
      accountId, kind, name: account.name,
    });
    const entry: LedgerEntry = {
      entryId: `open:${accountId}`, memo: `فتح حساب ${account.name}`, lines: [],
      by: this.actorId, at: now, total: 0, reverses: null, auditId: audit.hash,
    };
    // ثابت 8: الحسابُ حالةٌ لا حدث — فمن لا يُدوّن فتحَه يرجع بدفترٍ قيودُه بلا حسابات.
    this.sink?.record('ledger_entry', { op: 'account_opened', account }, now);
    return { ok: true, entry, auditId: audit.hash };
  }

  /** 2) إثبات القيد: الفحص الجوهري للمرحلة كلها (ثوابت 1 و2 و4 و5 و6) */
  post(input: EntryInput, now = Date.now()): LedgerResult {
    return this.write(input, null, now);
  }

  /**
   * 3) التصحيح: بقيد معاكس لا بمحو (ثابت 3).
   * القيد الأصلي يبقى في الدفتر، ويظهر معه معاكسه — فيُرى الخطأ وتصحيحه معًا.
   */
  reverse(entryId: string, reason: string, by: EntityId, now = Date.now()): LedgerResult {
    const refuse = (why: string): LedgerResult => {
      const entry = this.deps.audit.append(this.actorId, 'entry_refused', {
        entryId, reason: why, mode: 'reverse',
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const original = this.byId.get(entryId);
    if (!original) return refuse('لا قيد بهذا المعرّف');
    if (original.reverses !== null) return refuse('لا عكس لقيد هو نفسه عكسٌ لغيره');
    if (reason.trim().length < 3) return refuse('لا تصحيح بلا سبب معلن (RULE-006)');
    for (const e of this.entries) {
      if (e.reverses === entryId) return refuse('القيد مُصحَّح سابقًا — لا يُعكس مرتين');
    }
    const mirrored: EntryLine[] = original.lines.map((l) => (
      l.debit !== undefined
        ? { account: l.account, credit: l.debit }
        : { account: l.account, debit: l.credit as number }
    ));
    return this.write(
      { entryId: `rev:${entryId}`, memo: `تصحيح ${entryId}: ${reason.trim()}`, lines: mirrored, by },
      entryId, now,
    );
  }

  /**
   * 4) إغلاق الفترة: لا رجعة فيه (ثابت 5).
   * لا توجد دالة لإعادة الفتح عن قصد: الدفتر الذي يُعاد فتحه ليس دفترًا،
   * ومن أراد تصحيح فترة مغلقة فليقيّد معاكسه في الفترة المفتوحة.
   */
  closePeriod(upTo: number, by: EntityId, now = Date.now()): LedgerResult {
    const refuse = (why: string): LedgerResult => {
      const entry = this.deps.audit.append(this.actorId, 'entry_refused', {
        reason: why, mode: 'close_period', upTo,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (by !== FINANCE_MINISTRY) return refuse('إغلاق الدفتر لوزارة المالية وحدها');
    if (upTo > now) return refuse('لا إغلاق لفترة لم تنتهِ بعد');
    if (this.closedThrough !== null && upTo <= this.closedThrough) {
      return refuse('الفترة مغلقة سابقًا — ولا إعادة فتح (ثابت 5)');
    }
    const balance = this.trialBalance();
    if (!balance.balanced) return refuse('لا إغلاق على دفتر غير متوازن');

    this.closedThrough = upTo;
    const audit = this.deps.audit.append(this.actorId, 'period_closed', {
      upTo, by, debits: balance.debits, credits: balance.credits, entries: balance.entries,
    });
    // الفترةُ المغلقة لا تُعاد فتحًا (ثابت 5)، وإقلاعٌ ينسى إغلاقَها يفتحُها نسيانًا.
    this.sink?.record('ledger_entry', { op: 'period_closed', upTo, by }, now);
    const entry: LedgerEntry = {
      entryId: `close:${upTo}`, memo: 'إغلاق فترة', lines: [], by, at: now,
      total: 0, reverses: null, auditId: audit.hash,
    };
    return { ok: true, entry, auditId: audit.hash };
  }

  /** رصيد الحساب بطبيعته: المدين بطبعه = مدين − دائن، والعكس للبقية */
  balance(accountId: string): number {
    const account = this.accounts.get(accountId);
    if (!account) return 0;
    let debit = 0;
    let credit = 0;
    for (const entry of this.entries) {
      for (const line of entry.lines) {
        if (line.account !== accountId) continue;
        debit += line.debit ?? 0;
        credit += line.credit ?? 0;
      }
    }
    return DEBIT_NATURED.includes(account.kind) ? debit - credit : credit - debit;
  }

  /** الميزان الكلي — الثابت 7: يجب أن يبقى متوازنًا دائمًا */
  trialBalance(): TrialBalance {
    let debits = 0;
    let credits = 0;
    for (const entry of this.entries) {
      for (const line of entry.lines) {
        debits += line.debit ?? 0;
        credits += line.credit ?? 0;
      }
    }
    return {
      debits, credits, balanced: debits === credits,
      accounts: this.accounts.size, entries: this.entries.length,
    };
  }

  hasAccount(accountId: string): boolean { return this.accounts.has(accountId); }
  account(accountId: string): Account | null { return this.accounts.get(accountId) ?? null; }
  entry(entryId: string): LedgerEntry | null { return this.byId.get(entryId) ?? null; }
  journal(): readonly LedgerEntry[] { return [...this.entries]; }
  closedAt(): number | null { return this.closedThrough; }

  report(): {
    accounts: number; entries: number; balanced: boolean; debits: number; closedThrough: number | null;
  } {
    const balance = this.trialBalance();
    return {
      accounts: balance.accounts, entries: balance.entries, balanced: balance.balanced,
      debits: balance.debits, closedThrough: this.closedThrough,
    };
  }

  /** جوهر الوحدة: كل قيد يمرّ من هنا، وكل رفض مسجَّل بسببه */
  private write(input: EntryInput, reverses: string | null, now: number): LedgerResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): LedgerResult => {
      const entry = this.deps.audit.append(this.actorId, 'entry_refused', {
        entryId: input.entryId, reason, mode: reverses === null ? 'post' : 'reverse', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (input.entryId.trim().length === 0) return refuse('لا قيد بلا معرّف');
    if (this.byId.has(input.entryId)) return refuse('معرّف قيد مكرَّر — لا إثبات مرتين');
    if (input.memo.trim().length < 3) return refuse('لا قيد بلا بيان معلن (ثابت 6)');
    if (input.lines.length < 2) return refuse('لا قيد بطرف واحد: القيد المزدوج طرفان على الأقل');
    if (this.closedThrough !== null && now <= this.closedThrough) {
      return refuse('الفترة مغلقة: التصحيح بقيد في الفترة المفتوحة (ثابت 5)', {
        closedThrough: this.closedThrough,
      });
    }

    let debits = 0;
    let credits = 0;
    for (const line of input.lines) {
      const hasDebit = line.debit !== undefined;
      const hasCredit = line.credit !== undefined;
      if (hasDebit === hasCredit) {
        return refuse('كل طرف مدين أو دائن — لا الاثنين ولا لا شيء', { account: line.account });
      }
      const amount = hasDebit ? line.debit : line.credit;
      if (!isValidAmount(amount)) {
        return refuse('مبلغ غير سليم: يجب عدد صحيح موجب بالوحدات الصغرى (ثابت 2)', {
          account: line.account, amount,
        });
      }
      if (!this.accounts.has(line.account)) {
        return refuse(`حساب غير مفتوح: ${line.account} (ثابت 4)`, { account: line.account });
      }
      if (hasDebit) debits += amount; else credits += amount;
    }

    if (debits !== credits) {
      return refuse('قيد غير متوازن: المدين لا يساوي الدائن (ثابت 1)', { debits, credits });
    }

    const entry: LedgerEntry = {
      entryId: input.entryId, memo: input.memo.trim(), lines: [...input.lines],
      by: input.by, at: now, total: debits, reverses,
      auditId: '',
    };
    const audit = this.deps.audit.append(this.actorId, reverses === null ? 'entry_posted' : 'entry_reversed', {
      entryId: entry.entryId, memo: entry.memo, total: entry.total, by: entry.by,
      lines: entry.lines.length, ...(reverses !== null ? { reverses } : {}),
    });
    const stored: LedgerEntry = { ...entry, auditId: audit.hash };
    this.entries.push(stored);
    this.byId.set(stored.entryId, stored);
    this.sink?.record('ledger_entry', { op: 'entry', entry: stored }, now);
    return { ok: true, entry: stored, auditId: audit.hash };
  }

  /**
   * استعادةُ الدفتر من اليوميّة (T-122). لا تُدوّن ولا تُنادي `write`: إعادةُ القيود
   * من الباب العاديّ تُنشئ قيودَ تدقيقٍ جديدة لأفعالٍ قديمة — وذلك تزييفٌ لا استعادة.
   * والحساباتُ **تُدمج لا تُستبدل**: حساباتُ الدولة السياديّة تُفتح في التأسيس
   * قبل ربط الوسيط (فلا تُدوّن)، فاستبدالُ الجدول يُسقطُها ويجعل قيودَها بلا حساب.
   * والميزانُ يُفحص بعد الاستعادة: دفترٌ غير متوازن لا يُقلع عليه (ثابت 1 و 7).
   */
  restore(snapshot: LedgerSnapshot, by: EntityId): void {
    for (const account of snapshot.accounts) {
      if (!this.accounts.has(account.accountId)) this.accounts.set(account.accountId, { ...account });
    }
    this.entries.splice(0, this.entries.length);
    this.byId.clear();
    for (const entry of snapshot.entries) {
      const stored: LedgerEntry = { ...entry, lines: [...entry.lines] };
      this.entries.push(stored);
      this.byId.set(stored.entryId, stored);
    }
    this.closedThrough = snapshot.closedThrough;
    const balance = this.trialBalance();
    if (!balance.balanced) throw new Error('RECOVERY_LEDGER_UNBALANCED');
    for (const entry of this.entries) {
      for (const line of entry.lines) {
        if (!this.accounts.has(line.account)) throw new Error('RECOVERY_LEDGER_ACCOUNT_MISSING');
      }
    }
    this.deps.audit.append(by, 'ledger_restored', {
      accounts: this.accounts.size, entries: this.entries.length,
      debits: balance.debits, closedThrough: this.closedThrough,
    });
  }
}
