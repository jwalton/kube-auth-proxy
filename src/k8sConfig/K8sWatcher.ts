import * as k8s from '@kubernetes/client-node';
import { EventEmitter } from 'events';
import prometheus from 'prom-client';

const watcherHangup = new prometheus.Counter({
    name: 'kube_auth_proxy_watcher_hangup',
    help: 'A watcher hung up on us.',
});

declare interface K8sWatcher<T> {
    emit(event: 'updated', obj: T): boolean;
    emit(event: 'deleted', obj: T): boolean;
    emit(event: 'error', err: Error): boolean;
    /** Emitted when a resources is created or updated. */
    on(event: 'updated', listener: (obj: T) => void): this;
    /** Emitted when a resource is deleted. */
    on(event: 'deleted', listener: (obj: T) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * Watch a Kubernetes resource, and emit `updated` and `deleted` events for it.
 */
class K8sWatcher<T> extends EventEmitter {
    private _kubeConfig: k8s.KubeConfig;
    private _watch: any;

    /**
     * Create a new K8sWatcher.
     *
     * @param kubeConfig - Kubernetes cluster config.
     * @param endpoint - The endpoint to watch (e.g. '/api/v1/namespaces').
     */
    constructor(kubeConfig: k8s.KubeConfig, endpoint: string) {
        super();

        this._kubeConfig = kubeConfig;
        this._watch = this._makeWatch(endpoint);
    }

    private _makeWatch(endpoint: string) {
        const watch = new k8s.Watch(this._kubeConfig);
        return watch.watch(
            endpoint,
            {},
            (type, obj) => {
                switch (type) {
                    case 'ADDED':
                        this.emit('updated', obj);
                        break;
                    case 'MODIFIED':
                        this.emit('updated', obj);
                        break;
                    case 'DELETED':
                        this.emit('deleted', obj);
                        break;
                }
            },
            err => {
                if (err) {
                    this.emit('error', err);
                } else {
                    watcherHangup.inc();
                    this._watch = this._makeWatch(endpoint);
                }
            }
        );
    }

    close() {
        this.removeAllListeners();
        this._watch.removeAllListeners();
        this._watch.abort();
    }
}

export default K8sWatcher;
