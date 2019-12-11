/**
 * Converts a comma delimited list into an array.
 */
export function parseCommaDelimitedList(value: string): string[] {
    return value
        .split(',')
        .map(val => val.trim())
        .filter(val => !!val);
}

export function intersectionNotEmpty(a: string[], b: string[]) {
    return a.some(aValue => b.includes(aValue));
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
