import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import MediaConfigProvider from "./MediaConfigProvider.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <MediaConfigProvider>
        <App />
      </MediaConfigProvider>
    </BrowserRouter>
  </StrictMode>,
);
