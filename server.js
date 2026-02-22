const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Stato persistente
const STATE_FILE = './data/state.json';
let state = {
    players: {
        A: { name: '', balance: 0, invested: 0, won: 0, connected: false, ws: null },
        B: { name: '', balance: 0, invested: 0, won: 0, connected: false, ws: null }
    },
    operations: [],
    bookmakers: [],
    bookmakerStats: {},
    pendingApprovals: [],
    settings: { theme: 'green' }
};

// Carica stato
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            state = { ...state, ...data };
            // Reset connessioni WebSocket (non serializzabili)
            state.players.A.connected = false;
            state.players.B.connected = false;
            state.players.A.ws = null;
            state.players.B.ws = null;
        }
    } catch (err) {
        console.error('Errore caricamento stato:', err);
    }
}

// Salva stato
function saveState() {
    try {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data');
        const saveData = {
            players: {
                A: { ...state.players.A, ws: null, connected: false },
                B: { ...state.players.B, ws: null, connected: false }
            },
            operations: state.operations,
            bookmakers: state.bookmakers,
            bookmakerStats: state.bookmakerStats,
            pendingApprovals: state.pendingApprovals,
            settings: state.settings
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(saveData, null, 2));
    } catch (err) {
        console.error('Errore salvataggio stato:', err);
    }
}

// Rimuove i WebSocket dallo stato prima di inviarlo ai client
function sanitizeState() {
    return {
        players: {
            A: { ...state.players.A, ws: undefined },
            B: { ...state.players.B, ws: undefined }
        },
        operations: state.operations,
        bookmakers: state.bookmakers,
        bookmakerStats: state.bookmakerStats,
        pendingApprovals: state.pendingApprovals,
        settings: state.settings
    };
}

// Broadcast a tutti i client connessi
function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Invia messaggio a un giocatore specifico
function sendToPlayer(playerId, data) {
    const player = state.players[playerId];
    if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(data));
    }
}

