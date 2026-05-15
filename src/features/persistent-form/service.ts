import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BriefDraft, SavedBrief } from "./schema";

const make = Effect.sync(() =>
  ({
    saveBrief: (draft: BriefDraft & { readonly id: string; }) =>
      Effect.sleep("400 millis").pipe(
        Effect.as(
          new SavedBrief({
            id: draft.id,
            title: draft.title,
            audience: draft.audience,
            goal: draft.goal,
            tone: draft.tone,
            prompt: draft.prompt,
            savedAt: new Date().toLocaleTimeString(),
          }),
        ),
      ),
  }) as const
);

export class BriefStudio extends Context.Tag("BriefStudio")<
  BriefStudio,
  {
    readonly saveBrief: (draft: BriefDraft & { readonly id: string; }) => Effect.Effect<SavedBrief>;
  }
>() {
  static layer = Layer.effect(this, make);
}
