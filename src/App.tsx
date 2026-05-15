import { Bot, FileClock, Layers3 } from "lucide-react";
import { useState } from "react";
import { FixAllReviewExample } from "./features/fix-all-review/index";
import { PersistentFormExample } from "./features/persistent-form/index";
import { StreamingAssistantExample } from "./features/streaming-assistant/index";

const examples = [
  { id: "streaming", label: "Streaming", icon: Bot },
  { id: "forms", label: "Form drafts", icon: FileClock },
  { id: "fixAll", label: "Fix All", icon: Layers3 },
] as const;

export default function App() {
  const [selectedId, setSelectedId] = useState<(typeof examples)[number]["id"]>("streaming");

  return (
    <div className="AppShell">
      <nav className="TabBar">
        {examples.map((example) => {
          const Icon = example.icon;
          return (
            <button
              className={`TabButton ${selectedId === example.id ? "Selected" : ""}`}
              key={example.id}
              onClick={() => setSelectedId(example.id)}
              type="button"
            >
              <Icon size={16} />
              <span>{example.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="AppContent">
        {selectedId === "streaming" && <StreamingAssistantExample />}
        {selectedId === "forms" && <PersistentFormExample />}
        {selectedId === "fixAll" && <FixAllReviewExample />}
      </main>
    </div>
  );
}
