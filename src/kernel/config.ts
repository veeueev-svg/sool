/**
 * src/kernel/config.ts — تحميل تهيئة الدولة والتحقق من ثوابتها
 * المالك: القيّم على المستودع | المرحلة: 2
 * المدخلات: ملفات config/*.yaml | المخرجات: كائنات تهيئة مُتحقَّق منها
 * حالات الفشل: ملف ناقص أو ملكان أو مسار جانبي مسموح ⇒ فشل مغلق (fail-closed)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { KNOWN_SOVEREIGN_ACTIONS, SovereignAction, SovereignViolation } from './types';

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
      // ملاحظة (المرحلة 26): عنصر قائمة مقتبس يحتوي نقطتين — مثل "ministry:foreign_affairs" —
      // كان يُقرأ خريطةً لا نصًّا. الاقتباس يحسم القصد: نصّ لا زوج مفتاح/قيمة.
      const quoted = content.startsWith('"') || content.startsWith("'");
      if (content.startsWith('{')) {
        arr.push(inlineMap(content));
      } else if (!quoted && /^[^:]+:/.test(content)) {
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
  /**
   * الأفعال السيادية المعلنة — **ملزمة لا وصفية** (المرحلة 28): البوابة تُبنى منها،
   * ولذلك نوعها `SovereignAction` لا `string`: يضمنه تحقق `loadRoyalAuthority` عند
   * التحميل (فشل مغلق على أي فعل مجهول)، فلا يدخل النوع اسمٌ لم تُعلنه الشفرة.
   */
  sovereign_actions: SovereignAction[];
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
  // المرحلة 28: قائمة الأفعال السيادية صارت **ملزمة** لا وصفًا: البوابة تقرأ منها،
  // فوجب أن تُرفض قائمةٌ فيها فعلٌ مجهول (فلا يُفتح بابٌ باسم لا تعرفه الدولة)
  // أو فيها تكرار أو لا شيء (فلا تقوم دولةٌ لا فعل سيادي فيها أصلًا) — فشل مغلق.
  if (!Array.isArray(raw.sovereign_actions) || raw.sovereign_actions.length === 0) {
    throw new SovereignViolation(
      'لا أفعال سيادية معلنة — لا سيادة بلا فعل معلن', 'CONFIG_NO_SOVEREIGN_ACTIONS',
    );
  }
  const seenActions = new Set<string>();
  for (const action of raw.sovereign_actions) {
    if (typeof action !== 'string' || !(KNOWN_SOVEREIGN_ACTIONS as readonly string[]).includes(action)) {
      throw new SovereignViolation(
        `فعل سيادي مجهول في التهيئة: ${String(action)}`, 'CONFIG_UNKNOWN_SOVEREIGN_ACTION',
      );
    }
    if (seenActions.has(action)) {
      throw new SovereignViolation(
        `فعل سيادي مكرّر في التهيئة: ${action}`, 'CONFIG_DUPLICATE_SOVEREIGN_ACTION',
      );
    }
    seenActions.add(action);
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

/** تهيئة الحسابات الخارجية (المرحلة 26) — كل نافذة إلى الخارج معلنة هنا لا في الكود */
export interface ExternalConfig {
  policy: {
    default: string; unit_convertibility: string; suspension: string;
    resume_requires_royal_command: boolean; max_term_days: number;
    confirmation_window_hours: number; suspend_authorities: string[];
  };
  counterparties: {
    id: string; name: string; host: string; port: number; purpose: string;
    single_max: number; daily_max: number; total_cap: number;
  }[];
}

/**
 * يحمّل النظائر الخارجية المعلنة ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * سببه: النافذة إلى الخارج أخطر من المال نفسه — فمن يملك قناةً معلنة يملك أثرًا خارج المستودع.
 * ويتحقق كذلك من أن مجموع السقوف الخارجية **لا يتجاوز سقف الموازنة الكلي**، فلا يُتعهَّد
 * للخارج بما لا تستطيع الدولة تمويله (تقاطع مُلزم مع config/economy.yaml).
 */
export function loadExternal(configDir = resolveConfigDir()): ExternalConfig {
  const raw = loadYamlFile(join(configDir, 'external.yaml')) as unknown as ExternalConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة الحسابات الخارجية غير معلنة', 'CONFIG_NO_EXTERNAL_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في الحسابات الخارجية هو الرفض', 'CONFIG_EXTERNAL_DEFAULT_ALLOW',
    );
  }
  // تنبيه النطاق مُلزم في الكود: فتح حساب خارجي لا يجعل الوحدة قابلة للتحويل
  if (policy.unit_convertibility !== 'forbidden') {
    throw new SovereignViolation(
      'قابلية تحويل الوحدة ممنوعة — الحساب الخارجي ليس صرّافًا',
      'CONFIG_EXTERNAL_CONVERTIBLE',
    );
  }
  if (policy.suspension !== 'immediate') {
    throw new SovereignViolation(
      'التعليق يجب أن يكون فوريًّا — تعليق مؤجَّل ليس تعليقًا',
      'CONFIG_EXTERNAL_SUSPENSION_DELAYED',
    );
  }
  if (policy.resume_requires_royal_command !== true) {
    throw new SovereignViolation(
      'الاستئناف بأمر ملكي — رفع الحماية أغلى من إنزالها',
      'CONFIG_EXTERNAL_RESUME_WITHOUT_KING',
    );
  }
  if (!Number.isSafeInteger(policy.max_term_days) || policy.max_term_days <= 0
    || policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة الحساب الخارجي غير معلنة أو غير مقبولة — لا حساب دائم',
      'CONFIG_EXTERNAL_TERM',
    );
  }
  if (!Number.isSafeInteger(policy.confirmation_window_hours)
    || policy.confirmation_window_hours <= 0) {
    throw new SovereignViolation(
      'مدة إثبات الاستلام غير معلنة — لا التزام بلا مدة إثبات',
      'CONFIG_EXTERNAL_NO_CONFIRM_WINDOW',
    );
  }
  if (!Array.isArray(policy.suspend_authorities) || policy.suspend_authorities.length === 0) {
    throw new SovereignViolation(
      'لا جهة مخوَّلة بالتعليق — قناة بلا يد تعلّقها', 'CONFIG_EXTERNAL_NO_SUSPENDERS',
    );
  }
  // فشل مغلق: معرّف جهة غير نصّي يعني تهيئة مقروءة خطأ — ولا تعليق بيد مجهولة
  for (const authority of policy.suspend_authorities) {
    if (typeof authority !== 'string' || authority.trim().length === 0) {
      throw new SovereignViolation(
        'جهة تعليق غير معلنة بمعرّف نصّي', 'CONFIG_EXTERNAL_SUSPENDER_ID',
      );
    }
  }
  if (!Array.isArray(raw.counterparties) || raw.counterparties.length === 0) {
    throw new SovereignViolation(
      'لا نظائر خارجية معلنة — لا حساب بلا إعلان', 'CONFIG_EXTERNAL_NO_COUNTERPARTIES',
    );
  }

  const ids = new Set<string>();
  const hosts = new Set<string>();
  let capsTotal = 0;
  for (const cp of raw.counterparties) {
    if (typeof cp.id !== 'string' || !cp.id.startsWith('external:')) {
      throw new SovereignViolation('معرّف نظير خارجي غير صالح', 'CONFIG_EXTERNAL_ID');
    }
    if (ids.has(cp.id)) {
      throw new SovereignViolation(`نظير مكرَّر: ${cp.id}`, 'CONFIG_EXTERNAL_DUPLICATE');
    }
    ids.add(cp.id);
    if (typeof cp.name !== 'string' || cp.name.trim().length < 3) {
      throw new SovereignViolation(`نظير بلا اسم معلن: ${cp.id}`, 'CONFIG_EXTERNAL_NO_NAME');
    }
    if (typeof cp.host !== 'string' || cp.host.trim().length < 3) {
      throw new SovereignViolation(`نظير بلا مضيف معلن: ${cp.id}`, 'CONFIG_EXTERNAL_NO_HOST');
    }
    if (hosts.has(cp.host)) {
      throw new SovereignViolation(
        `مضيف مكرَّر بين نظيرين: ${cp.host}`, 'CONFIG_EXTERNAL_HOST_DUPLICATE',
      );
    }
    hosts.add(cp.host);
    if (!Number.isSafeInteger(cp.port) || cp.port <= 0 || cp.port > 65535) {
      throw new SovereignViolation(`منفذ غير صالح: ${cp.id}`, 'CONFIG_EXTERNAL_PORT');
    }
    if (typeof cp.purpose !== 'string' || cp.purpose.trim().length < 3) {
      throw new SovereignViolation(`نظير بلا غرض معلن: ${cp.id}`, 'CONFIG_EXTERNAL_NO_PURPOSE');
    }
    for (const [key, value] of [
      ['single_max', cp.single_max], ['daily_max', cp.daily_max], ['total_cap', cp.total_cap],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new SovereignViolation(
          `سقف غير معلن أو غير صالح (${key}): ${cp.id}`, 'CONFIG_EXTERNAL_CAP',
        );
      }
    }
    if (cp.single_max > cp.daily_max || cp.daily_max > cp.total_cap) {
      throw new SovereignViolation(
        `ترتيب السقوف مختلّ (الدفعة ≤ اليوم ≤ الكلي): ${cp.id}`,
        'CONFIG_EXTERNAL_CAP_ORDER',
      );
    }
    capsTotal += cp.total_cap;
  }

  // تقاطع مُلزم: لا يُتعهَّد للخارج بما يتجاوز سقف الموازنة الكلي
  const economy = loadEconomy(configDir);
  if (capsTotal > economy.budget.ceiling_total) {
    throw new SovereignViolation(
      'مجموع السقوف الخارجية يتجاوز سقف الموازنة الكلي — تعهّد لا يمكن تمويله',
      'CONFIG_EXTERNAL_CAPS_OVER_BUDGET',
    );
  }
  return raw;
}

