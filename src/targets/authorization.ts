import { CompiledProxyTarget } from '.';
import { GithubUser } from '../authModules/github';
import { Condition, KubeAuthProxyUser } from '../types';
import { intersectionNotEmpty } from '../utils/utils';

/**
 * Returns true if the given user is authorized to access the given target.
 *
 * @param authModules - List of enabled authentication modules.
 * @param user - The user to check.
 * @param target - the target to check.
 */
export function authorizeUserForTarget(user: KubeAuthProxyUser, target: CompiledProxyTarget) {
    let authorized = false;
    if (target.conditions.length === 0) {
        authorized = true;
    } else {
        authorized = target.conditions.some(
            condition => authorizeEmails(user, condition) && authorizeGithub(user, condition)
        );
    }

    return authorized;
}

/**
 * Returns true if the given user satisfies the `emailDomains` and `allowedEmails`
 * parts of the given condition.
 */
function authorizeEmails(user: KubeAuthProxyUser, condition: Condition) {
    const matchAllowedEmails =
        !condition.allowedEmails || intersectionNotEmpty(condition.allowedEmails, user.emails);

    const matchEmailDomains =
        !condition.emailDomains ||
        user.emails.some(email => condition.emailDomains?.some(domain => email.endsWith(domain)));

    return matchAllowedEmails && matchEmailDomains;
}

/**
 * Returns true if the given user satisfies the github parts of the given condition.
 */
function authorizeGithub(user: Express.User, condition: Condition): boolean {
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
