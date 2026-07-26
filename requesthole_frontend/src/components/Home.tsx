import { Link } from "react-router-dom";
import type { MouseEventHandler } from "react";
import holeService from "../services";

import { type HomeBlockProps } from "../types";
import type React from "react";
import EmptyState from "./EmptyState";

const Home: React.FC<HomeBlockProps> = ({
  holes,
  setHoles,
  createHole,
  loadState,
}) => {
  const handleDeleteHole = (hole_address: string) => {
    const handler: MouseEventHandler = (event) => {
      event.preventDefault();
      holeService
        .deleteHole(hole_address)
        .then((isDeleted) => {
          if (isDeleted) {
            setHoles((prevHoles) =>
              prevHoles.filter((hole) => hole.hole_address !== hole_address),
            );
          }
        })
        .catch((error) => console.error(error));
    };
    return handler;
  };

  const handleCreateHole: MouseEventHandler = (event) => {
    event.preventDefault();
    createHole();
  };

  const createButton = () => (
    <button
      type="button"
      onClick={handleCreateHole}
      className="btn btn-primary gap-tight"
    >
      <span aria-hidden="true" className="text-lead leading-none">
        +
      </span>
      Create hole
    </button>
  );

  const holeList = () => (
    <div className="scroll-pane">
      <table className="table-pin-rows table w-full">
        <thead>
          <tr className="bg-base-200 text-base-content/60">
            <th scope="col">Address</th>
            <th scope="col" className="w-24">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {holes.map(({ hole_address }: { hole_address: string }) => (
            <tr
              key={hole_address}
              className="hover:bg-base-200/60 border-base-300"
            >
              <td>
                <Link
                  to={`/view/${hole_address}`}
                  className="address text-primary hover:underline"
                >
                  {hole_address}
                </Link>
              </td>
              <td className="text-right">
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-error"
                  onClick={handleDeleteHole(hole_address)}
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const listing = () => {
    if (loadState === "loading") {
      return (
        <p className="text-body text-base-content/50" role="status">
          Loading holes…
        </p>
      );
    }
    if (loadState === "failed") {
      return (
        <EmptyState
          title="Couldn't load your holes"
          description="The backend didn't answer. Check that it's running, then reload."
        />
      );
    }
    if (holes.length === 0) {
      return (
        <EmptyState
          title="No holes yet"
          description="Create a hole to get a capture URL, then point any HTTP client at it."
        >
          {createButton()}
        </EmptyState>
      );
    }
    return holeList();
  };

  return (
    <div className="gap-gutter flex h-full flex-col">
      <nav className="breadcrumbs text-caption py-0">
        <ul>
          <li className="text-base-content/40">All holes</li>
        </ul>
      </nav>

      <div className="gap-snug flex flex-wrap items-center justify-between">
        <div className="gap-tight flex flex-col">
          <h1 className="page-title">Holes</h1>
          <p className="text-body text-base-content/60">
            Each hole is a URL that captures every request sent to it.
          </p>
        </div>
        {holes.length > 0 ? createButton() : null}
      </div>

      {listing()}
    </div>
  );
};

export default Home;
