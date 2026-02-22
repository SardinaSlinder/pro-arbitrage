// Configurazione Render - WebSocket automatico
const WS_URL = window.location.protocol === 'https:' 
    ? `wss://${window.location.host}` 
    : `ws://${window.location.host}`;

const State = {
    ws: null,
    id: null,
    name: '',
    data: null,
    calc: null
};

function connect() {
    // Non usiamo più questa, ora usiamo goToStep2() e chooseRole()
    console.log("Usa il nuovo sistema di login a 2 step");
}
    
    State.ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        handle(d);
    };
    
    State.ws.onclose = () => {
        document.getElementById('connStatus').classList.remove('on');
        setTimeout(connect, 3000);
    };
    
    State.ws.onerror = (e) => {
        showLoginErr('Errore connessione');
    };
}

function handle(d) {
    switch(d.type) {
        case 'INIT_STATE':
            State.id = d.playerId;
            State.data = d.state;
            enter();
            break;
        case 'PLAYER_CONNECTED':
            notify(`${d.playerName} connesso`, 'success');
            break;
        case 'PLAYER_DISCONNECTED':
            notify(`${d.playerId} disconnesso`, 'warn');
            break;
        case 'NEW_MESSAGE':
            addMsg(d.message);
            break;
        case 'APPROVAL_REQUIRED':
            addApproval(d.approval);
            notify('Nuova richiesta!', 'warn');
            break;
        case 'APPROVAL_RESULT':
            handleApprovalRes(d);
            break;
        case 'BALANCE_UPDATED':
            updateBal(d.playerId, d.newBalance);
            notify('Saldo aggiornato', 'success');
            break;
        case 'BET_EXECUTED':
            State.data.players = d.players;
            State.data.operations.push(d.bet);
            refresh();
            notify('Operazione eseguita!', 'success');
            break;
        case 'SETTLEMENT_EXECUTED':
            State.data.players.A.balance = d.newBalances.A;
            State.data.players.B.balance = d.newBalances.B;
            refresh();
            notify('Pagamento confermato!', 'success');
            document.getElementById('settleBox').style.display = 'none';
            break;
        case 'ERROR':
            notify(d.message, 'err');
            break;
    }
}

function enter() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'grid';
    
    const badge = State.id === 'OBSERVER' ? 'Osservatore' : `Giocatore ${State.id}`;
    document.getElementById('playerBadge').textContent = badge;
    
    if (State.data.players.A) {
        document.getElementById('nameA').textContent = State.data.players.A.name;
    }
    if (State.data.players.B) {
        document.getElementById('nameB').textContent = State.data.players.B.name;
    }
    
    refresh();
    renderBets(2);
}

function refresh() {
    const a = State.data.players.A;
    const b = State.data.players.B;
    
    document.getElementById('balA').textContent = fmt(a.balance);
    document.getElementById('invA').textContent = fmt(a.invested);
    document.getElementById('wonA').textContent = fmt(a.won);
    const pa = a.won - a.invested;
    document.getElementById('profA').textContent = (pa >= 0 ? '+' : '') + fmt(pa);
    document.getElementById('profA').className = pa >= 0 ? 'pos' : 'neg';
    document.getElementById('statusA').textContent = a.connected ? '🟢 Online' : '⚫ Offline';
    document.getElementById('statusA').style.color = a.connected ? 'var(--p)' : 'var(--tm)';
    
    document.getElementById('balB').textContent = fmt(b.balance);
    document.getElementById('invB').textContent = fmt(b.invested);
    document.getElementById('wonB').textContent = fmt(b.won);
    const pb = b.won - b.invested;
    document.getElementById('profB').textContent = (pb >= 0 ? '+' : '') + fmt(pb);
    document.getElementById('profB').className = pb >= 0 ? 'pos' : 'neg';
    document.getElementById('statusB').textContent = b.connected ? '🟢 Online' : '⚫ Offline';
    document.getElementById('statusB').style.color = b.connected ? 'var(--p2)' : 'var(--tm)';
    
    renderHist();
    renderApprovals();
}

function fmt(n) {
    return '€' + Math.abs(n || 0).toFixed(2);
}

// Navigation
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

// Calculator
let numBets = 2;

function setBets(n) {
    numBets = n;
    document.querySelectorAll('.r-btn').forEach((b, i) => b.classList.toggle('active', i === n-2));
    renderBets(n);
}

