// TODO(SPEC 11 手順3-5): 投影画面。手動モード → キーボード → YouTube 統合の順で実装する。
// いまはデプロイ経路検証のための最小版。
import { useEffect, useState } from "react";
import { socket } from "./socket";
import type { State } from "./types";

const EMPTY: State = { buzzedBy: null, lockedIds: [], players: [] };

export default function ScreenView() {
  const [state, setState] = useState<State>(EMPTY);

  useEffect(() => {
    const onState = (s: State) => setState(s);
    socket.on("state", onState);
    return () => {
      socket.off("state", onState);
    };
  }, []);

  return (
    <div className="flex h-full items-center justify-center gap-12 p-8">
      <img src="/qr.png" alt="QR" className="w-64" />
      <div>
        <div className="text-2xl text-neutral-400">参加者 {state.players.length}人</div>
        <div className="text-7xl font-black">
          {state.buzzedBy ? state.buzzedBy.name : "受付中"}
        </div>
      </div>
    </div>
  );
}
