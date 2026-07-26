import { useState, useEffect, useCallback } from "react";
import holeService from "./services";
import Home from "./components/Home";
import Hole from "./components/Hole";
import Request from "./components/Request";
import { type holeObject, type LoadState } from "./types";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import EmptyState from "./components/EmptyState";

function App() {
  const [holes, setHoles] = useState<holeObject[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const navigate = useNavigate();

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
    const result = await holeService.addHole();
    setHoles((prevHoles) => [
      ...prevHoles,
      { hole_address: result[0].hole_address },
    ]);
    navigate(`/view/${result[0].hole_address}`);
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
              <ul
                tabIndex={0}
                className="menu dropdown-content bg-base-200 border-base-300 rounded-box z-1 mt-tight w-56 border p-tight shadow-lg"
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
                setHoles={setHoles}
                createHole={createHole}
                reloadHoles={loadHoles}
                loadState={loadState}
              />
            }
          />
          <Route
            path="/view/:hole_address/:request_address"
            element={<Request />}
          />
        </Routes>
      </main>
    </div>
  );
}

export default App;
