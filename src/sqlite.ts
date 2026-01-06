import Database from 'better-sqlite3';
import { Async } from 'boardgame.io/internal';
import type { LogEntry, Server, State, StorageAPI } from 'boardgame.io';

export interface SQLiteStoreOptions {
  /** Path to SQLite database file */
  filename: string;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

interface MatchRow {
  id: string;
  gameName: string;
  state: string | null;
  initialState: string | null;
  metadata: string | null;
  createdAt: number;
  updatedAt: number;
}

interface LogRow {
  id: number;
  matchId: string;
  logEntry: string;
}

export class SQLiteStore extends Async {
  private db: Database.Database | null = null;
  private filename: string;
  private verbose: boolean;

  constructor(options: SQLiteStoreOptions) {
    super();
    this.filename = options.filename;
    this.verbose = options.verbose ?? false;
  }

  private log(...args: unknown[]): void {
    if (this.verbose) {
      console.log('[SQLiteStore]', ...args);
    }
  }

  async connect(): Promise<void> {
    this.log('Connecting to database:', this.filename);
    
    this.db = new Database(this.filename, {
      verbose: this.verbose ? (msg) => this.log('SQL:', msg) : undefined,
    });

    // Enable WAL mode for better concurrent read/write performance
    this.db.pragma('journal_mode = WAL');
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        gameName TEXT NOT NULL,
        state TEXT,
        initialState TEXT,
        metadata TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matchId TEXT NOT NULL,
        logEntry TEXT NOT NULL,
        FOREIGN KEY (matchId) REFERENCES matches(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_matches_gameName ON matches(gameName);
      CREATE INDEX IF NOT EXISTS idx_matches_updatedAt ON matches(updatedAt);
      CREATE INDEX IF NOT EXISTS idx_logs_matchId ON logs(matchId);
    `);

    this.log('Database connected and initialized');
  }

  async createMatch(id: string, opts: StorageAPI.CreateMatchOpts): Promise<void> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }

    const now = Date.now();
    const gameName = opts.metadata.gameName ?? '';
    this.log('Creating match:', id, gameName);

    const stmt = this.db.prepare(`
      INSERT INTO matches (id, gameName, state, initialState, metadata, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      gameName,
      JSON.stringify(opts.initialState),
      JSON.stringify(opts.initialState),
      JSON.stringify(opts.metadata),
      now,
      now
    );
  }

  async fetch<O extends StorageAPI.FetchOpts>(
    matchID: string,
    opts: O
  ): Promise<StorageAPI.FetchResult<O>> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }

    this.log('Fetching match:', matchID, opts);

    const result: Partial<StorageAPI.FetchFields> = {};

    const matchStmt = this.db.prepare('SELECT * FROM matches WHERE id = ?');
    const match = matchStmt.get(matchID) as MatchRow | undefined;

    if (!match) {
      return result as StorageAPI.FetchResult<O>;
    }

    if (opts.state) {
      result.state = match.state ? JSON.parse(match.state) : undefined;
    }

    if (opts.metadata) {
      result.metadata = match.metadata ? JSON.parse(match.metadata) : undefined;
    }

    if (opts.initialState) {
      result.initialState = match.initialState ? JSON.parse(match.initialState) : undefined;
    }

    if (opts.log) {
      const logStmt = this.db.prepare('SELECT logEntry FROM logs WHERE matchId = ? ORDER BY id ASC');
      const logs = logStmt.all(matchID) as Pick<LogRow, 'logEntry'>[];
      result.log = logs.map((row) => JSON.parse(row.logEntry) as LogEntry);
    }

    return result as StorageAPI.FetchResult<O>;
  }

  async setState(id: string, state: State, deltalog?: LogEntry[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }

    this.log('Setting state for match:', id, 'stateID:', state._stateID);

    // Check for stale state
    const existingStmt = this.db.prepare('SELECT state FROM matches WHERE id = ?');
    const existing = existingStmt.get(id) as Pick<MatchRow, 'state'> | undefined;

    if (existing && existing.state) {
      const existingState = JSON.parse(existing.state) as State;
      if (existingState._stateID >= state._stateID) {
        this.log('Skipping stale state update. Existing:', existingState._stateID, 'New:', state._stateID);
        return;
      }
    }

    const now = Date.now();

    // Use a transaction for atomicity
    const transaction = this.db.transaction(() => {
      // Update state
      const updateStmt = this.db!.prepare(`
        UPDATE matches SET state = ?, updatedAt = ? WHERE id = ?
      `);
      updateStmt.run(JSON.stringify(state), now, id);

      // Append deltalog entries
      if (deltalog && deltalog.length > 0) {
        const insertLogStmt = this.db!.prepare(`
          INSERT INTO logs (matchId, logEntry) VALUES (?, ?)
        `);
        for (const entry of deltalog) {
          insertLogStmt.run(id, JSON.stringify(entry));
        }
      }
    });

    transaction();
  }

  async setMetadata(id: string, metadata: Server.MatchData): Promise<void> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }

    this.log('Setting metadata for match:', id);

    const stmt = this.db.prepare(`
      UPDATE matches SET metadata = ?, updatedAt = ? WHERE id = ?
    `);
    stmt.run(JSON.stringify(metadata), Date.now(), id);
  }

  async wipe(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }

    this.log('Wiping match:', id);

    // Due to ON DELETE CASCADE, this will also delete logs
    const stmt = this.db.prepare('DELETE FROM matches WHERE id = ?');
    stmt.run(id);
  }

  async listMatches(opts?: StorageAPI.ListMatchesOpts): Promise<string[]> {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }

    this.log('Listing matches with opts:', opts);

    let sql = 'SELECT id, metadata FROM matches WHERE 1=1';
    const params: (string | number)[] = [];

    if (opts?.gameName) {
      sql += ' AND gameName = ?';
      params.push(opts.gameName);
    }

    if (opts?.where?.updatedBefore !== undefined) {
      sql += ' AND updatedAt < ?';
      params.push(opts.where.updatedBefore);
    }

    if (opts?.where?.updatedAfter !== undefined) {
      sql += ' AND updatedAt > ?';
      params.push(opts.where.updatedAfter);
    }

    sql += ' ORDER BY updatedAt DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Pick<MatchRow, 'id' | 'metadata'>[];

    // Filter by isGameover in memory (since it's in the JSON metadata)
    let filtered = rows;
    if (opts?.where?.isGameover !== undefined) {
      filtered = rows.filter((row) => {
        if (!row.metadata) return false;
        const metadata = JSON.parse(row.metadata) as Server.MatchData;
        const hasGameover = metadata.gameover !== undefined;
        return opts.where!.isGameover ? hasGameover : !hasGameover;
      });
    }

    return filtered.map((row) => row.id);
  }

  /**
   * Close the database connection.
   * This is not part of the StorageAPI.Async interface but useful for cleanup.
   */
  close(): void {
    if (this.db) {
      this.log('Closing database connection');
      this.db.close();
      this.db = null;
    }
  }
}
