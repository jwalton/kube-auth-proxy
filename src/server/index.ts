import express from 'express';
import http from 'http';
import { AuthModule } from '../authModules/AuthModule';
import { backendErrorCount } from '../metrics';
import { SanitizedKubeAuthProxyConfig } from '../types';
import { targetList } from '../ui/targetList';
import * as log from '../utils/logger';
import authentication from './authentication';
import { authorizationMiddleware } from './authorization';
import { findTargetMiddleware, ProxyTargetFinder } from './findTarget';
import proxy from './proxy';
import { sessionMiddleware } from './session';
import { makeWebsocketHandler } from './websocket';

export function startServer(
    config: SanitizedKubeAuthProxyConfig,
    proxyTargets: ProxyTargetFinder,
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

    app.get('/kube-auth-proxy/list', (req, res, next) => {
        if (!req.user) {
            return next();
        }
        const targets = proxyTargets.findTargetsForUser(req.user);
        res.send(
            targetList({
                user: req.user,
                domain: config.domain,
                targets,
            })
        );
    });

    // This sets `req.target`.
    app.use(findTargetMiddleware(proxyTargets, config.domain));
    app.use(authorizationMiddleware(authModules));
    app.use(proxy());

    app.use(
        (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
            if ((err as any).status) {
                res.statusCode = (err as any).status;
                res.end(err.message);
            } else {
                backendErrorCount.inc({ type: 'http' });
                if ((err as any).code !== 'ECONNREFUSED') {
                    log.error(
                        err,
                        `Error forwarding connection to ${req.headers.host}${req.url}: ${
                            (err as any).code
                        }`
                    );
                    res.statusCode = 502;
                    res.end('Bad Gateway');
                } else {
                    res.statusCode = 500;
                    res.end('Internal server error');
                }
            }
        }
    );

    const server = http.createServer(app);

    // Handle proxying websocket connections.
    server.on('upgrade', makeWebsocketHandler(config, proxyTargets, authModules));

    server.listen(config.port);

    server.on('listening', () => {
        const address = server.address();
        const port = typeof address === 'string' ? address : address.port;
        log.info(`Listening on port ${port}`);
    });

    return server;
}
