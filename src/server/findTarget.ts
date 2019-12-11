import express from 'express';
import { noTargetFound } from '../metrics';
import { CompiledProxyTarget } from '../targets';
import { KubeAuthProxyUser } from '../types';
import * as log from '../utils/logger';
import { targetList } from '../ui/targetList';

export interface ProxyTargetFinder {
    findTarget(host: string): CompiledProxyTarget | undefined;
    findTargetsForUser(user: KubeAuthProxyUser): CompiledProxyTarget[];
}

/**
 * Creates a proxy which forwards connections based on configuration in `proxyTargets`.
 *
 * Whenever a connection comes in, the request's host will be looked up in
 * `proxyTargets`.  If a match is found, the request will be forwarded.
 */
export function findTargetMiddleware(
    proxyTargets: ProxyTargetFinder,
    domain: string
): express.RequestHandler {
    return (req, res, next) => {
        const host = req.headers.host;
        const proxyTarget = proxyTargets.findTarget(host || '');

        if (!proxyTarget) {
            noTargetFound.inc({ type: 'http' });
            log.info(`Rejecting http connection for service ${host}.`);

            let response: string;
            if (!req.user) {
                // This should never happen
                response = 'Not found';
            } else {
                const targets = proxyTargets.findTargetsForUser(req.user);
                response = targetList({
                    user: req.user,
                    domain,
                    targets,
                });
            }

            res.statusCode = 404;
            res.send(response);
            return;
        }

        req.target = proxyTarget;
        next();
    };
}
