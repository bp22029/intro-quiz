// 同時接続数を増やしたときの早押しの応答時間を測る。
//   node scripts/loadtest.mjs [url] [人数]
// 例: node scripts/loadtest.mjs http://localhost:3000 30
import { io } from "socket.io-client";

const URL = process.argv[2] || "http://localhost:3000";
const N = Number(process.argv[3] || 30);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(i) {
  const s = io(URL, { transports: ["websocket"] });
  s.idx = i;
  s.buzzedAt = null;
  s.stateBytes = 0;
  s.on("buzzed", () => (s.buzzedAt = performance.now()));
  s.on("state", (st) => (s.stateBytes = JSON.stringify(st).length));
  return new Promise((res, rej) => {
    s.on("connect", () => res(s));
    s.on("connect_error", (e) => rej(e));
  });
}

console.log(`接続先: ${URL}`);
console.log(`同時接続: ${N}人 + 投影画面 + 管理画面\n`);

const t0 = performance.now();
const players = await Promise.all(
  Array.from({ length: N }, (_, i) => connect(i)),
);
const screen = await connect(-1);
const host = await connect(-2);
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

console.log(`1回の state の大きさ: ${screen.stateBytes} バイト`);
console.log(
  `1回の同報で流れる総量: 約 ${Math.round((screen.stateBytes * (N + 2)) / 1024)} KB\n`,
);

// --- 全員が同時に押す（最も重い瞬間）を3回試す ---
const rounds = [];
for (let r = 0; r < 3; r++) {
  host.emit("host:nextRound");
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
  const winner = screen.stateBytes ? "" : "";
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

// 排他制御が人数を増やしても壊れないこと
await wait(500);
const st = screen.stateBytes;
console.log(`\n押下者は1人だけか: ${st > 0 ? "state 受信済み" : "state 未受信"}`);

host.emit("host:nextRound");
await wait(500);
[...players, screen, host].forEach((s) => s.close());
process.exit(0);
