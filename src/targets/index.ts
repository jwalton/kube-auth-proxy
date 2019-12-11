import * as k8s from '@kubernetes/client-node';
import _ from 'lodash';
import { URL } from 'url';
import { K8sSecretSpecifier, readSecret } from '../k8sConfig/k8sUtils';
import { Condition, RawCondition } from '../types';
import * as log from '../utils/logger';

interface ServiceNameTargetSpecifier {
    namespace?: string;
    service: string;
    targetPort: string | number;
    protocol?: 'http' | 'https';
    validateCertificate?: boolean;
}

export type TargetSpecifier =
    | ServiceNameTargetSpecifier
    | {
          service: k8s.V1Service;
          targetPort: string | number;
          protocol?: 'http' | 'https';
          validateCertificate?: boolean;
      }
    | {
          targetUrl: string;
      };

export type RawProxyTarget = {
    /** A key which uniquely identifies the "source" of the ProxyTarget. */
    key: string;
    source: string;
    host: string;
    to: TargetSpecifier;
    bearerTokenSecret?: K8sSecretSpecifier;
    basicAuthUsername?: string;
    basicAuthPassword?: string;
    basicAuthPasswordSecret?: K8sSecretSpecifier;
    conditions?: RawCondition;
};

export interface Headers {
    [header: string]: string | string[];
}

export interface CompiledProxyTarget {
    compiled: true;
    /**
     * A key which uniquely identifies this ProxyTarget.
     */
    key: string;
    /**
     * A key which uniquely identifies the source of the ProxyTarget.
     * Note that multiple targets may have the same source if they came from the
     * same place (for example, many targets defined in a single
     * configmap).
     */
    source: string;
    /** The target endpoint to forward http traffic to. */
    targetUrl: string;
    /** The target endpoint to forward websocket traffic to. */
    wsTargetUrl: string;
    /**
     * kube-auth-proxy will forward traffic to this endpoint if the "host"
     * header in the request is `${host}.${domain}` or is this string.
     */
    host: string;
    /** User must match one of the given conditions to be allowed access. */
    conditions: Condition[];
    validateCertificate: boolean;
    /** A list of headers to add to requests sent to this target. */
    headers?: Headers;
}

export function isServiceNameTargetSpecifier(
    target: TargetSpecifier
): target is ServiceNameTargetSpecifier {
    return 'service' in target && typeof target.service === 'string';
}

export async function compileProxyTarget(
    k8sApi: k8s.CoreV1Api | undefined,
    target: RawProxyTarget,
    defaultConditions: Condition[],
    options: {
        defaultNamespace?: string;
    } = {}
): Promise<CompiledProxyTarget> {
    let targetUrl: string;
    const { to } = target;
    let defaultNamespace = options.defaultNamespace;
    let validateCertificate = true;

    if ('targetUrl' in to && typeof to.targetUrl === 'string') {
        targetUrl = to.targetUrl;
    } else if (isServiceNameTargetSpecifier(to)) {
        if (!k8sApi) {
            throw new Error(`Can't load service ${to.service} without kubernetes.`);
        }
        const namespace = to.namespace || 'default';

        const service = await k8sApi.readNamespacedService(to.service, namespace);
        if (!service || !service.body) {
            throw new Error(`Can't find service ${namespace}/${to.service}`);
        }
        targetUrl = getTargetUrlFromService(service.body, to.targetPort, to.protocol ?? 'http');
        defaultNamespace = defaultNamespace || namespace;
        validateCertificate = to.validateCertificate ?? true;
    } else if ('service' in to && typeof to.service !== 'string') {
        targetUrl = getTargetUrlFromService(to.service, to.targetPort, to.protocol ?? 'http');
        defaultNamespace = defaultNamespace || to.service.metadata?.namespace;
        validateCertificate = to.validateCertificate ?? true;
    } else {
        throw new Error(
            `Need one of target.to.targetUrl or target.to.service in ${JSON.stringify(target)}`
        );
    }

    const url = new URL(targetUrl);
    url.protocol = url.protocol === 'https' ? 'wss' : 'ws';
    const wsTargetUrl = url.toString();

    let headers: Headers | undefined;

    const bearerToken = await readSecretOrString(k8sApi, {
        secret: target.bearerTokenSecret,
        defaultNamespace,
    });
    if (bearerToken) {
        headers = addHeader(headers, 'authorization', `Bearer ${bearerToken}`);
    }

    const username = target.basicAuthUsername;
    const password = await readSecretOrString(k8sApi, {
        secret: target.basicAuthPasswordSecret,
        value: target.basicAuthPassword,
        defaultNamespace,
    });
    if (username && password) {
        const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
        headers = addHeader(headers, 'authorization', `Basic ${basicAuth}`);
    }

    const answer: CompiledProxyTarget = {
        compiled: true,
        key: target.key,
        source: target.source,
        targetUrl,
        wsTargetUrl,
        host: target.host,
        conditions: getConditions(target.conditions, defaultConditions),
        validateCertificate,
        headers,
    };

    return answer;
}

