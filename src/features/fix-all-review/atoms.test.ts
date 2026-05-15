import * as Atom from "@effect-atom/atom/Atom";
import * as Registry from "@effect-atom/atom/Registry";
import * as Result from "@effect-atom/atom/Result";
import * as Vitest from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  fixAllAtom,
  lastReviewSourceAtom,
  reviewItemsAtom,
  runItemReviewAtom,
  runReviewsAtom,
  runtime,
} from "./atoms";
import { ReviewEvaluation, ReviewItem, ReviewViolation } from "./schema";
import { ReviewLab } from "./service";

const advance = async (ms = 0) => {
  await Vitest.vitest.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
};

const expectSuccess = <A, E>(result: Result.Result<A, E>) => {
  if (!Result.isSuccess(result)) {
    throw new Error("Expected a successful result");
  }

  return result.value;
};

const expectFailure = <A, E>(result: Result.Result<A, E>) => {
  if (!Result.isFailure(result)) {
    throw new Error("Expected a failed result");
  }

  return result.cause;
};

const createEvaluation = (passed: boolean, code?: "owner" | "dueDate" | "specificity") =>
  new ReviewEvaluation({
    passed,
    violations: code === undefined
      ? []
      : [
        new ReviewViolation({
          code,
          message: `Issue: ${code}`,
        }),
      ],
  });

const createItem = (overrides: Partial<{
  id: string;
  title: string;
  owner: string;
  dueDate: string;
  content: string;
  evaluation: ReviewEvaluation | null;
}> = {}) =>
  new ReviewItem({
    id: overrides.id ?? "item-1",
    title: overrides.title ?? "Title",
    owner: overrides.owner ?? "Mina",
    dueDate: overrides.dueDate ?? "Friday",
    content: overrides.content ?? "Owner: Mina. By Friday, do the work with enough detail.",
    evaluation: overrides.evaluation ?? null,
  });

const makeRegistry = (options: {
  readonly loadBoard: () => Effect.Effect<readonly ReviewItem[], unknown>;
  readonly runReview: (item: {
    readonly itemId: string;
    readonly title: string;
    readonly content: string;
  }) => Effect.Effect<ReviewEvaluation, unknown>;
  readonly previewFix: (
    item: ReviewItem & { readonly evaluation: ReviewEvaluation; },
  ) => Effect.Effect<{
    readonly nextContent: string;
    readonly note: string;
  }, unknown>;
  readonly applyFix: (item: ReviewItem, nextContent: string) => Effect.Effect<ReviewItem, unknown>;
  readonly registryOptions?: {
    readonly timeoutResolution?: number;
    readonly defaultIdleTTL?: number;
  };
}) => {
  const calls = {
    loadBoard: 0,
    runReview: [] as Array<{
      readonly itemId: string;
      readonly title: string;
      readonly content: string;
    }>,
    previewFix: [] as string[],
    applyFix: [] as Array<{ readonly id: string; readonly nextContent: string; }>,
  };
  const registry = Registry.make({
    defaultIdleTTL: options.registryOptions?.defaultIdleTTL,
    initialValues: [
      Atom.initialValue(
        runtime.layer,
        Layer.succeed(
          ReviewLab,
          {
            loadBoard: () => {
              calls.loadBoard++;
              return options.loadBoard();
            },
            runReview: (item: {
              readonly itemId: string;
              readonly title: string;
              readonly content: string;
            }) => {
              calls.runReview.push(item);
              return options.runReview(item);
            },
            previewFix: (item: ReviewItem & { readonly evaluation: ReviewEvaluation; }) => {
              calls.previewFix.push(item.id);
              return options.previewFix(item);
            },
            applyFix: (item: ReviewItem, nextContent: string) => {
              calls.applyFix.push({ id: item.id, nextContent });
              return options.applyFix(item, nextContent);
            },
          } as never,
        ),
      ),
    ],
    timeoutResolution: options.registryOptions?.timeoutResolution,
  });

  return { registry, calls };
};

