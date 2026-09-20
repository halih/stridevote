import type { ProgramQuestion } from "@/lib/canvass/outcomes";
import type {
  CivibyteCanvassAnswer,
  CivibyteSurvey,
} from "@/lib/civibyte/client";

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function answerValues(value: unknown): Array<string | number | boolean> {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string | number | boolean =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [value];
  }
  return [];
}

function mapAnswer(
  question: NonNullable<CivibyteSurvey>["questions"][number],
  value: unknown,
): CivibyteCanvassAnswer | null {
  const values = answerValues(value);
  if (!values.length) return null;
  const responseType = question.responseType.toLowerCase();

  if (question.options.length) {
    const optionIds = values.flatMap((raw) => {
      if (typeof raw === "number") {
        const byOrder = question.options.find(
          (option) => option.displayOrder === raw,
        );
        return byOrder ? [byOrder.id] : [];
      }
      const label =
        typeof raw === "boolean" ? (raw ? "yes" : "no") : String(raw);
      const option = question.options.find(
        (candidate) => normalized(candidate.label) === normalized(label),
      );
      return option ? [option.id] : [];
    });
    if (!optionIds.length) return null;
    return {
      questionId: question.questionId,
      answerOptionIds: responseType.includes("single")
        ? optionIds.slice(0, 1)
        : optionIds,
      textValue: null,
      numericValue: null,
    };
  }

  if (responseType.includes("number") || responseType.includes("numeric")) {
    const numericValue = Number(values[0]);
    if (!Number.isFinite(numericValue)) return null;
    return {
      questionId: question.questionId,
      answerOptionIds: [],
      textValue: null,
      numericValue,
    };
  }

  return {
    questionId: question.questionId,
    answerOptionIds: [],
    textValue: values.map(String).join(", "),
    numericValue: null,
  };
}

/**
 * Civibyte rejects a whole batch when a contacted voter is missing an answer to
 * a required survey question, so doors like that must be held back locally.
 */
export function civibyteRequiredAnswersMissing(
  survey: CivibyteSurvey | null | undefined,
  voters: Array<{ answers: CivibyteCanvassAnswer[] }>,
): boolean {
  const required = (survey?.questions ?? []).filter(
    (question) => question.required === true,
  );
  if (!required.length) return false;
  return voters.some((voter) => {
    const answered = new Set(voter.answers.map((answer) => answer.questionId));
    return required.some((question) => !answered.has(question.questionId));
  });
}

export function civibyteAnswersForPerson(input: {
  survey: CivibyteSurvey | null | undefined;
  programQuestions: ProgramQuestion[];
  support: number | null;
  answers: unknown;
}): CivibyteCanvassAnswer[] {
  if (!input.survey) return [];
  const localAnswers =
    input.answers &&
    typeof input.answers === "object" &&
    !Array.isArray(input.answers)
      ? (input.answers as Record<string, unknown>)
      : {};
  const mapped = new Map<number, CivibyteCanvassAnswer>();

  for (const sourceQuestion of input.survey.questions) {
    const sourceNames = [
      sourceQuestion.text,
      sourceQuestion.internalLabel ?? "",
    ].map(normalized);
    const localQuestion = input.programQuestions.find((candidate) => {
      const label = normalized(candidate.label);
      return label && sourceNames.includes(label);
    });
    const supportQuestion =
      sourceNames.some((name) => name.includes("support")) &&
      sourceQuestion.options.length === 5;
    const value =
      supportQuestion && input.support != null
        ? input.support
        : localQuestion
          ? localAnswers[localQuestion.id]
          : undefined;
    const answer = mapAnswer(sourceQuestion, value);
    if (answer) mapped.set(answer.questionId, answer);
  }

  return [...mapped.values()];
}
