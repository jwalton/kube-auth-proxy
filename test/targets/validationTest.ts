import chai from 'chai';
import { validateProxyTarget } from '../../src/targets/validation';

const { expect } = chai;

describe('targets - validation', function () {
    it('should validate a target', function () {
        expect(() =>
            validateProxyTarget({
                key: 'test',
                source: 'test',
                host: 'prometheus',
                to: {
                    service: 'test',
                    targetPort: 'web',
                },
            })
        ).to.not.throw();
    });

    it('should throw for an invalid target', function () {
        expect(() =>
            validateProxyTarget({
                key: 'test',
                source: 'test',
                to: {
                    service: 'test',
                    targetPort: 'web',
                },
            } as any)
        ).to.throw(`Invalid ProxyTarget: should have required property 'host'`);
    });
});
