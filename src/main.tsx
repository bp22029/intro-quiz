import { createRoot } from "react-dom/client";
import "./index.css";
import PlayerView from "./PlayerView";
import ScreenView from "./ScreenView";

// ルーティングライブラリは入れない。pathname 分岐で足りる。
const isScreen = window.location.pathname.startsWith("/screen");

createRoot(document.getElementById("root")!).render(
  isScreen ? <ScreenView /> : <PlayerView />,
);
