import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as ts from 'typescript';
import { DatabaseService } from './db';
import { execSync } from 'child_process';
import { deserializeSCIP } from '@c4312/scip';

const IGNORE_DIRS = [
  'node_modules',
  '.git',
  '.gemini',
  'dist',
  'build',
  'out',
  'bin'
];

const IGNORE_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'database.db',
  'index.scip'
];

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py'];

export class Indexer {
  private db: DatabaseService;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.db = new DatabaseService();
  }

  public async run(): Promise<void> {
    await this.db.init();
    console.log(`Starting spec-compliant indexer at ${this.projectRoot}...`);

    // 1. Scan the directories to list project files and register/update file metadata
    const files = this.scanDir(this.projectRoot);
    console.log(`Found ${files.length} candidate files in the workspace.`);

    // Check which files actually changed using MD5 hashes for incremental updates
    const filesToIndex: string[] = [];
    for (const filePath of files) {
      const relativePath = path.relative(this.projectRoot, filePath).replace(/\\/g, '/');
      const stats = fs.statSync(filePath);
      const hash = this.calculateHash(filePath);

      const existingFile = await this.db.getFile(relativePath);
      if (!existingFile || existingFile.hash !== hash) {
        filesToIndex.push(filePath);
        // Clear old indices for this file (cascades delete symbols/calls)
        await this.db.deleteFile(relativePath);
        // Insert new file row
        await this.db.saveFile(relativePath, hash, this.detectLanguage(filePath), stats.size);
      }
    }

    if (filesToIndex.length === 0) {
      console.log('No files have changed. Indexing skipped.');
      return;
    }

    console.log(`Need to index ${filesToIndex.length} modified files.`);

    // 2. RUN UNIVERSAL CTAGS
    await this.runCtagsPhase(filesToIndex);

    // 3. RUN SCIP INDEXER & PARSER (for TypeScript/JavaScript files)
    const hasTSJS = filesToIndex.some(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
    });

    if (hasTSJS) {
      await this.runScipPhase();
    }

    console.log('Indexing completed successfully!');
  }

  private scanDir(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (IGNORE_DIRS.includes(file)) continue;
      if (IGNORE_FILES.includes(file)) continue;

      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        results = results.concat(this.scanDir(fullPath));
      } else {
        const ext = path.extname(file).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
    return results;
  }

  private calculateHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
        return 'javascript';
      case '.py':
        return 'python';
      default:
        return 'unknown';
    }
  }

  // Phase 1: Universal Ctags
  private async runCtagsPhase(files: string[]): Promise<void> {
    console.log('Running Universal Ctags phase...');
    
    // We locate the portable Windows ctags binary we downloaded
    const ctagsBin = path.join(__dirname, '../bin/ctags.exe');
    if (!fs.existsSync(ctagsBin)) {
      console.warn('Local ctags binary not found at', ctagsBin, '- skipping Ctags phase.');
      return;
    }

    try {
      // Build exclude args
      const excludes = IGNORE_DIRS.map(d => `--exclude=${d}`).join(' ');
      
      // Run ctags with JSON output format and language restrictions
      // CWD is projectRoot
      const command = `"${ctagsBin}" -R ${excludes} --languages=TypeScript,JavaScript,Python --output-format=json --fields=+n -f - .`;
      const output = execSync(command, { cwd: this.projectRoot, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' });
      
      const lines = output.trim().split('\n');
      let count = 0;

      for (const line of lines) {
        if (!line.trim()) continue;
        const tag = JSON.parse(line);
        if (tag._type === 'tag') {
          // Normalize paths
          const fileId = tag.path.replace(/^\.\//, '').replace(/\\/g, '/');
          
          // Check if this file is in our list of candidate project files
          const fullPath = path.resolve(this.projectRoot, fileId);
          if (files.includes(fullPath)) {
            // Save symbol in SQLite
            await this.db.saveSymbol(
              fileId,
              tag.name,
              tag.kind || 'symbol',
              tag.line || 1,
              undefined, // Ctags doesn't have lineEnd, we will enrich with SCIP
              tag.signature || undefined
            );
            count++;
          }
        }
      }
      console.log(`Ctags indexed ${count} symbols.`);
    } catch (error: any) {
      console.error('Ctags parsing failed:', error.message);
    }
  }

  // Phase 2: SCIP typescript index & parse
  private async runScipPhase(): Promise<void> {
    console.log('Running SCIP indexer & call graph parser...');
    
    // 1. Run scip-typescript locally in the backend directory
    const backendDir = path.join(this.projectRoot, 'backend');
    try {
      execSync('npx scip-typescript index --cwd . --output index.scip', { cwd: backendDir, stdio: 'inherit' });
    } catch (e: any) {
      console.error('Failed to run scip-typescript CLI index:', e.message);
      return;
    }

    // 2. Read the generated index.scip
    const scipFilePath = path.join(backendDir, 'index.scip');
    if (!fs.existsSync(scipFilePath)) {
      console.error('index.scip was not created at', scipFilePath);
      return;
    }

    try {
      const bytes = fs.readFileSync(scipFilePath);
      const index = deserializeSCIP(bytes);

      if (!index.documents || index.documents.length === 0) {
        console.log('SCIP index has no documents.');
        return;
      }

      // Memory map for definitions: symbol ID -> { file, name, lineStart, lineEnd }
      const definitionsMap = new Map<string, { file: string; name: string; lineStart: number; lineEnd: number }>();
      
      // Step 2.1: Collect definitions first
      for (const doc of index.documents) {
        const fileId = `backend/${doc.relativePath.replace(/\\/g, '/')}`; // relative path under backend/
        if (!doc.occurrences) continue;

        for (const occ of doc.occurrences) {
          // Bitwise check or exact check for Definition (role = 1)
          if ((occ.symbolRoles & 1) === 1) {
            const { name, isGlobal } = this.parseScipSymbolName(occ.symbol);
            if (!isGlobal) continue;

            const startLine = occ.range[0] + 1; // SCIP is 0-indexed, database is 1-indexed
            const endLine = occ.range.length === 4 ? occ.range[2] + 1 : startLine;

            definitionsMap.set(occ.symbol, {
              file: fileId,
              name,
              lineStart: startLine,
              lineEnd: endLine
            });

            // Enrich the existing symbol in the DB with accurate lineEnd from SCIP
            // We search for a matching symbol name and start line
            const existing = await this.db.getFileSymbols(fileId);
            const match = existing.find(s => s.name === name && Math.abs(s.line_start - startLine) <= 1);
            if (match) {
              // Update symbol in SQLite
              await this.db.clearFileSymbols(fileId); // delete and insert again or update lineEnd
              for (const sym of existing) {
                if (sym.id === match.id) {
                  await this.db.saveSymbol(fileId, sym.name, sym.kind, sym.line_start, endLine, sym.signature);
                } else {
                  await this.db.saveSymbol(fileId, sym.name, sym.kind, sym.line_start, sym.line_end, sym.signature);
                }
              }
            }
          }
        }
      }

      // Step 2.2: Parse call relationships using TS AST scope traversal + SCIP reference mapping
      let callCount = 0;
      for (const doc of index.documents) {
        const fileId = `backend/${doc.relativePath.replace(/\\/g, '/')}`;
        const absolutePath = path.resolve(this.projectRoot, fileId);
        
        if (!fs.existsSync(absolutePath)) continue;
        if (!doc.occurrences) continue;

        const content = fs.readFileSync(absolutePath, 'utf8');
        const sourceFile = ts.createSourceFile(absolutePath, content, ts.ScriptTarget.Latest, true);
        
        let currentSymbolName = '';

        const traverse = async (node: ts.Node) => {
          let nodeName = '';
          let nodeKind = '';

          if (ts.isFunctionDeclaration(node) && node.name) {
            nodeName = node.name.text;
            nodeKind = 'function';
          } else if (ts.isClassDeclaration(node) && node.name) {
            nodeName = node.name.text;
            nodeKind = 'class';
          } else if (ts.isMethodDeclaration(node) && node.name) {
            nodeName = node.name.getText(sourceFile);
            nodeKind = 'method';
          }

          const parentScope = currentSymbolName;
          if (nodeName && nodeKind) {
            currentSymbolName = nodeName;
          }

          // Inspect call expressions
          if (ts.isCallExpression(node) && currentSymbolName) {
            let identifierNode: ts.Node = node.expression;
            if (ts.isPropertyAccessExpression(node.expression)) {
              identifierNode = node.expression.name;
            }

            const startPos = identifierNode.getStart();
            const { line: startLine, character: startCol } = sourceFile.getLineAndCharacterOfPosition(startPos);

            // Find matching SCIP occurrence
            const matchOcc = doc.occurrences!.find(occ => {
              const occLine = occ.range[0];
              const occStartChar = occ.range[1];
              const occEndChar = occ.range.length === 3 ? occ.range[2] : occ.range[3];
              return occLine === startLine && startCol >= occStartChar && startCol <= occEndChar;
            });

            if (matchOcc) {
              const calleeDef = definitionsMap.get(matchOcc.symbol);
              if (calleeDef && calleeDef.name !== currentSymbolName) {
                const callLine = startLine + 1;
                await this.db.saveCall(
                  fileId,
                  currentSymbolName,
                  calleeDef.file,
                  calleeDef.name,
                  callLine
                );
                callCount++;
              }
            }
          }

          // Traverse children sequentially to preserve call stack order
          const children: ts.Node[] = [];
          ts.forEachChild(node, (child) => {
            children.push(child);
          });

          for (const child of children) {
            await traverse(child);
          }

          if (nodeName && nodeKind) {
            currentSymbolName = parentScope;
          }
        };

        // Start traversal
        await traverse(sourceFile);
      }
      console.log(`SCIP indexed and linked ${callCount} caller-callee relationships.`);
    } catch (err: any) {
      console.error('Failed to parse SCIP index:', err.message);
    }
  }

  // Helper to parse SCIP symbol formats into simple names
  // E.g. scip-typescript npm code-intelligence-backend 1.0.0 src/db.ts/DatabaseService#init(). -> { name: "init", isGlobal: true }
  private parseScipSymbolName(symbol: string): { name: string; isGlobal: boolean } {
    if (symbol.startsWith('local ')) {
      return { name: '', isGlobal: false };
    }

    const parts = symbol.split(' ');
    const pathPart = parts[parts.length - 1];

    // Check if it's a global symbol (ends with '#' or '.')
    // Note: SCIP descriptors end with '#' for class/interface, and '.' for method/function/property
    const isGlobal = pathPart.endsWith('#') || pathPart.endsWith('.');
    
    if (!isGlobal) {
      return { name: '', isGlobal: false };
    }

    // Split by delimiters to get name segments
    const segments = pathPart.split(/[/#]/);
    let lastSegment = segments[segments.length - 1];
    
    if (!lastSegment && segments.length > 1) {
      lastSegment = segments[segments.length - 2];
    }
    
    const name = lastSegment
      .replace(/\(\)\./g, '')
      .replace(/\.$/g, '')
      .replace(/`/g, '')
      .trim();

    return { name, isGlobal: name.length > 0 };
  }
}

// Direct runner entrypoint
if (require.main === module) {
  const indexer = new Indexer(path.join(__dirname, '../..'));
  indexer.run().catch((err) => {
    console.error('Indexer execution failed:', err);
  });
}
