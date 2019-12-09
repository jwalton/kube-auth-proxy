import clientSessions from 'client-sessions';
import Cookies from 'cookies';
import http from 'http';
import { SanitizedKubeAuthProxyConfig } from '../types';

/**
 * Returns an express-style `function(req, res, next)` which will handle the
 * request if the user is not logged in, and will pass the requets through
 * otherwise.
 */
export function sessionMiddleware(config: SanitizedKubeAuthProxyConfig) {
    return clientSessions(getClientSessionOpts(config));
}

export function wsSessionMiddleware(config: SanitizedKubeAuthProxyConfig) {
    const opts = getClientSessionOpts(config);

    return function session(req: http.IncomingMessage, next: (err?: Error) => void) {
        let done = false;

        try {
            const cookies = new Cookies(req, {} as any);
            const cookieData = cookies.get(config.sessionCookieName);
            if (cookieData) {
                const sessionData = clientSessions.util.decode(opts, cookieData);
                (req as any).session = sessionData?.content;
            }
            done = true;
            next();
        } catch (err) {
            if (!done) {
                next(err);
            }
        }
    };
}

function getClientSessionOpts(config: SanitizedKubeAuthProxyConfig) {
    const cookieDomain = config.domain.startsWith('localhost:') ? 'localhost' : config.domain;

    return {
        cookieName: config.sessionCookieName,
        requestKey: 'session',
        secret: config.sessionSecret,
        duration: 24 * 60 * 60 * 1000,
        activeDuration: 1000 * 60 * 5,
        cookie: {
            domain: cookieDomain,
            secure: config.secureCookies,
            httpOnly: true,
        },
    };
}
