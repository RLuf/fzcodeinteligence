import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(__dirname, '../../database.db');

export class DatabaseService {
  private db!: sqlite3.Database;

  constructor() {
    this.connect();
  }

  private connect() {
    this.db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error connecting to database:', err);
      }
    });
  }

  public init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Enable foreign keys
        this.db.run('PRAGMA foreign_keys = ON;');

        // Create files table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            hash TEXT NOT NULL,
            language TEXT NOT NULL,
            size INTEGER NOT NULL,
            last_indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Create symbols table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id TEXT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            line_start INTEGER NOT NULL,
            line_end INTEGER,
            signature TEXT,
            FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
          );
        `);

        // Create call_graph table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS call_graph (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_file TEXT NOT NULL,
            caller_symbol TEXT NOT NULL,
            callee_file TEXT NOT NULL,
            callee_symbol TEXT NOT NULL,
            call_line INTEGER NOT NULL,
            FOREIGN KEY(caller_file) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY(callee_file) REFERENCES files(id) ON DELETE CASCADE
          );
        `);

        // Create symbols FTS5 virtual table
        this.db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
            name,
            signature,
            content='symbols',
            content_rowid='id'
          );
        `, (err) => {
          if (err) {
            console.warn('FTS5 table creation failed, fallback to standard LIKE queries.', err.message);
          }
        });

        // Trigger to update FTS5 on insert
        this.db.run(`
          CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
            INSERT INTO symbols_fts(rowid, name, signature) VALUES (new.id, new.name, new.signature);
          END;
        `);

        // Trigger to update FTS5 on delete
        this.db.run(`
          CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
            INSERT INTO symbols_fts(symbols_fts, rowid, name, signature) VALUES('delete', old.id, old.name, old.signature);
          END;
        `);

        resolve();
      });
    });
  }

  // Promise wrapper helper for run
  private run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Promise wrapper helper for all
  private all<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  // Promise wrapper helper for get
  private get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  public async getFile(id: string): Promise<{ id: string, hash: string } | undefined> {
    return this.get('SELECT id, hash FROM files WHERE id = ?', [id]);
  }

  public async saveFile(id: string, hash: string, language: string, size: number): Promise<void> {
    await this.run(
      'INSERT OR REPLACE INTO files (id, hash, language, size, last_indexed_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [id, hash, language, size]
    );
  }

  public async deleteFile(id: string): Promise<void> {
    await this.run('DELETE FROM files WHERE id = ?', [id]);
  }

  public async saveSymbol(fileId: string, name: string, kind: string, lineStart: number, lineEnd?: number, signature?: string): Promise<void> {
    await this.run(
      'INSERT INTO symbols (file_id, name, kind, line_start, line_end, signature) VALUES (?, ?, ?, ?, ?, ?)',
      [fileId, name, kind, lineStart, lineEnd ?? null, signature ?? null]
    );
  }

  public async clearFileSymbols(fileId: string): Promise<void> {
    await this.run('DELETE FROM symbols WHERE file_id = ?', [fileId]);
  }

  public async saveCall(callerFile: string, callerSymbol: string, calleeFile: string, calleeSymbol: string, callLine: number): Promise<void> {
    await this.run(
      'INSERT INTO call_graph (caller_file, caller_symbol, callee_file, callee_symbol, call_line) VALUES (?, ?, ?, ?, ?)',
      [callerFile, callerSymbol, calleeFile, calleeSymbol, callLine]
    );
  }

  public async clearFileCalls(fileId: string): Promise<void> {
    await this.run('DELETE FROM call_graph WHERE caller_file = ? OR callee_file = ?', [fileId, fileId]);
  }

  public async search(query: string, type: 'text' | 'symbol' | 'structural'): Promise<any[]> {
    if (type === 'symbol') {
      // Try to use FTS5 if possible
      try {
        const ftsRows = await this.all<any>(
          `SELECT s.*, f.language FROM symbols s 
           JOIN symbols_fts fts ON s.id = fts.rowid 
           JOIN files f ON s.file_id = f.id
           WHERE symbols_fts MATCH ? LIMIT 100`,
          [query]
        );
        if (ftsRows.length > 0) return ftsRows;
      } catch (e) {
        // Fallback to standard LIKE
      }

      return this.all<any>(
        `SELECT s.*, f.language FROM symbols s 
         JOIN files f ON s.file_id = f.id 
         WHERE s.name LIKE ? OR s.signature LIKE ? LIMIT 100`,
        [`%${query}%`, `%${query}%`]
      );
    } else {
      // Text search: we query symbols by default or files
      return this.all<any>(
        `SELECT s.*, f.language FROM symbols s 
         JOIN files f ON s.file_id = f.id 
         WHERE s.name LIKE ? OR s.signature LIKE ? LIMIT 100`,
        [`%${query}%`, `%${query}%`]
      );
    }
  }

  public async findDefinition(fileId: string, line: number, character: number): Promise<any | null> {
    // Return the symbol defined in the file that contains this line, or matching reference
    // Let's first search if there's a symbol defined in fileId around this line
    const localSymbol = await this.get<any>(
      `SELECT * FROM symbols 
       WHERE file_id = ? AND line_start <= ? AND (line_end IS NULL OR line_end >= ?) 
       ORDER BY line_start DESC LIMIT 1`,
      [fileId, line, line]
    );

    if (localSymbol) {
      // Find if this local symbol is a caller, we might want to find its definition or callee
      // For now, let's return the local symbol itself if it fits, or if there's a callee call on this line
      const call = await this.get<any>(
        `SELECT * FROM call_graph 
         WHERE caller_file = ? AND call_line = ? LIMIT 1`,
        [fileId, line]
      );

      if (call) {
        // Find callee definition
        const calleeDef = await this.get<any>(
          `SELECT * FROM symbols 
           WHERE file_id = ? AND name = ? LIMIT 1`,
          [call.callee_file, call.callee_symbol]
        );
        if (calleeDef) {
          return calleeDef;
        }
      }
      return localSymbol;
    }

    return null;
  }

  public async findSymbolByName(name: string): Promise<any | null> {
    return this.get<any>('SELECT * FROM symbols WHERE name = ? LIMIT 1', [name]);
  }

  public async getCallGraph(symbolName: string): Promise<any[]> {
    // Get caller-callee relations for a symbol
    return this.all<any>(
      `SELECT * FROM call_graph 
       WHERE caller_symbol = ? OR callee_symbol = ?`,
      [symbolName, symbolName]
    );
  }

  public async getFilesList(): Promise<any[]> {
    return this.all<any>('SELECT id, language, size FROM files ORDER BY id ASC');
  }

  public async getFileSymbols(fileId: string): Promise<any[]> {
    return this.all<any>('SELECT * FROM symbols WHERE file_id = ? ORDER BY line_start ASC', [fileId]);
  }

  public close() {
    this.db.close();
  }
}
