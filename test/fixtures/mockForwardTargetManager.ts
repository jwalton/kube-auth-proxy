import { ForwardTargetFinder } from '../../src/server/findTarget';
import { ForwardTarget } from '../../src/types';

export function mockForwardTargetManager(targets: ForwardTarget[]): ForwardTargetFinder {
    return {
        findConfig(host: string) {
            return targets.find(target => target.host === host);
        },
    };
}
