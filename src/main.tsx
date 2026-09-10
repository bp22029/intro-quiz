import { createRoot } from "react-dom/client";
import "./index.css";
import HostView from "./HostView";
import LobbyView from "./LobbyView";
import PlayerView from "./PlayerView";
import ScreenView from "./ScreenView";
import { roomRef } from "./room";

// ルーティングライブラリは入れない。URL の読み取りは src/room.ts に寄せてある。
//   /                  ロビー（部屋を作る / コードを入れて参加する）
//   /r/<参加コード>     参加者（スマホ）
//   /screen/<主催キー>  投影画面（表示専用）
//   /host/<主催キー>    管理画面（進行操作。YouTubeモードの曲もここで鳴る）
//
// キーの無い裸の /host と /screen はロビーへ落とす。部屋が決まらないためで、
// ロビーから部屋を作り直せば新しいURLが出る。
const View =
  roomRef.kind === "player"
    ? PlayerView
    : roomRef.kind === "screen"
      ? ScreenView
      : roomRef.kind === "host"
        ? HostView
        : LobbyView;

createRoot(document.getElementById("root")!).render(<View />);
