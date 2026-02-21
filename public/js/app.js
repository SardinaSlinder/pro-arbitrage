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
    const name = document.getElementById('loginName').value.trim();
    if (!name) return showLoginErr('Inserisci nome');
    
    State.name = name;
    State.ws = new WebSocket(WS_URL);
    
    State.ws.onopen = () => {
        document.getElementById('connStatus').classList.add('on');
        console.log('Connesso a Render');
    };
    
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
            State.ws.send(JSON.stringify({
                type: 'REQUEST_BALANCE_UPDATE',
                targetPlayer: document.getElementById('mPlayer').value,
                amount: parseFloat(document.getElementById('mAmt').value) || 0
            }));
            closeModal();
            notify('Richiesta inviata', 'success');
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

// Init
document.addEventListener('DOMContentLoaded', () => {
    renderBets(2);
});