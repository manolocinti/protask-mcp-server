#!/usr/bin/env node

import { app } from './app.js';

const PORT = Number(process.env.PORT) || 3456;
// Solo locale: da fuori si passa da nginx (HTTPS). HOST=0.0.0.0 per esporlo direttamente
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`ProTask MCP HTTP Server running on ${HOST}:${PORT}`);
  console.log(`SSE endpoint: /mcp/sse`);
  console.log(`Message endpoint: /mcp/message`);
});
