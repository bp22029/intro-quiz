// 参加者に答え（曲名・アーティスト・推した人）が配信されていないことを検証する。
// 通信内容を覗けば答えが分かる状態だと、出し物として成立しない。
//   node scripts/leaktest.mjs [url]
import {
  connectHost,
  connectPlayer,
  createRoom,
  delayFor,
  wait,
} from "./roomlib.mjs";

const URL = process.argv[2] || "http://localhost:3000";
const D = delayFor(URL);

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

const room = await createRoom(URL);

// 曲データを受け取れるのは主催キーで繋いだ側だけ
const host = await connectHost(URL, room.hostKey);
await wait(D);

// 検出しやすい固有の文字列を仕込む
const SECRET_TITLE = "ヒミツの曲名XYZ";
const SECRET_OWNER = "ヒミツの人XYZ";
const original = host.lastState.songs;
host.emit("host:setSongs", [
  {
    videoId: "secret01",
    title: SECRET_TITLE,
    artist: "ヒミツのアーティストXYZ",
    owner: SECRET_OWNER,
    startSec: 0,
    chorusSec: 30,
  },
]);
await wait(D);
check("管理画面には曲データが届く", host.lastState.songs[0].title === SECRET_TITLE);

// 参加者として接続（持っているのは参加コードだけ）
const player = await connectPlayer(URL, room.code);
await wait(D);
await new Promise((res) =>
  player.emit("join", { name: "のぞき見太郎", clientId: "leak-1" }, res),
);
await wait(D);

check("参加者の state には曲が入っていない", player.lastState.songs.length === 0);

// 押下や状態更新のたびに漏れていないか、受信した全フレームを調べる
player.emit("buzz");
await wait(D);
host.emit("host:reveal");
await wait(D);
host.emit("host:wrong");
await wait(D + 3200);

const all = player.frames.join("\n");
check("受信した全通信に曲名が含まれない", !all.includes(SECRET_TITLE));
check("受信した全通信に推した人が含まれない", !all.includes(SECRET_OWNER));
check("参加者に必要な情報は届いている", player.lastState.players.length >= 1);
check(
  "進行状態（問題番号）は届いている",
  typeof player.lastState.round.index === "number",
);

// ★ 名乗るだけでは受け取れない。
// 権限はハンドシェイクの主催キーで決まるので、参加者が投影画面や管理画面を
// 名乗っても曲は届かない。ここが崩れると、参加URLを知っている人が
// 通信を1回名乗り直すだけで答えを覗ける。
player.emit("role:host");
player.emit("role:screen");
await wait(D);
check(
  "参加者が管理画面を名乗っても曲は届かない",
  player.lastState.songs.length === 0,
);
check(
  "名乗ったあとの全通信にも曲名が含まれない",
  !player.frames.join("\n").includes(SECRET_TITLE),
);

// 主催キーで繋げば受け取れる（投影画面が動くことの確認）
const screen = await connectHost(URL, room.hostKey);
await wait(D);
check("投影画面には曲データが届く", screen.lastState.songs[0].title === SECRET_TITLE);

// 元に戻せること（管理画面の編集が一方通行でないことの確認）
host.emit("host:setSongs", original);
host.emit("host:setSong", 0);
host.emit("host:restartRound");
await wait(D);
check("元の曲リストへ戻せる", host.lastState.songs.length === original.length);

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
[host, player, screen].forEach((s) => s.close());
process.exit(fail.length ? 1 : 0);
