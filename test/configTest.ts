import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
    DEFAULT_COOKIE_NAME,
    DEFAULT_METRICS_PORT,
    DEFAULT_PORT,
    validateConfig,
} from '../src/config';
import { SanitizedKubeAuthProxyConfig } from '../src/types';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('config parser', function() {
    it('should fill in default values', async function() {
        const config = validateConfig({
            domain: 'mydomain.com',
            auth: {
                github: {
                    clientID: 'fake-client-id',
                    clientSecret: 'fake-client-secret',
                },
            },
        });

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
        expect(() => validateConfig({} as any)).to.throw('domain required in configuration.');
    });
});
