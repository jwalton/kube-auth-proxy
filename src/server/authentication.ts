import express from 'express';
import { Passport } from 'passport';
import { AuthModule } from '../authModules/AuthModule';
import { notAuthenticatedCount } from '../metrics';
import { SanitizedKubeAuthProxyConfig } from '../types';
import { loginScreen } from '../ui/loginScreen';
import * as log from '../utils/logger';
import './express-types';

/**
 * Returns an express-style `function(req, res, next)` which will handle the
 * request if the user is not logged in, and will pass the requets through
 * otherwise.
 */
export default function authentication(
    config: SanitizedKubeAuthProxyConfig,
    authModules: AuthModule[]
) {
    const passport = new Passport();

    // Whatever user the "AuthModule" gives us, just write it directly into the session.
    passport.serializeUser((user: any, done) => {
        // Verify users have a "type".
        if (user.type) {
            done(null, user);
        } else {
            done('pass');
        }
    });
    passport.deserializeUser((user: any, done) => done(null, user));

    const router = express.Router();

    router.use(passport.initialize());
    router.use(passport.session());

    for (const mod of authModules) {
        router.use(mod.authenticationMiddleware(config, passport));
    }

    router.get('/kube-auth-proxy/logout', (req, res) => {
        if (req.user) {
            log.info(`Logged out user ${req.user.username}@${req.user.type}`);
        }
        req.logout();
        res.redirect('/');
    });

    router.get('/kube-auth-proxy/login', (req, res) => {
        const redirectUrl = req.query.redirect || '/';

        const loginButtons = authModules.map(mod => mod.getLoginButton(config, redirectUrl));

        //; TODO: Could probably come up with a prettier login screen.  :P
        res.set('content-type', 'text/html');
        res.end(loginScreen({ loginButtons }));
    });

    router.use((req, res, next) => {
        // If there's an authenticated user, forward this along.  Otherwise, need to return the login screen.
        if (req.user) {
            log.debug(`authentication: Found user ${req.user.username}@${req.user.type}`);
            next();
        } else {
            notAuthenticatedCount.inc({ type: 'http' });
            log.debug(
                `Forwarding unauthenticated http connection to ` +
                    `${req.headers.host} to login screen.`
            );

            const redirectUrl = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
            const query = new URLSearchParams({ redirect: redirectUrl });
            res.redirect(`/kube-auth-proxy/login?${query.toString()}`);
        }
    });

    return router;
}
