/**
 * src/audit/append_only_log.ts — السجل غير القابل للمحو (المرحلة 10)
 * المالك: ديوان التدقيق
 * المدخلات: أحداث (فاعل، نوع، تفصيل) | المخرجات: سلسلة تجزئة مترابطة + تحقق سلامة
 * الصلاحيات: الإضافة فقط. لا حذف ولا تعديل — ولا حتى للملك (RULE-006)
 * حالات الفشل: أي تلاعب يُكشف عبر verifyIntegrity() ويُصنَّف حادثًا
 *
 * المرحلة 39 (البند T-27): يقبل السجل وسيطًا دائمًا اختياريًّا (`DurableSink`) يُدوَّن فيه
 * كل قيد لحظةَ إضافته. لا يعرف السجل ملفًا ولا مسارًا — يعرف دالّة تدوين واحدة، فتبقى
 * الوحدة قابلة للاختبار بلا قرص، ويبقى الافتراضي كما كان: بلا وسيط ⇒ سلوكٌ سابق حرفًا بحرف.
 */
import { AuditEntry, EntityId } from '../kernel/types';
import { canonicalize, sha256 } from '../identity/keys';
import type { DurableSink } from '../data/persistence';

export const GENESIS_HASH = '0'.repeat(64);

export interface IntegrityReport {
  readonly valid: boolean;
  readonly length: number;
  readonly brokenAt: number | null;
  readonly reason: string;
}

export class AppendOnlyLog {
  private entries: AuditEntry[] = [];
  private sink: DurableSink | null;
  /** حارسُ الدخول: لا إضافةً أثناء تدوينِ إضافةٍ — فرَدُّ القيدِ لا يفرقعَ إلا قيدَ صاحبه */
  private appending = false;

  constructor(sink?: DurableSink) {
    this.sink = sink ?? null;
  }

  /**
   * يربط وسيطًا دائمًا بعد الإنشاء. الربط لا يُدوّن ما سبق: من أراد يوميّة كاملة
   * يربط عند الإنشاء. وهذا معلن لا مسكوت عنه (RULE-008).
   */
  attachSink(sink: DurableSink): void {
    this.sink = sink;
  }

  /**
   * الإضافة هي العملية الوحيدة المسموحة — **ذرّيّةٌ للذاكرة، مُميِّزةٌ للمجهولِ من القاطعِ (الجلسة 11)**:
   *
   * 1) **لا دخولَ أثناء التدوين** (`APPEND_REENTRANCY_REFUSED`): وسيطٌ يستدعي الإضافةَ من داخلِ `record`
   *    يُرفض قبل أن يُدفَع قيدُه — فرَدُّ القيدِ (`entries.pop()`) لا يفرقعَ إلا قيدَ هذه الإضافةِ حتمًا
   *    لا قيدَ الإضافةِ الداخلةِ عنه (الجلسة 11 · RATE_AMENDMENT_APPEND_ROLLBACK_POPS_WRONG_ENTRY).
   * 2) **رفضُ الوسيطِ المُقيَّدِ null مصمَّمٌ ومُقيسٌ لكنه مسدودٌ لا معالَج** (الجلسة 11 ·
   *    RATE_AMENDMENT_SINK_NULL_ACCEPTED_AS_COMMIT): ردُّ `null` عقدُه «لم يُدوَّن» فقبولُه التزامًا
   *    عيبٌ — وعلاجُه (رميُ AUDIT_SINK_DECLINED_RECORD مع ردِّ القيد) صُمم وقُتلت طفرتُه، لكنّ مسارًا
   *    محجوزًا لبندٍ حيّ (tests/data/rehydrate_roundtrip.test.ts لمالك W-2026-040) يعتمدُ في قياسِه على
   *    ابتلاعِ null صمتًا، فلمسُه ممنوعٌ (WORK_CONTROL §6) — القرارُ للمالك، والتفصيلُ في عقدِ البند.
   * 3) **رميُ الوسيط نتيجةٌ غير معلومة** (`AUDIT_APPEND_OUTCOME_UNKNOWN` وعلةُ الرميِ في cause): الوسيطُ قد
   *    يكونُ دوّنَ ثم رمى — والذاكرةُ تُرَدّ، لكنّ الوسيطَ الدائمَ قد يحملُ القيدَ، والإرجاعُ بعد التشغيلِ
   *    هو الحَكَم. فلا يُعَدّ الرميُ «فشلًا قاطعًا» يكذبُ عليه الاستدعاءُ — بل «مجهولَ النتيجة» قد يلتزمُ عند
   *    الاسترجاع (الجلسة 11 · RATE_AMENDMENT_DURABLE_POSTCOMMIT_THROW_INCONSISTENT_ACK). ومنعُ هذا الانقسامِ
   *    كليًّا يحتاجُ عقدًا للوسيطِ يُخبرُ بحالِه بعد الرمي — ومسارُ العقدِ محجوزٌ لبندٍ آخر فلا يُوسَّع إليه النطاق.
   */
  append(actor: EntityId, kind: string, detail: Record<string, unknown> = {}): AuditEntry {
    if (this.appending) throw new Error('APPEND_REENTRANCY_REFUSED');
    const prev = this.entries[this.entries.length - 1];
    const seq = this.entries.length + 1;
    const at = Date.now();
    const prevHash = prev ? prev.hash : GENESIS_HASH;
    const hash = sha256(canonicalize({ seq, at, actor, kind, detail, prevHash }));
    const entry: AuditEntry = Object.freeze({ seq, at, actor, kind, detail, prevHash, hash });
    this.entries.push(entry);
    this.appending = true;
    try {
      this.sink?.record('audit_entry', entry, at);
    } catch (err) {
      this.rollback(entry);
      throw new Error('AUDIT_APPEND_OUTCOME_UNKNOWN', { cause: err });
    } finally {
      this.appending = false;
    }
    return entry;
  }

