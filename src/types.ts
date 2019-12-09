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

    defaultConditions?: Condition[];
    defaultTargets?: ForwardTarget[];

    logLevel?: LogLevel;
}

export type SanitizedKubeAuthProxyConfig = RawKubeAuthProxyConfig & {
    authDomain: string;
    sessionCookieName: string;
    sessionSecret: string;
    secureCookies: boolean;
    defaultConditions: Condition[];
    defaultTargets: ForwardTarget[];
};

export interface Condition {
    githubAllowedOrganizations?: string[];
    githubAllowedTeams?: string[];
    githubAllowedUsers?: string[];
}

export interface ForwardTarget {
    /** A key which uniquely identifies the "source" of the ForwardTarget. */
    key: string;
    /** The target endpoint to forward http traffic to. */
    targetUrl: string;
    /** The target endpoint to forward websocket traffic to. */
    wsTargetUrl: string;
    /** Will forward traffic to this endpoint if the "host" header starts with this string or is this string. */
    host: string;
    /** User must match one of the given conditions to be allowed access. */
    conditions: Condition[];
    /** If present, this bearer token will be added to the request as an authorization header when it is forwarded. */
    // TODO: Implement this.
    bearerToken?: string;
    // TODO: Add basic auth.
}

export interface CompiledForwardTarget {
    /** A key which uniquely identifies the "source" of the ForwardTarget. */
    key: string;
    /** The target endpoint to forward http traffic to. */
    targetUrl: string;
    /** The target endpoint to forward websocket traffic to. */
    wsTargetUrl: string;
    /** Will forward traffic to this endpoint if the "host" header starts with this string or is this string. */
    host: string;
    /** User must match one of the given conditions to be allowed access. */
    conditions: Condition[];
    /** A list of headers to add to requests sent to this target. */
    headers?: {};
}
