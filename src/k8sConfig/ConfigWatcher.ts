import * as k8s from '@kubernetes/client-node';
import { V1Service, V1ServicePort } from '@kubernetes/client-node';
import { EventEmitter } from 'events';
import prometheus from 'prom-client';
import { AuthModule } from '../authModules/AuthModule';
import { Condition, ForwardTarget, SanitizedKubeAuthProxyConfig } from '../types';
import * as log from '../utils/logger';
import * as annotationNames from './annotationNames';
import { parseSecretSpecifier, readSecret } from './k8sUtils';
import K8sWatcher from './K8sWatcher';

export const serviceSeen = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_service_seen',
    help: 'Number of times Kubernetes told us a service updated.',
});

export const serviceUpdates = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_service_config_updated',
    help: 'Number of times a service was updated or deleted, from Kubernetes.',
});

export const staleUpdates = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_service_stale_updates',
    help: 'Number of times a service was updated or deleted, from Kubernetes.',
});

export const serviceUpdateErrors = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_service_update_errors',
    help: 'Number of times a service could not be updated because of an error.',
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
 * Watches for configuration changes across all namespaces.
 */
class ConfigWatcher extends EventEmitter {
    private _config: SanitizedKubeAuthProxyConfig;
    private _authModules: AuthModule[];
    private _serviceWatcher: K8sWatcher<V1Service>;
    private _configsByKey: { [serviceName: string]: ForwardTarget } = {};
    private _namespaces: string[] | undefined;

    // Used to keep track of how often each service has been updated, so
    // if we get two updates back to back, we don't accidentally take the
    // result of the first update and discard the second due to async
    // ordering issues.
    private _serviceRevision: { [key: string]: number } = {};

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
        this._namespaces = options.namespaces;

        this._serviceWatcher = new K8sWatcher(kubeConfig, `/api/v1/services`);

        const k8sApi = kubeConfig.makeApiClient(k8s.CoreV1Api);

        this._serviceWatcher.on('updated', service => {
            if (service.metadata?.name) {
                const namespace = service.metadata.namespace || 'default';
                const serviceName = service.metadata.name;

                if (this._namespaces && !this._namespaces.includes(namespace)) {
                    log.debug(
                        `Ignoring service ${namespace}/${serviceName} because it's not in a watched namespace`
                    );
                    return;
                }

                serviceSeen.inc();

                const key = serviceNameToKey(namespace, serviceName);
                this._serviceRevision[key] = (this._serviceRevision[key] || 0) + 1;
                const revision = this._serviceRevision[key];

                serviceToConfig(k8sApi, this._config, this._authModules, namespace, service)
                    .then(config => {
                        if (this._serviceRevision[key] !== revision) {
                            log.debug(
                                `Ignoring stale update for service ${namespace}/${serviceName}`
                            );
                            staleUpdates.inc();
                            // If `serviceToConfig()` has to do async operations,
                            // those operations could resolve in a different order.
                            // e.g. if a service has a bearer token configured,
                            // `serviceToConfig()` would have to load that from K8s.
                            // If that service is subsequently deleted, then
                            // `serviceToConfig()` would just return `undefined`.
                            // We want to make sure if those two things happen
                            // back-to-back, and the second promise resolves first,
                            // that we end in a state where the service is deleted.
                        } else if (config) {
                            log.debug(`Updated service ${namespace}/${serviceName}`);
                            serviceUpdates.inc();
                            this._configsByKey[config.key] = config;
                            this.emit('updated', config);
                        } else if (this._configsByKey[key]) {
                            log.debug(`Service ${namespace}/${serviceName} deconfigured`);
                            serviceUpdates.inc();
                            delete this._configsByKey[key];
                            this.emit('deleted', key);
                        }
                    })
                    .catch(err => {
                        log.error(err);
                        serviceUpdateErrors.inc();
                    });
            }
        });

        this._serviceWatcher.on('deleted', service => {
            if (service.metadata?.name) {
                const namespace = service.metadata.namespace || 'default';
                const key = serviceNameToKey(namespace, service.metadata.name);
                if (this._configsByKey[key]) {
                    log.debug(`Service ${namespace}/${service.metadata.name} deleted`);
                    serviceUpdates.inc();
                    delete this._configsByKey[key];
                    this.emit('deleted', key);
                }
            }
        });

