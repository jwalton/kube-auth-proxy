import * as k8s from '@kubernetes/client-node';

export interface K8sSecretSpecifier {
    namespace: string;
    secretName: string;
    dataName: string;
}

/**
 * Parse and validate a "secret specificier".
 *
 * @param spec - the specifier to parse.
 * @param source - the location where this specifier was read from (used in error messages).
 */
export function parseSecretSpecifier(spec: string, source: string) {
    let secretSpec: K8sSecretSpecifier;
    try {
        secretSpec = JSON.parse(spec);
    } catch (err) {
        throw new Error(`Could not parse ${spec} in ${source}`);
    }

    if (!secretSpec.namespace) {
        throw new Error(`Missing namespace in ${source}`);
    }
    if (!secretSpec.secretName) {
        throw new Error(`Missing secretName in ${source}`);
    }
    if (!secretSpec.dataName) {
        throw new Error(`Missing dataName in ${source}`);
    }
    return secretSpec;
}

/**
 * Get the value of a secret from Kubernetes.
 */
export async function readSecret(k8sApi: k8s.CoreV1Api, secret: K8sSecretSpecifier) {
    const name = `${secret.namespace}/${secret.secretName}`;

    const secretObj = await k8sApi
        .readNamespacedSecret(secret.secretName, secret.namespace)
        .catch(err => {
            if (err?.response?.statusCode === 404) {
                throw new Error(`Secret ${name} not found.`);
            } else {
                throw new Error(`Error fetching secret ${name} from Kubernetes.`);
            }
        });

    const base64Data = secretObj.body.data?.[secret.dataName];
    if (!base64Data) {
        throw new Error(`Secret ${name} has no data named ${secret.dataName}`);
    }
    return base64Data;
}
