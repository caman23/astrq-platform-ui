import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Embed from "./Embed";
import "./styles.css";

const isEmbed = location.pathname.replace(/\/+$/, "") === "/embed";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isEmbed ? <Embed /> : <App />}</StrictMode>,
);
