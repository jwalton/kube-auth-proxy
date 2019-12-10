import * as k8s from '@kubernetes/client-node';
import { EventEmitter } from 'events';
import jsYaml from 'js-yaml';
import _ from 'lodash';
import prometheus from 'prom-client';
import {
    CompiledForwardTarget,
    compileForwardTarget,
    parseTargetsFromFile,
    RawForwardTarget,
} from '../Targets';
import { Condition } from '../types';
import * as log from '../utils/logger';
import { parseCommaDelimitedList } from '../utils/utils';
import * as annotationNames from './annotationNames';
import { decodeSecret, labelSelectorToQueryParam, parseSecretSpecifier } from './k8sUtils';
import K8sWatcher from './K8sWatcher';

export const updateSeen = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_update_seen',
    help: 'Number of times Kubernetes told us a service/configmap/secret updated.',
});

export const serviceUpdates = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_service_config_updated',
    help: 'Number of times a service was updated or deleted, from Kubernetes.',
});

export const staleUpdates = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_service_stale_updates',
    help: 'Number of times a service/configmap/secret was ignored because it was stale.',
});

export const serviceUpdateErrors = new prometheus.Counter({
    name: 'kube_auth_proxy_k8s_service_update_errors',
    help: 'Number of times a service or services could not be updated because of an error.',
});

