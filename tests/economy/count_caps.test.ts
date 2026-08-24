/**
 * tests/economy/count_caps.test.ts — سقوفُ العدد المعلنة: الحسابات وبنود الموازنة (T-49)
 * المالك: وزارة المالية | المدخلات: config/economy.yaml معدَّلة في مجلد مؤقت + دولةٌ مُقلعة
 * المخرجات: رفضُ حملٍ برمزه، ورفضُ فتحٍ وإقرارٍ مسجَّلان، ورفضُ إرجاعٍ مغلق
 * التبعيات: loadEconomy · Ledger · Budget | الصلاحيات: لا تعديل على تهيئة المستودع الفعلية
 * السجلات: entry_refused / budget_refused | حالات الفشل: الحملُ والإرجاعُ مغلقان، والفتحُ والإقرارُ مرفوضان
 * اختبار القبول: هذا الملف | الوثيقة: docs/test-reports/T-049-count-caps.md
 *
 * ثوابت الاختبار:
 *   1) السقفُ المالي لا يحرس العدد — ويُقاس ذلك لا يُدَّعى.
 *   2) لكلّ سقفٍ قيمةٌ تُسقط الحملَ: غيابٌ، وقيمةٌ يستحيل معها الإقلاع.
 *   3) البابان معًا: الإقرارُ/الفتحُ يُرفض ويُسجَّل، والإرجاعُ يفشل فشلًا مغلقًا.
 *   4) الرفضُ لا يغيّر الحالة: عددُ الصفوف بعده كعدده قبله.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Budget, Ledger, SOVEREIGN_ACCOUNTS, SovereignViolation,
  bootstrapState, loadEconomy, ROYAL_COURT,
} from '../../src/index';

const T0 = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/**
 * ينسخ مجلد التهيئة الفعليّ ثم يستبدل سطرًا واحدًا في economy.yaml.
 * النسخُ لا التوليد: الاختبار يقيس الملفَّ الذي يُقلع عليه المستودع لا ملفًّا يشبهه.
 */
function withEconomy(
  replace: readonly [string, string][],
  run: (dir: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-count-caps-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  const path = join(dir, 'economy.yaml');
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of replace) {
    assert.equal(text.includes(from), true, `سطرٌ غير موجود في التهيئة: ${from}`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text, 'utf8');
  try {
    run(dir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function violationCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.equal(error instanceof SovereignViolation, true, `خطأ من غير نوع الرفض: ${String(error)}`);
    return (error as SovereignViolation).code;
  }
  return assert.fail('لم يُرفض ما يجب رفضه');
}

/** دولةٌ فيها وزارتان قائمتان، ودالّةُ إقرارِ بندٍ بأمرٍ ملكيّ */
function budgetState() {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'economy' }, at);
  s.ministries.establish(structural('ministry:infrastructure'), {
    ministryId: 'ministry:infrastructure', name: 'وزارة البنية', mandate: ['infrastructure'],
    proposedBy: ROYAL_COURT,
  }, T0);
  const declare = (line: string, ceiling = 1, at = T0) =>
    s.budget.declare(structural(line, at), {
      line, owner: 'ministry:infrastructure', ceiling, periodStart: at, periodEnd: at + 30 * DAY,
    }, at);
  return { s, declare };
}

test('التهيئة الفعليّة تُعلن سقفَي العدد، والحسابيّ منهما لا يقلّ عن حسابات التأسيس', () => {
  const economy = loadEconomy();
  assert.equal(Number.isSafeInteger(economy.ledger.max_accounts), true);
  assert.equal(Number.isSafeInteger(economy.budget.max_lines), true);
  assert.equal(economy.ledger.max_accounts >= SOVEREIGN_ACCOUNTS, true);
  assert.equal(economy.budget.max_lines > 0, true);
});

test('**سقفُ عددِ الحسابات غائبٌ ⇒ لا حمل** (لا سقفَ افتراضيًّا في الكود)', () => {
  withEconomy([['  max_accounts: 64', '  declared_nothing: 64']], (dir) => {
    assert.equal(violationCode(() => loadEconomy(dir)), 'CONFIG_NO_MAX_ACCOUNTS');
  });
});

test('سقفُ عددِ الحسابات صفرٌ أو سالبٌ ⇒ لا حمل', () => {
  withEconomy([['  max_accounts: 64', '  max_accounts: 0']], (dir) => {
    assert.equal(violationCode(() => loadEconomy(dir)), 'CONFIG_NO_MAX_ACCOUNTS');
  });
  withEconomy([['  max_accounts: 64', '  max_accounts: -5']], (dir) => {
    assert.equal(violationCode(() => loadEconomy(dir)), 'CONFIG_NO_MAX_ACCOUNTS');
  });
});

