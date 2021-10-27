import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import { getServerPort } from '../../src/utils/server';

/**
 * Convenience function to start a new HTTP server.
 * Returns a `{server, port}` object.
 */
export async function makeTestServer(
    requestListener?: http.RequestListener
): Promise<{ server: http.Server; wss: WebSocket.Server; port: number }> {
    return new Promise((resolve) => {
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
            const port = getServerPort(server);
            resolve({ server, wss, port });
        });
    });
}
