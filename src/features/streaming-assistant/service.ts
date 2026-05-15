import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

export type ModelId = "sonnet" | "thinking" | "gemini";

export type ToolStatus = {
  readonly id: string;
  readonly toolName: string;
  readonly status: "start" | "success";
  readonly input: string;
  readonly output: string | null;
};

export type ContentBlock = Data.TaggedEnum<{
  readonly Text: { readonly content: string; };
  readonly Reasoning: { readonly content: string; };
  readonly ToolGroup: { readonly tools: readonly ToolStatus[]; };
}>;

export type AssistantMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly contentBlocks: readonly ContentBlock[];
};

export type AssistantEvent = Data.TaggedEnum<{
  readonly ReasoningChunk: { readonly delta: string; };
  readonly ToolStart: { readonly toolName: string; readonly input: string; };
  readonly ToolSuccess: { readonly toolName: string; readonly output: string; };
  readonly Chunk: { readonly delta: string; };
}>;

const { Chunk, ReasoningChunk, ToolStart, ToolSuccess } = Data.taggedEnum<AssistantEvent>();

const make = Effect.sync(() => {
  return {
    streamReply: (messages: readonly AssistantMessage[], model: ModelId) => {
      const prompt = messages[messages.length - 1]?.content.trim().toLowerCase() ?? "";
      const mode = prompt.includes("launch")
        ? "launch"
        : prompt.includes("retention")
        ? "retention"
        : prompt.includes("email")
        ? "email"
        : "general";

      const reasoning = mode === "launch"
        ? "Breaking the launch request into audience, proof, and action."
        : mode === "retention"
        ? "Checking where the retention message feels vague or low urgency."
        : mode === "email"
        ? "Cleaning the email structure around one clear job to be done."
        : "Looking for the smallest useful improvement path.";

      const toolInput = mode === "launch"
        ? "Inspect launch brief, target audience, and expected action."
        : mode === "retention"
        ? "Inspect retention note, missing proof, and CTA quality."
        : mode === "email"
        ? "Inspect subject line, opening, and CTA clarity."
        : "Inspect prompt intent and missing context.";

      const toolOutput = mode === "launch"
        ? "Found a concrete audience, one missing metric, and a weak CTA."
        : mode === "retention"
        ? "Found a vague offer, no urgency, and soft language."
        : mode === "email"
        ? "Found repeated phrasing and a generic opening."
        : "Found enough context to suggest a tighter structure.";

      const answer = mode === "launch"
        ? "Lead with the launch change in the first sentence, name the audience plainly, add one proof point with a number, and end with a direct request to try the feature this week."
        : mode === "retention"
        ? "Anchor the message in the moment the user is stuck, follow with the outcome they want, and replace the CTA with one action that feels immediate and specific."
        : mode === "email"
        ? "Open with the problem before the feature, cut the body to two proof points, and rewrite the CTA so it describes the next action instead of sounding promotional."
        : "Make the audience explicit, define the one action you want after the message, and trim any sentence that does not support that action.";

      const chunks = answer.split(/(\s+)/).filter((part) => part.length > 0);

      return Stream.fromIterable([
        ToolStart({ toolName: "InspectBrief", input: toolInput }),
        ToolSuccess({ toolName: "InspectBrief", output: toolOutput }),
        ReasoningChunk({ delta: `${reasoning} ` }),
        ...chunks.map((delta) => Chunk({ delta })),
      ]).pipe(
        Stream.tap(() => Effect.sleep(model === "thinking" ? "85 millis" : "60 millis")),
      );
    },
  } as const;
});

export class AssistantStudio extends Context.Tag("AssistantStudio")<
  AssistantStudio,
  {
    readonly streamReply: (
      messages: readonly AssistantMessage[],
      model: ModelId,
    ) => Stream.Stream<AssistantEvent>;
  }
>() {
  static layer = Layer.effect(this, make);
}
