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

// Stato completo
const AppState = {
    players: {
        A: { id: 'A', name: 'Giocatore A', balance: 0, invested: 0, won: 0, connected: false, ws: null },
        B: { id: 'B', name: 'Giocatore B', balance: 0, invested: 0, won: 0, connected: false, ws: null }
    },
    operations: [],
    messages: [],
    pendingApprovals: [],
    bookmakers: [
        { id: 'bet365', name: 'Bet365' },
        { id: 'william', name: 'William Hill' },
        { id: 'pinnacle', name: 'Pinnacle' },
        { id: 'betfair', name: 'Betfair' },
        { id: 'snai', name: 'SNAI' }
    ],
    bookmakerStats: {},
    settings: { theme: 'green' }
};

// Persistenza
function loadData() {
    try {
        if (fs.existsSync('data.json')) {
            const saved = JSON.parse(fs.readFileSync('data.json', 'utf8'));
            Object.assign(AppState.players.A, saved.players?.A || {});
            Object.assign(AppState.players.B, saved.players?.B || {});
            AppState.operations = saved.operations || [];
            AppState.bookmakers = saved.bookmakers || AppState.bookmakers;
            AppState.bookmakerStats = saved.bookmakerStats || {};
            console.log('✅ Dati caricati');
        }
    } catch (e) {
        console.log('⚠️ Nessun dato salvato');
    }
}

function saveData() {
    try {
        const toSave = {
            players: {
                A: { balance: AppState.players.A.balance, invested: AppState.players.A.invested, won: AppState.players.A.won, name: AppState.players.A.name },
                B: { balance: AppState.players.B.balance, invested: AppState.players.B.invested, won: AppState.players.B.won, name: AppState.players.B.name }
            },
            operations: AppState.operations,
            bookmakers: AppState.bookmakers,
            bookmakerStats: AppState.bookmakerStats
        };
        fs.writeFileSync('data.json', JSON.stringify(toSave, null, 2));
    } catch (e) {
        console.error('Errore salvataggio:', e);
    }
}

setInterval(saveData, 30000);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// API Export/Import
app.get('/api/export', (req, res) => {
    res.json({
        players: AppState.players,
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
            AppState.players.B.balance = data.players.B?.balance || 0;
            AppState.players.B.invested = data.players.B?.invested || 0;
            AppState.players.B.won = data.players.B?.won || 0;
        }
        if (data.operations) AppState.operations = data.operations;
        if (data.bookmakers) AppState.bookmakers = data.bookmakers;
        if (data.bookmakerStats) AppState.bookmakerStats = data.bookmakerStats;
        saveData();
        
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function broadcast(data, exclude) {
    wss.clients.forEach(c => {
        if (c !== exclude && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(data));
        }
    });
}

function sendState(ws, playerId) {
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        playerId: playerId,
        state: {
            players: {
                A: { ...AppState.players.A, ws: undefined, connected: AppState.players.A.connected },
                B: { ...AppState.players.B, ws: undefined, connected: AppState.players.B.connected }
            },
            operations: AppState.operations,
            messages: AppState.messages.slice(-50),
            pendingApprovals: AppState.pendingApprovals,
            bookmakers: AppState.bookmakers,
            bookmakerStats: AppState.bookmakerStats
        }
    }));
}

wss.on('connection', (ws) => {
    console.log('Nuova connessione');
    let playerId = null;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            
            if (data.type === 'CHOOSE_ROLE') {
                // Scelta ruolo
                let role = data.role;
                if (role === 'AUTO') {
                    if (!AppState.players.A.connected) role = 'A';
                    else if (!AppState.players.B.connected) role = 'B';
                    else role = 'OBSERVER';
                }
                
                // Verifica disponibilità
                if (role !== 'OBSERVER' && AppState.players[role].connected) {
                    if (!AppState.players.A.connected) role = 'A';
                    else if (!AppState.players.B.connected) role = 'B';
                    else role = 'OBSERVER';
                }
                
                playerId = role;
                
                if (playerId === 'A' || playerId === 'B') {
                    AppState.players[playerId].connected = true;
                    AppState.players[playerId].ws = ws;
                    if (data.name) AppState.players[playerId].name = data.name;
                }
                
                sendState(ws, playerId);
                broadcast({
                    type: 'PLAYER_CONNECTED',
                    playerId: playerId,
                    playerName: playerId !== 'OBSERVER' ? AppState.players[playerId].name : 'Osservatore'
                }, ws);
                return;
            }
            
            // Altri messaggi
            handleMsg(ws, playerId, data);
            
        } catch (e) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Errore: ' + e.message }));
        }
    });

    ws.on('close', () => {
        if (playerId && AppState.players[playerId]) {
            AppState.players[playerId].connected = false;
            AppState.players[playerId].ws = null;
            broadcast({ type: 'PLAYER_DISCONNECTED', playerId: playerId });
        }
    });
});

