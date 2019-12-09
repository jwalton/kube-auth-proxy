import express from 'express';
import http from 'http';
import passport from 'passport';
import { Condition, ForwardTarget, SanitizedKubeAuthProxyConfig } from '../types';

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
    getLoginButton(config: SanitizedKubeAuthProxyConfig, redirectUrl: string): string;

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

    /**
     * Given a set of annotations, return zero or more Condition objects.
     *
     * Each object returned represents a set of requirements to access this service.
     * For a given request, these will be passed to `this.authorize()`, and if any
     * one of the returned objects is authorized, the request will be allowed
     * through.
     *
     * If there are no annotations for this AuthModule, this may return sensible
     * defaults based on the `config`.
     */
    k8sAnnotationsToConditions?(
        config: SanitizedKubeAuthProxyConfig,
        annotations: { [key: string]: string }
    ): Condition[];

    /**
     * Returns true if the currently authenticated meets the conditions in
     * `Condition`.  This will be called for each AuthModule, for each conditon.
     * All AuthModules must return true for a condition to pass.
     *
     * Note that an AuthModule only needs to implement this for logic specific
     * to that AuthModule.  If you're doing straight up OAuth authentication
     * and returning a user with an "emails" and "username" field and nothing
     * else, then the default email and username related conditions will all
     * be checked for you already.
     */
    authorize?(
        user: Express.User,
        condition: Condition,
        target: ForwardTarget,
        req: http.IncomingMessage
    ): boolean;
}
