/**
 * tests/external/contract_recovery.test.ts — حارسُ الاستعادةِ لبابِ `importAll` الثالث (T-68)
 * يُثبت: ما يرفضُه بابا `sign`/`terminate` لا يدخلُ من مسلكِ الاستعادة — لا قيمةٌ فوق سقفِ
 *        النوعِ، ولا بعثُ عقدٍ مُنهًى، ولا تفتيتٌ فوق سقفِ النظيرِ، ولا مدّةٌ فوق `maxTermMs`.
 * فُكّكَ من `contract_registry.test.ts` احترامًا لسقفِ الـ400 سطرًا (لا يُرفعُ سقفٌ خاصٌّ أبدًا).
 * يوثّق في: docs/test-reports/phase-27-T68.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPUTE, CROWN_GUARD, DAY, KIND_COMPUTE, assessRisk, contractState, signContract,
  terminateContract,
} from './helpers';

test('**حقنُ انحرافٍ: `importAll` لا يقبل قيمةً تتجاوز سقفَ النوع** — شرط قبول T-68', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  const signed = signContract(h, KIND_COMPUTE, { value: 5_000_000, days: 30 });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;

  const snapshot = h.s.contracts.exportAll();
  const inflated = {
    contracts: snapshot.contracts.map((c) => ({ ...c, value: 900_000_000 })),
    sequence: snapshot.sequence,
  };
  assert.throws(
    () => h.s.contracts.importAll(inflated, CROWN_GUARD),
    /RECOVERY_CONTRACT_INVALID/,
    'قيمةٌ يرفضها `sign` لا تدخل من مسلكِ الاستعادة',
  );
  assert.equal(h.s.contracts.get(signed.contract.contractId)?.value, 5_000_000);
  assert.equal(h.s.contracts.committedValue(COMPUTE, h.now), 5_000_000, 'ولا يتبعُها الملتزَم');
});

test('**حقنُ انحرافٍ: `importAll` لا يبعث عقدًا مُنهًى** — شرط قبول T-68', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  const signed = signContract(h, KIND_COMPUTE, { value: 1_000_000, days: 30 });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const id = signed.contract.contractId;
  assert.equal(terminateContract(h, id).ok, true);
  assert.equal(h.s.contracts.isActive(id, h.now), false);

  const snapshot = h.s.contracts.exportAll();
  const revived = {
    contracts: snapshot.contracts.map((c) => ({
      ...c, terminatedAt: null, terminatedBy: null, terminationReason: null,
    })),
    sequence: snapshot.sequence,
  };
  assert.throws(
    () => h.s.contracts.importAll(revived, CROWN_GUARD),
    /RECOVERY_CONTRACT_INVALID/,
    'الإنهاءُ بابٌ واحدٌ، ونقضُه ليس مسلكَ استعادة',
  );
  assert.equal(h.s.contracts.isActive(id, h.now), false, 'ويبقى مُنهًى');
});

test('**حقنُ انحرافٍ: `importAll` لا يتجاوز سقفَ عددِ العقودِ لنظيرٍ ولا سقفَ المدّة** — شرط قبول T-68', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  const signed = signContract(h, KIND_COMPUTE, { value: 1_000_000, days: 30 });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const snapshot = h.s.contracts.exportAll();
  const first = snapshot.contracts[0];
  assert.ok(first);

  const ceiling = h.s.contracts.report(h.now).maxOpenPerCounterparty;
  const flooded = {
    contracts: Array.from({ length: ceiling + 10 }, (_, i) => ({ ...first, contractId: `extc:injected-${i}` })),
    sequence: snapshot.sequence + ceiling + 10,
  };
  assert.throws(
    () => h.s.contracts.importAll(flooded, CROWN_GUARD),
    /RECOVERY_CONTRACT_INVALID/,
    'سقفُ النظيرِ (ثابت 6) يُحكم على المستعادِ كما يُحكم على الموقَّع',
  );
  assert.equal(h.s.contracts.active(h.now).length, 1);

  const overlong = {
    contracts: [{ ...first, endsAt: h.now + 3650 * DAY }],
    sequence: snapshot.sequence,
  };
  assert.throws(
    () => h.s.contracts.importAll(overlong, CROWN_GUARD),
    /RECOVERY_CONTRACT_INVALID/,
    'ومدّةٌ فوق `maxTermMs` (ثابت 5) لا تدخل من الخلف',
  );
  assert.equal(h.s.contracts.get(signed.contract.contractId)?.endsAt, h.now + 30 * DAY);
});
