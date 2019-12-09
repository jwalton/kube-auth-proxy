import express from 'express';
import http from 'http';
import WebSocket from 'ws';

/**
 * Convenience function to start a new HTTP server.
 * Returns a `{server, port}` object.
 */
export async function makeTestServer(
    requestListener?: http.RequestListener
): Promise<{ server: http.Server; wss: WebSocket.Server; port: number }> {
    return new Promise((resolve, reject) => {
        let app = requestListener;

        if (!app) {
            const expressApp = express();
            expressApp.get('/hello', (_req, res) => res.send('Hello World!'));
            app = expressApp;
        }

        const server = http.createServer(app);

        server.listen();

        const wss = new WebSocket.Server({ server });

        server.on('listening', () => {
            const address = server.address();
            if (typeof address === 'string') {
                reject(new Error(`Got string ${address} as address?`));
            } else {
                resolve({ server, wss, port: address.port });
            }
        });
    });
}
