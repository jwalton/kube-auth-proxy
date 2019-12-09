import * as k8s from '@kubernetes/client-node';
import { V1Namespace } from '@kubernetes/client-node';
import { EventEmitter } from 'events';
import prometheus from 'prom-client';
import { AuthModule } from '../authModules/AuthModule';
import { ForwardTarget, SanitizedKubeAuthProxyConfig } from '../types';
import * as log from '../utils/logger';
import K8sWatcher from './K8sWatcher';
import NamespaceConfigWatcher from './NamespaceConfigWatcher';

const namespacesWatching = new prometheus.Gauge({
    name: 'kube_auth_proxy_watching_namespaces',
    help: 'The number of namespaces being watched for changes.',
});

const configUpdated = new prometheus.Counter({
    name: 'kube_auth_proxy_config_updated_by_k8s',
    help: 'A count of the number of times configuration has been updated from watching k8s.',
});

declare interface ConfigWatcher {
    emit(event: 'updated', data: ForwardTarget): boolean;
    emit(event: 'deleted', key: string): boolean;
    emit(event: 'error', err: Error): boolean;
    on(event: 'updated', listener: (data: ForwardTarget) => void): this;
    on(event: 'deleted', listener: (key: string) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * Watches for cluster for configuration changes.
 */
class ConfigWatcher extends EventEmitter {
    private _config: SanitizedKubeAuthProxyConfig;
    private _authModules: AuthModule[];
    private _kubeConfig: k8s.KubeConfig;
    private _namespaces: string[] | undefined;
    private _namespaceWatcher: K8sWatcher<V1Namespace>;
    private _namespaceConfigWatchers: { [namespace: string]: NamespaceConfigWatcher } = {};

    constructor(
        config: SanitizedKubeAuthProxyConfig,
        authModules: AuthModule[],
        kubeConfig: k8s.KubeConfig,
        options: {
            namespaces?: string[];
        } = {}
    ) {
        super();

        this._config = config;
        this._authModules = authModules;
        this._kubeConfig = kubeConfig;
        this._namespaces = options.namespaces;

        log.debug('Starting Kubernetes watcher...');

        this._namespaceWatcher = new K8sWatcher(kubeConfig, `/api/v1/namespaces/`);

        this._namespaceWatcher.on('updated', namespace => {
            const name = namespace.metadata?.name;
            if (name) {
                this._onNamespaceUpdated(name);
            }
        });

        this._namespaceWatcher.on('deleted', namespace => {
            const name = namespace.metadata?.name;
            if (name) {
                this._onNamespaceDeleted(name);
            }
        });

        this._namespaceWatcher.on('error', err => {
            log.error(err, 'Error watching Kubernetes namespaces!');
            process.exit(1);
        });
    }

    private _onNamespaceUpdated(namespace: string) {
        if (this._namespaces && !this._namespaces.includes(namespace)) {
            // Ignore this namespace.
            return;
        }

        if (this._namespaceConfigWatchers[namespace]) {
            // Already watching this namespace
        } else {
            const namespaceConfigWatcher = (this._namespaceConfigWatchers[
                namespace
            ] = new NamespaceConfigWatcher(
                this._config,
                this._authModules,
                this._kubeConfig,
                namespace
            ));

            namespaceConfigWatcher.on('updated', config => {
                log.info(`Updated config for ${config.key}`);
                configUpdated.inc();
                this.emit('updated', config);
            });

            namespaceConfigWatcher.on('deleted', key => {
                log.info(`Deleted config for ${key}`);
                configUpdated.inc();
                this.emit('deleted', key);
            });

            namespaceConfigWatcher.on('error', err => this.emit('error', err));

            log.debug(`Watching namespace ${namespace} for changes.`);
            namespacesWatching.set(Object.keys(this._namespaceConfigWatchers).length);
        }
    }

    private _onNamespaceDeleted(namespace: string) {
        if (this._namespaceConfigWatchers[namespace]) {
            this._namespaceConfigWatchers[namespace].close();
            delete this._namespaceConfigWatchers[namespace];

            log.debug(`Stopped watching namespace ${namespace}.`);
            namespacesWatching.set(Object.keys(this._namespaceConfigWatchers).length);
        }
    }

    /**
     * Stop listening to this namespace.
     */
    close() {
        this._namespaceWatcher.close();
        for (const namespace of Object.keys(this._namespaceConfigWatchers)) {
            this._onNamespaceDeleted(namespace);
        }
        this.removeAllListeners();
    }
}

export default ConfigWatcher;
