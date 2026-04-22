document.addEventListener('DOMContentLoaded', () => {
    // --- Compatibility Section ---
    const schemaControls = document.getElementById('schemaControls');
    const btnSaveSchemas = document.getElementById('btnSaveSchemas');
    let currentSchemas = [];

    const ALL_VERSIONS = ['1.0.0', '2.0.0'];

    async function loadSchemas() {
        try {
            const res = await fetch('/api/schemas');
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
        
        // Add a helper hint
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
            await fetch('/api/schemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schemas: newSchemas })
            });
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
            const res = await fetch('/api/diagnostics');
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
        btnRunPipeline.textContent = 'Downloading Updates...';
        terminalOutput.innerHTML = '';
        
        const evtSource = new EventSource('/api/pipeline');
        evtSource.onmessage = (e) => {
            const line = document.createElement('div');
            line.className = 'log-line';
            line.textContent = e.data.replace('Done', '✅ Finished').replace('-->', '➡️');
            terminalOutput.appendChild(line);
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
            const isComplete = /pipeline execution complete/i.test(e.data);
            const isFailed = /pipeline failed/i.test(e.data);
            if (isComplete || isFailed) {
                evtSource.close();
                btnRunPipeline.disabled = false;
                btnRunPipeline.textContent = 'Refresh Everything Now';
            }
        };

        evtSource.onerror = () => {
            evtSource.close();
            btnRunPipeline.disabled = false;
            btnRunPipeline.textContent = 'Refresh Everything Now';
        };
    });

    loadSchemas();
    runDiagnostics();
});
