/**
 * e-Toll Local Bridge Companion (Node.js)
 * Membaca kartu contactless NFC / Smart Card Reader (ACR122U) melalui Windows PC/SC resmi
 * dan menyiarkan data ke browser Chrome secara real-time via Server-Sent Events (SSE) di port 8080.
 *
 * Cara Menjalankan:
 *   node bridge.js
 */

const http = require('http');

const PORT = 8080;
const clients = new Set();

// Cek apakah library PC/SC tersedia (opsional)
let pcscInstance = null;
try {
    const pcsclite = require('@pokusew/pcsclite') || require('pcsclite');
    pcscInstance = pcsclite();
    console.log('[PCSC] Layanan PC/SC Windows aktif.');

    pcscInstance.on('reader', function (reader) {
        console.log(`[PCSC] Reader terdeteksi: ${reader.name}`);

        reader.on('status', function (status) {
            const changes = this.state ^ status.state;
            if (changes) {
                if ((status.state & this.SCARD_STATE_PRESENT) && !(this.state & this.SCARD_STATE_PRESENT)) {
                    console.log(`[PCSC] Kartu ditempelkan di ${reader.name}!`);
                    reader.connect({ share_mode: this.SCARD_SHARE_SHARED }, function (err, protocol) {
                        if (err) {
                            console.error('[PCSC] Gagal connect ke kartu:', err.message);
                            return;
                        }
                        // Kirim APDU FF CA 00 00 00 (Get UID)
                        const getUidApdu = Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]);
                        reader.transmit(getUidApdu, 40, protocol, function (err, data) {
                            if (err) {
                                console.error('[PCSC] Transmit error:', err.message);
                                return;
                            }
                            if (data.length >= 2 && data[data.length - 2] === 0x90) {
                                const uidHex = data.slice(0, -2).toString('hex').toUpperCase();
                                console.log(`[PCSC] >> UID Kartu: ${uidHex}`);
                                broadcastCard({
                                    uid: uidHex,
                                    provider: 'ACR122U (PC/SC WIN)',
                                    balance: null
                                });
                            }
                        });
                    });
                } else if ((status.state & this.SCARD_STATE_EMPTY) && (this.state & this.SCARD_STATE_EMPTY)) {
                    console.log('[PCSC] Kartu diangkat.');
                }
            }
        });

        reader.on('error', function (err) {
            console.error(`[PCSC] Reader error (${reader.name}):`, err.message);
        });

        reader.on('end', function () {
            console.log(`[PCSC] Reader ${reader.name} dicabut.`);
        });
    });

    pcscInstance.on('error', function (err) {
        console.warn('[PCSC] Info PCSC:', err.message);
    });

} catch (e) {
    console.log('[INFO] Modul PC/SC native belum terpasang (opsional).');
    console.log('[INFO] Bridge tetap berjalan sebagai HTTP/SSE server untuk Chrome.');
}

function broadcastCard(cardData) {
    const payload = `data: ${JSON.stringify(cardData)}\n\n`;
    for (const res of clients) {
        try {
            res.write(payload);
        } catch (e) {
            clients.delete(res);
        }
    }
}

const server = http.createServer((req, res) => {
    // Set CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write('data: {"status":"connected"}\n\n');
        clients.add(res);

        console.log(`[HTTP] Klien browser terhubung (Total: ${clients.size})`);

        req.on('close', () => {
            clients.delete(res);
            console.log(`[HTTP] Klien browser terputus (Tersisa: ${clients.size})`);
        });
        return;
    }

    // Endpoint simulasi/trigger manual: /scan?uid=3F51A8BA&balance=50000
    if (url.pathname === '/scan') {
        const uid = url.searchParams.get('uid') || 'EM' + Date.now().toString(16).toUpperCase();
        const balance = parseInt(url.searchParams.get('balance'), 10) || null;
        const provider = url.searchParams.get('provider') || 'SIMULATOR LOCAL';

        broadcastCard({ uid, provider, balance });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `Kartu ${uid} dikirim ke web!` }));
        console.log(`[TRIGGER] Kartu ${uid} disiarkan ke browser.`);
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('e-Toll Bridge Server aktif di port ' + PORT);
});

server.listen(PORT, () => {
    console.log('========================================================');
    console.log(`  e-Toll Companion Bridge siap di http://localhost:${PORT}`);
    console.log('  1. Buka cektol.pages.dev atau index.html di Google Chrome');
    console.log('  2. Di modal USB Reader, buka tab "Local Bridge"');
    console.log('  3. Tempelkan kartu di reader atau tes via browser:');
    console.log(`     http://localhost:${PORT}/scan?uid=3F51A8BA&balance=75000`);
    console.log('========================================================\n');
});

