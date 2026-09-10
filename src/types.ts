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
  suspenseMs: number; // 「正解は…」の長さ（ミリ秒）
  // 「正解は…」の溜めのあいだにサビへの助走を鳴らすか。
  // true なら溜めの長さぶん手前から、音量を上げながら再生する。
  // false なら従来どおり溜めは無音で、答えが出てからサビへ飛ぶ。
  runUp: boolean;
  // 全体音量（0-100）。volume を持たない曲はこの値で鳴る。
  // 曲ごとに合わせる前に、まずここで全体を下げられるようにするための逃げ道。
  masterVolume: number;
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
  // この曲だけの音量（0-100）。未設定なら masterVolume に従う。
  // YouTube のラウドネス正規化は「下げるだけ」で小さい音を持ち上げないため、
  // アートトラック(〇〇 - Topic)とMVを混ぜると音量差が残る。
  volume?: number;
};
