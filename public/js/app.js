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
    soundEnabled: true,
    numQuotes: 2,
    quotesData: [] // Array di {name, quote}
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
        console.log('RX:', data.type, data);
        handleMessage(data);
    };
    
    State.ws.onclose = () => {
        State.connected = false;
        const connStatus = document.getElementById('connStatus');
        if (connStatus) connStatus.classList.remove('on');
        notify('Connessione persa', 'warning');
    };
    
    State.ws.onerror = (err) => {
        console.error('WS error:', err);
        notify('Errore connessione', 'error');
    };
}

// ========== MESSAGGI SERVER ==========

function handleMessage(data) {
    switch(data.type) {
        case 'INIT_STATE':
            State.id = data.playerId;
            State.data = data.state;
            enterApp();
            break;
            
        case 'PLAYER_CONNECTED':
            notify(`${data.playerName} connesso`, 'success');
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
            if (State.data.players[data.playerId]) {
                State.data.players[data.playerId].balance = data.newBalance;
                refreshDashboard();
            }
            break;
            
        case 'BET_EXECUTED':
            State.data.players = data.players;
            State.data.operations.push(data.bet);
            refreshDashboard();
            renderHistory();
            notify('Bet eseguita!', 'success');
            break;
            
        case 'SETTLEMENT_EXECUTED':
            State.data.players.A.balance = data.newBalances.A;
            State.data.players.B.balance = data.newBalances.B;
            refreshDashboard();
            notify('Settlement ok!', 'success');
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

// ========== APP ==========

function enterApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'grid';
    
    const badge = State.id === 'OBSERVER' ? 'Osservatore' : `Giocatore ${State.id}`;
    document.getElementById('playerBadge').textContent = badge;
    
    if (State.data.players.A) {
        document.getElementById('nameA').textContent = State.data.players.A.name;
        updatePlayerStatus('A', State.data.players.A.connected);
    }
    if (State.data.players.B) {
        document.getElementById('nameB').textContent = State.data.players.B.name;
        updatePlayerStatus('B', State.data.players.B.connected);
    }
    
    refreshAll();
    initCalculator();
}

function updatePlayerStatus(id, connected, name) {
    const el = document.getElementById('status' + id);
    if (el) {
        el.textContent = connected ? '🟢 Online' : '⚫ Offline';
        el.style.color = connected ? 'var(--primary)' : 'var(--text-muted)';
    }
    if (name) document.getElementById('name' + id).textContent = name;
}

function refreshAll() {
    refreshDashboard();
    renderHistory();
    renderApprovals();
    renderBookmakers();
}

function refreshDashboard() {
    if (!State.data) return;
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

// ========== CALCOLATORE ==========

function initCalculator() {
    // Inizializza con 2 quote vuote
    State.quotesData = [
        { name: '', quote: '' },
        { name: '', quote: '' }
    ];
    renderQuoteInputs();
}

function setBetCount(n) {
    console.log('setBetCount:', n);
    State.numQuotes = n;
    
    // Aggiorna bottoni
    document.querySelectorAll('.bet-count-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === n - 2);
    });
    
    // Aggiusta array dati
    while (State.quotesData.length < n) {
        State.quotesData.push({ name: '', quote: '' });
    }
    while (State.quotesData.length > n) {
        State.quotesData.pop();
    }
    
    renderQuoteInputs();
}

function renderQuoteInputs() {
    console.log('renderQuoteInputs, num:', State.numQuotes, 'data:', State.quotesData);
    const container = document.getElementById('quotesContainer');
    if (!container) {
        console.error('quotesContainer non trovato!');
        return;
    }
    
    container.innerHTML = '';
    
    for (let i = 0; i < State.numQuotes; i++) {
        const data = State.quotesData[i] || { name: '', quote: '' };
        
        const div = document.createElement('div');
        div.className = 'quote-input-row';
        div.innerHTML = `
            <input type="text" 
                   placeholder="Esito ${i + 1} (es: Milan)" 
                   id="name${i}" 
                   value="${data.name}"
                   onchange="updateQuoteData(${i}, 'name', this.value)">
            <input type="number" 
                   placeholder="Quota" 
                   step="0.01" 
                   id="quote${i}" 
                   value="${data.quote}"
                   onchange="updateQuoteData(${i}, 'quote', this.value)">
            ${i >= 2 ? `<button class="btn-remove" onclick="removeQuote(${i})" title="Rimuovi">✕</button>` : ''}
        `;
        container.appendChild(div);
    }
}

function updateQuoteData(index, field, value) {
    console.log('updateQuoteData:', index, field, value);
    if (!State.quotesData[index]) State.quotesData[index] = {};
    State.quotesData[index][field] = value;
}

function addQuoteField() {
    console.log('addQuoteField, current:', State.numQuotes);
    State.numQuotes++;
    State.quotesData.push({ name: '', quote: '' });
    renderQuoteInputs();
}

function removeQuote(index) {
    console.log('removeQuote:', index);
    if (State.numQuotes <= 2) {
        notify('Minimo 2 esiti richiesti', 'error');
        return;
    }
    State.numQuotes--;
    State.quotesData.splice(index, 1);
    renderQuoteInputs();
}

function calculate() {
    console.log('CALCULATE clicked');
    
    // Aggiorna dati da input
    for (let i = 0; i < State.numQuotes; i++) {
        const nameEl = document.getElementById(`name${i}`);
        const quoteEl = document.getElementById(`quote${i}`);
        if (nameEl && quoteEl) {
            State.quotesData[i] = {
                name: nameEl.value || `Esito ${i + 1}`,
                quote: parseFloat(quoteEl.value) || 0
            };
        }
    }
    
    console.log('Dati quote:', State.quotesData);
    
    // Leggi altri input
    const totalCapital = parseFloat(document.getElementById('totalCapital').value) || 0;
    const balanceA = parseFloat(document.getElementById('balanceA').value) || 0;
    const balanceB = parseFloat(document.getElementById('balanceB').value) || 0;
    
    // Validazione
    const validQuotes = State.quotesData.filter(q => q.quote > 1);
    if (validQuotes.length < 2) {
        notify('Inserisci almeno 2 quote valide (> 1.00)', 'error');
        return;
    }
    if (!totalCapital) {
        notify('Inserisci capitale totale', 'error');
        return;
    }
    
    // Calcolo surebet
    const margins = validQuotes.map(q => 1 / q.quote);
    const totalMargin = margins.reduce((a, b) => a + b, 0);
    const isSurebet = totalMargin < 1;
    
    // Puntate teoriche
    const stakes = validQuotes.map(q => totalCapital / q.quote);
    const totalStake = stakes.reduce((a, b) => a + b, 0);
    const theoreticalProfit = totalCapital - totalStake;
    const theoreticalROI = (theoreticalProfit / totalStake) * 100;
    
    // Calcolo reale con vincoli
    const totalBalance = balanceA + balanceB;
    const shareA = totalBalance > 0 ? balanceA / totalBalance : 0.5;
    const shareB = totalBalance > 0 ? balanceB / totalBalance : 0.5;
    
    const canCover = totalBalance >= totalStake;
    
    let actualStakes = [...stakes];
    let actualTotalStake = totalStake;
    let actualProfit = theoreticalProfit;
    let actualROI = theoreticalROI;
    
    if (!canCover && totalBalance > 0) {
        const scale = totalBalance / totalStake;
        actualStakes = stakes.map(s => s * scale);
        actualTotalStake = totalBalance;
        actualProfit = (totalCapital * scale) - totalBalance;
        actualROI = (actualProfit / totalBalance) * 100;
    }
    
    // Distribuzione
    const contributionA = actualStakes.map(s => s * shareA);
    const contributionB = actualStakes.map(s => s * shareB);
    const profitA = actualProfit * shareA;
    const profitB = actualProfit * shareB;
    
    // Salva
    State.calc = {
        names: validQuotes.map(q => q.name),
        quotes: validQuotes.map(q => q.quote),
        stakes: actualStakes,
        totalStake: actualTotalStake,
        totalReturn: totalCapital,
        totalProfit: actualProfit,
        roi: actualROI,
        margin: totalMargin,
        shareA: shareA,
        shareB: shareB,
        profitA: profitA,
        profitB: profitB,
        contributionA: contributionA,
        contributionB: contributionB,
        isSurebet: isSurebet,
        canCover: canCover
    };
    
    console.log('Calcolato:', State.calc);
    
    // Mostra
    displayResults();
}

function displayResults() {
    const calc = State.calc;
    const container = document.getElementById('calcResults');
    const statusDiv = document.getElementById('calcStatus');
    const totalBox = document.getElementById('totalResultBox');
    
    // Status
    const statusColor = calc.isSurebet ? 'var(--primary)' : 'var(--warning)';
    const statusText = calc.isSurebet ? '✅ SUREBET VALIDA' : '⚠️ NON È UNA SUREBET';
    const coverText = calc.canCover ? '' : '<br><small>(Capitale insufficiente - scalato)</small>';
    statusDiv.innerHTML = `<b style="color:${statusColor}">${statusText}</b>${coverText}<br>Margin: ${(calc.margin * 100).toFixed(2)}%`;
    statusDiv.style.display = 'block';
    
    // Risultati per esito
    let html = '';
    for (let i = 0; i < calc.names.length; i++) {
        const isWinner = i === 0; // Primo come riferimento
        
        html += `
            <div class="result-box ${isWinner ? 'winner' : ''}">
                <h4>${calc.names[i]} @${calc.quotes[i]}</h4>
                <div class="result-row">
                    <span>Puntata totale:</span>
                    <b>${fmt(calc.stakes[i])}</b>
                </div>
                <div class="result-row">
                    <span>Ritorno:</span>
                    <b>${fmt(calc.stakes[i] * calc.quotes[i])}</b>
                </div>
                <hr style="border-color:var(--border);margin:10px 0">
                <div class="result-row">
                    <span>A paga (${(calc.shareA * 100).toFixed(0)}%):</span>
                    <b>${fmt(calc.contributionA[i])}</b>
                </div>
                <div class="result-row">
                    <span>B paga (${(calc.shareB * 100).toFixed(0)}%):</span>
                    <b>${fmt(calc.contributionB[i])}</b>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
    container.style.display = 'grid';
    
    // Totale
    document.getElementById('totProfit').textContent = fmt(calc.totalProfit);
    document.getElementById('totRoi').textContent = calc.roi.toFixed(2) + '%';
    document.getElementById('totMargin').textContent = (calc.margin * 100).toFixed(2);
    totalBox.style.display = 'block';
    
    // Bottoni
    document.getElementById('btnSaveCalc').disabled = false;
    document.getElementById('btnAntiSgamo').style.display = 'inline-block';
    
    notify('Calcolo completato!', 'success');
}

function applyAntiSgamo() {
    if (!State.calc) return;
    
    const roundedStakes = State.calc.stakes.map(s => Math.round(s / 5) * 5);
    const totalRounded = roundedStakes.reduce((a, b) => a + b, 0);
    
    // Ricalcola
    const returns = roundedStakes.map((s, i) => s * State.calc.quotes[i]);
    const minReturn = Math.min(...returns);
    const newProfit = minReturn - totalRounded;
    const newROI = totalRounded > 0 ? (newProfit / totalRounded) * 100 : 0;
    
    State.calc.stakes = roundedStakes;
    State.calc.totalStake = totalRounded;
    State.calc.totalProfit = newProfit;
    State.calc.roi = newROI;
    State.calc.contributionA = roundedStakes.map(s => s * State.calc.shareA);
    State.calc.contributionB = roundedStakes.map(s => s * State.calc.shareB);
    State.calc.profitA = newProfit * State.calc.shareA;
    State.calc.profitB = newProfit * State.calc.shareB;
    
    displayResults();
    notify('🎭 Anti-Sgamo applicato', 'success');
}

function saveCalculation() {
    if (!State.calc || State.id === 'OBSERVER') {
        notify('Non puoi salvare', 'error');
        return;
    }
    
    const totalContribA = State.calc.contributionA.reduce((a, b) => a + b, 0);
    const totalContribB = State.calc.contributionB.reduce((a, b) => a + b, 0);
    
    State.ws.send(JSON.stringify({
        type: 'REQUEST_BET',
        betData: {
            description: `Surebet ${State.calc.names.length} esiti (${State.calc.names.join('/')})`,
            investA: totalContribA,
            investB: totalContribB,
            returnA: State.calc.totalReturn * State.calc.shareA,
            returnB: State.calc.totalReturn * State.calc.shareB,
            profitA: State.calc.profitA,
            profitB: State.calc.profitB,
            stakes: State.calc.stakes,
            quotes: State.calc.quotes,
            names: State.calc.names
        }
    }));
    
    notify('Richiesta inviata per approvazione!', 'success');
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

// ========== BOOKMAKERS ==========

function renderBookmakers() {
    const list = document.getElementById('bmList');
    if (!list) return;
    const bms = State.data.bookmakers || [];
    if (!bms.length) {
        list.innerHTML = '<p style="color:var(--text-muted)">Nessun bookmaker</p>';
        return;
    }
    list.innerHTML = bms.map(bm => `
        <div style="background:var(--bg-hover);padding:15px;border-radius:8px;margin-bottom:10px;">
            <h4>${bm.name}</h4>
            <p style="color:var(--text-muted);font-size:0.8rem;">${bm.id}</p>
        </div>
    `).join('');
}

function addBookmaker() {
    const name = prompt('Nome bookmaker:');
    if (!name) return;
    State.ws.send(JSON.stringify({ type: 'ADD_BOOKMAKER', name: name }));
    notify('Bookmaker aggiunto', 'success');
}

// ========== HISTORY ==========

function renderHistory() {
    const tb = document.getElementById('histBody');
    if (!tb) return;
    const ops = State.data.operations || [];
    if (!ops.length) {
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Nessuna operazione</td></tr>';
        return;
    }
    tb.innerHTML = ops.slice().reverse().map(o => `
        <tr>
            <td>${new Date(o.timestamp).toLocaleString()}</td>
            <td>${o.description || 'Bet'}</td>
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
    
    const list = document.getElementById('listApprovals');
    if (!list) return;
    if (appr.requestedBy === State.id) return;
    
    const empty = list.querySelector('p');
    if (empty) empty.remove();
    
    const info = appr.type === 'BALANCE_UPDATE' 
        ? `${appr.targetPlayer}: ${appr.amount > 0 ? '+' : ''}${fmt(appr.amount)}`
        : `Profitto: ${fmt(appr.data?.totalProfit || 0)}`;
    
    const div = document.createElement('div');
    div.id = `approval-${appr.id}`;
    div.style.cssText = 'background:var(--bg-hover);padding:15px;border-radius:8px;margin-bottom:10px;border-left:3px solid var(--warning);';
    div.innerHTML = `
        <h5>${appr.type === 'BALANCE_UPDATE' ? '💰 Saldo' : '🎲 Bet'}</h5>
        <p>Da: Giocatore ${appr.requestedBy}<br>${info}</p>
        <div style="display:flex;gap:10px;margin-top:10px;">
            <button class="btn btn-primary" onclick="respondApproval('${appr.id}', true)" style="flex:1;">✅</button>
            <button class="btn btn-secondary" onclick="respondApproval('${appr.id}', false)" style="flex:1;">❌</button>
        </div>
    `;
    list.appendChild(div);
    
    updateBadge();
}

function removeApproval(id) {
    const el = document.getElementById(`approval-${id}`);
    if (el) el.remove();
    
    const remaining = document.querySelectorAll('[id^="approval-"]').length;
    if (remaining === 0) {
        const list = document.getElementById('listApprovals');
        if (list) list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Nessuna richiesta</p>';
    }
    updateBadge();
}

function updateBadge() {
    const badge = document.getElementById('badgeApp');
    if (!badge) return;
    const count = document.querySelectorAll('[id^="approval-"]').length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'block' : 'none';
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
    const isMine = msg.playerId === State.id;
    div.style.cssText = isMine 
        ? 'align-self:flex-end;background:var(--primary);color:#000;padding:10px 15px;border-radius:15px;margin:5px 0;max-width:80%;'
        : 'align-self:flex-start;background:var(--bg-hover);padding:10px 15px;border-radius:15px;margin:5px 0;max-width:80%;';
    
    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    div.innerHTML = `${escapeHtml(msg.text)}<div style="font-size:0.75rem;opacity:0.7;margin-top:5px;">${msg.playerName} • ${time}</div>`;
    
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
        const bms = (State.data.bookmakers || []).map(bm => `<option value="${bm.id}">${bm.name}</option>`).join('');
        t.textContent = '🎲 Nuova Scommessa';
        b.innerHTML = `
            <div class="form-group">
                <label>Evento</label>
                <input type="text" id="mEvent" placeholder="Es: Milan-Inter">
            </div>
            <div class="form-group">
                <label>Bookmaker A</label>
                <select id="mBookA"><option value="">-</option>${bms}</select>
            </div>
            <div class="form-group">
                <label>Bookmaker B</label>
                <select id="mBookB"><option value="">-</option>${bms}</select>
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
            notify('✅ File caricato!', 'success');
        } catch (err) {
            notify('❌ File non valido', 'error');
        }
    };
    reader.readAsText(file);
}

// ========== SETTINGS ==========

function setTheme(color) {
    const colors = { green: '#00ff88', blue: '#00d9ff', red: '#ff4757', purple: '#a55eea', orange: '#ffa502' };
    document.documentElement.style.setProperty('--primary', colors[color]);
    State.ws.send(JSON.stringify({ type: 'UPDATE_SETTINGS', settings: { theme: color } }));
}

function saveProfile() {
    const name = document.getElementById('settName');
    if (name && name.value.trim()) {
        State.ws.send(JSON.stringify({ type: 'UPDATE_SETTINGS', settings: { name: name.value.trim() } }));
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
    if (id === 'bookmakers') renderBookmakers();
    if (id === 'calculator') initCalculator();
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
    div.style.cssText = 'position:fixed;top:80px;right:20px;background:var(--bg-card);padding:15px 20px;border-radius:8px;border-left:4px solid ' + (type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--primary)') + ';z-index:2000;box-shadow:0 5px 20px rgba(0,0,0,0.3);max-width:300px;animation:slideIn 0.3s;';
    const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅';
    div.innerHTML = `<b>${icon}</b> ${msg}`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

// ========== INIT ==========

document.addEventListener('DOMContentLoaded', () => {
    console.log('App loaded, v1.0');
});
