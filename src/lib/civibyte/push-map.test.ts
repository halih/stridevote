import { test } from "node:test";
import assert from "node:assert/strict";
import { civibyteAnswersForPerson } from "./push-map";

const survey = {
  id: 14,
  name: "Default",
  questions: [
    {
      questionId: 13,
      text: "Will you support the candidate?",
      internalLabel: "Support 5-point",
      responseType: "single_select",
      displayOrder: 1,
      options: [1, 2, 3, 4, 5].map((displayOrder) => ({
        id: 69 + displayOrder,
        label: `Support ${displayOrder}`,
        displayOrder,
      })),
    },
    {
      questionId: 20,
      text: "Top issue",
      internalLabel: null,
      responseType: "single_select",
      displayOrder: 2,
      options: [
        { id: 80, label: "Housing", displayOrder: 1 },
        { id: 81, label: "Transit", displayOrder: 2 },
      ],
    },
  ],
};

test("maps support score by option order and program answers by label", () => {
  assert.deepEqual(
    civibyteAnswersForPerson({
      survey,
      programQuestions: [
        { id: "issue", type: "single", label: "Top issue", options: ["Housing", "Transit"] },
      ],
      support: 5,
      answers: { issue: "Transit" },
    }),
    [
      {
        questionId: 13,
        answerOptionIds: [74],
        textValue: null,
        numericValue: null,
      },
      {
        questionId: 20,
        answerOptionIds: [81],
        textValue: null,
        numericValue: null,
      },
    ],
  );
});

test("omits answers that cannot be matched safely", () => {
  assert.deepEqual(
    civibyteAnswersForPerson({
      survey,
      programQuestions: [{ id: "other", type: "text", label: "Different question" }],
      support: null,
      answers: { other: "free text" },
    }),
    [],
  );
});
