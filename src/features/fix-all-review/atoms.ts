import { Atom, Result } from "@effect-atom/atom-react";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { type ReviewEvaluation, ReviewItem } from "./schema";
import { ReviewLab } from "./service";

const runtime = Atom.runtime(ReviewLab.layer);

type ReviewItemsUpdate = Data.TaggedEnum<{
  readonly PatchItem: { readonly item: ReviewItem; };
  readonly SetEvaluation: {
    readonly itemId: string;
    readonly evaluation: ReviewEvaluation;
  };
}>;

const { PatchItem, SetEvaluation } = Data.taggedEnum<ReviewItemsUpdate>();

export const reviewItemsAtom = (() => {
  const remoteAtom = runtime.atom(
    Effect.gen(function*() {
      const lab = yield* ReviewLab;
      return yield* lab.loadBoard();
    }),
  );

  return Atom.writable(
    (get) => get(remoteAtom),
    (context, update: ReviewItemsUpdate) => {
      const current = context.get(reviewItemsAtom);

      if (!Result.isSuccess(current)) {
        return;
      }

      context.setSelf(
        Result.success(
          current.value.map((item) => {
            if (update._tag === "PatchItem" && item.id === update.item.id) {
              return update.item;
            }

            if (update._tag === "SetEvaluation" && item.id === update.itemId) {
              return new ReviewItem({
                id: item.id,
                title: item.title,
                owner: item.owner,
                dueDate: item.dueDate,
                content: item.content,
                evaluation: update.evaluation,
              });
            }

            return item;
          }),
        ),
      );
    },
    (refresh) => refresh(remoteAtom),
  );
})();

export const runItemReviewAtom = Atom.family((itemId: string) => {
  void itemId;

  return runtime
    .fn(
      Effect.fn(function*(
        payload: {
          readonly itemId: string;
          readonly title: string;
          readonly content: string;
        },
        get: Atom.FnContext,
      ) {
        const lab = yield* ReviewLab;
        const evaluation = yield* lab.runReview(payload);
        get.set(
          reviewItemsAtom,
          SetEvaluation({
            itemId: payload.itemId,
            evaluation,
          }),
        );
        return evaluation;
      }),
    )
    .pipe(Atom.setIdleTTL(0));
});

export const lastReviewSourceAtom: Atom.Writable<"manual" | "fixAll" | null> = Atom.make(
  null as "manual" | "fixAll" | null,
);

export const runReviewsAtom = runtime
  .fn(
    Effect.fn(function*(
      params: {
        readonly itemIds: readonly string[] | "all";
        readonly source: "manual" | "fixAll";
      },
      get: Atom.FnContext,
    ) {
      get.set(lastReviewSourceAtom, params.source);

      const items = yield* get.result(reviewItemsAtom, { suspendOnWaiting: true });
      const selectedItems = params.itemIds === "all"
        ? items
        : items.filter((item) => params.itemIds.includes(item.id));

      if (selectedItems.length === 0) {
        return {
          successCount: 0,
          failureCount: 0,
          source: params.source,
          failures: [] as readonly Cause.Cause<unknown>[],
        };
      }

      const [failed, succeeded] = yield* Effect.partition(
        selectedItems,
        (item) => {
          get.set(runItemReviewAtom(item.id), {
            itemId: item.id,
            title: item.title,
            content: item.content,
          });

          return get
            .result(runItemReviewAtom(item.id), { suspendOnWaiting: true })
            .pipe(Effect.catchAllCause((cause) => Effect.fail(cause)));
        },
        { concurrency: "unbounded" },
      );

      return {
        successCount: succeeded.length,
        failureCount: failed.length,
        source: params.source,
        failures: failed,
      };
    }),
  )
  .pipe(Atom.setIdleTTL("45 seconds"));

export const fixAllAtom = runtime
  .fn(
    Effect.fn(function*(_: void, get: Atom.FnContext) {
      const lab = yield* ReviewLab;
      const items = yield* get.result(reviewItemsAtom, { suspendOnWaiting: true });

      const itemsToFix = items.filter(
        (item): item is ReviewItem & { readonly evaluation: ReviewEvaluation; } =>
          item.evaluation !== null && !item.evaluation.passed,
      );

      if (itemsToFix.length === 0) {
        return {
          successCount: 0,
          failureCount: 0,
          causes: [] as readonly Cause.Cause<unknown>[],
        };
      }

      const results = yield* Effect.forEach(
        itemsToFix,
        (item) =>
          Effect.gen(function*() {
            const preview = yield* lab.previewFix(item);
            const updatedItem = yield* lab.applyFix(item, preview.nextContent);

            get.set(
              reviewItemsAtom,
              PatchItem({
                item: updatedItem,
              }),
            );

            return item.id;
          }).pipe(Effect.exit),
        { concurrency: 2 },
      );

      const succeeded: string[] = [];
      const causes: Cause.Cause<unknown>[] = [];

      for (const result of results) {
        if (Exit.isSuccess(result)) {
          succeeded.push(result.value);
        } else {
          causes.push(result.cause);
        }
      }

      if (succeeded.length > 0) {
        get.set(runReviewsAtom, {
          itemIds: succeeded,
          source: "fixAll",
        });
      }

      return {
        successCount: succeeded.length,
        failureCount: causes.length,
        causes,
      };
    }),
  )
  .pipe(Atom.setIdleTTL("45 seconds"));