/** تهيئة العقود الخارجية (المرحلة 27) — config/contracts.yaml */
export interface ContractsConfig {
  policy: {
    default: string; require_end_date: boolean; max_term_days: number;
    termination: string; termination_requires_royal_command: boolean;
    termination_suspends_account: boolean; settlement_window_hours: number;
    max_risk_score: number; review_interval_days: number; breach_penalty: number;
    max_open_per_counterparty: number;
    proposer: string; assessor: string; settler: string;
  };
  kinds: {
    id: string; name: string; counterparty: string; purpose: string;
    max_value: number; risk_weight: number;
  }[];
  risk_factors: Record<string, number>;
}

/**
 * يحمّل أنواع العقود الخارجية المعلنة ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * سببه: العقد أخطر من الدفعة — الدفعة تقع مرة، والعقد يُلزم الدولة زمنًا ويُنشئ اعتمادًا.
 * ويتحقق تقاطعيًّا مع config/external.yaml أن كل نوع عقد لنظير **معلن**، وأن مجموع قيم
 * أنواع العقود لنظير واحد **لا يتجاوز سقفه الكلي** — فلا يُتعهَّد بعقد لا تحمله قناته.
 */
export function loadContracts(configDir = resolveConfigDir()): ContractsConfig {
  const raw = loadYamlFile(join(configDir, 'contracts.yaml')) as unknown as ContractsConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة العقود الخارجية غير معلنة', 'CONFIG_NO_CONTRACTS_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في العقود الخارجية هو الرفض', 'CONFIG_CONTRACT_DEFAULT_ALLOW',
    );
  }
  // شرط القبول المعلن (المرحلة 27): لا عقد بلا تاريخ انتهاء — ولا تُعطَّل هذه القاعدة بتهيئة
  if (policy.require_end_date !== true) {
    throw new SovereignViolation(
      'تاريخ الانتهاء إلزامي في كل عقد خارجي — لا عقد دائم',
      'CONFIG_CONTRACT_NO_END_DATE_RULE',
    );
  }
  if (policy.termination !== 'immediate') {
    throw new SovereignViolation(
      'الإنهاء يجب أن يكون فوريًّا — عقد "سيُنهى" عقدٌ قائم',
      'CONFIG_CONTRACT_TERMINATION_DELAYED',
    );
  }
  if (policy.termination_requires_royal_command !== true) {
    throw new SovereignViolation(
      'الإنهاء بأمر ملكي — إسقاط التزام معلن ليس فعل موظّف',
      'CONFIG_CONTRACT_TERMINATION_WITHOUT_KING',
    );
  }
  if (policy.termination_suspends_account !== true) {
    throw new SovereignViolation(
      'الإنهاء يقطع قناة المال — لا عقد مُنهًى وقناته مفتوحة',
      'CONFIG_CONTRACT_TERMINATION_LEAVES_CHANNEL',
    );
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days],
    ['settlement_window_hours', policy.settlement_window_hours],
    ['max_risk_score', policy.max_risk_score],
    ['review_interval_days', policy.review_interval_days],
    ['breach_penalty', policy.breach_penalty],
    ['max_open_per_counterparty', policy.max_open_per_counterparty],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير معلنة أو غير صالحة في سياسة العقود (${key})`, 'CONFIG_CONTRACT_POLICY_VALUE',
      );
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة العقد الخارجي تتجاوز الحدّ المقبول — لا عقد دائم', 'CONFIG_CONTRACT_TERM',
    );
  }
  // RULE-004: من يقترح لا يقدّر ولا يسوّي — ثلاث أيدٍ معلنة لا يد واحدة
  for (const [key, value] of [
    ['proposer', policy.proposer], ['assessor', policy.assessor], ['settler', policy.settler],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(
        `جهة غير معلنة بمعرّف نصّي في سياسة العقود (${key})`, 'CONFIG_CONTRACT_PARTY_ID',
      );
    }
  }
  if (policy.proposer === policy.assessor || policy.proposer === policy.settler
    || policy.assessor === policy.settler) {
    throw new SovereignViolation(
      'المقترح والمقدِّر والمسوِّي لا يكونون جهةً واحدة (RULE-004)',
      'CONFIG_CONTRACT_ROLES_MERGED',
    );
  }
  if (!raw.risk_factors || typeof raw.risk_factors !== 'object'
    || Object.keys(raw.risk_factors).length === 0) {
    throw new SovereignViolation(
      'لا عوامل مخاطر معلنة — لا تقدير بلا مقياس معلن', 'CONFIG_CONTRACT_NO_RISK_FACTORS',
    );
  }
  for (const [name, weight] of Object.entries(raw.risk_factors)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(
        `وزن عامل مخاطر غير صالح: ${name}`, 'CONFIG_CONTRACT_RISK_WEIGHT',
      );
    }
  }
  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
    throw new SovereignViolation(
      'لا أنواع عقود معلنة — لا عقد بلا إعلان', 'CONFIG_CONTRACT_NO_KINDS',
    );
  }

  const external = loadExternal(configDir);
  const caps = new Map<string, number>();
  for (const cp of external.counterparties) caps.set(cp.id, cp.total_cap);
  const ids = new Set<string>();
  const committed = new Map<string, number>();
  for (const kind of raw.kinds) {
    if (typeof kind.id !== 'string' || !kind.id.startsWith('contract:')) {
      throw new SovereignViolation('معرّف نوع عقد غير صالح', 'CONFIG_CONTRACT_KIND_ID');
    }
    if (ids.has(kind.id)) {
      throw new SovereignViolation(`نوع عقد مكرَّر: ${kind.id}`, 'CONFIG_CONTRACT_KIND_DUPLICATE');
    }
    ids.add(kind.id);
    if (typeof kind.name !== 'string' || kind.name.trim().length < 3) {
      throw new SovereignViolation(`نوع عقد بلا اسم: ${kind.id}`, 'CONFIG_CONTRACT_KIND_NO_NAME');
    }
    if (typeof kind.purpose !== 'string' || kind.purpose.trim().length < 3) {
      throw new SovereignViolation(`نوع عقد بلا غرض: ${kind.id}`, 'CONFIG_CONTRACT_KIND_NO_PURPOSE');
    }
    // RULE-005: العقد لا يُنشئ نظيرًا — النظير معلن في external.yaml وحده
    if (typeof kind.counterparty !== 'string' || !caps.has(kind.counterparty)) {
      throw new SovereignViolation(
        `نوع عقد لنظير غير معلن: ${kind.id}`, 'CONFIG_CONTRACT_UNDECLARED_COUNTERPARTY',
      );
    }
    if (!Number.isSafeInteger(kind.max_value) || kind.max_value <= 0) {
      throw new SovereignViolation(
        `سقف قيمة غير معلن أو غير صالح: ${kind.id}`, 'CONFIG_CONTRACT_KIND_VALUE',
      );
    }
    if (!Number.isSafeInteger(kind.risk_weight) || kind.risk_weight <= 0) {
      throw new SovereignViolation(
        `وزن مخاطر غير معلن للنوع: ${kind.id}`, 'CONFIG_CONTRACT_KIND_RISK',
      );
    }
    // لا يُوقَّع نوع عقد لا يمكن أن يُوقَّع أصلًا: وزن يفوق السقف يعني إعلانًا ميتًا
    if (kind.risk_weight > policy.max_risk_score) {
      throw new SovereignViolation(
        `وزن مخاطر النوع يفوق سقف الدرجة المعلن: ${kind.id}`, 'CONFIG_CONTRACT_KIND_RISK_OVER_MAX',
      );
    }
    const total = (committed.get(kind.counterparty) ?? 0) + kind.max_value;
    committed.set(kind.counterparty, total);
    if (total > (caps.get(kind.counterparty) as number)) {
      throw new SovereignViolation(
        `مجموع قيم عقود النظير يتجاوز سقفه الكلي: ${kind.counterparty}`,
        'CONFIG_CONTRACT_OVER_COUNTERPARTY_CAP',
      );
    }
  }
  return raw;
}

/** تهيئة المنشآت الاقتصادية (المرحلة 28) — config/enterprises.yaml */
export interface EnterprisesConfig {
  policy: {
    default: string; require_measured_inputs: boolean; require_budget_line: boolean;
    max_term_days: number; max_facilities_per_ministry: number;
    max_concurrent_runs: number; max_run_duration_hours: number;
    min_quality_score: number; waste_tolerance_per_mille: number;
    operator: string; inspector: string;
    suspend_authorities: string[];
  };
  quality_checks: Record<string, number>;
  materials: { id: string; name: string; unit: string; source: string }[];
  kinds: {
    id: string; name: string; sector: string;
    inputs: { material: string; quantity: number }[];
    output: { material: string; quantity: number };
    resource_cost: { resource: string; amount: number };
    required_checks: string[];
  }[];
}

/**
 * يحمّل إعلان المنشآت الاقتصادية ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * وأهمّ ما يتحقق منه — تنفيذًا للدرس المنقول من الجلسة 13 — أن **كل ثابت قابل للوقوع**:
 *   - مجموع أوزان فحوص كل نوع ≥ الحدّ الأدنى للجودة، وإلّا كان النوع إعلانًا ميتًا
 *     لا تنجح فيه دفعة أبدًا، ومراقبة الجودة فيه شعارًا لا حماية.
 *   - الحدّ الأدنى للجودة ≤ مجموع كل الأوزان المعلنة، وإلّا استحال القبول في كل نوع.
 *   - كلفة الموارد لكل نوع ≤ سقف الكيان الواحد في `config/quotas.yaml`، وإلّا رُفض
 *     كل تأجير فلا تعمل المنشأة ولو صحّ كل ما قبله.
 * ويتحقق تقاطعيًّا مع `config/external.yaml` أن مصدر كل مادة خارجية **نظير معلن**،
 * فلا تدخل مادة على اسم مذكور بل على قناة قائمة (ADR-0011 قرار 1).
 */
export function loadEnterprises(configDir = resolveConfigDir()): EnterprisesConfig {
  const raw = loadYamlFile(join(configDir, 'enterprises.yaml')) as unknown as EnterprisesConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة المنشآت غير معلنة', 'CONFIG_NO_ENTERPRISES_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في المنشآت هو الرفض', 'CONFIG_ENTERPRISE_DEFAULT_ALLOW',
    );
  }
  // شرط القبول المعلن (T-69): لا إنتاج بلا مدخل مُقاس — ولا تُعطَّل هذه القاعدة بتهيئة
  if (policy.require_measured_inputs !== true) {
    throw new SovereignViolation(
      'المدخل المُقاس إلزامي — لا إنتاج بلا مدخل يُقاس',
      'CONFIG_ENTERPRISE_UNMEASURED_INPUTS',
    );
  }
  if (policy.require_budget_line !== true) {
    throw new SovereignViolation(
      'بند الموازنة إلزامي — لا منشأة بلا نفقة معلنة',
      'CONFIG_ENTERPRISE_NO_BUDGET_RULE',
    );
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days],
    ['max_facilities_per_ministry', policy.max_facilities_per_ministry],
    ['max_concurrent_runs', policy.max_concurrent_runs],
    ['max_run_duration_hours', policy.max_run_duration_hours],
    ['min_quality_score', policy.min_quality_score],
    ['waste_tolerance_per_mille', policy.waste_tolerance_per_mille],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير معلنة أو غير صالحة في سياسة المنشآت (${key})`, 'CONFIG_ENTERPRISE_POLICY_VALUE',
      );
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة المنشأة تتجاوز الحدّ المقبول — لا منشأة دائمة', 'CONFIG_ENTERPRISE_TERM',
    );
  }
  if (policy.waste_tolerance_per_mille >= 1000) {
    throw new SovereignViolation(
      'تسامح الفقد يبلغ المدخل كلّه — حدٌّ لا يقع', 'CONFIG_ENTERPRISE_WASTE_TOLERANCE',
    );
  }
  // RULE-004: من يشغّل لا يفتّش — يدان معلنتان لا يد واحدة
  for (const [key, value] of [
    ['operator', policy.operator], ['inspector', policy.inspector],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(
        `جهة غير معلنة بمعرّف نصّي في سياسة المنشآت (${key})`, 'CONFIG_ENTERPRISE_PARTY_ID',
      );
    }
  }
  if (policy.operator === policy.inspector) {
    throw new SovereignViolation(
      'المشغّل والمفتّش لا يكونان جهةً واحدة (RULE-004)', 'CONFIG_ENTERPRISE_ROLES_MERGED',
    );
  }
  if (!Array.isArray(policy.suspend_authorities) || policy.suspend_authorities.length === 0) {
    throw new SovereignViolation(
      'لا جهة تملك تعليق منشأة — حماية بلا يد تمارسها', 'CONFIG_ENTERPRISE_NO_SUSPENDERS',
    );
  }
  for (const who of policy.suspend_authorities) {
    if (typeof who !== 'string' || who.trim().length === 0) {
      throw new SovereignViolation(
        'جهة تعليق غير معلنة بمعرّف نصّي', 'CONFIG_ENTERPRISE_SUSPENDER_ID',
      );
    }
  }

  if (!raw.quality_checks || typeof raw.quality_checks !== 'object'
    || Object.keys(raw.quality_checks).length === 0) {
    throw new SovereignViolation(
      'لا فحوص جودة معلنة — لا مراقبة بلا مقياس معلن', 'CONFIG_ENTERPRISE_NO_CHECKS',
    );
  }
  let weightTotal = 0;
  for (const [name, weight] of Object.entries(raw.quality_checks)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(
        `وزن فحص جودة غير صالح: ${name}`, 'CONFIG_ENTERPRISE_CHECK_WEIGHT',
      );
    }
    weightTotal += weight;
  }
  if (policy.min_quality_score > weightTotal) {
    throw new SovereignViolation(
      'الحدّ الأدنى للجودة يفوق مجموع كل الأوزان المعلنة — قبولٌ مستحيل',
      'CONFIG_ENTERPRISE_MIN_QUALITY_UNREACHABLE',
    );
  }

  if (!Array.isArray(raw.materials) || raw.materials.length === 0) {
    throw new SovereignViolation(
      'لا مواد معلنة — لا إنتاج بلا مادة معلنة', 'CONFIG_ENTERPRISE_NO_MATERIALS',
    );
  }
  const external = loadExternal(configDir);
  const counterparties = new Set(external.counterparties.map((cp) => cp.id));
  const materials = new Map<string, { source: string }>();
  for (const material of raw.materials) {
    if (typeof material.id !== 'string' || !material.id.startsWith('material:')) {
      throw new SovereignViolation('معرّف مادة غير صالح', 'CONFIG_ENTERPRISE_MATERIAL_ID');
    }
    if (materials.has(material.id)) {
      throw new SovereignViolation(
        `مادة مكرَّرة: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_DUPLICATE',
      );
    }
    if (typeof material.name !== 'string' || material.name.trim().length < 3) {
      throw new SovereignViolation(
        `مادة بلا اسم: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_NO_NAME',
      );
    }
    if (typeof material.unit !== 'string' || material.unit.trim().length === 0) {
      throw new SovereignViolation(
        `مادة بلا وحدة قياس: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_NO_UNIT',
      );
    }
    // RULE-005: المادة لا تُنشئ نظيرًا — النظير معلن في external.yaml وحده
    if (typeof material.source !== 'string'
      || (material.source !== 'internal' && !counterparties.has(material.source))) {
      throw new SovereignViolation(
        `مصدر مادة غير معلن: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_SOURCE',
      );
    }
    materials.set(material.id, { source: material.source });
  }

  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
    throw new SovereignViolation(
      'لا أنواع منشآت معلنة — لا منشأة بلا إعلان', 'CONFIG_ENTERPRISE_NO_KINDS',
    );
  }
  const quotas = loadQuotas(configDir);
  const kindIds = new Set<string>();
  for (const kind of raw.kinds) {
    if (typeof kind.id !== 'string' || !kind.id.startsWith('facility:')) {
      throw new SovereignViolation('معرّف نوع منشأة غير صالح', 'CONFIG_ENTERPRISE_KIND_ID');
    }
    if (kindIds.has(kind.id)) {
      throw new SovereignViolation(
        `نوع منشأة مكرَّر: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_DUPLICATE',
      );
    }
    kindIds.add(kind.id);
    if (typeof kind.name !== 'string' || kind.name.trim().length < 3) {
      throw new SovereignViolation(
        `نوع منشأة بلا اسم: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_NAME',
      );
    }
    if (typeof kind.sector !== 'string' || kind.sector.trim().length < 3) {
      throw new SovereignViolation(
        `نوع منشأة بلا قطاع معلن: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_SECTOR',
      );
    }
    if (!Array.isArray(kind.inputs) || kind.inputs.length === 0) {
      throw new SovereignViolation(
        `نوع منشأة بلا مدخلات معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_INPUTS',
      );
    }
    const seenInputs = new Set<string>();
    for (const input of kind.inputs) {
      if (typeof input.material !== 'string' || !materials.has(input.material)) {
        throw new SovereignViolation(
          `مدخل من مادة غير معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_MATERIAL',
        );
      }
      if (seenInputs.has(input.material)) {
        throw new SovereignViolation(
          `مدخل مكرَّر في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_DUPLICATE',
        );
      }
      seenInputs.add(input.material);
      if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
        throw new SovereignViolation(
          `كمية مدخل غير مُقاسة: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_QUANTITY',
        );
      }
    }
    if (!kind.output || typeof kind.output.material !== 'string'
      || !materials.has(kind.output.material)) {
      throw new SovereignViolation(
        `مخرج من مادة غير معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_MATERIAL',
      );
    }
    if (!Number.isSafeInteger(kind.output.quantity) || kind.output.quantity <= 0) {
      throw new SovereignViolation(
        `كمية مخرج غير مُقاسة: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_QUANTITY',
      );
    }
    // المادة المنتَجة داخليًّا مصدرها الدولة: لا يُدَّعى أن مصنعًا يُنتج مادةً خارجية
    if ((materials.get(kind.output.material) as { source: string }).source !== 'internal') {
      throw new SovereignViolation(
        `مخرج يُدَّعى إنتاجه ومصدره خارجي: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_EXTERNAL',
      );
    }
    if (seenInputs.has(kind.output.material)) {
      throw new SovereignViolation(
        `مخرج هو نفسه مدخل — إنتاجٌ يدّعي نفسه: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_IS_INPUT',
      );
    }
    if (!kind.resource_cost || typeof kind.resource_cost.resource !== 'string'
      || !quotas.resources[kind.resource_cost.resource]) {
      throw new SovereignViolation(
        `كلفة مورد غير معلن في الحصص: ${kind.id}`, 'CONFIG_ENTERPRISE_RESOURCE_UNDECLARED',
      );
    }
    if (!Number.isSafeInteger(kind.resource_cost.amount) || kind.resource_cost.amount <= 0) {
      throw new SovereignViolation(
        `كلفة مورد غير صالحة: ${kind.id}`, 'CONFIG_ENTERPRISE_RESOURCE_AMOUNT',
      );
    }
    // ثابت قابل للوقوع: كلفة تفوق سقف الكيان الواحد تجعل كل تأجير مرفوضًا ⇒ نوعٌ ميت
    const spec = quotas.resources[kind.resource_cost.resource] as {
      per_agent_max: number;
    };
    if (kind.resource_cost.amount > spec.per_agent_max) {
      throw new SovereignViolation(
        `كلفة المورد تفوق سقف الكيان الواحد — منشأة لا تعمل أبدًا: ${kind.id}`,
        'CONFIG_ENTERPRISE_RESOURCE_OVER_ENTITY_MAX',
      );
    }
    if (!Array.isArray(kind.required_checks) || kind.required_checks.length === 0) {
      throw new SovereignViolation(
        `نوع منشأة بلا فحوص جودة: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_CHECKS',
      );
    }
    const seenChecks = new Set<string>();
    let kindWeight = 0;
    for (const check of kind.required_checks) {
      if (typeof check !== 'string' || raw.quality_checks[check] === undefined) {
        throw new SovereignViolation(
          `فحص جودة غير معلن في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_CHECK_UNDECLARED',
        );
      }
      if (seenChecks.has(check)) {
        throw new SovereignViolation(
          `فحص جودة مكرَّر في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_CHECK_DUPLICATE',
        );
      }
      seenChecks.add(check);
      kindWeight += raw.quality_checks[check] as number;
    }
    // الدرس المنقول من الجلسة 13: ثابتٌ لا يقع ليس حماية بل شعار
    if (kindWeight < policy.min_quality_score) {
      throw new SovereignViolation(
        `مجموع أوزان فحوص النوع لا يبلغ الحدّ الأدنى — نوعٌ لا تنجح فيه دفعة: ${kind.id}`,
        'CONFIG_ENTERPRISE_KIND_QUALITY_UNREACHABLE',
      );
    }
  }
  return raw;
}
