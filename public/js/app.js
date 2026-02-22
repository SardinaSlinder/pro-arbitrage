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
    
    // Controlla ruoli (simulato, in realtà li controlliamo dopo)
    updateRoleButtons({ A: false, B: false });
}

function backToStep1() {
    document.getElementById('loginStep2').style.display = 'none';
    document.getElementById('loginStep1').style.display = 'block';
}

function updateRoleButtons(occupied) {
    const btnA = document.getElementById('btnA');
    const btnB = document.getElementById('btnB');
    const statusA = document.getElementById('statusA');
    const statusB = document.getElementById('statusB');
    
    // Per ora assumiamo entrambi liberi, poi il server ci dirà
    btnA.disabled = false;
    btnB.disabled = false;
    statusA.textContent = 'Libero';
    statusB.textContent = 'Libero';
    statusA.className = 'role-status';
    statusB.className = 'role-status';
}

function chooseRole(role) {
    State.name = tempName;
    
    // Connessione WebSocket
    State.ws = new WebSocket(WS_URL);
    
    State.ws.onopen = () => {
        State.connected = true;
        document.getElementById('connStatus').classList.add('on');
        
        // Invia scelta ruolo
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
        // Non ricollegare automaticamente per evitare loop
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
            showNotification(`${data.playerName} si è connesso`, 'success');
            break;
            
        case 'PLAYER_DISCONNECTED':
            showNotification(`Giocatore ${data.playerId} disconnesso`, 'warning');
            break;
            
        case 'NEW_MESSAGE':
            addChatMessage(data.message);
            break;
            
        case 'APPROVAL_REQUIRED':
            addApproval(data.approval);
            showNotification('Nuova richiesta da approvare!', 'warning');
            break;
            
        case 'APPROVAL_RESULT':
            handleApprovalResult(data);
            break;
            
        case 'BALANCE_UPDATED':
            updateBalance(data.playerId, data.newBalance);
            showNotification('Saldo aggiornato', 'success');
            break;
            
        case 'BET_EXECUTED':
            State.data.players = data.players;
            State.data.operations.push(data.bet);
            refreshDashboard();
            showNotification('Operazione eseguita!', 'success');
            break;
            
        case 'SETTLEMENT_EXECUTED':
            State.data.players.A.balance = data.newBalances.A;
            State.data.players.B.balance = data.newBalances.B;
            refreshDashboard();
            showNotification('Pagamento confermato!', 'success');
            document.getElementById('settleBox').style.display = 'none';
            break;
            
        case 'DATA_IMPORTED':
            State.data = data.state;
            refreshDashboard();
            showNotification('Dati importati! Ricarica per vedere tutto', 'success');
            break;
            
        case 'BOOKMAKERS_UPDATED':
            State.data.bookmakers = data.bookmakers;
            break;
            
        case 'ERROR':
            showNotification(data.message, 'error');
            break;
    }
}

// ========== ENTRA NELL'APP ==========

function enterApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'grid';
    
    // Imposta badge
    const badgeText = State.id === 'OBSERVER' ? 'Osservatore' : `Giocatore ${State.id}`;
    document.getElementById('playerBadge').textContent = badgeText;
    
    // Imposta nomi
    if (State.data.players.A) {
        document.getElementById('nameA').textContent = State.data.players.A.name;
    }
    if (State.data.players.B) {
        document.getElementById('nameB').textContent = State.data.players.B.name;
    }
    
    // Inizializza
    refreshDashboard();
    renderHistory();
    renderApprovals();
    initChat();
}

// ========== DASHBOARD ==========

