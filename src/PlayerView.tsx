import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import { useCountdown } from "./useCountdown";
import type { JoinAck, State } from "./types";

const NAME_KEY = "introquiz:name";
const CLIENT_KEY = "introquiz:clientId";

/**
 * 端末ごとの固定ID。socket.id はページを開き直すと変わるため、
 * これを参加者の identity にする。これがないとリロードでお手つきが解除できてしまう。
 */
function getClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_KEY);
    if (saved) return saved;
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_KEY, id);
    return id;
  } catch {
    // localStorage が使えない環境では毎回別人扱いになるが、動作は止めない
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

const clientId = getClientId();

const EMPTY: State = {
  buzzedBy: null,
  lockedIds: [],
  lockedNames: [],
  players: [],
  round: {
    index: 0,
    revealed: false,
    playing: false,
    wrongName: null,
    resumeInMs: 0,
  },
  mode: "manual",
  songs: [],
  ytStatus: { ready: false, readyCount: 0, total: 0 },
};

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
      setMyId(clientId);
      // サーバーはメモリ管理なので、繋がり直すたびに登録し直す
      const n = nameRef.current;
      if (n) socket.emit("join", { name: n, clientId }, (_ack: JoinAck) => {});
    };
    const onDisconnect = () => setConnected(false);
    const onState = (s: State) => setState(s);
    // 司会が参加者を一括クリアしたとき、まだ繋がっている人は入り直す
    const onRejoin = () => {
      const n = nameRef.current;
      if (n) socket.emit("join", { name: n, clientId }, (_ack: JoinAck) => {});
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    socket.on("rejoin", onRejoin);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
      socket.off("rejoin", onRejoin);
    };
  }, []);

  // 名前が決まった / 変わったタイミングでも join し直す
  useEffect(() => {
    if (name && socket.connected) {
      socket.emit("join", { name, clientId }, (ack: JoinAck) => setMyId(ack.id));
    }
  }, [name]);

  // ラウンドが変わって受付中に戻ったら、ローカルの押下フラグを解除する
  useEffect(() => {
    if (state.buzzedBy === null) setPressed(false);
  }, [state.buzzedBy]);

  // お手つき後のカウントダウン。サーバーがこの間 buzz を受け付けない
  const countdown = useCountdown(state.round.resumeInMs);
  const showWrong = state.round.wrongName !== null;

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
          {myId ? "この名前にする" : "参加する"}
        </button>
        {myId && (
          <p className="text-center text-sm text-neutral-500">
            名前を変えても、この曲のお手つきは解除されません
          </p>
        )}
        <ConnBadge connected={connected} />
      </div>
    );
  }

  const iAmBuzzed = !!myId && state.buzzedBy?.id === myId;
  const iAmLocked =
    (!!myId && state.lockedIds.includes(myId)) ||
    state.lockedNames.includes(name);
  const someoneElse = !!state.buzzedBy && !iAmBuzzed;

  // 表示は state を素直に描くが、pressed のときだけローカル優先で先に殺す
  const disabled = pressed || !!state.buzzedBy || iAmLocked || showWrong;

  let label: string;
  let color: string;
  if (showWrong) {
    // サーバーがこの間 buzz を弾くので、押せないことを画面でも明示する
    label =
      countdown > 0
        ? `不正解\n${state.round.wrongName}さん\n\n${countdown}`
        : "再開！";
    color = countdown > 0 ? "bg-red-800" : "bg-neutral-700";
  } else if (iAmBuzzed) {
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
        <button
          className="rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-200 active:bg-neutral-700"
          onClick={() => {
            setDraft(name);
            setName(null); // 名前入力画面へ戻る。clientId は変わらないのでロックは維持される
          }}
        >
          {name} <span className="text-neutral-500">✎ 変更</span>
        </button>
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
