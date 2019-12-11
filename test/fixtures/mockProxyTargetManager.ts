import { ProxyTargetFinder } from '../../src/server/findTarget';
import { CompiledProxyTarget } from '../../src/Targets';

export function mockProxyTargetManager(targets: CompiledProxyTarget[]): ProxyTargetFinder {
    return {
        findTarget(host: string) {
            return targets.find(target => target.host === host);
        },
    };
}
