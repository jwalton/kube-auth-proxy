import express from 'express';
import { AuthModule } from '../../src/authModules/AuthModule';
import { Condition, SanitizedKubeAuthProxyConfig } from '../../src/types';

export default class MockAuthModule implements AuthModule {
    name = 'mock-auth';

    authenticationMiddleware(_config: SanitizedKubeAuthProxyConfig): express.RequestHandler {
        const router = express.Router();

        router.get('/kube-auth-proxy/mockauth', (req, res, next) => {
            if (req.query.username) {
                req.login({ type: 'mock-auth', username: req.query.username, emails: [] }, err => {
                    if (err) {
                        next(err);
                    } else {
                        res.redirect('/');
                    }
                });
            } else {
                next();
            }
        });

        return router;
    }

    authorize(user: any, condition: Condition) {
        return (condition as any).allowedUsers.includes(user.username);
    }

    getLoginButton() {
        return '<a href="">Login with Mock Provider!</a>';
    }
    isEnabled() {
        return true;
    }
}
