import Fastify from "fastify";
import cors from "@fastify/cors";
import formBody from "@fastify/formbody";
import { initialize, toolsList, toolsCall } from "./mcp.js";

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
await app.register(formBody);

app.get("/health", async (req, reply) => {
  return { ok: true, ts: new Date().toISOString() };
});

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
      // Acknowledge; no payload necessary
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

const port = process.env.PORT ? Number(process.env.PORT) : 8787;
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }).catch((e) => {
  console.error("Server failed to start:", e);
  process.exit(1);
});