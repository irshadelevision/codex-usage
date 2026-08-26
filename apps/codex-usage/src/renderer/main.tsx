import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AboutView } from "./AboutView.tsx";
import { App } from "./App.tsx";
import { MenuBarView } from "./MenuBarView.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Renderer root was not found");

const view = new URLSearchParams(window.location.search).get("view");
if (view === "menu-bar") document.documentElement.classList.add("menu-bar-document");

createRoot(root).render(
  <StrictMode>
    {view === "about" ? <AboutView /> : view === "menu-bar" ? <MenuBarView /> : <App />}
  </StrictMode>,
);