        this._serviceWatcher.on('error', err => this.emit('error', err));
    }

    /**
     * Stop listening to services.
     */
    close() {
        for (const configKey of Object.keys(this._configsByKey)) {
            this.emit('deleted', configKey);
        }
        this._serviceWatcher.close();
        this.removeAllListeners();
    }
}

function serviceNameToKey(namespace: string, name: string) {
    return `svc/${namespace}/${name}`;
}

/**
 * Extract configuration for a service from the service's annotations.
 */
async function serviceToConfig(
    k8sApi: k8s.CoreV1Api,
    config: SanitizedKubeAuthProxyConfig,
    authModules: AuthModule[],
    namespace: string,
    service: V1Service
): Promise<ForwardTarget | undefined> {
    let answer: ForwardTarget | undefined;

    const annotations = service.metadata?.annotations ?? {};

    if (annotations[annotationNames.HOST] && service.metadata?.name && service.spec?.ports) {
        const targetPortName = annotations[annotationNames.TARGET_PORT];
        const targetPort = getTargetPortNumber(namespace, service, targetPortName);

        const targetUrl = `http://${service.metadata.name}.${namespace}:${targetPort || 80}`;
        const wsTargetUrl = `ws://${service.metadata.name}.${namespace}:${targetPort || 80}`;

        answer = {
            key: `svc/${service.metadata.name}`,
            host: annotations[annotationNames.HOST],
            targetUrl,
            wsTargetUrl,
            conditions: [],
        };

        if (annotations[annotationNames.BEARER_TOKEN_SECRET]) {
            const secretSpec = parseSecretSpecifier(
                annotations[annotationNames.BEARER_TOKEN_SECRET],
                `service ${namespace}/${service.metadata.name}/annotations/${annotationNames.BEARER_TOKEN_SECRET}`
            );
            const secretData = await readSecret(k8sApi, secretSpec);
            answer.bearerToken = secretData;
        }

        if (
            annotations[annotationNames.BASIC_AUTH_USERNAME] &&
            (annotations[annotationNames.BASIC_AUTH_PASSWORD] ||
                annotations[annotationNames.BASIC_AUTH_PASSWORD_SECRET])
        ) {
            const username = annotations[annotationNames.BASIC_AUTH_USERNAME];
            let password: string;
            if (annotations[annotationNames.BASIC_AUTH_PASSWORD_SECRET]) {
                const secretSpec = parseSecretSpecifier(
                    annotations[annotationNames.BEARER_TOKEN_SECRET],
                    `service ${namespace}/${service.metadata.name}/annotations/${annotationNames.BEARER_TOKEN_SECRET}`
                );
                password = await readSecret(k8sApi, secretSpec);
            } else {
                password = annotations[annotationNames.BASIC_AUTH_PASSWORD];
            }
            answer.basicAuth = { username, password };
        }

        for (const mod of authModules) {
            if (mod.k8sAnnotationsToConditions) {
                const modConditions: Condition[] = mod
                    .k8sAnnotationsToConditions(config, annotations)
                    .map(condition => ({ ...condition, type: mod.name } as Condition));

                answer.conditions = answer.conditions.concat(modConditions);
            }
        }
    } else {
        const namespace = service.metadata?.namespace || 'unknown';
        const serviceName = service.metadata?.name || 'unknown';
        log.debug(
            `Ignoring service ${namespace}/${serviceName} because it is missing host annotation.`
        );
    }

    return answer;
}

/**
 * Given a target port name, find the actual port number from the service.
 */
function getTargetPortNumber(
    namespace: string,
    service: V1Service,
    targetPortName: string | undefined
) {
    if (!service.spec?.ports || service.spec.ports.length === 0) {
        log.warn(
            `Can't get port number for namespace: ${namespace}, ` +
                `service: ${service.metadata?.name} with no ports.`
        );
        return undefined;
    }

    let portObj: V1ServicePort;
    if (targetPortName) {
        const foundPortObj =
            service.spec.ports.find(port => port.name === targetPortName) ||
            service.spec.ports.find(port => `${port.port}` === targetPortName);
        if (!foundPortObj) {
            throw new Error(
                `Can't find target port ${targetPortName ? `${targetPortName} ` : ''}` +
                    `for namespace: ${namespace}, service: ${service.metadata?.name}`
            );
        }
        portObj = foundPortObj;
    } else {
        portObj = service.spec.ports[0];
    }

    return portObj.port;
}

export default ConfigWatcher;
