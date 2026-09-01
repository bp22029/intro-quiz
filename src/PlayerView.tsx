import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import type { JoinAck, State } from "./types";

const NAME_KEY = "introquiz:name";

const EMPTY: State = { buzzedBy: null, lockedIds: [], players: [] };

export default function PlayerView() {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<State>(EMPTY);
  const [myId, setMyId] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  // タップ直後にサーバーの返事を待たずボタンを殺すためのフラグ
  const [pressed, setPressed] = useState(false);

  // socket.on("connect") のたびに join を送り直すため、最新の名前を ref で持つ
  const nameRef = useRef<string | null>(null);
  nameRef.current = name;

  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) {
      setDraft(saved);
      // 4.5: 前回の名前があるなら自動で復帰させる（入れ直させない）
      setName(saved);
    }
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setMyId(socket.id ?? null);
      // サーバーはメモリ管理なので socket.id が変わると登録が消えている。毎回送り直す。
      const n = nameRef.current;
      if (n) socket.emit("join", n, (_ack: JoinAck) => {});
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: State) => setState(s);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
    };
  }, []);

  // 名前が決まった / 変わったタイミングでも join し直す
  useEffect(() => {
    if (name && socket.connected) {
      socket.emit("join", name, (ack: JoinAck) => setMyId(ack.id));
    }
  }, [name]);

  // ラウンドが変わって受付中に戻ったら、ローカルの押下フラグを解除する
  useEffect(() => {
    if (state.buzzedBy === null) setPressed(false);
  }, [state.buzzedBy]);

  function submitName() {
    const n = draft.trim().slice(0, 12) || "名無し";
    localStorage.setItem(NAME_KEY, n);
    setName(n);
  }

  if (!name) {
    return (
      <div className="flex h-full flex-col justify-center gap-6 p-8">
        <h1 className="text-3xl font-bold">イントロクイズ</h1>
        <p className="text-neutral-400">名前を入れて参加してください</p>
        <input
          className="rounded-xl bg-neutral-800 px-5 py-5 text-2xl outline-none focus:ring-2 focus:ring-red-500"
          value={draft}
          maxLength={12}
          autoFocus
          placeholder="なまえ"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitName();
          }}
        />
        <button
          className="rounded-xl bg-red-600 px-5 py-5 text-2xl font-bold active:bg-red-700"
          onClick={submitName}
        >
          参加する
        </button>
        <ConnBadge connected={connected} />
      </div>
    );
  }

  const iAmBuzzed = !!myId && state.buzzedBy?.id === myId;
  const iAmLocked = !!myId && state.lockedIds.includes(myId);
  const someoneElse = !!state.buzzedBy && !iAmBuzzed;

  // 表示は state を素直に描くが、pressed のときだけローカル優先で先に殺す
  const disabled = pressed || !!state.buzzedBy || iAmLocked;

  let label: string;
  let color: string;
  if (iAmBuzzed) {
    label = "あなた！";
    color = "bg-green-600";
  } else if (someoneElse) {
    label = `${state.buzzedBy!.name}さんが\n押しました`;
    color = "bg-neutral-700";
  } else if (iAmLocked) {
    label = "この曲は\nここまで";
    color = "bg-neutral-700";
  } else if (pressed) {
    label = "送信中…";
    color = "bg-neutral-700";
  } else {
    label = "押す！";
    color = "bg-red-600";
  }

  function buzz() {
    if (disabled) return;
    // 往復を待つと必ず連打される。即座に殺す。
    setPressed(true);
    navigator.vibrate?.(30);
    socket.emit("buzz");
  }

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-center justify-between pb-2 text-sm text-neutral-400">
        <span>{name}</span>
        <ConnBadge connected={connected} />
      </div>
      <button
        className={`w-full flex-1 whitespace-pre-line rounded-3xl text-6xl font-black transition-colors ${color} ${
          disabled ? "opacity-70" : "active:scale-[0.98]"
        }`}
        disabled={disabled}
        onPointerDown={buzz}
      >
        {label}
      </button>
    </div>
  );
}

function ConnBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`text-sm ${connected ? "text-green-500" : "text-yellow-500"}`}>
      {connected ? "● 接続中" : "○ 再接続中…"}
    </span>
  );
}
