import { ForwardTargetFinder } from '../../src/server/findTarget';
import { CompiledForwardTarget } from '../../src/Targets';

export function mockForwardTargetManager(targets: CompiledForwardTarget[]): ForwardTargetFinder {
    return {
        findTarget(host: string) {
            return targets.find(target => target.host === host);
        },
    };
}