export function parseTargetsFromFile(
    namespace: string | undefined,
    source: string,
    filename: string,
    targets: RawProxyTarget[] | undefined
) {
    if (!targets || !Array.isArray(targets)) {
        log.warn(`${source}/${filename}: has no targets.`);
        return [];
    }

    const uniqueTargets = _.uniqBy(targets, target => target.host);
    if (uniqueTargets.length !== targets.length) {
        log.warn(
            `${source}/${filename} has multiple targets with the same host - some will be ignored.`
        );
    }

    uniqueTargets.forEach(target => {
        if (isServiceNameTargetSpecifier(target.to)) {
            target.to.namespace = target.to.namespace || namespace;
        }
        target.source = source;
        target.key = `${source}/${filename}/${target.host}`;
    });
    return targets;
}

/**
 * Given a set of raw conditions from a service or config file,
 * generate a set of Condition objects.
 */
export function getConditions(target: RawCondition | undefined, defaultConditions: Condition[]) {
    const answer: Condition[] = [];

    const {
        allowedEmails,
        emailDomains,
        githubAllowedOrganizations,
        githubAllowedTeams,
        githubAllowedUsers,
    } = target || {};

    if (allowedEmails) {
        answer.push({ allowedEmails });
    }

    if (emailDomains) {
        answer.push({
            emailDomains: emailDomains.map(domain =>
                domain.startsWith('@') ? domain : `@${domain}`
            ),
        });
    }

    if (githubAllowedOrganizations) {
        answer.push({ githubAllowedOrganizations });
    }

    if (githubAllowedTeams) {
        answer.push({ githubAllowedTeams });
    }

    if (githubAllowedUsers) {
        answer.push({ githubAllowedUsers });
    }

    return answer.length > 0 ? answer : defaultConditions;
}

/**
 * Given a target port name, find the actual port number from the service.
 */
function getTargetPortNumber(service: k8s.V1Service, targetPortName: string | number | undefined) {
    const { name: serviceName, namespace } = service.metadata || {};
    let answer: number | undefined;

    if (typeof targetPortName === 'number') {
        answer = targetPortName;
    } else if (targetPortName) {
        const foundPortObj =
            service.spec?.ports &&
            (service.spec.ports.find(port => port.name === targetPortName) ||
                service.spec.ports.find(port => `${port.port}` === targetPortName));

        if (foundPortObj) {
            answer = foundPortObj.port;
        } else {
            // Try to turn `targetPortName` into a number.
            const asNumber = parseInt(targetPortName, 10);
            if (!isNaN(asNumber)) {
                answer = asNumber;
            } else {
                throw new Error(
                    `Can't find target port ${targetPortName ? `${targetPortName} ` : ''}` +
                        `for service ${namespace}/${serviceName}`
                );
            }
        }
        return answer;
    } else {
        const portObj = service.spec?.ports?.[0];
        if (portObj) {
            answer = portObj.port;
        }
    }
    return answer;
}

function getTargetUrlFromService(
    service: k8s.V1Service,
    targetPort: string | number | undefined,
    protocol: 'http' | 'https'
) {
    const targetPortNumber =
        getTargetPortNumber(service, targetPort) || (protocol === 'http' ? 80 : 443);
    const { name, namespace } = service.metadata || {};

    return `${protocol}://${name}.${namespace}:${targetPortNumber}`;
}

async function readSecretOrString(
    k8sApi: k8s.CoreV1Api | undefined,
    options: {
        secret?: K8sSecretSpecifier;
        value?: string;
        defaultNamespace?: string;
    }
) {
    if (options.value) {
        return options.value;
    } else if (options.secret) {
        if (!k8sApi) {
            throw new Error(`Can't specify secret without kubernetes.`);
        }
        return await readSecret(k8sApi, options.secret, options.defaultNamespace);
    } else {
        return undefined;
    }
}

function addHeader(headers: Headers | undefined, header: string, value: string) {
    const newHeaders = headers || {};
    const existing = newHeaders[header];
    if (!existing) {
        newHeaders[header] = value;
    } else if (typeof existing === 'string') {
        newHeaders[header] = [existing, value];
    } else if (Array.isArray(existing)) {
        existing.push(value);
    } else {
        throw new Error(`Can't add header ${header} to request headers with value ${existing}`);
    }
    return newHeaders;
}

export function getFqdnForTarget(domain: string, target: CompiledProxyTarget) {
    return target.host.includes(':') || target.host.includes('.')
        ? target.host
        : `${target.host}.${domain}`;
}
