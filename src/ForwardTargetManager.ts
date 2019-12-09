import * as k8s from '@kubernetes/client-node';
import { AuthModule } from './authModules/AuthModule';
import ConfigWatcher from './k8sConfig/ConfigWatcher';
import { ForwardTarget, SanitizedKubeAuthProxyConfig } from './types';
import * as log from './utils/logger';

/**
 * Keeps track of all configured ForwardTargets.
 *
 * Note that this class doesn't know anything about Kubernetes.  We could
 * theoretically support other configuration backends.
 */
export default class ForwardTargetManager {
    private _configWatch?: ConfigWatcher;
    private _domain: string;
    private _targetByKey: { [key: string]: ForwardTarget } = {};
    // This is generated from `_configsByKey` by calling `_rebuildConfigsByHost()`.
    private _targetsByHost: { [host: string]: ForwardTarget } = {};

    constructor(
        config: SanitizedKubeAuthProxyConfig,
        authModules: AuthModule[],
        options: {
            kubeConfig?: k8s.KubeConfig;
            domain: string;
            namespaces?: string[];
        }
    ) {
        this._domain = options.domain;

        if (options.kubeConfig) {
            this._configWatch = new ConfigWatcher(config, authModules, options.kubeConfig, options);

            this._configWatch.on('updated', config => {
                this._targetByKey[config.key] = config;
                this._rebuildConfigsByHost();
            });
            this._configWatch.on('deleted', key => {
                delete this._targetByKey[key];
                this._rebuildConfigsByHost();
            });
        }

        for (const defaultTarget of config.defaultTargets || []) {
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

        for (const key of Object.keys(this._targetByKey)) {
            const config = this._targetByKey[key];

            const host =
                config.host.includes(':') || config.host.includes('.')
                    ? config.host
                    : `${config.host}.${this._domain}`;

            if (this._targetsByHost[host]) {
                log.warn(
                    `Configuration from ${this._targetsByHost[host].key} conflicts with ${config.key}`
                );
            } else {
                this._targetsByHost[host] = config;
            }
        }
    }

    /**
     * Given the `host` header from an incoming request, find a ForwardTarget
     * to forward the request to.
     */
    findConfig(host: string) {
        return this._targetsByHost[host];
    }
}
