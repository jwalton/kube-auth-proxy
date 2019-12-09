import yargs from 'yargs';
import { RawKubeAuthProxyConfig } from './types';

export function parseCommandLineArgs(): Partial<RawKubeAuthProxyConfig> & {
    config?: string;
    noK8s?: boolean;
} {
    const options = yargs
        .strict()
        .usage(
            'Start the kube-auth-proxy server.\n' +
                'Usage: $0 [--audit] [-a accountName] [handler...]\n'
        )
        .options('v', { alias: 'verbose', boolean: true, describe: 'Print verbose details' })
        .options('cookie-secure', {
            type: 'boolean',
            describe:
                'Set secure (HTTPS) cookie flag. Defaults to true. ' +
                'Use `--no-cookie-secure` to set this false.',
        })
        .options('config', {
            type: 'string',
            describe: 'Location of the config file.',
        })
        .options('no-k8s', {
            type: 'boolean',
            default: false,
            describe:
                'If set, do not connect to Kubernetes to get configuration.' +
                '(This is mainly for development.)',
        })
        .help('h')
        .alias('h', 'help').argv;

    return {
        config: options.config,
        noK8s: options['no-k8s'],
        secureCookies: options['cookie-secure'],
        logLevel: options.v ? 'debug' : undefined,
    };
}
