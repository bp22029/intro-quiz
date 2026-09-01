import { createRoot } from "react-dom/client";
import "./index.css";
import HostView from "./HostView";
import PlayerView from "./PlayerView";
import ScreenView from "./ScreenView";

// ルーティングライブラリは入れない。pathname 分岐で足りる。
//   /        参加者（スマホ）
//   /screen  投影画面（表示専用）
//   /host    管理画面（手元のPCで操作）
const path = window.location.pathname;
const View = path.startsWith("/screen")
  ? ScreenView
  : path.startsWith("/host")
    ? HostView
    : PlayerView;

createRoot(document.getElementById("root")!).render(<View />);
