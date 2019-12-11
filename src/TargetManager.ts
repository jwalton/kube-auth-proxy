import * as k8s from '@kubernetes/client-node';
import prometheus from 'prom-client';
import ConfigWatcher from './k8sConfig/ConfigWatcher';
import { ProxyTargetFinder } from './server/findTarget';
import { CompiledProxyTarget } from './targets';
import * as log from './utils/logger';

export const servicesProxied = new prometheus.Gauge({
    name: 'kube_auth_proxy_forwarded_targets',
    help: 'Number of services being tracked by kube-auth-proxy.',
});

export const serviceConflicts = new prometheus.Gauge({
    name: 'kube_auth_proxy_target_conflicts',
    help: 'Number of services being ignored because they conflict with other services.',
});

/**
 * Keeps track of all configured ForwardTargets.
 *
 * Note that this class doesn't know anything about Kubernetes.  We could
 * theoretically support other configuration backends.
 */
export default class TargetManager implements ProxyTargetFinder {
    private _configWatch?: ConfigWatcher;
    private _domain: string;
    private _targetByKey: { [key: string]: CompiledProxyTarget } = {};
    // This is generated from `_configsByKey` by calling `_rebuildConfigsByHost()`.
    private _targetsByHost: { [host: string]: CompiledProxyTarget } = {};

    constructor(
        defaultTargets: CompiledProxyTarget[],
        options: {
            domain: string;
            kubeConfig?: k8s.KubeConfig;
            namespaces?: string[];
            proxyTargetSelector?: k8s.V1LabelSelector;
        }
    ) {
        this._domain = options.domain;

        if (options.kubeConfig) {
            this._configWatch = new ConfigWatcher(options.kubeConfig, options);

            this._configWatch.on('updated', target => {
                if (!this._targetByKey[target.key]) {
                    log.info(
                        `Adding target ${target.host} => ${target.targetUrl} (from ${target.source})`
                    );
                }
                this._targetByKey[target.key] = target;
                this._rebuildConfigsByHost();
            });
            this._configWatch.on('deleted', target => {
                if (this._targetByKey[target.key]) {
                    log.info(
                        `Removing target ${target.host} => ${target.targetUrl} (from ${target.source})`
                    );
                    delete this._targetByKey[target.key];
                }
                this._rebuildConfigsByHost();
            });

            this._configWatch.on('error', err => {
                log.error(err, 'Unexpected error from configuration watcher.');
                process.exit(1);
            });
        }

        for (const defaultTarget of defaultTargets || []) {
            log.info(
                `Adding target from static configuration ${defaultTarget.host} => ${defaultTarget.targetUrl}`
            );
            this._targetByKey[defaultTarget.key] = defaultTarget;
        }
        this._rebuildConfigsByHost();
    }

    /**
     * This regenerates this._configsByHost().
     *
     * Keys are unique, so when a ForwardTarget is updated or deleted. it's
     * easy to add/update/remove it from `this._configsByKey`.  The host
     * associated with a ForwardConfig can change, however, or it's even
     * possible for two different ForwardTargets to have the same conflicting
     * `host`.  So rather than try to maintain a `_configsByHost` (which
     * we want to have for fast lookups when requests come in) we regenerate
     * this from `_configsByKey` every time there's a change.  The theory
     * is that config changes are infrequent, so this shouldn't happen
     * too often, so even if it's a bit slow it's not a problem.  We'll see
     * if that proves true in practice.  :)
     */
    private _rebuildConfigsByHost() {
        this._targetsByHost = {};

        let count = 0;
        let conflicts = 0;

        for (const key of Object.keys(this._targetByKey)) {
            const config = this._targetByKey[key];

            const host =
                config.host.includes(':') || config.host.includes('.')
                    ? config.host
                    : `${config.host}.${this._domain}`;

            if (this._targetsByHost[host]) {
                conflicts++;
                log.warn(
                    `Configuration from ${this._targetsByHost[host].key} conflicts with ${config.key}`
                );
            } else {
                count++;
                this._targetsByHost[host] = config;
            }
        }

        servicesProxied.set(count);
        serviceConflicts.set(conflicts);
    }

    /**
     * Given the `host` header from an incoming request, find a ForwardTarget
     * to forward the request to.
     */
    findTarget(host: string) {
        return this._targetsByHost[host];
    }
}
