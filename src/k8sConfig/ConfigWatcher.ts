import * as k8s from '@kubernetes/client-node';
import { EventEmitter } from 'events';
import prometheus from 'prom-client';
import { RawForwardTarget, CompiledForwardTarget, compileForwardTarget } from '../Targets';
import * as log from '../utils/logger';
import { parseCommaDelimitedList } from '../utils/utils';
import * as annotationNames from './annotationNames';
import { parseSecretSpecifier } from './k8sUtils';
import K8sWatcher from './K8sWatcher';
import { Condition } from '../types';

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
    emit(event: 'updated', data: CompiledForwardTarget): boolean;
    emit(event: 'deleted', key: string): boolean;
    emit(event: 'error', err: Error): boolean;
    on(event: 'updated', listener: (data: CompiledForwardTarget) => void): this;
    on(event: 'deleted', listener: (key: string) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * Watches for configuration changes across all namespaces.
 */
class ConfigWatcher extends EventEmitter {
    // TODO: Look into replacing this with an "informer"?
    private _serviceWatcher: K8sWatcher<k8s.V1Service>;
    private _configsByKey: { [serviceName: string]: CompiledForwardTarget } = {};
    private _namespaces: string[] | undefined;

    // Used to keep track of how often each service has been updated, so
    // if we get two updates back to back, we don't accidentally take the
    // result of the first update and discard the second due to async
    // ordering issues.
    private _serviceRevision: { [key: string]: number } = {};

    constructor(
        kubeConfig: k8s.KubeConfig,
        options: {
            namespaces?: string[];
            defaultConditions?: Condition[];
        } = {}
    ) {
        super();

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

                const rawTarget = serviceToTarget(namespace, service);
                if (rawTarget) {
                    const key = serviceNameToKey(namespace, serviceName);
                    this._serviceRevision[key] = (this._serviceRevision[key] || 0) + 1;
                    const revision = this._serviceRevision[key];

                    compileForwardTarget(k8sApi, rawTarget, options.defaultConditions || [])
                        .then(compiledTarget => {
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
                            } else if (compiledTarget) {
                                log.debug(`Updated service ${namespace}/${serviceName}`);
                                serviceUpdates.inc();
                                this._configsByKey[key] = compiledTarget;
                                this.emit('updated', compiledTarget);
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
function serviceToTarget(namespace: string, service: k8s.V1Service): RawForwardTarget | undefined {
    let answer: RawForwardTarget | undefined;

    const annotations = service.metadata?.annotations ?? {};

    const githubAllowedOrgs = annotations[annotationNames.GITHUB_ALLOWED_ORGS];
    const githubAllowedTeams = annotations[annotationNames.GITHUB_ALLOWED_TEAMS];
    const githubeAllowedUsers = annotations[annotationNames.GITHUB_ALLOWED_USERS];
    const bearerTokenSecret = annotations[annotationNames.BEARER_TOKEN_SECRET];
    const basicAuthPasswordSecret = annotations[annotationNames.BASIC_AUTH_PASSWORD_SECRET];

    if (annotations[annotationNames.HOST] && service.metadata?.name && service.spec?.ports) {
        answer = {
            key: `svc/${namespace}/${service.metadata.name}`,
            host: annotations[annotationNames.HOST],
            namespace: namespace,
            service,
            targetPort: annotations[annotationNames.TARGET_PORT],
            bearerTokenSecret: bearerTokenSecret
                ? parseSecretSpecifier(
                      bearerTokenSecret,
                      `service ${namespace}/${service.metadata.name}/annotations/${annotationNames.BEARER_TOKEN_SECRET}`
                  )
                : undefined,
            basicAuthUsername: annotations[annotationNames.BASIC_AUTH_USERNAME],
            basicAuthPassword: annotations[annotationNames.BASIC_AUTH_PASSWORD],
            basicAuthPasswordSecret: basicAuthPasswordSecret
                ? parseSecretSpecifier(
                      basicAuthPasswordSecret,
                      `service ${namespace}/${service.metadata.name}/annotations/${annotationNames.BASIC_AUTH_PASSWORD_SECRET}`
                  )
                : undefined,
            githubAllowedOrganizations: githubAllowedOrgs
                ? parseCommaDelimitedList(githubAllowedOrgs).map(str => str.toLowerCase())
                : undefined,
            githubAllowedUsers: githubeAllowedUsers
                ? parseCommaDelimitedList(githubeAllowedUsers).map(str => str.toLowerCase())
                : undefined,
            githubAllowedTeams: githubAllowedTeams
                ? parseCommaDelimitedList(githubAllowedTeams).map(str => str.toLowerCase())
                : undefined,
        };
    } else {
        const namespace = service.metadata?.namespace || 'unknown';
        const serviceName = service.metadata?.name || 'unknown';
        log.debug(
            `Ignoring service ${namespace}/${serviceName} because it is missing host annotation.`
        );
    }

    return answer;
}

export default ConfigWatcher;
