import * as http from 'http';

/**
 * Return the TCP port number that the given server is listening on.
 *
 * @returns the port number, or -1 if the server isn't listening.
 */
export function getServerPort(server: http.Server): number {
    const address = server.address();

    if (typeof address === 'string') {
        throw new Error(
            "This function doesn't handle a server listening on a pipe or unix domain socket."
        );
    } else if (address === null) {
        return -1;
    } else {
        return address.port;
    }
}
