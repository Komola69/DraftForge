require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const lockfile = require('proper-lockfile');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_KEY = process.env.ADMIN_KEY || 'default_dev_key';

// Configuration paths
const RAW_DIR = path.join(__dirname, '../data/raw');
const PROCESSED_DIR = path.join(__dirname, '../data/processed');
const CONFIG_PATH = path.join(RAW_DIR, 'config.json');
const META_OVERRIDES_PATH = path.join(RAW_DIR, 'meta_overrides.json');
const HEROES_PATH = path.join(PROCESSED_DIR, 'v1_heroes.json');

const V2_SOURCE = path.join(PROCESSED_DIR, 'v2_schema.json');
const V2_PUBLIC = path.join(__dirname, '../pwa/public/data/processed/v2_schema.json');

/**
 * Point 4 Fix: Auth Middleware
 */
function authMiddleware(req, res, next) {
  // Allow GET requests to non-sensitive routes
  if (req.method === 'GET' && !req.path.includes('pipeline')) {
    return next();
  }

  // Pipeline uses query param for SSE compatibility
  if (req.path.includes('pipeline')) {
    if (req.query.key === ADMIN_KEY) return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use(authMiddleware);

function mirrorV2SchemaToPublic(send) {
  if (!fs.existsSync(V2_SOURCE)) {
    send('    [WARN] v2_schema.json source file not found.');
    return false;
  }

  try {
    fs.mkdirSync(path.dirname(V2_PUBLIC), { recursive: true });
    fs.copyFileSync(V2_SOURCE, V2_PUBLIC);
    send('    ✅ v2_schema.json mirrored to PWA public folder.');
    return true;
  } catch (err) {
    send(`    [ERROR] Sync failed: ${err.message}`);
    return false;
  }
}

app.get('/api/schemas', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    res.json({ schemas: config.supported_schemas });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read config.json' });
  }
});

app.post('/api/schemas', (req, res) => {
  const { schemas } = req.body;
  if (!Array.isArray(schemas)) return res.status(400).send('Invalid schemas');

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config.supported_schemas = schemas;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).send('Failed to update configuration');
  }
});

app.get('/api/diagnostics', (req, res) => {
  const synergyExists = fs.existsSync(path.join(PROCESSED_DIR, 'v1_synergies.json'));
  const matchupsExists = fs.existsSync(path.join(PROCESSED_DIR, 'v1_matchups.json'));
  const v2Exists = fs.existsSync(V2_SOURCE);

  res.json({
    synergy: synergyExists,
    constraints: matchupsExists,
    cache: v2Exists
  });
});

app.get('/api/heroes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf8'));
    res.json(data.heroes);
  } catch (err) {
    res.status(500).send('Error loading heroes');
  }
});

/**
 * Point 2 Fix: Race Condition Protection
 * Uses proper-lockfile for atomic read-modify-write.
 */
app.post('/api/heroes/:name', async (req, res) => {
  const heroName = req.params.name.toLowerCase();
  const { tier, gold_reliance, buff_dependency, primary_damage_type } = req.body;

  let release;
  try {
    // Acquire lock on the overrides file
    release = await lockfile.lock(META_OVERRIDES_PATH, { retries: 5 });

    const overrides = JSON.parse(fs.readFileSync(META_OVERRIDES_PATH, 'utf8'));

    if (tier) overrides.tiers[heroName] = tier;
    if (gold_reliance !== undefined) overrides.gold_reliance[heroName] = Number(gold_reliance);
    if (buff_dependency) overrides.buff_dependencies[heroName] = buff_dependency;
    if (primary_damage_type) overrides.damage_types[heroName] = primary_damage_type;

    fs.writeFileSync(META_OVERRIDES_PATH, JSON.stringify(overrides, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Meta Update Lock Failure:', err);
    res.status(503).json({ error: 'Database is busy, please try again in a moment.' });
  } finally {
    if (release) await release();
  }
});

/**
 * Point 3 Fix: Brittle Pipeline
 */
app.get('/api/pipeline', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const send = (msg) => res.write(`data: ${msg}\n\n`);
  const rootDir = path.join(__dirname, '..');

  send('Starting DraftForge Intelligent Pipeline...');

  const runStep = (label, command, args, onDone) => {
    send(label);
    const proc = spawn(command, args, { cwd: rootDir });

    proc.stdout.on('data', data => send(`    ${data.toString().trim()}`));
    proc.stderr.on('data', data => send(`    [STDERR] ${data.toString().trim()}`));
    
    proc.on('error', err => {
      send(`    [FATAL] Step failed to start: ${err.message}`);
      onDone(-1);
    });

    proc.on('close', code => onDone(code));
  };

  runStep('--> [1/3] Compiling base Hero DB...', 'node', ['data/scripts/compile_db.mjs'], (code1) => {
    if (code1 !== 0) return (send('Pipeline aborted: Step 1 failed.'), res.end());

    runStep('--> [2/3] Merging community counters...', 'node', ['data/scripts/merge_counters.mjs'], (code2) => {
      if (code2 !== 0) return (send('Pipeline aborted: Step 2 failed.'), res.end());

      runStep('--> [3/3] Running High-Intelligence Aggregator (Go)...', 'go', ['run', 'data/scripts/update_meta.go'], (code3) => {
        if (code3 !== 0) {
          send('    [WARN] Stage 3 Go pipeline failed. Ensure "go" is in system PATH.');
        } else {
          if (fs.existsSync(V2_SOURCE)) {
             try {
               const raw = fs.readFileSync(V2_SOURCE, 'utf8');
               JSON.parse(raw);
               mirrorV2SchemaToPublic(send);
               send('Pipeline execution complete! v2_schema.json generated and verified. 🚀');
             } catch (e) {
               send('    [ERROR] Integrity Check Failed: v2_schema.json is corrupted.');
             }
          } else {
             send('    [ERROR] Integrity Check Failed: v2_schema.json missing after Go run.');
          }
        }
        res.end();
      });
    });
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Admin GUI running at http://localhost:${PORT}`);
});
