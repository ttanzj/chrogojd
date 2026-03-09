const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const cron = require('node-cron');
const fs = require('fs');
const { Buffer } = require('buffer');

const app = express();
let cachedYaml = '# 正在初始化节点，请稍等...\n';
let cachedBase64 = '';  // 新增：base64 订阅内容（编码前是明文链接列表）

async function updateCache() {
  console.log('🔄 开始更新节点缓存...');
  const sites = JSON.parse(fs.readFileSync('./subscriptions.json', 'utf8'));
  const uniqueSet = new Set();
  let success = 0;
  const base64Links = [];  // 收集可转换的分享链接

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
          processHysteria(data, uniqueSet, base64Links);
          break;
        case 'hysteria2':
          processHysteria2(data, uniqueSet, base64Links);
          break;
        case 'xray':
          processXray(data, uniqueSet, base64Links);
          break;
        case 'singbox':
          processSingbox(data, uniqueSet, base64Links);
          break;
        case 'clash':
          processClash(data, uniqueSet, base64Links);
          break;
      }
      success++;
    } catch (e) {
      console.warn(`⏭️ 跳过失效地址: ${site.url} → ${e.message}`);
    }
  }

  console.log(`✅ 成功抓取 ${success}/${sites.length} 个来源，共 ${uniqueSet.size} 个唯一节点`);

  // 构建 Clash 配置（原有部分）
  const proxyStrs = Array.from(uniqueSet);
  const proxyObjects = [];
  const proxyNames = [];

  for (let i = 0; i < proxyStrs.length; i++) {
    const obj = JSON.parse(proxyStrs[i]);
    const isIPv6 = obj.server && obj.server.includes(':') && !obj.server.match(/^\d+\.\d+\.\d+\.\d+$/);
    obj.name = `${obj.type.toUpperCase()}${isIPv6 ? ' [IPv6]' : ''} • ${obj.server || '未知'}`;
    if (obj.sni && obj.sni !== obj.server) obj.name += ` (${obj.sni})`;
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
      fallback: ['https://1.0.1.1/dns-query', 'tls://dns.google'],
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
  console.log('🚀 Clash YAML 缓存更新完成');

  // 新增：生成 base64 订阅内容
  if (base64Links.length > 0) {
    const plainText = base64Links.join('\n');
    cachedBase64 = Buffer.from(plainText).toString('base64');
    console.log(`📦 生成 base64 订阅：${base64Links.length} 条链接`);
  } else {
    cachedBase64 = '';
    console.log('⚠️ 没有可转换为 base64 的节点');
  }

  // 上传两个文件到 GitHub
  await uploadToGitHub(cachedYaml, 'clash-cache.yaml', '🤖 自动更新 Clash YAML 缓存');
  await uploadToGitHub(cachedBase64, 'base64.txt', '🤖 自动更新 Base64 订阅');
}

// ==================== GitHub 上传函数（稍作通用化） ====================
async function uploadToGitHub(content, filePath, commitMessagePrefix) {
  const {
    GITHUB_TOKEN,
    GITHUB_REPO = 'ttanzj/chrogojd',
    GITHUB_BRANCH = 'main'
  } = process.env;

  if (!GITHUB_TOKEN) {
    console.log(`⚠️ 未设置 GITHUB_TOKEN，跳过上传 ${filePath}`);
    return;
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const headers = { Authorization: `token ${GITHUB_TOKEN}` };
  const encodedContent = Buffer.from(content).toString('base64');

  try {
    let sha = null;
    try {
      const getRes = await axios.get(`${url}?ref=${GITHUB_BRANCH}`, { headers });
      sha = getRes.data.sha;
    } catch (err) {
      if (err.response?.status !== 404) throw err;
      console.log(`📁 文件 ${filePath} 不存在，将首次创建`);
    }

    await axios.put(
      url,
      {
        message: `${commitMessagePrefix} - ${new Date().toISOString()}`,
        content: encodedContent,
        sha: sha,
        branch: GITHUB_BRANCH
      },
      { headers }
    );

    console.log(`✅ 已上传到 GitHub → ${GITHUB_REPO}/${filePath}`);
  } catch (err) {
    console.error(`❌ 上传 ${filePath} 失败:`, err.response?.data?.message || err.message);
  }
}

// ==================== 新增辅助函数 ====================
function parseServerPort(serverStr, defaultPort = 443) {
  if (!serverStr) return { server: '', port: defaultPort };

  serverStr = serverStr.trim();

  // [2001:db8::1]:8443
  const bracketMatch = serverStr.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracketMatch) {
    return { server: bracketMatch[1], port: Number(bracketMatch[2]) };
  }

  // 2001:db8::1:8443 （无括号）
  const lastColon = serverStr.lastIndexOf(':');
  if (lastColon > serverStr.lastIndexOf(']') && lastColon !== -1) {
    const possiblePort = serverStr.slice(lastColon + 1);
    if (/^\d+$/.test(possiblePort)) {
      return { server: serverStr.slice(0, lastColon), port: Number(possiblePort) };
    }
  }

  // example.com:443 或 1.1.1.1
  const parts = serverStr.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { server: parts[0], port: Number(parts[1]) };
  }

  return { server: serverStr, port: defaultPort };
}

