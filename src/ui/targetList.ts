import _ from 'lodash';
import { CompiledProxyTarget, getFqdnForTarget } from '../targets';
import { KubeAuthProxyUser } from '../types';

export function targetList(props: {
    user: KubeAuthProxyUser;
    domain: string;
    targets: CompiledProxyTarget[];
}) {
    const { user, domain } = props;
    const targets = _.sortBy(props.targets, (target) => target.host);
    const haveGlobalTargets = targets.some((t) => t.conditions.length === 0);

    return `
<html>
    <head>
        <title>kube-auth-proxy</title>
        <style>
            body {
                box-sizing: border-box;
                font-family: sans-serif;
                margin: 0;
            }

            .header {
                width: 100%;
                color: #ddd;
                background: #000;
                height: 2em;
                line-height: 2em;

            }
            .header a:link, .header a:visited {
                color: #ddd;
            }
            .header a:hover, .header a:active {
                color: #fff;
            }

            .header .user {
                padding-right: 10px;
                float: right;
            }

            .content {
                margin: 10px;
            }

            a:link, a:visited {
                color: #000;
            }
            a:hover, a:active {
                color: #00c;
            }

        </style>
    </head>
    <body>
        <div class="header">
            <div class="user">
                ${user.username} [${user.type}] - <a href="/kube-auth-proxy/logout">logout</a>
            </div>
        </div>

        <div class="content">
            <h1>Available Services</h1>
            <ul>
                ${targets.map((target) => renderTarget(domain, target)).join('\n')}
            </ul>

            ${
                haveGlobalTargets
                    ? `<p>* Warning: These targets have no authorization conditions, and can be accessed by anyone.</p>`
                    : ''
            }
        </div>

        <div style="text-align: center; width: 100%">
            Powered by <a href="https://github.com/jwalton/kube-auth-proxy">kube-auth-proxy</a>
        </div>
    </body>
</html>
    `;
}

function renderTarget(domain: string, target: CompiledProxyTarget) {
    const host = getFqdnForTarget(domain, target);
    const url = `https://${host}`;
    const anyUser = target.conditions.length === 0 ? ' *' : '';

    return `<li><a href="${url}">${target.host}</a>${anyUser}</li>`;
}
