import { Atom, useAtom } from "@effect-atom/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Bot, FileClock, Layers3 } from "lucide-react";
import { useEffect } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FixAllReviewExample } from "@/features/fix-all-review/index";
import { PersistentFormExample } from "@/features/persistent-form/index";
import { StreamingAssistantExample } from "@/features/streaming-assistant/index";

const examples = [
  {
    id: "streaming",
    label: "Streaming assistant",
    description: "Chat state, streamed updates, and tool output in one flow.",
    icon: Bot,
  },
  {
    id: "forms",
    label: "Form drafts",
    description: "A simple form that preserves draft state across scopes.",
    icon: FileClock,
  },
  {
    id: "fixAll",
    label: "Fix All review",
    description: "Batch review items, patch failures, and run follow up checks.",
    icon: Layers3,
  },
] as const;

const selectedExampleIdAtom = Atom.searchParam("tab", {
  schema: Schema.Literal("streaming", "forms", "fixAll"),
});

export default function App() {
  const [selectedIdOption, setSelectedId] = useAtom(selectedExampleIdAtom);
  const selectedId = Option.getOrElse(selectedIdOption, () => "streaming" as const);

  useEffect(() => {
    if (Option.isNone(selectedIdOption)) {
      setSelectedId(Option.some("streaming"));
    }
  }, [selectedIdOption, setSelectedId]);

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
        <Tabs
          value={selectedId}
          onValueChange={(value) =>
            setSelectedId(Option.some(value as (typeof examples)[number]["id"]))}
          className="gap-6"
        >
          <TabsList className="grid w-full grid-cols-1 justify-stretch gap-2 rounded-xl bg-muted/40 p-1 group-data-horizontal/tabs:h-auto md:grid-cols-3">
            {examples.map((example) => {
              const Icon = example.icon;

              return (
                <TabsTrigger
                  key={example.id}
                  value={example.id}
                  className="h-auto flex-col items-start gap-2 px-4 py-3 text-left whitespace-normal"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Icon />
                    {example.label}
                  </span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {example.description}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="streaming" className="mt-0 outline-none">
            <StreamingAssistantExample />
          </TabsContent>
          <TabsContent value="forms" className="mt-0 outline-none">
            <PersistentFormExample />
          </TabsContent>
          <TabsContent value="fixAll" className="mt-0 outline-none">
            <FixAllReviewExample />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
