import { getUltraSrtNcst, getUltraSrtFcst, summarizeObs, summarizeFcst } from "./kmaClient.js";

export function toolsList() {
  return {
    tools: [
      {
        name: "get_korea_weather",
        description: "기상청 초단기실황(기온/강수/풍속/습도)",
        inputSchema: {
          type: "object",
          properties: {
            latitude: { type: "string" },
            longitude: { type: "string" }
          },
          required: ["latitude", "longitude"]
        }
      },
      {
        name: "get_korea_forecast",
        description: "기상청 초단기예보(향후 3개 타임슬롯 요약)",
        inputSchema: {
          type: "object",
          properties: {
            latitude: { type: "string" },
            longitude: { type: "string" }
          },
          required: ["latitude", "longitude"]
        }
      }
    ]
  };
}

export async function toolsCall(name, args) {
  switch (name) {
    case "get_korea_weather": {
      const { latitude, longitude } = args || {};
      const { items, nx, ny, base_date, base_time } = await getUltraSrtNcst(latitude, longitude);
      const summary = summarizeObs(items);
      return {
        content: [{ type: "text", text: `(${latitude}, ${longitude}) nx=${nx}, ny=${ny} / 기준 ${base_date} ${base_time}\n${summary}` }]
      };
    }
    case "get_korea_forecast": {
      const { latitude, longitude } = args || {};
      const { items, nx, ny, base_date, base_time } = await getUltraSrtFcst(latitude, longitude);
      const lines = summarizeFcst(items);
      return {
        content: [{ type: "text", text: `(${latitude}, ${longitude}) nx=${nx}, ny=${ny} / 기준 ${base_date} ${base_time}\n` + lines.join("\n") }]
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function initialize(req) {
  return {
    serverInfo: { name: "mcp-korea-weather-fastify", version: "1.1.0" },
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} }
  };
}