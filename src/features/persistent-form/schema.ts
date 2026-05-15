import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

export const ToneSchema = Schema.Literal("confident", "warm", "direct");

export class BriefDraft extends Schema.Class<BriefDraft>("BriefDraft")({
  title: Schema.String,
  audience: Schema.String,
  goal: Schema.String,
  tone: ToneSchema,
  prompt: Schema.String,
}) {}

export class SavedBrief extends Schema.Class<SavedBrief>("SavedBrief")({
  id: Schema.String,
  title: Schema.String,
  audience: Schema.String,
  goal: Schema.String,
  tone: ToneSchema,
  prompt: Schema.String,
  savedAt: Schema.String,
}) {}

export class BriefFormScopeKey extends Data.Class<{
  readonly workspaceId: string;
  readonly scope:
    | { readonly mode: "create"; }
    | { readonly mode: "edit"; readonly briefId: string; };
}> {
  static create(workspaceId: string) {
    return new this({
      workspaceId,
      scope: { mode: "create" },
    });
  }

  static edit(workspaceId: string, briefId: string) {
    return new this({
      workspaceId,
      scope: { mode: "edit", briefId },
    });
  }

  override toString() {
    return this.scope.mode === "create"
      ? `create/${this.workspaceId}`
      : `edit/${this.workspaceId}/${this.scope.briefId}`;
  }
}

export const emptyBriefDraft = new BriefDraft({
  title: "",
  audience: "",
  goal: "",
  tone: "confident",
  prompt: "",
});
