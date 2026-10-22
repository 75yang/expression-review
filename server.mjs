import { createServer } from "node:http";
import os from "node:os";

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function localIpv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

const dev = !process.argv.includes("--production");
const hostname = argumentValue("--hostname", "127.0.0.1");
const portValue = Number(argumentValue("--port", process.env.PORT || "3000"));
const port = Number.isInteger(portValue) && portValue > 0 ? portValue : 3000;

process.env.NODE_ENV = dev ? "development" : "production";

const next = (await import("next")).default;
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((request, response) => {
  delete request.headers["x-expression-remote-address"];
  request.headers["x-expression-remote-address"] =
    request.socket.remoteAddress || "";
  void handle(request, response);
});

server.listen(port, hostname, () => {
  console.log(`Expression Training: http://127.0.0.1:${port}`);
  if (hostname === "0.0.0.0" || hostname === "::") {
    for (const address of localIpv4Addresses()) {
      console.log(`Phone pairing:     http://${address}:${port}`);
    }
  }
});
