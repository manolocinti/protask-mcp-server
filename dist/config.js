// Configurazione da env: gli URL si usano senza "/" finale
const senzaSlashFinale = (url) => url.replace(/\/+$/, '');
export const PUBLIC_URL = senzaSlashFinale(process.env.PUBLIC_URL || 'https://protask-mcp.ilmarketing.net');
export const PROTASK_ISSUER = senzaSlashFinale(process.env.PROTASK_ISSUER || 'https://protask.ilmarketing.net');
export const PROTASK_API_URL = senzaSlashFinale(process.env.PROTASK_API_URL || 'https://protask.ilmarketing.net/api/v1');
export const RESOURCE_URL = PUBLIC_URL + '/mcp/sse';
export const RESOURCE_METADATA_URL = PUBLIC_URL + '/.well-known/oauth-protected-resource/mcp/sse';