function refreshDashboard() {
    const a = State.data.players.A;
    const b = State.data.players.B;
    
    // Giocatore A
    document.getElementById('balA').textContent = formatMoney(a.balance);
    document.getElementById('invA').textContent = formatMoney(a.invested);
    document.getElementById('wonA').textContent = formatMoney(a.won);
    const profA = a.won - a.invested;
    document.getElementById('profA').textContent = (profA >= 0 ? '+' : '') + formatMoney(profA);
    document.getElementById('profA').className = profA >= 0 ? 'pos' : 'neg';
    document.getElementById('statusA').textContent = a.connected ? '🟢 Online' : '⚫ Offline';
    
    // Giocatore B
    document.getElementById('balB').textContent = formatMoney(b.balance);
    document.getElementById('invB').textContent = formatMoney(b.invested);
    document.getElementById('wonB').textContent = formatMoney(b.won);
    const profB = b.won - b.invested;
    document.getElementById('profB').textContent = (profB >= 0 ? '+' : '') + formatMoney(profB);
    document.getElementById('profB').className = profB >= 0 ? 'pos' : 'neg';
    document.getElementById('statusB').textContent = b.connected ? '🟢 Online' : '⚫ Offline';
    
    // Ultimo aggiornamento
    const now = new Date();
    document.getElementById('lastUpdate').textContent = now.toLocaleTimeString();
}

function formatMoney(amount) {
    return '€' + Math.abs(amount || 0).toFixed(2);
}

function updateBalance(playerId, newBalance) {
    State.data.players[playerId].balance = newBalance;
    refreshDashboard();
}

// ========== SETTLEMENT ==========

function settlement() {
    const a = State.data.players.A.balance;
    const b = State.data.players.B.balance;
    const total = a + b;
    const half = total / 2;
    const diff = a - half;
    
    const box = document.getElementById('settleBox');
    const text = document.getElementById('settleText');
    const amt = document.getElementById('settleAmount');
    
    box.style.display = 'block';
    
    if (Math.abs(diff) < 0.01) {
        text.innerHTML = '<b style="color:var(--p)">✅ I conti sono in pari!</b>';
        amt.style.display = 'none';
        box.querySelector('.btn').style.display = 'none';
    } else {
        const from = diff > 0 ? 'B' : 'A';
        const to = diff > 0 ? 'A' : 'B';
        text.innerHTML = `Giocatore <b>${from}</b> deve dare a <b>${to}</b>:`;
        amt.textContent = formatMoney(Math.abs(diff));
        amt.style.display = 'block';
        box.querySelector('.btn').style.display = 'inline-flex';
    }
}

function confirmSettle() {
    if (State.ws && State.connected) {
        State.ws.send(JSON.stringify({ type: 'CONFIRM_SETTLEMENT' }));
    }
}

// ========== CALCOLATORE ==========

let numBets = 2;

function setBets(n) {
    numBets = n;
    document.querySelectorAll('.r-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === (n === 2 ? 0 : 1));
    });
    renderBetInputs();
}

function renderBetInputs() {
    const container = document.getElementById('betsContainer');
    container.innerHTML = '';
    
    for (let i = 0; i < numBets; i++) {
        const div = document.createElement('div');
        div.className = 'bet-row';
        div.innerHTML = `
            <input type="text" placeholder="Esito ${i+1}" id="n${i}">
            <input type="number" placeholder="Quota" step="0.01" id="q${i}">
        `;
        container.appendChild(div);
    }
}

function splitChange() {
    const mode = document.getElementById('splitMode').value;
    document.getElementById('customSplit').style.display = mode === 'custom' ? 'block' : 'none';
}

