// サーバーとクライアントで共有する型。server/index.ts からも import する。
// ここを勝手に変えると両側が同時に壊れる。変更は必ず相方エージェントに共有すること。

export type Player = { id: string; name: string };

export type State = {
  buzzedBy: Player | null; // 現在ボタンを押している人。null なら受付中
  lockedIds: string[]; // このラウンドで誤答した socket.id
  players: Player[]; // 参加者一覧
};

export type JoinAck = { ok: true; id: string; name: string };

// public/songs.json の1要素
export type Song = {
  videoId: string;
  title: string;
  artist: string;
  owner: string; // この曲を挙げた人
  startSec: number; // イントロ開始位置（秒）
};

export type PlayMode = "youtube" | "manual";
