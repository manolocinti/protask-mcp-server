// Server MCP su stdio (Claude Desktop in locale): stessi tool e stesso dispatcher del server HTTP
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ProTaskClient } from './api-client.js';
import { toolResult, SERVER_INSTRUCTIONS } from './handoff.js';
import { TOOLS, executeTool } from './tools.js';

export function createStdioServer(client: ProTaskClient): Server {
  const server = new Server(
    { name: 'protask-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return toolResult(await executeTool(client, name, args ?? {}));
    } catch (error) {
      // Su stdio non c'è un 401 da mandare: il token scaduto diventa un errore del tool
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      };
    }
  });

  return server;
}
