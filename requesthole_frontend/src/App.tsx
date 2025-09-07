import { useState, useEffect } from "react";
import holeService from "./services";
import Home from "./components/Home";
import Hole from "./components/Hole";
import Request from "./components/Request";
import { type holeObject } from "./types";
import { Routes, Route, Link } from "react-router-dom";

function App() {
  const [holes, setHoles] = useState<holeObject[]>([]);

  useEffect(() => {
    holeService
      .getHoles()
      .then((responseHoles) => {
        setHoles(responseHoles);
      })
      .catch((error) => console.error(error));
  }, []);

  const createHole = async () => {
    const result = await holeService.addHole();
    setHoles((prevHoles) => [...prevHoles, {hole_address: result[0].hole_address}]);
  };

  return (
    <>
      <div className="navbar bg-base-100">
        <div className="flex-1">
          <a className="btn btn-ghost text-xl">
            <img src="favicon.png"></img>
            RequestHole
          </a>
        </div>
        <div className="flex-none z-50">
          <ul className="menu menu-horizontal px-1">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li>
              <details id="basketMenuDetails">
                <summary>Holes</summary>
                <ul className="bg-base-100 rounded-t-none p-2">
                  {holes.map((hole) => (
                    <li key={hole.hole_address}>
                      <Link to={`/view/${hole.hole_address}`}>
                        {hole.hole_address}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          </ul>
        </div>
      </div>
      <Routes>
        <Route path="/view/:hole_address" element={<Hole />} />
        <Route
          path="/"
          element={
            <Home holes={holes} setHoles={setHoles} createHole={createHole} />
          }
        />
        <Route
          path="/view/:hole_address/:request_address"
          element={<Request />}
        />
      </Routes>
    </>
  );
}

export default App;
