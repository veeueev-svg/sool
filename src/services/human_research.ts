/**
 * src/services/human_research.ts — بحث نظري في النظير البشري ودروس قابلة للتتبع (المرحلة 30)
 * المالك: وزارة البحث
 * المدخلات: مصادر research.yaml المعلنة، قسم مرآة قائم، أمر ملكي establish_research، ودرس مستقل الإجازة
 * المخرجات: بحث مؤقت، درس مجاز أو مرفوض، توصية مسجلة فقط، وسلسلة مصدر قابلة للتتبع
 * التبعيات: بوابة التاج، سجل التدقيق، مِجس قسم المرآة، وحصة egress_calls الصفرية
 * الصلاحيات: إقامة/إقفال البحث وإجازة الدرس ومراجعته وتسجيل التوصية عبر التاج؛ لا اتصال ولا سياسة
 * السجلات: human_research_started / human_research_completed / human_research_refused /
 *          lesson_proposed / lesson_approved / lesson_refused / lesson_reviewed /
 *          recommendation_recorded / recommendation_refused / research_trace_read / research_trace_refused
 * حالات الفشل: مصدر أو نوع أو منهج أو بشر أو خروج أو حد أو مدة أو إسناد أو إجازة مخالف => رفض مغلق
 * اختبارات الوحدة: tests/services/human_research.test.ts
 * اختبار القبول: tests/services/research_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0014-human-research.md
 * البحث نظري في النظير البشري عبر مصادر معلنة، ولا يمس إنسانًا ولا بياناته.
 * ثوابت هذه الوحدة:
 *   1) **لا مصدر بلا وثيقة ونوع**: source:* معلن بنوع من القائمة فقط؛ الغريب يرفض البحث كله.
 *   2) **النظري وحده**: تجربة وتدخل ورصد ومسح واستبيان وتواصل مرفوضة بأكواد معلنة.
 *   3) **الصفر بابان للخروج**: الطلب غير الصفري وحصة egress_calls غير الصفرية كلاهما يوقفان البحث.
 *   4) **لا مستفيد بشري**: الدرس والتوصية لا يوجهان إلا إلى agent:*.
 *   5) **لا بحث دائم ولا تجاوز للسقوف**: المدة والأقسام والبحوث والمصادر حدود تهيئة تمارس عندها وفوقها.
 *   6) **الدرس بسند كامل**: lesson -> research -> declared sources؛ السلسلة المقطوعة ترفض الدرس والتوصية.
 *   7) **من بحث لا يجيز**: الإجازة والمراجعة للجهة المعلنة غير الباحث (RULE-004).
 *   8) **الدرس يبلى ولا يمحى**: بعد المراجعة المعلنة لا يعتمد، ويبقى في السجل حتى يُراجع.
 *   9) **المرآة توصّي فقط**: لا توجد دالة تغيير سياسة؛ تسجيل التوصية ليس تطبيقًا (RULE-005).
 *  10) **الأشكال والحرَس في وحدتين مجاورتين** (المرحلة 39، البند T-113):
 *      `./research/research_types.ts` (إعلانٌ لا سلوك) و`./research/research_guards.ts`
 *      (شروطُ مدخل البحث دالّةً نقيّة) — بهذا نزل هذا الملف من **531** إلى ما تحت السقف
 *      العام (400) وحُذف صفُّ استثنائه من `config/module_limits.yaml` (سقّاطةُ الدَّين:
 *      يُحذف ولا يُرفع). والنصُّ منقولٌ حرفيًّا: لا إصلاح ولا تحسين في أثناء التفكيك،
 *      والدليلُ خطُّ الأساس نفسه أخضر بعده.
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { guardResearchStart } from './research/research_guards';
import {
  DeclaredResearchSource, HumanResearch, HumanResearchDeps, Lesson, LessonInput, LessonResult,
  Recommendation, RecommendationResult, ResearchInput, ResearchResult, SourceInvalidationResult,
  TraceResult,
} from './research/research_types';

// أشكالُ البحث والدرس والتوصية في `./research/research_types` — إعلانٌ لا سلوك،
// ويُعاد تصديرها هنا فلا يتغيّر السطح العام ولا يُعدَّل مستوردٌ ولا اختبار (T-113)
export type {
  ResearchStudyType, ResearchStatus, LessonStatus, DeclaredResearchSource, HumanResearch,
  ResearchInput, Lesson, LessonInput, Recommendation, ResearchResult, LessonResult,
  RecommendationResult, ResearchTrace, TraceResult, SourceInvalidationResult,
  DepartmentActiveProbe, HumanResearchDeps,
} from './research/research_types';
export type { ResearchRefusal, ResearchStartState } from './research/research_guards';
export { guardResearchStart } from './research/research_guards';

export class HumanResearchRegistry {
  private readonly research = new Map<string, HumanResearch>();
  private readonly lessons = new Map<string, Lesson>();
  private readonly recommendations = new Map<string, Recommendation>();
  private readonly sources = new Map<string, DeclaredResearchSource>();
  private readonly invalidSources = new Set<string>();
  private readonly allowedSourceTypes = new Set(['public_literature', 'statistical_aggregate', 'historical_record']);

  constructor(private readonly deps: HumanResearchDeps) {
    for (const source of deps.sources) this.sources.set(source.id, source);
  }

  private researchRefusal(
    researchId: string, code: string, reason: string, actor: EntityId, extra: Record<string, unknown> = {},
  ): ResearchResult {
    const entry = this.deps.audit.append(actor, 'human_research_refused', { researchId, code, reason, ...extra });
    return { ok: false, code, reason, auditId: entry.hash };
  }

  private lessonRefusal(
    lessonId: string, code: string, reason: string, actor: EntityId, extra: Record<string, unknown> = {},
  ): LessonResult {
    const entry = this.deps.audit.append(actor, 'lesson_refused', { lessonId, code, reason, ...extra });
    return { ok: false, code, reason, auditId: entry.hash };
  }

  private traceRefusal(lessonId: string, code: string, reason: string, by: EntityId): TraceResult {
    const entry = this.deps.audit.append(by, 'research_trace_refused', { lessonId, code, reason });
    return { ok: false, code, reason, auditId: entry.hash };
  }

  start(command: SignedRoyalCommand, input: ResearchInput, now = Date.now()): ResearchResult {
    const refuse = (code: string, reason: string, extra: Record<string, unknown> = {}) =>
      this.researchRefusal(input.researchId, code, reason, input.researcher, extra);
    // الشروطُ كلُّها في `./research/research_guards` — دالّةٌ نقيّة تُقرأ وحدها،
    // والرفضُ يُقيَّد هنا بحدثه المعلن، والاعتمادُ يبقى بعده في هذا الصنف (RULE-004)
    const refusal = guardResearchStart(command, input, now, this.deps, {
      hasResearch: (researchId) => this.research.has(researchId),
      activeCount: (at) => this.active(at).length,
      sourceOf: (sourceId) => this.sources.get(sourceId),
      sourceInvalidated: (sourceId) => this.invalidSources.has(sourceId),
      allowedSourceType: (type) => this.allowedSourceTypes.has(type),
    });
    if (refusal) return refuse(refusal.code, refusal.reason, refusal.extra ?? {});
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('RESEARCH_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    const research: HumanResearch = {
      researchId: input.researchId,
      departmentId: input.departmentId,
      functionMinistry: input.functionMinistry,
      sourceIds: [...input.sourceIds],
      studyType: input.studyType,
      researcher: input.researcher,
      beneficiary: input.beneficiary,
      purpose: input.purpose.trim(),
      establishedAt: now,
      expiresAt: input.expiresAt,
      commandId: command.payload.commandId,
      status: 'active',
      completedAt: null,
      dissolvedAt: null,
    };
    this.research.set(research.researchId, research);
    const entry = this.deps.audit.append(input.researcher, 'human_research_started', {
      researchId: research.researchId,
      departmentId: research.departmentId,
      functionMinistry: research.functionMinistry,
      sourceIds: research.sourceIds,
      studyType: research.studyType,
      egressCalls: 0,
      expiresAt: research.expiresAt,
      commandId: research.commandId,
    });
    return { ok: true, research, auditId: entry.hash };
  }

  complete(command: SignedRoyalCommand, researchId: string, by: EntityId, now = Date.now()): ResearchResult {
    const research = this.research.get(researchId);
    const refuse = (code: string, reason: string) => this.researchRefusal(researchId, code, reason, by);
    if (!research) return refuse('RESEARCH_NOT_FOUND', 'البحث غير قائم');
    if (!this.isActive(researchId, now)) return refuse('RESEARCH_NOT_ACTIVE', 'بحث غير قائم أو منته ولا يقبل نتيجة متأخرة');
    if (by !== research.researcher) return refuse('RESEARCH_COMPLETER_REFUSED', 'إقفال البحث لباحثه المعلن وحده');
    if (command.payload.action !== 'establish_research' || command.payload.target !== researchId) {
      return refuse('RESEARCH_CROWN_PATH_REFUSED', 'إقفال البحث بفعل establish_research وهدف مطابق فقط (RULE-003)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('RESEARCH_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    research.status = 'completed';
    research.completedAt = now;
    const entry = this.deps.audit.append(by, 'human_research_completed', { researchId, at: now, commandId: command.payload.commandId });
    return { ok: true, research, auditId: entry.hash };
  }

  proposeLesson(input: LessonInput, now = Date.now()): LessonResult {
    const refuse = (code: string, reason: string) => this.lessonRefusal(input.lessonId, code, reason, input.proposedBy);
    if (typeof input.lessonId !== 'string' || !input.lessonId.startsWith('lesson:')) return refuse('LESSON_ID_REFUSED', 'معرّف الدرس يجب أن يبدأ lesson:');
    if (this.lessons.has(input.lessonId)) return refuse('LESSON_DUPLICATE_REFUSED', 'درس قائم بهذا المعرّف');
    const research = this.research.get(input.researchId);
    if (!research || research.status !== 'completed') return refuse('LESSON_RESEARCH_INCOMPLETE', 'لا درس من بحث غير مكتمل');
    if (input.proposedBy !== research.researcher) return refuse('LESSON_PROPOSER_REFUSED', 'اقتراح الدرس لباحثه المعلن وحده');
    if (typeof input.statement !== 'string' || input.statement.trim().length < 3) return refuse('LESSON_STATEMENT_REFUSED', 'لا درس بلا نص معلن');
    if (!Number.isSafeInteger(input.qualityScore) || input.qualityScore < 0 || input.qualityScore > 100) {
      return refuse('LESSON_SCORE_INVALID', 'درجة الدرس يجب أن تكون صحيحة بين صفر ومئة');
    }
    const lesson: Lesson = {
      lessonId: input.lessonId,
      researchId: input.researchId,
      statement: input.statement.trim(),
      qualityScore: input.qualityScore,
      proposedBy: input.proposedBy,
      proposedAt: now,
      status: 'proposed',
      approvedBy: null,
      approvedAt: null,
      reviewedAt: null,
      rejectionCode: null,
    };
    this.lessons.set(lesson.lessonId, lesson);
    const entry = this.deps.audit.append(input.proposedBy, 'lesson_proposed', {
      lessonId: lesson.lessonId, researchId: lesson.researchId, qualityScore: lesson.qualityScore,
    });
    return { ok: true, lesson, auditId: entry.hash };
  }

  approveLesson(command: SignedRoyalCommand, lessonId: string, approvedBy: EntityId, now = Date.now()): LessonResult {
    const lesson = this.lessons.get(lessonId);
    const refuse = (code: string, reason: string) => this.lessonRefusal(lessonId, code, reason, approvedBy);
    if (!lesson) return refuse('LESSON_NOT_FOUND', 'الدرس غير قائم');
    if (lesson.status !== 'proposed') return refuse('LESSON_ALREADY_CLOSED', 'الدرس أجيز أو رفض سابقا ولا يقفل مرتين');
    const research = this.research.get(lesson.researchId);
    if (!research) return refuse('LESSON_TRACE_BROKEN', 'سلسلة إسناد الدرس مقطوعة عند البحث');
    if (approvedBy !== this.deps.lessonApprover || approvedBy === research.researcher) {
      return refuse('LESSON_SELF_APPROVAL_REFUSED', 'من بحث لا يجيز الدرس؛ الإجازة لجهة معلنة مستقلة (RULE-004)');
    }
    if (lesson.qualityScore < this.deps.minLessonQualityScore) {
      lesson.status = 'rejected';
      lesson.rejectionCode = 'LESSON_QUALITY_BELOW_MINIMUM';
      return refuse('LESSON_QUALITY_BELOW_MINIMUM', 'درجة الدرس دون الحد المعلن');
    }
    const trace = this.traceTo(lessonId, approvedBy);
    if (!trace.ok) {
      lesson.status = 'rejected';
      lesson.rejectionCode = trace.code;
      return refuse(trace.code, 'سلسلة إسناد الدرس مقطوعة؛ لا إجازة');
    }
    if (command.payload.action !== 'establish_research' || command.payload.target !== lessonId) {
      return refuse('LESSON_CROWN_PATH_REFUSED', 'إجازة الدرس بفعل establish_research وهدف مطابق فقط (RULE-003)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('LESSON_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    lesson.status = 'approved';
    lesson.approvedBy = approvedBy;
    lesson.approvedAt = now;
    lesson.reviewedAt = now;
    const entry = this.deps.audit.append(approvedBy, 'lesson_approved', {
      lessonId, researchId: lesson.researchId, qualityScore: lesson.qualityScore,
      reviewedAt: lesson.reviewedAt, commandId: command.payload.commandId,
    });
    return { ok: true, lesson, auditId: entry.hash };
  }

  reviewLesson(command: SignedRoyalCommand, lessonId: string, reviewedBy: EntityId, now = Date.now()): LessonResult {
    const lesson = this.lessons.get(lessonId);
    const refuse = (code: string, reason: string) => this.lessonRefusal(lessonId, code, reason, reviewedBy);
    if (!lesson || lesson.status !== 'approved') return refuse('LESSON_NOT_APPROVED', 'لا مراجعة لدرس غير مجاز');
    if (reviewedBy !== this.deps.lessonApprover) return refuse('LESSON_REVIEWER_REFUSED', 'مراجعة الدرس للجهة المعلنة المستقلة وحدها');
    const trace = this.traceTo(lessonId, reviewedBy);
    if (!trace.ok) return refuse(trace.code, 'سلسلة إسناد الدرس مقطوعة؛ لا مراجعة');
    if (command.payload.action !== 'establish_research' || command.payload.target !== lessonId) {
      return refuse('LESSON_CROWN_PATH_REFUSED', 'مراجعة الدرس بفعل establish_research وهدف مطابق فقط (RULE-003)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('LESSON_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    lesson.reviewedAt = now;
    const entry = this.deps.audit.append(reviewedBy, 'lesson_reviewed', { lessonId, reviewedAt: now, commandId: command.payload.commandId });
    return { ok: true, lesson, auditId: entry.hash };
  }

  recommend(
    command: SignedRoyalCommand, input: { recommendationId: string; lessonId: string; recommendedFor: EntityId; recommendedBy: EntityId; text: string },
    now = Date.now(),
  ): RecommendationResult {
    const refuse = (code: string, reason: string) => {
      const entry = this.deps.audit.append(input.recommendedBy, 'recommendation_refused', {
        recommendationId: input.recommendationId, lessonId: input.lessonId, code, reason,
      });
      return { ok: false as const, code, reason, auditId: entry.hash };
    };
    if (input.recommendedBy !== this.deps.researchOperator) return refuse('RECOMMENDATION_OPERATOR_REFUSED', 'تسجيل التوصية لوزارة البحث المعلنة وحدها');
    if (typeof input.recommendationId !== 'string' || !input.recommendationId.startsWith('recommendation:')) return refuse('RECOMMENDATION_ID_REFUSED', 'معرّف التوصية يجب أن يبدأ recommendation:');
    if (this.recommendations.has(input.recommendationId)) return refuse('RECOMMENDATION_DUPLICATE_REFUSED', 'توصية قائمة بهذا المعرّف');
    if (!input.recommendedFor.startsWith(this.deps.beneficiaryPrefix)) return refuse('RECOMMENDATION_BENEFICIARY_SCOPE_REFUSED', 'التوصية لا توجه إلى بشر؛ المستفيد agent:* فقط');
    if (typeof input.text !== 'string' || input.text.trim().length < 3) return refuse('RECOMMENDATION_TEXT_REFUSED', 'لا توصية بلا نص معلن');
    const lesson = this.lessons.get(input.lessonId);
    if (!lesson || lesson.status !== 'approved') return refuse('RECOMMENDATION_LESSON_REFUSED', 'لا توصية من درس غير مجاز');
    if (!this.lessonUsable(lesson, now)) return refuse('LESSON_STALE', 'الدرس بال؛ انقضت مدة المراجعة ولا يعتمد حتى يراجع');
    const trace = this.traceTo(input.lessonId, input.recommendedBy);
    if (!trace.ok) return refuse(trace.code, 'سلسلة إسناد الدرس مقطوعة؛ التوصية مرفوضة');
    if (command.payload.action !== 'establish_research' || command.payload.target !== input.recommendationId) {
      return refuse('RECOMMENDATION_CROWN_PATH_REFUSED', 'تسجيل التوصية بفعل establish_research وهدف مطابق فقط (RULE-003)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('RECOMMENDATION_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    const recommendation: Recommendation = {
      recommendationId: input.recommendationId,
      lessonId: input.lessonId,
      departmentId: trace.research.departmentId,
      recommendedFor: input.recommendedFor,
      recommendedBy: input.recommendedBy,
      text: input.text.trim(),
      recordedAt: now,
      commandId: command.payload.commandId,
      applied: false,
    };
    this.recommendations.set(recommendation.recommendationId, recommendation);
    const entry = this.deps.audit.append(input.recommendedBy, 'recommendation_recorded', {
      recommendationId: recommendation.recommendationId,
      lessonId: recommendation.lessonId,
      departmentId: recommendation.departmentId,
      recommendedFor: recommendation.recommendedFor,
      applied: false,
      commandId: recommendation.commandId,
    });
    return { ok: true, recommendation, auditId: entry.hash };
  }

  /** يسحب مصدرًا معلنًا من الاستعمال إذا سقط سنده؛ لا يحذف الإعلان أو أبحاثه التاريخية. */
  invalidateSource(
    command: SignedRoyalCommand, sourceId: string, by: EntityId, reason: string, now = Date.now(),
  ): SourceInvalidationResult {
    const refuse = (code: string, why: string) => this.researchRefusal(`research:source:${sourceId}`, code, why, by);
    if (by !== this.deps.lessonApprover) return refuse('SOURCE_INVALIDATOR_REFUSED', 'إبطال مصدر للديوان المستقل المعلن وحده');
    if (!this.sources.has(sourceId)) return refuse('SOURCE_NOT_FOUND', 'مصدر غير معلن لا يبطل ولا يستبدل');
    if (typeof reason !== 'string' || reason.trim().length < 3) return refuse('SOURCE_INVALIDATION_REASON_REFUSED', 'لا إبطال مصدر بلا سبب معلن');
    if (command.payload.action !== 'establish_research' || command.payload.target !== sourceId) return refuse('SOURCE_CROWN_PATH_REFUSED', 'إبطال المصدر يمر بفعل establish_research وهدف مطابق');
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('SOURCE_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    this.invalidSources.add(sourceId);
    const entry = this.deps.audit.append(by, 'research_source_invalidated', { sourceId, reason: reason.trim(), at: now });
    return { ok: true, auditId: entry.hash };
  }

  traceTo(lessonId: string, by: EntityId = this.deps.researchOperator): TraceResult {
    const lesson = this.lessons.get(lessonId);
    if (!lesson) return this.traceRefusal(lessonId, 'TRACE_LESSON_NOT_FOUND', 'لا درس في سلسلة الإسناد', by);
    const research = this.research.get(lesson.researchId);
    if (!research) return this.traceRefusal(lessonId, 'LESSON_TRACE_BROKEN', 'سلسلة الإسناد مقطوعة عند البحث', by);
    const sources: DeclaredResearchSource[] = [];
    for (const sourceId of research.sourceIds) {
      const source = this.sources.get(sourceId);
      if (!source || this.invalidSources.has(sourceId)) {
        return this.traceRefusal(lessonId, 'LESSON_TRACE_BROKEN', 'سلسلة الإسناد مقطوعة عند مصدر معلن', by);
      }
      sources.push(source);
    }
    const entry = this.deps.audit.append(by, 'research_trace_read', {
      lessonId, researchId: research.researchId, sourceIds: research.sourceIds,
    });
    return { ok: true, lesson, research, sources, auditId: entry.hash };
  }

  isActive(researchId: string, now = Date.now()): boolean {
    const item = this.research.get(researchId);
    const active = item !== undefined && item.status === 'active' && item.expiresAt > now
      && this.deps.departmentActive(item.departmentId, now);
    this.deps.audit.append(this.deps.researchOperator, 'human_research_activity_read', { researchId, active, at: now });
    return active;
  }

  lessonUsable(lesson: Lesson, now = Date.now()): boolean {
    const usable = lesson.status === 'approved' && lesson.reviewedAt !== null
      && lesson.reviewedAt + this.deps.reviewIntervalMs > now;
    this.deps.audit.append(this.deps.researchOperator, 'lesson_usability_read', {
      lessonId: lesson.lessonId, usable, at: now,
    });
    return usable;
  }

  get(researchId: string): HumanResearch | null {
    const research = this.research.get(researchId) ?? null;
    this.deps.audit.append(this.deps.researchOperator, 'human_research_read', { researchId, found: research !== null });
    return research;
  }
  lesson(lessonId: string): Lesson | null {
    const lesson = this.lessons.get(lessonId) ?? null;
    this.deps.audit.append(this.deps.researchOperator, 'lesson_read', { lessonId, found: lesson !== null });
    return lesson;
  }
  recommendation(recommendationId: string): Recommendation | null {
    const recommendation = this.recommendations.get(recommendationId) ?? null;
    this.deps.audit.append(this.deps.researchOperator, 'recommendation_read', {
      recommendationId, found: recommendation !== null,
    });
    return recommendation;
  }
  active(now = Date.now()): readonly HumanResearch[] {
    const active = [...this.research.values()].filter((item) => this.isActive(item.researchId, now));
    this.deps.audit.append(this.deps.researchOperator, 'human_research_active_read', { count: active.length, at: now });
    return active;
  }
  history(): readonly HumanResearch[] {
    const research = [...this.research.values()];
    this.deps.audit.append(this.deps.researchOperator, 'human_research_history_read', { count: research.length });
    return research;
  }
  lessonsHistory(): readonly Lesson[] {
    const lessons = [...this.lessons.values()];
    this.deps.audit.append(this.deps.researchOperator, 'lesson_history_read', { count: lessons.length });
    return lessons;
  }
  report(now = Date.now()): { readonly researches: number; readonly active: number; readonly lessons: number; readonly approvedLessons: number; readonly staleLessons: number; readonly recommendations: number } {
    const lessons = this.lessonsHistory();
    return {
      researches: this.research.size,
      active: this.active(now).length,
      lessons: lessons.length,
      approvedLessons: lessons.filter((lesson) => lesson.status === 'approved').length,
      staleLessons: lessons.filter((lesson) => lesson.status === 'approved' && !this.lessonUsable(lesson, now)).length,
      recommendations: this.recommendations.size,
    };
  }
}
