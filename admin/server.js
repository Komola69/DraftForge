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
  send('--> [1/2] Compiling base Hero DB and Matrix...');

  const rootDir = path.join(__dirname, '../');
  
  // Step 1: compile_db.mjs
  const compileProc = spawn('node', ['data/scripts/compile_db.mjs'], { cwd: rootDir });
  
  compileProc.stdout.on('data', data => {
    data.toString().split('\n').filter(Boolean).forEach(line => send(`    ${line}`));
  });
  
  compileProc.stderr.on('data', data => {
    data.toString().split('\n').filter(Boolean).forEach(line => send(`    [ERROR] ${line}`));
  });

  compileProc.on('close', code => {
    if (code !== 0) {
      send(`Pipeline failed at compilation step (code ${code})`);
      res.end();
      return;
    }
    
    send('--> [2/2] Merging directional API counters...');
    
    // Step 2: merge_counters.mjs
    const mergeProc = spawn('node', ['data/scripts/merge_counters.mjs'], { cwd: rootDir });
    
    mergeProc.stdout.on('data', data => {
      data.toString().split('\n').filter(Boolean).forEach(line => send(`    ${line}`));
    });

    mergeProc.stderr.on('data', data => {
      data.toString().split('\n').filter(Boolean).forEach(line => send(`    [ERROR] ${line}`));
    });

    mergeProc.on('close', mCode => {
      if (mCode !== 0) {
        send(`Pipeline failed at merge step (code ${mCode})`);
      } else {
        send('Pipeline execution complete! 🚀 You can safely close this.');
      }
      res.end();
    });
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Admin GUI running at http://localhost:${PORT}`);
});
