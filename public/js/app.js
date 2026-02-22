// ARBITRAGGIO PRO - Client Completo

// Configurazione WebSocket
const WS_URL = window.location.protocol === 'https:' 
    ? `wss://${window.location.host}` 
    : `ws://${window.location.host}`;

// Stato applicazione
const State = {
    ws: null,
    id: null,
    name: '',
    connected: false,
    data: null,
    calc: null,
    soundEnabled: true
};

// ========== LOGIN A 2 STEP ==========

let tempName = '';

function goToStep2() {
    tempName = document.getElementById('loginName').value.trim();
    if (!tempName) {
        document.getElementById('loginError').textContent = 'Inserisci il tuo nome';
        return;
    }
    document.getElementById('loginStep1').style.display = 'none';
    document.getElementById('loginStep2').style.display = 'block';
}

function backToStep1() {
    document.getElementById('loginStep2').style.display = 'none';
    document.getElementById('loginStep1').style.display = 'block';
}

function chooseRole(role) {
    State.name = tempName;
    State.ws = new WebSocket(WS_URL);
    
    State.ws.onopen = () => {
        State.connected = true;
        document.getElementById('connStatus').classList.add('on');
        
        State.ws.send(JSON.stringify({
            type: 'CHOOSE_ROLE',
            role: role,
            name: tempName
        }));
    };
    
    State.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };
    
    State.ws.onclose = () => {
        State.connected = false;
        document.getElementById('connStatus').classList.remove('on');
    };
    
    State.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        document.getElementById('loginError').textContent = 'Errore di connessione al server';
    };
}

// ========== GESTIONE MESSAGGI SERVER ==========

function handleMessage(data) {
    switch(data.type) {
        case 'INIT_STATE':
            State.id = data.playerId;
            State.data = data.state;
            enterApp();
            break;
            
        case 'PLAYER_CONNECTED':
            notify(`${data.playerName} si è connesso`, 'success');
            break;
            
        case 'PLAYER_DISCONNECTED':
            notify(`Giocatore ${data.playerId} disconnesso`, 'warning');
            break;
            
        case 'NEW_MESSAGE':
            addChatMessage(data.message);
            break;
            
        case 'APPROVAL_REQUIRED':
            addApproval(data.approval);
            notify('Nuova richiesta da approvare!', 'warning');
            break;
            
        case 'APPROVAL_RESULT':
            removeApproval(data.approvalId);
            notify(data.result === 'approved' ? 'Approvato!' : 'Rifiutato', data.result === 'approved' ? 'success' : 'error');
            break;
            
        case 'BALANCE_UPDATED':
            State.data.players[data.playerId].balance = data.newBalance;
            refreshDashboard();
            notify('Saldo aggiornato', 'success');
            break;
            
        case 'BET_EXECUTED':
            State.data.players = data.players;
            State.data.operations.push(data.bet);
            State.data.bookmakerStats = data.bookmakerStats || {};
            refreshDashboard();
            renderHistory();
            notify('Operazione eseguita!', 'success');
            break;
            
        case 'SETTLEMENT_EXECUTED':
            State.data.players.A.balance = data.newBalances.A;
            State.data.players.B.balance = data.newBalances.B;
            refreshDashboard();
            notify('Pagamento confermato!', 'success');
            document.getElementById('settleBox').style.display = 'none';
            break;
            
        case 'BOOKMAKERS_UPDATED':
            State.data.bookmakers = data.bookmakers;
            renderBookmakers();
            break;
            
        case 'DATA_IMPORTED':
            State.data = data.state;
            refreshAll();
            notify('Dati importati!', 'success');
            break;
            
        case 'ERROR':
            notify(data.message, 'error');
            break;
    }
}

// ========== ENTRA NELL'APP ==========

function enterApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'grid';
    
    const badgeText = State.id === 'OBSERVER' ? 'Osservatore' : `Giocatore ${State.id}`;
    document.getElementById('playerBadge').textContent = badgeText;
    
    if (State.data.players.A) {
        document.getElementById('nameA').textContent = State.data.players.A.name;
        updatePlayerStatus('A', State.data.players.A.connected);
    }
    if (State.data.players.B) {
        document.getElementById('nameB').textContent = State.data.players.B.name;
        updatePlayerStatus('B', State.data.players.B.connected);
    }
    
    refreshAll();
}

