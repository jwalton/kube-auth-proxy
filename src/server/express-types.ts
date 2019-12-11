/* eslint-disable @typescript-eslint/no-namespace */
import { CompiledProxyTarget } from '../Targets';
import { KubeAuthProxyUser } from '../types';

declare global {
    namespace Express {
        // eslint-disable-next-line @typescript-eslint/no-empty-interface
        interface User extends KubeAuthProxyUser {}
    }
}

declare module 'express-serve-static-core' {
    interface Request<P extends Params = ParamsDictionary, ResBody = any, ReqBody = any> {
        target?: CompiledProxyTarget;
    }
}
