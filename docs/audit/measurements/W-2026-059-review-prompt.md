# W-2026-059 — نصُّ الطلب الموجَّه للمراجعَين (قالبٌ واحد؛ {ROOT} = /tmp/review-W-2026-059/reviewer-gpt أو reviewer-grok)
# sha256(القالب)=0ff4d52f4e306292100baa2596d308e5e4e7e0326a865bd4ba8cda915e814cad · gpt=5b9b4d29ca4af41854b76c827b45c759fcc122bdd8e0eded364915efed1a9d60 · grok=faa00daa91861dd2f8b48c8799469dd43ba13ecfc2ca28d4c6addd1870dc5869
# المراجعان: GPT 6.1 Sol (OpenAI) · Grok 4.7 (xAI) — هويّةٌ مُعلَنة (RULE-019 §12-1)

You are an independent, adversarial reviewer. Your job is to find defects and reasons to REFUSE an upgrade, not to approve.

SCOPE OF ACCESS (mandatory):
- Read ONLY files under: {ROOT}/bundle/
- Do NOT read, list, or follow any other path on this machine (no repository, no /home/user/workspace, no other /tmp paths, no other reviewer's directory). Do not use web search or external services.
- Write exactly one file: {ROOT}/review.txt . Write nothing else anywhere.
- First verify the bundle: run `cd {ROOT}/bundle && sha256sum -c MANIFEST.sha256` and `sha256sum MANIFEST.sha256`; report the result. Expected root: {BUNDLE_ROOT}.

QUESTION:
Criterion C-17 ("إدارة ملايين الوكلاء داخل عتبة الاستجابة" — managing millions of agents within the response threshold) is currently "⚠️ فجوة" (gap), with open item T-85. A prior blind review (criterion/C-17-prior-verdict.md) upheld the gap, chiefly because the declared configuration capped population at one million and the 3M runs used an uncommitted /tmp config. Since then, the repository owner decided (decision/owner-decision-2026-10-03.md) to raise the declared cap to 3,000,000 and that population distribution time is outside the response threshold. New measurements are in measurements/ (files *-3m-declared*, *-3m-post-T119*), with prior raw files kept for comparison; source of the benchmark and threshold logic in source/; config diff in diff/; gate results in gates/; rules for open items and external conditions in criterion/.

Decide, on this evidence alone:
1. T-85: should it be closed? Note what its row requires and whether the evidence satisfies exactly that.
2. C-17: should it be upgraded to ✅ (مستوفى)? Consider EVERY condition the criterion files tie to C-17, not only T-85.
Check, among other things: whether the measurement exercises what the criterion means by "managing" agents vs. a narrow call; sample size and tail headroom; consistency between raw files and summaries; whether the benchmark could be measuring something other than what it claims; the owner decision's legitimacy and limits; any instrument that still measures the old cap; and any remaining external condition.

OUTPUT FORMAT (review.txt):
- Line 1: identity declaration (provider and model name as you know them; say if you cannot know the exact identifier).
- Line 2: isolation declaration (what you read; confirm you read nothing outside {ROOT}/bundle/).
- Bundle verification result.
- "## VERDICT TABLE" with rows for T-85 and C-17. Verdict for each: one of CLOSE / KEEP_OPEN (T-85) and UPGRADE_TO_MET / UPHELD_GAP / INSUFFICIENT_EVIDENCE (C-17), plus a SCREAMING_SNAKE_CASE named defect when not closing/upgrading.
- One reasoned section per verdict citing the specific files and numbers.
- "## RESIDUAL DEBT" — named non-blocking risks.
- "## PACKAGE DEFECTS" — anything missing or inconsistent in the bundle itself.
Write in English. Be specific and terse. Do not soften.
