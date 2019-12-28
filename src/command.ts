import * as k8s from '@kubernetes/client-node';
import _ from 'lodash';
import { parseCommandLineArgs } from './args';
import authModules from './authModules';
import { DEFAULT_METRICS_PORT, readConfig, validateConfig } from './config';
import { startMetricsServer } from './metrics';
import { startServer as startProxyServer } from './server/index';
import TargetManager from './TargetManager';
import { CompiledProxyTarget, compileProxyTarget, parseTargetsFromFile } from './targets';
import * as log from './utils/logger';

async function start() {
    const cliOptions = await parseCommandLineArgs();
    // If there was a logLevel specified in the CLI, use it right away.
    if (cliOptions.logLevel) {
        log.setLevel(cliOptions.logLevel);
    }

    const fileConfig = await readConfig(cliOptions.config);

    const rawConfig = _.merge(fileConfig, cliOptions);
    const config = validateConfig(rawConfig);
    if (config.logLevel) {
        log.setLevel(config.logLevel);
    }

    const enabledAuthModles = authModules.filter(module => module.isEnabled(config));
    log.info(`Enabled authentication modules: ${enabledAuthModles.map(m => m.name).join(', ')}`);

    let kubeConfig: k8s.KubeConfig | undefined;
    if (!cliOptions.noK8s) {
        log.info('Loding Kubernetes configuration.');
        kubeConfig = new k8s.KubeConfig();
        kubeConfig.loadFromDefault();
    }

    const k8sApi = kubeConfig ? kubeConfig.makeApiClient(k8s.CoreV1Api) : undefined;
    const rawDefaultTargets = parseTargetsFromFile(
        undefined,
        'static-config',
        'static-config',
        config.defaultTargets
    );
    const defaultTargets: CompiledProxyTarget[] = [];
    for (const defaultTarget of rawDefaultTargets) {
        defaultTargets.push(
            await compileProxyTarget(k8sApi, defaultTarget, config.defaultConditions)
        );
    }

    // Watch Kubernetes for services to proxy to.
    const proxyTargets = new TargetManager(defaultTargets, config.defaultConditions, {
        kubeConfig,
        domain: config.domain,
        namespaces: config.namespaces,
        proxyTargetSelector: config.proxyTargetSelector,
    });

    startProxyServer(config, proxyTargets, authModules);
    startMetricsServer(config.metricsPort || DEFAULT_METRICS_PORT);
}

start().catch(err => {
    log.error(err);
});
