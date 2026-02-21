const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Porta da environment variable (Render la imposta automaticamente)
const PORT = process.env.PORT || 3000;

// Stato applicazione
const AppState = {
    players: {
        A: { id: 'A', name: 'Giocatore A', balance: 0, invested: 0, won: 0, connected: false, ws: null },
        B: { id: 'B', name: 'Giocatore B', balance: 0, invested: 0, won: 0, connected: false, ws: null }
    },
    operations: [],
    messages: [],
    pendingApprovals: [],
    createdAt: Date.now()
};

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Health check per Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: Date.now() - AppState.createdAt,
        players: {
            A: { connected: AppState.players.A.connected, name: AppState.players.A.name },
            B: { connected: AppState.players.B.connected, name: AppState.players.B.name }
        }
    });
});

// Broadcast a tutti i client
function broadcast(data, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Invia stato a un client
function sendState(ws, playerId) {
    ws.send(JSON.stringify({
        type: 'INIT_STATE',
        playerId: playerId,
        state: {
            players: {
                A: { ...AppState.players.A, ws: undefined },
                B: { ...AppState.players.B, ws: undefined }
            },
            operations: AppState.operations,
            messages: AppState.messages.slice(-100),
            pendingApprovals: AppState.pendingApprovals
        }
    }));
}

// WebSocket connection
wss.on('connection', (ws, req) => {
    console.log('Nuova connessione da:', req.headers['x-forwarded-for'] || req.socket.remoteAddress);
    
    let playerId = null;
    
    // Assegna player ID
    if (!AppState.players.A.connected) {
        playerId = 'A';
        AppState.players.A.connected = true;
        AppState.players.A.ws = ws;
    } else if (!AppState.players.B.connected) {
        playerId = 'B';
        AppState.players.B.connected = true;
        AppState.players.B.ws = ws;
    } else {
        playerId = 'OBSERVER';
    }
    
    console.log(`Player ${playerId} assegnato`);
    sendState(ws, playerId);
    
    broadcast({
        type: 'PLAYER_CONNECTED',
        playerId: playerId,
        playerName: playerId !== 'OBSERVER' ? AppState.players[playerId].name : 'Osservatore'
    }, ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, playerId, data);
        } catch (err) {
            console.error('Errore parsing:', err);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Formato non valido' }));
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnesso`);
        
        if (playerId === 'A' || playerId === 'B') {
            AppState.players[playerId].connected = false;
            AppState.players[playerId].ws = null;
            
            // Rimuovi pending approvals di questo player
            AppState.pendingApprovals = AppState.pendingApprovals.filter(
                a => a.requestedBy !== playerId
            );
            
            broadcast({
                type: 'PLAYER_DISCONNECTED',
                playerId: playerId
            });
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

function handleMessage(ws, playerId, data) {
    if (playerId === 'OBSERVER' && 
        !['CHAT_MESSAGE', 'REQUEST_SYNC'].includes(data.type)) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Osservatori in sola lettura' }));
        return;
    }

    switch(data.type) {
        case 'CHAT_MESSAGE':
            const msg = {
                id: uuidv4(),
                playerId: playerId,
                playerName: playerId !== 'OBSERVER' ? 
                    AppState.players[playerId]?.name || 'Sconosciuto' : 'Osservatore',
                text: data.text.substring(0, 500),
                timestamp: Date.now()
            };
            
            AppState.messages.push(msg);
            if (AppState.messages.length > 200) {
                AppState.messages = AppState.messages.slice(-200);
            }
            
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

        case 'UPDATE_SETTINGS':
            if (data.settings.name && (playerId === 'A' || playerId === 'B')) {
                AppState.players[playerId].name = data.settings.name;
            }
            broadcast({
                type: 'SETTINGS_UPDATED',
                settings: data.settings,
                playerId: playerId
            });
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
        if (responder) {
            responder.send(JSON.stringify({
                type: 'ERROR',
                message: 'Non puoi approvare la tua richiesta'
            }));
        }
        return;
    }
    
    if (approved) {
        if (approval.type === 'BALANCE_UPDATE') {
            const target = AppState.players[approval.targetPlayer];
            target.balance += approval.amount;
            
            broadcast({
                type: 'BALANCE_UPDATED',
                playerId: approval.targetPlayer,
                newBalance: target.balance,
                approvedBy: responderId
            });
            
        } else if (approval.type === 'NEW_BET') {
            const bet = {
                ...approval.data,
                id: uuidv4(),
                timestamp: Date.now(),
                approvedBy: responderId
            };
            
            AppState.players.A.balance += bet.profitA || 0;
            AppState.players.A.invested += bet.investA || 0;
            AppState.players.A.won += bet.returnA || 0;
            
            AppState.players.B.balance += bet.profitB || 0;
            AppState.players.B.invested += bet.investB || 0;
            AppState.players.B.won += bet.returnB || 0;
            
            AppState.operations.push(bet);
            
            broadcast({
                type: 'BET_EXECUTED',
                bet: bet,
                players: {
                    A: { ...AppState.players.A, ws: undefined },
                    B: { ...AppState.players.B, ws: undefined }
                }
            });
        }
        
        AppState.pendingApprovals.splice(idx, 1);
        broadcast({
            type: 'APPROVAL_RESULT',
            approvalId: approvalId,
            result: 'approved',
            approvedBy: responderId
        });
        
    } else {
        AppState.pendingApprovals.splice(idx, 1);
        broadcast({
            type: 'APPROVAL_RESULT',
            approvalId: approvalId,
            result: 'rejected',
            rejectedBy: responderId
        });
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
        
        broadcast({
            type: 'SETTLEMENT_EXECUTED',
            amount: Math.abs(diff),
            from: diff > 0 ? 'A' : 'B',
            to: diff > 0 ? 'B' : 'A',
            newBalances: {
                A: AppState.players.A.balance,
                B: AppState.players.B.balance
            }
        });
    }
}

server.listen(PORT, () => {
    console.log(`
    🚀 Server Arbitraggio Pro avviato!
    Porta: ${PORT}
    Environment: ${process.env.RENDER ? 'Render' : 'Locale'}
    `);
});