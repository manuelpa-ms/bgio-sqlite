# bgio-sqlite

SQLite storage adapter for [boardgame.io](https://boardgame.io/).

Provides reliable, file-based game state persistence using SQLite via better-sqlite3.
No external database server required.

## Why bgio-sqlite?

The default `FlatFile` adapter in boardgame.io uses node-persist which can suffer from data corruption issues, especially under concurrent writes. This adapter uses SQLite with WAL mode for:

- **Reliable persistence**: ACID transactions prevent data corruption
- **Better concurrency**: WAL mode allows concurrent reads while writing
- **Simple deployment**: Single file database, no server needed
- **Better performance**: SQLite is highly optimized for read/write operations

## Installation

```bash
npm install bgio-sqlite
```

## Usage

```javascript
const { Server } = require('boardgame.io/server');
const { SQLiteStore } = require('bgio-sqlite');
const { MyGame } = require('./game');

const server = Server({
  games: [MyGame],
  db: new SQLiteStore({
    filename: './data/games.db',
    verbose: false,
  }),
});

server.run(8000);
```

### With TypeScript

```typescript
import { Server } from 'boardgame.io/server';
import { SQLiteStore } from 'bgio-sqlite';
import { MyGame } from './game';

const server = Server({
  games: [MyGame],
  db: new SQLiteStore({
    filename: './data/games.db',
  }),
});

server.run(8000);
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `filename` | `string` | (required) | Path to SQLite database file |
| `verbose` | `boolean` | `false` | Enable debug logging |

## Database Location

The database file is created at the specified `filename` path. Ensure the directory exists
and the process has write permissions.

For production deployments, consider placing the database on persistent storage.

## Database Schema

The adapter creates two tables:

- `matches` - Stores match state, metadata, and timestamps
- `logs` - Stores game action logs for each match

WAL mode is enabled by default for better concurrent access.

## API

The `SQLiteStore` class implements boardgame.io's `StorageAPI.Async` interface:

- `connect()` - Initialize database connection
- `createMatch(id, opts)` - Create a new match
- `fetch(matchID, opts)` - Retrieve match data
- `setState(id, state, deltalog?)` - Update match state
- `setMetadata(id, metadata)` - Update match metadata  
- `wipe(id)` - Delete a match
- `listMatches(opts?)` - List matches with optional filters

Additionally:

- `close()` - Close the database connection (for cleanup)

## License

MIT
