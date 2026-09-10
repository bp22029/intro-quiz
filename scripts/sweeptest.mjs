// 誰も居なくなった部屋が片付けられることを検証する。
// 部屋はプロセスメモリにしか無いので、放置され続けるとメモリを食い続ける。
//
// 他のテストと違い、このスクリプトは検証用サーバーを自分で起動する
// （寿命を短くした設定で動かす必要があるため）。引数は取らない。
//   node scripts/sweeptest.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { io } from "socket.io-client";
import { createRoom, wait } from "./roomlib.mjs";

// npx/tsx のラッパー（.cmd）は Windows の node から直接 spawn できないので、
// tsx の CLI 本体を node で起動する。
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

const PORT = Number(process.env.PORT) || 3199;
const URL = `http://localhost:${PORT}`;
const TTL = 1500; // この時間だけ誰も居なければ捨てられる
const SWEEP = 300; // 掃除の間隔

const fail = [];
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) fail.push(label);
}

const server = spawn(process.execPath, [tsxCli, "server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ROOM_TTL_MS: String(TTL),
    SWEEP_INTERVAL_MS: String(SWEEP),
  },
  stdio: ["ignore", "pipe", "inherit"],
});

/** 起動を待つ。listening のログが出るまで */
await new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error("サーバーが起動しませんでした")), 30000);
  server.stdout.on("data", (b) => {
    if (String(b).includes("listening")) {
      clearTimeout(timer);
      res();
    }
  });
});

/** 部屋がまだ在るか。/api/url は知らない部屋に 404 を返す */
async function alive(code) {
  const r = await fetch(`${URL}/api/url?room=${code}`);
  return r.status === 200;
}

try {
  // --- 誰も繋がない部屋は、寿命を過ぎたら消える ---
  const idle = await createRoom(URL);
  check("作った直後は在る", await alive(idle.code));
  await wait(TTL + SWEEP * 3);
  check("誰も来ないまま寿命を過ぎたら消える", !(await alive(idle.code)));

  // --- 人が居るあいだは消えない ---
  const live = await createRoom(URL);
  const sock = io(URL, { transports: ["websocket"], auth: { room: live.code } });
  await new Promise((res) => sock.on("connect", res));
  await wait(TTL + SWEEP * 3);
  check("繋いでいる人が居れば寿命を過ぎても残る", await alive(live.code));

  // 演出中（タイマーが動いている状態）で全員が抜けても、後片付けが走ること。
  // タイマーを解除し損ねると、消したはずの部屋が動き出す。
  const host = io(URL, {
    transports: ["websocket"],
    auth: { hostKey: live.hostKey },
  });
  await new Promise((res) => host.on("connect", res));
  host.emit("host:setSuspense", 10000);
  host.emit("host:reveal"); // 溜めのタイマーを動かしたまま抜ける
  await wait(300);
  sock.close();
  host.close();
  await wait(TTL + SWEEP * 3);
  check("全員が抜ければ演出中でも片付けられる", !(await alive(live.code)));

  // --- 消えた部屋のURLは開けない ---
  const gone = io(URL, { transports: ["websocket"], auth: { room: live.code } });
  let missing = false;
  gone.on("room:missing", () => (missing = true));
  await new Promise((res) => gone.on("connect", res));
  await wait(300);
  check("消えた部屋に繋ぐと room:missing が来る", missing);
  gone.close();
} finally {
  server.kill();
}

console.log(fail.length ? `\n${fail.length} 件 FAIL` : "\nすべて PASS");
process.exit(fail.length ? 1 : 0);
