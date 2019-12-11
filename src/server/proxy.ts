import express from 'express';
import httpProxy from 'http-proxy';
import { forwardCount } from '../metrics';
import * as log from '../utils/logger';

/**
 * Creates a proxy which forwards connections based on configuration in `proxyTargets`.
 *
 * Whenever a connection comes in, the request's host will be looked up in
 * `proxyTargets`.  If a match is found, the request will be forwarded.
 */
export default function proxyMiddleware(): express.RequestHandler {
    const proxy = httpProxy.createProxyServer({});

    return (req, res, next) => {
        const proxyTarget = req.target;

        /* istanbul ignore next */
        if (!proxyTarget) {
            next(new Error('No proxyTarget.'));
            return;
        }

        log.debug(`Forwarding request to ${proxyTarget.targetUrl}`);
        forwardCount.inc({ type: 'http' });

        if (proxyTarget.headers) {
            req.headers = {
                ...req.headers,
                ...proxyTarget.headers,
            };
        }

        proxy.web(
            req,
            res,
            { target: proxyTarget.targetUrl, secure: proxyTarget.validateCertificate },
            err => {
                if (err) {
                    next(err);
                }
            }
        );
    };
}
