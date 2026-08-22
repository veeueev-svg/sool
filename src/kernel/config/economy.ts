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
import { loadYamlFile } from './yaml';

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
  budget: { fiscal_period_days: number; carryover: string; ceiling_total: number };
  revenue: {
    retroactive: string;
    rates: { base: string; rate_per_mille: number; declared_at: string }[];
  };
}

/**
 * يحمّل تهيئة الاقتصاد ويرفض أي إعلان يخالف الثوابت المالية أو تنبيه النطاق.
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

  const revenue = raw.revenue;
  if (!revenue || !Array.isArray(revenue.rates) || revenue.rates.length === 0) {
    throw new SovereignViolation('لا أوعية رسوم معلنة — لا رسم بلا نصّ', 'CONFIG_NO_RATES');
  }
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
    if (!Number.isSafeInteger(rate.rate_per_mille) || rate.rate_per_mille <= 0
      || rate.rate_per_mille > 1000) {
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