function updatePlayerStatus(id, connected, name) {
    const el = document.getElementById('status' + id);
    if (el) {
        el.textContent = connected ? '🟢 Online' : '⚫ Offline';
        el.style.color = connected ? 'var(--primary)' : 'var(--text-muted)';
    }
    if (name && State.data.players[id]) {
        State.data.players[id].name = name;
        document.getElementById('name' + id).textContent = name;
    }
}

function refreshAll() {
    refreshDashboard();
    renderHistory();
    renderApprovals();
    renderBookmakers();
    renderBookmakerStats();
}

// ========== DASHBOARD ==========

function refreshDashboard() {
    const a = State.data.players.A;
    const b = State.data.players.B;
    
    document.getElementById('balA').textContent = fmt(a.balance);
    document.getElementById('invA').textContent = fmt(a.invested);
    document.getElementById('wonA').textContent = fmt(a.won);
    const profA = a.won - a.invested;
    document.getElementById('profA').textContent = (profA >= 0 ? '+' : '') + fmt(profA);
    document.getElementById('profA').className = profA >= 0 ? 'pos' : 'neg';
    
    document.getElementById('balB').textContent = fmt(b.balance);
    document.getElementById('invB').textContent = fmt(b.invested);
    document.getElementById('wonB').textContent = fmt(b.won);
    const profB = b.won - b.invested;
    document.getElementById('profB').textContent = (profB >= 0 ? '+' : '') + fmt(profB);
    document.getElementById('profB').className = profB >= 0 ? 'pos' : 'neg';
}

function fmt(n) {
    return '€' + Math.abs(n || 0).toFixed(2);
}

// ========== SETTLEMENT ==========

function calculateSettlement() {
    const a = State.data.players.A.balance;
    const b = State.data.players.B.balance;
    const diff = a - (a + b) / 2;
    
    const box = document.getElementById('settleBox');
    const txt = document.getElementById('settleText');
    const amt = document.getElementById('settleAmount');
    
    box.style.display = 'block';
    
    if (Math.abs(diff) < 0.01) {
        txt.innerHTML = '<b style="color:var(--primary)">✅ Conti in pari!</b>';
        amt.style.display = 'none';
        box.querySelector('.btn') ? box.querySelector('.btn').style.display = 'none' : null;
    } else {
        const from = diff > 0 ? 'B' : 'A';
        const to = diff > 0 ? 'A' : 'B';
        txt.innerHTML = `Giocatore <b>${from}</b> deve dare a <b>${to}</b>:`;
        amt.textContent = fmt(Math.abs(diff));
        amt.style.display = 'block';
        if (box.querySelector('.btn')) box.querySelector('.btn').style.display = 'inline-block';
    }
}

function confirmSettlement() {
    State.ws.send(JSON.stringify({ type: 'CONFIRM_SETTLEMENT' }));
}

// ========== CALCOLATORE ==========

let numBets = 2;

function setBetCount(n) {
    numBets = n;
    document.querySelectorAll('.btn-toggle').forEach((b, i) => {
        b.classList.toggle('active', i === (n === 2 ? 0 : 1));
    });
    renderBetInputs();
}

function renderBetInputs() {
    const c = document.getElementById('betInputs');
    if (!c) return;
    c.innerHTML = '';
    for (let i = 0; i < numBets; i++) {
        c.innerHTML += `
            <div class="bet-input-row">
                <input type="text" placeholder="Esito ${i+1}" id="n${i}">
                <input type="number" placeholder="Quota" step="0.01" id="q${i}">
            </div>
        `;
    }
}

function updateSplitMode() {
    const m = document.getElementById('splitMode');
    if (!m) return;
    const customBox = document.getElementById('customSplitBox');
    if (customBox) {
        customBox.style.display = m.value === 'custom' ? 'block' : 'none';
    }
}

