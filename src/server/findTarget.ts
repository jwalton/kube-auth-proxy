import express from 'express';
import { noTargetFound } from '../metrics';
import { CompiledForwardTarget } from '../Targets';
import * as log from '../utils/logger';

export interface ForwardTargetFinder {
    findTarget(host: string): CompiledForwardTarget | undefined;
}

/**
 * Creates a proxy which forwards connections based on configuration in `forwardTargets`.
 *
 * Whenever a connection comes in, the request's host will be looked up in
 * `forwardTargets`.  If a match is found, the request will be forwarded.
 */
export function findTargetMiddleware(forwardTargets: ForwardTargetFinder): express.RequestHandler {
    return (req, res, next) => {
        const host = req.headers.host;
        const forwardTarget = forwardTargets.findTarget(host || '');

        if (!forwardTarget) {
            noTargetFound.inc({ type: 'http' });
            log.info(`Rejecting http connection for service ${host}.`);

            res.statusCode = 404;
            res.end('Not found');
            return;
        }

        req.target = forwardTarget;
        next();
    };
}
