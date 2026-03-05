const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
let cachedYaml = '# 正在初始化节点，请稍等...\n';

async function updateCache() {
  console.log('🔄 开始更新节点缓存...');
  const sites = JSON.parse(fs.readFileSync('./subscriptions.json', 'utf8'));
  const uniqueSet = new Set();
  let success = 0;

  for (const site of sites) {
    try {
      const res = await axios.get(site.url, { timeout: 20000, responseType: 'text' });
      let data;
      if (site.type === 'clash') {
        data = yaml.load(res.data);
      } else {
        data = JSON.parse(res.data);
      }

      switch (site.type) {
        case 'hysteria':
          processHysteria(data, uniqueSet);
          break;
        case 'hysteria2':
          processHysteria2(data, uniqueSet);
          break;
        case 'xray':
          processXray(data, uniqueSet);
          break;
        case 'singbox':
          processSingbox(data, uniqueSet);
          break;
        case 'clash':
          processClash(data, uniqueSet);
          break;
      }
      success++;
    } catch (e) {
      console.warn(`⏭️ 跳过失效地址: ${site.url} → ${e.message}`);
    }
  }

  console.log(`✅ 成功抓取 ${success}/${sites.length} 个来源，共 ${uniqueSet.size} 个唯一节点`);

  // 构建 Clash 配置
  const proxyStrs = Array.from(uniqueSet);
  const proxyObjects = [];
  const proxyNames = [];

  for (let i = 0; i < proxyStrs.length; i++) {
    const obj = JSON.parse(proxyStrs[i]);
    obj.name = `节点${i + 1}`;
    proxyObjects.push(obj);
    proxyNames.push(obj.name);
  }

  const config = {
    port: 7890,
    'allow-lan': true,
    mode: 'rule',
    'log-level': 'info',
    'unified-delay': true,
    'global-client-fingerprint': 'chrome',
    dns: {
      enable: true,
      listen: ':53',
      ipv6: true,
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      'default-nameserver': ['223.5.5.5', '8.8.8.8'],
      nameserver: ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'],
      fallback: ['https://1.0.0.1/dns-query', 'tls://dns.google'],
      'fallback-filter': { geoip: true, 'geoip-code': 'CN', ipcidr: ['240.0.0.0/4'] }
    },
    proxies: proxyObjects,
    'proxy-groups': [
      { name: '节点选择', type: 'select', proxies: ['自动选择', 'DIRECT', ...proxyNames] },
      { name: '自动选择', type: 'url-test', url: 'http://www.gstatic.com/generate_204', interval: 300, tolerance: 50, proxies: proxyNames }
    ],
    rules: [
      'DOMAIN,clash.razord.top,DIRECT',
      'DOMAIN,yacd.haishan.me,DIRECT',
      'GEOIP,LAN,DIRECT',
      'GEOIP,CN,DIRECT',
      'MATCH,节点选择'
    ]
  };

  cachedYaml = yaml.dump(config, { lineWidth: -1, noRefs: true });
  console.log('🚀 节点缓存更新完成');

  // 自动上传到 GitHub
  await uploadToGitHub(cachedYaml);
}

