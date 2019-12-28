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

        //; TODO: Could probably come up with a prettier login screen.  :P
        res.set('content-type', 'text/html');
        res.end(loginScreen({ authModules, redirectUrl }));
    });

    router.use((req, res, next) => {
        // If there's an authenticated user, forward this along.  Otherwise, need to return the login screen.
        if (req.user) {
            log.debug(`authentication: Found user ${req.user.username}@${req.user.type}`);
            next();
        } else {
            notAuthenticatedCount.inc({ type: 'http' });

            /*
             * Note that we could return a 302 here and redirect to
             * `/kube-auth-proxy/login?redirect=...`.  Instead we return
             * a 401 here.
             *
             * Some clients will run into problems if we return a 302 here,
             * if they automatically follow redirects.  Consider being
             * logged in to some service, leave the window open for a bit,
             * then kube-auth-proxy automatically logs you out.  You come
             * back to this existing window, and click on a button that
             * results in an AJAX request.  If the client code is using
             * the WHAT-WG fetch API, they'll probably automatically
             * follow the 302 to the login page (which will be a 200),
             * and then try to pass the login page through `JSON.parse()`,
             * which ends in sad faces all around.  By returning a 401
             * error here, we make it more likely the client will do
             * something sensible in this situation.
             */
            log.debug(
                `Returning login screen for unauthenticated connection to ${req.headers.host}`
            );

            const redirectUrl = `${req.protocol}://${req.headers.host}${req.originalUrl}`;

            res.status(401)
                .set('WWW-Authenticate', 'type=OAuth')
                .end(loginScreen({ authModules, redirectUrl }));
        }
    });

    return router;
}
