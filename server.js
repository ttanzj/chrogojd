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
        case 'hysteria': processHysteria(data, uniqueSet); break;
        case 'hysteria2': processHysteria2(data, uniqueSet); break;
        case 'xray': processXray(data, uniqueSet); break;
        case 'singbox': processSingbox(data, uniqueSet); break;
        case 'clash': processClash(data, uniqueSet); break;
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
}

// ==================== 处理函数（保持不变） ====================
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
  const tls = security === 'tls
