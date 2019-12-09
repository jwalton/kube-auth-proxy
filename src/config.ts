import crypto from 'crypto';
import { promises as fs } from 'fs';
import jsYaml from 'js-yaml';
import { RawKubeAuthProxyConfig, SanitizedKubeAuthProxyConfig } from './types';
import { sanitizeForwardTarget } from './utils/utils';

export const DEFAULT_PORT = 5050;
export const DEFAULT_METRICS_PORT = 5051;
export const DEFAULT_COOKIE_NAME = 'kube-auth-proxy';

/**
 * Read in and validate the kube-auth-proxy config file.
 */
export async function readConfig(
    configFile: string = './config/kube-auth-proxy.yaml'
): Promise<RawKubeAuthProxyConfig> {
    const configContents = (await fs.readFile(configFile, { encoding: 'utf-8' })) as string;
    const config = jsYaml.safeLoad(configContents) as RawKubeAuthProxyConfig;
    return config;
}

function checkType(name: string, value: any, expectedType: string) {
    if (typeof value !== expectedType) {
        throw new Error(`${name} must be of type ${expectedType}`);
    }
}

function parseInteger(name: string, value: any, def: number) {
    if (value == null) {
        return def;
    }

    const asNumber = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(asNumber)) {
        throw new Error(`${name} must be a number`);
    }
    return asNumber;
}

/**
 * Validate the configuration.
 */
export function validateConfig(config: RawKubeAuthProxyConfig): SanitizedKubeAuthProxyConfig {
    if (!config || !config.domain) {
        throw new Error(`domain required in configuration.`);
    }

    if (!config.authDomain) {
        if (config.domain === 'localhost' || config.domain.startsWith('localhost:')) {
            config.authDomain = config.domain;
        } else {
            config.authDomain = `auth.${config.domain}`;
        }
    }

    if (!config.sessionCookieName) {
        config.sessionCookieName = DEFAULT_COOKIE_NAME;
    }
    checkType('sessionCookieName', config.sessionCookieName, 'string');

    config.sessionSecret = config.sessionSecret ?? crypto.randomBytes(32).toString('hex');

    config.secureCookies = config.secureCookies ?? true;
    checkType('secureCookies', config.secureCookies, 'boolean');

    if (
        config.namespaces &&
        (!Array.isArray(config.namespaces) ||
            !config.namespaces.every(namespace => typeof namespace === 'string'))
    ) {
        throw new Error(`namespaces must be an array of strings`);
    }

    config.port = parseInteger('port', config.port, DEFAULT_PORT);
    config.metricsPort = parseInteger('metricsPort', config.metricsPort, DEFAULT_METRICS_PORT);

    if (!config.auth?.github?.clientID || !config.auth?.github?.clientSecret) {
        throw new Error('Missing github credentials in config file.');
    }

    // FIXME: Better validation for these - if someone misspells a key, we don't
    // want to allow users we shouldn't.  We should pass these to the AuthMod
    // to validate/clean up.  We should also disallow conditions with no "type".
    if (!config.defaultConditions) {
        config.defaultConditions = [];
    }

    config.defaultTargets = (config.defaultTargets || []).map((forward, index) => ({
        ...sanitizeForwardTarget(config, forward),
        key: `config-${index}`,
    }));

    return config as SanitizedKubeAuthProxyConfig;
}
