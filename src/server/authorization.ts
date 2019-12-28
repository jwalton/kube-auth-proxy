import http from 'http';
import { notAuthorizedCount } from '../metrics';
import { CompiledProxyTarget } from '../targets';
import { authorizeUserForTarget } from '../targets/authorization';

export function authorizationMiddleware() {
    const mw = wsAuthorizationMiddleware();
    return (req: http.IncomingMessage, _res: any, next: (err?: Error) => void) => {
        mw(req, next);
    };
}

export function wsAuthorizationMiddleware() {
    return function authorization(req: http.IncomingMessage, next: (err?: Error) => void) {
        const { user, target } = req as { user?: Express.User; target?: CompiledProxyTarget };
        if (!user) {
            throw new Error("Attempted to authorize a user, but there's no user.");
        }
        if (!target) {
            throw new Error('No target in request.');
        }

        const authorized = authorizeUserForTarget(user, target);
        if (!authorized) {
            notAuthorizedCount.inc({ type: 'http' });
            const error = new Error('Not authorized');
            (error as any).status = 403;
            next(error);
        } else {
            next();
        }
    };
}
