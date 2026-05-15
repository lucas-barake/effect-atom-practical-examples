import { Atom, Registry } from "@effect-atom/atom-react";
import * as PlatformBrowser from "@effect/platform-browser";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  type AssistantEvent,
  type AssistantMessage,
  AssistantStudio,
  type ContentBlock,
  type ModelId,
  type ToolStatus,
} from "./service";

const ModelSchema = Schema.Literal("sonnet", "thinking", "gemini");
const { Reasoning, Text, ToolGroup } = Data.taggedEnum<ContentBlock>();

export const runtime = Atom.runtime(
  Layer.mergeAll(
    AssistantStudio.layer,
    PlatformBrowser.BrowserKeyValueStore.layerLocalStorage,
  ),
);

type StreamState = {
  readonly contentBlocks: readonly ContentBlock[];
};

export const modelLabels: Record<ModelId, string> = {
  sonnet: "Sonnet 4.6",
  thinking: "GPT 5 Thinking",
  gemini: "Gemini 2.5 Pro",
};

export const starterPrompts = [
  "Rewrite this launch note so it sounds clearer and more outcome focused.",
  "Improve this retention email and make the CTA more concrete.",
  "Give me a better structure for an onboarding message to new admins.",
] as const;

export const messagesAtom = Atom.make<readonly AssistantMessage[]>([]);
export const inputAtom = Atom.make("");
export const selectedModelAtom = Atom.kvs({
  runtime,
  key: "@effect-atom-demo/assistant-model",
  schema: ModelSchema,
  defaultValue: () => "sonnet" as const,
});

const nextStreamState = (state: StreamState, event: AssistantEvent): StreamState => {
  switch (event._tag) {
    case "Chunk": {
      const lastBlock = state.contentBlocks[state.contentBlocks.length - 1];
      if (lastBlock && lastBlock._tag === "Text") {
        return {
          contentBlocks: [
            ...state.contentBlocks.slice(0, -1),
            Text({ content: `${lastBlock.content}${event.delta}` }),
          ],
        };
      }
      return {
        contentBlocks: Arr.append(
          state.contentBlocks,
          Text({ content: event.delta }),
        ),
      };
    }
    case "ReasoningChunk": {
      const lastBlock = state.contentBlocks[state.contentBlocks.length - 1];
      if (lastBlock && lastBlock._tag === "Reasoning") {
        return {
          contentBlocks: [
            ...state.contentBlocks.slice(0, -1),
            Reasoning({ content: `${lastBlock.content}${event.delta}` }),
          ],
        };
      }
      return {
        contentBlocks: Arr.append(
          state.contentBlocks,
          Reasoning({ content: event.delta }),
        ),
      };
    }
    case "ToolStart": {
      const nextTool: ToolStatus = {
        id: event.callId,
        callId: event.callId,
        toolName: event.toolName,
        status: "start",
        input: event.input,
        output: null,
      };
      const lastBlock = state.contentBlocks[state.contentBlocks.length - 1];
      if (lastBlock && lastBlock._tag === "ToolGroup") {
        return {
          contentBlocks: [
            ...state.contentBlocks.slice(0, -1),
            ToolGroup({ tools: Arr.append(lastBlock.tools, nextTool) }),
          ],
        };
      }
      return {
        contentBlocks: Arr.append(
          state.contentBlocks,
          ToolGroup({ tools: [nextTool] }),
        ),
      };
    }
    case "ToolSuccess":
      return {
        contentBlocks: state.contentBlocks.map((block) =>
          block._tag !== "ToolGroup"
            ? block
            : ToolGroup({
              tools: block.tools.map((tool) =>
                tool.callId === event.callId && tool.status === "start"
                  ? { ...tool, status: "success" as const, output: event.output }
                  : tool
              ),
            })
        ),
      };
  }
};

const textFromBlocks = (blocks: readonly ContentBlock[]) =>
  blocks
    .filter((block): block is Data.TaggedEnum.Value<ContentBlock, "Text"> => block._tag === "Text")
    .map((block) => block.content)
    .join("");

export const sendMessageAtom = runtime.fn<string>()((message) => {
  let state: StreamState = { contentBlocks: [] };

  return Stream.unwrap(
    Effect.gen(function*() {
      const studio = yield* AssistantStudio;
      const registry = yield* Registry.AtomRegistry;

      const currentMessages = registry.get(messagesAtom);
      const selectedModel = registry.get(selectedModelAtom);

      const userMessage: AssistantMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        contentBlocks: [],
      };

      const assistantId = crypto.randomUUID();
      const assistantMessage: AssistantMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        contentBlocks: [],
      };

      registry.set(messagesAtom, [...currentMessages, userMessage, assistantMessage]);

      return studio.streamReply([...currentMessages, userMessage], selectedModel).pipe(
        Stream.tap((event) =>
          Effect.sync(() => {
            const latestMessages = registry.get(messagesAtom);
            const lastMessage = latestMessages[latestMessages.length - 1];

            if (
              !lastMessage || lastMessage.role !== "assistant" || lastMessage.id !== assistantId
            ) {
              return;
            }

            state = nextStreamState(state, event);

            registry.set(
              messagesAtom,
              latestMessages.map((item) =>
                item.id === assistantId
                  ? {
                    ...item,
                    content: textFromBlocks(state.contentBlocks),
                    contentBlocks: state.contentBlocks,
                  }
                  : item
              ),
            );
          })
        ),
        Stream.onError(() =>
          Effect.sync(() => {
            const latestMessages = registry.get(messagesAtom);
            const lastMessage = latestMessages[latestMessages.length - 1];

            if (
              !lastMessage || lastMessage.role !== "assistant" || lastMessage.id !== assistantId
            ) {
              return;
            }

            registry.set(
              messagesAtom,
              latestMessages.map((item) => {
                if (item.id !== assistantId) {
                  return item;
                }

                const failureMessage = "Stream failed. Try again.";

                return {
                  ...item,
                  content: item.content.length > 0
                    ? `${item.content}\n\n${failureMessage}`
                    : failureMessage,
                  contentBlocks: [
                    ...item.contentBlocks,
                    Text({ content: failureMessage }),
                  ],
                };
              }),
            );
          })
        ),
      );
    }),
  );
});

export const clearMessagesAtom: Atom.Writable<null, void> = Atom.writable(
  () => null,
  (context) => {
    context.set(messagesAtom, []);
  },
);
