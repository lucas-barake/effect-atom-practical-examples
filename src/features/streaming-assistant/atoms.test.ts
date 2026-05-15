import * as Atom from "@effect-atom/atom/Atom";
import * as Registry from "@effect-atom/atom/Registry";
import * as Result from "@effect-atom/atom/Result";
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import * as Vitest from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  clearMessagesAtom,
  messagesAtom,
  runtime,
  selectedModelAtom,
  sendMessageAtom,
} from "./atoms";
import { AssistantStudio } from "./service";

const assistantModelStorageKey = "@effect-atom-demo/assistant-model";
const mockUuid = (value: string) => value as ReturnType<typeof crypto.randomUUID>;

const advance = async (ms = 0) => {
  await Vitest.vitest.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
};

const makeKeyValueStoreLayer = (storage: Map<string, string>) =>
  Layer.succeed(
    KeyValueStore.KeyValueStore,
    KeyValueStore.makeStringOnly({
      get: (key) => Effect.sync(() => Option.fromNullable(storage.get(key))),
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
  );

const makeStreamingRegistry = (options: {
  readonly streamReply: (...args: never[]) => Stream.Stream<unknown>;
  readonly localStorage: Map<string, string>;
}) =>
  Registry.make({
    initialValues: [
      Atom.initialValue(
        runtime.layer,
        Layer.mergeAll(
          Layer.succeed(
            AssistantStudio,
            {
              streamReply: options.streamReply,
            } as never,
          ),
          makeKeyValueStoreLayer(options.localStorage),
        ),
      ),
    ],
  });

Vitest.describe("streaming assistant atoms", () => {
  Vitest.beforeEach(() => {
    Vitest.vitest.useFakeTimers();
  });

  Vitest.afterEach(() => {
    Vitest.vitest.useRealTimers();
    Vitest.vitest.restoreAllMocks();
  });

  Vitest.it("persists the selected model through the injected key value store", async () => {
    const localStorage = new Map<string, string>();
    const firstRegistry = makeStreamingRegistry({
      streamReply: () => Stream.fromIterable([]),
      localStorage,
    });

    firstRegistry.mount(selectedModelAtom);
    await advance();

    Vitest.expect(firstRegistry.get(selectedModelAtom)).toEqual("sonnet");

    firstRegistry.set(selectedModelAtom, "gemini");
    await advance();

    Vitest.expect(localStorage.get(assistantModelStorageKey)).toEqual(JSON.stringify("gemini"));

    const secondRegistry = makeStreamingRegistry({
      streamReply: () => Stream.fromIterable([]),
      localStorage,
    });

    secondRegistry.mount(selectedModelAtom);
    await advance();

    Vitest.expect(secondRegistry.get(selectedModelAtom)).toEqual("gemini");
  });

  Vitest.it(
    "builds one assistant message from mixed tool, reasoning, and text events",
    async () => {
      const streamReply = Vitest.vitest.fn((messages: readonly unknown[], model: string) => {
        void messages;
        void model;

        return Stream.fromIterable([
          { _tag: "ToolStart", callId: "inspect-1", toolName: "InspectBrief", input: "prompt" },
          { _tag: "ToolStart", callId: "draft-1", toolName: "DraftReply", input: "rewrite" },
          {
            _tag: "ToolSuccess",
            callId: "inspect-1",
            toolName: "InspectBrief",
            output: "found context",
          },
          { _tag: "ReasoningChunk", delta: "Think " },
          { _tag: "ReasoningChunk", delta: "carefully " },
          { _tag: "Chunk", delta: "Final " },
          { _tag: "Chunk", delta: "answer" },
        ]).pipe(Stream.tap(() => Effect.sleep("10 millis")));
      });
      const registry = makeStreamingRegistry({
        streamReply: streamReply as never,
        localStorage: new Map(),
      });
      const uuidValues = ["user-id", "assistant-id"];

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementation(() =>
        mockUuid(uuidValues.shift() ?? "extra-id")
      );

      registry.mount(messagesAtom);
      registry.mount(selectedModelAtom);
      registry.mount(sendMessageAtom);

      registry.set(selectedModelAtom, "gemini");
      registry.set(messagesAtom, [
        {
          id: "prior-id",
          role: "assistant",
          content: "Earlier answer",
          contentBlocks: [],
        },
      ]);

      registry.set(sendMessageAtom, "Rewrite this");

      Vitest.expect(registry.get(messagesAtom)).toEqual([
        {
          id: "prior-id",
          role: "assistant",
          content: "Earlier answer",
          contentBlocks: [],
        },
        {
          id: "user-id",
          role: "user",
          content: "Rewrite this",
          contentBlocks: [],
        },
        {
          id: "assistant-id",
          role: "assistant",
          content: "",
          contentBlocks: [],
        },
      ]);

      Vitest.expect(streamReply).toHaveBeenCalledWith(
        [
          {
            id: "prior-id",
            role: "assistant",
            content: "Earlier answer",
            contentBlocks: [],
          },
          {
            id: "user-id",
            role: "user",
            content: "Rewrite this",
            contentBlocks: [],
          },
        ],
        "gemini",
      );

      await advance(100);

      const messages = registry.get(messagesAtom);
      const assistant = messages[messages.length - 1];

      Vitest.expect(assistant).toEqual({
        id: "assistant-id",
        role: "assistant",
        content: "Final answer",
        contentBlocks: [
          {
            _tag: "ToolGroup",
            tools: [
              {
                id: "inspect-1",
                callId: "inspect-1",
                toolName: "InspectBrief",
                status: "success",
                input: "prompt",
                output: "found context",
              },
              {
                id: "draft-1",
                callId: "draft-1",
                toolName: "DraftReply",
                status: "start",
                input: "rewrite",
                output: null,
              },
            ],
          },
          {
            _tag: "Reasoning",
            content: "Think carefully ",
          },
          {
            _tag: "Text",
            content: "Final answer",
          },
        ],
      });
    },
  );

  Vitest.it(
    "ignores later stream events after clearMessagesAtom empties the transcript",
    async () => {
      const registry = makeStreamingRegistry({
        streamReply: (() =>
          Stream.fromIterable([
            { _tag: "Chunk", delta: "Hello" },
            { _tag: "Chunk", delta: " there" },
          ]).pipe(Stream.tap(() => Effect.sleep("10 millis")))) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockReturnValue(mockUuid("message-id"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "Start");

      Vitest.expect(registry.get(sendMessageAtom).waiting).toBe(true);

      await advance(5);
      registry.set(clearMessagesAtom, undefined);
      await advance(50);

      Vitest.expect(registry.get(messagesAtom)).toEqual([]);
    },
  );

  Vitest.it(
    "does not append a failure marker after clearMessagesAtom removes the active assistant before the stream fails",
    async () => {
      const registry = makeStreamingRegistry({
        streamReply: (() =>
          Stream.fromIterable([
            { _tag: "Chunk", delta: "Hello" },
          ]).pipe(
            Stream.tap(() => Effect.sleep("10 millis")),
            Stream.concat(Stream.fail("boom")),
          )) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
        .mockImplementationOnce(() => mockUuid("assistant-id"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "Start");

      await advance(5);
      registry.set(clearMessagesAtom, undefined);
      await advance(50);

      Vitest.expect(Result.isFailure(registry.get(sendMessageAtom))).toBe(true);
      Vitest.expect(registry.get(messagesAtom)).toEqual([]);
    },
  );

  Vitest.it(
    "ignores later stream events when another trailing user message is appended mid stream",
    async () => {
      const registry = makeStreamingRegistry({
        streamReply: (() =>
          Stream.fromIterable([
            { _tag: "Chunk", delta: "Hello" },
            { _tag: "Chunk", delta: " there" },
          ]).pipe(Stream.tap(() => Effect.sleep("10 millis")))) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
        .mockImplementationOnce(() => mockUuid("assistant-id"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "Start");
      await advance(5);

      registry.set(messagesAtom, [
        ...registry.get(messagesAtom),
        {
          id: "trailing-user",
          role: "user",
          content: "Interrupting message",
          contentBlocks: [],
        },
      ]);
      await advance(50);

      Vitest.expect(registry.get(messagesAtom)).toEqual([
        {
          id: "user-id",
          role: "user",
          content: "Start",
          contentBlocks: [],
        },
        {
          id: "assistant-id",
          role: "assistant",
          content: "",
          contentBlocks: [],
        },
        {
          id: "trailing-user",
          role: "user",
          content: "Interrupting message",
          contentBlocks: [],
        },
      ]);
    },
  );

  Vitest.it(
    "ignores a failed stream when another trailing user message is appended mid stream",
    async () => {
      const registry = makeStreamingRegistry({
        streamReply: (() =>
          Stream.fromIterable([
            { _tag: "Chunk", delta: "Hello" },
          ]).pipe(
            Stream.tap(() => Effect.sleep("10 millis")),
            Stream.concat(Stream.fail("boom")),
          )) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
        .mockImplementationOnce(() => mockUuid("assistant-id"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "Start");
      await advance(5);

      registry.set(messagesAtom, [
        ...registry.get(messagesAtom),
        {
          id: "trailing-user",
          role: "user",
          content: "Interrupting message",
          contentBlocks: [],
        },
      ]);
      await advance(50);

      Vitest.expect(Result.isFailure(registry.get(sendMessageAtom))).toBe(true);
      Vitest.expect(registry.get(messagesAtom)).toEqual([
        {
          id: "user-id",
          role: "user",
          content: "Start",
          contentBlocks: [],
        },
        {
          id: "assistant-id",
          role: "assistant",
          content: "",
          contentBlocks: [],
        },
        {
          id: "trailing-user",
          role: "user",
          content: "Interrupting message",
          contentBlocks: [],
        },
      ]);
    },
  );

  Vitest.it(
    "ignores late events from the first stream after a second send starts a newer assistant stream",
    async () => {
      let callCount = 0;
      const registry = makeStreamingRegistry({
        streamReply: (() => {
          callCount++;

          return callCount === 1
            ? Stream.fromIterable([
              { _tag: "Chunk", delta: "First" },
            ]).pipe(Stream.tap(() => Effect.sleep("10 millis")))
            : Stream.fromIterable([
              { _tag: "Chunk", delta: "Second" },
            ]);
        }) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-1"))
        .mockImplementationOnce(() => mockUuid("assistant-1")).mockImplementationOnce(() =>
          mockUuid("user-2")
        )
        .mockImplementationOnce(() => mockUuid("assistant-2"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "First prompt");
      await advance(5);
      registry.set(sendMessageAtom, "Second prompt");
      await advance(20);

      Vitest.expect(registry.get(messagesAtom)).toEqual([
        {
          id: "user-1",
          role: "user",
          content: "First prompt",
          contentBlocks: [],
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          contentBlocks: [],
        },
        {
          id: "user-2",
          role: "user",
          content: "Second prompt",
          contentBlocks: [],
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: "Second",
          contentBlocks: [
            {
              _tag: "Text",
              content: "Second",
            },
          ],
        },
      ]);
    },
  );

  Vitest.it(
    "ignores a failed first stream after a second send starts a newer assistant stream",
    async () => {
      let callCount = 0;
      const registry = makeStreamingRegistry({
        streamReply: (() => {
          callCount++;

          return callCount === 1
            ? Stream.fromIterable([
              { _tag: "Chunk", delta: "First" },
            ]).pipe(
              Stream.tap(() => Effect.sleep("10 millis")),
              Stream.concat(Stream.fail("boom")),
            )
            : Stream.fromIterable([
              { _tag: "Chunk", delta: "Second" },
            ]);
        }) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-1"))
        .mockImplementationOnce(() => mockUuid("assistant-1")).mockImplementationOnce(() =>
          mockUuid("user-2")
        )
        .mockImplementationOnce(() => mockUuid("assistant-2"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "First prompt");
      await advance(5);
      registry.set(sendMessageAtom, "Second prompt");
      await advance(20);

      Vitest.expect(Result.isFailure(registry.get(sendMessageAtom))).toBe(false);
      Vitest.expect(registry.get(messagesAtom)).toEqual([
        {
          id: "user-1",
          role: "user",
          content: "First prompt",
          contentBlocks: [],
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          contentBlocks: [],
        },
        {
          id: "user-2",
          role: "user",
          content: "Second prompt",
          contentBlocks: [],
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: "Second",
          contentBlocks: [
            {
              _tag: "Text",
              content: "Second",
            },
          ],
        },
      ]);
    },
  );

  Vitest.it(
    "matches tool success by callId so repeated tool names do not complete the wrong card",
    async () => {
      const registry = makeStreamingRegistry({
        streamReply: (() =>
          Stream.fromIterable([
            {
              _tag: "ToolStart",
              callId: "inspect-1",
              toolName: "InspectBrief",
              input: "first prompt",
            },
            {
              _tag: "ToolStart",
              callId: "inspect-2",
              toolName: "InspectBrief",
              input: "second prompt",
            },
            {
              _tag: "ToolSuccess",
              callId: "inspect-2",
              toolName: "InspectBrief",
              output: "second result",
            },
          ]).pipe(Stream.tap(() => Effect.sleep("10 millis")))) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
        .mockImplementationOnce(() => mockUuid("assistant-id"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "Inspect this");
      await advance(40);

      const assistant = registry.get(messagesAtom)[1];

      Vitest.expect(assistant).toEqual({
        id: "assistant-id",
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            _tag: "ToolGroup",
            tools: [
              {
                id: "inspect-1",
                callId: "inspect-1",
                toolName: "InspectBrief",
                status: "start",
                input: "first prompt",
                output: null,
              },
              {
                id: "inspect-2",
                callId: "inspect-2",
                toolName: "InspectBrief",
                status: "success",
                input: "second prompt",
                output: "second result",
              },
            ],
          },
        ],
      });
    },
  );

  Vitest.it("ignores a second tool success for the same callId after completion", async () => {
    const registry = makeStreamingRegistry({
      streamReply: (() =>
        Stream.fromIterable([
          { _tag: "ToolStart", callId: "inspect-1", toolName: "InspectBrief", input: "prompt" },
          {
            _tag: "ToolSuccess",
            callId: "inspect-1",
            toolName: "InspectBrief",
            output: "first result",
          },
          {
            _tag: "ToolSuccess",
            callId: "inspect-1",
            toolName: "InspectBrief",
            output: "second result",
          },
        ]).pipe(Stream.tap(() => Effect.sleep("10 millis")))) as never,
      localStorage: new Map(),
    });

    Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
      .mockImplementationOnce(() => mockUuid("assistant-id"));

    registry.mount(messagesAtom);
    registry.mount(sendMessageAtom);
    registry.set(sendMessageAtom, "Inspect this");
    await advance(50);

    Vitest.expect(registry.get(messagesAtom)[1]).toEqual({
      id: "assistant-id",
      role: "assistant",
      content: "",
      contentBlocks: [
        {
          _tag: "ToolGroup",
          tools: [
            {
              id: "inspect-1",
              callId: "inspect-1",
              toolName: "InspectBrief",
              status: "success",
              input: "prompt",
              output: "first result",
            },
          ],
        },
      ],
    });
  });

  Vitest.it(
    "preserves text and reasoning blocks when tool success arrives after later content blocks",
    async () => {
      const registry = makeStreamingRegistry({
        streamReply: (() =>
          Stream.fromIterable([
            { _tag: "ToolStart", callId: "inspect-1", toolName: "InspectBrief", input: "prompt" },
            { _tag: "ReasoningChunk", delta: "Check " },
            { _tag: "Chunk", delta: "Answer" },
            {
              _tag: "ToolSuccess",
              callId: "inspect-1",
              toolName: "InspectBrief",
              output: "found context",
            },
          ]).pipe(Stream.tap(() => Effect.sleep("10 millis")))) as never,
        localStorage: new Map(),
      });

      Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
        .mockImplementationOnce(() => mockUuid("assistant-id"));

      registry.mount(messagesAtom);
      registry.mount(sendMessageAtom);
      registry.set(sendMessageAtom, "Inspect this");
      await advance(50);

      Vitest.expect(registry.get(messagesAtom)[1]).toEqual({
        id: "assistant-id",
        role: "assistant",
        content: "Answer",
        contentBlocks: [
          {
            _tag: "ToolGroup",
            tools: [
              {
                id: "inspect-1",
                callId: "inspect-1",
                toolName: "InspectBrief",
                status: "success",
                input: "prompt",
                output: "found context",
              },
            ],
          },
          {
            _tag: "Reasoning",
            content: "Check ",
          },
          {
            _tag: "Text",
            content: "Answer",
          },
        ],
      });
    },
  );

  Vitest.it("surfaces a failed assistant stream and makes the transcript explicit", async () => {
    const registry = makeStreamingRegistry({
      streamReply: (() => Stream.fail("boom")) as never,
      localStorage: new Map(),
    });

    Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
      .mockImplementationOnce(() => mockUuid("assistant-id"));

    registry.mount(messagesAtom);
    registry.mount(sendMessageAtom);
    registry.set(sendMessageAtom, "Inspect this");
    await advance();

    Vitest.expect(Result.isFailure(registry.get(sendMessageAtom))).toBe(true);
    Vitest.expect(registry.get(messagesAtom)).toEqual([
      {
        id: "user-id",
        role: "user",
        content: "Inspect this",
        contentBlocks: [],
      },
      {
        id: "assistant-id",
        role: "assistant",
        content: "Stream failed. Try again.",
        contentBlocks: [
          {
            _tag: "Text",
            content: "Stream failed. Try again.",
          },
        ],
      },
    ]);
  });

  Vitest.it("keeps partial streamed blocks and still surfaces a failed stream", async () => {
    const registry = makeStreamingRegistry({
      streamReply: (() =>
        Stream.fromIterable([
          { _tag: "ToolStart", callId: "inspect-1", toolName: "InspectBrief", input: "prompt" },
        ]).pipe(Stream.concat(Stream.fail("boom")))) as never,
      localStorage: new Map(),
    });

    Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
      .mockImplementationOnce(() => mockUuid("assistant-id"));

    registry.mount(messagesAtom);
    registry.mount(sendMessageAtom);
    registry.set(sendMessageAtom, "Inspect this");
    await advance();

    Vitest.expect(Result.isFailure(registry.get(sendMessageAtom))).toBe(true);
    Vitest.expect(registry.get(messagesAtom)).toEqual([
      {
        id: "user-id",
        role: "user",
        content: "Inspect this",
        contentBlocks: [],
      },
      {
        id: "assistant-id",
        role: "assistant",
        content: "Stream failed. Try again.",
        contentBlocks: [
          {
            _tag: "ToolGroup",
            tools: [
              {
                id: "inspect-1",
                callId: "inspect-1",
                toolName: "InspectBrief",
                status: "start",
                input: "prompt",
                output: null,
              },
            ],
          },
          {
            _tag: "Text",
            content: "Stream failed. Try again.",
          },
        ],
      },
    ]);
  });

  Vitest.it("surfaces a stream failure after partial text has already been emitted", async () => {
    const registry = makeStreamingRegistry({
      streamReply: (() =>
        Stream.fromIterable([
          { _tag: "Chunk", delta: "Hello" },
        ]).pipe(Stream.concat(Stream.fail("boom")))) as never,
      localStorage: new Map(),
    });

    Vitest.vitest.spyOn(crypto, "randomUUID").mockImplementationOnce(() => mockUuid("user-id"))
      .mockImplementationOnce(() => mockUuid("assistant-id"));

    registry.mount(messagesAtom);
    registry.mount(sendMessageAtom);
    registry.set(sendMessageAtom, "Inspect this");
    await advance();

    Vitest.expect(Result.isFailure(registry.get(sendMessageAtom))).toBe(true);
    Vitest.expect(registry.get(messagesAtom)).toEqual([
      {
        id: "user-id",
        role: "user",
        content: "Inspect this",
        contentBlocks: [],
      },
      {
        id: "assistant-id",
        role: "assistant",
        content: "Hello\n\nStream failed. Try again.",
        contentBlocks: [
          {
            _tag: "Text",
            content: "Hello",
          },
          {
            _tag: "Text",
            content: "Stream failed. Try again.",
          },
        ],
      },
    ]);
  });
});
