import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  /** Optional decorative mark shown above the title. */
  icon?: ReactNode;
  /** Detail or actions — a capture URL, a create button. */
  children?: ReactNode;
};

/**
 * The designed stand-in for a list with nothing in it. Every list in the app
 * uses this, so "empty" always reads as a deliberate state rather than a
 * rendering failure.
 */
const EmptyState = ({
  title,
  description,
  icon,
  children,
}: EmptyStateProps) => (
  <div className="border-base-300 bg-base-200/40 gap-snug px-gutter py-section rounded-box flex flex-col items-center border border-dashed text-center">
    {icon ? <div className="text-primary/70">{icon}</div> : null}
    <h2 className="text-title text-base-content font-semibold">{title}</h2>
    {description ? (
      <p className="text-body text-base-content/60 max-w-prose">
        {description}
      </p>
    ) : null}
    {children ? (
      <div className="gap-snug flex flex-col items-center">{children}</div>
    ) : null}
  </div>
);

export default EmptyState;
