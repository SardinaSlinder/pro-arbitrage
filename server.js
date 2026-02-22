const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Stato applicazione con bookmakers
const AppState = {
    players: {
        A: { id: 'A', name: 'Giocatore A', balance: 0, invested: 0, won: 0, connected: false, ws: null },
        B: { id: 'B', name: 'Giocatore B', balance: 0, invested: 0, won: 0, connected: false, ws: null }
    },
    operations: [],
    messages: [],
    pendingApprovals: [],
    bookmakers: [
        { id: 'bet365', name: 'Bet365', logo: 'B365' },
        { id: 'william', name: 'William Hill', logo: 'WH' },
        { id: 'pinnacle', name: 'Pinnacle', logo: 'PIN' },
        { id: 'betfair', name: 'Betfair', logo: 'BF' }
    ],
    bookmakerStats: {}, // { bookmakerId: { A: {invested: 0, won: 0}, B: {...} } }
    createdAt: Date.now()
};

// Carica dati da file se esiste
function loadData() {
    try {
        if (fs.existsSync('data.json')) {
            const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
            AppState.players.A.balance = data.players?.A?.balance || 0;
            AppState.players.A.invested = data.players?.A?.invested || 0;
            AppState.players.A.won = data.players?.A?.won || 0;
            AppState.players.B.balance = data.players?.B?.balance || 0;
            AppState.players.B.invested = data.players?.B?.invested || 0;
            AppState.players.B.won = data.players?.B?.won || 0;
            AppState.operations = data.operations || [];
            AppState.bookmakers = data.bookmakers || AppState.bookmakers;
            AppState.bookmakerStats = data.bookmakerStats || {};
            console.log('✅ Dati caricati da data.json');
        }
    } catch (err) {
        console.log('⚠️ Nessun dato salvato trovato');
    }
}

// Salva dati su file
function saveData() {
    try {
        const data = {
            players: {
                A: { balance: AppState.players.A.balance, invested: AppState.players.A.invested, won: AppState.players.A.won },
                B: { balance: AppState.players.B.balance, invested: AppState.players.B.invested, won: AppState.players.B.won }
            },
            operations: AppState.operations,
            bookmakers: AppState.bookmakers,
            bookmakerStats: AppState.bookmakerStats
        };
        fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Errore salvataggio:', err);
    }
}

// Salva ogni 30 secondi
setInterval(saveData, 30000);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// API per export/import
app.get('/api/export', (req, res) => {
    res.json({
        players: {
            A: { balance: AppState.players.A.balance, invested: AppState.players.A.invested, won: AppState.players.A.won, name: AppState.players.A.name },
            B: { balance: AppState.players.B.balance, invested: AppState.players.B.invested, won: AppState.players.B.won, name: AppState.players.B.name }
        },
        operations: AppState.operations,
        bookmakers: AppState.bookmakers,
        bookmakerStats: AppState.bookmakerStats,
        exportedAt: new Date().toISOString()
    });
});

app.post('/api/import', (req, res) => {
    try {
        const data = req.body;
        if (data.players) {
            AppState.players.A.balance = data.players.A?.balance || 0;
            AppState.players.A.invested = data.players.A?.invested || 0;
            AppState.players.A.won = data.players.A?.won || 0;
            AppState.players.A.name = data.players.A?.name || 'Giocatore A';
            AppState.players.B.balance = data.players.B?.balance || 0;
            AppState.players.B.invested = data.players.B?.invested || 0;
            AppState.players.B.won = data.players.B?.won || 0;
            AppState.players.B.name = data.players.B?.name || 'Giocatore B';
        }
        if (data.operations) AppState.operations = data.operations;
        if (data.bookmakers) AppState.bookmakers = data.bookmakers;
        if (data.bookmakerStats) AppState.bookmakerStats = data.bookmakerStats;
        
        saveData();
        
        // Notifica tutti i client
        broadcast({
            type: 'DATA_IMPORTED',
            state: {
                players: { A: { ...AppState.players.A, ws: undefined }, B: { ...AppState.players.B, ws: undefined } },
                operations: AppState.operations,
                bookmakers: AppState.bookmakers,
                bookmakerStats: AppState.bookmakerStats
            }
        });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Date.now() - AppState.createdAt });
});

