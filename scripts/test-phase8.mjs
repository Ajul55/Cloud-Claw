/**
 * Phase 8 — Integration smoke test (no dependencies — uses built-in https)
 * Run: node test-phase8.mjs
 */

import https from 'https';

const BASE_HOST = 'staged-api.cloudstick.io';
const BASE_PATH = '/api/v2';
const TOKEN  = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VySW5mbyI6eyJJZCI6OTY4NH19.afJJ_ZzHpdRBx4XAJtdOvFSxhsEGsTMOLDikundzBnWyL1eGHBPW2sK-LVJ1U6y0qURinGJk4AoPm0uaNVy7wurp33P13oxkH9phnvkdWGyibaezZA69Sb6_6vdFRM1EmBIhMo1TNMsRWJL0-L6U7sIqvPVQq9sStYVyv6VIYLc';
const USER_ID   = '9684';
const SERVER_ID = '1';   // dummy — expect 400/404 if invalid, not network error
const WEBSITE_ID = '1';
const WL_ID = '1';

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: BASE_HOST,
            port: 443,
            path: BASE_PATH + path,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
            timeout: 15000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

const results = [];

async function test(label, method, path, body) {
    process.stdout.write(`  ${label.padEnd(62)}`);
    try {
        const res = await request(method, path, body ?? null);
        const s = res.status;
        const icon = s < 400 ? '✅' : s < 500 ? '⚠️ ' : '❌';
        console.log(`${icon} ${s}`);
        results.push({ label, status: s, ok: s < 500 });
    } catch (err) {
        console.log(`❌ ${err.message}`);
        results.push({ label, status: err.message, ok: false });
    }
}

async function run() {
    console.log('='.repeat(72));
    console.log('  Phase 8 — WordPress Templates & Advanced App Features');
    console.log('='.repeat(72));

    console.log('\n── 8.1  WP Templates ──');
    await test('GET  /wordpress-templates/listthemes/users/:uid',          'GET',  `/wordpress-templates/listthemes/users/${USER_ID}`);
    await test('GET  /wordpress-templates/listplugins/users/:uid',         'GET',  `/wordpress-templates/listplugins/users/${USER_ID}`);
    await test('GET  /wordpress-templates/listtemplates/users/:uid',       'GET',  `/wordpress-templates/listtemplates/users/${USER_ID}`);
    await test('POST /wordpress-templates/createtemplates/users/:uid',     'POST', `/wordpress-templates/createtemplates/users/${USER_ID}`, {});
    await test('PATCH /wordpress-templates/template/:tid/users/:uid',      'PATCH',`/wordpress-templates/template/1/users/${USER_ID}`, {});
    await test('DELETE /wordpress-templates/template/:tid/users/:uid',     'DELETE',`/wordpress-templates/template/1/users/${USER_ID}`);

    console.log('\n── 8.2  WP Subdomain ──');
    await test('GET  /wordpress/subdomain/websites/:wid/servers/:sid/…',   'GET',  `/wordpress/subdomain/websites/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);
    await test('GET  /wordpress/subdomain/delete/:wid/servers/:sid/…',     'GET',  `/wordpress/subdomain/delete/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);

    console.log('\n── 8.3  CustomPHP Clone + Subdomain ──');
    await test('GET  /customphp/clone/:wid/servers/:sid/users/:uid',       'GET',  `/customphp/clone/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);
    await test('GET  /customphp/subdomain/websites/:wid/servers/:sid/…',   'GET',  `/customphp/subdomain/websites/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);
    await test('GET  /customphp/subdomain/delete/:wid/servers/:sid/…',     'GET',  `/customphp/subdomain/delete/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);

    console.log('\n── 8.4  ProxyApp Subdomain ──');
    await test('GET  /proxyapp/subdomain/websites/:wid/servers/:sid/…',    'GET',  `/proxyapp/subdomain/websites/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);
    await test('GET  /proxyapp/subdomain/delete/:wid/servers/:sid/…',      'GET',  `/proxyapp/subdomain/delete/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);

    console.log('\n── 8.5  WhiteLabel App ──');
    await test('GET  /whitelabel/servers/:sid/users/:uid',                  'GET',  `/whitelabel/servers/${SERVER_ID}/users/${USER_ID}`);
    await test('POST /whitelabel/servers/:sid/users/:uid',                  'POST', `/whitelabel/servers/${SERVER_ID}/users/${USER_ID}`, {});
    await test('GET  /whitelabel/details/:wid/servers/:sid/users/:uid',     'GET',  `/whitelabel/details/${WL_ID}/servers/${SERVER_ID}/users/${USER_ID}`);
    await test('GET  /whitelabel/delete/:wid/servers/:sid/users/:uid',      'GET',  `/whitelabel/delete/${WL_ID}/servers/${SERVER_ID}/users/${USER_ID}`);

    console.log('\n── 8.6  phpMyAdmin Login ──');
    await test('GET  /phpmyadmin/database/login/servers/:sid/users/:uid',  'GET',  `/phpmyadmin/database/login/servers/${SERVER_ID}/users/${USER_ID}`);
    await test('GET  /phpmyadmin/app-database/login/:wid/servers/:sid/…',  'GET',  `/phpmyadmin/app-database/login/${WEBSITE_ID}/servers/${SERVER_ID}/users/${USER_ID}`);

    console.log('\n' + '='.repeat(72));
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`  ${passed} reachable  |  ${failed} failed (5xx / network)`);
    if (failed > 0) {
        console.log('\n  Failed:');
        results.filter(r => !r.ok).forEach(r => console.log(`    ❌  ${r.label}  → ${r.status}`));
    }
    console.log('='.repeat(72));
    console.log('  ✅ 2xx = success   ⚠️  4xx = endpoint exists   ❌ 5xx/NET = broken\n');
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
