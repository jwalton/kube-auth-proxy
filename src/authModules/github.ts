import { Octokit } from '@octokit/rest';
import express from 'express';
import * as passportLib from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import '../server/express-types';
import { KubeAuthProxyUser, SanitizedKubeAuthProxyConfig } from '../types';
import * as log from '../utils/logger';

// Refresh the user's teams and orgs every 5 minutes.
const USER_REFRESH_INTERVAL = 1000 * 60 * 5;

export interface GithubUser extends KubeAuthProxyUser {
    type: 'github';
    accessToken: string;
    id: string;
    username: string;
    orgs: string[];
    teams: string[];
    emails: string[];
    timestamp: number;
}

export const name = 'github';

export function isEnabled(config: SanitizedKubeAuthProxyConfig) {
    return config.auth?.github != null;
}

export function getLoginButton(targetUrl: string): string {
    return `<a href="/kube-auth-proxy/github?redirect=${targetUrl}">Login with Github</a>`;
}

/**
 * Returns a middleware which will authenticate GitHub users.
 */
export function authenticationMiddleware(
    config: SanitizedKubeAuthProxyConfig,
    passport: passportLib.Authenticator
) {
    if (!config.auth?.github) {
        throw new Error('Missing github config.');
    }

    passport.use(
        new GitHubStrategy(
            {
                clientID: config.auth.github.clientID,
                clientSecret: config.auth.github.clientSecret,
                callbackURL: `http://${config.authDomain}/kube-auth-proxy/github/callback`,
                scope: ['user:email', 'read:org'],
                passReqToCallback: true,
            },
            (
                _req: express.Request,
                accessToken: string,
                _refreshToken: string,
                profile: any,
                cb: (err?: Error | null, user?: object, info?: object) => void
            ) => {
                getOrgsAndTeamsForUser(accessToken)
                    .then(({ orgs, teams }) => {
                        const emails = profile.emails
                            ? (profile.emails
                                  .filter((email: any) => (email as any).verified)
                                  .map((email: any) => email.value) as string[])
                            : [];

                        const user: GithubUser = {
                            type: 'github',
                            accessToken: accessToken,
                            id: profile.id,
                            username: profile.username || profile.id,
                            emails,
                            orgs: orgs,
                            teams: teams,
                            timestamp: Date.now(),
                        };

                        log.info(`Authenticated github user ${user.username}`);

                        cb(null, user);
                    })
                    .catch((err) => {
                        log.error(err, 'Error fetching orgs and teams');
                        cb(err);
                    });
            }
        )
    );

    const router = express.Router();

    router.use((req, _res, next) => {
        if (req.user && req.user.type === 'github') {
            const user = req.user as GithubUser;
            if (Date.now() - (user.timestamp ?? 0) > USER_REFRESH_INTERVAL) {
                log.debug(`Refreshing github orgs and teams for user ${user.username}`);
                getOrgsAndTeamsForUser(user.accessToken).then(({ orgs, teams }) => {
                    const updatedUser: GithubUser = {
                        ...user,
                        orgs,
                        teams,
                        timestamp: Date.now(),
                    };
                    req.login(updatedUser, next);
                });
            } else {
                next();
            }
        } else {
            next();
        }
    });

    router.get('/kube-auth-proxy/github', (req, res, next) => {
        const redirectTo = req.query.redirect;

        passport.authenticate('github', { state: `rd=${redirectTo}` })(req, res, next);
    });

    router.get(
        '/kube-auth-proxy/github/callback',
        passport.authenticate('github', { failureRedirect: '/' }),
        (req, res) => {
            if (typeof req.query.state != 'string') {
                res.send('Missing state');
                return;
            }

            const state = new URLSearchParams(req.query.state);
            const redirectTarget = state.get('rd');

            // User is now authenticated.  Redirect them to wherever they were going in the first place.
            if (redirectTarget) {
                res.redirect(redirectTarget);
            } else {
                res.send('Logged in - please try your request again.');
            }
        }
    );

    return router;
}

/**
 * Returns a list of organizations and teams the user belongs to.
 */
async function getOrgsAndTeamsForUser(accessToken: string) {
    const octokit = new Octokit({ auth: accessToken });
    const orgs = (await octokit.orgs.listForAuthenticatedUser()).data.map((org) =>
        org.login.toLowerCase()
    );
    const teams = (await octokit.teams.listForAuthenticatedUser()).data.map((team) =>
        `${team.name}@${team.organization.login}`.toLowerCase()
    );
    return { orgs, teams };
}