function calculate() {
    const total = parseFloat(document.getElementById('capTotal').value) || 0;
    if (!total) {
        showNotification('Inserisci il capitale totale', 'error');
        return;
    }
    
    // Raccogli quote
    const quotes = [];
    for (let i = 0; i < numBets; i++) {
        const q = parseFloat(document.getElementById(`q${i}`).value);
        if (!q) {
            showNotification(`Inserisci quota esito ${i+1}`, 'error');
            return;
        }
        quotes.push(q);
    }
    
    // Calcolo surebet
    const stakes = quotes.map(q => total / q);
    const totalStake = stakes.reduce((a, b) => a + b, 0);
    const returns = stakes.map((s, i) => s * quotes[i]);
    const profit = returns[0] - totalStake;
    const roi = (profit / totalStake) * 100;
    
    // Divisione
    const mode = document.getElementById('splitMode').value;
    let splitA = 0.5;
    
    if (mode === 'prop') {
        const balA = State.data.players.A.balance || 1;
        const balB = State.data.players.B.balance || 1;
        splitA = balA / (balA + balB);
    } else if (mode === 'custom') {
        splitA = parseInt(document.querySelector('input[type=range]').value) / 100;
    }
    
    const splitB = 1 - splitA;
    
    // Salva calcolo
    State.calc = {
        investA: totalStake * splitA,
        investB: totalStake * splitB,
        returnA: returns[0] * splitA,
        returnB: returns[0] * splitB,
        profitA: profit * splitA,
        profitB: profit * splitB
    };
    
    // Mostra risultati
    document.getElementById('resA').innerHTML = `
        <h4>A</h4>
        <div>Punta: ${formatMoney(State.calc.investA)}</div>
        <div>Rientra: ${formatMoney(State.calc.returnA)}</div>
        <div style="color:var(--p);margin-top:10px"><b>Profitto: ${formatMoney(State.calc.profitA)}</b></div>
    `;
    
    document.getElementById('resB').innerHTML = `
        <h4>B</h4>
        <div>Punta: ${formatMoney(State.calc.investB)}</div>
        <div>Rientra: ${formatMoney(State.calc.returnB)}</div>
        <div style="color:var(--p);margin-top:10px"><b>Profitto: ${formatMoney(State.calc.profitB)}</b></div>
    `;
    
    document.getElementById('totProfit').textContent = formatMoney(profit);
    document.getElementById('totRoi').textContent = roi.toFixed(2) + '%';
    document.getElementById('btnSave').disabled = false;
    
    // Mostra anti-sgamo
    document.getElementById('btnAntiSgamo').style.display = 'block';
    document.getElementById('infoAntiSgamo').style.display = 'block';
}

function saveCalc() {
    if (!State.calc || State.id === 'OBSERVER') {
        showNotification('Non puoi salvare', 'error');
        return;
    }
    
    State.ws.send(JSON.stringify({
        type: 'REQUEST_BET',
        betData: State.calc
    }));
    
    showNotification('Richiesta inviata per approvazione', 'success');
}

// ========== ANTI-SGAMO ==========

function roundAntiSgamo(amount) {
    return Math.round(amount / 10) * 10;
}

function applyAntiSgamo() {
    if (!State.calc) return showNotification('Calcola prima', 'error');
    
    const origA = State.calc.investA;
    const origB = State.calc.investB;
    
    // Arrotonda
    const roundA = roundAntiSgamo(origA);
    const roundB = roundAntiSgamo(origB);
    
    // Ricalcola mantenendo quote
    const ratioA = State.calc.returnA / State.calc.investA;
    const ratioB = State.calc.returnB / State.calc.investB;
    
    State.calc.investA = roundA;
    State.calc.investB = roundB;
    State.calc.returnA = roundA * ratioA;
    State.calc.returnB = roundB * ratioB;
    State.calc.profitA = State.calc.returnA - roundA;
    State.calc.profitB = State.calc.returnB - roundB;
    
    // Aggiorna display
    document.getElementById('resA').innerHTML = `
        <h4>A 🎭</h4>
        <div>Punta: <s>${formatMoney(origA)}</s> → <b>${formatMoney(roundA)}</b></div>
        <div>Rientra: ${formatMoney(State.calc.returnA)}</div>
        <div style="color:var(--p);margin-top:10px"><b>Profitto: ${formatMoney(State.calc.profitA)}</b></div>
    `;
    document.getElementById('resB').innerHTML = `
        <h4>B 🎭</h4>
        <div>Punta: <s>${formatMoney(origB)}</s> → <b>${formatMoney(roundB)}</b></div>
        <div>Rientra: ${formatMoney(State.calc.returnB)}</div>
        <div style="color:var(--p);margin-top:10px"><b>Profitto: ${formatMoney(State.calc.profitB)}</b></div>
    `;
    
    showNotification(`Anti-Sgamo: ${formatMoney(origA)}→${formatMoney(roundA)}, ${formatMoney(origB)}→${formatMoney(roundB)}`, 'success');
}

