import * as k8s from '@kubernetes/client-node';

export type K8sSecretSpecifier =
    | {
          namespace: string;
          secretName: string;
          dataName: string;
      }
    | {
          namespace: string;
          secretRegex: RegExp;
          dataName: string;
      };

/**
 * Parse and validate a "secret specificier".
 *
 * @param spec - the specifier to parse.
 * @param source - the location where this specifier was read from (used in error messages).
 */
export function parseSecretSpecifier(defaultNamespace: string, spec: string, source: string) {
    let secretSpec: any;
    try {
        secretSpec = JSON.parse(spec);
    } catch (err) {
        throw new Error(`Could not parse ${spec} in ${source}`);
    }

    if (!secretSpec.namespace) {
        secretSpec.namespace = defaultNamespace;
    }

    if (!secretSpec.secretName && !secretSpec.secretRegex) {
        throw new Error(`Missing secretName in ${source}`);
    }

    if (typeof secretSpec.secretRegex === 'string') {
        try {
            secretSpec.secretRegex = new RegExp(secretSpec.secretRegex);
        } catch (err) {
            throw new Error(`Invalid secretRegex in ${source}: ${err.toString()}`);
        }
    } else if (secretSpec.secretRegex instanceof RegExp) {
        // OK
    } else {
        throw new Error(`Invalid secretRegex in ${source}`);
    }

    if (!secretSpec.dataName) {
        throw new Error(`Missing dataName in ${source}`);
    }
    return secretSpec as K8sSecretSpecifier;
}

/**
 * Get the value of a secret from Kubernetes.
 */
export async function readSecret(k8sApi: k8s.CoreV1Api, secret: K8sSecretSpecifier) {
    const name = `${secret.namespace}/${
        'secretName' in secret ? secret.secretName : secret.secretRegex
    }`;

    const secretObj =
        'secretName' in secret
            ? await getSecret(k8sApi, secret.namespace, secret.secretName)
            : await getSecretFromRegex(k8sApi, secret.namespace, secret.secretRegex);

    const base64Data = secretObj.data?.[secret.dataName];
    if (!base64Data) {
        throw new Error(`Secret ${name} has no data named ${secret.dataName}`);
    }
    return decodeSecret(base64Data);
}

export function decodeSecret(base64Data: string) {
    return Buffer.from(base64Data, 'base64').toString('utf-8');
}

function getSecret(k8sApi: k8s.CoreV1Api, namespace: string, secretName: string) {
    return k8sApi
        .readNamespacedSecret(secretName, namespace)
        .then(response => response.body)
        .catch(err => {
            if (err?.response?.statusCode === 404) {
                throw new Error(`Secret ${name} not found.`);
            } else {
                throw new Error(`Error fetching secret ${name} from Kubernetes.`);
            }
        });
}

async function getSecretFromRegex(k8sApi: k8s.CoreV1Api, namespace: string, secretRegex: RegExp) {
    const secrets = await k8sApi.listNamespacedSecret(namespace);
    for (const secret of secrets.body.items) {
        if (secret.metadata?.name && secretRegex.test(secret.metadata.name)) {
            return secret;
        }
    }

    throw new Error(
        `Could not find secret in namespace ${namespace} matching regex ${secretRegex}`
    );
}

/**
 * Convert a label selector into query parameters.
 */
export function labelSelectorToQueryParam(labelSelector: k8s.V1LabelSelector | undefined) {
    if (!labelSelector) {
        return '';
    }

    const filters: string[] = [];
    if (labelSelector.matchLabels) {
        for (const key of Object.keys(labelSelector.matchLabels)) {
            filters.push(`${key}=${labelSelector.matchLabels[key]}`);
        }
    }

    if (labelSelector.matchExpressions) {
        for (const expression of labelSelector.matchExpressions) {
            const operator = expression.operator.toLowerCase();
            if (operator === 'in' || operator === 'notin') {
                filters.push(
                    `${expression.key} ${operator} (${(expression.values || [])?.join(', ')})`
                );
            } else if (operator === 'exists') {
                filters.push(expression.key);
            } else if (operator === 'doesnotexist') {
                filters.push(`!${expression.key}`);
            } else {
                throw new Error(`Unknown operator ${expression.operator}`);
            }
        }
    }

    const value = filters.join(',');
    const query = new URLSearchParams();
    query.set('labelSelector', value);

    return `?${query.toString()}`;
}
