import Fastify from "fastify";
import cors from "@fastify/cors";
import formBody from "@fastify/formbody";
import { initialize, toolsList, toolsCall } from "./mcp.js";

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
await app.register(formBody);

// Root & health for probes
app.get("/", async () => ({ ok: true, service: "mcp-korea-weather-fastify" }));
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

// JSON-RPC endpoint
app.post("/", async (req, reply) => {
  try {
    const body = req.body || {};
    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== "2.0") {
      return reply.code(400).send({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" }});
    }

    let result;

    if (method === "initialize") {
      result = initialize(req);
    } else if (method === "tools/list") {
      result = toolsList();
    } else if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      result = await toolsCall(name, args);
    } else if (method === "notifications/initialized") {
      result = { acknowledged: true };
    } else {
      return reply.code(404).send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" }});
    }

    return reply.send({ jsonrpc: "2.0", id, result });
  } catch (err) {
    return reply.code(500).send({
      jsonrpc: "2.0",
      id: (req.body && req.body.id) || null,
      error: { code: -32000, message: err.message || String(err) }
    });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const host = process.env.HOST || "0.0.0.0";

const closeSignals = ["SIGINT","SIGTERM"];
let closing = false;

async function start() {
  try {
    await app.listen({ port, host });
    console.log(`[mcp] listening on ${host}:${port}`);
  } catch (e) {
    console.error("[mcp] server start failed:", e);
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[mcp] received ${signal}, closing...`);
  try {
    await app.close();
    console.log("[mcp] closed gracefully");
    process.exit(0);
  } catch (e) {
    console.error("[mcp] error on close:", e);
    process.exit(1);
  }
}

closeSignals.forEach(sig => process.on(sig, () => shutdown(sig)));

start();