import express from 'express';
import fs from 'fs';
import path from 'path';
import prometheus from 'prom-client';
import * as log from './utils/logger';

// Create a `version` gauge.  This gauge always has a value of 1 - the
// interesting stuff is in the gauge's labels.  You can do a PromQL query
// like `count by(gitCommit) (loop_build_info)` to get the a count of the
// distinct loop versions deployed to the cluster (which should ideally be
// 1, unless we're in the middle of an upgrade).
const version = new prometheus.Gauge({
    name: `kube_auth_proxy_build_info`,
    help: 'kube-auth-proxy version info.',
    labelNames: ['version'],
});

function metricsEndpoint() {
    return (_req: express.Request, res: express.Response) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(prometheus.register.metrics());
    };
}

/**
 * Starts a prometheus-style metrics server on the specified port.
 */
export function startMetricsServer(metricsPort: number) {
    const PKG_DATA = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../package.json'), { encoding: 'utf-8' })
    );
    log.info(`Running version v${PKG_DATA.version}`);
    version.set(
        {
            version: `v${PKG_DATA.version}`,
        },
        1
    );

    const app = express();
    app.get('/metrics', metricsEndpoint());
    app.listen(metricsPort, () => {
        log.info(`Metrics server available on http://localhost:${metricsPort}/metrics`);
    });

    return app;
}

export const connectionErrorCount = new prometheus.Counter({
    name: 'kube_auth_proxy_connection_error',
    help: 'Connection was terminated due to a protocol error.',
    labelNames: ['type'],
});

export const forwardCount = new prometheus.Counter({
    name: 'kube_auth_proxy_forwarded',
    help: 'A count of the number of requests forwarded.',
    labelNames: ['type'],
});

export const notAuthorizedCount = new prometheus.Counter({
    name: 'kube_auth_proxy_not_authorized',
    help:
        'A count of the number of requests not forwarded,' + 'because the user was not authorized.',
    labelNames: ['type'],
});

export const notAuthenticatedCount = new prometheus.Counter({
    name: 'kube_auth_proxy_not_authenticated',
    help:
        'A count of the number of requests not forwarded,' +
        'because the user was not authenticated.',
    labelNames: ['type'],
});

export const noTargetFound = new prometheus.Counter({
    name: 'kube_auth_proxy_no_target_found',
    help:
        'A count of the number of requests not forwarded,' +
        'because there was no destination configured.',
    labelNames: ['type'],
});

export const backendErrorCount = new prometheus.Counter({
    name: 'kube_auth_proxy_backend_error',
    help:
        'A count of the number of requests forwarded, but which had ' +
        'an error connecting to the backend service.',
    labelNames: ['type'],
});
