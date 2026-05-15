import { RegistryContext, useAtomMount } from "@effect-atom/atom-react";
import * as Atom from "@effect-atom/atom/Atom";
import * as Registry from "@effect-atom/atom/Registry";
import * as Result from "@effect-atom/atom/Result";
import * as PlatformBrowser from "@effect/platform-browser";
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import * as Vitest from "@effect/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  briefDraftFamily,
  briefDraftSyncFamily,
  briefFormFamily,
  createScopeKey,
  editScopeKeys,
  makeDraftStorageKey,
  runtime,
} from "./atoms";
import { BriefDraft, BriefFormScopeKey, emptyBriefDraft } from "./schema";
import { BriefStudio } from "./service";

const advance = async (ms = 0) => {
  await act(async () => {
    await Vitest.vitest.advanceTimersByTimeAsync(ms);
  });
  await Promise.resolve();
};

const expectSuccess = <A, E>(result: Result.Result<A, E>) => {
  if (!Result.isSuccess(result)) {
    throw new Error("Expected a successful result");
  }

  return result.value;
};

const createValidDraft = (overrides: Partial<{
  title: string;
  audience: string;
  goal: string;
  tone: "confident" | "warm" | "direct";
  prompt: string;
}> = {}) =>
  new BriefDraft({
    title: overrides.title ?? "Launch brief",
    audience: overrides.audience ?? "Admins",
    goal: overrides.goal ?? "Clarify the rollout",
    tone: overrides.tone ?? "confident",
    prompt: overrides.prompt ?? "Write a concise note with one clear next step.",
  });

const renderPersistentFormHarness = async (options: {
  readonly scopeKey: BriefFormScopeKey;
  readonly defaultValues: BriefDraft;
  readonly initialize: boolean;
}) => {
  const registry = Registry.make();
  const form = briefFormFamily(options.scopeKey);
  const draftAtom = briefDraftFamily(options.scopeKey);
  const draftSyncAtom = briefDraftSyncFamily(options.scopeKey);

  const Harness = () => {
    useAtomMount(draftAtom);
    useAtomMount(draftSyncAtom);

    return (
      <>
        <form.KeepAlive />
        {options.initialize
          ? (
            <form.Initialize defaultValues={options.defaultValues}>
              <div data-testid="ready" />
            </form.Initialize>
          )
          : <div data-testid="ready" />}
      </>
    );
  };

  render(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );

  await advance();
  Vitest.expect(screen.getByTestId("ready")).toBeTruthy();

  return { registry, form, draftAtom };
};