// ==================== GitHub 上传函数 ====================
async function uploadToGitHub(content) {
  const {
    GITHUB_TOKEN,
    GITHUB_REPO = 'ttanzj/chrogojd',
    GITHUB_FILE_PATH = 'clash-cache.yaml',
    GITHUB_BRANCH = 'main'
  } = process.env;

  if (!GITHUB_TOKEN) {
    console.log('⚠️ 未设置 GITHUB_TOKEN，跳过上传 GitHub');
    return;
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
  const headers = { Authorization: `token ${GITHUB_TOKEN}` };
  const encodedContent = Buffer.from(content).toString('base64');

  try {
    let sha = null;
    try {
      const getRes = await axios.get(`${url}?ref=${GITHUB_BRANCH}`, { headers });
      sha = getRes.data.sha;
    } catch (err) {
      if (err.response?.status !== 404) throw err;
      console.log(`📁 文件 ${GITHUB_FILE_PATH} 不存在，将首次创建`);
    }

    await axios.put(
      url,
      {
        message: `🤖 自动更新节点缓存 - ${new Date().toISOString()}`,
        content: encodedContent,
        sha: sha,
        branch: GITHUB_BRANCH
      },
      { headers }
    );

    console.log(`✅ 节点缓存已成功上传到 GitHub → ${GITHUB_REPO}/${GITHUB_FILE_PATH}`);
  } catch (err) {
    console.error('❌ 上传 GitHub 失败:', err.response?.data?.message || err.message);
  }
}

// ==================== 完整处理函数 ====================
function processHysteria(data, set) {
  if (!data?.server) return;
  const [server, port] = data.server.split(':');
  const proxy = {
    type: 'hysteria',
    server,
    port: Number(port),
    auth_str: data.auth_str,
    up: data.up_mbps,
    down: data.down_mbps,
    'fast-open': true,
    protocol: data.protocol || 'udp',
    sni: data.server_name,
    'skip-cert-verify': true,
    alpn: data.alpn ? [data.alpn] : ['h3']
  };
  set.add(JSON.stringify(proxy));
}

function processHysteria2(data, set) {
  if (!data?.server) return;
  const [server, port] = data.server.split(':');
  const tls = data.tls || {};
  const proxy = {
    type: 'hysteria2',
    server,
    port: Number(port),
    password: data.auth || '',
    'fast-open': true,
    sni: tls.sni || '',
    'skip-cert-verify': tls.insecure ?? true
  };
  set.add(JSON.stringify(proxy));
}

function processXray(data, set) {
  const ob = data.outbounds?.[0];
  if (!ob || !['vless', 'vmess'].includes(ob.protocol)) return;

  const vnext = ob.settings?.vnext?.[0] || {};
  const stream = ob.streamSettings || {};
  const user = vnext.users?.[0] || {};

  const server = vnext.address || '';
  const port = vnext.port || 443;
  const network = stream.network || 'tcp';
  const security = stream.security || 'none';
  const tls = security === 'tls' || security === 'reality';
  const reality = security === 'reality';

  let sni = '', fp = 'chrome', pbk = '', sid = '';
  if (tls) {
    const tlsSet = reality ? (stream.realitySettings || {}) : (stream.tlsSettings || {});
    sni = tlsSet.serverName || server;
    fp = tlsSet.fingerprint || 'chrome';
    if (reality) {
      pbk = tlsSet.publicKey || '';
      sid = tlsSet.shortId || '';
    }
  }

  const proxy = {
    type: ob.protocol,
    server,
    port: Number(port),
    uuid: user.id || '',
    network,
    tls,
    'skip-cert-verify': true,
    'client-fingerprint': fp,
    servername: sni,
    udp: true
  };

  if (ob.protocol === 'vmess') {
    proxy.alterId = 0;
    proxy.cipher = 'auto';
  } else {
    proxy.encryption = user.encryption || 'none';
  }
  if (user.flow) proxy.flow = user.flow;

  if (network === 'ws') {
    const ws = stream.wsSettings || {};
    proxy['ws-opts'] = {
      path: ws.path || '/',
      headers: { Host: ws.headers?.Host || sni || server }
    };
  }
  if (network === 'grpc') {
    const grpc = stream.grpcSettings || {};
    proxy['grpc-opts'] = { 'grpc-service-name': grpc.serviceName || '' };
  }
  if (reality) {
    proxy['reality-opts'] = { 'public-key': pbk, 'short-id': sid };
  }

  set.add(JSON.stringify(proxy));
}

function processSingbox(data, set) {
  const ob = data.outbounds?.[0];
  if (!ob || ob.type !== 'hysteria') return;
  const tls = ob.tls || {};
  const proxy = {
    type: 'hysteria',
    server: ob.server,
    port: ob.server_port,
    auth_str: ob.auth_str,
    up: ob.up_mbps,
    down: ob.down_mbps,
    'fast-open': true,
    protocol: 'udp',
    sni: tls.server_name,
    'skip-cert-verify': tls.insecure ?? true,
    alpn: tls.alpn?.[0] ? [tls.alpn[0]] : ['h3']
  };
  set.add(JSON.stringify(proxy));
}

function processClash(data, set) {
  const proxies = data.proxies || [];
  for (const p of proxies) {
    if (!p || typeof p !== 'object') continue;
    const dedup = { ...p };
    delete dedup.name;
    set.add(JSON.stringify(dedup));
  }
}

// ==================== 服务路由 ====================
app.get('/', async (req, res) => {
  if (cachedYaml.includes('初始化')) await updateCache();

  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.send(cachedYaml);
});

app.listen(3000, async () => {
  console.log('🚀 chrogojd 服务已启动 - 端口 3000');
  await updateCache();
  cron.schedule('0 0 * * *', updateCache);
});