function broadcast(data, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function sendState(ws, playerId) {
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        playerId: playerId,
        state: {
            players: { A: { ...AppState.players.A, ws: undefined }, B: { ...AppState.players.B, ws: undefined } },
            operations: AppState.operations,
            messages: AppState.messages.slice(-100),
            pendingApprovals: AppState.pendingApprovals,
            bookmakers: AppState.bookmakers,
            bookmakerStats: AppState.bookmakerStats
        }
    }));
}

wss.on('connection', (ws, req) => {
    console.log('Nuova connessione');
    let playerId = null;
    let chosenRole = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Prima scelta del ruolo
            if (data.type === 'CHOOSE_ROLE') {
                const requestedRole = data.role; // 'A', 'B', o 'AUTO'
                
                if (requestedRole === 'AUTO') {
                    // Assegnazione automatica
                    if (!AppState.players.A.connected) chosenRole = 'A';
                    else if (!AppState.players.B.connected) chosenRole = 'B';
                    else chosenRole = 'OBSERVER';
                } else {
                    // Scelta specifica
                    if (!AppState.players[requestedRole].connected) {
                        chosenRole = requestedRole;
                    } else if (!AppState.players.A.connected) {
                        chosenRole = 'A';
                    } else if (!AppState.players.B.connected) {
                        chosenRole = 'B';
                    } else {
                        chosenRole = 'OBSERVER';
                    }
                }
                
                playerId = chosenRole;
                
                if (playerId === 'A' || playerId === 'B') {
                    AppState.players[playerId].connected = true;
                    AppState.players[playerId].ws = ws;
                    if (data.name) AppState.players[playerId].name = data.name;
                }
                
                console.log(`Player ${playerId} assegnato`);
                sendState(ws, playerId);
                
                broadcast({
                    type: 'PLAYER_CONNECTED',
                    playerId: playerId,
                    playerName: playerId !== 'OBSERVER' ? AppState.players[playerId].name : 'Osservatore'
                }, ws);
                
                return;
            }
            
            // Gestione messaggi normali
            handleMessage(ws, playerId, data);
            
        } catch (err) {
            console.error('Errore:', err);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Formato non valido' }));
        }
    });

    ws.on('close', () => {
        if (playerId === 'A' || playerId === 'B') {
            AppState.players[playerId].connected = false;
            AppState.players[playerId].ws = null;
            AppState.pendingApprovals = AppState.pendingApprovals.filter(a => a.requestedBy !== playerId);
            broadcast({ type: 'PLAYER_DISCONNECTED', playerId: playerId });
        }
    });
});

function handleMessage(ws, playerId, data) {
    if (!playerId) return;
    
    if (playerId === 'OBSERVER' && !['CHAT_MESSAGE', 'REQUEST_SYNC'].includes(data.type)) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Sola lettura' }));
        return;
    }

    switch(data.type) {
        case 'CHAT_MESSAGE':
            const msg = {
                id: uuidv4(),
                playerId: playerId,
                playerName: AppState.players[playerId]?.name || 'Sconosciuto',
                text: data.text.substring(0, 500),
                timestamp: Date.now()
            };
            AppState.messages.push(msg);
            if (AppState.messages.length > 200) AppState.messages = AppState.messages.slice(-200);
            broadcast({ type: 'NEW_MESSAGE', message: msg });
            break;

        case 'REQUEST_BALANCE_UPDATE':
            const approvalId = uuidv4();
            const approval = {
                id: approvalId,
                type: 'BALANCE_UPDATE',
                requestedBy: playerId,
                targetPlayer: data.targetPlayer,
                amount: data.amount,
                timestamp: Date.now(),
                status: 'pending'
            };
            AppState.pendingApprovals.push(approval);
            broadcast({ type: 'APPROVAL_REQUIRED', approval: approval });
            break;

        case 'REQUEST_BET':
            const betApprovalId = uuidv4();
            const betApproval = {
                id: betApprovalId,
                type: 'NEW_BET',
                requestedBy: playerId,
                data: data.betData,
                timestamp: Date.now(),
                status: 'pending'
            };
            AppState.pendingApprovals.push(betApproval);
            broadcast({ type: 'APPROVAL_REQUIRED', approval: betApproval });
            break;

        case 'APPROVE':
        case 'REJECT':
            handleApproval(data.approvalId, playerId, data.type === 'APPROVE');
            break;

        case 'CONFIRM_SETTLEMENT':
            executeSettlement();
            break;

        case 'ADD_BOOKMAKER':
            const newBm = {
                id: uuidv4(),
                name: data.name,
                logo: data.logo || data.name.substring(0, 3).toUpperCase()
            };
            AppState.bookmakers.push(newBm);
            saveData();
            broadcast({ type: 'BOOKMAKERS_UPDATED', bookmakers: AppState.bookmakers });
            break;

        case 'UPDATE_SETTINGS':
            if (data.settings.name && AppState.players[playerId]) {
                AppState.players[playerId].name = data.settings.name;
            }
            broadcast({ type: 'SETTINGS_UPDATED', settings: data.settings, playerId: playerId });
            break;

        case 'REQUEST_SYNC':
            sendState(ws, playerId);
            break;
    }
}