Vitest.describe("persistent form atoms", () => {
  Vitest.beforeEach(() => {
    Vitest.vitest.useFakeTimers();
    cleanup();
    sessionStorage.clear();
  });

  Vitest.afterEach(() => {
    Vitest.vitest.useRealTimers();
    cleanup();
    sessionStorage.clear();
  });

  Vitest.it(
    "does not create a persisted draft before initialization or while the initialized form is still pristine",
    async () => {
      const firstScopeKey = createScopeKey;
      const uninitialized = await renderPersistentFormHarness({
        scopeKey: firstScopeKey,
        defaultValues: emptyBriefDraft,
        initialize: false,
      });

      await advance(500);
      Vitest.expect(uninitialized.registry.get(uninitialized.draftAtom)).toEqual(null);
      Vitest.expect(sessionStorage.getItem(makeDraftStorageKey(firstScopeKey))).toEqual(null);

      cleanup();

      const initialized = await renderPersistentFormHarness({
        scopeKey: firstScopeKey,
        defaultValues: emptyBriefDraft,
        initialize: true,
      });

      await advance(500);
      Vitest.expect(initialized.registry.get(initialized.draftAtom)).toEqual(null);
      Vitest.expect(sessionStorage.getItem(makeDraftStorageKey(firstScopeKey))).toEqual(null);
    },
  );

  Vitest.it("persists only the latest dirty values after the 450 ms debounce window", async () => {
    const { registry, form, draftAtom } = await renderPersistentFormHarness({
      scopeKey: createScopeKey,
      defaultValues: emptyBriefDraft,
      initialize: true,
    });
    const firstDraft = createValidDraft({ title: "First pass" });
    const secondDraft = createValidDraft({ title: "Second pass" });

    registry.set(form.setValues, firstDraft);
    await advance(200);
    registry.set(form.setValues, secondDraft);

    await advance(249);
    Vitest.expect(registry.get(draftAtom)).toEqual(null);

    await advance(201);
    Vitest.expect(registry.get(draftAtom)).toEqual(secondDraft);
  });

  Vitest.it(
    "does not reach a successful submit when required fields are empty and keeps the dirty draft",
    async () => {
      const { registry, form, draftAtom } = await renderPersistentFormHarness({
        scopeKey: createScopeKey,
        defaultValues: emptyBriefDraft,
        initialize: true,
      });
      const invalidDraft = createValidDraft({ title: "" });

      registry.set(form.setValues, invalidDraft);
      await advance(450);

      registry.set(form.submit, undefined);
      await advance();

      Vitest.expect(Result.isFailure(registry.get(form.submit))).toBe(true);
      Vitest.expect(registry.get(draftAtom)).toEqual(invalidDraft);
    },
  );

  Vitest.it(
    "rehydrates an existing persisted draft and does not clobber it on mount while the form is pristine",
    async () => {
      const scopeKey = createScopeKey;
      const persistedDraft = createValidDraft({
        title: "Persisted launch note",
        audience: "Operations leads",
        goal: "Clarify who owns the rollout",
        tone: "warm",
        prompt: "Write a short launch update with one clear next step.",
      });
      const first = await renderPersistentFormHarness({
        scopeKey,
        defaultValues: emptyBriefDraft,
        initialize: true,
      });

      first.registry.set(first.form.setValues, persistedDraft);
      await advance(450);

      Vitest.expect(first.registry.get(first.draftAtom)).toEqual(persistedDraft);
      Vitest.expect(sessionStorage.getItem(makeDraftStorageKey(scopeKey))).not.toBeNull();

      cleanup();

      const second = await renderPersistentFormHarness({
        scopeKey,
        defaultValues: emptyBriefDraft,
        initialize: true,
      });

      Vitest.expect(second.registry.get(second.draftAtom)).toEqual(persistedDraft);

      await advance(500);
      Vitest.expect(second.registry.get(second.draftAtom)).toEqual(persistedDraft);
    },
  );

  Vitest.it("clears a corrupt persisted draft and leaves the atom null on mount", async () => {
    const scopeKey = createScopeKey;

    sessionStorage.setItem(makeDraftStorageKey(scopeKey), "{bad json");

    const first = await renderPersistentFormHarness({
      scopeKey,
      defaultValues: emptyBriefDraft,
      initialize: true,
    });

    await advance();
    Vitest.expect(first.registry.get(first.draftAtom)).toEqual(null);
    Vitest.expect(sessionStorage.getItem(makeDraftStorageKey(scopeKey))).toEqual(null);

    cleanup();

    const second = await renderPersistentFormHarness({
      scopeKey,
      defaultValues: emptyBriefDraft,
      initialize: true,
    });

    await advance(500);
    Vitest.expect(second.registry.get(second.draftAtom)).toEqual(null);
    Vitest.expect(sessionStorage.getItem(makeDraftStorageKey(scopeKey))).toEqual(null);
  });

  Vitest.it("does not let a stale initial load overwrite a newer local draft", async () => {
    const scopeKey = createScopeKey;
    const draftAtom = briefDraftFamily(scopeKey);
    const storage = new Map<string, string>();
    const newerDraft = createValidDraft({
      title: "Newer draft",
      audience: "Operators",
      goal: "Clarify onboarding",
      tone: "direct",
      prompt: "Write a direct onboarding note.",
    });
    const registry = Registry.make({
      initialValues: [
        Atom.initialValue(
          runtime.layer,
          Layer.mergeAll(
            Layer.succeed(
              BriefStudio,
              {
                saveBrief: (draft: {
                  readonly id: string;
                  readonly title: string;
                  readonly audience: string;
                  readonly goal: string;
                  readonly tone: "confident" | "warm" | "direct";
                  readonly prompt: string;
                }) =>
                  Effect.succeed({
                    ...draft,
                    savedAt: "2026-05-14T00:00:00.000Z",
                  }),
              } as never,
            ),
            Layer.succeed(
              KeyValueStore.KeyValueStore,
              KeyValueStore.makeStringOnly({
                get: (key) => {
                  const snapshot = storage.get(key);
                  return Effect.gen(function*() {
                    yield* Effect.sleep("20 millis");
                    return Option.fromNullable(snapshot);
                  });
                },
                set: (key, value) =>
                  Effect.sync(() => {
                    storage.set(key, value);
                  }),
                remove: (key) =>
                  Effect.sync(() => {
                    storage.delete(key);
                  }),
                clear: Effect.sync(() => storage.clear()),
                size: Effect.sync(() => storage.size),
              }),
            ),
          ),
        ),
      ],
    });

    registry.mount(draftAtom);

    Vitest.expect(registry.get(draftAtom)).toEqual(null);

    registry.set(draftAtom, newerDraft);
    await advance();
    Vitest.expect(registry.get(draftAtom)).toEqual(newerDraft);

    await advance(50);
    Vitest.expect(registry.get(draftAtom)).toEqual(newerDraft);
  });

  Vitest.it("does not let a stale corrupt initial load clear a newer local draft", async () => {
    const scopeKey = createScopeKey;
    const draftAtom = briefDraftFamily(scopeKey);
    const storage = new Map<string, string>([[makeDraftStorageKey(scopeKey), "{bad json"]]);
    const newerDraft = createValidDraft({
      title: "Recovered draft",
      audience: "Operators",
      goal: "Clarify onboarding",
      tone: "direct",
      prompt: "Write a direct onboarding note.",
    });
    const registry = Registry.make({
      initialValues: [
        Atom.initialValue(
          runtime.layer,
          Layer.mergeAll(
            Layer.succeed(
              BriefStudio,
              {
                saveBrief: (draft: {
                  readonly id: string;
                  readonly title: string;
                  readonly audience: string;
                  readonly goal: string;
                  readonly tone: "confident" | "warm" | "direct";
                  readonly prompt: string;
                }) =>
                  Effect.succeed({
                    ...draft,
                    savedAt: "2026-05-14T00:00:00.000Z",
                  }),
              } as never,
            ),
            Layer.succeed(
              KeyValueStore.KeyValueStore,
              KeyValueStore.makeStringOnly({
                get: (key) => {
                  const snapshot = storage.get(key);
                  return Effect.gen(function*() {
                    yield* Effect.sleep("20 millis");
                    return Option.fromNullable(snapshot);
                  });
                },
                set: (key, value) =>
                  Effect.sync(() => {
                    storage.set(key, value);
                  }),
                remove: (key) =>
                  Effect.sync(() => {
                    storage.delete(key);
                  }),
                clear: Effect.sync(() => storage.clear()),
                size: Effect.sync(() => storage.size),
              }),
            ),
          ),
        ),
      ],
    });

    registry.mount(draftAtom);
    Vitest.expect(registry.get(draftAtom)).toEqual(null);

    registry.set(draftAtom, newerDraft);
    await advance();
    Vitest.expect(registry.get(draftAtom)).toEqual(newerDraft);

    await advance(50);
    Vitest.expect(registry.get(draftAtom)).toEqual(newerDraft);
  });

  Vitest.it("reloads the persisted draft when the draft atom is refreshed", async () => {
    const scopeKey = createScopeKey;
    const draftAtom = briefDraftFamily(scopeKey);
    const firstDraft = createValidDraft({
      title: "First stored draft",
      audience: "Operators",
      goal: "Clarify onboarding",
      tone: "confident",
      prompt: "Write a short onboarding note.",
    });
    const secondDraft = createValidDraft({
      title: "Second stored draft",
      audience: "Operators",
      goal: "Clarify onboarding",
      tone: "warm",
      prompt: "Write a warmer onboarding note.",
    });
    const first = Registry.make();
    const second = Registry.make();

    first.mount(draftAtom);
    second.mount(draftAtom);
    await advance();

    first.set(draftAtom, firstDraft);
    await advance();
    Vitest.expect(first.get(draftAtom)).toEqual(firstDraft);

    second.set(draftAtom, secondDraft);
    await advance();

    first.refresh(draftAtom);
    await advance();

    Vitest.expect(first.get(draftAtom)).toEqual(secondDraft);
  });

  Vitest.it("refreshes to null after another registry clears the persisted draft", async () => {
    const scopeKey = createScopeKey;
    const draftAtom = briefDraftFamily(scopeKey);
    const persistedDraft = createValidDraft({
      title: "Stored draft",
      audience: "Operators",
      goal: "Clarify onboarding",
      tone: "warm",
      prompt: "Write a short onboarding note.",
    });
    const first = Registry.make();
    const second = Registry.make();

    first.mount(draftAtom);
    second.mount(draftAtom);
    await advance();

    first.set(draftAtom, persistedDraft);
    await advance();
    Vitest.expect(first.get(draftAtom)).toEqual(persistedDraft);

    second.set(draftAtom, null);
    await advance();

    first.refresh(draftAtom);
    await advance();

    Vitest.expect(first.get(draftAtom)).toEqual(null);
  });

  Vitest.it(
    "clears an existing persisted draft after a successful submit and persists later edits again",
    async () => {
      const scopeKey = editScopeKeys[0];
      const initialDraft = createValidDraft({
        title: "Renewal playbook",
        audience: "Account managers",
        goal: "Drive clearer renewal nudges",
        tone: "direct",
        prompt: "Write a compact renewal note that explains the next step.",
      });
      const { registry, form, draftAtom } = await renderPersistentFormHarness({
        scopeKey,
        defaultValues: initialDraft,
        initialize: true,
      });

      registry.set(draftAtom, initialDraft);
      registry.set(form.submit, undefined);
      await advance(850);

      Vitest.expect(registry.get(draftAtom)).toEqual(null);

      const saved = expectSuccess(registry.get(form.submit));

      Vitest.expect(saved.id).toEqual(scopeKey.toString());

      const updatedDraft = createValidDraft({
        title: "Renewal playbook v2",
        audience: initialDraft.audience,
        goal: initialDraft.goal,
        tone: initialDraft.tone,
        prompt: initialDraft.prompt,
      });

      registry.set(form.setValues, updatedDraft);
      await advance(450);

      Vitest.expect(registry.get(draftAtom)).toEqual(updatedDraft);
    },
  );

  Vitest.it(
    "submits a valid create-scope draft and returns the submitted fields with the create scope id",
    async () => {
      const { registry, form, draftAtom } = await renderPersistentFormHarness({
        scopeKey: createScopeKey,
        defaultValues: emptyBriefDraft,
        initialize: true,
      });
      const draft = createValidDraft({
        title: "Launch brief",
        audience: "Workspace owners",
        goal: "Drive clearer rollout communication",
        tone: "warm",
        prompt: "Write a launch note with one clear next step.",
      });

      registry.set(form.setValues, draft);
      await advance(450);
      registry.set(form.submit, undefined);
      await advance(850);

      const saved = expectSuccess(registry.get(form.submit));

      Vitest.expect(saved).toEqual({
        id: createScopeKey.toString(),
        title: draft.title,
        audience: draft.audience,
        goal: draft.goal,
        tone: draft.tone,
        prompt: draft.prompt,
        savedAt: saved.savedAt,
      });
      Vitest.expect(registry.get(draftAtom)).toEqual(null);
    },
  );

  Vitest.it(
    "keeps the dirty draft and reports submit failure when BriefStudio.saveBrief fails",
    async () => {
      const scopeKey = createScopeKey;
      const form = briefFormFamily(scopeKey);
      const draftAtom = briefDraftFamily(scopeKey);
      const draftSyncAtom = briefDraftSyncFamily(scopeKey);
      const draft = createValidDraft({
        title: "Launch brief",
        audience: "Workspace owners",
        goal: "Clarify the launch",
        tone: "warm",
        prompt: "Write a launch note with one clear next step.",
      });
      const registry = Registry.make({
        initialValues: [
          Atom.initialValue(
            runtime.layer,
            Layer.mergeAll(
              Layer.succeed(
                BriefStudio,
                {
                  saveBrief: () => Effect.fail("save failed"),
                } as never,
              ),
              PlatformBrowser.BrowserKeyValueStore.layerSessionStorage,
            ),
          ),
        ],
      });

      const Harness = () => {
        useAtomMount(draftAtom);
        useAtomMount(draftSyncAtom);

        return (
          <>
            <form.KeepAlive />
            <form.Initialize defaultValues={emptyBriefDraft}>
              <div data-testid="ready" />
            </form.Initialize>
          </>
        );
      };

      render(
        <RegistryContext.Provider value={registry}>
          <Harness />
        </RegistryContext.Provider>,
      );

      await advance();
      Vitest.expect(screen.getByTestId("ready")).toBeTruthy();

      registry.set(form.setValues, draft);
      await advance(450);
      registry.set(form.submit, undefined);
      await advance(850);

      Vitest.expect(Result.isFailure(registry.get(form.submit))).toBe(true);
      Vitest.expect(registry.get(draftAtom)).toEqual(draft);
      Vitest.expect(sessionStorage.getItem(makeDraftStorageKey(scopeKey))).not.toEqual(null);
    },
  );

  Vitest.it(
    "does not restore a previously persisted draft after a successful submit and remount",
    async () => {
      const scopeKey = editScopeKeys[0];
      const defaultValues = createValidDraft({
        title: "Renewal playbook",
        audience: "Account managers",
        goal: "Drive clearer renewal nudges",
        tone: "direct",
        prompt: "Write a compact renewal note that explains the next step.",
      });
      const persistedDraft = createValidDraft({
        title: "Renewal playbook draft",
        audience: defaultValues.audience,
        goal: defaultValues.goal,
        tone: defaultValues.tone,
        prompt: defaultValues.prompt,
      });
      const first = await renderPersistentFormHarness({
        scopeKey,
        defaultValues,
        initialize: true,
      });

      first.registry.set(first.form.setValues, persistedDraft);
      await advance(450);
      Vitest.expect(first.registry.get(first.draftAtom)).toEqual(persistedDraft);

      first.registry.set(first.form.submit, undefined);
      await advance(850);
      Vitest.expect(first.registry.get(first.draftAtom)).toEqual(null);

      cleanup();

      const second = await renderPersistentFormHarness({
        scopeKey,
        defaultValues,
        initialize: true,
      });

      Vitest.expect(second.registry.get(second.draftAtom)).toEqual(null);
      await advance(500);
      Vitest.expect(second.registry.get(second.draftAtom)).toEqual(null);
    },
  );

  Vitest.it(
    "persists and clears drafts per scope without affecting another scope key",
    async () => {
      const firstScopeKey = editScopeKeys[0];
      const secondScopeKey = editScopeKeys[1];
      const firstDefaultValues = createValidDraft({
        title: "Renewal playbook",
        audience: "Account managers",
        goal: "Drive clearer renewal nudges",
        tone: "direct",
        prompt: "Write a compact renewal note that explains the next step.",
      });
      const secondDefaultValues = createValidDraft({
        title: "Admin handoff",
        audience: "Workspace owners",
        goal: "Reduce setup confusion",
        tone: "warm",
        prompt: "Create a setup handoff note for the first week.",
      });
      const firstDraft = createValidDraft({
        title: "Renewal playbook v2",
        audience: firstDefaultValues.audience,
        goal: firstDefaultValues.goal,
        tone: firstDefaultValues.tone,
        prompt: firstDefaultValues.prompt,
      });
      const secondDraft = createValidDraft({
        title: "Admin handoff v2",
        audience: secondDefaultValues.audience,
        goal: secondDefaultValues.goal,
        tone: secondDefaultValues.tone,
        prompt: secondDefaultValues.prompt,
      });
      const first = await renderPersistentFormHarness({
        scopeKey: firstScopeKey,
        defaultValues: firstDefaultValues,
        initialize: true,
      });

      first.registry.set(first.form.setValues, firstDraft);
      await advance(450);
      Vitest.expect(first.registry.get(first.draftAtom)).toEqual(firstDraft);

      cleanup();

      const second = await renderPersistentFormHarness({
        scopeKey: secondScopeKey,
        defaultValues: secondDefaultValues,
        initialize: true,
      });

      second.registry.set(second.form.setValues, secondDraft);
      await advance(450);
      Vitest.expect(second.registry.get(second.draftAtom)).toEqual(secondDraft);

      cleanup();

      const firstAgain = await renderPersistentFormHarness({
        scopeKey: firstScopeKey,
        defaultValues: firstDefaultValues,
        initialize: true,
      });

      Vitest.expect(firstAgain.registry.get(firstAgain.draftAtom)).toEqual(firstDraft);

      firstAgain.registry.set(firstAgain.form.submit, undefined);
      await advance(850);
      Vitest.expect(firstAgain.registry.get(firstAgain.draftAtom)).toEqual(null);

      cleanup();

      const secondAgain = await renderPersistentFormHarness({
        scopeKey: secondScopeKey,
        defaultValues: secondDefaultValues,
        initialize: true,
      });

      Vitest.expect(secondAgain.registry.get(secondAgain.draftAtom)).toEqual(secondDraft);
      await advance(500);
      Vitest.expect(secondAgain.registry.get(secondAgain.draftAtom)).toEqual(secondDraft);
    },
  );
});
