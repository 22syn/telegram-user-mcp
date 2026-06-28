#!/usr/bin/env node
/**
 * Entry point for the `telegram-user-mcp` binary.
 *   telegram-user-mcp setup   → interactive credential + login setup
 *   telegram-user-mcp         → run the MCP server over stdio (default)
 */
const sub = process.argv[2];
if (sub === 'setup' || sub === 'login' || sub === 'auth') {
    require('./setup.js');
} else {
    require('./server.js');
}
