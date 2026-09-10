// 同時接続数を増やしたときの早押しの応答時間を測る。
//   node scripts/loadtest.mjs [url] [人数]
// 例: node scripts/loadtest.mjs http://localhost:3000 30
import { io } from "socket.io-client";
import { createRoom, wait } from "./roomlib.mjs";

const URL = process.argv[2] || "http://localhost:3000";
const N = Number(process.argv[3] || 30);

const room = await createRoom(URL);

function connect(i, auth) {
  const s = io(URL, { transports: ["websocket"], auth });
  s.idx = i;
  s.buzzedAt = null;
  s.stateBytes = 0;
  s.on("buzzed", () => (s.buzzedAt = performance.now()));
  s.on("state", (st) => {
    s.lastState = st;
    s.stateBytes = JSON.stringify(st).length;
  });
  return new Promise((res, rej) => {
    s.on("connect", () => res(s));
    s.on("connect_error", (e) => rej(e));
  });
}

const asPlayer = (i) => connect(i, { room: room.code });
const asHost = (i) => connect(i, { hostKey: room.hostKey });

console.log(`接続先: ${URL}（部屋 ${room.code}）`);
console.log(`同時接続: ${N}人 + 投影画面 + 管理画面\n`);

const t0 = performance.now();
const players = await Promise.all(Array.from({ length: N }, (_, i) => asPlayer(i)));
const screen = await asHost(-1);
const host = await asHost(-2);
console.log(`全員の接続完了まで: ${Math.round(performance.now() - t0)} ms`);

// join
const tJoin = performance.now();
await Promise.all(
  players.map(
    (s) =>
      new Promise((res) =>
        s.emit("join", { name: `参加者${s.idx}`, clientId: `load-${s.idx}` }, res),
      ),
  ),
);
console.log(`全員の参加登録まで: ${Math.round(performance.now() - tJoin)} ms`);
await wait(1000);

// 参加者には曲データを落として配るので、1通の大きさが違う
const playerBytes = players[0]?.stateBytes ?? 0;
console.log(`1回の state の大きさ: 参加者 ${playerBytes} バイト / 投影・管理 ${screen.stateBytes} バイト`);
console.log(
  `1回の同報で流れる総量: 約 ${Math.round(
    (playerBytes * N + screen.stateBytes * 2) / 1024,
  )} KB\n`,
);

// --- 全員が同時に押す（最も重い瞬間）を3回試す ---
const rounds = [];
for (let r = 0; r < 3; r++) {
  host.emit("host:restartRound");
  await wait(600);
  players.forEach((s) => (s.buzzedAt = null));

  const t = performance.now();
  players.forEach((s) => s.emit("buzz")); // 全員同時押し
  await wait(2500);

  const times = players
    .filter((s) => s.buzzedAt !== null)
    .map((s) => s.buzzedAt - t)
    .sort((a, b) => a - b);

  if (times.length === 0) {
    console.log(`${r + 1}回目: 通知が届きませんでした`);
    continue;
  }
  rounds.push(times);
  console.log(
    `${r + 1}回目: 全${times.length}人に通知 / 最速 ${Math.round(times[0])} ms ` +
      `/ 中央値 ${Math.round(times[Math.floor(times.length / 2)])} ms ` +
      `/ 最遅 ${Math.round(times[times.length - 1])} ms`,
  );
}

const all = rounds.flat().sort((a, b) => a - b);
if (all.length) {
  console.log(
    `\n総合: 中央値 ${Math.round(all[Math.floor(all.length / 2)])} ms / ` +
      `最遅 ${Math.round(all[all.length - 1])} ms`,
  );
}

// 排他制御が人数を増やしても壊れないこと。
// 全員が同時に押したあとでも、押下者は必ず1人になっていなければならない。
await wait(500);
const buzzed = screen.lastState?.buzzedBy;
console.log(
  `\n押下者: ${buzzed ? `${buzzed.name} の1人` : "なし（通知が届いていない）"}`,
);

host.emit("host:restartRound");
await wait(500);
[...players, screen, host].forEach((s) => s.close());
process.exit(0);
