import { ForwardTargetFinder } from '../../src/server/findTarget';
import { ForwardTarget } from '../../src/types';
import { compileForwardTarget } from '../../src/utils/utils';

export function mockForwardTargetManager(targets: ForwardTarget[]): ForwardTargetFinder {
    const compiledForwardTargets = targets.map(t => compileForwardTarget([], t));

    return {
        findTarget(host: string) {
            return compiledForwardTargets.find(target => target.host === host);
        },
    };
}
