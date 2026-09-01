import { io, type Socket } from "socket.io-client";

// アプリ全体で1つだけ持つ Socket.IO インスタンス。
// 同一オリジンに繋ぐ（開発時は vite が /socket.io を :3000 にプロキシする）。
// 再接続は socket.io-client に任せる。自前で書かない。
export const socket: Socket = io({
  autoConnect: true,
  reconnectionDelay: 300,
  reconnectionDelayMax: 2000,
});
