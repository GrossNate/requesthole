/**
 * An HTTP method, colored by what it does — reads cool, writes warm, deletes
 * red. Scanning a long capture list is mostly scanning this column.
 */
const METHOD_STYLES: Record<string, string> = {
  GET: "badge-info",
  HEAD: "badge-info",
  OPTIONS: "badge-info",
  POST: "badge-primary",
  PUT: "badge-secondary",
  PATCH: "badge-secondary",
  DELETE: "badge-error",
};

const MethodBadge = ({ method }: { method: string }) => {
  const normalized = method.toUpperCase();
  const style = METHOD_STYLES[normalized] ?? "badge-neutral";

  return (
    <span
      className={`badge badge-sm ${style} text-caption font-mono font-semibold`}
    >
      {normalized}
    </span>
  );
};

export default MethodBadge;