function calculate() {
    const total = parseFloat(document.getElementById('calcTotal').value) || 0;
    if (!total) return notify('Inserisci capitale', 'error');
    
    const quotes = [];
    for (let i = 0; i < numBets; i++) {
        const q = parseFloat(document.getElementById(`q${i}`).value);
        if (!q) return notify(`Quota mancante esito ${i+1}`, 'error');
        quotes.push(q);
    }
    
    const stakes = quotes.map(q => total / q);
    const totStake = stakes.reduce((a, b) => a + b, 0);
    const returns = stakes.map((s, i) => s * quotes[i]);
    const profit = returns[0] - totStake;
    const roi = (profit / totStake) * 100;
    
    const mode = document.getElementById('splitMode').value;
    let splitA = 0.5;
    if (mode === 'proportional') {
        const balA = State.data.players.A.balance || 1;
        const balB = State.data.players.B.balance || 1;
        splitA = balA / (balA + balB);
    } else if (mode === 'custom') {
        const customInput = document.querySelector('#customSplitBox input');
        if (customInput) splitA = parseInt(customInput.value) / 100;
    }
    
    State.calc = {
        investA: totStake * splitA,
        investB: totStake * (1 - splitA),
        returnA: returns[0] * splitA,
        returnB: returns[0] * (1 - splitA),
        profitA: profit * splitA,
        profitB: profit * (1 - splitA),
        ratioA: returns[0] / (totStake * splitA)
    };
    
    document.getElementById('resA').innerHTML = `
        <h4>🟢 Giocatore A</h4>
        <div>Punta: <b>${fmt(State.calc.investA)}</b></div>
        <div>Rientra: ${fmt(State.calc.returnA)}</div>
        <div style="color:var(--primary);margin-top:10px"><b>Profitto: ${fmt(State.calc.profitA)}</b></div>
    `;
    
    document.getElementById('resB').innerHTML = `
        <h4>🔵 Giocatore B</h4>
        <div>Punta: <b>${fmt(State.calc.investB)}</b></div>
        <div>Rientra: ${fmt(State.calc.returnB)}</div>
        <div style="color:var(--primary);margin-top:10px"><b>Profitto: ${fmt(State.calc.profitB)}</b></div>
    `;
    
    document.getElementById('totProfit').textContent = fmt(profit);
    document.getElementById('totRoi').textContent = roi.toFixed(2) + '%';
    
    const btnSave = document.getElementById('btnSaveCalc');
    if (btnSave) btnSave.disabled = false;
    
    const btnAnti = document.getElementById('btnAntiSgamo');
    if (btnAnti) btnAnti.style.display = 'block';
    
    const textAnti = document.getElementById('textAntiSgamo');
    if (textAnti) textAnti.style.display = 'block';
}

function applyAntiSgamo() {
    if (!State.calc) return;
    
    const origA = State.calc.investA;
    const origB = State.calc.investB;
    
    const roundA = Math.round(origA / 10) * 10;
    const roundB = Math.round(origB / 10) * 10;
    
    State.calc.investA = roundA;
    State.calc.investB = roundB;
    State.calc.returnA = roundA * State.calc.ratioA;
    State.calc.returnB = roundB * State.calc.ratioA;
    State.calc.profitA = State.calc.returnA - roundA;
    State.calc.profitB = State.calc.returnB - roundB;
    
    document.getElementById('resA').innerHTML = `
        <h4>🟢 Giocatore A 🎭</h4>
        <div>Punta: <s style="opacity:0.5">${fmt(origA)}</s> → <b style="color:var(--warning)">${fmt(roundA)}</b></div>
        <div>Rientra: ${fmt(State.calc.returnA)}</div>
        <div style="color:var(--primary);margin-top:10px"><b>Profitto: ${fmt(State.calc.profitA)}</b></div>
    `;
    document.getElementById('resB').innerHTML = `
        <h4>🔵 Giocatore B 🎭</h4>
        <div>Punta: <s style="opacity:0.5">${fmt(origB)}</s> → <b style="color:var(--warning)">${fmt(roundB)}</b></div>
        <div>Rientra: ${fmt(State.calc.returnB)}</div>
        <div style="color:var(--primary);margin-top:10px"><b>Profitto: ${fmt(State.calc.profitB)}</b></div>
    `;
    
    notify(`🎭 Anti-Sgamo: ${fmt(origA)}→${fmt(roundA)}, ${fmt(origB)}→${fmt(roundB)}`, 'success');
}

