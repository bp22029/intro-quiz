# CLAUDE.md — イントロクイズ早押しシステム

研究会交流会（**本日夜**）の10分間の出し物。参加者がスマホで早押し、投影画面が回答者名を出して曲を止める。
正式な仕様は `docs/SPEC.md`（実装指示書）。**本ファイルは SPEC を上書きしない。SPEC に書いていない運用ルールだけを書く。**

## 最優先ルール

1. **本日中に動くことが最優先。迷ったら機能を削る。** SPEC「10. スコープ外」は厳守。提案もしない。
2. **SPEC「11. 実装順序」を入れ替えない。** 手順3（投影画面の手動モード）まで動けば出し物は成立する。YouTube 統合が間に合わなくても当日は回る。
3. **単一プロセス・メモリ状態・認証なし。** Redis / DB / ログインを持ち込まない。
4. **音声ファイル・mp3 を一切追加しない。** 効果音は Web Audio の OscillatorNode で生成する。

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
2つ同時に立ち上げる。スマホ実機からは PC の LAN IP で `http://<PC-IP>:5173/` を開く。
本番相当の確認は `npm run build` してから `npm run server` で 3000 を直接開く。

## 分業（Codex と並行作業する）

**ファイル所有権を越境しない。** 誰がどのファイルを書くかは `AGENTS.md` の所有権テーブルが正。
自分の担当外のファイルは、たとえ壊れて見えても直接編集せず、インターフェース不一致として報告する。

## コミット

区切りごとに小さくコミットする（`git init` 済み）。当日に壊したとき戻れることが目的。