// ========== MODAL ==========

function modal(type) {
    if (State.id === 'OBSERVER') {
        showNotification('Osservatori non possono operare', 'error');
        return;
    }
    
    const m = document.getElementById('modal');
    const t = document.getElementById('mTitle');
    const b = document.getElementById('mBody');
    m.style.display = 'flex';
    
    if (type === 'funds') {
        t.textContent = '💰 Aggiungi Fondi';
        b.innerHTML = `
            <label>Giocatore</label>
            <select id="mPlayer"><option value="A">A</option><option value="B">B</option></select>
            <label>Importo €</label>
            <input type="number" id="mAmt" placeholder="100" step="0.01">
        `;
        window.mConfirm = () => {
            const amt = parseFloat(document.getElementById('mAmt').value) || 0;
            if (!amt) return showNotification('Inserisci importo', 'error');
            State.ws.send(JSON.stringify({
                type: 'REQUEST_BALANCE_UPDATE',
                targetPlayer: document.getElementById('mPlayer').value,
                amount: amt
            }));
            closeModal();
            showNotification('Richiesta inviata', 'success');
        };
        
    } else if (type === 'bet') {
        t.textContent = '🎲 Nuova Scommessa';
        b.innerHTML = `
            <label>Evento</label>
            <input type="text" id="mDesc" placeholder="Es: Milan-Inter">
            <label>Investimento €</label>
            <input type="number" id="mInv" placeholder="100" step="0.01">
            <label>Vincita €</label>
            <input type="number" id="mWin" placeholder="105" step="0.01">
        `;
        window.mConfirm = () => {
            const inv = parseFloat(document.getElementById('mInv').value) || 0;
            const win = parseFloat(document.getElementById('mWin').value) || 0;
            if (!inv || !win) return showNotification('Inserisci tutti i valori', 'error');
            
            const profit = win - inv;
            
            State.ws.send(JSON.stringify({
                type: 'REQUEST_BET',
                betData: {
                    description: document.getElementById('mDesc').value || 'Scommessa',
                    investA: inv * 0.5,
                    investB: inv * 0.5,
                    returnA: win * 0.5,
                    returnB: win * 0.5,
                    profitA: profit * 0.5,
                    profitB: profit * 0.5
                }
            }));
            closeModal();
            showNotification('Richiesta inviata', 'success');
        };
    }
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// ========== CHAT ==========

function initChat() {
    // Chat già inizializzata dall'HTML
}

function sendChat() {
    const inp = document.getElementById('chatInp');
    const text = inp.value.trim();
    if (!text || !State.connected) return;
    
    State.ws.send(JSON.stringify({
        type: 'CHAT_MESSAGE',
        text: text
    }));
    inp.value = '';
}

function addChatMessage(msg) {
    const div = document.createElement('div');
    div.className = 'msg ' + (msg.playerId === State.id ? 'mine' : 'other');
    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    div.innerHTML = `
        ${escapeHtml(msg.text)}
        <span class="time">${msg.playerName} • ${time}</span>
    `;
    document.getElementById('chatMsgs').appendChild(div);
    div.scrollIntoView();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== APPROVALS ==========

function addApproval(approval) {
    if (!State.data.pendingApprovals) State.data.pendingApprovals = [];
    State.data.pendingApprovals.push(approval);
    renderApprovals();
}

function renderApprovals() {
    const list = document.getElementById('appList');
    const pending = (State.data.pendingApprovals || []).filter(a => a.status === 'pending');
    
    document.getElementById('badApp').textContent = pending.length;
    document.getElementById('badApp').style.display = pending.length ? 'block' : 'none';
    
    if (!pending.length) {
        list.innerHTML = '<div style="color:var(--tm);text-align:center;padding:20px;">Nessuna richiesta</div>';
        return;
    }
    
    list.innerHTML = pending.map(a => {
        const mine = a.requestedBy === State.id;
        const canAct = !mine && State.id !== 'OBSERVER';
        const info = a.type === 'BALANCE_UPDATE' 
            ? `${a.targetPlayer}: ${a.amount > 0 ? '+' : ''}${formatMoney(a.amount)}`
            : `Profitto: ${formatMoney(a.data.profitA + a.data.profitB)}`;
        
        return `
            <div class="app-item">
                <h5>${a.type === 'BALANCE_UPDATE' ? '💰 Saldo' : '🎲 Bet'}</h5>
                <p>Da: Giocatore ${a.requestedBy}<br>${info}</p>
                ${canAct ? `
                    <div class="app-btns">
                        <button class="btn prim" onclick="respApp('${a.id}', true)">✅</button>
                        <button class="btn sec" onclick="respApp('${a.id}', false)">❌</button>
                    </div>
                ` : '<p style="color:var(--tm)">Attesa...</p>'}
            </div>
        `;
    }).join('');
}

function respApp(id, approved) {
    if (!State.connected) return;
    State.ws.send(JSON.stringify({
        type: approved ? 'APPROVE' : 'REJECT',
        approvalId: id
    }));
}

function handleApprovalResult(data) {
    State.data.pendingApprovals = (State.data.pendingApprovals || []).filter(a => a.id !== data.approvalId);
    renderApprovals();
    showNotification(data.result === 'approved' ? 'Approvato!' : 'Rifiutato', data.result === 'approved' ? 'success' : 'error');
}

// ========== EXPORT/IMPORT ==========

function exportFullData() {
    fetch('/api/export')
        .then(r => r.json())
        .then(data => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `arbitraggio-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            showNotification('Dati esportati!', 'success');
        })
        .catch(err => showNotification('Errore: ' + err.message, 'error'));
}

function importFullData(input) {
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
                    showNotification('Dati importati! Ricarico...', 'success');
                    setTimeout(() => location.reload(), 1500);
                }
            });
        } catch (err) {
            showNotification('File non valido', 'error');
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
            showNotification('✅ File caricato! Scegli il ruolo', 'success');
        } catch (err) {
            showNotification('❌ File non valido', 'error');
        }
    };
    reader.readAsText(file);
}

// ========== NAVIGAZIONE ==========

function show(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    event.currentTarget.classList.add('active');
}

function panelTab(id) {
    document.querySelectorAll('.p-sec').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.t-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('p-' + id).classList.add('active');
    event.currentTarget.classList.add('active');
}

function togglePanel() {
    document.getElementById('rPanel').classList.toggle('open');
}

function toggleSound() {
    State.soundEnabled = !State.soundEnabled;
    document.getElementById('soundBtn').textContent = State.soundEnabled ? '🔊' : '🔇';
}

// ========== NOTIFICHE ==========

function showNotification(message, type) {
    const div = document.createElement('div');
    div.className = 'notification ' + type;
    const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅';
    div.innerHTML = `<b>${icon}</b> ${message}`;
    document.getElementById('notifs').appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

// ========== STORICO ==========

function renderHistory() {
    const tb = document.getElementById('histBody');
    const ops = State.data?.operations || [];
    
    if (!ops.length) {
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--tm)">Nessuna operazione</td></tr>';
        return;
    }
    
    tb.innerHTML = ops.slice(-20).reverse().map(o => `
        <tr>
            <td>${new Date(o.timestamp).toLocaleString()}</td>
            <td>${o.type}</td>
            <td>${formatMoney(o.investA)}</td>
            <td>${formatMoney(o.investB)}</td>
            <td class="${o.profitA >= 0 ? 'pos' : 'neg'}">${formatMoney(o.profitA)}</td>
            <td class="${o.profitB >= 0 ? 'pos' : 'neg'}">${formatMoney(o.profitB)}</td>
            <td class="${(o.profitA+o.profitB) >= 0 ? 'pos' : 'neg'}">${formatMoney(o.profitA+o.profitB)}</td>
        </tr>
    `).join('');
}

// ========== INIZIALIZZAZIONE ==========

document.addEventListener('DOMContentLoaded', () => {
    renderBetInputs();
});
