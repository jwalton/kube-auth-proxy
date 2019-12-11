import { expect } from 'chai';
import express from 'express';
import http from 'http';
import 'mocha';
import { AddressInfo } from 'net';
import pEvent from 'p-event';
import WebSocket from 'ws';
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

describe('Websocket Server Tests', function() {
    let testServer: http.Server;
    let testPort: number;
    let server: http.Server | undefined;
    let wss: WebSocket.Server;
    let proxyTarget: CompiledProxyTarget;
    let client: WebSocket | undefined;

    before(async function() {
        const app = express();
        app.get('/hello', (_req, res) => res.send('Hello World!'));

        ({ server: testServer, port: testPort, wss } = await makeTestServer(app));

        proxyTarget = {
            compiled: true,
            key: 'mock',
            source: 'mock',
            targetUrl: `http://localhost:${testPort}`,
            wsTargetUrl: `ws://localhost:${testPort}`,
            /** Will forward traffic to this endpoint if the "host" header starts with this string or is this string. */
            host: 'mock.test.com',
            conditions: [{ allowedUsers: [USER_JWALTON.username] } as any],
            validateCertificate: true,
        };

        wss.on('connection', connection => {
            connection.send('Hello');
        });
    });

    after(function() {
        testServer.close();
    });

    afterEach(function() {
        if (server) {
            server.close();
        }
        if (client) {
            client.close();
        }
    });

    it('should require authentication', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const address = server.address() as AddressInfo;
        client = new WebSocket(`ws://localhost:${address.port}/`, {
            headers: {
                host: 'mock.test.com',
            },
        });

        const err = await pEvent(client as any, 'error');
        expect(err).to.exist;
        expect((err as Error).message).to.include('Unexpected server response: 401');

        client.close();
    });

    it('should proxy a request for an authorized user', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const address = server.address() as AddressInfo;
        client = new WebSocket(`ws://localhost:${address.port}/`, {
            headers: {
                host: 'mock.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        });

        const message = await pEvent(client as any, 'message');
        expect(message).to.equal('Hello');

        client.close();
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

        const address = server.address() as AddressInfo;
        client = new WebSocket(`ws://localhost:${address.port}/`, {
            headers: {
                host: 'mock.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        });

        const message = await pEvent(client as any, 'message');
        expect(message).to.equal('Hello');

        client.close();
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

        const address = server.address() as AddressInfo;
        client = new WebSocket(`ws://localhost:${address.port}/`, {
            headers: {
                host: 'mock.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        });

        const err = await pEvent(client as any, 'error');
        expect(err).to.exist;
        expect((err as Error).message).to.include('Unexpected server response: 403');

        client.close();
    });

    it('should return a 404 if the host header does not resolve to a target', async function() {
        server = startServer(DEFAULT_CONFIG, mockProxyTargetManager([proxyTarget]), [
            new MockAuthModule(),
        ]);
        await pEvent(server, 'listening');

        const address = server.address() as AddressInfo;
        client = new WebSocket(`ws://localhost:${address.port}/`, {
            headers: {
                host: 'unknown.test.com',
                cookie: makeSessionCookieForUser(SESSION_SECRET, USER_JWALTON),
            },
        });

        const err = await pEvent(client as any, 'error');
        expect(err).to.exist;
        expect((err as Error).message).to.include('Unexpected server response: 404');

        client.close();
    });

    it('should add a bearer token');
    it('should add a basic auth');
});
