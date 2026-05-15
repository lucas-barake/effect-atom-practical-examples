import { Atom, Result, useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Cause from "effect/Cause";
import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldAlert, Sparkles } from "lucide-react";
import {
  fixAllAtom,
  lastReviewSourceAtom,
  reviewItemsAtom,
  runItemReviewAtom,
  runReviewsAtom,
} from "./atoms";
import { ReviewItem } from "./schema";

const ReviewBanner = () => {
  const fixAllResult = useAtomValue(fixAllAtom);
  const runReviewsResult = useAtomValue(runReviewsAtom);
  const lastSource = useAtomValue(lastReviewSourceAtom);
  const resetFixAll = useAtomSet(fixAllAtom);
  const resetReviews = useAtomSet(runReviewsAtom);
  const setLastSource = useAtomSet(lastReviewSourceAtom);

  if (fixAllResult.waiting || runReviewsResult.waiting) {
    return (
      <div className="NoticeBanner Loading">
        <LoaderCircle size={16} className="Spin" />
        <div>
          <strong>{fixAllResult.waiting ? "Applying fixes..." : "Running review..."}</strong>
          <p>
            Each row subscribes to its own family keyed review state while the parent action waits.
          </p>
        </div>
      </div>
    );
  }

  if (
    Result.isSuccess(fixAllResult)
    && (fixAllResult.value.successCount > 0 || fixAllResult.value.failureCount > 0)
  ) {
    return (
      <div className="NoticeBanner Success">
        <CheckCircle2 size={16} />
        <div>
          <strong>
            Fixed {fixAllResult.value.successCount}{" "}
            item{fixAllResult.value.successCount === 1 ? "" : "s"}.
          </strong>
          <p>Every successful patch triggered a follow up review.</p>
        </div>
        <button className="SecondaryButton" onClick={() => resetFixAll(Atom.Reset)} type="button">
          Dismiss
        </button>
      </div>
    );
  }

  if (Result.isSuccess(runReviewsResult) && lastSource !== null) {
    return (
      <div className="NoticeBanner Neutral">
        <Sparkles size={16} />
        <div>
          <strong>
            {lastSource === "manual" ? "Review complete." : "Post-fix review complete."}
          </strong>
          <p>
            {runReviewsResult.value.successCount}{" "}
            item{runReviewsResult.value.successCount === 1 ? "" : "s"} updated and
            {` `}
            {runReviewsResult.value.failureCount} failed.
          </p>
        </div>
        <button
          className="SecondaryButton"
          onClick={() => {
            resetReviews(Atom.Reset);
            setLastSource(null);
          }}
          type="button"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (Result.isFailure(fixAllResult)) {
    return (
      <div className="NoticeBanner Danger">
        <AlertTriangle size={16} />
        <div>
          <strong>Fix All failed</strong>
          <p>{Cause.pretty(fixAllResult.cause)}</p>
        </div>
      </div>
    );
  }

  return null;
};

const ReviewRow = ({ item }: { readonly item: ReviewItem; }) => {
  const runResult = useAtomValue(runItemReviewAtom(item.id));
  const runOne = useAtomSet(runItemReviewAtom(item.id));
  const isRunning = item.evaluation === null && runResult.waiting;

  const status = isRunning
    ? {
      label: "Evaluating",
      className: "Subtle",
      icon: <LoaderCircle size={14} className="Spin" />,
    }
    : item.evaluation === null
    ? {
      label: "Needs review",
      className: "Subtle",
      icon: <ShieldAlert size={14} />,
    }
    : item.evaluation.passed
    ? {
      label: "Ready",
      className: "Success",
      icon: <CheckCircle2 size={14} />,
    }
    : {
      label: "Needs fixes",
      className: "Warning",
      icon: <AlertTriangle size={14} />,
    };

  return (
    <article className="ReviewCard">
      <div className="ReviewHeader">
        <div>
          <h3>{item.title}</h3>
          <p>
            Owner {item.owner}. Due by {item.dueDate}.
          </p>
        </div>
        <span className={`StatusPill ${status.className}`}>{status.icon}{status.label}</span>
      </div>

      <p className="ReviewContent">{item.content}</p>

      {item.evaluation !== null && !item.evaluation.passed && (
        <ul className="ViolationList">
          {item.evaluation.violations.map((violation) => (
            <li key={violation.code}>{violation.message}</li>
          ))}
        </ul>
      )}

      <div className="ReviewActions">
        <button
          className="SecondaryButton"
          onClick={() =>
            runOne({
              itemId: item.id,
              title: item.title,
              content: item.content,
            })}
          type="button"
        >
          Run row review
        </button>
      </div>
    </article>
  );
};

export const FixAllReviewExample = () => {
  const itemsResult = useAtomValue(reviewItemsAtom);
  const runReviewsResult = useAtomValue(runReviewsAtom);
  const fixAllResult = useAtomValue(fixAllAtom);
  const runReviews = useAtomSet(runReviewsAtom);
  const fixAll = useAtomSet(fixAllAtom);

  const items = Result.getOrElse(itemsResult, () => [] as readonly ReviewItem[]);
  const pendingFixCount =
    items.filter((item) => item.evaluation !== null && !item.evaluation.passed).length;

  return (
    <section className="DemoGrid">
      <div className="DemoMain">
        <ReviewBanner />

        <div className="WorkspaceCard StackLarge">
          <div className="ToolbarRow">
            <div className="ToolbarMeta">
              <strong>
                {pendingFixCount} item{pendingFixCount === 1 ? "" : "s"} still need fixes
              </strong>
              <p>
                Run the batch review, then patch only the violated items and recheck successful
                ones.
              </p>
            </div>

            <div className="ToolbarActions">
              <button
                className="SecondaryButton"
                disabled={runReviewsResult.waiting || fixAllResult.waiting}
                onClick={() => runReviews({ itemIds: "all", source: "manual" })}
                type="button"
              >
                Run checks
              </button>
              <button
                className="PrimaryButton"
                disabled={pendingFixCount === 0 || runReviewsResult.waiting || fixAllResult.waiting}
                onClick={() => fixAll()}
                type="button"
              >
                Fix All
              </button>
            </div>
          </div>

          {Result.builder(itemsResult)
            .onInitial(() => (
              <div className="PlaceholderStage Compact">
                <LoaderCircle size={18} className="Spin" />
                <p>Loading review items...</p>
              </div>
            ))
            .onSuccess((loadedItems) => (
              <div className="ReviewGrid">
                {loadedItems.map((item) => <ReviewRow item={item} key={item.id} />)}
              </div>
            ))
            .render()}
        </div>
      </div>

      <aside className="SidePanel">
        <div className="DebugCard">
          <div className="DebugTitle">State</div>
          <pre>
{JSON.stringify(
  {
    loadedItems: items.length,
    pendingFixCount,
    runWaiting: runReviewsResult.waiting,
    fixWaiting: fixAllResult.waiting,
  },
  null,
  2,
)}
          </pre>
        </div>
      </aside>
    </section>
  );
};
