import http from 'http';
import { URL } from 'url';
import { CompiledForwardTarget, ForwardTarget, Condition } from '../types';

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

function addHeader(headers: http.OutgoingHttpHeaders, header: string, value: string) {
    const existing = headers[header];
    if (!existing) {
        headers[header] = value;
    } else if (typeof existing === 'string') {
        headers[header] = [existing, value];
    } else if (Array.isArray(existing)) {
        existing.push(value);
    } else {
        throw new Error(`Can't add header ${header} to request headers with value ${existing}`);
    }
}

export function compileForwardTarget(
    defaultConditions: Condition[],
    target: ForwardTarget
): CompiledForwardTarget {
    let wsTargetUrl = target.wsTargetUrl;
    if (!wsTargetUrl) {
        const targetUrl = new URL(target.targetUrl);
        targetUrl.protocol = targetUrl.protocol === 'https' ? 'wss' : 'ws';
        wsTargetUrl = targetUrl.toString();
    }

    const headers: { [header: string]: string | string[] } = {};

    if (target.bearerToken) {
        addHeader(headers, 'authorization', `Bearer ${target.bearerToken}`);
    }

    if (target.basicAuth) {
        const { username, password } = target.basicAuth;
        const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
        addHeader(headers, 'authorization', `Basic ${basicAuth}`);
    }

    return {
        compiled: true,
        key: target.key,
        targetUrl: target.targetUrl,
        wsTargetUrl,
        host: target.host,
        conditions: target.conditions || defaultConditions || [],
        headers,
    };
}
