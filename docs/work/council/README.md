# محاضرُ مجلس المراجعة

> **القاعدة الحاكمة RULE-000:** وثّق كل ما قمت به واترك ما تبقّى. النص: [`GOVERNING_RULE.md`](../../../GOVERNING_RULE.md)

السلطة: [أمر المالك في ADR-0054](../../decisions/ADR-0054-review-council.md) · القاعدة: RULE-020 · الإجراء: [`../REVIEW_COUNCIL.md`](../REVIEW_COUNCIL.md)

لكلِّ جلسةٍ ملفٌّ `W-YYYY-NNN.json` (أو `W-YYYY-NNN-<n>.json` لجلسةٍ تالية على البند نفسه)، وتقريرٌ خامٌّ لكلِّ عضو `W-YYYY-NNN-<member>.md`.
والحارسُ `tests/governance/review_council.test.ts` يقرأ هذا المجلد مع `WORK_QUEUE.json` في كلِّ `npm test`.

```json
{
  "item": "W-2026-0NN",
  "commit": "<هاشُ الالتزامة المُراجَعة>",
  "scope_digest": "<sha256 لنطاق البند يومَ المراجعة — scopeDigest في scripts/review_council.ts>",
  "executor_family": "Claude",
  "convened_at": "YYYY-MM-DD",
  "verdicts": [
    { "member": "gpt",  "model": "GPT 5.6 Terra",  "verdict": "VERIFIED", "report": "docs/work/council/W-2026-0NN-gpt.md" },
    { "member": "grok", "model": "Grok 4.7", "verdict": "REJECTED", "report": "docs/work/council/W-2026-0NN-grok.md" },
    { "member": "gemini", "model": "Gemini 3.8 Flash", "verdict": "VERIFIED", "report": "docs/work/council/W-2026-0NN-gemini.md" }
  ],
  "decision": "NOT_VERIFIED",
  "disposition": { "kind": "IN_PROGRESS" }
}
```

**`scope_digest` شرطٌ لمحضرِ VERIFIED** (الثابت 6 · علاجُ عيبِ الجلسة 1 `COUNCIL_UNBOUND_REVIEWED_COMMIT`): بصمةُ محتوى ملفّاتِ `scope` من صفِّ البند يومَ المراجعة؛ والحارسُ يعيد حسابَها على الشجرة القائمة فلا يبقى البندُ VERIFIED إن تغيّر نطاقُه بعد الحكم أو كان المحضرُ لغيرِ ما رُوجع.

أوّلُ انعقادٍ: 2026-10-04 (W-2026-066).
