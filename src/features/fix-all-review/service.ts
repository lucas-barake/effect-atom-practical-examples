import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ReviewEvaluation, ReviewItem, ReviewViolation } from "./schema";

const evaluateContent = (content: string) => {
  const violations: ReviewViolation[] = [];

  if (!content.includes("Owner:")) {
    violations.push(
      new ReviewViolation({
        code: "owner",
        message: "Add a clear owner so the follow up is accountable.",
      }),
    );
  }

  if (!content.includes("By ")) {
    violations.push(
      new ReviewViolation({
        code: "dueDate",
        message: "Add a concrete due date to remove timing ambiguity.",
      }),
    );
  }

  if (content.split(/\s+/).filter(Boolean).length < 18) {
    violations.push(
      new ReviewViolation({
        code: "specificity",
        message: "Add one concrete action and one expected outcome.",
      }),
    );
  }

  return new ReviewEvaluation({
    passed: violations.length === 0,
    violations,
  });
};

const repairContent = (item: ReviewItem & { readonly evaluation: ReviewEvaluation; }) =>
  [
    item.content,
    item.content.includes("Owner:") ? null : `Owner: ${item.owner}.`,
    item.content.includes("By ")
      ? null
      : `By ${item.dueDate}, complete the handoff and confirm the next action.`,
    item.content.split(/\s+/).filter(Boolean).length >= 18
      ? null
      : "Spell out the exact review task, the success condition, and the one place people should reply.",
  ]
    .filter((value): value is string => value !== null)
    .join(" ");

const make = Effect.sync(() => {
  const baseItems = [
    new ReviewItem({
      id: "launch-brief",
      title: "Launch checklist",
      owner: "Mina",
      dueDate: "Friday",
      content:
        "Share the launch checklist with the team and ask everyone to look at the latest changes before we ship.",
      evaluation: null,
    }),
    new ReviewItem({
      id: "renewal-note",
      title: "Renewal follow up",
      owner: "Jordan",
      dueDate: "Tuesday",
      content: "Reach out to renewal accounts soon.",
      evaluation: null,
    }),
    new ReviewItem({
      id: "onboarding-mail",
      title: "Admin onboarding",
      owner: "Rhea",
      dueDate: "Monday",
      content:
        "Owner: Rhea. By Monday, send the onboarding note with the three admin setup steps, the support link, and the expected first week outcome.",
      evaluation: null,
    }),
  ] as const;

  return {
    loadBoard: () =>
      Effect.sleep("250 millis").pipe(
        Effect.as(
          baseItems.map(
            (item) =>
              new ReviewItem({
                id: item.id,
                title: item.title,
                owner: item.owner,
                dueDate: item.dueDate,
                content: item.content,
                evaluation: evaluateContent(item.content),
              }),
          ),
        ),
      ),
    runReview: (item: {
      readonly itemId: string;
      readonly title: string;
      readonly content: string;
    }) =>
      Effect.sleep(item.itemId === "renewal-note" ? "900 millis" : "550 millis").pipe(
        Effect.as(evaluateContent(item.content)),
      ),
    previewFix: (item: ReviewItem & { readonly evaluation: ReviewEvaluation; }) =>
      Effect.sleep("350 millis").pipe(
        Effect.as({
          nextContent: repairContent(item),
          note: `Prepared a revision for ${item.title}.`,
        }),
      ),
    applyFix: (item: ReviewItem, nextContent: string) =>
      Effect.sleep("300 millis").pipe(
        Effect.as(
          new ReviewItem({
            id: item.id,
            title: item.title,
            owner: item.owner,
            dueDate: item.dueDate,
            content: nextContent,
            evaluation: null,
          }),
        ),
      ),
  } as const;
});

export class ReviewLab extends Context.Tag("ReviewLab")<
  ReviewLab,
  {
    readonly loadBoard: () => Effect.Effect<readonly ReviewItem[]>;
    readonly runReview: (item: {
      readonly itemId: string;
      readonly title: string;
      readonly content: string;
    }) => Effect.Effect<ReviewEvaluation>;
    readonly previewFix: (
      item: ReviewItem & { readonly evaluation: ReviewEvaluation; },
    ) => Effect.Effect<{
      readonly nextContent: string;
      readonly note: string;
    }>;
    readonly applyFix: (item: ReviewItem, nextContent: string) => Effect.Effect<ReviewItem>;
  }
>() {
  static layer = Layer.effect(this, make);
}
