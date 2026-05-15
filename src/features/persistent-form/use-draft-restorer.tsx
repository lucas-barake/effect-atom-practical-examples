import { Atom, RegistryContext, useAtomSubscribe } from "@effect-atom/atom-react";
import { useContext, useRef } from "react";
import { BriefDraft } from "./schema";

export const useDraftRestorer = (options: {
  readonly draftAtom: Atom.Atom<BriefDraft | null>;
  readonly isDirtyAtom: Atom.Atom<boolean>;
  readonly onRestore: (draft: BriefDraft) => void;
  readonly onDraftFound: () => void;
}) => {
  const registry = useContext(RegistryContext);
  const restored = useRef(false);

  useAtomSubscribe(
    options.draftAtom,
    (draft) => {
      if (restored.current) {
        return;
      }

      restored.current = true;

      if (draft === null) {
        return;
      }

      options.onDraftFound();

      if (registry.get(options.isDirtyAtom)) {
        return;
      }

      options.onRestore(draft);
    },
    { immediate: true },
  );
};
