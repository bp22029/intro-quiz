// サーバーとクライアントで共有する型。server/index.ts からも import する。
// ここを勝手に変えると両側が同時に壊れる。変更は必ず相方エージェントに共有すること。

export type Player = { id: string; name: string };

export type PlayMode = "youtube" | "manual";

/** 進行状態。管理画面(/host)と投影画面(/screen)を分けたので、サーバーで共有する */
export type Round = {
  index: number; // 現在の問題番号（0始まり）
  revealed: boolean; // 答えを表示中か
  playing: boolean; // YouTubeモードで再生中か
  wrongName: string | null; // 「不正解」を出している相手の名前。null なら出していない
  resumeInMs: number; // 受付再開までの残りミリ秒。0 なら受付中
  revealInMs: number; // 「正解は…」の溜めの残りミリ秒。0 なら溜めていない
};

export type State = {
  buzzedBy: Player | null; // 現在ボタンを押している人。null なら受付中
  lockedIds: string[]; // このラウンドで誤答した clientId
  lockedNames: string[]; // このラウンドで誤答した名前。別ブラウザでの回避を抑える
  players: Player[]; // 参加者一覧
  round: Round;
  mode: PlayMode;
  songs: Song[]; // 管理画面から編集できるので state に載せる（参加者には空で配る）
  // 再生窓(/sound)の状態。
  // connected は繋がっているか。visible は画面に見えているか。
  // Chrome は背面タブで開始された再生を前面に来るまで延期するので、
  // 隠れていると再生を要求しても無音のままになる。どちらも管理画面が
  // 警告を出すために使う（無言で失敗させないことが目的）。
  ytStatus: {
    ready: boolean;
    readyCount: number;
    total: number;
    connected: boolean;
    visible: boolean;
  };
  suspenseMs: number; // 「正解は…」の長さ（ミリ秒）
};

export type JoinAck = { ok: true; id: string; name: string };

// public/songs.json の1要素
export type Song = {
  videoId: string;
  title: string;
  artist: string;
  owner: string; // この曲を挙げた人
  startSec: number; // イントロ開始位置（秒）
  chorusSec?: number; // サビの開始位置（秒）。答え表示時にここへ飛んで再生する
};
