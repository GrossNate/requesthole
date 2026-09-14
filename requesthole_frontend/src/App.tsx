import {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import holeService from "./services";
import Home from "./components/Home";
import Hole from "./components/Hole";
import { type holeObject, type LoadState } from "./types";
import {
  Routes,
  Route,
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";
import EmptyState from "./components/EmptyState";
import { HoleLimitError } from "./errors";

// Limits are operator settings, so the message names none of them; the only
// number is the wait the limiter itself reports.
const waitPhrase = (seconds: number | undefined) => {
  if (seconds === undefined) return "later";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "in about a minute" : `in about ${minutes} minutes`;
};

// `retryAt` is when the hourly limit lifts. The wait is worked out from it
// whenever the message is shown, so one that waited for the reader still
// tells the truth.
const createErrorMessage = (error: unknown, now: number, retryAt?: number) => {
  if (error instanceof HoleLimitError) {
    switch (error.reason) {
      case "full":
        return "This RequestHole is full: it already holds as many holes as it is allowed. Try again once older holes expire.";
      case "rate-limit":
        return `You're creating holes faster than this RequestHole allows. Try again ${waitPhrase(
          retryAt === undefined ? undefined : (retryAt - now) / 1000,
        )}.`;
      case "share":
        return "You've reached the limit on live holes from your address. Delete a hole you no longer need, then try again.";
    }
  }
  return "Couldn't create a hole. The backend didn't answer. Check that it's running, then try again.";
};

type CreateError = {
  error: unknown;
  message: string;
  /** When an hourly-limit refusal lifts; past it, the message is untrue. */
  retryAt: number | undefined;
  /** Deleting a hole makes room only for a share refusal. */
  clearsOnDelete: boolean;
  /** The page the create started on; the message belongs there. */
  page: string;
  /** Whether the reader has had it on screen. */
  seen: boolean;
};

function App() {
  const [holes, setHoles] = useState<holeObject[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // Kept apart from `loadState`: a create that fails says nothing about the
  // list, which may have loaded perfectly well.
  const [createError, setCreateError] = useState<CreateError | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Where the reader is when a create settles, which can be a page they
  // moved to after clicking. Read after the await, so it has to be a ref, and
  // it is kept in a layout effect: that runs inside the commit, so no network
  // callback can land between a navigation and the ref catching up. (Router
  // navigations are transitions, whose passive effects are deferred.)
  const pathnameRef = useRef(pathname);
  useLayoutEffect(() => {
    pathnameRef.current = pathname;
  });
  // Bumped by each create. A create that a newer one has superseded does not
  // get to report: its outcome says nothing about the latest attempt.
  const latestCreate = useRef(0);

  // A message belongs to the page the create started on and only renders
  // there. One that landed while the reader was elsewhere waits until they
  // come back and see it, with its wait worked out afresh, or is dropped if
  // that wait has passed; once seen, leaving the page retires it. A layout
  // effect, so the refreshed text is what paints first.
  useLayoutEffect(() => {
    setCreateError((previous) => {
      if (previous === null) return previous;
      if (previous.page !== pathname) return previous.seen ? null : previous;
      if (previous.seen) return previous;
      const now = Date.now();
      if (previous.retryAt !== undefined && now >= previous.retryAt) {
        return null;
      }
      return {
        ...previous,
        seen: true,
        message: createErrorMessage(previous.error, now, previous.retryAt),
      };
    });
  }, [pathname]);

  // Deleting a hole makes room against the per-client share and nothing
  // else: an hourly-limit or ceiling message still holds afterwards.
  const setHolesAfterDelete: typeof setHoles = useCallback((update) => {
    setCreateError((previous) => (previous?.clearsOnDelete ? null : previous));
    setHoles(update);
  }, []);

  const loadHoles = useCallback(() => {
    setLoadState("loading");
    holeService
      .getHoles()
      .then((responseHoles) => {
        setHoles(responseHoles);
        setLoadState("loaded");
      })
      .catch((error) => {
        console.error(error);
        setLoadState("failed");
      });
  }, []);

  useEffect(() => {
    loadHoles();
  }, [loadHoles]);

  const createHole = async () => {
    // Reachable from the failed-load panel, so the backend may well still be
    // down. Without the catch the rejection went nowhere and the button read
    // as doing nothing at all.
    const page = pathname;
    const attempt = ++latestCreate.current;
    setCreateError(null);
    try {
      const result = await holeService.addHole();
      setHoles((prevHoles) => [
        ...prevHoles,
        { hole_address: result[0].hole_address },
      ]);
      // A successful create also clears a stale failure: the list is no longer
      // unknown, and leaving it "failed" would report the new hole as lost.
      setLoadState("loaded");
      // The hole exists either way, but only the latest create moves the
      // reader: an older one landing late would yank them somewhere else.
      if (attempt === latestCreate.current) {
        navigate(`/view/${result[0].hole_address}`);
      }
    } catch (error) {
      console.error(error);
      if (attempt !== latestCreate.current) return;
      // The list is exactly as it was. A refusal (429, 503) is the backend
      // enforcing a limit, and even a real failure here says nothing about
      // holes that already loaded; the message says which it was.
      const now = Date.now();
      const retryAt =
        error instanceof HoleLimitError && error.retryAfterSeconds !== undefined
          ? now + error.retryAfterSeconds * 1000
          : undefined;
      setCreateError({
        error,
        message: createErrorMessage(error, now, retryAt),
        retryAt,
        clearsOnDelete:
          error instanceof HoleLimitError && error.reason === "share",
        page,
        seen: pathnameRef.current === page,
      });
    }
  };

  return (
    <div className="bg-base-100 text-base-content flex h-screen flex-col overflow-hidden">
      <header className="border-base-300 bg-base-100/80 border-b backdrop-blur">
        <div className="navbar px-gutter gap-gutter min-h-0 py-snug">
          {/* Logo and wordmark are one mark: the disk sits tight against the
              type, and the two share a baseline. */}
          <Link to="/" className="gap-snug group flex items-center">
            <img
              src="/favicon.png"
              alt="RequestHole logo"
              className="size-9 drop-shadow-[0_0_12px_var(--color-primary)] transition-transform group-hover:scale-105"
            />
            <span className="text-title leading-none font-semibold tracking-tight">
              Request
              <span className="text-primary">Hole</span>
            </span>
          </Link>

          <nav className="gap-tight flex grow items-center justify-end">
            <Link to="/" className="btn btn-sm btn-ghost text-body">
              Home
            </Link>
            <div className="dropdown dropdown-hover dropdown-end">
              <div
                tabIndex={0}
                role="button"
                className="btn btn-sm btn-ghost text-body"
              >
                Holes
                <span className="text-base-content/40 text-caption">
                  {holes.length > 0 ? holes.length : ""}
                </span>
              </div>
              {/* No top margin: the menu is positioned outside the trigger's
                  box, so a gap is ground the pointer crosses while hovering
                  neither one, and the menu closes before it can be reached.
                  The breathing room comes from the menu's own padding.
                  Width follows the content — a six-character address needs
                  nowhere near a fixed 14rem. */}
              <ul
                tabIndex={0}
                className="menu dropdown-content bg-base-200 border-base-300 rounded-box z-1 w-max min-w-32 border p-tight shadow-lg"
              >
                {holes.length === 0 ? (
                  <li>
                    <EmptyState
                      compact
                      title={
                        loadState === "failed"
                          ? "Couldn't load holes"
                          : loadState === "loading"
                            ? "Loading…"
                            : "No holes yet"
                      }
                    />
                  </li>
                ) : (
                  holes.map((hole) => (
                    <li key={hole.hole_address}>
                      <Link
                        to={`/view/${hole.hole_address}`}
                        className="address"
                      >
                        {hole.hole_address}
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </nav>
        </div>
      </header>
      <main className="px-gutter py-gutter min-h-0 flex-1">
        <Routes>
          <Route path="/view/:hole_address" element={<Hole />} />
          <Route
            path="/"
            element={
              <Home
                holes={holes}
                setHoles={setHolesAfterDelete}
                createHole={createHole}
                reloadHoles={loadHoles}
                loadState={loadState}
                createError={
                  createError?.page === pathname ? createError.message : null
                }
              />
            }
          />
          {/* Both hole routes render the same view: the request address only
              selects which capture the detail pane shows, so opening one never
              unmounts the live list. */}
          <Route
            path="/view/:hole_address/:request_address"
            element={<Hole />}
          />
        </Routes>
      </main>
    </div>
  );
}

export default App;
