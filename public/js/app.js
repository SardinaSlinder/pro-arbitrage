// ARBITRAGGIO PRO - Client Completo

const WS_URL = window.location.protocol === 'https:' 
    ? `wss://${window.location.host}` 
    : `ws://${window.location.host}`;

const State = {
    ws: null,
    id: null,
    name: '',
    connected: false,
    data: null,
    calc: null,
    soundEnabled: true
};

let tempName = '';

// ========== LOGIN ==========

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
        const connStatus = document.getElementById('connStatus');
        if (connStatus) connStatus.classList.add('on');
        
        State.ws.send(JSON.stringify({
            type: 'CHOOSE_ROLE',
            role: role,
            name: tempName
        }));
    };
    
    State.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Messaggio ricevuto:', data.type, data);
        handleMessage(data);
    };
    
    State.ws.onclose = () => {
        State.connected = false;
        const connStatus = document.getElementById('connStatus');
        if (connStatus) connStatus.classList.remove('on');
        notify('Connessione persa', 'warning');
    };
    
    State.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        notify('Errore di connessione', 'error');
    };
}

// ========== GESTIONE MESSAGGI ==========

function handleMessage(data) {
    switch(data.type) {
        case 'INIT_STATE':
            State.id = data.playerId;
            State.data = data.state;
            console.log('Stato iniziale ricevuto, pending:', data.state.pendingApprovals?.length);
            enterApp();
            break;
            
        case 'PLAYER_CONNECTED':
            notify(`${data.playerName} si è connesso`, 'success');
            if (State.data && State.data.players[data.playerId]) {
                State.data.players[data.playerId].connected = true;
                State.data.players[data.playerId].name = data.playerName;
                updatePlayerStatus(data.playerId, true, data.playerName);
            }
            break;
            
        case 'PLAYER_DISCONNECTED':
            notify(`Giocatore ${data.playerId} disconnesso`, 'warning');
            if (State.data && State.data.players[data.playerId]) {
                State.data.players[data.playerId].connected = false;
                updatePlayerStatus(data.playerId, false);
            }
            break;
            
        case 'PLAYER_UPDATED':
            if (State.data && State.data.players[data.playerId]) {
                State.data.players[data.playerId].name = data.name;
                document.getElementById('name' + data.playerId).textContent = data.name;
            }
            break;
            
        case 'NEW_MESSAGE':
            addChatMessage(data.message);
            break;
            
        case 'APPROVAL_REQUIRED':
            console.log('Nuova approvazione richiesta:', data.approval);
            // AGGIUNGI alla lista locale
            if (!State.data.pendingApprovals) State.data.pendingApprovals = [];
            State.data.pendingApprovals.push(data.approval);
            addApproval(data.approval);
            notify('Nuova richiesta da approvare!', 'warning');
            break;
            
        case 'APPROVAL_RESULT':
            console.log('Risultato approvazione:', data);
            removeApproval(data.approvalId);
            notify(
                data.result === 'approved' ? '✅ Richiesta approvata!' : '❌ Richiesta rifiutata', 
                data.result === 'approved' ? 'success' : 'error'
            );
            break;
            
        case 'BALANCE_UPDATED':
            if (State.data && State.data.players[data.playerId]) {
                State.data.players[data.playerId].balance = data.newBalance;
                refreshDashboard();
                notify(`Saldo ${data.playerId} aggiornato: ${fmt(data.newBalance)}`, 'success');
            }
            break;
            
        case 'BET_EXECUTED':
            State.data.players = data.players;
            State.data.operations.push(data.bet);
            State.data.bookmakerStats = data.bookmakerStats || {};
            refreshDashboard();
            renderHistory();
            notify('Operazione eseguita e approvata!', 'success');
            break;
            
        case 'SETTLEMENT_EXECUTED':
            State.data.players.A.balance = data.newBalances.A;
            State.data.players.B.balance = data.newBalances.B;
            refreshDashboard();
            notify('Settlement confermato!', 'success');
            const settleBox = document.getElementById('settleBox');
            if (settleBox) settleBox.style.display = 'none';
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
            
        default:
            console.log('Tipo messaggio sconosciuto:', data.type);
    }
}

// ========== APP ==========

function enterApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'grid';
    
    const badgeText = State.id === 'OBSERVER' ? 'Osservatore' : `Giocatore ${State.id}`;
    document.getElementById('playerBadge').textContent = badgeText;
    
    if (State.data.players.A) {
        document.getElementById('nameA').textContent = State.data.players.A.name || 'Giocatore A';
        updatePlayerStatus('A', State.data.players.A.connected);
    }
    if (State.data.players.B) {
        document.getElementById('nameB').textContent = State.data.players.B.name || 'Giocatore B';
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
    if (!State.data) return;
    
    const a = State.data.players.A;
    const b = State.data.players.B;
    
    document.getElementById('balA').textContent = fmt(a.balance);
    document.getElementById('invA').textContent = fmt(a.invested);
    document.getElementById('wonA').textContent = fmt(a.won);
    const profA = a.won - a.invested;
    const profAEl = document.getElementById('profA');
    profAEl.textContent = (profA >= 0 ? '+' : '') + fmt(profA);
    profAEl.className = profA >= 0 ? 'pos' : 'neg';
    
    document.getElementById('balB').textContent = fmt(b.balance);
    document.getElementById('invB').textContent = fmt(b.invested);
    document.getElementById('wonB').textContent = fmt(b.won);
    const profB = b.won - b.invested;
    const profBEl = document.getElementById('profB');
    profBEl.textContent = (profB >= 0 ? '+' : '') + fmt(profB);
    profBEl.className = profB >= 0 ? 'pos' : 'neg';
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
        const btn = box.querySelector('.btn');
        if (btn) btn.style.display = 'none';
    } else {
        const from = diff > 0 ? 'B' : 'A';
        const to = diff > 0 ? 'A' : 'B';
        txt.innerHTML = `Giocatore <b>${from}</b> deve dare a <b>${to}</b>:`;
        amt.textContent = fmt(Math.abs(diff));
        amt.style.display = 'block';
        const btn = box.querySelector('.btn');
        if (btn) btn.style.display = 'inline-block';
    }
}

function confirmSettlement() {
    State.ws.send(JSON.stringify({ type: 'CONFIRM_SETTLEMENT' }));
}

// ========== CALCOLATORE SUREBET SEMPLIFICATO ==========

function calculate() {
    // INPUT UTENTE
    const totalCapital = parseFloat(document.getElementById('totalCapital').value) || 0;
    const quotaA = parseFloat(document.getElementById('quotaA').value) || 0;
    const quotaB = parseFloat(document.getElementById('quotaB').value) || 0;
    const balanceA = parseFloat(document.getElementById('balanceA').value) || 0;
    const balanceB = parseFloat(document.getElementById('balanceB').value) || 0;
    
    // VALIDAZIONE
    if (!totalCapital || !quotaA || !quotaB) {
        return notify('Inserisci capitale totale e entrambe le quote', 'error');
    }
    if (quotaA <= 1 || quotaB <= 1) {
        return notify('Le quote devono essere maggiori di 1.00', 'error');
    }
    
    // 1. VERIFICA SE È SUREBET
    const margin = (1 / quotaA) + (1 / quotaB);
    const isSurebet = margin < 1;
    
    if (!isSurebet) {
        notify('⚠️ Attenzione: Non è una surebet! Margin: ' + (margin * 100).toFixed(2) + '%', 'warning');
    }
    
    // 2. CALCOLO PUNTATE OTTIMALI (teoriche)
    // Per coprire entrambi: stakeA × quotaA = stakeB × quotaB = stesso ritorno
    // stakeA = totale / quotaA, stakeB = totale / quotaB
    const theoreticalStakeA = totalCapital / quotaA;
    const theoreticalStakeB = totalCapital / quotaB;
    const totalTheoretical = theoreticalStakeA + theoreticalStakeB;
    
    // 3. PROFITTO TEORICO
    const returnAmount = totalCapital; // Ritorno = capitale iniziale (per definizione)
    const theoreticalProfit = returnAmount - totalTheoretical;
    const theoreticalROI = (theoreticalProfit / totalTheoretical) * 100;
    
    // 4. VINCOLI REALI (quanto possiamo puntare davvero?)
    // Rapporto ottimale: stakeA/stakeB = quotaB/quotaA
    const optimalRatio = quotaB / quotaA; // Quanto deve essere A rispetto a B
    
    // Se A ha balanceA, quanto può puntare B per mantenere il rapporto?
    // stakeB = stakeA / optimalRatio
    const maxStakeA_fromB = balanceB * optimalRatio; // Quanto può puntare A dato il limite di B
    
    const actualStakeA = Math.min(balanceA, totalCapital / quotaA, maxStakeA_fromB);
    const actualStakeB = actualStakeA / optimalRatio;
    
    // 5. RICALCOLO CON VINCOLI REALI
    const actualTotalInvested = actualStakeA + actualStakeB;
    const actualReturn = actualStakeA * quotaA; // = actualStakeB * quotaB
    const actualProfit = actualReturn - actualTotalInvested;
    const actualROI = (actualProfit / actualTotalInvested) * 100;
    
    // 6. CHI PAGA COSA?
    // A paga la sua parte della puntata A, B paga la sua parte della puntata B
    // MA in proporzione ai loro saldi rispetto al capitale totale
    
    const shareA = balanceA / (balanceA + balanceB); // % di A sul totale
    const shareB = balanceB / (balanceA + balanceB); // % di B sul totale
    
    // Ognuno contribuisce alla puntata in base alla sua % di proprietà del capitale
    const contributionA = actualStakeA; // A paga tutta la puntata A
    const contributionB = actualStakeB; // B paga tutta la puntata B
    
    // 7. PROFITTO DIVISO
    const profitA = actualProfit * shareA;
    const profitB = actualProfit * shareB;
    
    // SALVA STATO
    State.calc = {
        stakeA: actualStakeA,
        stakeB: actualStakeB,
        totalInvested: actualTotalInvested,
        returnAmount: actualReturn,
        totalProfit: actualProfit,
        roi: actualROI,
        profitA: profitA,
        profitB: profitB,
        shareA: shareA,
        shareB: shareB,
        contributionA: contributionA,
        contributionB: contributionB,
        quotaA: quotaA,
        quotaB: quotaB
    };
    
    // MOSTRA RISULTATI
    displayResults(State.calc, isSurebet, margin);
}

