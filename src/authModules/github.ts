import Octokit from '@octokit/rest';
import express from 'express';
import * as passportLib from 'passport';
import GitHubStrategy from 'passport-github';
import '../server/express-types';
import { Condition, KubeAuthProxyUser, SanitizedKubeAuthProxyConfig } from '../types';
import * as log from '../utils/logger';
import { parseCommaDelimitedList } from '../utils/utils';

const GITHUB_ALLOWED_ORGS = 'kube-auth-proxy/githubAllowedOrganizations';
const GITHUB_ALLOWED_TEAMS = 'kube-auth-proxy/githubAllowedTeams';
const GITHUB_ALLOWED_USERS = 'kube-auth-proxy/githubAllowedUsers';

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

export function getLoginButton(_config: SanitizedKubeAuthProxyConfig, targetUrl: string): string {
    return `<a href="/kube-auth-proxy/github?redirect=${targetUrl}">Login with Github</a>`;
}

export function k8sAnnotationsToConditions(
    _config: SanitizedKubeAuthProxyConfig,
    annotations: { [key: string]: string }
) {
    const answer: Condition[] = [];

    const githubAllowedOrgs = annotations[GITHUB_ALLOWED_ORGS];
    if (githubAllowedOrgs) {
        answer.push({
            githubAllowedOrganizations: parseCommaDelimitedList(githubAllowedOrgs).map(str =>
                str.toLowerCase()
            ),
        });
    }

    const githubAllowedTeams = annotations[GITHUB_ALLOWED_TEAMS];
    if (githubAllowedTeams) {
        answer.push({
            githubAllowedTeams: parseCommaDelimitedList(githubAllowedTeams).map(str =>
                str.toLowerCase()
            ),
        });
    }

    const githubAllowedUsers = annotations[GITHUB_ALLOWED_USERS];
    if (githubAllowedUsers) {
        answer.push({
            githubAllowedUsers: parseCommaDelimitedList(githubAllowedUsers).map(str =>
                str.toLowerCase()
            ),
        });
    }

    return answer;
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
            (_req, accessToken, _refreshToken, profile, cb) => {
                getOrgsAndTeamsForUser(accessToken)
                    .then(({ orgs, teams }) => {
                        const emails = profile.emails
                            ? profile.emails
                                  .filter(email => (email as any).verified)
                                  .map(email => email.value)
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
                    .catch(err => {
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

function intersectionNotEmpty(a: string[], b: string[]) {
    return a.some(aValue => b.includes(aValue));
}

/**
 * Returns true if the given user meets the given condition.
 */
export function authorize(user: Express.User, condition: Condition): boolean {
    const githubUser = user.type === 'github' ? (user as GithubUser) : false;

    let answer = true;
    const { githubAllowedUsers, githubAllowedOrganizations, githubAllowedTeams } = condition;

    if (githubAllowedUsers) {
        answer = answer && githubUser && githubAllowedUsers.includes(user.username);
    }
    if (githubAllowedTeams) {
        answer = answer && githubUser && intersectionNotEmpty(githubAllowedTeams, githubUser.teams);
    }
    if (githubAllowedOrganizations) {
        answer =
            answer &&
            githubUser &&
            intersectionNotEmpty(githubAllowedOrganizations, githubUser.orgs);
    }

    return answer;
}

/**
 * Returns a list of organizations and teams the user belongs to.
 */
async function getOrgsAndTeamsForUser(accessToken: string) {
    const octokit = new Octokit({ auth: accessToken });
    const orgs = (await octokit.orgs.listForAuthenticatedUser()).data.map(org =>
        org.login.toLowerCase()
    );
    const teams = (await octokit.teams.listForAuthenticatedUser()).data.map(team =>
        `${team.name}@${team.organization.login}`.toLowerCase()
    );
    return { orgs, teams };
}
