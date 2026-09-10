// 存在しない部屋を開いたときの画面。3画面で共有する。
//
// サーバーはハンドシェイクを拒否せず、接続を受けたうえで room:missing を送る。
// 拒否すると socket.io-client が再接続を繰り返し、画面には何も出ないまま
// 「繋がらない」状態になってしまうため。
import { useEffect, useState } from "react";
import { socket } from "./socket";

/** 部屋が見つからないと言われたか。true になったら以後の操作は無意味 */
export function useRoomMissing(): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const onMissing = () => setMissing(true);
    socket.on("room:missing", onMissing);
    return () => {
      socket.off("room:missing", onMissing);
    };
  }, []);
  return missing;
}

export function RoomMissing({ what }: { what: string }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-bold">部屋が見つかりません</h1>
      <p className="text-neutral-400">
        {what}
        が違うか、部屋がもう終了しています。
      </p>
      <p className="text-sm text-neutral-500">
        部屋はサーバーのメモリにしか無いので、誰も居ない状態が続くと片付けられます。
        サーバーを再起動したときも消えます。
      </p>
      <a
        className="rounded-xl bg-neutral-800 px-5 py-4 text-xl font-bold active:bg-neutral-700"
        href="/"
      >
        最初の画面へ
      </a>
    </div>
  );
}