function displayResults(calc, isSurebet, margin) {
    const resultsDiv = document.getElementById('calcResults');
    
    const statusColor = isSurebet ? 'var(--primary)' : 'var(--warning)';
    const statusText = isSurebet ? '✅ SUREBET VALIDA' : '⚠️ NON SUREBET';
    
    resultsDiv.innerHTML = `
        <div class="result-status" style="color:${statusColor};font-size:1.2rem;font-weight:bold;margin-bottom:20px;">
            ${statusText} (Margin: ${(margin * 100).toFixed(2)}%)
        </div>
        
        <div class="result-grid">
            <div class="result-box player-a">
                <h4>🟢 GIOCATORE A</h4>
                <div class="result-row">
                    <span>Deve puntare:</span>
                    <b class="highlight">${fmt(calc.stakeA)}</b>
                </div>
                <div class="result-row">
                    <span>Sul bookmaker A @${calc.quotaA}</span>
                </div>
                <div class="result-row">
                    <span>Proprietà capitale:</span>
                    <b>${(calc.shareA * 100).toFixed(1)}%</b>
                </div>
                <div class="result-row profit">
                    <span>Profitto netto:</span>
                    <b class="pos">${fmt(calc.profitA)}</b>
                </div>
            </div>
            
            <div class="result-box player-b">
                <h4>🔵 GIOCATORE B</h4>
                <div class="result-row">
                    <span>Deve puntare:</span>
                    <b class="highlight">${fmt(calc.stakeB)}</b>
                </div>
                <div class="result-row">
                    <span>Sul bookmaker B @${calc.quotaB}</span>
                </div>
                <div class="result-row">
                    <span>Proprietà capitale:</span>
                    <b>${(calc.shareB * 100).toFixed(1)}%</b>
                </div>
                <div class="result-row profit">
                    <span>Profitto netto:</span>
                    <b class="pos">${fmt(calc.profitB)}</b>
                </div>
            </div>
        </div>
        
        <div class="result-summary">
            <h4>📊 RIEPILOGO OPERAZIONE</h4>
            <div class="summary-grid">
                <div>
                    <span>Totale investito:</span>
                    <b>${fmt(calc.totalInvested)}</b>
                </div>
                <div>
                    <span>Totale rientro:</span>
                    <b>${fmt(calc.returnAmount)}</b>
                </div>
                <div>
                    <span>Profitto totale:</span>
                    <b class="pos">${fmt(calc.totalProfit)}</b>
                </div>
                <div>
                    <span>ROI:</span>
                    <b class="pos">${calc.roi.toFixed(2)}%</b>
                </div>
            </div>
        </div>
        
        <button class="btn btn-primary btn-full" onclick="saveCalculation()" id="btnSaveCalc">
            💾 Salva e Richiedi Approvazione
        </button>
    `;
    
    resultsDiv.style.display = 'block';
}

function applyAntiSgamo() {
    if (!State.calc) return notify('Calcola prima!', 'error');
    
    // Arrotonda a multipli di 5 per sembrare naturale
    const roundA = Math.round(State.calc.stakeA / 5) * 5;
    const roundB = Math.round(State.calc.stakeB / 5) * 5;
    
    // Ricalcola mantenendo le quote
    const newReturnA = roundA * State.calc.quotaA;
    const newReturnB = roundB * State.calc.quotaB;
    const minReturn = Math.min(newReturnA, newReturnB);
    
    const newTotalInvested = roundA + roundB;
    const newProfit = minReturn - newTotalInvested;
    const newROI = (newProfit / newTotalInvested) * 100;
    
    State.calc.stakeA = roundA;
    State.calc.stakeB = roundB;
    State.calc.totalInvested = newTotalInvested;
    State.calc.returnAmount = minReturn;
    State.calc.totalProfit = newProfit;
    State.calc.roi = newROI;
    State.calc.profitA = newProfit * State.calc.shareA;
    State.calc.profitB = newProfit * State.calc.shareB;
    
    displayResults(State.calc, true, 0.95);
    notify(`🎭 Anti-sgamo: A ${fmt(roundA)}, B ${fmt(roundB)}`, 'success');
}