function renderBets(n) {
    const c = document.getElementById('betsContainer');
    c.innerHTML = '';
    for (let i = 0; i < n; i++) {
        c.innerHTML += `
            <div class="bet-row">
                <input type="text" placeholder="Esito ${i+1}" id="n${i}">
                <input type="number" placeholder="Quota" step="0.01" id="q${i}">
                ${i > 1 ? `<button onclick="this.parentElement.remove()">×</button>` : ''}
            </div>
        `;
    }
}

function splitChange() {
    const m = document.getElementById('splitMode').value;
    document.getElementById('customSplit').style.display = m === 'custom' ? 'block' : 'none';
}

function calculate() {
    const total = parseFloat(document.getElementById('capTotal').value) || 0;
    if (!total) return notify('Inserisci capitale', 'err');
    
    const quotes = [];
    for (let i = 0; i < numBets; i++) {
        const q = parseFloat(document.getElementById(`q${i}`).value);
        if (!q) return notify(`Quota mancante esito ${i+1}`, 'err');
        quotes.push(q);
    }
    
    const stakes = quotes.map(q => total / q);
    const totStake = stakes.reduce((a, b) => a + b, 0);
    const ret = stakes.map((s, i) => s * quotes[i]);
    const profit = ret[0] - totStake;
    const roi = (profit / totStake) * 100;
    
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
    
    let htmlA = '', htmlB = '';
    stakes.forEach((s, i) => {
        const name = document.getElementById(`n${i}`).value || `E${i+1}`;
        htmlA += `<div>${name}: Punta ${fmt(s*splitA)} → Rientra ${fmt(ret[i]*splitA)}</div>`;
        htmlB += `<div>${name}: Punta ${fmt(s*splitB)} → Rientra ${fmt(ret[i]*splitB)}</div>`;
    });
    
    document.getElementById('resA').innerHTML = `<h4>A</h4>${htmlA}<div style="margin-top:10px;color:var(--p)"><b>Profitto: ${fmt(profit*splitA)}</b></div>`;
    document.getElementById('resB').innerHTML = `<h4>B</h4>${htmlB}<div style="margin-top:10px;color:var(--p)"><b>Profitto: ${fmt(profit*splitB)}</b></div>`;
    document.getElementById('totProfit').textContent = fmt(profit);
    document.getElementById('totRoi').textContent = roi.toFixed(2) + '%';
    document.getElementById('btnSave').disabled = false;
    
    State.calc = {
        investA: totStake * splitA,
        investB: totStake * splitB,
        returnA: ret[0] * splitA,
        returnB: ret[0] * splitB,
        profitA: profit * splitA,
        profitB: profit * splitB
    };
}

function saveCalc() {
    if (!State.calc || State.id === 'OBSERVER') return;
    State.ws.send(JSON.stringify({ type: 'REQUEST_BET', betData: State.calc }));
    notify('Richiesta inviata', 'success');
}

// Settlement
function settlement() {
    const a = State.data.players.A.balance;
    const b = State.data.players.B.balance;
    const diff = a - (a + b) / 2;
    
    const box = document.getElementById('settleBox');
    const txt = document.getElementById('settleText');
    const amt = document.getElementById('settleAmount');
    
    box.style.display = 'block';
    
    if (Math.abs(diff) < 0.01) {
        txt.innerHTML = '<b style="color:var(--p)">✅ Conti in pari!</b>';
        amt.style.display = 'none';
    } else {
        const from = diff > 0 ? 'B' : 'A';
        const to = diff > 0 ? 'A' : 'B';
        txt.innerHTML = `Giocatore <b>${from}</b> deve dare a <b>${to}</b>:`;
        amt.textContent = fmt(Math.abs(diff));
        amt.style.display = 'block';
    }
}

function confirmSettle() {
    State.ws.send(JSON.stringify({ type: 'CONFIRM_SETTLEMENT' }));
}

// Chat
function sendChat() {
    const inp = document.getElementById('chatInp');
    const text = inp.value.trim();
    if (!text) return;
    State.ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', text }));
    inp.value = '';
}

function addMsg(m) {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.playerId === State.id ? 'mine' : 'other');
    const time = new Date(m.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    div.innerHTML = `${esc(m.text)}<span class="time">${m.playerName} • ${time}</span>`;
    document.getElementById('chatMsgs').appendChild(div);
    div.scrollIntoView();
}

