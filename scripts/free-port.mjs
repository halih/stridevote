// Frees a TCP port by killing whatever is listening on it. Dependency-free and
// cross-platform (Windows / macOS / Linux). Used by the `predev` hook so
// `npm run dev` always restarts cleanly on the same port, and by `npm run stop`.
//
// Port resolution: first CLI arg, then $PORT, else 3000.
import { execSync } from "node:child_process";

const port = Number(process.argv[2] || process.env.PORT || 3000);
const isWin = process.platform === "win32";

function pidsOnPort(p) {
  const pids = new Set();
  try {
    if (isWin) {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (m && Number(m[1]) === p) pids.add(m[2]);
      }
    } else {
      const out = execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: "utf8" });
      for (const pid of out.split(/\s+/).filter(Boolean)) pids.add(pid);
    }
  } catch {
    // No matching process, or the lookup command found nothing — treat as empty.
  }
  return [...pids];
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`Port ${port} is free.`);
} else {
  for (const pid of pids) {
    try {
      execSync(isWin ? `taskkill /PID ${pid} /T /F` : `kill -9 ${pid}`, { stdio: "ignore" });
      console.log(`Freed port ${port} (killed PID ${pid}).`);
    } catch {
      console.warn(`Could not kill PID ${pid} on port ${port}.`);
    }
  }
}
