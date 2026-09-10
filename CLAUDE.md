# CLAUDE.md — イントロクイズ早押しシステム

参加者がスマホで早押し、投影画面が回答者名を出して曲を止める。
`docs/SPEC.md` は当日の実装指示書で、**読み取り専用の記録**。現在の仕様の正ではない。
**本ファイルが SPEC より優先する。**

## 交流会は終了している

SPEC と本ファイルはもともと「本日夜の出し物」を前提に書かれていた。**その本番は済んだ。**
いまは公開して他の人にも使ってもらうための一般化を進めている。したがって:

- **SPEC「10. スコープ外」のうち「複数ルーム対応」は解禁済み。** 実装されている（下記「部屋」）。
- SPEC「11. 実装順序」は当日のための順序なので、もう従う必要がない。
- **それ以外のスコープ外（得点・ランキング・DB・永続化・ログイン認証）は引き続き作らない。**

## 最優先ルール

1. **迷ったら機能を削る。**
2. **単一プロセス・メモリ状態・認証なし。** Redis / DB / ログインを持ち込まない。
   部屋の状態はすべてプロセスメモリにあり、再起動で消えてよい。

## 部屋（マルチルーム）

主催者ごとに独立した `Room` を持つ。設計の要点だけ。詳細は README「部屋」。

- **参加コード**（4文字）は参加者に配る。**主催キー**（16文字）は投影画面と管理画面のURLに入る。
- **曲データ（＝答え）が届くのは、主催キーでハンドシェイクした接続だけ。**
  接続後の `role:host` のような自己申告で権限を与えないこと。参加URLを知っている人に真似される。
- 進行状態を**モジュールスコープの変数に持たない。** 必ず `Room` の中に入れる。部屋をまたいで漏れる。
- 同報は必ず部屋単位（`broadcastState(room)` / `emitToRoom(room, ...)`）。`io.emit` を使わない。
- 部屋を捨てるときは予約中のタイマーを必ず `clearTimeout` する。
- `scripts/roomtest.mjs` が部屋の独立を、`scripts/sweeptest.mjs` が後片付けを守っている。
4. **楽曲の音声ファイル（mp3 など）をリポジトリに置かない。** 曲は YouTube から再生する。
   効果音（早押し音など短いUIの音）は `public/sfx/` に置いてよい。出所とライセンスを
   `public/sfx/README.md` の表に必ず記録すること。読み込みに失敗しても無音にならないよう、
   Web Audio の合成音（`src/beep.ts`）へのフォールバックは残す。

## ディレクトリ

SPEC は `introquiz/` を root として書かれているが、**実際の root はこのリポジトリ直下**（`c:\Users\bp22029\Development\intro-quiz`）。
`introquiz/` というサブディレクトリは作らない。それ以外の構成は SPEC 2 のとおり。

## 依存バージョンの固定（重要・ハマりどころ）

`npm install express` などで最新を入れると壊れる。**必ず下記で固定する。**

| パッケージ | 指定 | 理由 |
|---|---|---|
| `express` | `^4.19` | **express@5 は `app.get("*")` が path-to-regexp v8 で例外になる。** SPEC 7.1 のコードがそのままでは動かない |
| `@types/express` | `^4.17` | 上に合わせる |
| `tailwindcss` | `^3.4` | tailwind@4 は `tailwind.config.js` を使わず `@tailwindcss/vite` 前提に変わる。SPEC は v3 の書き方 |
| `postcss` / `autoprefixer` | 最新 | tailwind v3 の必須ペア |

インストール例:
```
npm i express@^4.19 socket.io qrcode
npm i -D vite @vitejs/plugin-react react react-dom typescript tsx tailwindcss@^3.4 postcss autoprefixer @types/express@^4.17 @types/react @types/react-dom @types/node
```
`react` / `react-dom` は dependencies でも devDependencies でもよい（Vite がバンドルするため実行時には不要）。

## package.json の `type` は設定しない

`"type": "module"` を**書かない**。CommonJS のままにすると `server/index.ts` で `__dirname` がそのまま使え、SPEC 7.1 のコードが無改造で通る。
Vite 側は `vite.config.ts` を独自に処理するので CJS のままで問題ない。

## 型の共有

`src/types.ts` を server からも import する（SPEC 4.1）。サーバーとクライアントで型がずれるのが最大のバグ源。
`server/index.ts` から `../src/types` を import すればよい（tsx は型情報を落とすだけなので実行時コストはない）。

## 動作確認の回し方

```
npm run dev      # vite (5173) — /socket.io を 3000 にプロキシ
npm run server   # npx tsx server/index.ts (3000)
```
2つ同時に立ち上げる。`http://localhost:5173/` を開いて部屋を作るところから始める。
スマホ実機からは PC の LAN IP で `http://<PC-IP>:5173/` を開き、参加コードを入れる。
本番相当の確認は `npm run build` してから `npm run server` で 3000 を直接開く。

**検証スクリプトは実行のたびに自分の部屋を作る**ので、ブラウザを開いたままでも落ちない。
`node scripts/roomtest.mjs` と `node scripts/leaktest.mjs` は、部屋の独立と答えの非配布を守っている。
サーバーに手を入れたら必ず通すこと。

## AGENTS.md は当日の記録

`AGENTS.md` は交流会当日に Claude と Codex が並行作業していたときの分担表で、**現在は有効でない**。
所有権テーブルに従う必要はない。歴史的経緯として残しているだけ。

## コミット

区切りごとに小さくコミットする。壊したとき戻れることが目的。`push` は指示があるまでしない。
