import { useEffect, useRef, useState } from "react";
import { RoomMissing, useRoomMissing } from "./RoomMissing";
import { socket, syncState } from "./socket";
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
  roomCode: "",
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
    revealInMs: 0,
  },
  mode: "youtube",
  songs: [],
  suspenseMs: 2000,
  runUp: true,
  masterVolume: 70,
};

export default function PlayerView() {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<State>(EMPTY);
  const [myId, setMyId] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const roomMissing = useRoomMissing();

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
      syncState();
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
    else syncState();

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

  // 部屋が無いと言われたら、名前を聞く前に打ち切る
  if (roomMissing) return <RoomMissing what="参加コード" />;

  if (!name) {
    return (
      <div className="mx-auto flex h-full w-full max-w-md flex-col justify-center gap-6 p-7">
        <div className="flex flex-col gap-3">
          <div className="text-[15px] tracking-[0.4em] text-gold">
            <span className="pl-[0.4em]">イントロクイズ</span>
          </div>
          {state.roomCode && (
            <div className="font-disp text-5xl leading-none tracking-[0.1em] text-gold-bright">
              {state.roomCode}
            </div>
          )}
        </div>
        <div className="h-px bg-gradient-to-r from-gold to-transparent opacity-60" />
        <p className="text-ink-3">名前を入れて参加してください</p>
        <input
          className="rounded-r2 border border-chip bg-sink px-5 py-4 text-2xl outline-none focus:ring-2 focus:ring-gold"
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
          className="rounded-r2 bg-gold px-5 py-5 text-2xl font-black text-ground active:bg-gold-bright"
          onClick={submitName}
        >
          {myId ? "この名前にする" : "参加する"}
        </button>
        {myId && (
          <p className="text-center text-sm text-ink-3">
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

  // 状態ごとに面の色と中身を決める。文字を1本の文字列で切り替えていたのを
  // やめたのは、「不正解のカウントダウン」だけ大きさの違う3行が要るため。
  //
  // 金＝押せる / 深緑＝あなたが押した / 沈めた紺＝押せない / 深紅＝不正解。
  // 押せるボタンに赤を使わないのは、赤を不正解の色として通すため。
  let face: string;
  let body: React.ReactNode;
  const dim = "bg-sink border-chip-locked";
  if (showWrong && countdown > 0) {
    // サーバーがこの間 buzz を弾くので、押せないことを画面でも明示する
    face = "bg-miss border-miss-border";
    body = (
      <>
        <div className="text-5xl font-black text-miss-ink">不正解</div>
        <div className="pt-1.5 text-lg text-miss-ink2">
          {state.round.wrongName} さん
        </div>
        <div className="pt-8 font-disp text-[8rem] leading-none tabular-nums">
          {countdown}
        </div>
      </>
    );
  } else if (showWrong) {
    face = dim;
    body = <div className="text-6xl font-black text-gold">再開！</div>;
  } else if (iAmBuzzed) {
    face = "bg-win border-gold-bright";
    body = (
      <>
        <div className="text-[17px] tracking-[0.4em] text-gold-bright">
          <span className="pl-[0.4em]">あなたです</span>
        </div>
        <div className="pt-3 font-disp text-6xl leading-tight">どうぞ</div>
      </>
    );
  } else if (someoneElse) {
    face = dim;
    body = (
      <div className="text-[42px] font-black leading-[1.35] text-ink-3">
        {state.buzzedBy!.name} さんが
        <br />
        押しました
      </div>
    );
  } else if (iAmLocked) {
    // 「他の人が押した」とは意味が違う。次の曲まで押せないことを言い切る。
    face = dim;
    body = (
      <>
        <div className="text-[42px] font-black leading-[1.35] text-ink-3">
          この曲は
          <br />
          ここまで
        </div>
        <div className="my-6 h-px w-28 bg-chip" />
        <div className="text-[15px] text-ink-3">次の曲でまた押せます</div>
      </>
    );
  } else if (pressed) {
    face = dim;
    body = <div className="text-5xl font-black text-ink-3">送信中…</div>;
  } else {
    face = "bg-gold border-gold";
    body = <div className="font-disp text-[76px] leading-tight text-ground">押す！</div>;
  }

  function buzz() {
    if (disabled) return;
    // 往復を待つと必ず連打される。即座に殺す。
    setPressed(true);
    navigator.vibrate?.(30);
    socket.emit("buzz");
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-3.5 pb-4 pt-3.5">
      <div className="flex items-center justify-between pb-2.5">
        <button
          className="rounded-full border border-chip px-4 py-1.5 text-[15px] active:bg-sink"
          onClick={() => {
            setDraft(name);
            setName(null); // 名前入力画面へ戻る。clientId は変わらないのでロックは維持される
          }}
        >
          {name} <span className="pl-1 text-xs text-ink-3">変更</span>
        </button>
        <ConnBadge connected={connected} />
      </div>
      <button
        className={`flex w-full flex-1 flex-col items-center justify-center rounded-r3 border-2 text-center transition-colors ${face} ${
          disabled ? "" : "active:scale-[0.98]"
        }`}
        disabled={disabled}
        onPointerDown={buzz}
      >
        {body}
      </button>
    </div>
  );
}

function ConnBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[13px] ${
        connected ? "text-ok" : "text-gold"
      }`}
    >
      {/* 記号文字は環境によって絵文字の字形で出るので、点も自分で描く */}
      <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="5" fill={connected ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" />
      </svg>
      {connected ? "接続中" : "再接続中…"}
    </span>
  );
}
