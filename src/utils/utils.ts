import { URL } from 'url';
import { ForwardTarget, RawKubeAuthProxyConfig } from '../types';

/**
 * Converts a comma delimited list into an array.
 */
export function parseCommaDelimitedList(value: string): string[] {
    return value
        .split(',')
        .map(val => val.trim())
        .filter(val => !!val);
}

export function generateHttpMessage(
    statusCode: number,
    reason: string,
    headers: { [header: string]: string } = {},
    body = ''
) {
    return (
        `HTTP/1.1 ${statusCode} ${reason}\r\n` +
        `connection: close\r\n` +
        Object.keys(headers)
            .map(key => `${key}: ${headers[key]}\r\n`)
            .join('') +
        `content-length: ${body.length}\r\n` +
        '\r\n' +
        body
    );
}

export function sanitizeForwardTarget(config: RawKubeAuthProxyConfig, target: ForwardTarget) {
    let wsTargetUrl = target.wsTargetUrl;
    if (!wsTargetUrl) {
        const targetUrl = new URL(target.targetUrl);
        targetUrl.protocol = targetUrl.protocol === 'https' ? 'wss' : 'ws';
        wsTargetUrl = targetUrl.toString();
    }

    return {
        ...target,
        wsTargetUrl,
        conditions: target.conditions || config.defaultConditions || [],
    };
}
