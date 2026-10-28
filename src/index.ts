#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout carries the protocol; logs go to stderr
console.error('parlament-at-mcp ready (stdio)');