declare interface ConfigWatcher {
    emit(event: 'updated', data: CompiledForwardTarget): boolean;
    emit(event: 'deleted', data: CompiledForwardTarget): boolean;
    emit(event: 'error', err: Error): boolean;
    on(event: 'updated', listener: (data: CompiledForwardTarget) => void): this;
    on(event: 'deleted', listener: (data: CompiledForwardTarget) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * Watches for configuration changes across all namespaces.
 */
class ConfigWatcher extends EventEmitter {
    // TODO: Look into replacing this with an "informer"?
    private _serviceWatcher: K8sWatcher<k8s.V1Service>;
    private _configMapWatcher: K8sWatcher<k8s.V1ConfigMap> | undefined;
    private _secretWatcher: K8sWatcher<k8s.V1Secret> | undefined;

    private _configsBySource: { [source: string]: CompiledForwardTarget[] } = {};
    private _namespaces: string[] | undefined;

    // Used to keep track of how often each object has been updated, so
    // if we get two updates back to back, we don't accidentally take the
    // result of the first update and discard the second due to async
    // ordering issues.
    private _objectRevision: { [source: string]: number } = {};

    constructor(
        kubeConfig: k8s.KubeConfig,
        options: {
            namespaces?: string[];
            defaultConditions?: Condition[];
            configMapSelector?: k8s.V1LabelSelector;
            secretSelector?: k8s.V1LabelSelector;
        } = {}
    ) {
        super();

        this._namespaces = options.namespaces;

        const k8sApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
        // this._serviceWatcher = this._watchServices(
        //     kubeConfig,
        //     k8sApi,
        //     options.defaultConditions || []
        // );
        this._serviceWatcher = this._watchObjects(
            kubeConfig,
            k8sApi,
            options.defaultConditions || [],
            'service',
            '/api/v1/services',
            undefined,
            serviceToTargets
        );

        if (options.configMapSelector) {
            this._configMapWatcher = this._watchObjects(
                kubeConfig,
                k8sApi,
                options.defaultConditions || [],
                'configmap',
                '/api/v1/configmaps',
                options.configMapSelector,
                configMapToTargets
            );
        }

        if (options.secretSelector) {
            this._secretWatcher = this._watchObjects(
                kubeConfig,
                k8sApi,
                options.defaultConditions || [],
                'secret',
                '/api/v1/secrets',
                options.secretSelector,
                secretToTargets
            );
        }
    }

    /**
     * Stop listening to services.
     */
    close() {
        this.removeAllListeners();

        this._serviceWatcher.close();
        if (this._configMapWatcher) {
            this._configMapWatcher.close();
        }
        if (this._secretWatcher) {
            this._secretWatcher.close();
        }

        for (const source of Object.keys(this._configsBySource)) {
            this._deleteSource(source);
        }
    }

    private _watchObjects<T extends { metadata?: k8s.V1ObjectMeta }>(
        kubeConfig: k8s.KubeConfig,
        k8sApi: k8s.CoreV1Api,
        defaultConditions: Condition[],
        type: string,
        url: string,
        labelSelector: k8s.V1LabelSelector | undefined,
        getRawTargets: (obj: T, source: string) => RawForwardTarget[]
    ) {
        const watchUrl = `${url}${labelSelectorToQueryParam(labelSelector)}`;
        const watcher: K8sWatcher<T> = new K8sWatcher(kubeConfig, watchUrl);

        log.info(`Watching ${type}s for updates (${watchUrl})`);

        watcher.on('updated', obj => {
            if (obj.metadata?.name) {
                const namespace = obj.metadata.namespace || 'default';
                const name = obj.metadata.name;

                if (this._namespaces && !this._namespaces.includes(namespace)) {
                    log.debug(
                        `Ignoring secret ${namespace}/${name} because it's not in a watched namespace`
                    );
                    return;
                }

                updateSeen.inc();

                const source = toSource(type, namespace, name);
                const rawTargets = getRawTargets(obj, source);
                this._updateSource(k8sApi, rawTargets, source, defaultConditions);
            }
        });

        watcher.on('deleted', secret => {
            if (secret.metadata?.name) {
                const namespace = secret.metadata.namespace || 'default';
                const source = toSource(type, namespace, secret.metadata.name);
                this._deleteSource(source);
            }
        });

        watcher.on('error', err => this.emit('error', err));

        return watcher;
    }

    /**
     * Called when a source (e.g. a service or configmap) is removed from the system,
     * or has no targets defined.
     */
    private _deleteSource(source: string) {
        if (this._configsBySource[source]) {
            log.debug(`${source} deleted`);

            for (const target of this._configsBySource[source]) {
                this.emit('deleted', target);
                serviceUpdates.inc();
            }
            delete this._configsBySource[source];
        }
    }

    /**
     * Called when a source (e.g. a service or configmap) is updated.
     */
    private async _updateSource(
        k8sApi: k8s.CoreV1Api,
        rawTargets: RawForwardTarget[],
        source: string,
        defaultConditions: Condition[]
    ) {
        this._objectRevision[source] = (this._objectRevision[source] || 0) + 1;
        const revision = this._objectRevision[source];

        if (rawTargets.length === 0) {
            log.debug(`${source} deconfigured`);
            this._deleteSource(source);
        } else {
            Promise.all(
                rawTargets.map(target => compileForwardTarget(k8sApi, target, defaultConditions))
            )
                .then(compiledTargets => {
                    if (this._objectRevision[source] !== revision) {
                        log.debug(`Ignoring stale update for ${source}`);
                        staleUpdates.inc();
                        // If `compileForwardTarget()` has to do async operations,
                        // those operations could resolve in a different order.
                        // e.g. if a service has a bearer token configured,
                        // `compileForwardTarget()` would have to load that from K8s.
                        // If that service is subsequently deleted, then
                        // `compileForwardTarget()` would just return `undefined`.
                        // We want to make sure if those two things happen
                        // back-to-back, and the second promise resolves first,
                        // that we end in a state where the service is deleted.
                    } else {
                        log.debug(`Updated ${source}`);

                        const exisitng: CompiledForwardTarget[] =
                            this._configsBySource[source] || [];

                        // If there are any services which used to be in this
                        // config which are now missing, delete the services.
                        const deleted = _.differenceBy(
                            exisitng,
                            compiledTargets,
                            target => target.key
                        );
                        for (const target of deleted) {
                            this.emit('deleted', target);
                            serviceUpdates.inc();
                        }

                        this._configsBySource[source] = compiledTargets;
                        for (const target of compiledTargets) {
                            this.emit('updated', target);
                            serviceUpdates.inc();
                        }
                    }
                })
                .catch(err => {
                    log.error(err);
                    serviceUpdateErrors.inc();
                });
        }
    }
}

function toSource(type: string, namespace: string, name: string) {
    return `${type}/${namespace}/${name}`;
}

/**
 * Extract configuration for a service from the service's annotations.
 */
function serviceToTargets(service: k8s.V1Service, source: string): RawForwardTarget[] {
    const answer: RawForwardTarget[] = [];
    const namespace = service.metadata?.namespace || 'default';
    const annotations = service.metadata?.annotations ?? {};

    if (annotations[annotationNames.HOST] && service.metadata?.name && service.spec?.ports) {
        const githubAllowedOrgs = annotations[annotationNames.GITHUB_ALLOWED_ORGS];
        const githubAllowedTeams = annotations[annotationNames.GITHUB_ALLOWED_TEAMS];
        const githubeAllowedUsers = annotations[annotationNames.GITHUB_ALLOWED_USERS];
        const bearerTokenSecret = annotations[annotationNames.BEARER_TOKEN_SECRET];
        const basicAuthPasswordSecret = annotations[annotationNames.BASIC_AUTH_PASSWORD_SECRET];

        answer.push({
            key: source,
            source: source,
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
        });
    } else {
        const serviceName = service.metadata?.name || 'unknown';
        log.debug(
            `Ignoring service ${namespace}/${serviceName} because it is missing host annotation.`
        );
    }

    return answer;
}

function configMapToTargets(configMap: k8s.V1ConfigMap, source: string) {
    const namespace = configMap.metadata?.namespace || 'default';
    let rawTargets: RawForwardTarget[] = [];
    if (configMap.data) {
        for (const file of Object.keys(configMap.data)) {
            try {
                const fileData = configMap.data[file];
                rawTargets = rawTargets.concat(
                    parseTargetsFromFile(
                        namespace,
                        source,
                        file,
                        jsYaml.safeLoad(fileData)?.targets
                    )
                );
            } catch (err) {
                log.warn(
                    `Ignoring data from configMap ${namespace}/${name}/${file}: ${err.toString()}`
                );
            }
        }
    }

    rawTargets.forEach((target, index) => {
        target.source = source;
        target.key = `${source}#${index}`;
    });
    return rawTargets;
}

function secretToTargets(secret: k8s.V1Secret, source: string) {
    const namespace = secret.metadata?.namespace || 'default';
    let rawTargets: RawForwardTarget[] = [];
    if (secret.data) {
        for (const file of Object.keys(secret.data)) {
            try {
                const fileData = decodeSecret(secret.data[file]);
                rawTargets = rawTargets.concat(
                    parseTargetsFromFile(
                        namespace,
                        source,
                        file,
                        jsYaml.safeLoad(fileData)?.targets
                    )
                );
            } catch (err) {
                log.warn(
                    `Ignoring data from secret ${namespace}/${name}/${file}: ${err.toString()}`
                );
            }
        }
    }

    rawTargets.forEach((target, index) => {
        target.source = source;
        target.key = `${source}#${index}`;
    });
    return rawTargets;
}

export default ConfigWatcher;
