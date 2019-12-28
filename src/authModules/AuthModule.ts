import express from 'express';
import passport from 'passport';
import { SanitizedKubeAuthProxyConfig } from '../types';

export interface AuthModule {
    /**
     * The name of this module.
     */
    name: string;

    /**
     * Returns false if this modules is not configured and should be disabled.
     */
    isEnabled(config: SanitizedKubeAuthProxyConfig): boolean;

    /**
     * Returns HTML for a button the user can click on to login using this service.
     *
     * @param redirectUrl - The URL to redirect to after authentication is
     *   successful.
     */
    getLoginButton(redirectUrl: string): string;

    /**
     * Returns a middleware which can authenticate users.  This middleware may
     * define routes under "/kube-auth-proxy", but will be called for all routes.
     *
     * This middleware can use the passed in `passport` instance to authenticate
     * the user and log them in, or can call `req.login(user, cb)` to login
     * a user.
     *
     * User should have, at a minimum, a `type` equal to the name of the
     * AuthModule, and conform to the `KubeAuthProxyUser` interface.
     */
    authenticationMiddleware(
        config: SanitizedKubeAuthProxyConfig,
        passport: passport.Authenticator
    ): express.RequestHandler;
}
