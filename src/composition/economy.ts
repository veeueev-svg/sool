/**
 * src/composition/economy.ts — الاقتصاد والخارج — الدفتر والوحدة والموازنة والخزانة والحسابات والعقود
 * المالك: القيّم على المستودع | المراحل: 25–27
 * المدخلات: مخرجات السيادة والسكان و`now`
 * المخرجات: الدفتر والوحدة والموازنة والخزانة والرسوم وحسابات الخارج وضوابط الدفع والعقود وإنهاؤها
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { SovereigntyParts } from './sovereignty';
import type { PopulationParts } from './population';
import { ExternalAccountRegistry } from '../external/account_registry';
import { PaymentControls } from '../external/payment_controls';
import { PartnerRisk } from '../external/partner_risk';
import { ExternalContractRegistry } from '../external/contract_registry';
import { ContractTermination } from '../external/contract_termination';
import { ROYAL_COURT } from '../governance/ministries';
import { Ledger } from '../economy/ledger';
import { DigitalUnit } from '../economy/digital_unit';
import { Budget } from '../economy/budget';
import { Treasury } from '../economy/treasury';
import { RevenueService } from '../economy/tax';

export function composeEconomy(
  parts: SovereigntyParts & PopulationParts, now: number,
) {
  const {
    audit, gateway, killSwitch, heartbeat, economyConfig, externalConfig, contractsConfig,
    egress,
  } = parts;

  // 1) الاقتصاد والخزانة (المرحلة 25) — قبل خاتمة التأسيس عن قصد:
  //     فتح حسابات الدولة خطوة تأسيس تُسجَّل (account_opened)، وخاتمة التأسيس تبقى
  //     state_online وحدها. الترتيب مُلزم: دفتر ← حسابات ← إصدار ← موازنة ← خزانة ← رسوم.
  // T-49: سقفُ عددِ الحسابات معلنٌ في التهيئة، ويُمرَّر هنا — فالدفترُ لا يعرف سقفَه من نفسه
  const ledger = new Ledger({ audit, maxAccounts: economyConfig.ledger.max_accounts });
  ledger.openAccount(economyConfig.treasury.account, 'asset', 'خزانة الدولة العامة', now);
  ledger.openAccount(economyConfig.treasury.equity_account, 'equity', 'حقّ التاج في الإصدار', now);
  ledger.openAccount(economyConfig.treasury.revenue_account, 'revenue', 'إيرادات الرسوم', now);
  const unit = new DigitalUnit({
    audit, gateway, ledger,
    declaration: {
      code: economyConfig.unit.code, name: economyConfig.unit.name,
      minorUnits: economyConfig.unit.minor_units, supplyMax: economyConfig.unit.supply_max,
      convertible: economyConfig.unit.external_convertibility !== 'forbidden',
    },
    treasuryAccount: economyConfig.treasury.account,
    equityAccount: economyConfig.treasury.equity_account,
  });
  const budget = new Budget({
    audit, gateway,
    ceilingTotal: economyConfig.budget.ceiling_total,
    // T-49: سقفُ المبلغ وسقفُ العدد معًا — أحدهما لا يُغني عن الآخر
    maxLines: economyConfig.budget.max_lines,
    carryoverAllowed: economyConfig.budget.carryover !== 'forbidden',
  });
  const treasury = new Treasury({
    audit, gateway, ledger, budget,
    account: economyConfig.treasury.account,
    singleDisbursementMax: economyConfig.treasury.single_disbursement_max,
    overdraftAllowed: economyConfig.treasury.overdraft !== 'forbidden',
    // وضع الدولة بزمن العملية: القاطع أولًا ثم النبض (كقراءة البوابة نفسها)
    modeAt: (at) => (killSwitch.status.engaged ? 'halted' : heartbeat.evaluate(at)),
  });
  const revenue = new RevenueService({
    audit, gateway, treasury,
    revenueAccount: economyConfig.treasury.revenue_account,
    rates: economyConfig.revenue.rates.map((r) => ({
      base: r.base, ratePerMille: r.rate_per_mille, declaredAt: Date.parse(r.declared_at),
    })),
    retroactiveAllowed: economyConfig.revenue.retroactive !== 'forbidden',
  });

  // 2) الحسابات الخارجية والدفع الخارجي (المرحلة 26) — وزارة الخارجية تحت التاج.
  //     الترتيب مُلزم: سجل النظائر ← ضوابط الدفع ← ربط المصدرين (قناة الشبكة والالتزامات).
  //     ولا يُفتح هنا أي حساب: الفتح فعلٌ ملكي لا خطوة تأسيس (RULE-003)، فخاتمة
  //     التأسيس تبقى state_online وحدها، ولا يزيد عدد حسابات الدفتر عن الثلاثة السيادية.
  const externalAccounts = new ExternalAccountRegistry({
    audit, gateway, ledger,
    counterparties: externalConfig.counterparties.map((cp) => ({
      id: cp.id, name: cp.name, host: cp.host, port: cp.port, purpose: cp.purpose,
      singleMax: cp.single_max, dailyMax: cp.daily_max, totalCap: cp.total_cap,
    })),
    maxTermMs: externalConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    suspendAuthorities: externalConfig.policy.suspend_authorities,
    unitConvertible: externalConfig.policy.unit_convertibility !== 'forbidden',
  });
  const payments = new PaymentControls({
    audit, treasury, registry: externalAccounts,
    confirmationWindowMs: externalConfig.policy.confirmation_window_hours * 60 * 60 * 1000,
    // قناة المال مربوطة بقناة الشبكة: تُفحص لحظة الفتح ولحظة كل دفعة
    egressProbe: (host, port, at) => egress.hasAllowance(host, port, at),
  });
  externalAccounts.bindEgressProbe((host, port, at) => egress.hasAllowance(host, port, at));
  // T-58: احتواءُ الشبكة يعلّق القناةَ الماليّة في اللحظة نفسِها، بيد الجهة المحتوية
  egress.bindContainmentHook((reason) => externalAccounts.suspendAll(egress.containingAuthority, reason));
  externalAccounts.bindObligationProbe((accountId) => payments.pendingObligations(accountId));
  // ثابت 11 في الخزانة · ثابت 1 في ضوابط الدفع (T-60): نطاقُ `external:ledger:` محجوزٌ
  // لبابِه المعلن، والحرسُ يُربط مرّةً واحدةً. وحدُّه المعلن: خزانةٌ تُركّب بلا ضوابطِ دفعٍ
  // خارجيّ تبقى بلا حرسٍ — ولا نطاقَ محجوزًا حينها إذ لا حسابَ نظيرٍ يُفتح في الدفتر.
  treasury.bindReservedTargets((to, amount, at) => payments.reservedTargetRefusal(to, amount, at));
  // T-165 (W-2026-042): والدفترُ نفسُه يسأل مالكَ النطاقِ — فلا بابَ ثالثٌ بقيدٍ مباشر
  ledger.bindEntryGuard((input, at) => payments.reservedEntryRefusal(input, at));

  // 3) العقود الخارجية (المرحلة 27) — وزارة الخارجية تقترح، وديوان التدقيق يقدّر،
  //     والتاج يوقّع ويُنهي، ووزارة المالية تسوّي. الترتيب مُلزم: تقدير المخاطر ←
  //     سجل العقود ← **منح صلاحية الإنهاء مرة واحدة** ← وحدة الإنهاء ← ربط الالتزامات.
  //     ولا يُوقَّع هنا أي عقد: التوقيع فعلٌ ملكي لا خطوة تأسيس (RULE-003).
  const partnerRisk = new PartnerRisk({
    audit,
    kinds: contractsConfig.kinds.map((k) => ({
      id: k.id, name: k.name, counterparty: k.counterparty, purpose: k.purpose,
      maxValue: k.max_value, riskWeight: k.risk_weight,
    })),
    riskFactors: contractsConfig.risk_factors,
    maxScore: contractsConfig.policy.max_risk_score,
    reviewIntervalMs: contractsConfig.policy.review_interval_days * 24 * 60 * 60 * 1000,
    breachPenalty: contractsConfig.policy.breach_penalty,
    proposerId: contractsConfig.policy.proposer,
    assessorId: contractsConfig.policy.assessor,
  });
  const contracts = new ExternalContractRegistry({
    audit, gateway, accounts: externalAccounts, risk: partnerRisk,
    maxTermMs: contractsConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    maxOpenPerCounterparty: contractsConfig.policy.max_open_per_counterparty,
    proposerId: contractsConfig.policy.proposer,
  });
  const contractTermination = new ContractTermination({
    audit, gateway, accounts: externalAccounts,
    // الباب الوحيد للإنهاء: يُمنح هنا مرة واحدة ولا يُمنح ثانيةً
    capability: contracts.grantTerminationCapability(ROYAL_COURT),
    terminationAuthorities: externalConfig.policy.suspend_authorities,
    settlementWindowMs: contractsConfig.policy.settlement_window_hours * 60 * 60 * 1000,
    dispositionWindowMs: contractsConfig.policy.channel_disposition_hours * 60 * 60 * 1000,
    suspendsAccount: contractsConfig.policy.termination_suspends_account,
    settlerId: contractsConfig.policy.settler,
  });
  contractTermination.bindObligationProbe(
    (accountId) => payments.pendingObligations(accountId),
  );

  return {
    ledger, unit, budget, treasury, revenue, externalAccounts, payments,
    partnerRisk, contracts, contractTermination,
  };
}

/** ما تُخرجه طبقة الاقتصاد والخارج */
export type EconomyParts = ReturnType<typeof composeEconomy>;
