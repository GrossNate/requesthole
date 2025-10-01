import { useState, useEffect } from "react";
import holeService from "./services";
import Home from "./components/Home";
import Hole from "./components/Hole";
import Request from "./components/Request";
import { type holeObject } from "./types";
import { Routes, Route, Link, useNavigate } from "react-router-dom";

function App() {
  const [holes, setHoles] = useState<holeObject[]>([]);
  const navigate = useNavigate();

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
    setHoles((prevHoles) => [
      ...prevHoles,
      { hole_address: result[0].hole_address },
    ]);
    navigate(`/view/${result[0].hole_address}`);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="h-20">
        <div className="navbar bg-base-100">
          <div className="ps-3">
            <h1 className="text-xl">
              <img src="favicon.png" className="max-h-10"></img>
            </h1>
          </div>
          <div className="ps-3">
            <h1 className="text-xl">RequestHole</h1>
          </div>
          <div className="flex grow justify-end px-2">
            <div className="flex items-stretch">
              <div className="btn btn-ghost rounded-field">
                <Link to="/">Home</Link>
              </div>
              <div className="dropdown dropdown-hover">
                <div
                  tabIndex={0}
                  role="button"
                  className="btn btn-ghost rounded-field"
                >
                  Holes
                </div>
                <ul
                  tabIndex={0}
                  className="menu dropdown-content bg-base-200 rounded-box z-1 w-52 shadow-sm"
                >
                  {holes.map((hole) => (
                    <li key={hole.hole_address}>
                      <Link to={`/view/${hole.hole_address}`}>
                        {hole.hole_address}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0">
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
      </main>
    </div>
  );
}

export default App;