  /** ردُّ قيدٍ واحدٍ بتحقّقِ هُويّتِه: آخرُ القيودِ هو قيدُنا وإلا فالفشلُ فادحٌ لا يُصلحُه التخمين */
  private rollback(entry: AuditEntry): void {
    if (this.entries[this.entries.length - 1] !== entry) {
      throw new Error('AUDIT_ROLLBACK_IDENTITY_LOST');
    }
    this.entries.pop();
  }

  /** نسخة للقراءة فقط — لا يُعطى المستدعي مرجعًا قابلًا للتعديل */
  snapshot(): readonly AuditEntry[] {
    return this.entries.map((e) => Object.freeze({ ...e }));
  }

  get length(): number {
    return this.entries.length;
  }

  find(kind: string): readonly AuditEntry[] {
    return this.entries.filter((e) => e.kind === kind);
  }

  /** يعيد حساب السلسلة كاملة ويكشف أي تعديل أو حذف أو إعادة ترتيب */
  verifyIntegrity(): IntegrityReport {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.seq !== i + 1) {
        return { valid: false, length: this.entries.length, brokenAt: i + 1, reason: 'تسلسل مفقود أو معاد ترتيبه' };
      }
      if (e.prevHash !== prevHash) {
        return { valid: false, length: this.entries.length, brokenAt: e.seq, reason: 'انقطاع سلسلة التجزئة' };
      }
      const recomputed = sha256(canonicalize({
        seq: e.seq, at: e.at, actor: e.actor, kind: e.kind, detail: e.detail, prevHash: e.prevHash,
      }));
      if (recomputed !== e.hash) {
        return { valid: false, length: this.entries.length, brokenAt: e.seq, reason: 'محتوى السجل مُعدَّل' };
      }
      prevHash = e.hash;
    }
    return { valid: true, length: this.entries.length, brokenAt: null, reason: 'سلسلة سليمة' };
  }

  /** تصدير للنسخ الاحتياطي (المرحلة 32) */
  export(): string {
    return JSON.stringify(this.entries);
  }

  /** استيراد نسخة مع تحقق فوري: نسخة فاسدة تُرفض ولا تُحمَّل */
  static import(serialized: string): AppendOnlyLog {
    const log = new AppendOnlyLog();
    log.entries = JSON.parse(serialized) as AuditEntry[];
    const report = log.verifyIntegrity();
    if (!report.valid) throw new Error(`نسخة سجل فاسدة: ${report.reason} عند ${report.brokenAt}`);
    return log;
  }

  /**
   * يستبدل محتوى السجل بنسخة سبق التحقق منها. لا يستورد المسار الاستعادةُ بنفسه:
   * الأرشيف الملكي وحده يستدعيه داخل تبديلٍ ذري في المرحلة 32.
   */
  replaceFrom(serialized: string): void {
    const restored = AppendOnlyLog.import(serialized);
    this.entries = restored.snapshot().map((entry) => Object.freeze({ ...entry }));
  }

  /** حقن سجل خام — للاختبار السلبي فقط (محاكاة تلاعب) */
  static unsafeFromEntries(entries: AuditEntry[]): AppendOnlyLog {
    const log = new AppendOnlyLog();
    log.entries = entries;
    return log;
  }
}
