import http from 'http';
import { AuthModule } from '../authModules/AuthModule';
import { notAuthorizedCount } from '../metrics';
import { ForwardTarget } from '../types';

export function authorizationMiddleware(authModules: AuthModule[]) {
    const mw = wsAuthorizationMiddleware(authModules);
    return (req: http.IncomingMessage, _res: any, next: (err?: Error) => void) => {
        mw(req, next);
    };
}

export function wsAuthorizationMiddleware(authModules: AuthModule[]) {
    function authorizeTarget(req: http.IncomingMessage) {
        const { user, target } = req as { user?: Express.User; target?: ForwardTarget };
        if (!user) {
            throw new Error("Attempted to authorize a user, but there's no user.");
        }
        if (!target) {
            throw new Error('No target in request.');
        }

        let authorized = false;
        if (target.conditions.length === 0) {
            authorized = true;
        } else {
            authorized = target.conditions.some(condition =>
                authModules.every(module => {
                    let rejected = false;
                    if (module.authorize) {
                        rejected = !module.authorize(user, condition, target, req);
                    }
                    return !rejected;
                })
            );
        }

        return authorized;
    }

    return function authorization(req: http.IncomingMessage, next: (err?: Error) => void) {
        const authorized = authorizeTarget(req);
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
