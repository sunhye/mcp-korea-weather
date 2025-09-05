/**
 * 👋 Welcome to your Smithery project!
 * To run your server, run "npm run dev"
 *
 * You might find these resources useful:
 *
 * 🧑‍💻 MCP's TypeScript SDK (helps you define your server)
 * https://github.com/modelcontextprotocol/typescript-sdk
 *
 * 📝 smithery.yaml (defines user-level config, like settings or API keys)
 * https://smithery.ai/docs/build/project-config/smithery-yaml
 *
 * 💻 smithery CLI (run "npx @smithery/cli dev" or explore other commands below)
 * https://smithery.ai/docs/concepts/cli
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import {getUltraSrtFcst, getUltraSrtNcst, summarizeFcst, summarizeObs} from "./kmaClient";

// Optional: If you have user-level config, define it here
// This should map to the config in your smithery.yaml file
export const configSchema = z.object({
    debug: z.boolean().default(false).describe("Enable debug logging"),
})

export default function createServer({
                                         config,
                                     }: {
    config: z.infer<typeof configSchema> // Define your config in smithery.yaml
}) {
    const server = new McpServer({
        name: "mcp-korea-weather",
        version: "1.0.0",
    })

    // Add a tool
    server.registerTool(
        "get_korea_weather",
        {
            title: "get_korea_weather",
            description: "기상청 초단기실황(기온/강수/풍속/습도)",
            inputSchema: {
                latitude: z.string(),
                longitude: z.string()
            },
        },
        async (args, context) => {
            const {latitude, longitude} = args as { latitude: string; longitude: string };
            const {items, nx, ny, base_date, base_time} = await getUltraSrtNcst(latitude, longitude);
            const summary = summarizeObs(items);
            return {
                content: [
                    {
                        type: "text",
                        text: `(${latitude}, ${longitude}) nx=${nx}, ny=${ny} / 기준 ${base_date} ${base_time}\n${summary}`
                    }
                ]
            };
        },
    )

    server.registerTool(
        "get_korea_forecast",
        {
            title: "get_korea_forecast",
            description: "기상청 초단기예보(향후 3개 타임슬롯 요약)",
            inputSchema: {
                latitude: z.string(),
                longitude: z.string()
            },
        },
        async (args, context) => {
            const { latitude, longitude } = args as { latitude: string; longitude: string };
            const { items, nx, ny, base_date, base_time } = await getUltraSrtFcst(latitude, longitude);
            const lines = summarizeFcst(items);
            return {
                content: [
                    { type: "text", text: `(${latitude}, ${longitude}) nx=${nx}, ny=${ny} / 기준 ${base_date} ${base_time}\n` + lines.join("\n") }
                ]
            };
        }
    )


    return server.server
}