Vitest.describe("fix all review atoms", () => {
  Vitest.beforeEach(() => {
    Vitest.vitest.useFakeTimers();
  });

  Vitest.afterEach(() => {
    Vitest.vitest.useRealTimers();
    Vitest.vitest.restoreAllMocks();
  });

  Vitest.it(
    "reviewItemsAtom ignores writes before load, then applies PatchItem and SetEvaluation only to the targeted row",
    async () => {
      const first = createItem({
        id: "first",
        content: "first",
        evaluation: createEvaluation(false, "owner"),
      });
      const second = createItem({ id: "second", content: "second", evaluation: null });
      const patched = createItem({ id: "first", content: "patched", evaluation: first.evaluation });
      const untouched = [first, second] as const;
      const replacementEvaluation = createEvaluation(true);
      const { registry } = makeRegistry({
        loadBoard: () => Effect.sleep("20 millis").pipe(Effect.as([first, second] as const)),
        runReview: () => Effect.succeed(replacementEvaluation),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item, nextContent) =>
          Effect.succeed(
            new ReviewItem({
              id: item.id,
              title: item.title,
              owner: item.owner,
              dueDate: item.dueDate,
              content: nextContent,
              evaluation: item.evaluation,
            }),
          ),
      });

      registry.mount(reviewItemsAtom);
      registry.set(reviewItemsAtom, { _tag: "PatchItem", item: patched } as never);
      await advance(25);

      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual(untouched);

      registry.set(
        reviewItemsAtom,
        {
          _tag: "PatchItem",
          item: createItem({ id: "missing", content: "ignored", evaluation: first.evaluation }),
        } as never,
      );
      registry.set(
        reviewItemsAtom,
        {
          _tag: "SetEvaluation",
          itemId: "missing",
          evaluation: replacementEvaluation,
        } as never,
      );

      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual(untouched);

      registry.set(reviewItemsAtom, { _tag: "PatchItem", item: patched } as never);
      registry.set(
        reviewItemsAtom,
        {
          _tag: "SetEvaluation",
          itemId: "second",
          evaluation: replacementEvaluation,
        } as never,
      );

      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
        patched,
        new ReviewItem({
          id: "second",
          title: second.title,
          owner: second.owner,
          dueDate: second.dueDate,
          content: second.content,
          evaluation: replacementEvaluation,
        }),
      ]);
    },
  );

  Vitest.it("reviewItemsAtom returns a failure result when the board cannot load", async () => {
    const { registry, calls } = makeRegistry({
      loadBoard: () => Effect.fail("load failed"),
      runReview: () => Effect.succeed(createEvaluation(true)),
      previewFix: () => Effect.succeed({ nextContent: "next", note: "note" }),
      applyFix: (item) => Effect.succeed(item),
    });

    registry.mount(reviewItemsAtom);
    await advance();

    Vitest.expect(Result.isFailure(registry.get(reviewItemsAtom))).toBe(true);
    Vitest.expect(calls.loadBoard).toEqual(1);
  });

  Vitest.it(
    "reviewItemsAtom refreshes from the remote board and replaces a local patch",
    async () => {
      const firstBoard = [
        createItem({ id: "first", content: "first", evaluation: null }),
        createItem({ id: "second", title: "Second", content: "second", evaluation: null }),
      ] as const;
      const refreshedBoard = [
        createItem({ id: "first", content: "server refresh", evaluation: createEvaluation(true) }),
        firstBoard[1],
      ] as const;
      let loadCount = 0;
      const { registry, calls } = makeRegistry({
        loadBoard: () =>
          Effect.succeed(
            (loadCount++ === 0 ? firstBoard : refreshedBoard) as readonly ReviewItem[],
          ),
        runReview: () => Effect.succeed(createEvaluation(true)),
        previewFix: () => Effect.succeed({ nextContent: "next", note: "note" }),
        applyFix: (item) => Effect.succeed(item),
      });

      registry.mount(reviewItemsAtom);
      await advance();

      registry.set(
        reviewItemsAtom,
        {
          _tag: "PatchItem",
          item: createItem({ id: "first", content: "local patch", evaluation: null }),
        } as never,
      );

      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))[0].content).toEqual("local patch");

      registry.refresh(reviewItemsAtom);
      await advance();

      Vitest.expect(calls.loadBoard).toEqual(2);
      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual(refreshedBoard);
    },
  );

  Vitest.it(
    "runItemReviewAtom evaluates one row, forwards the family keyed id, and updates only that row",
    async () => {
      const target = createItem({ id: "target", evaluation: null });
      const sibling = createItem({ id: "sibling", title: "Sibling", evaluation: null });
      const evaluation = createEvaluation(false, "specificity");
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.sleep("10 millis").pipe(Effect.as([target, sibling] as const)),
        runReview: (item) =>
          Effect.sleep("10 millis").pipe(
            Effect.as(
              item.itemId === "target"
                ? evaluation
                : createEvaluation(true),
            ),
          ),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item, nextContent) =>
          Effect.succeed(
            new ReviewItem({
              id: item.id,
              title: item.title,
              owner: item.owner,
              dueDate: item.dueDate,
              content: nextContent,
              evaluation: item.evaluation,
            }),
          ),
      });

      registry.mount(reviewItemsAtom);
      registry.mount(runItemReviewAtom("target"));
      await advance(15);

      registry.set(runItemReviewAtom("target"), undefined);
      await advance(15);

      Vitest.expect(expectSuccess(registry.get(runItemReviewAtom("target")))).toEqual(evaluation);
      Vitest.expect(calls.runReview).toEqual([
        {
          itemId: target.id,
          title: target.title,
          content: target.content,
        },
      ]);
      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
        new ReviewItem({
          id: target.id,
          title: target.title,
          owner: target.owner,
          dueDate: target.dueDate,
          content: target.content,
          evaluation,
        }),
        sibling,
      ]);
    },
  );

  Vitest.it(
    "runItemReviewAtom loads the board when it has not been mounted yet and applies the update",
    async () => {
      const target = createItem({ id: "target", evaluation: null });
      const sibling = createItem({ id: "sibling", title: "Sibling", evaluation: null });
      const evaluation = createEvaluation(true);
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.sleep("10 millis").pipe(Effect.as([target, sibling] as const)),
        runReview: () => Effect.sleep("10 millis").pipe(Effect.as(evaluation)),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item) => Effect.succeed(item),
      });

      registry.mount(runItemReviewAtom("target"));
      registry.set(runItemReviewAtom("target"), undefined);
      await advance(50);

      Vitest.expect(expectSuccess(registry.get(runItemReviewAtom("target")))).toEqual(evaluation);
      Vitest.expect(calls.loadBoard).toBeGreaterThanOrEqual(1);
      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
        new ReviewItem({
          id: target.id,
          title: target.title,
          owner: target.owner,
          dueDate: target.dueDate,
          content: target.content,
          evaluation,
        }),
        sibling,
      ]);
    },
  );

  Vitest.it("runItemReviewAtom surfaces review failure and leaves the row unchanged", async () => {
    const target = createItem({ id: "target", evaluation: null });
    const sibling = createItem({ id: "sibling", title: "Sibling", evaluation: null });
    const { registry, calls } = makeRegistry({
      loadBoard: () => Effect.sleep("10 millis").pipe(Effect.as([target, sibling] as const)),
      runReview: () => Effect.fail("review failed"),
      previewFix: (item) =>
        Effect.succeed({
          nextContent: item.content,
          note: item.title,
        }),
      applyFix: (item, nextContent) =>
        Effect.succeed(
          new ReviewItem({
            id: item.id,
            title: item.title,
            owner: item.owner,
            dueDate: item.dueDate,
            content: nextContent,
            evaluation: item.evaluation,
          }),
        ),
    });

    registry.mount(reviewItemsAtom);
    registry.mount(runItemReviewAtom("target"));
    await advance(15);

    registry.set(runItemReviewAtom("target"), undefined);
    await advance(15);

    const cause = expectFailure(registry.get(runItemReviewAtom("target")));

    Vitest.expect(Cause.pretty(cause)).toContain("review failed");
    Vitest.expect(calls.runReview).toEqual([
      {
        itemId: target.id,
        title: target.title,
        content: target.content,
      },
    ]);
    Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([target, sibling]);
  });

  Vitest.it(
    "runItemReviewAtom fails when the target row is missing from the loaded board",
    async () => {
      const sibling = createItem({ id: "sibling", title: "Sibling", evaluation: null });
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.succeed([sibling] as const),
        runReview: () => Effect.succeed(createEvaluation(true)),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item) => Effect.succeed(item),
      });

      registry.mount(reviewItemsAtom);
      registry.mount(runItemReviewAtom("missing"));
      await advance();

      registry.set(runItemReviewAtom("missing"), undefined);
      await advance();

      const cause = expectFailure(registry.get(runItemReviewAtom("missing")));

      Vitest.expect(Cause.pretty(cause)).toContain("Missing review item: missing");
      Vitest.expect(calls.runReview).toEqual([]);
      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([sibling]);
    },
  );

  Vitest.it(
    "runItemReviewAtom surfaces board load failure and does not call runReview",
    async () => {
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.fail("load failed"),
        runReview: () => Effect.succeed(createEvaluation(true)),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item) => Effect.succeed(item),
      });

      registry.mount(runItemReviewAtom("target"));
      registry.set(runItemReviewAtom("target"), undefined);
      await advance();

      const cause = expectFailure(registry.get(runItemReviewAtom("target")));

      Vitest.expect(Cause.pretty(cause)).toContain("load failed");
      Vitest.expect(calls.runReview).toEqual([]);
      Vitest.expect(Result.isFailure(registry.get(reviewItemsAtom))).toBe(true);
    },
  );

  Vitest.it("runItemReviewAtom resets to initial after its zero idle TTL expires", async () => {
    const target = createItem({ id: "target", evaluation: null });
    const { registry } = makeRegistry({
      loadBoard: () => Effect.succeed([target] as const),
      runReview: () => Effect.succeed(createEvaluation(true)),
      previewFix: (item) =>
        Effect.succeed({
          nextContent: item.content,
          note: item.title,
        }),
      applyFix: (item) => Effect.succeed(item),
      registryOptions: { timeoutResolution: 1 },
    });
    const atom = runItemReviewAtom("target");

    registry.mount(reviewItemsAtom);
    await advance();

    Vitest.expect(Result.isInitial(registry.get(atom))).toBe(true);

    registry.set(atom, undefined);

    Vitest.expect(Result.isSuccess(registry.get(atom))).toBe(true);

    await Promise.resolve();

    Vitest.expect(Result.isInitial(registry.get(atom))).toBe(true);
  });

  Vitest.it(
    "runReviews with itemIds all reviews every row, records source, and returns mixed success and failure results",
    async () => {
      const first = createItem({ id: "first", evaluation: null });
      const second = createItem({ id: "second", evaluation: null });
      const evaluation = createEvaluation(true);
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.sleep("10 millis").pipe(Effect.as([first, second] as const)),
        runReview: (item) =>
          item.itemId === "second"
            ? Effect.fail("review failed")
            : Effect.sleep("10 millis").pipe(Effect.as(evaluation)),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item, nextContent) =>
          Effect.succeed(
            new ReviewItem({
              id: item.id,
              title: item.title,
              owner: item.owner,
              dueDate: item.dueDate,
              content: nextContent,
              evaluation: item.evaluation,
            }),
          ),
      });

      registry.mount(reviewItemsAtom);
      registry.mount(runReviewsAtom);
      registry.mount(lastReviewSourceAtom);
      await advance(15);

      registry.set(runReviewsAtom, { itemIds: "all", source: "manual" });
      await advance(20);

      const result = expectSuccess(registry.get(runReviewsAtom));

      Vitest.expect(result.successCount).toEqual(1);
      Vitest.expect(result.failureCount).toEqual(1);
      Vitest.expect(result.source).toEqual("manual");
      Vitest.expect(result.failures).toHaveLength(1);
      Vitest.expect(Cause.pretty(result.failures[0])).toContain("review failed");
      Vitest.expect(registry.get(lastReviewSourceAtom)).toEqual("manual");
      Vitest.expect(
        calls.runReview.toSorted((left, right) => left.itemId.localeCompare(right.itemId)),
      )
        .toEqual([
          {
            itemId: "first",
            title: first.title,
            content: first.content,
          },
          {
            itemId: "second",
            title: second.title,
            content: second.content,
          },
        ]);
      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
        new ReviewItem({
          id: first.id,
          title: first.title,
          owner: first.owner,
          dueDate: first.dueDate,
          content: first.content,
          evaluation,
        }),
        second,
      ]);
    },
  );

  Vitest.it(
    "runReviews reviews only the requested ids in a non empty explicit subset",
    async () => {
      const first = createItem({ id: "first", evaluation: null });
      const second = createItem({ id: "second", title: "Second", evaluation: null });
      const third = createItem({ id: "third", title: "Third", evaluation: null });
      const evaluation = createEvaluation(true);
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.succeed([first, second, third] as const),
        runReview: () => Effect.succeed(evaluation),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item) => Effect.succeed(item),
      });

      registry.mount(reviewItemsAtom);
      registry.mount(runReviewsAtom);
      await advance();

      registry.set(runReviewsAtom, { itemIds: ["second"], source: "manual" });
      await advance();

      Vitest.expect(expectSuccess(registry.get(runReviewsAtom))).toEqual({
        successCount: 1,
        failureCount: 0,
        source: "manual",
        failures: [],
      });
      Vitest.expect(calls.runReview).toEqual([
        {
          itemId: "second",
          title: second.title,
          content: second.content,
        },
      ]);
      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
        first,
        new ReviewItem({
          id: second.id,
          title: second.title,
          owner: second.owner,
          dueDate: second.dueDate,
          content: second.content,
          evaluation,
        }),
        third,
      ]);
    },
  );

  Vitest.it("runReviews fails when reviewItemsAtom cannot load", async () => {
    const { registry, calls } = makeRegistry({
      loadBoard: () => Effect.fail("load failed"),
      runReview: () => Effect.succeed(createEvaluation(true)),
      previewFix: () => Effect.succeed({ nextContent: "next", note: "note" }),
      applyFix: (item) => Effect.succeed(item),
    });

    registry.mount(runReviewsAtom);
    registry.set(runReviewsAtom, { itemIds: "all", source: "manual" });
    await advance();

    const cause = expectFailure(registry.get(runReviewsAtom));

    Vitest.expect(Cause.pretty(cause)).toContain("load failed");
    Vitest.expect(calls.runReview).toEqual([]);
  });

  Vitest.it("runReviewsAtom evicts cached results after 45 seconds of idleness", async () => {
    const item = createItem({ id: "first", evaluation: null });
    const { registry } = makeRegistry({
      loadBoard: () => Effect.succeed([item] as const),
      runReview: () => Effect.succeed(createEvaluation(true)),
      previewFix: (candidate) =>
        Effect.succeed({
          nextContent: candidate.content,
          note: candidate.title,
        }),
      applyFix: (candidate) => Effect.succeed(candidate),
      registryOptions: { timeoutResolution: 1 },
    });
    const atom = runReviewsAtom;

    registry.mount(reviewItemsAtom);
    await advance();

    Vitest.expect(Result.isInitial(registry.get(atom))).toBe(true);

    registry.set(atom, { itemIds: "all", source: "manual" });

    Vitest.expect(Result.isSuccess(registry.get(atom))).toBe(true);

    await Promise.resolve();
    await advance(45_001);

    Vitest.expect(Result.isInitial(registry.get(atom))).toBe(true);
  });

  Vitest.it(
    "runReviews returns zeros for an empty explicit id selection and fixAll returns zeros when no item is both evaluated and failing",
    async () => {
      const passed = createItem({ id: "passed", evaluation: createEvaluation(true) });
      const unknown = createItem({ id: "unknown", evaluation: null });
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.succeed([passed, unknown] as const),
        runReview: () => Effect.succeed(createEvaluation(true)),
        previewFix: (item) =>
          Effect.succeed({
            nextContent: item.content,
            note: item.title,
          }),
        applyFix: (item, nextContent) =>
          Effect.succeed(
            new ReviewItem({
              id: item.id,
              title: item.title,
              owner: item.owner,
              dueDate: item.dueDate,
              content: nextContent,
              evaluation: item.evaluation,
            }),
          ),
      });

      registry.mount(reviewItemsAtom);
      registry.mount(runReviewsAtom);
      registry.mount(fixAllAtom);
      registry.mount(lastReviewSourceAtom);
      await advance();

      registry.set(runReviewsAtom, { itemIds: [], source: "manual" });
      await advance();

      Vitest.expect(expectSuccess(registry.get(runReviewsAtom))).toEqual({
        successCount: 0,
        failureCount: 0,
        source: "manual",
        failures: [],
      });
      Vitest.expect(registry.get(lastReviewSourceAtom)).toEqual("manual");

      registry.set(fixAllAtom, undefined);
      await advance();

      Vitest.expect(expectSuccess(registry.get(fixAllAtom))).toEqual({
        successCount: 0,
        failureCount: 0,
        causes: [],
      });
      Vitest.expect(calls.previewFix).toEqual([]);
      Vitest.expect(calls.applyFix).toEqual([]);
    },
  );

  Vitest.it(
    "fixAll patches only failed items, collects failed fixes, and reruns reviews for only succeeded ids",
    async () => {
      const needsFix = createItem({
        id: "fix-me",
        content: "old content",
        evaluation: createEvaluation(false, "owner"),
      });
      const fixFails = createItem({
        id: "fail-me",
        content: "broken content",
        evaluation: createEvaluation(false, "dueDate"),
      });
      const passed = createItem({ id: "passed", evaluation: createEvaluation(true) });
      const untouched = createItem({ id: "untouched", evaluation: null });
      const { registry, calls } = makeRegistry({
        loadBoard: () =>
          Effect.sleep("10 millis").pipe(
            Effect.as([needsFix, fixFails, passed, untouched] as const),
          ),
        runReview: (item) =>
          Effect.succeed(
            item.itemId === "fix-me"
              ? createEvaluation(true)
              : createEvaluation(false, "specificity"),
          ),
        previewFix: (item) =>
          Effect.sleep("10 millis").pipe(
            Effect.as({
              nextContent: `${item.content} patched`,
              note: `Prepared ${item.id}`,
            }),
          ),
        applyFix: (item, nextContent) =>
          item.id === "fail-me"
            ? Effect.fail("apply failed")
            : Effect.sleep("10 millis").pipe(
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
      });

      registry.mount(reviewItemsAtom);
      registry.mount(runReviewsAtom);
      registry.mount(lastReviewSourceAtom);
      await advance(15);

      registry.set(fixAllAtom, undefined);

      for (let index = 0; index < 10 && calls.runReview.length === 0; index++) {
        await advance(100);
      }

      const items = expectSuccess(registry.get(reviewItemsAtom));

      Vitest.expect(registry.get(lastReviewSourceAtom)).toEqual("fixAll");
      Vitest.expect(calls.previewFix).toEqual(["fix-me", "fail-me"]);
      Vitest.expect(calls.applyFix).toEqual([
        { id: "fix-me", nextContent: "old content patched" },
        { id: "fail-me", nextContent: "broken content patched" },
      ]);
      Vitest.expect(calls.runReview).toEqual([
        {
          itemId: "fix-me",
          title: needsFix.title,
          content: "old content patched",
        },
      ]);
      Vitest.expect(items).toEqual([
        new ReviewItem({
          id: needsFix.id,
          title: needsFix.title,
          owner: needsFix.owner,
          dueDate: needsFix.dueDate,
          content: "old content patched",
          evaluation: createEvaluation(true),
        }),
        fixFails,
        passed,
        untouched,
      ]);
    },
  );

  Vitest.it("fixAll handles rerun review failure for a successfully patched row", async () => {
    const needsFix = createItem({
      id: "fix-me",
      content: "old content",
      evaluation: createEvaluation(false, "owner"),
    });
    const { registry, calls } = makeRegistry({
      loadBoard: () => Effect.succeed([needsFix] as const),
      runReview: () => Effect.fail("review failed"),
      previewFix: (item) =>
        Effect.succeed({
          nextContent: `${item.content} patched`,
          note: `Prepared ${item.id}`,
        }),
      applyFix: (item, nextContent) =>
        Effect.succeed(
          new ReviewItem({
            id: item.id,
            title: item.title,
            owner: item.owner,
            dueDate: item.dueDate,
            content: nextContent,
            evaluation: null,
          }),
        ),
    });

    registry.mount(reviewItemsAtom);
    registry.mount(runReviewsAtom);
    registry.mount(fixAllAtom);
    registry.mount(lastReviewSourceAtom);
    await advance();

    registry.set(fixAllAtom, undefined);
    await advance();

    const result = expectSuccess(registry.get(fixAllAtom));

    Vitest.expect(result.successCount).toEqual(0);
    Vitest.expect(result.failureCount).toEqual(1);
    Vitest.expect(result.causes).toHaveLength(1);
    Vitest.expect(Cause.pretty(result.causes[0])).toContain("review failed");
    Vitest.expect(calls.runReview).toEqual([
      {
        itemId: "fix-me",
        title: needsFix.title,
        content: "old content patched",
      },
    ]);
    Vitest.expect(registry.get(lastReviewSourceAtom)).toEqual("fixAll");
    Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
      new ReviewItem({
        id: needsFix.id,
        title: needsFix.title,
        owner: needsFix.owner,
        dueDate: needsFix.dueDate,
        content: "old content patched",
        evaluation: null,
      }),
    ]);
  });

  Vitest.it("fixAll counts a rerun that returns passed false as a failed fix", async () => {
    const needsFix = createItem({
      id: "fix-me",
      content: "old content",
      evaluation: createEvaluation(false, "owner"),
    });
    const failedEvaluation = createEvaluation(false, "specificity");
    const { registry, calls } = makeRegistry({
      loadBoard: () => Effect.succeed([needsFix] as const),
      runReview: () => Effect.succeed(failedEvaluation),
      previewFix: (item) =>
        Effect.succeed({
          nextContent: `${item.content} patched`,
          note: `Prepared ${item.id}`,
        }),
      applyFix: (item, nextContent) =>
        Effect.succeed(
          new ReviewItem({
            id: item.id,
            title: item.title,
            owner: item.owner,
            dueDate: item.dueDate,
            content: nextContent,
            evaluation: null,
          }),
        ),
    });

    registry.mount(reviewItemsAtom);
    registry.mount(runItemReviewAtom("fix-me"));
    registry.mount(fixAllAtom);
    registry.mount(lastReviewSourceAtom);
    await advance();

    registry.set(fixAllAtom, undefined);
    await advance();

    const result = expectSuccess(registry.get(fixAllAtom));

    Vitest.expect(result.successCount).toEqual(0);
    Vitest.expect(result.failureCount).toEqual(1);
    Vitest.expect(result.causes).toHaveLength(1);
    Vitest.expect(Cause.pretty(result.causes[0])).toContain("Fix review still failing: fix-me");
    Vitest.expect(calls.runReview).toEqual([
      {
        itemId: "fix-me",
        title: needsFix.title,
        content: "old content patched",
      },
    ]);
    Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
      new ReviewItem({
        id: needsFix.id,
        title: needsFix.title,
        owner: needsFix.owner,
        dueDate: needsFix.dueDate,
        content: "old content patched",
        evaluation: failedEvaluation,
      }),
    ]);
  });

  Vitest.it("fixAll does not rerun reviews when every attempted fix fails", async () => {
    const first = createItem({
      id: "first",
      content: "first content",
      evaluation: createEvaluation(false, "owner"),
    });
    const second = createItem({
      id: "second",
      title: "Second",
      content: "second content",
      evaluation: createEvaluation(false, "specificity"),
    });
    const { registry, calls } = makeRegistry({
      loadBoard: () => Effect.sleep("10 millis").pipe(Effect.as([first, second] as const)),
      runReview: () => Effect.succeed(createEvaluation(true)),
      previewFix: (item) =>
        Effect.succeed({
          nextContent: `${item.content} patched`,
          note: `Prepared ${item.id}`,
        }),
      applyFix: () => Effect.fail("apply failed"),
    });

    registry.mount(reviewItemsAtom);
    registry.mount(fixAllAtom);
    registry.mount(lastReviewSourceAtom);
    registry.set(lastReviewSourceAtom, "manual");
    await advance(15);

    registry.set(fixAllAtom, undefined);
    await advance(20);

    const result = expectSuccess(registry.get(fixAllAtom));

    Vitest.expect(result.successCount).toEqual(0);
    Vitest.expect(result.failureCount).toEqual(2);
    Vitest.expect(result.causes).toHaveLength(2);
    Vitest.expect(registry.get(lastReviewSourceAtom)).toEqual("manual");
    Vitest.expect(calls.previewFix).toEqual(["first", "second"]);
    Vitest.expect(calls.applyFix).toEqual([
      { id: "first", nextContent: "first content patched" },
      { id: "second", nextContent: "second content patched" },
    ]);
    Vitest.expect(calls.runReview).toEqual([]);
    Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([first, second]);
  });

  Vitest.it(
    "fixAll records a failed preview without calling applyFix or rerunning review for that row",
    async () => {
      const previewFails = createItem({
        id: "preview-fails",
        evaluation: createEvaluation(false, "owner"),
      });
      const succeeds = createItem({
        id: "succeeds",
        content: "draft content",
        evaluation: createEvaluation(false, "dueDate"),
      });
      const { registry, calls } = makeRegistry({
        loadBoard: () => Effect.succeed([previewFails, succeeds] as const),
        runReview: () => Effect.succeed(createEvaluation(true)),
        previewFix: (item) =>
          item.id === "preview-fails"
            ? Effect.fail("preview failed")
            : Effect.succeed({
              nextContent: `${item.content} patched`,
              note: `Prepared ${item.id}`,
            }),
        applyFix: (item, nextContent) =>
          Effect.succeed(
            new ReviewItem({
              id: item.id,
              title: item.title,
              owner: item.owner,
              dueDate: item.dueDate,
              content: nextContent,
              evaluation: null,
            }),
          ),
      });

      registry.mount(reviewItemsAtom);
      registry.mount(fixAllAtom);
      registry.mount(lastReviewSourceAtom);
      await advance();

      registry.set(fixAllAtom, undefined);
      await advance();

      const result = expectSuccess(registry.get(fixAllAtom));

      Vitest.expect(result.successCount).toEqual(1);
      Vitest.expect(result.failureCount).toEqual(1);
      Vitest.expect(calls.previewFix).toEqual(["preview-fails", "succeeds"]);
      Vitest.expect(calls.applyFix).toEqual([{
        id: "succeeds",
        nextContent: "draft content patched",
      }]);
      Vitest.expect(calls.runReview).toEqual([
        {
          itemId: "succeeds",
          title: succeeds.title,
          content: "draft content patched",
        },
      ]);
      Vitest.expect(expectSuccess(registry.get(reviewItemsAtom))).toEqual([
        previewFails,
        new ReviewItem({
          id: succeeds.id,
          title: succeeds.title,
          owner: succeeds.owner,
          dueDate: succeeds.dueDate,
          content: "draft content patched",
          evaluation: createEvaluation(true),
        }),
      ]);
    },
  );

  Vitest.it("fixAll fails when reviewItemsAtom cannot load", async () => {
    const { registry, calls } = makeRegistry({
      loadBoard: () => Effect.fail("load failed"),
      runReview: () => Effect.succeed(createEvaluation(true)),
      previewFix: () => Effect.succeed({ nextContent: "next", note: "note" }),
      applyFix: (item) => Effect.succeed(item),
    });

    registry.mount(fixAllAtom);
    registry.set(fixAllAtom, undefined);
    await advance();

    const cause = expectFailure(registry.get(fixAllAtom));

    Vitest.expect(Cause.pretty(cause)).toContain("load failed");
    Vitest.expect(calls.previewFix).toEqual([]);
    Vitest.expect(calls.applyFix).toEqual([]);
  });

  Vitest.it("fixAllAtom evicts cached results after 45 seconds of idleness", async () => {
    const needsFix = createItem({
      id: "fix-me",
      content: "old content",
      evaluation: createEvaluation(false, "owner"),
    });
    const { registry } = makeRegistry({
      loadBoard: () => Effect.succeed([needsFix] as const),
      runReview: () => Effect.succeed(createEvaluation(true)),
      previewFix: (item) =>
        Effect.succeed({
          nextContent: `${item.content} patched`,
          note: `Prepared ${item.id}`,
        }),
      applyFix: (item, nextContent) =>
        Effect.succeed(
          new ReviewItem({
            id: item.id,
            title: item.title,
            owner: item.owner,
            dueDate: item.dueDate,
            content: nextContent,
            evaluation: null,
          }),
        ),
      registryOptions: { timeoutResolution: 1 },
    });
    const atom = fixAllAtom;

    registry.mount(reviewItemsAtom);
    registry.mount(runReviewsAtom);
    await advance();

    Vitest.expect(Result.isInitial(registry.get(atom))).toBe(true);

    registry.set(atom, undefined);

    Vitest.expect(Result.isSuccess(registry.get(atom))).toBe(true);

    await Promise.resolve();
    await advance(45_001);

    Vitest.expect(Result.isInitial(registry.get(atom))).toBe(true);
  });
});