function esc(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

// Approvals
function addApproval(a) {
    State.data.pendingApprovals.push(a);
    renderApprovals();
}

function renderApprovals() {
    const list = document.getElementById('appList');
    const pend = State.data.pendingApprovals.filter(a => a.status === 'pending');
    document.getElementById('badApp').textContent = pend.length;
    document.getElementById('badApp').style.display = pend.length ? 'inline' : 'none';
    
    if (!pend.length) {
        list.innerHTML = '<div style="color:var(--tm);text-align:center;padding:20px;">Nessuna richiesta</div>';
        return;
    }
    
    list.innerHTML = pend.map(a => {
        const mine = a.requestedBy === State.id;
        const canAct = !mine && State.id !== 'OBSERVER';
        const info = a.type === 'BALANCE_UPDATE' 
            ? `${a.targetPlayer}: ${a.amount > 0 ? '+' : ''}${fmt(a.amount)}`
            : `Profitto: ${fmt(a.data.profitA + a.data.profitB)}`;
        
        return `
            <div class="app-item">
                <h5>${a.type === 'BALANCE_UPDATE' ? '💰 Saldo' : '🎲 Bet'}</h5>
                <p>Da: Giocatore ${a.requestedBy}<br>${info}</p>
                ${canAct ? `
                    <div class="app-btns">
                        <button class="btn prim" onclick="respApp('${a.id}',true)">✅</button>
                        <button class="btn sec" onclick="respApp('${a.id}',false)">❌</button>
                    </div>
                ` : '<p style="color:var(--tm)">Attesa...</p>'}
            </div>
        `;
    }).join('');
}

function respApp(id, ok) {
    State.ws.send(JSON.stringify({ type: ok ? 'APPROVE' : 'REJECT', approvalId: id }));
}

function handleApprovalRes(d) {
    State.data.pendingApprovals = State.data.pendingApprovals.filter(a => a.id !== d.approvalId);
    renderApprovals();
    notify(d.result === 'approved' ? 'Approvato!' : 'Rifiutato', d.result === 'approved' ? 'success' : 'err');
}

// History
function renderHist() {
    const tb = document.getElementById('histBody');
    if (!State.data.operations.length) {
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--tm)">Nessuna operazione</td></tr>';
        return;
    }
    tb.innerHTML = State.data.operations.map(o => `
        <tr>
            <td>${new Date(o.timestamp).toLocaleString()}</td>
            <td>${o.type}</td>
            <td>${fmt(o.investA)}</td>
            <td>${fmt(o.investB)}</td>
            <td class="${o.profitA >= 0 ? 'pos' : 'neg'}">${fmt(o.profitA)}</td>
            <td class="${o.profitB >= 0 ? 'pos' : 'neg'}">${fmt(o.profitB)}</td>
            <td class="${(o.profitA+o.profitB) >= 0 ? 'pos' : 'neg'}">${fmt(o.profitA+o.profitB)}</td>
        </tr>
    `).join('');
}

// Modal
function modal(type) {
    if (State.id === 'OBSERVER') return notify('Sola lettura', 'err');
    
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
            if (!amt) return notify('Inserisci importo', 'err');
            State.ws.send(JSON.stringify({
                type: 'REQUEST_BALANCE_UPDATE',
                targetPlayer: document.getElementById('mPlayer').value,
                amount: amt
            }));
            closeModal();
            notify('Richiesta inviata', 'success');
        };
        
    } else if (type === 'bet') {
        t.textContent = '🎲 Nuova Scommessa';
        b.innerHTML = `
            <label>Descrizione/Evento</label>
            <input type="text" id="mDesc" placeholder="Es: Milan-Inter">
            <label>Investimento Totale €</label>
            <input type="number" id="mInv" placeholder="100" step="0.01">
            <label>Vincita Totale €</label>
            <input type="number" id="mWin" placeholder="105" step="0.01">
            <label>Divisione</label>
            <select id="mSplit">
                <option value="equal">50% / 50%</option>
                <option value="prop">Proporzionale al capitale</option>
            </select>
        `;
        window.mConfirm = () => {
            const inv = parseFloat(document.getElementById('mInv').value) || 0;
            const win = parseFloat(document.getElementById('mWin').value) || 0;
            if (!inv || !win) return notify('Inserisci tutti i valori', 'err');
            
            const profit = win - inv;
            const splitMode = document.getElementById('mSplit').value;
            let splitA = 0.5;
            
            if (splitMode === 'prop') {
                const balA = State.data.players.A.balance || 1;
                const balB = State.data.players.B.balance || 1;
                splitA = balA / (balA + balB);
            }
            
            const splitB = 1 - splitA;
            
            State.ws.send(JSON.stringify({
                type: 'REQUEST_BET',
                betData: {
                    type: 'surebet',
                    description: document.getElementById('mDesc').value || 'Scommessa',
                    investA: inv * splitA,
                    investB: inv * splitB,
                    returnA: win * splitA,
                    returnB: win * splitB,
                    profitA: profit * splitA,
                    profitB: profit * splitB
                }
            }));
            closeModal();
            notify('Richiesta scommessa inviata', 'success');
        };
    }
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// Utils
function notify(msg, type) {
    const d = document.createElement('div');
    d.className = 'notif ' + type;
    d.innerHTML = `<b>${type === 'err' ? '❌' : type === 'warn' ? '⚠️' : '✅'}</b> ${msg}`;
    document.getElementById('notifs').appendChild(d);
    setTimeout(() => d.remove(), 5000);
}

