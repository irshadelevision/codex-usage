import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AboutView } from "./AboutView.tsx";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Renderer root was not found");

const view = new URLSearchParams(window.location.search).get("view");

createRoot(root).render(<StrictMode>{view === "about" ? <AboutView /> : <App />}</StrictMode>);