test('**سقفٌ أقلُّ من حسابات التأسيس ⇒ يُرفض عند الحمل** لا عند أوّل حسابٍ مرفوض', () => {
  withEconomy([['  max_accounts: 64', `  max_accounts: ${SOVEREIGN_ACCOUNTS - 1}`]], (dir) => {
    assert.equal(violationCode(() => loadEconomy(dir)), 'CONFIG_MAX_ACCOUNTS_BELOW_FOUNDING');
  });
  // وحسابات التأسيس نفسها سقفٌ مقبول: الحدُّ حدُّ استحالةٍ لا حدُّ راحة
  withEconomy([['  max_accounts: 64', `  max_accounts: ${SOVEREIGN_ACCOUNTS}`]], (dir) => {
    assert.equal(loadEconomy(dir).ledger.max_accounts, SOVEREIGN_ACCOUNTS);
  });
});

test('سقفُ عددِ بنود الموازنة غائبٌ أو غيرُ صحيحٍ ⇒ لا حمل', () => {
  withEconomy([['  max_lines: 128', '  declared_nothing: 128']], (dir) => {
    assert.equal(violationCode(() => loadEconomy(dir)), 'CONFIG_NO_MAX_LINES');
  });
  withEconomy([['  max_lines: 128', '  max_lines: 0']], (dir) => {
    assert.equal(violationCode(() => loadEconomy(dir)), 'CONFIG_NO_MAX_LINES');
  });
});

test('**الدفترُ يرفض الحسابَ فوق السقف ويُسجّل الرفض**', () => {
  const s = bootstrapState({ now: T0 });
  const narrow = new Ledger({ audit: s.audit, maxAccounts: SOVEREIGN_ACCOUNTS });
  for (let i = 0; i < SOVEREIGN_ACCOUNTS; i += 1) {
    assert.equal(narrow.openAccount(`expense:line-${i}`, 'expense', `مصروف ${i}`, T0).ok, true);
  }
  const before = s.audit.find('entry_refused').length;
  const over = narrow.openAccount('expense:over', 'expense', 'مصروف فوق السقف', T0);
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.reason, /سقف عدد الحسابات المعلن بلغ/);
  assert.equal(s.audit.find('entry_refused').length, before + 1);
  // ثابت 4: الرفضُ لا يغيّر الحالة — الحسابُ المرفوض غيرُ موجود
  assert.equal(narrow.hasAccount('expense:over'), false);
});

test('الرفضُ يحمل عددًا مقيسًا لا نصًّا عامًّا', () => {
  const s = bootstrapState({ now: T0 });
  const narrow = new Ledger({ audit: s.audit, maxAccounts: 4 });
  for (let i = 0; i < 4; i += 1) narrow.openAccount(`expense:l-${i}`, 'expense', `مصروف ${i}`, T0);
  const over = narrow.openAccount('expense:x', 'expense', 'مصروف زائد', T0);
  assert.match(over.ok ? '' : over.reason, /4\/4/);
});

test('**الموازنةُ ترفض البندَ فوق سقف العدد** ويُسجَّل العددان', () => {
  const { s, declare } = budgetState();
  // سقفُ عددٍ ضيّقٌ في موازنةٍ منفصلة: لا تُعدَّل تهيئةُ الدولة المُقلعة
  const narrow = new Budget({
    audit: s.audit, gateway: s.gateway, ceilingTotal: 1_000_000, maxLines: 2,
    carryoverAllowed: false,
  });
  narrow.bindOwnerProbe(() => true);
  const command = (line: string) =>
    s.king.issueCommand('amend_policy', line, { kind: 'economy' }, T0);
  const mk = (line: string) => narrow.declare(command(line), {
    line, owner: 'ministry:infrastructure', ceiling: 1,
    periodStart: T0, periodEnd: T0 + DAY,
  }, T0);
  assert.equal(mk('budget:a').ok, true);
  assert.equal(mk('budget:b').ok, true);
  const over = mk('budget:c');
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.reason, /سقف عدد بنود الموازنة المعلن بلغ: 2\/2/);
  const refusal = s.audit.find('budget_refused').at(-1);
  assert.equal((refusal?.detail as { maxLines: number }).maxLines, 2);
  assert.equal(narrow.report().lines, 2);
  assert.equal(declare('budget:untouched').ok, true);
});

test('**السقفُ الماليّ وحده لا يحرس العدد** — قياسٌ لا دعوى', () => {
  const s = bootstrapState({ now: T0 });
  // سقفٌ ماليٌّ فسيح وسقفُ عددٍ ضيّق: بنودٌ بريالٍ واحدٍ تمرّ من الأوّل وتُردّ بالثاني
  const narrow = new Budget({
    audit: s.audit, gateway: s.gateway, ceilingTotal: 1_000_000_000, maxLines: 3,
    carryoverAllowed: false,
  });
  narrow.bindOwnerProbe(() => true);
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < 10; i += 1) {
    const line = `budget:tiny-${i}`;
    const r = narrow.declare(
      s.king.issueCommand('amend_policy', line, { kind: 'economy' }, T0),
      { line, owner: 'ministry:infrastructure', ceiling: 1, periodStart: T0, periodEnd: T0 + DAY },
      T0,
    );
    if (r.ok) accepted += 1; else refused += 1;
  }
  assert.equal(accepted, 3);
  assert.equal(refused, 7);
  // والمجموعُ الماليّ ثلاثةُ ريالاتٍ من مليار: السقفُ الماليّ لم يكن ليردّ واحدًا منها
  assert.equal(narrow.report().ceilings, 3);
});