// Gestione WebSocket
wss.on('connection', (ws) => {
    let playerId = null;
    let playerName = '';

    console.log('Nuova connessione WebSocket');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Messaggio ricevuto:', data.type, 'da', playerId || 'non autenticato');

            switch(data.type) {
                case 'CHOOSE_ROLE':
                    playerId = data.role;
                    playerName = data.name;

                    if (playerId === 'OBSERVER') {
                        ws.send(JSON.stringify({
                            type: 'INIT_STATE',
                            playerId: 'OBSERVER',
                            state: sanitizeState()
                        }));
                        console.log('Osservatore connesso');
                        return;
                    }

                    // Controlla se ruolo già occupato
                    if (state.players[playerId].connected && state.players[playerId].ws) {
                        ws.send(JSON.stringify({
                            type: 'ERROR',
                            message: 'Ruolo già occupato da un altro utente'
                        }));
                        ws.close();
                        return;
                    }

                    // Assegna ruolo
                    state.players[playerId].connected = true;
                    state.players[playerId].name = playerName;
                    state.players[playerId].ws = ws;

                    // Invia stato iniziale (INCLUDENDO le pendingApprovals!)
                    ws.send(JSON.stringify({
                        type: 'INIT_STATE',
                        playerId: playerId,
                        state: sanitizeState()
                    }));

                    // Notifica gli ALTRI giocatori
                    broadcast({
                        type: 'PLAYER_CONNECTED',
                        playerId: playerId,
                        playerName: playerName
                    }, ws);

                    console.log(`Giocatore ${playerId} (${playerName}) connesso`);
                    saveState();
                    break;

                case 'REQUEST_BALANCE_UPDATE':
                    if (!playerId || playerId === 'OBSERVER') {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Non autorizzato' }));
                        return;
                    }

                    const balanceApprovalId = uuidv4();
                    const balanceApproval = {
                        id: balanceApprovalId,
                        type: 'BALANCE_UPDATE',
                        requestedBy: playerId,
                        targetPlayer: data.targetPlayer,
                        amount: data.amount,
                        status: 'pending',
                        timestamp: Date.now()
                    };

                    state.pendingApprovals.push(balanceApproval);
                    saveState();

                    // Broadcast a TUTTI (incluso il mittente per conferma, ma lui la ignorerà)
                    broadcast({
                        type: 'APPROVAL_REQUIRED',
                        approval: balanceApproval
                    });

                    console.log(`Nuova richiesta saldo: ${balanceApprovalId} da ${playerId}`);
                    break;

                case 'REQUEST_BET':
                    if (!playerId || playerId === 'OBSERVER') {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Non autorizzato' }));
                        return;
                    }

                    const betApprovalId = uuidv4();
                    const betApproval = {
                        id: betApprovalId,
                        type: 'BET',
                        requestedBy: playerId,
                        data: data.betData,
                        status: 'pending',
                        timestamp: Date.now()
                    };

                    state.pendingApprovals.push(betApproval);
                    saveState();

                    // Broadcast a TUTTI
                    broadcast({
                        type: 'APPROVAL_REQUIRED',
                        approval: betApproval
                    });

                    console.log(`Nuova richiesta bet: ${betApprovalId} da ${playerId}`);
                    break;

                case 'APPROVE':
                case 'REJECT':
                    if (!playerId || playerId === 'OBSERVER') {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Non autorizzato' }));
                        return;
                    }

                    const approvalIndex = state.pendingApprovals.findIndex(a => a.id === data.approvalId);
                    if (approvalIndex === -1) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Richiesta non trovata' }));
                        return;
                    }

                    const approval = state.pendingApprovals[approvalIndex];

                    // Non puoi approvare le tue richieste
                    if (approval.requestedBy === playerId) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Non puoi approvare le tue richieste' }));
                        return;
                    }

                    const isApproved = data.type === 'APPROVE';
                    approval.status = isApproved ? 'approved' : 'rejected';
                    approval.respondedBy = playerId;
                    approval.respondedAt = Date.now();

                    if (isApproved) {
                        if (approval.type === 'BALANCE_UPDATE') {
                            // Esegui modifica saldo
                            state.players[approval.targetPlayer].balance += approval.amount;
                            
                            // Notifica tutti del nuovo saldo
                            broadcast({
                                type: 'BALANCE_UPDATED',
                                playerId: approval.targetPlayer,
                                newBalance: state.players[approval.targetPlayer].balance,
                                approvedBy: playerId
                            });
                        } else if (approval.type === 'BET') {
                            // Esegui bet
                            executeBet(approval.data, playerId);
                        }
                    }

                    // Rimuovi dalle pending
                    state.pendingApprovals.splice(approvalIndex, 1);
                    saveState();

                    // Notifica tutti del risultato
                    broadcast({
                        type: 'APPROVAL_RESULT',
                        approvalId: approval.id,
                        result: approval.status,
                        approvedBy: playerId,
                        type: approval.type
                    });

                    console.log(`Richiesta ${approval.id} ${approval.status} da ${playerId}`);
                    break;

                case 'CONFIRM_SETTLEMENT':
                    if (!playerId || playerId === 'OBSERVER') {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Non autorizzato' }));
                        return;
                    }

                    const totalBalance = state.players.A.balance + state.players.B.balance;
                    const halfBalance = totalBalance / 2;

                    state.players.A.balance = halfBalance;
                    state.players.B.balance = halfBalance;

                    saveState();

                    broadcast({
                        type: 'SETTLEMENT_EXECUTED',
                        newBalances: {
                            A: state.players.A.balance,
                            B: state.players.B.balance
                        },
                        confirmedBy: playerId
                    });

                    console.log(`Settlement eseguito da ${playerId}`);
                    break;

                case 'CHAT_MESSAGE':
                    if (!playerId) return;

                    broadcast({
                        type: 'NEW_MESSAGE',
                        message: {
                            playerId: playerId,
                            playerName: state.players[playerId]?.name || 'Osservatore',
                            text: data.text,
                            timestamp: Date.now()
                        }
                    });
                    break;

                case 'ADD_BOOKMAKER':
                    if (!playerId || playerId === 'OBSERVER') {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Non autorizzato' }));
                        return;
                    }

                    const newBookmaker = {
                        id: uuidv4(),
                        name: data.name,
                        addedBy: playerId,
                        addedAt: Date.now()
                    };

                    state.bookmakers.push(newBookmaker);
                    saveState();

                    broadcast({
                        type: 'BOOKMAKERS_UPDATED',
                        bookmakers: state.bookmakers
                    });

                    console.log(`Bookmaker aggiunto: ${data.name}`);
                    break;

                case 'UPDATE_SETTINGS':
                    if (data.settings.name && playerId && playerId !== 'OBSERVER') {
                        state.players[playerId].name = data.settings.name;
                        saveState();
                        
                        // Notifica aggiornamento nome
                        broadcast({
                            type: 'PLAYER_UPDATED',
                            playerId: playerId,
                            name: data.settings.name
                        });
                    }
                    if (data.settings.theme) {
                        state.settings.theme = data.settings.theme;
                        saveState();
                    }
                    break;
            }
        } catch (err) {
            console.error('Errore elaborazione messaggio:', err);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Errore interno server' }));
        }
    });

    ws.on('close', () => {
        console.log('Connessione chiusa:', playerId || 'non autenticato');
        
        if (playerId && playerId !== 'OBSERVER' && state.players[playerId]) {
            state.players[playerId].connected = false;
            state.players[playerId].ws = null;
            
            broadcast({
                type: 'PLAYER_DISCONNECTED',
                playerId: playerId
            });
            
            saveState();
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

// Esegue una bet approvata
function executeBet(betData, approvedBy) {
    const operation = {
        ...betData,
        id: uuidv4(),
        timestamp: Date.now(),
        type: 'BET',
        approvedBy: approvedBy
    };

    // Aggiorna bilanci giocatori
    state.players.A.balance -= betData.investA;
    state.players.B.balance -= betData.investB;
    state.players.A.invested += betData.investA;
    state.players.B.invested += betData.investB;
    
    // Aggiorna vincite attese (simulazione - in realtà si aggiorna dopo l'esito)
    // Per ora assumiamo che la vincita sia "virtuale" fino al completamento

    state.operations.push(operation);

    // Aggiorna statistiche bookmaker
    if (betData.bookmakerA) {
        if (!state.bookmakerStats[betData.bookmakerA]) {
            state.bookmakerStats[betData.bookmakerA] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
        }
        state.bookmakerStats[betData.bookmakerA].A.invested += betData.investA;
    }
    if (betData.bookmakerB) {
        if (!state.bookmakerStats[betData.bookmakerB]) {
            state.bookmakerStats[betData.bookmakerB] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
        }
        state.bookmakerStats[betData.bookmakerB].B.invested += betData.investB;
    }

    saveState();

    // Notifica tutti
    broadcast({
        type: 'BET_EXECUTED',
        players: {
            A: { ...state.players.A, ws: undefined },
            B: { ...state.players.B, ws: undefined }
        },
        bet: operation,
        bookmakerStats: state.bookmakerStats,
        approvedBy: approvedBy
    });

    console.log(`Bet eseguita: ${operation.id}`);
}

// API Routes
app.get('/api/export', (req, res) => {
    res.json(sanitizeState());
});

app.post('/api/import', (req, res) => {
    try {
        const data = req.body;
        
        if (data.players) {
            state.players.A = { ...state.players.A, ...data.players.A, ws: null };
            state.players.B = { ...state.players.B, ...data.players.B, ws: null };
        }
        if (data.operations) state.operations = data.operations;
        if (data.bookmakers) state.bookmakers = data.bookmakers;
        if (data.bookmakerStats) state.bookmakerStats = data.bookmakerStats;
        if (data.pendingApprovals) state.pendingApprovals = data.pendingApprovals;
        if (data.settings) state.settings = data.settings;
        
        saveState();
        
        // Notifica tutti i client connessi del nuovo stato
        broadcast({
            type: 'DATA_IMPORTED',
            state: sanitizeState()
        });
        
        res.json({ success: true, message: 'Dati importati con successo' });
    } catch (err) {
        console.error('Errore import:', err);
        res.status(400).json({ error: err.message });
    }
});

// Health check per Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        players: {
            A: state.players.A.connected,
            B: state.players.B.connected
        },
        pendingApprovals: state.pendingApprovals.length
    });
});

// Start server
const PORT = process.env.PORT || 3000;
loadState();
server.listen(PORT, () => {
    console.log(`🚀 Server Arbitraggio Pro avviato su porta ${PORT}`);
    console.log(`📊 Stato iniziale: A=${state.players.A.balance}€, B=${state.players.B.balance}€`);
    console.log(`⏳ Pending approvals: ${state.pendingApprovals.length}`);
});
