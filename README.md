# イントロクイズ早押しシステム

研究会の交流会で使う、スマホ参加型のイントロクイズです。参加者はQRコードから名前を登録して早押しし、投影画面には最初に押した人の名前が表示されます。曲はYouTube連携または手動で再生できます。

## 開発環境で起動する

初回のみ、リポジトリ直下で依存パッケージをインストールします。

```powershell
npm install
```

続いて、2枚のターミナルを開き、どちらもリポジトリ直下で実行します。

ターミナル1（フロントエンド）:

```powershell
npm run dev
```

ターミナル2（Socket.IOサーバー）:

```powershell
npm run server
```

投影PCでは `http://localhost:5173/screen` を開きます。参加者画面は `http://localhost:5173/` です。

## スマホ実機から接続する

1. 投影PCとスマホを同じLANまたはWi-Fiに接続します。
2. Windowsのターミナルで `ipconfig` を実行し、使用中の接続のIPv4アドレスを確認します。
3. スマホで `http://<PCのLAN IP>:5173/` を開きます。例: `http://192.168.1.20:5173/`
4. 接続できない場合は、Viteのターミナルに表示される `Network` のURL、同一Wi-Fiへの接続、Windowsファイアウォールの許可を確認します。

本番運用とRenderへのデプロイは [docs/RUNBOOK.md](docs/RUNBOOK.md) を参照してください。