function saveCalculation() {
    if (!State.calc || State.id === 'OBSERVER') return;
    
    State.ws.send(JSON.stringify({
        type: 'REQUEST_BET',
        betData: {
            ...State.calc,
            description: 'Calcolatore',
            bookmakerA: null,
            bookmakerB: null
        }
    }));
    notify('Richiesta inviata', 'success');
}

// ========== BOOKMAKERS ==========

function renderBookmakers() {
    const list = document.getElementById('bmList');
    if (!list) return;
    
    const bms = State.data.bookmakers || [];
    list.innerHTML = bms.map(bm => `
        <div class="bm-item">
            <h4>${bm.name}</h4>
            <p style="color:var(--text-muted);font-size:0.85rem">ID: ${bm.id}</p>
        </div>
    `).join('');
}

function renderBookmakerStats() {
    const grid = document.getElementById('bmStats');
    if (!grid) return;
    
    const stats = State.data.bookmakerStats || {};
    const bms = State.data.bookmakers || [];
    
    if (!Object.keys(stats).length) {
        grid.innerHTML = '<p style="color:var(--text-muted)">Nessuna statistica disponibile</p>';
        return;
    }
    
    grid.innerHTML = bms.filter(bm => stats[bm.id]).map(bm => {
        const s = stats[bm.id];
        const profA = (s.A?.won || 0) - (s.A?.invested || 0);
        const profB = (s.B?.won || 0) - (s.B?.invested || 0);
        
        return `
            <div class="bm-stat-card">
                <h4>${bm.name}</h4>
                <div class="bm-stat-row">
                    <span>A - Investito:</span>
                    <b>${fmt(s.A?.invested || 0)}</b>
                </div>
                <div class="bm-stat-row">
                    <span>A - Vinto:</span>
                    <b>${fmt(s.A?.won || 0)}</b>
                </div>
                <div class="bm-stat-row">
                    <span>A - Profitto:</span>
                    <b class="${profA >= 0 ? 'pos' : 'neg'}">${fmt(profA)}</b>
                </div>
                <hr style="border-color:var(--border);margin:10px 0">
                <div class="bm-stat-row">
                    <span>B - Investito:</span>
                    <b>${fmt(s.B?.invested || 0)}</b>
                </div>
                <div class="bm-stat-row">
                    <span>B - Vinto:</span>
                    <b>${fmt(s.B?.won || 0)}</b>
                </div>
                <div class="bm-stat-row">
                    <span>B - Profitto:</span>
                    <b class="${profB >= 0 ? 'pos' : 'neg'}">${fmt(profB)}</b>
                </div>
            </div>
        `;
    }).join('');
}

function addBookmaker() {
    const name = prompt('Nome bookmaker:');
    if (!name) return;
    
    State.ws.send(JSON.stringify({
        type: 'ADD_BOOKMAKER',
        name: name
    }));
    notify('Bookmaker aggiunto', 'success');
}

// ========== HISTORY ==========

function renderHistory() {
    const tb = document.getElementById('histBody');
    if (!tb) return;
    
    const ops = State.data.operations || [];
    if (!ops.length) {
        tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">Nessuna operazione</td></tr>';
        return;
    }
    
    tb.innerHTML = ops.slice().reverse().map(o => `
        <tr>
            <td>${new Date(o.timestamp).toLocaleString()}</td>
            <td>${o.description || 'Bet'}</td>
            <td>${o.bookmakerA || '-'}</td>
            <td>${o.bookmakerB || '-'}</td>
            <td>${fmt(o.investA)}</td>
            <td>${fmt(o.investB)}</td>
            <td class="${o.profitA >= 0 ? 'pos' : 'neg'}">${fmt(o.profitA)}</td>
            <td class="${o.profitB >= 0 ? 'pos' : 'neg'}">${fmt(o.profitB)}</td>
            <td class="${(o.profitA + o.profitB) >= 0 ? 'pos' : 'neg'}">${fmt(o.profitA + o.profitB)}</td>
        </tr>
    `).join('');
}

// ========== APPROVALS ==========

function addApproval(appr) {
    if (!State.data.pendingApprovals) State.data.pendingApprovals = [];
    State.data.pendingApprovals.push(appr);
    renderApprovals();
    
    const badge = document.getElementById('badgeApp');
    const pending = State.data.pendingApprovals.filter(a => !a.status).length;
    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending ? 'block' : 'none';
    }
}