function handleMsg(ws, playerId, data) {
    if (!playerId) return;
    if (playerId === 'OBSERVER' && !['CHAT_MESSAGE', 'REQUEST_SYNC'].includes(data.type)) {
        return ws.send(JSON.stringify({ type: 'ERROR', message: 'Sola lettura' }));
    }

    switch(data.type) {
        case 'CHAT_MESSAGE':
            const msg = {
                id: uuidv4(),
                playerId: playerId,
                playerName: AppState.players[playerId]?.name || 'Osservatore',
                text: data.text.substring(0, 500),
                timestamp: Date.now()
            };
            AppState.messages.push(msg);
            if (AppState.messages.length > 100) AppState.messages = AppState.messages.slice(-100);
            broadcast({ type: 'NEW_MESSAGE', message: msg });
            break;

        case 'REQUEST_BALANCE_UPDATE':
            const appr = {
                id: uuidv4(),
                type: 'BALANCE_UPDATE',
                requestedBy: playerId,
                targetPlayer: data.targetPlayer,
                amount: data.amount,
                timestamp: Date.now()
            };
            AppState.pendingApprovals.push(appr);
            broadcast({ type: 'APPROVAL_REQUIRED', approval: appr });
            break;

        case 'REQUEST_BET':
            const betAppr = {
                id: uuidv4(),
                type: 'NEW_BET',
                requestedBy: playerId,
                data: data.betData,
                timestamp: Date.now()
            };
            AppState.pendingApprovals.push(betAppr);
            broadcast({ type: 'APPROVAL_REQUIRED', approval: betAppr });
            break;

        case 'APPROVE':
        case 'REJECT':
            handleApproval(data.approvalId, playerId, data.type === 'APPROVE');
            break;

        case 'CONFIRM_SETTLEMENT':
            const balA = AppState.players.A.balance;
            const balB = AppState.players.B.balance;
            const diff = balA - (balA + balB) / 2;
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
            break;

        case 'ADD_BOOKMAKER':
            const bm = { id: uuidv4(), name: data.name };
            AppState.bookmakers.push(bm);
            saveData();
            broadcast({ type: 'BOOKMAKERS_UPDATED', bookmakers: AppState.bookmakers });
            break;

        case 'UPDATE_SETTINGS':
            if (data.settings.name && AppState.players[playerId]) {
                AppState.players[playerId].name = data.settings.name;
            }
            if (data.settings.theme) {
                AppState.settings.theme = data.settings.theme;
            }
            broadcast({ type: 'SETTINGS_UPDATED', settings: data.settings, playerId: playerId });
            break;

        case 'REQUEST_SYNC':
            sendState(ws, playerId);
            break;
    }
}

function handleApproval(id, responder, approved) {
    const idx = AppState.pendingApprovals.findIndex(a => a.id === id);
    if (idx === -1) return;
    
    const appr = AppState.pendingApprovals[idx];
    if (appr.requestedBy === responder) {
        return AppState.players[responder]?.ws?.send(JSON.stringify({ type: 'ERROR', message: 'Non puoi auto-approvare' }));
    }

    if (approved) {
        if (appr.type === 'BALANCE_UPDATE') {
            const t = AppState.players[appr.targetPlayer];
            t.balance += appr.amount;
            broadcast({ type: 'BALANCE_UPDATED', playerId: appr.targetPlayer, newBalance: t.balance });
        } else if (appr.type === 'NEW_BET') {
            const bet = { ...appr.data, id: uuidv4(), timestamp: Date.now() };
            
            AppState.players.A.balance += bet.profitA || 0;
            AppState.players.A.invested += bet.investA || 0;
            AppState.players.A.won += bet.returnA || 0;
            AppState.players.B.balance += bet.profitB || 0;
            AppState.players.B.invested += bet.investB || 0;
            AppState.players.B.won += bet.returnB || 0;
            
            // Stats bookmaker
            if (bet.bookmakerA) {
                if (!AppState.bookmakerStats[bet.bookmakerA]) AppState.bookmakerStats[bet.bookmakerA] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
                AppState.bookmakerStats[bet.bookmakerA].A.invested += bet.investA;
                AppState.bookmakerStats[bet.bookmakerA].A.won += bet.returnA;
            }
            if (bet.bookmakerB) {
                if (!AppState.bookmakerStats[bet.bookmakerB]) AppState.bookmakerStats[bet.bookmakerB] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
                AppState.bookmakerStats[bet.bookmakerB].B.invested += bet.investB;
                AppState.bookmakerStats[bet.bookmakerB].B.won += bet.returnB;
            }
            
            AppState.operations.push(bet);
            saveData();
            
            broadcast({
                type: 'BET_EXECUTED',
                bet: bet,
                players: {
                    A: { ...AppState.players.A, ws: undefined, connected: AppState.players.A.connected },
                    B: { ...AppState.players.B, ws: undefined, connected: AppState.players.B.connected }
                },
                bookmakerStats: AppState.bookmakerStats
            });
        }
        AppState.pendingApprovals.splice(idx, 1);
        broadcast({ type: 'APPROVAL_RESULT', approvalId: id, result: 'approved' });
    } else {
        AppState.pendingApprovals.splice(idx, 1);
        broadcast({ type: 'APPROVAL_RESULT', approvalId: id, result: 'rejected' });
    }
}

loadData();

server.listen(PORT, () => {
    console.log(`🚀 Server su porta ${PORT}`);
});