function normalizeProxy(proxy) {
  const norm = { ...proxy };
  delete norm.name;
  norm['skip-cert-verify'] = norm['skip-cert-verify'] ?? true;
  norm.sni = norm.sni || norm.server || '';
  if (norm.alpn && Array.isArray(norm.alpn)) {
    norm.alpn = norm.alpn.sort();
  }
  return norm;
}

// ==================== 处理函数 ====================
function processHysteria(data, set, base64Links) {
  if (!data?.server) return;
  const { server, port } = parseServerPort(data.server, 443);

  const proxy = {
    type: 'hysteria',
    server,
    port: Number(port),
    auth_str: data.auth_str || '',
    up: data.up_mbps,
    down: data.down_mbps,
    'fast-open': true,
    protocol: data.protocol || 'udp',
    sni: data.server_name || '',
    'skip-cert-verify': true,
    alpn: data.alpn ? [data.alpn] : ['h3']
  };
  set.add(JSON.stringify(normalizeProxy(proxy)));

  try {
    const serverPart = server.includes(':') && !server.startsWith('[') ? `[${server}]` : server;
    const params = new URLSearchParams({
      protocol: proxy.protocol,
      auth: proxy.auth_str,
      peer: proxy.sni,
      insecure: proxy['skip-cert-verify'] ? '1' : '0',
      upmbps: proxy.up || '',
      downmbps: proxy.down || '',
      alpn: proxy.alpn[0] || 'h3'
    });
    const link = `hysteria://${serverPart}:${port}?${params.toString()}#${proxy.sni || server}`;
    base64Links.push(link);
  } catch (e) {
    console.warn('hysteria base64 链接生成失败:', e.message);
  }
}

function processHysteria2(data, set, base64Links) {
  if (!data?.server) return;
  const { server, port } = parseServerPort(data.server, 443);

  const tls = data.tls || {};
  let password = data.auth || data.password || data.auth_str || '';
  if (typeof data.auth === 'object' && data.auth?.password) {
    password = data.auth.password;
  }

  const proxy = {
    type: 'hysteria2',
    server,
    port: Number(port),
    password,
    'fast-open': true,
    sni: tls.sni || server,
    'skip-cert-verify': tls.insecure ?? true,
    alpn: tls.alpn || ['h3']
  };
  set.add(JSON.stringify(normalizeProxy(proxy)));

  try {
    const serverPart = server.includes(':') && !server.startsWith('[') ? `[${server}]` : server;
    const authPart = password ? `${encodeURIComponent(password)}@` : '';
    const params = new URLSearchParams({
      insecure: proxy['skip-cert-verify'] ? '1' : '0',
      sni: proxy.sni || ''
    });
    const link = `hysteria2://${authPart}${serverPart}:${port}?${params.toString()}#${proxy.sni || server}`;
    base64Links.push(link);
  } catch (e) {
    console.warn('hysteria2 base64 链接生成失败:', e.message);
  }
}

