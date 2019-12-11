import * as k8s from '@kubernetes/client-node';
import { RawProxyTarget } from './targets';
import { LogLevel } from './utils/logger';

export interface KubeAuthProxyUser {
    /**
     * This is the authentication scheme that authorized this user (e.g. "github").
     */
    type: string;
    username: string;
    emails: string[];
}

export interface RawKubeAuthProxyConfig {
    /**
     * The top-level domain name to proxy for.  Used to set the domain
     * cookies are issued for.
     */
    domain: string;

    /**
     * This is a domain name for kube-auth-proxy itself.   Lots of
     * OAuth providers require a fixed callback URL, so this gives you
     * such a URL.  Defaults to `auth.${domain}`.
     */
    authDomain?: string;

    /**
     * A list of Kubernetes namespaces to watch.  If omitted, will watch all
     * namespaces.
     */
    namespaces?: string[];

    /**
     * Port to listen on.  If this is not specified in the config file, it
     * defaults to 5050.
     */
    port?: number;

    /**
     * Port to start metrics server on.  This will export prometheus style
     * metrics.  DEfaults to 5051.
     */
    metricsPort?: number;

    /**
     * Session cookie name.  Defaults to "kube-auth-proxy".
     */
    sessionCookieName?: string;

    /**
     * Session secret - this is required if you want to run kube-auth-proxy in
     * a cluster, or if you want your sessions to persist across reboots.
     */
    sessionSecret?: string;

    /**
     * If true (the default) then the secure attribute will be set on the session
     * cookie.  This must be disabled if you're using this without HTTPS.
     */
    secureCookies?: boolean;

    auth?: {
        github?: {
            clientID: string;
            clientSecret: string;
        };
    };

    defaultConditions?: RawCondition;
    defaultTargets?: RawProxyTarget[];

    logLevel?: LogLevel;

    proxyTargetSelector?: k8s.V1LabelSelector;
}

export type SanitizedKubeAuthProxyConfig = RawKubeAuthProxyConfig & {
    authDomain: string;
    sessionCookieName: string;
    sessionSecret: string;
    secureCookies: boolean;
    defaultConditions: Condition[];
    defaultTargets: RawProxyTarget[];
};

export interface RawCondition {
    allowedEmails?: string[];
    emailDomains?: string[];
    githubAllowedOrganizations?: string[];
    githubAllowedUsers?: string[];
    githubAllowedTeams?: string[];
}

export interface Condition {
    allowedEmails?: string[];
    emailDomains?: string[];
    githubAllowedOrganizations?: string[];
    githubAllowedTeams?: string[];
    githubAllowedUsers?: string[];
}
