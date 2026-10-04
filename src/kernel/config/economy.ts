/**
 * src/kernel/config/economy.ts — الاقتصاد والخزانة
 * المالك: القيّم على المستودع | المرحلة: 25
 * المدخلات: config/economy.yaml | المخرجات: EconomyConfig
 * حالات الفشل: رقم مالي غير معلن أو حدٌّ متناقض ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { guardDeclaredCount } from './declaration_limits';
import { loadYamlFile } from './yaml';

/**
 * حسابات التأسيس الثلاثة التي يفتحها التركيب: الخزانة وحقّ الإصدار وإيرادات الرسوم
 * (`src/composition/economy.ts`). أقلُّ من هذا العدد سقفًا = إقلاعٌ مستحيل (T-49).
 */
export const SOVEREIGN_ACCOUNTS = 3;

/** تهيئة الاقتصاد والخزانة (المرحلة 25) — كل رقم مالي معلن هنا لا في الكود */
export interface EconomyConfig {
  unit: {
    code: string; name: string; minor_units: number; supply_max: number;
    external_convertibility: string; legal_tender: boolean;
  };
  treasury: {
    account: string; equity_account: string; revenue_account: string;
    overdraft: string; single_disbursement_max: number;
  };
  /** سقفُ عددِ الحسابات المعلن (T-49) — لا سقفُ مبلغ بل سقفُ جدول */
  ledger: { max_accounts: number };
  budget: {
    fiscal_period_days: number; carryover: string; ceiling_total: number;
    /** سقفُ عددِ البنود المسجَّلة المعلن (T-49) */
    max_lines: number;
  };
  revenue: {
    retroactive: string;
    rates: { base: string; rate_per_mille: number; declared_at: string }[];
  };
}

/**
 * حدودُ النسبةِ المعلنةِ من مصدرٍ واحدٍ (T-53): عددٌ صحيحٌ فوق الصفرِ ولا يتجاوزُ الألفَ
 * بالأجزاءِ من الألف. يقرؤه محمّلُ التهيئةِ **والتعديلُ الملكيُّ في التشغيل** معًا —
 * فلا تكونُ لحدٍّ واحدٍ قيمتانِ تسقطُ إحداهما في صمت. (درسُ الجلسةِ 14:
 * «حدّانِ لرقمٍ واحدٍ» ليست حمايةً بل بابٌ يُفتحُ من الجهةِ الأضعف.)
 */
export function isValidRatePerMille(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isSafeInteger(rate) && rate > 0 && rate <= 1000;
}

/** يحمّل تهيئة الاقتصاد ويرفض أي إعلان يخالف الثوابت المالية أو تنبيه النطاق.
 * سببه: المال أخطر ما يُترك لقيم مكتوبة في الكود — والسقوف إن لم تكن معلنة لم تكن ملزمة.
 */
