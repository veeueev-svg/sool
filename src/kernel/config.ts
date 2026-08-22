/**
 * src/kernel/config.ts — تحميل تهيئة الدولة والتحقق من ثوابتها
 * المالك: القيّم على المستودع | المرحلة: 2
 * المدخلات: ملفات config/*.yaml | المخرجات: كائنات تهيئة مُتحقَّق منها
 * حالات الفشل: ملف ناقص أو ملكان أو مسار جانبي مسموح ⇒ فشل مغلق (fail-closed)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { SovereignViolation } from './types';

/**
 * يحدد مجلد config بالبحث صعودًا من موقع التنفيذ (يعمل من src ومن dist معًا).
 * فشل الإيجاد = فشل مغلق: الدولة لا تعمل بلا تهيئة معلنة (RULE-007).
 */
export function resolveConfigDir(startDir = __dirname): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'config', 'royal-authority.yaml');
    if (existsSync(candidate)) return join(dir, 'config');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new SovereignViolation('مجلد التهيئة غير موجود — فشل مغلق', 'CONFIG_DIR_MISSING');
}

/**
 * محلّل YAML لمجموعة فرعية آمنة ومحدّدة: خرائط متداخلة، قوائم قيم، قوائم خرائط،
 * وخرائط سطرية {a: 1}. لا يدعم المراجع أو الوسوم — بقصد تقليل سطح الخطر.
 */
type YamlLine = { indent: number; text: string };

function scalar(raw: string): unknown {
  const v = raw.trim().replace(/^["']|["']$/g, '');
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function inlineMap(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of raw.slice(1, -1).split(',')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = scalar(part.slice(idx + 1));
  }
  return out;
}

function applyPair(obj: Record<string, unknown>, text: string): void {
  const idx = text.indexOf(':');
  if (idx === -1) return;
  const key = text.slice(0, idx).trim();
  const val = text.slice(idx + 1).trim();
  obj[key] = val.startsWith('{') ? inlineMap(val) : scalar(val);
}

function toLines(text: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    out.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  return out;
}

function parseNode(lines: YamlLine[], start: number, indent: number): [unknown, number] {
  let i = start;
  if (lines[i]!.text.startsWith('- ')) {
    const arr: unknown[] = [];
    while (i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith('- ')) {
      const content = lines[i]!.text.slice(2).trim();
      i += 1;
      if (content.startsWith('{')) {
        arr.push(inlineMap(content));
      } else if (/^[^:]+:/.test(content)) {
        const obj: Record<string, unknown> = {};
        applyPair(obj, content);
        if (i < lines.length && lines[i]!.indent > indent && !lines[i]!.text.startsWith('- ')) {
          const [child, next] = parseNode(lines, i, lines[i]!.indent);
          Object.assign(obj, child as Record<string, unknown>);
          i = next;
        }
        arr.push(obj);
      } else {
        arr.push(scalar(content));
      }
    }
    return [arr, i];
  }

  const obj: Record<string, unknown> = {};
  while (i < lines.length && lines[i]!.indent === indent && !lines[i]!.text.startsWith('- ')) {
    const text = lines[i]!.text;
    const idx = text.indexOf(':');
    if (idx === -1) { i += 1; continue; }
    const key = text.slice(0, idx).trim();
    const val = text.slice(idx + 1).trim();
    i += 1;
    if (val === '') {
      const next = lines[i];
      if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))) {
        const [child, ni] = parseNode(lines, i, next.indent);
        obj[key] = child;
        i = ni;
      } else {
        obj[key] = {};
      }
    } else if (val.startsWith('{')) {
      obj[key] = inlineMap(val);
    } else {
      obj[key] = scalar(val);
    }
  }
  return [obj, i];
}

export function parseSimpleYaml(text: string): Record<string, unknown> {
  const lines = toLines(text);
  if (lines.length === 0) return {};
  const [value] = parseNode(lines, 0, lines[0]!.indent);
  return (value ?? {}) as Record<string, unknown>;
}

export interface RoyalAuthorityConfig {
  state_name: string;
  state_code: string;
  king_count_max: number;
  king_id: string;
  crown_gateway_required: boolean;
  side_channel_allowed: boolean;
  heartbeat_interval_seconds: number;
  absence_grace_seconds: number;
  absence_mode: string;
  sovereign_actions: string[];
  veto_final: boolean;
}

export function loadYamlFile(path: string): Record<string, unknown> {
  return parseSimpleYaml(readFileSync(path, 'utf8'));
}

