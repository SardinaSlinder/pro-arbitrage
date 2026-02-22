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
           // Reset connessioni
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

// Broadcast a tutti i client
function broadcast(data, excludeWs = null) {
   wss.clients.forEach(client => {
       if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
           client.send(JSON.stringify(data));
       }
   });
}

// Invia a specifico player
function sendToPlayer(playerId, data) {
   const ws = state.players[playerId]?.ws;
   if (ws && ws.readyState === WebSocket.OPEN) {
       ws.send(JSON.stringify(data));
   }
}

// Gestione WebSocket
wss.on('connection', (ws) => {
   let playerId = null;
   let playerName = '';

   ws.on('message', (message) => {
       try {
           const data = JSON.parse(message);
           
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
                       return;
                   }
                   
                   if (state.players[playerId].connected) {
                       ws.send(JSON.stringify({
                           type: 'ERROR',
                           message: 'Ruolo già occupato'
                       }));
                       ws.close();
                       return;
                   }
                   
                   state.players[playerId].connected = true;
                   state.players[playerId].name = playerName;
                   state.players[playerId].ws = ws;
                   
                   ws.send(JSON.stringify({
                       type: 'INIT_STATE',
                       playerId: playerId,
                       state: sanitizeState()
                   }));
                   
                   broadcast({
                       type: 'PLAYER_CONNECTED',
                       playerId: playerId,
                       playerName: playerName
                   }, ws);
                   
                   saveState();
                   break;

               case 'REQUEST_BALANCE_UPDATE':
                   if (!playerId || playerId === 'OBSERVER') return;
                   
                   const approvalId = uuidv4();
                   const approval = {
                       id: approvalId,
                       type: 'BALANCE_UPDATE',
                       requestedBy: playerId,
                       targetPlayer: data.targetPlayer,
                       amount: data.amount,
                       status: 'pending',
                       timestamp: Date.now()
                   };
                   
                   state.pendingApprovals.push(approval);
                   broadcast({ type: 'APPROVAL_REQUIRED', approval: approval });
                   saveState();
                   break;

               case 'REQUEST_BET':
                   if (!playerId || playerId === 'OBSERVER') return;
                   
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
                   broadcast({ type: 'APPROVAL_REQUIRED', approval: betApproval });
                   saveState();
                   break;

               case 'APPROVE':
               case 'REJECT':
                   if (!playerId || playerId === 'OBSERVER') return;
                   
                   const appr = state.pendingApprovals.find(a => a.id === data.approvalId);
                   if (!appr || appr.requestedBy === playerId) return;
                   
                   appr.status = data.type === 'APPROVE' ? 'approved' : 'rejected';
                   appr.approvedBy = playerId;
                   
                   if (appr.status === 'approved') {
                       if (appr.type === 'BALANCE_UPDATE') {
                           state.players[appr.targetPlayer].balance += appr.amount;
                           broadcast({
                               type: 'BALANCE_UPDATED',
                               playerId: appr.targetPlayer,
                               newBalance: state.players[appr.targetPlayer].balance
                           });
                       } else if (appr.type === 'BET') {
                           executeBet(appr.data);
                       }
                   }
                   
                   broadcast({
                       type: 'APPROVAL_RESULT',
                       approvalId: appr.id,
                       result: appr.status
                   });
                   
                   state.pendingApprovals = state.pendingApprovals.filter(a => a.id !== appr.id);
                   saveState();
                   break;

               case 'CONFIRM_SETTLEMENT':
                   if (!playerId || playerId === 'OBSERVER') return;
                   
                   const total = state.players.A.balance + state.players.B.balance;
                   const half = total / 2;
                   
                   state.players.A.balance = half;
                   state.players.B.balance = half;
                   
                   broadcast({
                       type: 'SETTLEMENT_EXECUTED',
                       newBalances: {
                           A: state.players.A.balance,
                           B: state.players.B.balance
                       }
                   });
                   saveState();
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
                   if (!playerId || playerId === 'OBSERVER') return;
                   
                   const bm = {
                       id: uuidv4(),
                       name: data.name,
                       addedBy: playerId
                   };
                   state.bookmakers.push(bm);
                   broadcast({ type: 'BOOKMAKERS_UPDATED', bookmakers: state.bookmakers });
                   saveState();
                   break;

               case 'UPDATE_SETTINGS':
                   if (data.settings.name && playerId && playerId !== 'OBSERVER') {
                       state.players[playerId].name = data.settings.name;
                   }
                   if (data.settings.theme) {
                       state.settings.theme = data.settings.theme;
                   }
                   saveState();
                   break;
           }
       } catch (err) {
           console.error('Errore messaggio:', err);
       }
   });

   ws.on('close', () => {
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
});

// Esegue una bet
function executeBet(betData) {
   const op = {
       ...betData,
       id: uuidv4(),
       timestamp: Date.now(),
       type: 'BET'
   };
   
   state.operations.push(op);
   
   // Aggiorna bilanci
   state.players.A.balance -= betData.investA;
   state.players.B.balance -= betData.investB;
   state.players.A.invested += betData.investA;
   state.players.B.invested += betData.investB;
   
   // Aggiorna stats bookmaker
   if (betData.bookmakerA) {
       if (!state.bookmakerStats[betData.bookmakerA]) state.bookmakerStats[betData.bookmakerA] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
       state.bookmakerStats[betData.bookmakerA].A.invested += betData.investA;
   }
   if (betData.bookmakerB) {
       if (!state.bookmakerStats[betData.bookmakerB]) state.bookmakerStats[betData.bookmakerB] = { A: { invested: 0, won: 0 }, B: { invested: 0, won: 0 } };
       state.bookmakerStats[betData.bookmakerB].B.invested += betData.investB;
   }
   
   broadcast({
       type: 'BET_EXECUTED',
       players: state.players,
       bet: op,
       bookmakerStats: state.bookmakerStats
   });
}

// Rimuove riferimenti WebSocket dallo stato inviato al client
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

// API Routes
app.get('/api/export', (req, res) => {
   res.json(sanitizeState());
});

app.post('/api/import', (req, res) => {
   try {
       const data = req.body;
       if (data.players) state.players = { ...state.players, ...data.players };
       if (data.operations) state.operations = data.operations;
       if (data.bookmakers) state.bookmakers = data.bookmakers;
       if (data.bookmakerStats) state.bookmakerStats = data.bookmakerStats;
       saveState();
       broadcast({ type: 'DATA_IMPORTED', state: sanitizeState() });
       res.json({ success: true });
   } catch (err) {
       res.status(400).json({ error: err.message });
   }
});

// Start
const PORT = process.env.PORT || 3000;
loadState();
server.listen(PORT, () => {
   console.log(`🚀 Server Arbitraggio Pro avviato su porta ${PORT}`);
});
