import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Embed from "./Embed";
import EmbedSectors from "./EmbedSectors";
import "./styles.css";

const path = location.pathname.replace(/\/+$/, "");
const Page = path === "/embed" ? Embed : path === "/embed/sectors" ? EmbedSectors : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
