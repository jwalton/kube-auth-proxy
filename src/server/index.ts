import express from 'express';
import http from 'http';
import { AuthModule } from '../authModules/AuthModule';
import { backendErrorCount } from '../metrics';
import { SanitizedKubeAuthProxyConfig } from '../types';
import * as log from '../utils/logger';
import authentication from './authentication';
import { authorizationMiddleware } from './authorization';
import { findTargetMiddleware, ForwardTargetFinder } from './findTarget';
import proxy from './proxy';
import { sessionMiddleware } from './session';
import { makeWebsocketHandler } from './websocket';

export function startServer(
    config: SanitizedKubeAuthProxyConfig,
    forwardTargets: ForwardTargetFinder,
    authModules: AuthModule[]
) {
    const app = express();
    app.disable('x-powered-by');
    app.enable('trust proxy');

    app.get('/kube-auth-proxy/status', (_req, res) => {
        res.send('ok');
    });

    app.use(sessionMiddleware(config));

    // Do authentication before searching for the target - this way
    // we redirect to the login screen even for domains that don't exist,
    // and attackers can't probe what domains do or do not exist.
    app.use(authentication(config, authModules));

    // This sets `req.target`.
    app.use(findTargetMiddleware(forwardTargets));
    app.use(authorizationMiddleware(authModules));
    app.use(proxy());

    app.use(
        (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            if ((err as any).status) {
                res.statusCode = (err as any).status;
                res.end(err.message);
            } else {
                backendErrorCount.inc({ type: 'http' });
                if ((err as any).code !== 'ECONNREFUSED') {
                    log.error(err, 'Error forwarding connection');
                }
                res.statusCode = 500;
                res.end('Internal server error');
            }
        }
    );

    const server = http.createServer(app);

    // Handle proxying websocket connections.
    server.on('upgrade', makeWebsocketHandler(config, forwardTargets, authModules));

    server.listen(config.port);

    server.on('listening', () => {
        const address = server.address();
        const port = typeof address === 'string' ? address : address.port;
        log.info(`Listening on port ${port}`);
    });

    return server;
}
