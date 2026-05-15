import { useAtom, useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Data from "effect/Data";
import {
  Bot,
  ChevronDown,
  Cpu,
  Hammer,
  LoaderCircle,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import * as React from "react";
import {
  clearMessagesAtom,
  inputAtom,
  messagesAtom,
  modelLabels,
  selectedModelAtom,
  sendMessageAtom,
  starterPrompts,
} from "./atoms";
import type { ContentBlock } from "./service";

const PromptButton = ({ prompt }: { readonly prompt: string; }) => {
  const setInput = useAtomSet(inputAtom);

  return (
    <button
      className="PromptChip"
      onClick={() => setInput(prompt)}
      type="button"
    >
      <Sparkles size={14} />
      <span>{prompt}</span>
    </button>
  );
};

const ToolGroup = (
  { block }: { readonly block: Data.TaggedEnum.Value<ContentBlock, "ToolGroup">; },
) => (
  <div className="ToolGroup">
    {block.tools.map((tool) => (
      <div key={tool.id} className="ToolCard">
        <div className="ToolTitle">
          <Hammer size={14} />
          <span>{tool.toolName}</span>
          <span className={`StatusPill ${tool.status === "success" ? "Success" : "Subtle"}`}>
            {tool.status === "success" ? "Success" : "Start"}
          </span>
        </div>
        <div className="ToolBody">
          <div className="FieldLabel">Input</div>
          <p>{tool.input}</p>
          {tool.output !== null && (
            <>
              <div className="FieldLabel">Output</div>
              <p>{tool.output}</p>
            </>
          )}
        </div>
      </div>
    ))}
  </div>
);

const AssistantBubble = ({
  content,
  contentBlocks,
  isStreaming,
}: {
  readonly content: string;
  readonly contentBlocks: readonly ContentBlock[];
  readonly isStreaming: boolean;
}) => (
  <article className="MessageBubble Assistant">
    <div className="MessageHeader">
      <div className="MessageIdentity">
        <span className="MessageAvatar AssistantAvatar">
          <Bot size={14} />
        </span>
        <span>Assistant</span>
      </div>
      {isStreaming && (
        <span className="StatusPill Subtle">
          <LoaderCircle size={14} className="Spin" />
          Streaming
        </span>
      )}
    </div>

    <div className="MessageBody">
      {contentBlocks.map((block, index) => {
        if (block._tag === "Text") {
          return (
            <p key={index} className="MessageText">
              {block.content}
            </p>
          );
        }

        if (block._tag === "Reasoning") {
          return (
            <details key={index} className="ReasoningBlock">
              <summary>
                <Wrench size={14} />
                Reasoning
              </summary>
              <p>{block.content}</p>
            </details>
          );
        }

        return <ToolGroup key={index} block={block} />;
      })}

      {contentBlocks.length === 0 && (
        <p className="EmptyStateText">
          {isStreaming ? "Thinking..." : content || "(no response yet)"}
        </p>
      )}
    </div>
  </article>
);

const MessageList = () => {
  const messages = useAtomValue(messagesAtom);
  const sendResult = useAtomValue(sendMessageAtom);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="PlaceholderStage">
        <span className="PlaceholderIcon">
          <Cpu size={18} />
        </span>
        <p>Stream tokens, reasoning, and tool updates from one atom driven flow.</p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="MessageList">
      {messages.map((message, index) =>
        message.role === "user"
          ? (
            <article key={message.id} className="MessageBubble User">
              <div className="MessageHeader">
                <div className="MessageIdentity">
                  <span className="MessageAvatar UserAvatar">You</span>
                  <span>Prompt</span>
                </div>
              </div>
              <p className="MessageText">{message.content}</p>
            </article>
          )
          : (
            <AssistantBubble
              content={message.content}
              contentBlocks={message.contentBlocks}
              isStreaming={sendResult.waiting && index === messages.length - 1}
              key={message.id}
            />
          )
      )}
    </div>
  );
};

const Composer = () => {
  const [input, setInput] = useAtom(inputAtom);
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom);
  const sendResult = useAtomValue(sendMessageAtom);
  const sendMessage = useAtomSet(sendMessageAtom);
  const clearMessages = useAtomSet(clearMessagesAtom);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const isStreaming = sendResult.waiting;

  const submit = (value: string) => {
    if (value.trim().length === 0 || isStreaming) {
      return;
    }

    sendMessage(value.trim());
    setInput("");

    if (textareaRef.current !== null) {
      textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="ComposerShell">
      <div className="ComposerToolbar">
        <div className="ModelMenu">
          <span className="FieldLabel">Model</span>
          <div className="SelectShell">
            <select
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value as typeof selectedModel)}
            >
              {Object.entries(modelLabels).map(([model, label]) => (
                <option key={model} value={model}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>
        </div>

        <button className="GhostButton" onClick={() => clearMessages(undefined)} type="button">
          <Trash2 size={14} />
          Clear
        </button>
      </div>

      <div className="PromptRow">
        {starterPrompts.map((prompt) => <PromptButton key={prompt} prompt={prompt} />)}
      </div>

      <form
        className="ComposerForm"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <textarea
          className="ComposerInput"
          disabled={isStreaming}
          onChange={(event) => {
            setInput(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(event) => {
            if (!event.shiftKey && event.key === "Enter") {
              event.preventDefault();
              submit(input);
            }
          }}
          placeholder="Ask for a rewrite, summary, or structured AI response..."
          ref={textareaRef}
          rows={3}
          value={input}
        />

        <div className="ComposerFooter">
          <span className="HintText">One function atom drives the whole stream.</span>
          <button
            className="PrimaryButton"
            disabled={isStreaming || input.trim().length === 0}
            type="submit"
          >
            {isStreaming ? "Streaming..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
};

const Notes = () => {
  const messages = useAtomValue(messagesAtom);
  const result = useAtomValue(sendMessageAtom);
  const selectedModel = useAtomValue(selectedModelAtom);

  return (
    <aside className="SidePanel">
      <div className="DebugCard">
        <div className="DebugTitle">State</div>
        <pre>
{JSON.stringify(
  {
    selectedModel,
    messageCount: messages.length,
    waiting: result.waiting,
  },
  null,
  2,
)}
        </pre>
      </div>
    </aside>
  );
};

export const StreamingAssistantExample = () => (
  <section className="DemoGrid">
    <div className="DemoMain">
      <div className="WorkspaceCard">
        <MessageList />
        <Composer />
      </div>
    </div>
    <Notes />
  </section>
);
