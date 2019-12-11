import http from 'http';
import httpProxy from 'http-proxy';
import net from 'net';
import { AuthModule } from '../authModules/AuthModule';
import * as metrics from '../metrics';
import { SanitizedKubeAuthProxyConfig } from '../types';
import * as log from '../utils/logger';
import { generateHttpMessage } from '../utils/utils';
import { wsAuthorizationMiddleware } from './authorization';
import { ProxyTargetFinder } from './findTarget';
import { wsSessionMiddleware } from './session';

export function makeWebsocketHandler(
    config: SanitizedKubeAuthProxyConfig,
    proxyTargets: ProxyTargetFinder,
    authModules: AuthModule[]
) {
    const session = wsSessionMiddleware(config);
    const authorization = wsAuthorizationMiddleware(authModules);
    const proxy = httpProxy.createProxyServer({});

    return (req: http.IncomingMessage, socket: net.Socket, head: any) => {
        session(req, err => {
            if (err) {
                log.error(err, 'Error reading session for websocket connection.');
                metrics.connectionErrorCount.inc({ type: 'ws' });
                socket.end(generateHttpMessage(500, 'Internal Server Error'));
                return;
            }

            const user = ((req as any).user = (req as any).session?.passport?.user);
            const host = req.headers.host || '';

            if (!(req as any).user) {
                metrics.notAuthenticatedCount.inc({ type: 'ws' });
                log.debug(`Rejecting unauthenticated websocket connection to ${host}.`);
                socket.end(generateHttpMessage(401, 'Unauthorized'));
                return;
            }

            const target = proxyTargets.findTarget(host);
            if (!target) {
                metrics.noTargetFound.inc({ type: 'ws' });
                log.info(`Rejecting websocket connection for service ${host}.`);

                socket.end(generateHttpMessage(404, 'Not found'));
                return;
            }
            (req as any).target = target;

            authorization(req, err => {
                if (err) {
                    log.info(
                        `Rejecting unauthorized user ${user.username} for service ${target.host}.`
                    );
                    metrics.notAuthorizedCount.inc({ type: 'ws' });
                    socket.end(generateHttpMessage(403, 'Forbidden'));
                    return;
                }

                log.debug(
                    `Forwarding WS connection from user ${user.username} to service ${target.host}.`
                );
                metrics.forwardCount.inc({ type: 'ws' });

                if (target.headers) {
                    req.headers = {
                        ...req.headers,
                        ...target.headers,
                    };
                }

                proxy.ws(req, socket, head, { target: target.wsTargetUrl }, err => {
                    if (err) {
                        metrics.backendErrorCount.inc({ type: 'ws' });
                        if ((err as any).code !== 'ECONNREFUSED') {
                            log.error(err, 'Error forwarding websocket connection');
                        }
                        socket.end(generateHttpMessage(500, 'Internal Error'));
                    }
                });
            });
        });
    };
}