function handleApproval(approvalId, responderId, approved) {
    const idx = AppState.pendingApprovals.findIndex(a => a.id === approvalId);
    if (idx === -1) return;
    
    const approval = AppState.pendingApprovals[idx];
    if (approval.requestedBy === responderId) {
        const responder = AppState.players[responderId].ws;
        if (responder) responder.send(JSON.stringify({ type: 'ERROR', message: 'Non puoi approvare la tua richiesta' }));
        return;
    }

    if (approved) {
        if (approval.type === 'BALANCE_UPDATE') {
            const target = AppState.players[approval.targetPlayer];
            target.balance += approval.amount;
            broadcast({ type: 'BALANCE_UPDATED', playerId: approval.targetPlayer, newBalance: target.balance, approvedBy: responderId });
            
        } else if (approval.type === 'NEW_BET') {
            const bet = { ...approval.data, id: uuidv4(), timestamp: Date.now(), approvedBy: responderId };
            
            // Aggiorna saldi
            AppState.players.A.balance += bet.profitA || 0;
            AppState.players.A.invested += bet.investA || 0;
            AppState.players.A.won += bet.returnA || 0;
            AppState.players.B.balance += bet.profitB || 0;
            AppState.players.B.invested += bet.investB || 0;
            AppState.players.B.won += bet.returnB || 0;
            
            // Aggiorna stats bookmaker
            if (bet.bookmakerA) {
                if (!AppState.bookmakerStats[bet.bookmakerA]) AppState.bookmakerStats[bet.bookmakerA] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
                AppState.bookmakerStats[bet.bookmakerA].A.invested += bet.investA || 0;
                AppState.bookmakerStats[bet.bookmakerA].A.won += bet.returnA || 0;
            }
            if (bet.bookmakerB) {
                if (!AppState.bookmakerStats[bet.bookmakerB]) AppState.bookmakerStats[bet.bookmakerB] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
                AppState.bookmakerStats[bet.bookmakerB].B.invested += bet.investB || 0;
                AppState.bookmakerStats[bet.bookmakerB].B.won += bet.returnB || 0;
            }
            
            AppState.operations.push(bet);
            saveData();
            
            broadcast({
                type: 'BET_EXECUTED',
                bet: bet,
                players: { A: { ...AppState.players.A, ws: undefined }, B: { ...AppState.players.B, ws: undefined } },
                bookmakerStats: AppState.bookmakerStats
            });
        }
        
        AppState.pendingApprovals.splice(idx, 1);
        broadcast({ type: 'APPROVAL_RESULT', approvalId: approvalId, result: 'approved', approvedBy: responderId });
    } else {
        AppState.pendingApprovals.splice(idx, 1);
        broadcast({ type: 'APPROVAL_RESULT', approvalId: approvalId, result: 'rejected', rejectedBy: responderId });
    }
}

function executeSettlement() {
    const balanceA = AppState.players.A.balance;
    const balanceB = AppState.players.B.balance;
    const total = balanceA + balanceB;
    const half = total / 2;
    const diff = balanceA - half;
    
    if (Math.abs(diff) > 0.01) {
        AppState.players.A.balance -= diff;
        AppState.players.B.balance += diff;
        saveData();
        broadcast({
            type: 'SETTLEMENT_EXECUTED',
            amount: Math.abs(diff),
            from: diff > 0 ? 'A' : 'B',
            to: diff > 0 ? 'B' : 'A',
            newBalances: { A: AppState.players.A.balance, B: AppState.players.B.balance }
        });
    }
}

// Carica dati all'avvio
loadData();

server.listen(PORT, () => {
    console.log(`🚀 Server su porta ${PORT}`);
});
