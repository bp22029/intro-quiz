// ロビー（/）。部屋を作るか、参加コードを入れて既存の部屋へ入るかの2つだけ。
// ここには socket を繋がない（まだどの部屋にも属していないため）。
import { useState } from "react";
import { hostPath, normalizeCode, playerPath } from "./room";

type CreateResponse = {
  ok?: boolean;
  code?: string;
  hostKey?: string;
  error?: string;
};

export default function LobbyView() {
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/rooms", { method: "POST" });
      const d: CreateResponse = await r.json();
      if (!r.ok || !d.ok || !d.hostKey) {
        setError(d.error ?? "部屋を作れませんでした");
        setCreating(false);
        return;
      }
      // 管理画面へ移る。以後この URL が主催者の唯一の資格になる。
      window.location.href = hostPath(d.hostKey);
    } catch {
      setError("サーバーに繋がりませんでした");
      setCreating(false);
    }
  }

  function join() {
    const c = normalizeCode(code);
    if (!c) {
      setError("参加コードを入れてください");
      return;
    }
    window.location.href = playerPath(c);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col justify-center gap-8 p-7">
      <div className="text-[15px] tracking-[0.4em] text-gold">
        <span className="pl-[0.4em]">イントロクイズ</span>
      </div>

      {/*
        出題する側を主にする。参加者は QR か配られたURLから直接部屋へ入るので、
        この画面に来る参加者は「QRが読めなかった人」だけになる。
        主催者はここからしか始められない。
      */}
      <div className="flex flex-col gap-3">
        <p className="text-sm tracking-[0.16em] text-ink-3">出題する</p>
        <button
          className="rounded-r2 bg-gold px-5 py-5 text-2xl font-black text-ground active:bg-gold-bright disabled:opacity-50"
          onClick={createRoom}
          disabled={creating}
        >
          {creating ? "作成中…" : "新しい部屋を作る"}
        </button>
        <p className="text-xs leading-relaxed text-ink-3">
          作ると管理画面のURLが発行されます。ログインが無いので、
          <strong className="font-medium text-gold-bright">
            そのURLを控えておかないと部屋に戻れません
          </strong>
          。
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-rule pt-8">
        <p className="text-sm tracking-[0.16em] text-ink-3">参加する</p>
        <input
          // autoFocus は付けない。スマホでキーボードが開いて、
          // 主となる「新しい部屋を作る」が画面外へ押し出されてしまう。
          className="rounded-r2 border border-chip bg-sink px-5 py-4 text-center text-3xl tracking-[0.3em] outline-none placeholder:text-chip-ink focus:ring-2 focus:ring-gold"
          value={code}
          maxLength={8}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="コード"
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") join();
          }}
        />
        <button
          className="rounded-r2 border border-chip bg-sink px-5 py-4 text-xl font-bold active:bg-panel"
          onClick={join}
        >
          参加する
        </button>
        <p className="text-xs leading-relaxed text-ink-3">
          ふつうはQRから入ります。QRが読めないときだけ、主催者が読み上げるコードを入れてください。
        </p>
      </div>

      {error && (
        <p className="rounded-r2 border border-miss-border bg-miss px-4 py-3 text-miss-ink">
          {error}
        </p>
      )}
    </div>
  );
}
