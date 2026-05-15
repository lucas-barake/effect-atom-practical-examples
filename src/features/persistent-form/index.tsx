import { useAtomMount, useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import { CheckCircle2, FilePenLine, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  briefDraftFamily,
  briefDraftSyncFamily,
  briefFormFamily,
  createScopeKey,
  editScopeKeys,
  scopeOptions,
} from "./atoms";
import { BriefDraft, type BriefFormScopeKey } from "./schema";
import { useDraftRestorer } from "./use-draft-restorer";

const DraftRestorer = ({
  scopeKey,
  originalPrompt,
}: {
  readonly scopeKey: BriefFormScopeKey;
  readonly originalPrompt: string;
}) => {
  const form = briefFormFamily(scopeKey);
  const draftAtom = briefDraftFamily(scopeKey);
  const setValues = useAtomSet(form.setValues);
  const resetForm = useAtomSet(form.reset);
  const clearDraft = useAtomSet(draftAtom);
  const [restored, setRestored] = useState(false);

  useDraftRestorer({
    draftAtom,
    isDirtyAtom: form.isDirty,
    onDraftFound: () => setRestored(true),
    onRestore: (draft) => {
      setValues(() => draft);
    },
  });

  if (!restored) {
    return null;
  }

  return (
    <div className="InfoBanner">
      <div>
        <strong>Draft restored</strong>
        <p>This scope remembered the last unsaved version from the session.</p>
      </div>
      <button
        className="SecondaryButton"
        onClick={() => {
          resetForm();
          setValues((current: BriefDraft) =>
            new BriefDraft({
              title: current.title,
              audience: current.audience,
              goal: current.goal,
              tone: current.tone,
              prompt: originalPrompt,
            })
          );
          clearDraft(null);
          setRestored(false);
        }}
        type="button"
      >
        Discard
      </button>
    </div>
  );
};

const BriefEditor = ({
  selectedId,
}: {
  readonly selectedId: (typeof scopeOptions)[number]["id"];
}) => {
  const activeScope = scopeOptions.find((item) => item.id === selectedId) ?? scopeOptions[0];
  const form = briefFormFamily(activeScope.scopeKey);
  const draftAtom = briefDraftFamily(activeScope.scopeKey);
  const draftSyncAtom = briefDraftSyncFamily(activeScope.scopeKey);

  useAtomMount(draftAtom);
  useAtomMount(draftSyncAtom);

  const submit = useAtomSet(form.submit);
  const submitResult = useAtomValue(form.submit);
  const isDirty = useAtomValue(form.isDirty);
  const hasChangedSinceSubmit = useAtomValue(form.hasChangedSinceSubmit);
  const values = useAtomValue(form.values);
  const promptDirty = useAtomValue(form.getFieldAtoms(form.fields.prompt).isDirty);

  return (
    <section className="DemoGrid">
      <div className="DemoMain">
        <div className="WorkspaceCard">
          <form.KeepAlive />
          <form.Initialize
            defaultValues={activeScope.defaultValues}
            key={activeScope.scopeKey.toString()}
          >
            <div className="FormLayout">
              <div className="FormColumn">
                <DraftRestorer
                  scopeKey={activeScope.scopeKey}
                  originalPrompt={activeScope.defaultValues.prompt}
                />

                <form
                  className="StackLarge"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                  }}
                >
                  <form.title />
                  <div className="DualFieldRow">
                    <form.audience />
                    <form.goal />
                  </div>
                  <form.tone />

                  <div className="FieldFrame">
                    <div className="FieldHeader">
                      <span className="FieldLabel">Prompt</span>
                      <span className={`StatusDot ${promptDirty ? "Active" : ""}`}>
                        {promptDirty ? "dirty" : "clean"}
                      </span>
                    </div>
                    <form.prompt />
                  </div>

                  <div className="ComposerFooter">
                    <span className="HintText">
                      Switch scopes, then refresh to see draft restore and KeepAlive together.
                    </span>
                    <button
                      className="PrimaryButton"
                      disabled={submitResult.waiting || !isDirty}
                      type="submit"
                    >
                      {submitResult.waiting ? "Saving..." : "Save"}
                    </button>
                  </div>
                </form>
              </div>

              <div className="FormSummary">
                <div className="SummaryCard">
                  {submitResult._tag === "Success"
                    ? (
                      <div className="StackSmall">
                        <div className="InlineNotice Success">
                          <CheckCircle2 size={16} />
                          Saved at {submitResult.value.savedAt}
                        </div>
                        <p>
                          Last saved title: <strong>{submitResult.value.title}</strong>
                        </p>
                      </div>
                    )
                    : submitResult.waiting
                    ? <p>Saving the form while the draft atom stays stable.</p>
                    : <p>Save once to clear the durable draft for this scope.</p>}
                </div>

                <div className="DebugCard">
                  <div className="DebugTitle">State</div>
                  <pre>
{JSON.stringify(
  {
    scopeKey: activeScope.scopeKey.toString(),
    isDirty,
    hasChangedSinceSubmit,
    values: Option.isSome(values) ? values.value : null,
  },
  null,
  2,
)}
                  </pre>
                </div>
              </div>
            </div>
          </form.Initialize>
        </div>
      </div>

      <aside className="SidePanel">
        <div className="DebugCard">
          <div className="DebugTitle">Scopes</div>
          <div className="ScopeList">
            {scopeOptions.map((option) => (
              <div
                className={`ScopeCard ${option.id === selectedId ? "Selected" : ""}`}
                key={option.id}
              >
                <div className="ScopeTitle">{option.label}</div>
                <p>{option.scopeKey.toString()}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </section>
  );
};

export const PersistentFormExample = () => {
  const [selectedId, setSelectedId] = useState<(typeof scopeOptions)[number]["id"]>("create");
  const createForm = briefFormFamily(createScopeKey);
  const editForms = editScopeKeys.map((scopeKey) => briefFormFamily(scopeKey));

  return (
    <div className="StackLarge">
      <div className="ScopeSwitcher">
        <div className="ScopeSwitcherHeader">
          <FilePenLine size={16} />
          <span>Form scopes</span>
        </div>

        <div className="ScopeButtons">
          {scopeOptions.map((option) => (
            <button
              className={`ScopeButton ${selectedId === option.id ? "Selected" : ""}`}
              key={option.id}
              onClick={() => setSelectedId(option.id)}
              type="button"
            >
              <div>{option.label}</div>
              <small>{option.scopeKey.toString()}</small>
            </button>
          ))}
        </div>
      </div>

      <createForm.KeepAlive />
      {editForms.map((form, index) => <form.KeepAlive key={editScopeKeys[index].toString()} />)}

      <BriefEditor selectedId={selectedId} />

      <div className="FootnoteRow">
        <RefreshCw size={14} />
        <span>Type in two scopes, switch between them, then reload the page.</span>
      </div>
    </div>
  );
};
