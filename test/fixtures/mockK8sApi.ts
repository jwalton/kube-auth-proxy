import * as k8s from '@kubernetes/client-node';

export function createMockK8sApi(objects: { secrets?: k8s.V1Secret[] }) {
    const processedSecrets = (objects.secrets || []).map((s) => {
        const secret = {
            ...s,
        };
        if (secret.stringData) {
            secret.data = secret.data ? { ...secret.data } : {};
            for (const key of Object.keys(secret.stringData)) {
                secret.data[key] = Buffer.from(secret.stringData[key], 'utf-8').toString('base64');
            }
        }
        return secret;
    });

    return {
        async readNamespacedSecret(secretName: string, namespace: string) {
            const result = processedSecrets.find(
                (secret) =>
                    secret.metadata?.name === secretName && secret.metadata?.namespace === namespace
            );
            if (!result) {
                throw {
                    response: {
                        statusCode: 404,
                    },
                };
            }

            return { body: result };
        },
    } as k8s.CoreV1Api;
}