function showLoginErr(m) {
    document.getElementById('loginError').textContent = m;
}

function updateBal(p, v) {
    State.data.players[p].balance = v;
    refresh();
}

// Settings
function theme(c) {
    const colors = { green: '#00ff88', blue: '#00d9ff', red: '#ff4757', purple: '#a55eea' };
    document.documentElement.style.setProperty('--p', colors[c]);
    document.querySelectorAll('.c-opt').forEach(el => el.classList.toggle('active', el.onclick.toString().includes(c)));
}

function saveName() {
    const n = document.getElementById('setName').value;
    if (n) State.ws.send(JSON.stringify({ type: 'UPDATE_SETTINGS', settings: { name: n } }));
}

function exportData() {
    const data = JSON.stringify(State.data, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
}

// Simulazione
function runSim() {
    const a = parseFloat(document.getElementById('simA').value) || 100;
    const b = parseFloat(document.getElementById('simB').value) || 100;
    const p = parseFloat(document.getElementById('simProf').value) || 3;
    const f = parseInt(document.getElementById('simFreq').value) || 2;
    const d = parseInt(document.getElementById('simDays').value) || 30;
    const t = parseFloat(document.getElementById('simTarget').value) || 500;
    
    const mult = Math.pow(1 + p/100, f * d);
    const fa = a * mult;
    const fb = b * mult;
    
    const da = Math.log(t/a) / (f * Math.log(1 + p/100));
    const db = Math.log(t/b) / (f * Math.log(1 + p/100));
    
    document.getElementById('simFinA').textContent = fmt(fa);
    document.getElementById('simFinB').textContent = fmt(fb);
    document.getElementById('simD500A').textContent = da > 0 && da <= d ? Math.ceil(da) + ' gg' : 'No';
    document.getElementById('simD500B').textContent = db > 0 && db <= d ? Math.ceil(db) + ' gg' : 'No';
    document.getElementById('simRes').style.display = 'block';
}

// ========== SCELTA RUOLO ==========

let tempName = '';

function goToStep2() {
    tempName = document.getElementById('loginName').value.trim();
    if (!tempName) {
        document.getElementById('loginError').textContent = 'Inserisci il tuo nome';
        return;
    }
    
    document.getElementById('loginStep1').style.display = 'none';
    document.getElementById('loginStep2').style.display = 'block';
    
    // Simula disponibilità (in realtà la controlliamo alla connessione)
    document.getElementById('btnA').disabled = false;
    document.getElementById('btnB').disabled = false;
}

function backToStep1() {
    document.getElementById('loginStep2').style.display = 'none';
    document.getElementById('loginStep1').style.display = 'block';
}

function chooseRole(role) {
    State.name = tempName;
    
    // Connessione WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    State.ws = new WebSocket(wsUrl);
    
    State.ws.onopen = () => {
        State.connected = true;
        
        // Invia scelta ruolo
        State.ws.send(JSON.stringify({
            type: 'CHOOSE_ROLE',
            role: role,
            name: tempName
        }));
    };
    
    State.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };
    
    State.ws.onclose = () => {
        State.connected = false;
        document.getElementById('connStatus').classList.remove('on');
        setTimeout(() => {
            if (State.name) chooseRole(role);
        }, 3000);
    };
    
    State.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        document.getElementById('loginError').textContent = 'Errore connessione';
    };
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
            notify('Dati esportati con successo!', 'success');
        })
        .catch(err => notify('Errore export: ' + err.message, 'err'));
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
                    notify('Dati importati! Ricarica la pagina per vedere i cambiamenti', 'success');
                    setTimeout(() => location.reload(), 2000);
                }
            });
        } catch (err) {
            notify('File non valido: ' + err.message, 'err');
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
            notify('✅ File caricato! Ora scegli il tuo ruolo per continuare', 'success');
        } catch (err) {
            notify('❌ File non valido', 'err');
        }
    };
    reader.readAsText(file);
}

