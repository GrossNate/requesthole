import { useEffect, useRef, useState } from "react";

type CopyButtonProps = {
  /** The exact string placed on the clipboard. */
  value: string;
  /** Resting label. The confirmation replaces it for a moment after a copy. */
  label?: string;
  className?: string;
};

const FEEDBACK_MS = 2000;

const ClipboardIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4"
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-4"
  >
    <path d="m4 12 5 5L20 6" />
  </svg>
);

/**
 * Copies a string to the clipboard and says so. The confirmation is the point:
 * a copy with no feedback is indistinguishable from a copy that failed, and
 * `navigator.clipboard` is simply absent on insecure origins.
 */
const CopyButton = ({ value, label = "Copy", className }: CopyButtonProps) => {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = () => {
    const settle = (next: "copied" | "failed") => {
      setStatus(next);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setStatus("idle"), FEEDBACK_MS);
    };

    void (async () => {
      try {
        await navigator.clipboard.writeText(value);
        settle("copied");
      } catch {
        settle("failed");
      }
    })();
  };

  const text =
    status === "copied"
      ? "Copied"
      : status === "failed"
        ? "Copy failed"
        : label;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`btn btn-sm btn-ghost gap-tight ${
        status === "copied"
          ? "text-success"
          : status === "failed"
            ? "text-error"
            : ""
      } ${className ?? ""}`}
    >
      {status === "copied" ? <CheckIcon /> : <ClipboardIcon />}
      <span className="text-caption">{text}</span>
      {/* The outcome is announced from here rather than from the label, so the
          label reverting on a timer is not announced as a second event. */}
      <span role="status" className="sr-only">
        {status === "copied"
          ? "Copied to clipboard"
          : status === "failed"
            ? "Could not copy to clipboard"
            : ""}
      </span>
    </button>
  );
};

export default CopyButton;
