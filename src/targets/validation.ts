import fs from 'fs';
import jsYaml from 'js-yaml';
import path from 'path';
import Ajv from 'ajv';
import { RawProxyTarget } from './index';

const PROXY_TARGET_CRD = jsYaml.safeLoad(
    fs.readFileSync(path.resolve(__dirname, '../../crds/kube-auth-proxy-proxy-target-crd.yaml'), {
        encoding: 'utf-8',
    })
);
const PROXY_TARGET_SCHEMA = PROXY_TARGET_CRD.spec.validation.openAPIV3Schema;

// Internally we add "key" and "source" right when we read the object.
PROXY_TARGET_SCHEMA.properties.target.properties.key = { type: 'string' };
PROXY_TARGET_SCHEMA.properties.target.properties.source = { type: 'string' };

const ajv = new Ajv({ strictKeywords: true });
const proxyTargetValidator = ajv.compile(PROXY_TARGET_SCHEMA);

export function validateProxyTarget(target: RawProxyTarget) {
    const valid = proxyTargetValidator({ target });
    if (!valid) {
        let message: string | undefined;
        if (proxyTargetValidator.errors && proxyTargetValidator.errors.length === 1) {
            message = proxyTargetValidator.errors[0].message;
        }
        if (!message) {
            message = `\n${JSON.stringify(proxyTargetValidator.errors, null, 4)}`;
        }
        throw new Error(`Invalid ProxyTarget: ${message}`);
    }
}
