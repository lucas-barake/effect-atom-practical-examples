import { Atom, Result } from "@effect-atom/atom-react";
import * as PlatformBrowser from "@effect/platform-browser";
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import { FormBuilder, FormReact } from "@lucas-barake/effect-form-react";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AudienceField, GoalField, PromptField, TitleField, ToneField } from "./field-components";
import { BriefDraft, BriefFormScopeKey, emptyBriefDraft, SavedBrief, ToneSchema } from "./schema";
import { BriefStudio } from "./service";

export const runtime = Atom.runtime(
  Layer.mergeAll(
    BriefStudio.layer,
    PlatformBrowser.BrowserKeyValueStore.layerSessionStorage,
  ),
);

export const workspaceId = "workspace-sunrise";

export const createScopeKey = BriefFormScopeKey.create(workspaceId);
export const editScopeKeys = [
  BriefFormScopeKey.edit(workspaceId, "renewal-playbook"),
  BriefFormScopeKey.edit(workspaceId, "admin-handoff"),
] as const;

export const makeDraftStorageKey = (scopeKey: BriefFormScopeKey) =>
  `@effect-atom-demo/brief-draft/${scopeKey.toString()}`;

export const briefDraftFamily = Atom.family((scopeKey: BriefFormScopeKey) => {
  const key = makeDraftStorageKey(scopeKey);
  let currentWriteVersion = 0;
  let currentLoadRequestId = 0;
  const loadDraftAtom = runtime.atom(
    Effect.gen(function*() {
      const store = (yield* KeyValueStore.KeyValueStore).forSchema(BriefDraft);
      const loadRequestId = ++currentLoadRequestId;
      const loadStartedAtWriteVersion = currentWriteVersion;
      const exit = yield* store.get(key).pipe(Effect.exit);
      return { loadRequestId, loadStartedAtWriteVersion, exit };
    }),
  );
  const saveDraftAtom = runtime.fn<BriefDraft | null>()((draft) =>
    Effect.gen(function*() {
      const store = (yield* KeyValueStore.KeyValueStore).forSchema(BriefDraft);

      if (draft === null) {
        yield* store.remove(key);
        return;
      }

      yield* store.set(key, draft);
    })
  );

  return Atom.writable(
    (get) => {
      get.mount(saveDraftAtom);
      get.subscribe(loadDraftAtom, (result) => {
        if (!Result.isSuccess(result)) {
          return;
        }

        if (
          result.value.loadRequestId !== currentLoadRequestId
          || result.value.loadStartedAtWriteVersion !== currentWriteVersion
        ) {
          return;
        }

        if (Exit.isFailure(result.value.exit)) {
          get.set(saveDraftAtom, null);
          get.setSelf(null);
          return;
        }

        get.setSelf(Option.isSome(result.value.exit.value) ? result.value.exit.value.value : null);
      }, { immediate: true });

      return Option.getOrElse(get.self<BriefDraft | null>(), () => null);
    },
    (context, draft) => {
      currentWriteVersion++;
      context.set(saveDraftAtom, draft);
      context.setSelf(draft);
    },
    (refresh) => refresh(loadDraftAtom),
  );
});

const briefFormBuilder = FormBuilder.empty
  .addField("title", Schema.String.pipe(Schema.nonEmptyString()))
  .addField("audience", Schema.String.pipe(Schema.nonEmptyString()))
  .addField("goal", Schema.String.pipe(Schema.nonEmptyString()))
  .addField("tone", ToneSchema)
  .addField("prompt", Schema.String.pipe(Schema.nonEmptyString()));

export const briefFormFamily = Atom.family((scopeKey: BriefFormScopeKey) =>
  FormReact.make(briefFormBuilder, {
    runtime,
    fields: {
      title: TitleField,
      audience: AudienceField,
      goal: GoalField,
      tone: ToneField,
      prompt: PromptField,
    },
    mode: { validation: "onSubmit" },
    onSubmit: (_, { decoded }) =>
      Effect.gen(function*() {
        const studio = yield* BriefStudio;
        return yield* studio.saveBrief({
          id: scopeKey.toString(),
          ...decoded,
        });
      }),
  })
);

type DraftSyncOptions = {
  readonly form: {
    readonly values: Atom.Atom<Option.Option<BriefDraft>>;
    readonly submit: Atom.Atom<Result.Result<SavedBrief, unknown>>;
    readonly hasChangedSinceSubmit: Atom.Atom<boolean>;
    readonly isDirty: Atom.Atom<boolean>;
  };
  readonly draftAtom: Atom.Writable<BriefDraft | null>;
};

const makeDraftSyncAtom = (options: DraftSyncOptions): Atom.Atom<void> => {
  const debouncedFormState = Atom.make((get) => ({
    valuesOption: get(options.form.values),
    submitResult: get(options.form.submit),
    hasChanged: get(options.form.hasChangedSinceSubmit),
    isDirty: get(options.form.isDirty),
  })).pipe(Atom.debounce("450 millis"));

  return Atom.readable((get) => {
    const { valuesOption, submitResult, hasChanged, isDirty } = get(debouncedFormState);

    if (Option.isNone(valuesOption)) {
      return;
    }

    if (!isDirty && !Result.isSuccess(submitResult)) {
      return;
    }

    if (Result.isSuccess(submitResult) && !hasChanged) {
      get.set(options.draftAtom, null);
      return;
    }

    get.set(options.draftAtom, valuesOption.value);
  });
};

export const briefDraftSyncFamily = Atom.family((scopeKey: BriefFormScopeKey) =>
  makeDraftSyncAtom({
    form: briefFormFamily(scopeKey),
    draftAtom: briefDraftFamily(scopeKey),
  })
);

export const scopeOptions = [
  {
    id: "create",
    label: "New brief",
    scopeKey: createScopeKey,
    defaultValues: emptyBriefDraft,
  },
  {
    id: "renewal-playbook",
    label: "Renewal playbook",
    scopeKey: editScopeKeys[0],
    defaultValues: new BriefDraft({
      title: "Renewal playbook",
      audience: "Account managers",
      goal: "Drive clearer renewal nudges",
      tone: "direct",
      prompt:
        "Write a compact renewal note that explains the next step, the customer signal we noticed, and the fastest way to book time with the team.",
    }),
  },
  {
    id: "admin-handoff",
    label: "Admin handoff",
    scopeKey: editScopeKeys[1],
    defaultValues: new BriefDraft({
      title: "Admin handoff",
      audience: "New workspace owners",
      goal: "Reduce setup confusion",
      tone: "warm",
      prompt:
        "Create a setup handoff message with the three first actions a new workspace owner should take during the first week.",
    }),
  },
] as const;