// ========== ANTI-SGAMO ==========

function roundAntiSgamo(amount) {
    // Arrotonda alla decina più vicina
    return Math.round(amount / 10) * 10;
}

function applyAntiSgamo() {
    if (!State.calc) return notify('Calcola prima una scommessa', 'err');
    
    const originalA = State.calc.investA;
    const originalB = State.calc.investB;
    
    // Arrotonda
    const roundedA = roundAntiSgamo(originalA);
    const roundedB = roundAntiSgamo(originalB);
    
    // Ricalcola mantenendo proporzioni
    const ratioA = State.calc.returnA / State.calc.investA;
    const ratioB = State.calc.returnB / State.calc.investB;
    
    State.calc.investA = roundedA;
    State.calc.investB = roundedB;
    State.calc.returnA = roundedA * ratioA;
    State.calc.returnB = roundedB * ratioB;
    State.calc.profitA = State.calc.returnA - roundedA;
    State.calc.profitB = State.calc.returnB - roundedB;
    
    // Aggiorna display
    updateCalcDisplay();
    
    notify(`🎭 Anti-Sgamo applicato: A ${originalA.toFixed(2)}→${roundedA}, B ${originalB.toFixed(2)}→${roundedB}`, 'success');
}

function updateCalcDisplay() {
    // Aggiorna i risultati nel calcolatore
    document.getElementById('resA').innerHTML = `
        <h4>A</h4>
        <div>Investimento: ${fmt(State.calc.investA)}</div>
        <div>Rientro: ${fmt(State.calc.returnA)}</div>
        <div style="color:var(--p);margin-top:10px"><b>Profitto: ${fmt(State.calc.profitA)}</b></div>
    `;
    document.getElementById('resB').innerHTML = `
        <h4>B</h4>
        <div>Investimento: ${fmt(State.calc.investB)}</div>
        <div>Rientro: ${fmt(State.calc.returnB)}</div>
        <div style="color:var(--p);margin-top:10px"><b>Profitto: ${fmt(State.calc.profitB)}</b></div>
    `;
    document.getElementById('totProfit').textContent = fmt(State.calc.profitA + State.calc.profitB);
}

// ========== BOOKMAKERS ==========

function showBookmakers() {
    const container = document.getElementById('bookmakerList');
    if (!container) return;
    
    const bms = State.data?.bookmakers || [];
    const stats = State.data?.bookmakerStats || {};
    
    container.innerHTML = bms.map(bm => {
        const s = stats[bm.id] || { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
        const profitA = s.A.won - s.A.invested;
        const profitB = s.B.won - s.B.invested;
        
        return `
            <div class="bookmaker-card">
                <h4>${bm.logo} ${bm.name}</h4>
                <div class="bm-stats">
                    <div><b>A:</b> Inv. ${fmt(s.A.invested)} | Win ${fmt(s.A.won)} | <span class="${profitA >= 0 ? 'pos' : 'neg'}">${fmt(profitA)}</span></div>
                    <div><b>B:</b> Inv. ${fmt(s.B.invested)} | Win ${fmt(s.B.won)} | <span class="${profitB >= 0 ? 'pos' : 'neg'}">${fmt(profitB)}</span></div>
                </div>
            </div>
        `;
    }).join('');
}

function addBookmaker() {
    const name = prompt('Nome bookmaker:');
    if (!name) return;
    
    const logo = prompt('Logo (3 lettere max, es: B365):') || name.substring(0, 3).toUpperCase();
    
    State.ws.send(JSON.stringify({
        type: 'ADD_BOOKMAKER',
        name: name,
        logo: logo
    }));
    
    notify('Bookmaker aggiunto!', 'success');
}

// Helper
function fmt(n) {
    return '€' + Math.abs(n || 0).toFixed(2);
}

function notify(msg, type) {
    const div = document.createElement('div');
    div.className = 'notification ' + type;
    div.innerHTML = `<b>${type === 'err' ? '❌' : '✅'}</b> ${msg}`;
    document.getElementById('notifs').appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    renderBets(2);

});