function removeApproval(id) {
    State.data.pendingApprovals = State.data.pendingApprovals.filter(a => a.id !== id);
    renderApprovals();
    
    const pending = State.data.pendingApprovals.filter(a => !a.status).length;
    const badge = document.getElementById('badgeApp');
    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending ? 'block' : 'none';
    }
}

function renderApprovals() {
    const list = document.getElementById('listApprovals');
    if (!list) return;
    
    const pending = (State.data.pendingApprovals || []).filter(a => !a.status);
    
    if (!pending.length) {
        list.innerHTML = '<p class="empty">Nessuna richiesta</p>';
        return;
    }
    
    list.innerHTML = pending.map(a => {
        const mine = a.requestedBy === State.id;
        const canAct = !mine && State.id !== 'OBSERVER';
        const info = a.type === 'BALANCE_UPDATE' 
            ? `${a.targetPlayer}: ${a.amount > 0 ? '+' : ''}${fmt(a.amount)}`
            : `Profitto: ${fmt((a.data?.profitA || 0) + (a.data?.profitB || 0))}`;
        
        return `
            <div class="approval-item">
                <h5>${a.type === 'BALANCE_UPDATE' ? '💰 Modifica Saldo' : '🎲 Nuova Bet'}</h5>
                <p>Da: Giocatore ${a.requestedBy}<br>${info}</p>
                ${canAct ? `
                    <div class="approval-actions">
                        <button class="btn btn-primary" onclick="respondApproval('${a.id}', true)">✅ Approva</button>
                        <button class="btn btn-secondary" onclick="respondApproval('${a.id}', false)">❌ Rifiuta</button>
                    </div>
                ` : '<p style="color:var(--text-muted)">In attesa...</p>'}
            </div>
        `;
    }).join('');
}

function respondApproval(id, approve) {
    State.ws.send(JSON.stringify({
        type: approve ? 'APPROVE' : 'REJECT',
        approvalId: id
    }));
}

// ========== CHAT ==========

function sendChat() {
    const inp = document.getElementById('chatInput');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || !State.connected) return;
    
    State.ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', text }));
    inp.value = '';
}

function addChatMessage(msg) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (msg.playerId === State.id ? 'mine' : 'other');
    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    div.innerHTML = `
        ${escapeHtml(msg.text)}
        <span class="meta">${msg.playerName} • ${time}</span>
    `;
    container.appendChild(div);
    div.scrollIntoView();
}

function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

// ========== MODAL ==========

function openModal(type) {
    if (State.id === 'OBSERVER') return notify('Sola lettura', 'error');
    
    const m = document.getElementById('modal');
    const t = document.getElementById('modalTitle');
    const b = document.getElementById('modalBody');
    if (!m || !t || !b) return;
    
    m.style.display = 'flex';
    
    if (type === 'funds') {
        t.textContent = '💰 Aggiungi Fondi';
        b.innerHTML = `
            <div class="form-group">
                <label>Giocatore</label>
                <select id="mPlayer"><option value="A">A</option><option value="B">B</option></select>
            </div>
            <div class="form-group">
                <label>Importo €</label>
                <input type="number" id="mAmount" placeholder="100" step="0.01">
            </div>
        `;
        window.confirmModal = () => {
            const amt = parseFloat(document.getElementById('mAmount').value) || 0;
            if (!amt) return notify('Inserisci importo', 'error');
            State.ws.send(JSON.stringify({
                type: 'REQUEST_BALANCE_UPDATE',
                targetPlayer: document.getElementById('mPlayer').value,
                amount: amt
            }));
            closeModal();
            notify('Richiesta inviata', 'success');
        };
        
    } else if (type === 'bet') {
        const bms = State.data.bookmakers.map(bm => `<option value="${bm.id}">${bm.name}</option>`).join('');
        
        t.textContent = '🎲 Nuova Scommessa';
        b.innerHTML = `
            <div class="form-group">
                <label>Evento</label>
                <input type="text" id="mEvent" placeholder="Es: Milan-Inter">
            </div>
            <div class="form-group">
                <label>Bookmaker A</label>
                <select id="mBookA">${bms}</select>
            </div>
            <div class="form-group">
                <label>Bookmaker B</label>
                <select id="mBookB">${bms}</select>
            </div>
            <div class="form-group">
                <label>Investimento Totale €</label>
                <input type="number" id="mInvest" placeholder="100" step="0.01">
            </div>
            <div class="form-group">
                <label>Vincita Totale €</label>
                <input type="number" id="mWin" placeholder="105" step="0.01">
            </div>
        `;
        window.confirmModal = () => {
            const inv = parseFloat(document.getElementById('mInvest').value) || 0;
            const win = parseFloat(document.getElementById('mWin').value) || 0;
            if (!inv || !win) return notify('Inserisci tutti i valori', 'error');
            
            const profit = win - inv;
            
            State.ws.send(JSON.stringify({
                type: 'REQUEST_BET',
                betData: {
                    description: document.getElementById('mEvent').value || 'Scommessa',
                    bookmakerA: document.getElementById('mBookA').value,
                    bookmakerB: document.getElementById('mBookB').value,
                    investA: inv * 0.5,
                    investB: inv * 0.5,
                    returnA: win * 0.5,
                    returnB: win * 0.5,
                    profitA: profit * 0.5,
                    profitB: profit * 0.5
                }
            }));
            closeModal();
            notify('Richiesta inviata', 'success');
        };
    }
}