function processXray(data, set, base64Links) {
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

  try {
    let link;
    if (proxy.type === 'vmess') {
      const vmessObj = {
        v: '2',
        ps: sni || server,
        add: server,
        port: port,
        id: proxy.uuid,
        aid: proxy.alterId || 0,
        net: network,
        type: 'none',
        host: proxy['ws-opts']?.headers?.Host || '',
        path: proxy['ws-opts']?.path || '',
        tls: proxy.tls ? 'tls' : '',
        sni: proxy.servername,
        alpn: '',
        fp: proxy['client-fingerprint']
      };
      const encoded = Buffer.from(JSON.stringify(vmessObj)).toString('base64');
      link = `vmess://${encoded}`;
    } else if (proxy.type === 'vless') {
      const params = new URLSearchParams({
        encryption: proxy.encryption,
        security: proxy.tls ? (reality ? 'reality' : 'tls') : 'none',
        fp: proxy['client-fingerprint'],
        type: network,
        ...(network === 'ws' && { path: proxy['ws-opts']?.path || '/', host: proxy['ws-opts']?.headers?.Host || '' }),
        ...(reality && { 'pbk': pbk, 'sid': sid }),
        sni: proxy.servername
      });
      link = `vless://${proxy.uuid}@${server}:${port}?${params.toString()}#${sni || server}`;
    }
    if (link) base64Links.push(link);
  } catch (e) {
    console.warn(`xray ${proxy.type} base64 链接生成失败:`, e.message);
  }
}

function processSingbox(data, set, base64Links) {
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

  try {
    const params = new URLSearchParams({
      protocol: proxy.protocol,
      auth: proxy.auth_str,
      peer: proxy.sni,
      insecure: proxy['skip-cert-verify'] ? '1' : '0',
      upmbps: proxy.up || '',
      downmbps: proxy.down || '',
      alpn: proxy.alpn[0] || 'h3'
    });
    const link = `hysteria://${proxy.server}:${proxy.port}?${params.toString()}#${proxy.sni || proxy.server}`;
    base64Links.push(link);
  } catch (e) {
    console.warn('singbox hysteria base64 链接生成失败:', e.message);
  }
}

function processClash(data, set, base64Links) {
  const proxies = data.proxies || [];
  for (const p of proxies) {
    if (!p || typeof p !== 'object') continue;
    const dedup = { ...p };
    delete dedup.name;

    const remark = p.name || `${p.type}-${p.server || '未知'}`;

    set.add(JSON.stringify(dedup));

    try {
      let link;
      if (p.type === 'vmess') {
        const vmessObj = {
          v: '2',
          ps: remark,
          add: p.server,
          port: p.port,
          id: p.uuid,
          aid: p.alterId || 0,
          net: p.network || 'tcp',
          type: 'none',
          host: p['ws-opts']?.headers?.Host || p.servername || '',
          path: p['ws-opts']?.path || '',
          tls: p.tls ? 'tls' : '',
          sni: p.servername || ''
        };
        const encoded = Buffer.from(JSON.stringify(vmessObj)).toString('base64');
        link = `vmess://${encoded}`;
      } else if (p.type === 'vless') {
        const params = new URLSearchParams({
          encryption: p.encryption || 'none',
          security: p.tls ? 'tls' : 'none',
          type: p.network || 'tcp',
          ...(p['ws-opts'] && { path: p['ws-opts'].path || '/', host: p['ws-opts'].headers?.Host || '' }),
          sni: p.servername || '',
          fp: p['client-fingerprint'] || 'chrome'
        });
        link = `vless://${p.uuid}@${p.server}:${p.port}?${params.toString()}#${remark}`;
      } else if (p.type === 'hysteria') {
        const params = new URLSearchParams({
          auth: p.auth_str || '',
          peer: p.sni || '',
          insecure: p['skip-cert-verify'] ? '1' : '0',
          upmbps: p.up || '',
          downmbps: p.down || '',
          alpn: (p.alpn?.[0] || 'h3')
        });
        link = `hysteria://${p.server}:${p.port}?${params.toString()}#${remark}`;
      } else if (p.type === 'hysteria2') {
        const authPart = p.password ? `${encodeURIComponent(p.password)}@` : '';
        const params = new URLSearchParams({
          insecure: p['skip-cert-verify'] ? '1' : '0',
          sni: p.sni || ''
        });
        link = `hysteria2://${authPart}${p.server}:${p.port}?${params.toString()}#${remark}`;
      }
      if (link) base64Links.push(link);
    } catch (e) {
      console.warn(`clash ${p.type || '未知类型'} base64 转换失败:`, e.message);
    }
  }
}

// ==================== 服务路由 ====================
app.get('/', async (req, res) => {
  if (cachedYaml.includes('初始化')) await updateCache();

  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.send(cachedYaml);
});

app.get('/base64', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(cachedBase64 || '没有可用 base64 订阅');
});

app.listen(3000, async () => {
  console.log('🚀 chrogojd 服务已启动 - 端口 3000');
  await updateCache();
  cron.schedule('0 0 * * *', updateCache);  // 每天0点更新
});
