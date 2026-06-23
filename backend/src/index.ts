import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { DatabaseService } from './db';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(express.json());

const db = new DatabaseService();

// Helper to run shell commands (like ast-grep)
function runCommand(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

// ---------------- Express REST API Endpoints ----------------

app.post('/api/index', async (req, res) => {
  try {
    const { Indexer } = require('./indexer');
    const indexer = new Indexer(path.join(__dirname, '../..'));
    await indexer.run();
    res.json({ success: true, message: 'Indexing completed successfully' });
  } catch (error: any) {
    console.error('Indexing failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files', async (req, res) => {
  try {
    const files = await db.getFilesList();
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/file/content', (req, res) => {
  const filePath = req.query.file as string;
  if (!filePath) {
    return res.status(400).json({ error: 'Missing file query param' });
  }

  const projectRoot = path.join(__dirname, '../..');
  const fullPath = path.resolve(projectRoot, filePath);

  // Security check: ensure path is within project root
  if (!fullPath.startsWith(projectRoot)) {
    return res.status(403).json({ error: 'Access denied: Out of project scope' });
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/file/symbols', async (req, res) => {
  const filePath = req.query.file as string;
  if (!filePath) {
    return res.status(400).json({ error: 'Missing file query param' });
  }

  try {
    const symbols = await db.getFileSymbols(filePath);
    res.json({ symbols });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q as string) || '';
  const type = (req.query.type as 'text' | 'symbol' | 'structural') || 'text';

  if (!q) {
    return res.json({ results: [] });
  }

  try {
    if (type === 'structural') {
      // Execute ast-grep query
      const projectRoot = path.join(__dirname, '../..');
      // Escape query quotes
      const escapedQ = q.replace(/"/g, '\\"');
      try {
        const stdout = await runCommand(`npx ast-grep run --pattern "${escapedQ}" --json`, projectRoot);
        const matches = JSON.parse(stdout || '[]');
        
        const results = matches.map((match: any) => ({
          file: match.file,
          line: match.range.start.line,
          match: match.text,
          kind: 'structural'
        }));
        return res.json({ results });
      } catch (err: any) {
        // ast-grep exits with non-zero if no matches are found or parse error
        let results: any[] = [];
        try {
          if (err.stdout) {
            const matches = JSON.parse(err.stdout);
            results = matches.map((match: any) => ({
              file: match.file,
              line: match.range.start.line,
              match: match.text,
              kind: 'structural'
            }));
          }
        } catch (e) {}
        return res.json({ results, error: err.message });
      }
    } else {
      // Search in SQLite symbols or files
      const dbResults = await db.search(q, type);
      const results = dbResults.map((r: any) => ({
        file: r.file_id,
        line: r.line_start,
        match: `${r.kind} ${r.name}${r.signature ? ': ' + r.signature : ''}`,
        kind: r.kind
      }));
      res.json({ results });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/navigate/definition', async (req, res) => {
  const file = req.query.file as string;
  const line = parseInt(req.query.line as string);
  const character = parseInt(req.query.character as string) || 0;

  if (!file || isNaN(line)) {
    return res.status(400).json({ error: 'Missing file or line parameters' });
  }

  try {
    const def = await db.findDefinition(file, line, character);
    if (!def) {
      return res.status(404).json({ error: 'Definition not found' });
    }

    // Read lines from the file
    const projectRoot = path.join(__dirname, '../..');
    const fullPath = path.resolve(projectRoot, def.file_id);
    let codeBlock = '';
    if (fs.existsSync(fullPath)) {
      const fileLines = fs.readFileSync(fullPath, 'utf8').split('\n');
      const start = Math.max(0, def.line_start - 1);
      const end = def.line_end ? Math.min(fileLines.length, def.line_end) : start + 5;
      codeBlock = fileLines.slice(start, end).join('\n');
    }

    res.json({
      definition: {
        file: def.file_id,
        line_start: def.line_start,
        line_end: def.line_end,
        code_block: codeBlock
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/navigate/flow', async (req, res) => {
  const symbol = req.query.symbol as string;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol parameter' });
  }

  try {
    const calls = await db.getCallGraph(symbol);
    
    // Construct Mermaid graph
    let mermaidLines = ['graph TD'];
    if (calls.length === 0) {
      mermaidLines.push(`  ${symbol}["${symbol} (No call relationships found)"]`);
    } else {
      const added = new Set<string>();
      for (const call of calls) {
        const relationship = `  ${call.caller_symbol} --> ${call.callee_symbol}`;
        if (!added.has(relationship)) {
          mermaidLines.push(relationship);
          added.add(relationship);
        }
      }
    }

    res.json({
      mermaid_graph: mermaidLines.join('\n')
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- MCP Server Setup ----------------

const mcpServer = new Server({
  name: "code-intelligence",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_symbols",
        description: "Busca símbolos (funções, classes, variáveis) usando o índice do Ctags/AST.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Nome do símbolo a buscar" }
          },
          required: ["query"]
        }
      },
      {
        name: "get_structural_matches",
        description: "Busca padrões sintáticos no código utilizando ast-grep.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Padrão de busca estrutural (ex: 'function $A($$$)')" }
          },
          required: ["pattern"]
        }
      },
      {
        name: "get_symbol_flow",
        description: "Retorna o grafo de chamadas (quem chama e quem é chamado) por uma função.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Nome da função a inspecionar" }
          },
          required: ["symbol"]
        }
      }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const projectRoot = path.join(__dirname, '../..');

  if (name === "search_symbols") {
    const q = String(args?.query || '');
    const results = await db.search(q, 'symbol');
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }

  if (name === "get_structural_matches") {
    const pattern = String(args?.pattern || '');
    const escapedPattern = pattern.replace(/"/g, '\\"');
    try {
      const stdout = await runCommand(`npx ast-grep run --pattern "${escapedPattern}" --json`, projectRoot);
      return {
        content: [{ type: "text", text: stdout || '[]' }]
      };
    } catch (err: any) {
      let contentText = '[]';
      if (err.stdout) {
        contentText = err.stdout;
      } else {
        contentText = JSON.stringify({ error: err.message });
      }
      return {
        content: [{ type: "text", text: contentText }]
      };
    }
  }

  if (name === "get_symbol_flow") {
    const symbol = String(args?.symbol || '');
    const calls = await db.getCallGraph(symbol);
    return {
      content: [{ type: "text", text: JSON.stringify(calls, null, 2) }]
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

// ---------------- Start Server ----------------

async function start() {
  await db.init();

  if (process.env.MCP_STDIO === 'true') {
    // Run MCP over standard input/output (for local agent integration)
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error('MCP Server running in STDIO mode');
  } else {
    // Run Express server + SSE MCP Server
    let sseTransport: SSEServerTransport | null = null;

    app.get('/sse', async (req, res) => {
      sseTransport = new SSEServerTransport('/messages', res);
      await mcpServer.connect(sseTransport);
    });

    app.post('/messages', async (req, res) => {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.status(400).send('No active SSE connection');
      }
    });

    app.listen(PORT, () => {
      console.log(`Backend API and SSE MCP server running on port ${PORT}`);
    });
  }
}

start().catch(err => {
  console.error('Failed to start server:', err);
});
