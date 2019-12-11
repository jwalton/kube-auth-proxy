import { CompiledProxyTarget } from '.';
import { AuthModule } from '../authModules/AuthModule';
import { Condition, KubeAuthProxyUser } from '../types';
import { intersectionNotEmpty } from '../utils/utils';

/**
 * Returns true if the given user is authorized to access the given target.
 *
 * @param authModules - List of enabled authentication modules.
 * @param user - The user to check.
 * @param target - the target to check.
 */
export function authorizeUserForTarget(
    authModules: AuthModule[],
    user: KubeAuthProxyUser,
    target: CompiledProxyTarget
) {
    let authorized = false;
    if (target.conditions.length === 0) {
        authorized = true;
    } else {
        authorized = target.conditions.some(
            condition =>
                authModules.every(module => {
                    let rejected = false;
                    if (module.authorize) {
                        rejected = !module.authorize(user, condition, target);
                    }
                    return !rejected;
                }) && authorizeEmails(user, condition)
        );
    }

    return authorized;
}

function authorizeEmails(user: KubeAuthProxyUser, condition: Condition) {
    const matchAllowedEmails =
        !condition.allowedEmails || intersectionNotEmpty(condition.allowedEmails, user.emails);

    const matchEmailDomains =
        !condition.emailDomains ||
        user.emails.some(email => condition.emailDomains?.some(domain => email.endsWith(domain)));

    return matchAllowedEmails && matchEmailDomains;
}