test('إعادةُ إقرارِ بندٍ ساقطٍ لا تُحسب على سقف العدد (استبدالُ صفٍّ لا زيادتُه)', () => {
  const s = bootstrapState({ now: T0 });
  const narrow = new Budget({
    audit: s.audit, gateway: s.gateway, ceilingTotal: 1_000_000, maxLines: 1,
    carryoverAllowed: false,
  });
  narrow.bindOwnerProbe(() => true);
  // فترةٌ قصيرةٌ عن قصد: السقوط لا يقع قبل نهاية الفترة، والقفزُ يومًا كاملًا
  // يُدخل الدولةَ في وضع الحماية لغياب نبض الملك — فيُرفض الأمر لا للسقف.
  const SHORT = 2_000;
  const mk = (line: string, at: number) => narrow.declare(
    s.king.issueCommand('amend_policy', line, { kind: 'economy' }, at),
    { line, owner: 'ministry:infrastructure', ceiling: 10, periodStart: at, periodEnd: at + SHORT },
    at,
  );
  assert.equal(mk('budget:one', T0).ok, true);
  assert.equal(mk('budget:two', T0).ok, false);
  // السقوطُ لا يقع قبل نهاية الفترة: الزمنُ مقيسٌ لا مُفترض
  const afterPeriod = T0 + SHORT + 1;
  assert.equal(narrow.lapse('budget:one', afterPeriod).ok, true);
  // الساقطُ يبقى صفًّا، فبندٌ جديدٌ يبقى مرفوضًا…
  assert.equal(mk('budget:two', afterPeriod + 1).ok, false);
  // …وإعادةُ إقرارِ الساقط نفسه تمرّ لأنها لا تزيد العدد
  assert.equal(mk('budget:one', afterPeriod + 2).ok, true);
  assert.equal(narrow.report().lines, 1);
});

test('**بابُ الإرجاع محروسٌ كبابِ الفتح** — فشلٌ مغلقٌ لا رفضٌ مسجَّل', () => {
  const s = bootstrapState({ now: T0 });
  const narrowLedger = new Ledger({ audit: s.audit, maxAccounts: SOVEREIGN_ACCOUNTS });
  assert.throws(
    () => narrowLedger.restore({
      accounts: [
        { accountId: 'a:1', kind: 'expense', name: 'أ', openedAt: T0 },
        { accountId: 'a:2', kind: 'expense', name: 'ب', openedAt: T0 },
        { accountId: 'a:3', kind: 'expense', name: 'ج', openedAt: T0 },
        { accountId: 'a:4', kind: 'expense', name: 'د', openedAt: T0 },
      ],
      entries: [], closedThrough: null,
    }, ROYAL_COURT),
    /RECOVERY_LEDGER_ACCOUNT_CAP/,
  );
  const narrowBudget = new Budget({
    audit: s.audit, gateway: s.gateway, ceilingTotal: 1_000_000, maxLines: 1,
    carryoverAllowed: false,
  });
  assert.throws(
    () => narrowBudget.restore([
      {
        line: 'budget:x', owner: 'ministry:infrastructure', ceiling: 10, spent: 0,
        periodStart: T0, periodEnd: T0 + DAY, commandId: 'c1',
        lapsedAt: null, lapsedAmount: null,
      },
      {
        line: 'budget:y', owner: 'ministry:infrastructure', ceiling: 10, spent: 0,
        periodStart: T0, periodEnd: T0 + DAY, commandId: 'c2',
        lapsedAt: null, lapsedAmount: null,
      },
    ], ROYAL_COURT),
    /RECOVERY_BUDGET_LINE_CAP/,
  );
});

test('الدولةُ المُقلعة تحمل سقفَي التهيئة لا قيمًا من الكود', () => {
  const s = bootstrapState({ now: T0 });
  const economy = loadEconomy();
  // حسابات التأسيس الثلاثة قائمة، والسقفُ المعلن أوسعُ منها فالإقلاع لم يُردّ
  assert.equal(s.ledger.report().accounts, SOVEREIGN_ACCOUNTS);
  assert.equal(economy.ledger.max_accounts > SOVEREIGN_ACCOUNTS, true);
  // ولا بندَ موازنةٍ في التأسيس: الإقرارُ فعلٌ ملكيٌّ لا خطوةُ تأسيس
  assert.equal(s.budget.report().lines, 0);
  assert.equal(economy.budget.max_lines > 0, true);
});
