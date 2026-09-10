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
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-8 p-8">
      <h1 className="text-3xl font-bold">イントロクイズ</h1>

      <div className="flex flex-col gap-3">
        <p className="text-neutral-400">参加する</p>
        <input
          className="rounded-xl bg-neutral-800 px-5 py-5 text-center text-3xl tracking-[0.3em] outline-none focus:ring-2 focus:ring-red-500"
          value={code}
          maxLength={8}
          autoFocus
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
          className="rounded-xl bg-red-600 px-5 py-5 text-2xl font-bold active:bg-red-700"
          onClick={join}
        >
          参加する
        </button>
        <p className="text-sm text-neutral-500">
          主催者から渡されたコード、またはQRから入ってください
        </p>
      </div>

      <div className="border-t border-neutral-800 pt-8">
        <p className="pb-3 text-neutral-400">出題する</p>
        <button
          className="w-full rounded-xl bg-neutral-800 px-5 py-5 text-xl font-bold active:bg-neutral-700 disabled:opacity-50"
          onClick={createRoom}
          disabled={creating}
        >
          {creating ? "作成中…" : "新しい部屋を作る"}
        </button>
        <p className="pt-3 text-sm text-neutral-500">
          作ると管理画面のURLが発行されます。ログインが無いので、
          <strong className="text-neutral-300">
            そのURLを控えておかないと部屋に戻れません
          </strong>
          。
        </p>
      </div>

      {error && (
        <p className="rounded-xl bg-red-900/50 px-4 py-3 text-red-200">{error}</p>
      )}
    </div>
  );
}