function saveCalculation() {
    if (!State.calc || State.id === 'OBSERVER') {
        return notify('Non puoi salvare', 'error');
    }
    
    State.ws.send(JSON.stringify({
        type: 'REQUEST_BET',
        betData: {
            description: `Surebet @${State.calc.quotaA} vs @${State.calc.quotaB}`,
            stakeA: State.calc.stakeA,
            stakeB: State.calc.stakeB,
            investA: State.calc.contributionA,
            investB: State.calc.contributionB,
            returnA: State.calc.returnAmount * State.calc.shareA,
            returnB: State.calc.returnAmount * State.calc.shareB,
            profitA: State.calc.profitA,
            profitB: State.calc.profitB,
            totalProfit: State.calc.totalProfit,
            roi: State.calc.roi,
            quotaA: State.calc.quotaA,
            quotaB: State.calc.quotaB
        }
    }));
    
    notify('Richiesta inviata! Attendi approvazione...', 'success');
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

function addApproval(approval) {
    console.log('Aggiungo approvazione UI:', approval);
    
    const list = document.getElementById('listApprovals');
    if (!list) {
        console.error('Elemento listApprovals non trovato!');
        return;
    }
    
    // Non mostrare le proprie richieste
    if (approval.requestedBy === State.id) {
        console.log('Ignoro la mia stessa richiesta');
        return;
    }
    
    // Rimuovi messaggio "nessuna richiesta" se presente
    const emptyMsg = list.querySelector('.empty');
    if (emptyMsg) emptyMsg.remove();
    
    const info = approval.type === 'BALANCE_UPDATE' 
        ? `${approval.targetPlayer}: ${approval.amount > 0 ? '+' : ''}${fmt(approval.amount)}`
        : `Profitto totale: ${fmt((approval.data?.profitA || 0) + (approval.data?.profitB || 0))}`;
    
    const div = document.createElement('div');
    div.className = 'approval-item';
    div.id = `approval-${approval.id}`;
    div.innerHTML = `
        <h5>${approval.type === 'BALANCE_UPDATE' ? '💰 Modifica Saldo' : '🎲 Nuova Bet'}</h5>
        <p>Da: ${State.data.players[approval.requestedBy]?.name || 'Giocatore ' + approval.requestedBy}<br>${info}</p>
        <div class="approval-actions">
            <button class="btn btn-primary" onclick="respondApproval('${approval.id}', true)">✅ Approva</button>
            <button class="btn btn-secondary" onclick="respondApproval('${approval.id}', false)">❌ Rifiuta</button>
        </div>
    `;
    
    list.appendChild(div);
    
    // Aggiorna badge
    updateApprovalBadge();
}

function removeApproval(id) {
    console.log('Rimuovo approvazione:', id);
    const el = document.getElementById(`approval-${id}`);
    if (el) {
        el.remove();
    }
    
    // Controlla se rimaste altre pending
    const remaining = document.querySelectorAll('.approval-item').length;
    if (remaining === 0) {
        const list = document.getElementById('listApprovals');
        if (list) list.innerHTML = '<p class="empty">Nessuna richiesta</p>';
    }
    
    updateApprovalBadge();
}

function renderApprovals() {
    const list = document.getElementById('listApprovals');
    if (!list) return;
    
    // Pulisci lista
    list.innerHTML = '';
    
    const pending = (State.data.pendingApprovals || []).filter(a => !a.status && a.requestedBy !== State.id);
    
    if (!pending.length) {
        list.innerHTML = '<p class="empty">Nessuna richiesta</p>';
        updateApprovalBadge();
        return;
    }
    
    pending.forEach(a => addApproval(a));
}

function updateApprovalBadge() {
    const badge = document.getElementById('badgeApp');
    if (!badge) return;
    
    const count = document.querySelectorAll('.approval-item').length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'block' : 'none';
}

function respondApproval(id, approve) {
    console.log('Rispondo ad approvazione:', id, approve);
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
            notify('Richiesta inviata per approvazione', 'success');
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
            notify('Richiesta inviata per approvazione', 'success');
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
    console.log(`[${type}] ${msg}`);
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

