import * as k8s from '@kubernetes/client-node';
import { RawProxyTarget } from '../targets';

export interface ProxyTargetCrd {
    apiVersion: string;
    kind: 'ProxyTarget';
    metadata?: k8s.V1ObjectMeta;
    target: RawProxyTarget;
}
