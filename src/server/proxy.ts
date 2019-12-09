import express from 'express';
import httpProxy from 'http-proxy';
import { forwardCount } from '../metrics';
import * as log from '../utils/logger';

/**
 * Creates a proxy which forwards connections based on configuration in `forwardTargets`.
 *
 * Whenever a connection comes in, the request's host will be looked up in
 * `forwardTargets`.  If a match is found, the request will be forwarded.
 */
export default function proxyMiddleware(): express.RequestHandler {
    const proxy = httpProxy.createProxyServer({});

    return (req, res, next) => {
        const forwardTarget = req.target;

        /* istanbul ignore next */
        if (!forwardTarget) {
            next(new Error('No forwardTarget.'));
            return;
        }

        log.debug(`Forwarding request to ${forwardTarget.targetUrl}`);
        forwardCount.inc({ type: 'http' });
        proxy.web(req, res, { target: forwardTarget.targetUrl }, err => {
            if (err) {
                next(err);
            }
        });
    };
}
