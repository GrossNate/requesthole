import { Link } from "react-router-dom";
import type { MouseEventHandler } from "react";
import holeService from "../services";

import { type HomeBlockProps } from "../types";
import type React from "react";

const Home: React.FC<HomeBlockProps> = ({ holes, setHoles, createHole }) => {
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

  const maybeHoleList = () => {
    if (holes.length === 0) return null;

    return (
      <div className="h-full overflow-y-auto pb-16">
        <table className="table table-lg table-pin-rows">
          <thead>
            <tr>
              <th colSpan={2} className="text-xl">
                Holes
              </th>
            </tr>
          </thead>
          <tbody>{allHoles()}</tbody>
        </table>
      </div>
    );
  };

  const handleCreateHole: MouseEventHandler = (event) => {
    event.preventDefault();
    createHole();
  };

  const allHoles = () => {
    return holes.map(({ hole_address }: { hole_address: string }) => (
      <tr key={hole_address}>
        <td>
          <Link to={`/view/${hole_address}`}>{hole_address}</Link>
        </td>
        <td>
          <button
            className="btn btn-sm btn-error"
            onClick={handleDeleteHole(hole_address)}
          >
            delete
          </button>
        </td>
      </tr>
    ));
  };

  return (
    <>
      <div className="breadcrumbs text-sm">
        <ul>
          <li>
            <div className="btn btn-ghost btn-disabled">All holes</div>
          </li>
        </ul>
      </div>
      <button onClick={handleCreateHole} className="btn btn-secondary">
        create hole
      </button>
      {maybeHoleList()}
    </>
  );
};

export default Home;
