import { createRoot } from "react-dom/client";
import "./index.css";
import HostView from "./HostView";
import PlayerView from "./PlayerView";
import ScreenView from "./ScreenView";
import SoundView from "./SoundView";

// ルーティングライブラリは入れない。pathname 分岐で足りる。
//   /        参加者（スマホ）
//   /screen  投影画面（表示専用）
//   /host    管理画面（手元のPCで操作）
//   /sound   再生窓（YouTubeモードで曲を鳴らす。管理画面の隣に置く）
const path = window.location.pathname;
const View = path.startsWith("/screen")
  ? ScreenView
  : path.startsWith("/host")
    ? HostView
    : path.startsWith("/sound")
      ? SoundView
      : PlayerView;

createRoot(document.getElementById("root")!).render(<View />);