/** يحمّل سلطة التاج ويرفض أي تهيئة تخالف الثوابت السيادية */
export function loadRoyalAuthority(configDir = resolveConfigDir()): RoyalAuthorityConfig {
  const raw = loadYamlFile(join(configDir, 'royal-authority.yaml')) as unknown as RoyalAuthorityConfig;
  if (!raw.king_id) throw new SovereignViolation('لا يوجد ملك معرّف', 'CONFIG_NO_KING');
  if (raw.king_count_max !== 1) {
    throw new SovereignViolation('لا يجوز أكثر من ملك واحد', 'CONFIG_MULTIPLE_KINGS');
  }
  if (raw.crown_gateway_required !== true) {
    throw new SovereignViolation('بوابة التاج إلزامية', 'CONFIG_GATEWAY_OPTIONAL');
  }
  if (raw.side_channel_allowed !== false) {
    throw new SovereignViolation('المسار الجانبي ممنوع', 'CONFIG_SIDE_CHANNEL');
  }
  if (raw.veto_final !== true) {
    throw new SovereignViolation('النقض الملكي نهائي', 'CONFIG_VETO_NOT_FINAL');
  }
  return raw;
}

/** تهيئة الحصص والموارد (المرحلة 5) */
export interface QuotasConfig {
  resources: Record<string, { total: number; per_agent_max: number; lease_seconds: number }>;
  agents: { population_max: number; spawn_rate_per_minute: number };
}

/** يحمّل الحصص ويرفض أي تهيئة ناقصة أو سالبة — فشل مغلق (RULE-007) */
export function loadQuotas(configDir = resolveConfigDir()): QuotasConfig {
  const raw = loadYamlFile(join(configDir, 'quotas.yaml')) as unknown as QuotasConfig;
  if (!raw.resources || Object.keys(raw.resources).length === 0) {
    throw new SovereignViolation('لا موارد معلنة — لا تشغيل بلا حصص', 'CONFIG_NO_RESOURCES');
  }
  for (const [name, spec] of Object.entries(raw.resources)) {
    if (typeof spec.total !== 'number' || typeof spec.per_agent_max !== 'number'
      || typeof spec.lease_seconds !== 'number') {
      throw new SovereignViolation(`تهيئة مورد ناقصة: ${name}`, 'CONFIG_RESOURCE_INCOMPLETE');
    }
    if (spec.per_agent_max > spec.total) {
      throw new SovereignViolation(`سقف الكيان يتجاوز السقف الكلي: ${name}`, 'CONFIG_RESOURCE_OVER_TOTAL');
    }
  }
  if (!raw.agents || typeof raw.agents.population_max !== 'number' || raw.agents.population_max < 0) {
    throw new SovereignViolation('سقف السكان غير معلن', 'CONFIG_NO_POPULATION_MAX');
  }
  return raw;
}

/** تهيئة الأقاليم المعلنة (أُعلنت في المرحلة 2 وصارت مُلزمة في المرحلة 24) */
export interface RegionDeclaration {
  id: string;
  name: string;
  governor: string;
  autonomy_level: string;
}

export interface RegionsConfig {
  regions: RegionDeclaration[];
  collective_override_of_king: string;
}

/**
 * يحمّل الأقاليم المعلنة ويرفض أي تهيئة تخالف الثوابت السيادية.
 * سببه: قبل المرحلة 24 كان config/regions.yaml معلنًا ولا يقرؤه أحد — إعلان بلا أثر.
 * بعدها: لا يقوم إقليم إلا إن كان معرّفه معلنًا هنا (RULE-005 — لا توسّع من الداخل).
 */
export function loadRegions(configDir = resolveConfigDir()): RegionsConfig {
  const raw = loadYamlFile(join(configDir, 'regions.yaml')) as unknown as RegionsConfig;
  if (!Array.isArray(raw.regions) || raw.regions.length === 0) {
    throw new SovereignViolation('لا أقاليم معلنة — لا اتحاد بلا إعلان', 'CONFIG_NO_REGIONS');
  }
  if (raw.collective_override_of_king !== 'forbidden') {
    throw new SovereignViolation(
      'نقض الأقاليم المجتمعة للملك ممنوع — السيادة غير قابلة للتجميع',
      'CONFIG_COLLECTIVE_OVERRIDE_ALLOWED',
    );
  }
  const seen = new Set<string>();
  for (const region of raw.regions) {
    if (typeof region.id !== 'string' || !region.id.startsWith('region:')) {
      throw new SovereignViolation('معرّف إقليم غير صالح', 'CONFIG_REGION_ID');
    }
    if (seen.has(region.id)) {
      throw new SovereignViolation(`إقليم مكرَّر: ${region.id}`, 'CONFIG_REGION_DUPLICATE');
    }
    seen.add(region.id);
    if (typeof region.name !== 'string' || region.name.trim().length < 3) {
      throw new SovereignViolation(`إقليم بلا اسم معلن: ${region.id}`, 'CONFIG_REGION_NO_NAME');
    }
    if (region.autonomy_level !== 'limited' && region.autonomy_level !== 'delegated') {
      throw new SovereignViolation(
        `مستوى استقلال غير معلن أو غير مسموح: ${region.id}`, 'CONFIG_REGION_AUTONOMY',
      );
    }
  }
  return raw;
}

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
