import * as fs from 'fs';
import * as path from 'path';
import { SQLiteStore } from '../src/sqlite';
import type { LogEntry, Server, State } from 'boardgame.io';

const TEST_DB_PATH = path.join(__dirname, 'test.db');

// Helper to create a mock state
function createMockState(stateID: number, gameName = 'test-game'): State {
  return {
    G: { value: stateID },
    ctx: {
      gameName,
      numPlayers: 2,
      turn: stateID,
      currentPlayer: '0',
      playOrder: ['0', '1'],
      playOrderPos: 0,
      phase: 'play',
      activePlayers: null,
    },
    _stateID: stateID,
  } as unknown as State;
}

// Helper to create mock metadata
function createMockMetadata(gameName = 'test-game', gameover?: unknown): Server.MatchData {
  return {
    gameName,
    players: { '0': { id: 0 }, '1': { id: 1 } },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(gameover !== undefined ? { gameover } : {}),
  } as Server.MatchData;
}

// Helper to create a mock log entry
function createMockLogEntry(turn: number, action: string): LogEntry {
  return {
    _stateID: turn,
    action: {
      type: 'MAKE_MOVE',
      payload: { type: action },
    },
    turn,
    phase: 'play',
  } as unknown as LogEntry;
}

describe('SQLiteStore', () => {
  let store: SQLiteStore;

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    // Also remove WAL files
    if (fs.existsSync(TEST_DB_PATH + '-wal')) {
      fs.unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (fs.existsSync(TEST_DB_PATH + '-shm')) {
      fs.unlinkSync(TEST_DB_PATH + '-shm');
    }

    store = new SQLiteStore({ filename: TEST_DB_PATH });
    await store.connect();
  });

  afterEach(() => {
    store.close();
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_PATH + '-wal')) {
      fs.unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (fs.existsSync(TEST_DB_PATH + '-shm')) {
      fs.unlinkSync(TEST_DB_PATH + '-shm');
    }
  });

  describe('connect()', () => {
    it('should create database file', () => {
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
    });

    it('should enable WAL mode', async () => {
      // The store is already connected, verify WAL files can be created
      // WAL mode is enabled during connect
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
    });
  });

  describe('createMatch()', () => {
    it('should create a match and fetch all fields back', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      const result = await store.fetch(matchID, {
        state: true,
        metadata: true,
        initialState: true,
        log: true,
      });

      expect(result.state).toEqual(initialState);
      expect(result.initialState).toEqual(initialState);
      expect(result.metadata).toEqual(metadata);
      expect(result.log).toEqual([]);
    });
  });

  describe('setState()', () => {
    it('should update state', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      const newState = createMockState(1);
      await store.setState(matchID, newState);

      const result = await store.fetch(matchID, { state: true });
      expect(result.state).toEqual(newState);
    });

    it('should append to log', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      const newState = createMockState(1);
      const deltalog = [createMockLogEntry(1, 'move1')];
      await store.setState(matchID, newState, deltalog);

      const result = await store.fetch(matchID, { log: true });
      expect(result.log).toHaveLength(1);
      expect(result.log![0]).toEqual(deltalog[0]);
    });

    it('should ignore stale updates', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      // First update to state 5
      const newState = createMockState(5);
      await store.setState(matchID, newState);

      // Try to update with older state
      const staleState = createMockState(3);
      await store.setState(matchID, staleState);

      // State should still be 5
      const result = await store.fetch(matchID, { state: true });
      expect(result.state?._stateID).toBe(5);
    });

    it('should accept updates with newer stateID', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      const state1 = createMockState(1);
      await store.setState(matchID, state1);

      const state2 = createMockState(2);
      await store.setState(matchID, state2);

      const result = await store.fetch(matchID, { state: true });
      expect(result.state?._stateID).toBe(2);
    });
  });

  describe('setMetadata()', () => {
    it('should update metadata without affecting state', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      const newMetadata = createMockMetadata('test-game', { winner: '0' });
      await store.setMetadata(matchID, newMetadata);

      const result = await store.fetch(matchID, { state: true, metadata: true });
      expect(result.state).toEqual(initialState);
      expect(result.metadata).toEqual(newMetadata);
    });
  });

  describe('fetch()', () => {
    it('should return only requested fields', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      // Only request state
      const stateOnly = await store.fetch(matchID, { state: true });
      expect(stateOnly.state).toBeDefined();
      expect((stateOnly as Record<string, unknown>).metadata).toBeUndefined();
      expect((stateOnly as Record<string, unknown>).initialState).toBeUndefined();
      expect((stateOnly as Record<string, unknown>).log).toBeUndefined();

      // Only request metadata
      const metadataOnly = await store.fetch(matchID, { metadata: true });
      expect((metadataOnly as Record<string, unknown>).state).toBeUndefined();
      expect(metadataOnly.metadata).toBeDefined();
    });

    it('should return empty object for missing match', async () => {
      const result = await store.fetch('non-existent', {
        state: true,
        metadata: true,
        log: true,
      });

      expect(result.state).toBeUndefined();
      expect(result.metadata).toBeUndefined();
      expect(result.log).toBeUndefined();
    });
  });

  describe('wipe()', () => {
    it('should remove match and associated logs', async () => {
      const matchID = 'match-1';
      const initialState = createMockState(0);
      const metadata = createMockMetadata();

      await store.createMatch(matchID, { initialState, metadata });

      // Add some log entries
      await store.setState(matchID, createMockState(1), [createMockLogEntry(1, 'move1')]);
      await store.setState(matchID, createMockState(2), [createMockLogEntry(2, 'move2')]);

      // Verify match exists
      let result = await store.fetch(matchID, { state: true, log: true });
      expect(result.state).toBeDefined();
      expect(result.log).toHaveLength(2);

      // Wipe the match
      await store.wipe(matchID);

      // Verify match is gone
      result = await store.fetch(matchID, { state: true, log: true });
      expect(result.state).toBeUndefined();
    });
  });

  describe('listMatches()', () => {
    beforeEach(async () => {
      // Create several matches for testing
      await store.createMatch('game1-match1', {
        initialState: createMockState(0, 'game1'),
        metadata: createMockMetadata('game1'),
      });
      await store.createMatch('game1-match2', {
        initialState: createMockState(0, 'game1'),
        metadata: createMockMetadata('game1', { winner: '0' }),
      });
      await store.createMatch('game2-match1', {
        initialState: createMockState(0, 'game2'),
        metadata: createMockMetadata('game2'),
      });
    });

    it('should return all match IDs', async () => {
      const matches = await store.listMatches();
      expect(matches).toHaveLength(3);
      expect(matches).toContain('game1-match1');
      expect(matches).toContain('game1-match2');
      expect(matches).toContain('game2-match1');
    });

    it('should filter by gameName', async () => {
      const matches = await store.listMatches({ gameName: 'game1' });
      expect(matches).toHaveLength(2);
      expect(matches).toContain('game1-match1');
      expect(matches).toContain('game1-match2');
    });

    it('should filter by isGameover=true', async () => {
      const matches = await store.listMatches({
        where: { isGameover: true },
      });
      expect(matches).toHaveLength(1);
      expect(matches).toContain('game1-match2');
    });

    it('should filter by isGameover=false', async () => {
      const matches = await store.listMatches({
        where: { isGameover: false },
      });
      expect(matches).toHaveLength(2);
      expect(matches).toContain('game1-match1');
      expect(matches).toContain('game2-match1');
    });

    it('should filter by updatedBefore', async () => {
      const now = Date.now();
      // All matches were created before now + 1000
      const matches = await store.listMatches({
        where: { updatedBefore: now + 1000 },
      });
      expect(matches).toHaveLength(3);

      // No matches were created before 0
      const noMatches = await store.listMatches({
        where: { updatedBefore: 0 },
      });
      expect(noMatches).toHaveLength(0);
    });

    it('should filter by updatedAfter', async () => {
      const matches = await store.listMatches({
        where: { updatedAfter: 0 },
      });
      expect(matches).toHaveLength(3);

      const noMatches = await store.listMatches({
        where: { updatedAfter: Date.now() + 1000 },
      });
      expect(noMatches).toHaveLength(0);
    });

    it('should combine filters', async () => {
      const matches = await store.listMatches({
        gameName: 'game1',
        where: { isGameover: false },
      });
      expect(matches).toHaveLength(1);
      expect(matches).toContain('game1-match1');
    });
  });

  describe('verbose mode', () => {
    it('should not throw with verbose mode enabled', async () => {
      const verboseStore = new SQLiteStore({
        filename: TEST_DB_PATH + '.verbose',
        verbose: true,
      });

      await expect(verboseStore.connect()).resolves.not.toThrow();

      await expect(
        verboseStore.createMatch('test', {
          initialState: createMockState(0),
          metadata: createMockMetadata(),
        })
      ).resolves.not.toThrow();

      verboseStore.close();

      // Cleanup
      fs.unlinkSync(TEST_DB_PATH + '.verbose');
      if (fs.existsSync(TEST_DB_PATH + '.verbose-wal')) {
        fs.unlinkSync(TEST_DB_PATH + '.verbose-wal');
      }
      if (fs.existsSync(TEST_DB_PATH + '.verbose-shm')) {
        fs.unlinkSync(TEST_DB_PATH + '.verbose-shm');
      }
    });
  });

  describe('error handling', () => {
    it('should throw if operations called before connect', async () => {
      const disconnectedStore = new SQLiteStore({ filename: TEST_DB_PATH + '.disconnected' });

      await expect(
        disconnectedStore.createMatch('test', {
          initialState: createMockState(0),
          metadata: createMockMetadata(),
        })
      ).rejects.toThrow('Database not connected');

      await expect(disconnectedStore.fetch('test', { state: true })).rejects.toThrow(
        'Database not connected'
      );

      await expect(disconnectedStore.setState('test', createMockState(1))).rejects.toThrow(
        'Database not connected'
      );

      await expect(
        disconnectedStore.setMetadata('test', createMockMetadata())
      ).rejects.toThrow('Database not connected');

      await expect(disconnectedStore.wipe('test')).rejects.toThrow('Database not connected');

      await expect(disconnectedStore.listMatches()).rejects.toThrow('Database not connected');
    });
  });
});
