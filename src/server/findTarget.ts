import express from 'express';
import { noTargetFound } from '../metrics';
import { CompiledProxyTarget } from '../targets';
import * as log from '../utils/logger';

export interface ProxyTargetFinder {
    findTarget(host: string): CompiledProxyTarget | undefined;
}

/**
 * Creates a proxy which forwards connections based on configuration in `proxyTargets`.
 *
 * Whenever a connection comes in, the request's host will be looked up in
 * `proxyTargets`.  If a match is found, the request will be forwarded.
 */
export function findTargetMiddleware(proxyTargets: ProxyTargetFinder): express.RequestHandler {
    return (req, res, next) => {
        const host = req.headers.host;
        const proxyTarget = proxyTargets.findTarget(host || '');

        if (!proxyTarget) {
            noTargetFound.inc({ type: 'http' });
            log.info(`Rejecting http connection for service ${host}.`);

            res.statusCode = 404;
            res.end('Not found');
            return;
        }

        req.target = proxyTarget;
        next();
    };
}
