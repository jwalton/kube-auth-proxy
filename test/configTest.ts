import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { promises as fs } from 'fs';
import sinon from 'sinon';
import {
    DEFAULT_COOKIE_NAME,
    DEFAULT_METRICS_PORT,
    DEFAULT_PORT,
    readConfig,
    validateConfig,
} from '../src/config';
import { SanitizedKubeAuthProxyConfig } from '../src/types';

chai.use(chaiAsPromised);
const { expect } = chai;

const MINIMAL_CONFIG = `
domain: mydomain.com
auth:
    github:
        clientID: fake-client-id
        clientSecret: fake-client-secret
`;

describe('config parser', function() {
    afterEach(function() {
        sinon.restore();
    });

    it('should fill in default values', async function() {
        sinon.stub(fs, 'readFile').resolves(MINIMAL_CONFIG);
        const rawConfig = await readConfig();
        const config = validateConfig(rawConfig);

        const expectedConfig: SanitizedKubeAuthProxyConfig = {
            domain: 'mydomain.com',
            authDomain: 'auth.mydomain.com',
            port: DEFAULT_PORT,
            metricsPort: DEFAULT_METRICS_PORT,
            sessionCookieName: DEFAULT_COOKIE_NAME,
            sessionSecret: config.sessionSecret,
            secureCookies: true,
            defaultConditions: [],
            defaultTargets: [],
            auth: {
                github: {
                    clientID: 'fake-client-id',
                    clientSecret: 'fake-client-secret',
                },
            },
        };

        expect(config).to.eql(expectedConfig);
        expect(config.sessionSecret).to.not.be.empty;
        expect(config.sessionSecret).to.be.string;
    });

    it('should error for an invalid config', async function() {
        sinon.stub(fs, 'readFile').resolves('');
        const config = await readConfig();
        expect(() => validateConfig(config)).to.throw('domain required in configuration.');
    });
});
