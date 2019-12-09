import clientSessions from 'client-sessions';
import { DEFAULT_COOKIE_NAME } from '../../src/config';

export function makeSessionCookieForUser(secret: string, user: any) {
    const sessionData = {
        passport: {
            user,
        },
    };

    const cookieData = clientSessions.util.encode(
        { cookieName: DEFAULT_COOKIE_NAME, secret, duration: 1000 * 60 * 5 },
        sessionData
    );

    return `${DEFAULT_COOKIE_NAME}=${cookieData}`;
}
