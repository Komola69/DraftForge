const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataLoaderPath = path.join(__dirname, '../pwa/src/engine/data-loader.ts');
const teamBuilderPath = path.join(__dirname, '../pwa/src/engine/team-builder.ts');
const banAdvisorPath = path.join(__dirname, '../pwa/src/engine/ban-advisor.ts');
const draftEnginePath = path.join(__dirname, '../pwa/src/engine/draft-engine.ts');
const defaultGoExe = 'C:\\Program Files\\Go\\bin\\go.exe';
const goExecutable = fs.existsSync(defaultGoExe) ? defaultGoExe : 'go';
const v2SchemaSourcePath = path.join(__dirname, '../data/processed/v2_schema.json');
const v2SchemaPublicPath = path.join(__dirname, '../pwa/public/data/processed/v2_schema.json');

function mirrorV2SchemaToPublic(send) {
  if (!fs.existsSync(v2SchemaSourcePath)) {
    send('    [WARN] v2_schema.json not found for public mirror step.');
    return false;
  }

  fs.mkdirSync(path.dirname(v2SchemaPublicPath), { recursive: true });
  fs.copyFileSync(v2SchemaSourcePath, v2SchemaPublicPath);
  send('    Mirrored v2_schema.json to pwa/public/data/processed for app fetch path.');
  return true;
}

app.get('/api/schemas', (req, res) => {
  try {
    const content = fs.readFileSync(dataLoaderPath, 'utf8');
    const match = content.match(/const SUPPORTED_SCHEMAS = \[(.*?)\];/);
    if (match) {
      const schemas = match[1].split(',').map(s => s.replace(/['"\s]/g, ''));
      res.json({ schemas });
    } else {
      res.status(500).json({ error: 'Could not find SUPPORTED_SCHEMAS' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/schemas', (req, res) => {
  try {
    const { schemas } = req.body;
    let content = fs.readFileSync(dataLoaderPath, 'utf8');
    const formattedSchemas = schemas.map(s => `'${s}'`).join(', ');
    content = content.replace(/const SUPPORTED_SCHEMAS = \[.*?\];/, `const SUPPORTED_SCHEMAS = [${formattedSchemas}];`);
    fs.writeFileSync(dataLoaderPath, content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/diagnostics', (req, res) => {
  try {
    const teamBuilderContent = fs.readFileSync(teamBuilderPath, 'utf8');
    const draftEngineContent = fs.readFileSync(draftEnginePath, 'utf8');
    const banAdvisorContent = fs.readFileSync(banAdvisorPath, 'utf8');

    const synergyHealthy = draftEngineContent.includes('calculateHeroScore');
    const constraintsHealthy = teamBuilderContent.includes('aNativeCount - bNativeCount');
    const cacheHealthy = banAdvisorContent.includes('this.data.onLoad');

    res.json({
      synergy: synergyHealthy,
      constraints: constraintsHealthy,
      cache: cacheHealthy
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pipeline', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const send = (msg) => res.write(`data: ${msg}\n\n`);

  send('Starting DraftForge Auto-Pipeline...');
  const rootDir = path.join(__dirname, '../');

  const runStep = (label, command, args, options, onDone) => {
    send(label);
    const proc = spawn(command, args, options);

    proc.stdout.on('data', data => {
      data.toString().split('\n').filter(Boolean).forEach(line => send(`    ${line}`));
    });

    proc.stderr.on('data', data => {
      data.toString().split('\n').filter(Boolean).forEach(line => send(`    [ERROR] ${line}`));
    });

    proc.on('error', (err) => {
      send(`Pipeline step failed to start: ${err.message}`);
      res.end();
    });

    proc.on('close', code => onDone(code));
  };

  runStep('--> [1/3] Compiling base Hero DB and Matrix...', 'node', ['data/scripts/compile_db.mjs'], { cwd: rootDir }, (compileCode) => {
    if (compileCode !== 0) {
      send(`Pipeline failed at compilation step (code ${compileCode})`);
      res.end();
      return;
    }

    runStep('--> [2/3] Merging directional API counters...', 'node', ['data/scripts/merge_counters.mjs'], { cwd: rootDir }, (mergeCode) => {
      if (mergeCode !== 0) {
        send(`Pipeline failed at merge step (code ${mergeCode})`);
        res.end();
        return;
      }

      const goCheck = spawn(goExecutable, ['version'], { cwd: rootDir });
      goCheck.on('error', () => {
        send('--> [3/3] Generating v2 schema...');
        send('    [WARN] Go runtime not found. Skipping v2_schema.json generation.');
        send('Pipeline execution complete with v1 artifacts.');
        res.end();
      });

      goCheck.on('close', (goCheckCode) => {
        if (goCheckCode !== 0) {
          send('--> [3/3] Generating v2 schema...');
          send(`    [WARN] Go runtime check failed (code ${goCheckCode}). Skipping v2_schema.json generation.`);
          send('Pipeline execution complete with v1 artifacts.');
          res.end();
          return;
        }

        runStep('--> [3/3] Generating v2 schema...', goExecutable, ['run', 'data/scripts/update_meta.go'], { cwd: rootDir }, (goCode) => {
          if (goCode !== 0) {
            send(`    [WARN] v2 schema generation failed (code ${goCode}). Keeping v1 fallback.`);
            send('Pipeline execution complete with v1 artifacts.');
          } else {
            try {
              mirrorV2SchemaToPublic(send);
            } catch (err) {
              send(`    [WARN] Failed to mirror v2 schema into PWA public path: ${err.message}`);
            }
            send('Pipeline execution complete! v2_schema.json generated. 🚀');
          }
          res.end();
        });
      });
    });
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Admin GUI running at http://localhost:${PORT}`);
});
