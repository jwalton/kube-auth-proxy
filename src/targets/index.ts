import * as k8s from '@kubernetes/client-node';
import _ from 'lodash';
import { URL } from 'url';
import { K8sSecretSpecifier, readSecret } from '../k8sConfig/k8sUtils';
import { Condition, RawCondition } from '../types';
import * as log from '../utils/logger';

export type TargetSpecifier =
    | {
          namespace?: string;
          service: string;
          targetPort: string | number;
      }
    | {
          service: k8s.V1Service;
          targetPort: string | number;
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
    /** A list of headers to add to requests sent to this target. */
    headers?: Headers;
}

export function isServiceNameAndNamespace(
    target: TargetSpecifier
): target is {
    namespace?: string;
    service: string;
    targetPort: string;
} {
    return 'service' in target && typeof target.service === 'string';
}

export async function compileProxyTarget(
    k8sApi: k8s.CoreV1Api | undefined,
    target: RawProxyTarget,
    defaultConditions: Condition[]
): Promise<CompiledProxyTarget> {
    let targetUrl: string;
    const { to } = target;

    if ('targetUrl' in to && typeof to.targetUrl === 'string') {
        targetUrl = to.targetUrl;
    } else if (isServiceNameAndNamespace(to)) {
        if (!k8sApi) {
            throw new Error(`Can't load service ${to.service} without kubernetes.`);
        }
        const namespace = to.namespace || 'default';

        const service = await k8sApi.readNamespacedService(to.service, namespace);
        if (!service || !service.body) {
            throw new Error(`Can't find service ${namespace}/${to.service}`);
        }
        targetUrl = getTargetUrlFromService(service.body, to.targetPort);
    } else if ('service' in to && typeof to.service !== 'string') {
        targetUrl = getTargetUrlFromService(to.service, to.targetPort);
    } else {
        throw new Error(`Need one of target.targetUrl or target.service`);
    }

    const url = new URL(targetUrl);
    url.protocol = url.protocol === 'https' ? 'wss' : 'ws';
    const wsTargetUrl = url.toString();

    let headers: Headers | undefined;

    const bearerToken = await readSecretOrString(k8sApi, target.bearerTokenSecret, undefined);
    if (bearerToken) {
        headers = addHeader(headers, 'authorization', `Bearer ${bearerToken}`);
    }

    const username = target.basicAuthUsername;
    const password = await readSecretOrString(
        k8sApi,
        target.basicAuthPasswordSecret,
        target.basicAuthPassword
    );
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
        if (isServiceNameAndNamespace(target.to)) {
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

function getTargetUrlFromService(service: k8s.V1Service, targetPort: string | number | undefined) {
    const targetPortNumber = getTargetPortNumber(service, targetPort);
    return `http://${service.metadata?.name}.${service.metadata?.namespace}:${targetPortNumber ||
        80}`;
}

async function readSecretOrString(
    k8sApi: k8s.CoreV1Api | undefined,
    secret?: K8sSecretSpecifier,
    str?: string
) {
    if (str) {
        return str;
    } else if (secret) {
        if (!k8sApi) {
            throw new Error(`Can't specify secret without kubernetes.`);
        }
        return await readSecret(k8sApi, secret);
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
