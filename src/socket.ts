import { io, type Socket } from "socket.io-client";
import { handshakeAuth, roomRef } from "./room";

// アプリ全体で1つだけ持つ Socket.IO インスタンス。
// 同一オリジンに繋ぐ（開発時は vite が /socket.io を :3000 にプロキシする）。
// 再接続は socket.io-client に任せる。自前で書かない。
//
// どの部屋の誰として繋ぐかは、ハンドシェイクの auth で1度だけ名乗る。
// あとから "role:host" のように自己申告できてしまうと、参加URLを知っている人が
// 名乗るだけで曲データ（＝答え）を受け取れてしまう。
// ロビーには部屋が無いので繋がない。
const auth = handshakeAuth(roomRef);

export const socket: Socket = io({
  autoConnect: auth !== null,
  auth: auth ?? {},
  reconnectionDelay: 300,
  reconnectionDelayMax: 2000,
});

/**
 * 接続直後にサーバーが1回だけ送る state を、listener を張る前に取りこぼすこと
 * がある（この socket はモジュール読み込み時に繋ぎに行くので、React が
 * on("state") を張るより先に接続が完了しうる）。
 * 各画面はマウント時と接続時にこれを呼んで、必ず1回取り直す。
 */
export function syncState() {
  socket.emit("state:sync");
}
