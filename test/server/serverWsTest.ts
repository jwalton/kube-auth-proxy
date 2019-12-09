import { expect } from 'chai';
import express from 'express';
import http from 'http';
import 'mocha';
import { AddressInfo } from 'net';
import pEvent from 'p-event';
import WebSocket from 'ws';
import { DEFAULT_COOKIE_NAME } from '../../src/config';
import { startServer } from '../../src/server';
import { ForwardTarget, SanitizedKubeAuthProxyConfig } from '../../src/types';
import { makeSessionCookieForUser } from '../fixtures/makeSessionCookie';
import MockAuthModule from '../fixtures/MockAuthModule';
import { mockForwardTargetManager } from '../fixtures/mockForwardTargetManager';
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
    let forwardTarget: ForwardTarget;
    let client: WebSocket | undefined;

    before(async function() {
        const app = express();
        app.get('/hello', (_req, res) => res.send('Hello World!'));

        ({ server: testServer, port: testPort, wss } = await makeTestServer(app));

        forwardTarget = {
            host: 'mock.test.com',
            key: 'mock',
            targetUrl: `http://localhost:${testPort}`,
            wsTargetUrl: `ws://localhost:${testPort}`,
            conditions: [{ type: 'mock-auth' } as any],
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
        server = startServer(DEFAULT_CONFIG, mockForwardTargetManager([forwardTarget]), [
            new MockAuthModule([USER_JWALTON.username]),
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
        server = startServer(DEFAULT_CONFIG, mockForwardTargetManager([forwardTarget]), [
            new MockAuthModule([USER_JWALTON.username]),
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
            ...forwardTarget,
            conditions: [],
        };

        server = startServer(DEFAULT_CONFIG, mockForwardTargetManager([target]), [
            new MockAuthModule([USER_JWALTON.username]),
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
        server = startServer(DEFAULT_CONFIG, mockForwardTargetManager([forwardTarget]), [
            new MockAuthModule(['someone-else']),
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
        server = startServer(DEFAULT_CONFIG, mockForwardTargetManager([forwardTarget]), [
            new MockAuthModule([USER_JWALTON.username]),
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
});