export function loadEconomy(configDir = resolveConfigDir()): EconomyConfig {
  const raw = loadYamlFile(join(configDir, 'economy.yaml')) as unknown as EconomyConfig;
  const unit = raw.unit;
  if (!unit || typeof unit.code !== 'string' || unit.code.trim().length === 0) {
    throw new SovereignViolation('وحدة الحساب غير معلنة', 'CONFIG_NO_UNIT');
  }
  if (!Number.isSafeInteger(unit.minor_units) || unit.minor_units <= 0) {
    throw new SovereignViolation('الوحدات الصغرى غير معلنة أو غير صحيحة', 'CONFIG_UNIT_MINOR');
  }
  if (!Number.isSafeInteger(unit.supply_max) || unit.supply_max <= 0) {
    throw new SovereignViolation('سقف الإصدار غير معلن — لا اقتصاد بلا سقف', 'CONFIG_NO_SUPPLY_MAX');
  }
  // تنبيه النطاق مُلزم في الكود لا في README وحده: الوحدة محاسبية داخلية لا مال
  if (unit.external_convertibility !== 'forbidden') {
    throw new SovereignViolation(
      'التحويل الخارجي للوحدة ممنوع — وحدة محاسبية داخلية لا تدّعي قيمة نقدية',
      'CONFIG_UNIT_CONVERTIBLE',
    );
  }
  if (unit.legal_tender !== false) {
    throw new SovereignViolation('الوحدة ليست عملة قانونية بحال', 'CONFIG_UNIT_LEGAL_TENDER');
  }

  const treasury = raw.treasury;
  if (!treasury || !treasury.account || !treasury.equity_account || !treasury.revenue_account) {
    throw new SovereignViolation('حسابات الخزانة غير معلنة', 'CONFIG_NO_TREASURY_ACCOUNTS');
  }
  if (treasury.overdraft !== 'forbidden') {
    throw new SovereignViolation(
      'السحب على المكشوف ممنوع — الخزانة لا تصرف ما لا تملك', 'CONFIG_OVERDRAFT_ALLOWED',
    );
  }
  if (!Number.isSafeInteger(treasury.single_disbursement_max) || treasury.single_disbursement_max <= 0) {
    throw new SovereignViolation('حدّ الصرف الواحد غير معلن', 'CONFIG_NO_DISBURSEMENT_MAX');
  }

  // T-49: سقوفُ العدد المعلنة. السقفُ المالي يحدّ المال ولا يحدّ عددَ الصفوف،
  // فدفترٌ بمليون حساب مجموعُه صفر يمرّ من كل السقوف المالية ولا يُدقّقه أحد.
  const ledgerCaps = raw.ledger;
  if (!ledgerCaps || !Number.isSafeInteger(ledgerCaps.max_accounts)
    || ledgerCaps.max_accounts <= 0) {
    throw new SovereignViolation(
      'سقف عدد الحسابات غير معلن — دفتر بعدد حسابات غير محدود غير قابل للتدقيق',
      'CONFIG_NO_MAX_ACCOUNTS',
    );
  }
  // حسابات التأسيس ثلاثة تُفتح في التركيب: سقفٌ أقلّ منها يجعل الإقلاع مستحيلًا،
  // وإعلانٌ يستحيل معه الإقلاع يُرفض عند الحمل لا عند أول حساب مرفوض.
  if (ledgerCaps.max_accounts < SOVEREIGN_ACCOUNTS) {
    throw new SovereignViolation(
      `سقف عدد الحسابات (${ledgerCaps.max_accounts}) أقلّ من حسابات التأسيس `
      + `الثلاثة (${SOVEREIGN_ACCOUNTS}) — إعلانٌ يستحيل معه الإقلاع`,
      'CONFIG_MAX_ACCOUNTS_BELOW_FOUNDING',
    );
  }

  const budget = raw.budget;
  if (!budget || !Number.isSafeInteger(budget.ceiling_total) || budget.ceiling_total <= 0) {
    throw new SovereignViolation('السقف الكلي للموازنة غير معلن', 'CONFIG_NO_CEILING_TOTAL');
  }
  if (budget.ceiling_total > unit.supply_max) {
    throw new SovereignViolation(
      'سقف الموازنة يتجاوز سقف الإصدار — موازنة لا يمكن تمويلها', 'CONFIG_CEILING_OVER_SUPPLY',
    );
  }
  if (budget.carryover !== 'forbidden') {
    throw new SovereignViolation(
      'ترحيل الموازنة ممنوع — ما لم يُصرف يسقط ويُسجَّل', 'CONFIG_CARRYOVER_ALLOWED',
    );
  }
  if (!Number.isSafeInteger(budget.fiscal_period_days) || budget.fiscal_period_days <= 0) {
    throw new SovereignViolation('مدة الفترة المالية غير معلنة', 'CONFIG_NO_FISCAL_PERIOD');
  }
  if (!Number.isSafeInteger(budget.max_lines) || budget.max_lines <= 0) {
    throw new SovereignViolation(
      'سقف عدد بنود الموازنة غير معلن — جدولٌ بلا حدّ عددٍ لا يُدقّق',
      'CONFIG_NO_MAX_LINES',
    );
  }

  const revenue = raw.revenue;
  if (!revenue || !Array.isArray(revenue.rates) || revenue.rates.length === 0) {
    throw new SovereignViolation('لا أوعية رسوم معلنة — لا رسم بلا نصّ', 'CONFIG_NO_RATES');
  }
  guardDeclaredCount('revenue_rates', revenue.rates.length, 'أوعيةُ الرسوم المعلنة');
  if (revenue.retroactive !== 'forbidden') {
    throw new SovereignViolation(
      'الأثر الرجعي للرسوم ممنوع — نظير عدم رجعية القوانين', 'CONFIG_RETROACTIVE_ALLOWED',
    );
  }
  const bases = new Set<string>();
  for (const rate of revenue.rates) {
    if (typeof rate.base !== 'string' || rate.base.trim().length === 0) {
      throw new SovereignViolation('وعاء رسم بلا اسم', 'CONFIG_RATE_NO_BASE');
    }
    if (bases.has(rate.base)) {
      throw new SovereignViolation(`وعاء مكرَّر: ${rate.base}`, 'CONFIG_RATE_DUPLICATE');
    }
    bases.add(rate.base);
    if (!isValidRatePerMille(rate.rate_per_mille)) {
      throw new SovereignViolation(
        `نسبة غير صالحة (تُحسب بالأجزاء من الألف): ${rate.base}`, 'CONFIG_RATE_RANGE',
      );
    }
    if (typeof rate.declared_at !== 'string' || Number.isNaN(Date.parse(rate.declared_at))) {
      throw new SovereignViolation(
        `تاريخ إعلان النسبة غير صالح: ${rate.base} — ولا رسم بلا تاريخ إعلان`,
        'CONFIG_RATE_NO_DATE',
      );
    }
  }
  return raw;
}
