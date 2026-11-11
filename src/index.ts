#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProTaskClient } from './api-client.js';
import { createStdioServer } from './stdio-server.js';

// Get token from environment
const PROTASK_TOKEN = process.env.PROTASK_TOKEN;
const PROTASK_API_URL = process.env.PROTASK_API_URL;

if (!PROTASK_TOKEN) {
  console.error('Error: PROTASK_TOKEN environment variable is required');
  process.exit(1);
}

const server = createStdioServer(new ProTaskClient(PROTASK_TOKEN, PROTASK_API_URL));

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ProTask MCP Server running on stdio');
}

main().catch(console.error);
