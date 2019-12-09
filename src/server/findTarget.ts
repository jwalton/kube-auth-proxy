import express from 'express';
import { noTargetFound } from '../metrics';
import { ForwardTarget } from '../types';
import * as log from '../utils/logger';

export interface ForwardTargetFinder {
    findConfig(host: string): ForwardTarget | undefined;
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
        const forwardTarget = forwardTargets.findConfig(host || '');

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
