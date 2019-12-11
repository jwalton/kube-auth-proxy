export function loginScreen(props: { loginButtons: string[] }) {
    const { loginButtons } = props;

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
                margin: 30px 0;
                text-align: center;
            }

            .content a {
                display: inline-block;
                padding: 10px;
                background-color: #00f;
                border-radius: 5px;
                text-decoration: none;
            }

            .content a:link, .content a:visited, .content a:hover, .content a:active {
                color: #fff;
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
                Not Logged In
            </div>
        </div>

        <div class="content">
            ${loginButtons.join('\n')}
        </div>

        <div style="text-align: center; width: 100%">
            Powered by <a href="https://github.com/jwalton/kube-auth-proxy">kube-auth-proxy</a>
        </div>
    </body>
</html>
    `;
}
