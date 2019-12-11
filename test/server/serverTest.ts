import { expect } from 'chai';
import express from 'express';
import http from 'http';
import 'mocha';
import pEvent from 'p-event';
import { makeFetch } from 'supertest-fetch';
import { DEFAULT_COOKIE_NAME } from '../../src/config';
import { startServer } from '../../src/server';
import { CompiledProxyTarget } from '../../src/targets';
import { SanitizedKubeAuthProxyConfig } from '../../src/types';
import { makeSessionCookieForUser } from '../fixtures/makeSessionCookie';
import MockAuthModule from '../fixtures/MockAuthModule';
import { mockProxyTargetManager } from '../fixtures/mockProxyTargetManager';
import { makeTestServer } from '../fixtures/testServer';

const SESSION_SECRET = 'woo';

const DEFAULT_CONFIG: SanitizedKubeAuthProxyConfig = {
    domain: 'test.com',
    authDomain: 'auth.test.com',
    secureCookies: false,
    sessionSecret: SESSION_SECRET,
    sessionCookieName: DEFAULT_COOKIE_NAME,
    defaultConditions: [],
    defaultTargets: [],
};

const USER_JWALTON = {
    type: 'mock-auth',
    username: 'jwalton',
};

describe('Server Tests', function() {
    let testServer: http.Server;
    let testPort: number;
    let server: http.Server | undefined;
    let proxyTarget: CompiledProxyTarget;

    before(async function() {
        const app = express();
        app.get('/hello', (_req, res) => res.send('Hello World!'));
        app.get('/authorization', (req, res) => {
            res.json(req.headers);
        });

        ({ server: testServer, port: testPort } = await makeTestServer(app));

        proxyTarget = {
            compiled: true,
            host: 'mock.test.com',
            key: 'mock',
            source: 'mock',
            targetUrl: `http://localhost:${testPort}`,
            wsTargetUrl: `ws://localhost:${testPort}`,
            conditions: [{ allowedUsers: USER_JWALTON.username } as any],
        };
    });

    after(function() {
        testServer.close();
    });

    afterEach(function() {
        if (server) {
            server.close();
        }
    });

    it('should require authentication', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        await fetch('/hello', { redirect: 'manual' }).expect(302, /\/kube-auth-proxy\/login/);
    });

    it('should redirect to login screen', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        await fetch('/hello', { redirect: 'follow' }).expect(200, /Login with Mock Provider/);
    });

    it('should proxy a request for an authorized user', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        await fetch('/hello', {
            headers: {
                host: 'mock.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        }).expect(200, 'Hello World!');
    });

    it('should login a user', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        await fetch(`/kube-auth-proxy/mockauth?username=${USER_JWALTON.username}`, {
            headers: {
                host: 'mock.test.com',
            },
            redirect: 'manual',
        }).expect(302);
    });

    it('should proxy a request for an authenticated user, for a target with no conditions', async function() {
        const target = {
            ...proxyTarget,
            conditions: [],
        };

        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([target]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        await fetch('/hello', {
            headers: {
                host: 'mock.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        }).expect(200, 'Hello World!');
    });

    it('should deny a request for an unauthorized user', async function() {
        const myProxyTarget = {
            ...proxyTarget,
            conditions: [{ allowedUsers: 'someone-else' } as any],
        };
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([myProxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        await fetch('/hello', {
            headers: {
                host: 'mock.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        }).expect(403);
    });

    it('should return a 404 if the host header does not resolve to a target', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        await fetch('/hello', {
            headers: {
                host: 'unknown.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        }).expect(404);
    });

    it('should add a authorization header', async function() {
        const target: CompiledProxyTarget = {
            ...proxyTarget,
            conditions: [],
            headers: {
                authorization: 'Bearer mr.token',
            },
        };

        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([target]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const fetch = makeFetch(server);
        const result = await fetch('/authorization', {
            headers: {
                host: 'mock.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
                test: 'foo',
            },
        }).expect(200);

        const headers = await result.json();

        // Should add an authorization header.
        expect(headers.authorization).to.equal('Bearer mr.token');

        // Make sure we don't clobber existing headers.
        expect(headers.test).to.equal('foo');
    });
});