function closeModal() {
    const m = document.getElementById('modal');
    if (m) m.style.display = 'none';
}

// ========== EXPORT/IMPORT ==========

function exportData() {
    fetch('/api/export')
        .then(r => r.json())
        .then(data => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `arbitraggio-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            notify('Dati esportati!', 'success');
        });
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    notify('Dati importati! Ricarico...', 'success');
                    setTimeout(() => location.reload(), 1500);
                }
            });
        } catch (err) {
            notify('File non valido', 'error');
        }
    };
    reader.readAsText(file);
}

function importOnLogin(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            localStorage.setItem('pendingImport', JSON.stringify(data));
            notify('✅ File caricato! Scegli il ruolo', 'success');
        } catch (err) {
            notify('❌ File non valido', 'error');
        }
    };
    reader.readAsText(file);
}

// ========== SETTINGS ==========

function setTheme(color) {
    const colors = {
        green: '#00ff88',
        blue: '#00d9ff',
        red: '#ff4757',
        purple: '#a55eea',
        orange: '#ffa502'
    };
    
    document.documentElement.style.setProperty('--primary', colors[color]);
    
    document.querySelectorAll('.color-opt').forEach(el => {
        el.classList.toggle('active', el.dataset.theme === color);
    });
    
    State.ws.send(JSON.stringify({
        type: 'UPDATE_SETTINGS',
        settings: { theme: color }
    }));
}

function saveProfile() {
    const name = document.getElementById('settName');
    if (name && name.value.trim()) {
        State.ws.send(JSON.stringify({
            type: 'UPDATE_SETTINGS',
            settings: { name: name.value.trim() }
        }));
        notify('Profilo aggiornato', 'success');
    }
}

// ========== NAVIGATION ==========

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    
    if (id === 'bookmakers') {
        renderBookmakers();
        renderBookmakerStats();
    }
}

function showPanel(id) {
    document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById('panel-' + id);
    if (target) target.classList.add('active');
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
}

function togglePanel() {
    const panel = document.getElementById('rPanel');
    if (panel) panel.classList.toggle('open');
}

function toggleSound() {
    State.soundEnabled = !State.soundEnabled;
    const btn = document.getElementById('soundBtn');
    if (btn) btn.textContent = State.soundEnabled ? '🔊' : '🔇';
}

// ========== NOTIFICATIONS ==========

function notify(msg, type) {
    const div = document.createElement('div');
    div.className = 'notification ' + type;
    const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅';
    div.innerHTML = `<b>${icon}</b> ${msg}`;
    const container = document.getElementById('notifications');
    if (container) {
        container.appendChild(div);
        setTimeout(() => div.remove(), 5000);
    }
}

// ========== INIT ==========

document.addEventListener('DOMContentLoaded', () => {
    renderBetInputs();
});
