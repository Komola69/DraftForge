document.addEventListener('DOMContentLoaded', () => {
    // --- Point 4: Auth Handling ---
    let adminKey = localStorage.getItem('df_admin_key');
    
    function promptForKey() {
        const key = prompt('Please enter your Admin Access Key:');
        if (key) {
            localStorage.setItem('df_admin_key', key);
            adminKey = key;
            window.location.reload();
        }
    }

    if (!adminKey) {
        promptForKey();
    }

    const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': adminKey
    };

    // --- Compatibility Section ---
    const schemaControls = document.getElementById('schemaControls');
    const btnSaveSchemas = document.getElementById('btnSaveSchemas');
    let currentSchemas = [];

    const ALL_VERSIONS = ['1.0.0', '2.0.0'];

    async function loadSchemas() {
        try {
            const res = await fetch('/api/schemas', { headers: authHeaders });
            if (res.status === 401) return promptForKey();
            const data = await res.json();
            if (data.schemas) {
                currentSchemas = data.schemas;
                renderSchemaToggles();
            }
        } catch (err) {
            console.error(err);
        }
    }

    function renderSchemaToggles() {
        schemaControls.innerHTML = '';
        
        const hint = document.createElement('p');
        hint.className = 'small-hint';
        hint.innerHTML = '<strong>Tip:</strong> Keep both of these <b>ON</b> for the smoothest experience.';
        schemaControls.appendChild(hint);

        ALL_VERSIONS.forEach(version => {
            const isEnabled = currentSchemas.includes(version);
            
            const row = document.createElement('div');
            row.className = 'toggle-row';
            
            const labelContainer = document.createElement('div');
            labelContainer.className = 'label-stack';
            
            const label = document.createElement('span');
            label.className = 'toggle-label';
            label.textContent = version === '1.0.0' ? 'Standard Game Data' : 'New Update Support';
            
            const subLabel = document.createElement('span');
            subLabel.className = 'toggle-sublabel';
            subLabel.textContent = version === '1.0.0' ? 'Supports current heroes' : 'Supports future hero updates';
            
            labelContainer.appendChild(label);
            labelContainer.appendChild(subLabel);
            
            const labelSwitch = document.createElement('label');
            labelSwitch.className = 'switch';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = isEnabled;
            input.dataset.version = version;
            const slider = document.createElement('span');
            slider.className = 'slider';
            
            labelSwitch.appendChild(input);
            labelSwitch.appendChild(slider);
            
            row.appendChild(labelContainer);
            row.appendChild(labelSwitch);
            schemaControls.appendChild(row);
        });
    }

    btnSaveSchemas.addEventListener('click', async () => {
        const inputs = schemaControls.querySelectorAll('input[type="checkbox"]');
        const newSchemas = Array.from(inputs).filter(i => i.checked).map(i => i.dataset.version);
        btnSaveSchemas.textContent = 'Saving...';
        try {
            const res = await fetch('/api/schemas', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ schemas: newSchemas })
            });
            if (res.status === 401) return promptForKey();
            btnSaveSchemas.textContent = 'Changes Saved!';
            setTimeout(() => btnSaveSchemas.textContent = 'Confirm Changes', 2000);
        } catch (err) {
            btnSaveSchemas.textContent = 'Save Failed';
        }
    });

    // --- Health Check ---
    const btnRefreshDiag = document.getElementById('btnRefreshDiag');
    function setStatus(id, isHealthy) {
        const el = document.getElementById(id);
        el.className = 'status-badge ' + (isHealthy ? 'status-healthy' : 'status-error');
        el.querySelector('.text').textContent = isHealthy ? 'Perfect' : 'Action Needed';
    }

    async function runDiagnostics() {
        btnRefreshDiag.textContent = 'Scanning...';
        try {
            const res = await fetch('/api/diagnostics', { headers: authHeaders });
            if (res.status === 401) return promptForKey();
            const data = await res.json();
            setStatus('statusSynergy', data.synergy);
            setStatus('statusConstraints', data.constraints);
            setStatus('statusCache', data.cache);
            btnRefreshDiag.textContent = 'Re-Scan System';
        } catch (err) {
            btnRefreshDiag.textContent = 'Scan Failed';
        }
    }

    btnRefreshDiag.addEventListener('click', runDiagnostics);

    // --- Update App ---
    const btnRunPipeline = document.getElementById('btnRunPipeline');
    const terminalOutput = document.getElementById('terminalOutput');

    btnRunPipeline.addEventListener('click', () => {
        btnRunPipeline.disabled = true;
        btnRunPipeline.textContent = 'Pipeline Running...';
        terminalOutput.innerHTML = '';
        
        // Use authorization via query param for EventSource as it doesn't support headers
        const evtSource = new EventSource(`/api/pipeline?key=${encodeURIComponent(adminKey)}`);
        evtSource.onmessage = (e) => {
            const line = document.createElement('div');
            line.className = 'log-line';
            line.textContent = e.data.replace('Done', '✅ Finished').replace('-->', '➡️');
            terminalOutput.appendChild(line);
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
            const isComplete = /pipeline execution complete|verification complete/i.test(e.data);
            const isFailed = /pipeline failed|aborted|error/i.test(e.data);
            if (isComplete || isFailed) {
                evtSource.close();
                btnRunPipeline.disabled = false;
                btnRunPipeline.textContent = 'Refresh Everything Now';
                loadHeroes();
            }
        };

        evtSource.onerror = (e) => {
            console.error('Pipeline EventSource error:', e);
            evtSource.close();
            btnRunPipeline.disabled = false;
            btnRunPipeline.textContent = 'Refresh Everything Now';
        };
    });

    // --- Hero Manager Section ---
    const heroSearch = document.getElementById('heroSearch');
    const heroList = document.getElementById('heroList');
    const heroEditorModal = document.getElementById('heroEditorModal');
    const editorHeroName = document.getElementById('editorHeroName');
    const editTier = document.getElementById('editTier');
    const editGold = document.getElementById('editGold');
    const editBuff = document.getElementById('editBuff');
    const editDamage = document.getElementById('editDamage');
    const btnCancelEdit = document.getElementById('btnCancelEdit');
    const btnSaveHero = document.getElementById('btnSaveHero');

    let allHeroes = [];
    let editingHeroName = null;

    async function loadHeroes() {
        try {
            const res = await fetch('/api/heroes', { headers: authHeaders });
            if (res.status === 401) return promptForKey();
            allHeroes = await res.json();
            renderHeroes();
        } catch (err) {
            console.error('Failed to load heroes:', err);
        }
    }

    function renderHeroes() {
        const query = (heroSearch.value || '').toLowerCase();
        const filtered = allHeroes.filter(h => h.name.toLowerCase().includes(query));
        
        heroList.innerHTML = filtered.map(hero => `
            <div class="hero-item" data-name="${hero.name}">
                <div class="hero-info">
                    <span class="hero-name">${hero.name}</span>
                    <span class="hero-meta-tag tier-${hero.tier.toLowerCase()}">Tier ${hero.tier}</span>
                </div>
                <button class="btn btn-edit-hero" onclick="openHeroEditor('${hero.name}')">Edit</button>
            </div>
        `).join('');
    }

    window.openHeroEditor = (name) => {
        const hero = allHeroes.find(h => h.name === name);
        if (!hero) return;

        editingHeroName = name;
        editorHeroName.textContent = `Edit Metadata: ${name}`;
        editTier.value = hero.tier || 'B';
        editGold.value = hero.goldReliance || 5;
        editBuff.value = hero.buffDependency || 'None';
        editDamage.value = hero.primaryDamageType || 'Physical';
        
        heroEditorModal.style.display = 'flex';
    };

    btnCancelEdit.addEventListener('click', () => {
        heroEditorModal.style.display = 'none';
        editingHeroName = null;
    });

    btnSaveHero.addEventListener('click', async () => {
        if (!editingHeroName) return;

        const payload = {
            tier: editTier.value,
            gold_reliance: parseInt(editGold.value),
            buff_dependency: editBuff.value,
            primary_damage_type: editDamage.value
        };

        btnSaveHero.textContent = 'Saving...';
        try {
            const res = await fetch(`/api/heroes/${encodeURIComponent(editingHeroName)}`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(payload)
            });
            
            if (res.status === 401) return promptForKey();
            
            if (res.ok) {
                const heroIdx = allHeroes.findIndex(h => h.name === editingHeroName);
                if (heroIdx !== -1) {
                    allHeroes[heroIdx] = { ...allHeroes[heroIdx], ...payload };
                }
                renderHeroes();
                heroEditorModal.style.display = 'none';
            }
        } catch (err) {
            alert('Failed to save hero metadata');
        } finally {
            btnSaveHero.textContent = 'Save Changes';
        }
    });

    heroSearch.addEventListener('input', renderHeroes);

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('df_admin_key');
        window.location.reload();
    });

    loadSchemas();
    runDiagnostics();
    loadHeroes();
});
