import chai from 'chai';
import 'mocha';
import { compileProxyTarget } from '../src/Targets';
import { createMockK8sApi } from './fixtures/mockK8sApi';

const { expect } = chai;

describe('targets', function() {
    describe('compileProxyTarget', function() {
        it('should compile a target', async function() {
            const target = await compileProxyTarget(
                undefined,
                {
                    key: 'test',
                    source: 'test',
                    host: 'prometheus',
                    targetUrl: 'http://theservice.default:80',
                },
                []
            );

            expect(target).to.eql({
                compiled: true,
                key: 'test',
                source: 'test',
                targetUrl: 'http://theservice.default:80',
                wsTargetUrl: 'ws://theservice.default/',
                host: 'prometheus',
                conditions: [],
                headers: undefined,
            });
        });

        it('should add default conditions if the target defines no conditions', async function() {
            const target = await compileProxyTarget(
                undefined,
                {
                    key: 'test',
                    source: 'test',
                    host: 'prometheus',
                    targetUrl: 'http://theservice.default:80',
                },
                [
                    {
                        githubAllowedUsers: ['jwalton'],
                    },
                ]
            );

            expect(target.conditions).to.eql([
                {
                    githubAllowedUsers: ['jwalton'],
                },
            ]);
        });

        it('should ignore default conditions if the target defines conditions', async function() {
            const target = await compileProxyTarget(
                undefined,
                {
                    key: 'test',
                    source: 'test',
                    host: 'prometheus',
                    targetUrl: 'http://theservice.default:80',
                    conditions: {
                        githubAllowedOrganizations: ['exegesis-js'],
                    },
                },
                [
                    {
                        githubAllowedUsers: ['jwalton'],
                    },
                ]
            );

            expect(target.conditions).to.eql([
                {
                    githubAllowedOrganizations: ['exegesis-js'],
                },
            ]);
        });

        it('should add a bearer token header', async function() {
            const k8sApi = createMockK8sApi({
                secrets: [
                    {
                        kind: 'secret',
                        metadata: {
                            name: 'thesecret',
                            namespace: 'default',
                        },
                        stringData: {
                            data: 'secret',
                        },
                    },
                ],
            });

            const target = await compileProxyTarget(
                k8sApi,
                {
                    key: 'test',
                    source: 'test',
                    namespace: 'default',
                    host: 'prometheus',
                    targetUrl: 'http://theservice.default:80',
                    bearerTokenSecret: {
                        namespace: 'default',
                        secretName: 'thesecret',
                        dataName: 'data',
                    },
                },
                []
            );

            expect(target).to.eql({
                compiled: true,
                key: 'test',
                source: 'test',
                targetUrl: 'http://theservice.default:80',
                wsTargetUrl: 'ws://theservice.default/',
                host: 'prometheus',
                conditions: [],
                headers: {
                    authorization: 'Bearer secret',
                },
            });
        });

        it('should add a basic auth header from a secret', async function() {
            const k8sApi = createMockK8sApi({
                secrets: [
                    {
                        kind: 'secret',
                        metadata: {
                            name: 'thesecret',
                            namespace: 'default',
                        },
                        stringData: {
                            data: 'secret',
                        },
                    },
                ],
            });

            const target = await compileProxyTarget(
                k8sApi,
                {
                    key: 'test',
                    source: 'test',
                    namespace: 'default',
                    host: 'prometheus',
                    targetUrl: 'http://theservice.default:80',
                    basicAuthUsername: 'jwalton',
                    basicAuthPasswordSecret: {
                        namespace: 'default',
                        secretName: 'thesecret',
                        dataName: 'data',
                    },
                },
                []
            );

            expect(target.headers?.authorization).to.equal(
                `Basic ${Buffer.from('jwalton:secret').toString('base64')}`
            );
        });

        it('should add a basic auth header from a litteral', async function() {
            const target = await compileProxyTarget(
                undefined,
                {
                    key: 'test',
                    source: 'test',
                    namespace: 'default',
                    host: 'prometheus',
                    targetUrl: 'http://theservice.default:80',
                    basicAuthUsername: 'jwalton',
                    basicAuthPassword: 'secret',
                },
                []
            );

            expect(target.headers?.authorization).to.equal(
                `Basic ${Buffer.from('jwalton:secret').toString('base64')}`
            );
        });
    });
});
