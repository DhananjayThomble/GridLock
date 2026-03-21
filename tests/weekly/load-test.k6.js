// tests/weekly/load-test.k6.js — k6 WebSocket load test for beta
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const wsConnectTime = new Trend('ws_connect_time', true);
const wsMessagesSent = new Counter('ws_messages_sent');
const wsMessagesReceived = new Counter('ws_messages_received');
const gameCreated = new Counter('games_created');
const connectErrors = new Counter('connect_errors');

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // ramp up to 20 concurrent connections
    { duration: '2m', target: 30 },   // hold at 30
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    'ws_connect_time': ['p(95)<2000'],  // 95% connect in < 2s
    'checks': ['rate>0.95'],            // 95% checks pass
    'connect_errors': ['count<10'],     // Fewer than 10 connection errors
  },
};

const BETA_WS = __ENV.BETA_WS || 'wss://beta-api.gridlock.pro/socket.io/?EIO=4&transport=websocket';

export default function () {
  const connectStart = Date.now();

  const res = ws.connect(BETA_WS, {}, function (socket) {
    let connected = false;
    let handshakeComplete = false;

    socket.on('open', () => {
      wsConnectTime.add(Date.now() - connectStart);
      connected = true;

      // Socket.IO handshake: send protocol upgrade
      socket.send('40');
      wsMessagesSent.add(1);
    });

    socket.on('message', (msg) => {
      wsMessagesReceived.add(1);

      // Socket.IO handshake response (starts with '0')
      if (msg.startsWith('0')) {
        handshakeComplete = true;
      }

      // Socket.IO event acknowledgment (starts with '40')
      if (msg === '40') {
        handshakeComplete = true;

        // Create a game against CPU
        const createPayload = JSON.stringify([
          'create_game',
          {
            username: `k6_load_${__VU}_${__ITER}`,
            avatar: '🤖',
            playerCount: 2,
            gridSize: 3,
            cpuEnabled: true,
            cpuDifficulty: 'easy',
            cpuCount: 1,
          },
        ]);
        socket.send(`42${createPayload}`);
        wsMessagesSent.add(1);
      }

      // Game created event
      if (msg.includes('game_created') || msg.includes('game_started')) {
        gameCreated.add(1);
      }

      // Respond to Socket.IO pings
      if (msg === '2') {
        socket.send('3');
        wsMessagesSent.add(1);
      }
    });

    socket.on('error', (e) => {
      connectErrors.add(1);
    });

    // Keep connection alive for 30s, then close
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });

  const connectOk = check(res, {
    'Connected successfully': (r) => r && r.status === 101,
  });

  if (!connectOk) {
    connectErrors.add(1);
  }

  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    type: 'k6-load-test',
    metrics: {
      vus_max: data.metrics.vus_max?.values?.max || 0,
      ws_connect_time_p95: data.metrics.ws_connect_time?.values?.['p(95)'] || 0,
      ws_messages_sent: data.metrics.ws_messages_sent?.values?.count || 0,
      ws_messages_received: data.metrics.ws_messages_received?.values?.count || 0,
      games_created: data.metrics.games_created?.values?.count || 0,
      connect_errors: data.metrics.connect_errors?.values?.count || 0,
      checks_rate: data.metrics.checks?.values?.rate || 0,
    },
  };

  return {
    'tests/results/k6-summary.json': JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary, null, 2) + '\n',
  };
}
